# RallyVision — Decision Log

Autonomous decisions made while building (2026-10-30). Flag anything you'd change.

## Where it lives
- **Sub-folder `rallyvision/` on branch `claude/rallyvision` of the `stylecheck` repo.** Creating a new GitHub
  repo was refused (the session's GitHub token is scoped to this one repo; `POST /user/repos` → 403), so the
  app is a standalone Next.js project inside this repo. Vercel supports this via *Root Directory*. The parent
  app is untouched except for excluding `rallyvision/**` from its `tsconfig` and ESLint globs so its build
  doesn't typecheck the new app.
- Did **not** push to `main` — the wardrobe app deploys from there. Merge when you're happy.

## Architecture: everything runs in the browser
- Vercel functions have no GPU, a 250 MB bundle cap and short timeouts, so server-side video ML is a
  non-starter there. Instead the whole CV pipeline runs client-side on the uploaded file (never uploaded
  anywhere). This also makes the app free to run at any scale.
- **Frame access by seeking** (`currentTime` + `seeked`) at a downscaled analysis resolution (640p default)
  rather than WebCodecs: works for every container the browser can decode (incl. iPhone HEVC where
  supported), never drops frames, and needs no demuxer. Slower than realtime on long clips; a stride
  option processes every 2nd frame.
- **fps is probed** by playing ~1.5 s with `requestVideoFrameCallback` and snapping to common rates;
  browsers don't expose fps directly.

## Shuttle tracking: classical first, neural optional
- Built-in engine = 3-frame differencing → small-blob candidates scored for brightness, compactness and
  **isolation** (limbs and rackets come as clusters next to big moving blobs; the shuttle flies alone) →
  **multi-hypothesis** alpha-beta tracker. Several tracks live at once; each must travel ≥1.5 m (court plane,
  so the compressed far court is judged fairly) within 14 frames with a straight-ish path to be confirmed;
  only the best confirmed track is emitted; a confirmed track that stops going anywhere (a swinging arm) is
  killed and its last second retracted. This came out of the offline benchmark: a single-target tracker
  kept locking onto the players' arms and blocked the real shuttle for a full rally.
- Runs at ~2 ms/frame in Node and ~5 ms in the browser; needs no weights. Weakness: moving cameras and
  shuttle-coloured moving backgrounds. Benchmark on the synthetic clip: ~63 % of visible frames tracked
  within 25 px (mean error 3.4 px), 4/4 rallies found, 14/21 hits within 0.25 s (`npm run test:track`).
- TrackNetV3 ONNX engine is implemented behind the same interface but **ships without weights** (couldn't
  reach Google Drive / PyTorch / HF from the sandbox). See docs/UNBLOCK.md §3.

## Players
- MediaPipe Pose Landmarker (lite, 2–4 poses) **self-hosted** (`public/mediapipe/wasm` ≈27 MB for the SIMD and
  no-SIMD runtimes the resolver can pick, `public/models` 5.6 MB) so nothing loads from jsDelivr/Google at
  runtime and the app works on locked-down networks. If repo size matters more, point `forVisionTasks` at the
  jsDelivr URL and delete the folder. Torso boxes mask the shuttle search so limbs aren't
  mistaken for the shuttle. If pose finds nobody (or WebGL is missing) a coarse motion-blob detector takes
  over so the minimap still works.
- Players are assigned to **near/far by court half** (feet projected through the homography) — in badminton
  players stay on their half, which is far more robust than appearance-based re-identification.

## Court & speed
- Court = 4 user-confirmed corners → DLT homography to the real 13.4 × 6.1 m court. An automatic Hough-based
  corner proposal runs first (within ~10 px on the synthetic clip) but the user always sees and can drag the
  handles — reels-style "auto everything" is unreliable on casual footage.
- **Speed = ground-plane projection of consecutive shuttle positions right after a hit** (mean of the top two
  frame-to-frame speeds in the next 5 frames), in km/h. This is the standard single-camera approximation the
  Instagram tools use; it ignores shuttle height, so it is labelled *estimated* everywhere and flagged
  `reliable=false` when based on <2 samples or > 420 km/h. MonoTrack-style 3D reconstruction would be the
  rigorous upgrade.

## Rallies & score
- A hit = sign change of along-court velocity or a >75° direction change while moving, debounced to ≥0.22 s.
- A rally = continuous shuttle track with gaps ≤1.2 s; short tracks without hits are dropped.
- **Winner heuristic:** last hitter wins if the shuttle ended in-bounds on the other half; loses if it went
  out or never crossed. Score is BWF rally scoring (21, win by 2, cap 30, server = last winner). Because the
  heuristic will be wrong sometimes, every rally has a one-click override and the score recomputes.

## Export
- WebCodecs `VideoEncoder` + `mp4-muxer` → MP4 (H.264 when the browser can encode it, else VP9-in-MP4).
  Frame-accurate and faster than realtime; **drops audio** (muxing audio needs an AudioEncoder path — not
  done). Fallback: MediaRecorder on a canvas stream while the video plays → WebM with the original audio.
  The e2e run in headless Chromium exercised the WebCodecs path (H.264 `avc1.640028`, 831 frames, 5 MB for
  the 28 s sample); the MediaRecorder fallback is exercised manually in Safari/Firefox.
- A 1080×1350 "match card" PNG is also exportable for reels/stories.

## AI
- Coach notes go through `/api/insights` with a provider abstraction: Anthropic (`claude-opus-5-5`,
  structured JSON output, server-side refusal fallback) → Gemini → **deterministic mock**. No keys were
  available, so production currently serves the mock, which only states measured facts. Any provider error
  degrades to the mock so the UI never breaks.

## Testing
- No real badminton footage was reachable, so `tests/make_synthetic.py` renders a perspective court, two
  blocky players and a shuttle flying parabolas with ground truth (corners, rallies, winners). The Playwright
  e2e test (`tests/e2e.mjs`) runs the full flow headlessly and asserts fps probe, corner detection, rally
  and shot counts, plausible speeds, overlay rendering, score override, mock insights and video export.
  Last run: all checks passed — corners within 14 px, 4/4 rallies aligned, 21/21 shots counted, speeds
  21–119 km/h, MediaPipe found both (blocky!) players, MP4 exported. Analysis of the 28 s clip took ~260 s
  in headless SwiftShader; a laptop GPU is several times faster.

## 2026-10-30 — local resume (macOS, Node 26.3, ffmpeg 9.0)
- **Erasable-only TypeScript.** Node 26 dropped `--experimental-transform-types`, so `test:track` failed on
  the `readonly x: number` constructor parameter properties. Rewrote them as plain fields and enabled
  `erasableSyntaxOnly` in tsconfig; `test:track` now runs with plain `node --import`. Behaviour unchanged
  (old code under tsx gives identical benchmark numbers).
- **The offline benchmark depends on the resize filter.** With ffmpeg 9's default bicubic scaler,
  recall is 47 % and 8/21 hits match (the cloud run recorded 63 % and 14/21). Bilinear gives 56 % and area
  gives 69 % with 15/21 hits. The detector thresholds are tuned closely to how the synthetic clip was
  scaled, so real-footage tuning matters more than these numbers suggest.
- **E2E (headless Chromium 156) passes, but the assertions are loose.** It found 3 rallies against a
  truth of 4 (rallies 1 and 2 merged across a 2.1 s gap), counted 21/21 shots, and the winner heuristic
  was right on 2/4 rallies. The 4/4 "aligned" check passes because the merged rally overlaps both truth
  rallies. Known gap to fix during real-footage tuning.
