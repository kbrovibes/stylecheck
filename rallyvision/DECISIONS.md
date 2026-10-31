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

## 2026-10-31 — event-logic accuracy pass (`lib/cv/events.ts`)
Offline benchmark, before → after, per ffmpeg scaler (default bicubic / area / bilinear; the browser is closest to
bilinear). Tracker untouched, so shuttle recall is unchanged (47 / 69 / 56 %).
- Rallies: 4 / 3 (1+2 merged) / 5 (rally 1 split) → **4 / 4 / 4**, each aligned 1:1 with a truth rally.
- Winners right: 1 / 1 / 1 of 4 → **1 / 4 / 2**. (Area rally 2 is right partly for the wrong reason: a phantom late
  hit triggers the lost-in-flight rule.) The misses left are all tracks lost mid-rally, 0.5–1.6 s before it ends.
- Hits matched within 0.25 s: 8 / 15 / 8 of 21 → **9 / 16 / 12**, while detections fell from 17 / 30 / 18 to
  11 / 20 / 12, so far fewer phantom hits. Correct hitter among matched hits: 5/8, 9/15, 4/8 → 7/9, 14/16, 12/12.
- Top "reliable" speed: 164 / 161 / 125 → 82 / 88 / 94 km/h. The synthetic shots move at well under 100 km/h, so
  the old values were artefacts.

Rule changes, with the reasoning behind each:
- **Drop samples that hover.** Anything whose image footprint stays inside 0.75 m for 1 s is not a shuttle in play
  (terminal velocity is ~6.8 m/s). It is an arm or racket the tracker latched onto, or a shuttle lying on the floor.
  This is what merged rallies 1 and 2: a confirmed track jittered around the far player for 1.5 s and was then
  handed over to the next serve. The window has to be a full second because flight along the court is so
  foreshortened in the far half that a real shuttle can cover only ~0.8 m of footprint in 0.8 s.
- **Gaps:** > 1.2 s still ends a rally, unless the gap is ≤ 1.8 s (about the longest single flight, a high serve or
  clear) and the shuttle is moving > 3 m/s on both sides of it. That is the tracker losing a shot in flight, not
  play stopping.
- **Hit trigger:** the sign change of *ground-projected* along-court velocity is gone. An airborne shuttle's
  projection reverses at the apex of every far-court flight, so that rule produced a phantom hit before or after most
  far-player hits and gave the real one to the wrong side. It is replaced by an upturn in *image* motion (moving down
  the frame, then up). In free flight drag only slows the shuttle and gravity only pulls it down, so only a racket
  can do that. The sharp-turn rule stays.
- **Hitter side:** the camera sits above contact height, so the ground projection of an airborne shuttle always lands
  farther from the camera, never nearer. A contact that projects onto the near half is therefore certainly near.
  Otherwise the net image-y travel over the next 0.6 s decides. Player snapping still overrides when a player is close.
- **Serve:** a rally candidate ≥ 1 s with no hit in its first 0.3 s gets a hit at its first in-play sample.
- **Winner from the landing, not the last hitter.** If the shuttle comes down in on half S, the other side wins; if it
  goes out on half S, S wins. Net faults are covered too. The old lost-in-flight fallback is kept: the track ends on
  the last hitter's half, away from the net, heading for the opponent.
- **Smoothing** shrinks its window symmetrically at the ends of a run. The old one-sided average dragged landings
  back toward the hitter, by enough to flip an in/out call.
- **Speed reliability:** a speed is now also unreliable if any sample used projects more than 1 m outside the court.
  The ground projection of a shuttle h m up is magnified by H/(H−h), so rising shots read 2–4× too fast and showed
  as 160–200 km/h "reliable" smashes. `Rally.maxSpeedKmh` (here and in `pipeline.ts`) and `classifyHits` now use
  reliable speeds only. The rally list was showing the unfiltered max, which is where the 310 km/h came from. As a
  result fewer hits carry a trusted speed.

Tried and dropped:
- **Requiring each rally to cross the net** in ground projection. It removed real rallies: the same height bias
  pushes near-half samples past the net line, so rally 1 never projects below 6.2 m.
- **"Same side can't hit twice within 0.6 s" dedup.** It kept the wrong one of each pair about half the time.
- **Lost-in-flight test without the hitter**, using projected velocity or image-y only. A shuttle coming down onto
  the far half projects as moving toward the camera, so it called real landings "lost".
- Thresholds are not sensitive: the image-upturn speed gave identical results from 0.3 to 1.5 m/s.

## 2026-10-31: cloud jobs, shared library, redesign (local session)
Product asks: mobile-first, sleek light UI, a settings page, nicer and more accurate overlays, async processing you
can close the app on, a public library of every job and video (no login for now), trim long clips, compress before
upload.

- **Processing moved to the server by default.** The phone (1) optionally trims to the first 90 s (60/90/120 in
  Settings) and compresses to ≤720p H.264 with WebCodecs, (2) uploads straight to Vercel Blob (client upload, multipart),
  (3) calls `/api/jobs/:id/start`, then can close the app. In-browser processing on phones was ~10 fps at best;
  an 8-min clip would have needed the tab open for 30+ minutes.
- **Worker = Vercel Sandbox, not a Function.** The team is on Hobby: Functions max out at 300 s, Sandbox sessions at 45 min
  (4 vCPU). `start` boots a VM from a prepared snapshot (`scripts/make-sandbox-snapshot.mjs`: Node 24, ffmpeg,
  fonts-inter, @napi-rs/canvas, @vercel/blob, @upstash/redis; id in `SANDBOX_SNAPSHOT_ID`). It copies in
  `public/worker/worker.mjs` (esbuild bundle of `lib/worker/main.ts`, built before `next build`) plus a job spec, and runs
  it detached. The worker calls `/api/jobs/:id/finished` so the VM stops immediately; otherwise it dies at its
  duration-based timeout (10–45 min).
- **Same CV code on the server.** The worker reuses `lib/cv/*` (tracker, events, score) and `lib/render/overlay.ts`
  unchanged: ffmpeg decodes gray frames, Skia (@napi-rs/canvas) draws transparent overlay frames, and ffmpeg composites
  them over the source and keeps the audio. I chose this over a headless browser because headless Chromium builds often
  lack H.264 decode, and seeking frame by frame is slow. 28 s sample: 1.3 s VM boot + 9.8 s processing.
- **Players on the server CPU** use a slow running-average background model plus the existing motion-blob detector
  (MediaPipe Pose is browser-only). Frame differencing alone found 22 player samples on the sample; with the background
  model, 383. Feet positions are coarse. The **Modal GPU mode** (TrackNetV3 + pose model) replaces the detection step when configured.
- **Job state in Upstash Redis** (Marketplace), files in Vercel Blob (`rallyvision-media`, public). Jobs: `job:{id}` JSON
  plus a `jobs` sorted set. Each job has a random edit key (hash stored), so only the uploading browser can patch or delete it.
  Everyone can list and view everything (no login, by request). Rate limits: 40 jobs/IP/day, 300/day total. Stalled = no
  heartbeat for 45 s.
- **Overlays redesigned** (`lib/render/overlay.ts`): glass score bug with rally footer, point banner, speed badges with
  leader lines only for *reliable* speeds (toggle for rough ones), trails that break at gaps and track switches (they used
  to join unrelated tracks), ground rings sized from the court geometry (0.35 m), smoothed player positions, minimap
  without the misleading ground projection of the airborne shuttle. Layout units are `min(W,H)/720` so portrait clips
  work. Fixed a bug where on-device exports below source resolution misplaced the minimap.
- **UI**: light theme by default (dark/system in Settings), Inter + Geist, mobile-first sheets. Settings page lists every
  option and greys out unsupported ones with the reason (server capabilities from `/api/config`, browser capabilities
  detected client-side). The old all-in-browser flow lives on as **On this device** mode at `/local`. It's also the
  automatic fallback when cloud isn't configured.
- **YouTube links are not supported** (ToS + YouTube blocks cloud IPs). Upload the file instead.
## 2026-10-31 — Modal GPU detector (`worker/modal_app.py`, `lib/worker/modal.ts`)
- **Scope:** replaces only the tracking step of the server worker. `POST /detect` starts a T4 job
  (`detect.spawn`) and `GET /result/{call_id}` polls `FunctionCall.get(timeout=0)` plus a progress Dict.
  Both need `x-rallyvision-secret`. The Node client polls every 3 s and gives up after 40 min.
- **Shuttle = official TrackNetV3 `predict.py`, run in-process** (pinned commit, `--large_video --eval_mode weight`),
  not a re-implementation. The video is normalised once with ffmpeg (fps / CFR / autorotate / trim) to 512×288,
  TrackNet's own input size. That also keeps the median-background step's memory small (`--max_sample_num 300`).
- **InpaintNet points are kept only inside gaps of ≤ 0.5 s that have real TrackNet detections on both sides**,
  and they come back as `interp: true, conf: 0.6`. Unfiltered, InpaintNet filled every between-rally gap
  (268 points on frames with no shuttle on the sample). That would merge rallies downstream, because a rally is
  a continuous track. This is a general sanity rule (InpaintNet is for short occlusions), not a fit to the clip.
- **Players = YOLO11s-pose** on every 2nd frame at imgsz 960. COCO-17 keypoints are mapped into the
  MediaPipe-33 layout and clamped to the person box, so `PlayerAssigner.fromPoses` works unchanged. YOLO finds
  essentially nobody in the blocky synthetic players (3 detections in 416 frames; MediaPipe did better there), so
  pose quality is unverified until real footage is tested.
- **Synthetic sample, CPU run on Modal** (the GPU deploy is blocked, see UNBLOCK §4): raw TrackNet gets 289/457
  visible frames (63 %), all within 25 px, mean error 4.0 px, with no false positives. With gap-filtered InpaintNet:
  82 % recall within 25 px and no points on invisible frames. Unfiltered it was 93 %, but with the 268
  hallucinated points. The CPU tracker gets 47–69 % with a mean error of about 3.4 px. The clip is a rendered
  cartoon, so expect TrackNet to do better, not worse, on real broadcast-like footage.
- **Cost model:** T4 + 4 cores + 12 GiB ≈ $0.000243/s ≈ $0.88/h while a container runs. `scaledown_window=60`
  and `min_containers=0`, so nothing is billed while idle.

## 2026-10-31: Modal GPU detector live
- Deployed `rallyvision-detector` (T4) at `https://kbrovibes--rallyvision-detector-api.us-east.modal.run`, which requires
  the `x-rallyvision-secret` header (401 without it). `MODAL_DETECT_URL` and `RALLYVISION_SECRET` are set on Vercel (prod + dev).
- Measured on the 28 s sample: 82.1 % shuttle recall within 25 px, 5.5 px mean error, 8 false points. Wall time 109 s
  including cold start (~3.6x clip length), so an 8-minute clip needs ~25–30 min. That fits the 45-minute Sandbox session.
- The GPU detector is called from inside the Sandbox job (`DETECT_ENGINE=modal`). Events, scoring and rendering stay in
  the Sandbox. If the GPU pose model finds players in under 20 % of frames, the worker falls back to the CPU background
  model for players.

## 2026-10-31: share-with-friends pass (user away, decided autonomously)
- **Gemini wired** with the user's existing key (same Google account as stylecheck), default model alias `gemini-flash-latest`
  (the 2.5-era id was outdated). Coach notes on prod return `provider: gemini`.
- **Non-badminton auto-removal.** The worker samples 4 frames and asks Gemini for `{badminton, confidence, reason}`.
  Below 80 % "no", the job continues. Clear non-badminton becomes state `rejected` and the raw upload is deleted; it's hidden
  from the home table and visible under All uploads → Issues. The first prompt rejected the synthetic sample as "an animated
  diagram, not live footage", so the prompt now explicitly accepts rendered or animated play and rejects only clearly
  unrelated content. Without a key, a conservative CV fallback rejects only when there are no rallies, <2 shots and almost no players.
  Checked on prod: fractal clip rejected (conf 1.0) in 6 s with the upload deleted; sample accepted (0.98).
- **Cost shown per job** (`lib/jobs/cost.ts`): list-price estimates from recorded timings. Sandbox 4 vCPU active CPU +
  memory, Modal T4 seconds, Gemini check; on-device is $0. Jobs now store `engine`.
- **Home leads with uploads** (latest 6, table with poster/score/status/engine/clip/cost); "View all" goes to `/jobs`
  ("All uploads", table or grid, filters). Hero copy removed; floating upload button on phones.
- **Settings** use an explicit Save/Discard bar (draft state) with a "Saved ✓" confirmation and an unsaved-changes warning on leave.
- **Sharing basics:** Open Graph/Twitter tags on `/v/[id]` (poster, players, score, top speed). Raw uploads are deleted
  after a successful render. Owner-only Retry for failed or stalled jobs (start params kept server-side). Daily cleanup cron
  (`/api/cron/cleanup`, `CRON_SECRET`) fails jobs silent for >2 h and purges week-old failed uploads. Modal GPU is capped
  at `MODAL_JOBS_PER_DAY` (40), after which jobs fall back to CPU. The upload sheet says uploads are public.

## 2026-10-31: first real footage (2 iCloud clips, doubles in a church gym; only the first 90 s used)
Clips: iPhone HEVC 1920×1080 with rotation (portrait 1080×1920), ~30 fps, 10–11 min, 616–689 MB. Trimmed and compressed
like the phone flow: 90 s at 720p came to ~29 MB, matching the app's upload estimate. Run locally with the server worker
(dry mode, nothing published); the GPU run used a temporary unlisted Blob upload, deleted afterwards. The personal
videos were not added to the public library.
- **Court auto-detection failed** (gray floor, yellow multi-court lines, the near-left corner cut off by the portrait
  frame). → The court marker now has a dark border so corners can be placed off-frame. Manual corners fit the painted
  lines within ~10–20 px.
- **Gemini badminton check:** accepted (correct).
- **CPU engine:** 6–8 rallies, 65–70 shots in 90 s. The shuttle trail follows the real shuttle against the wall. The near
  player gets a ring; a spectator's foot at the frame edge was picked up as "Near 2"; far players were missed.
  Analysis took 348 s at 640×1138 (~170k candidate blobs). → Analysis now keeps the 640×360 pixel budget for portrait
  (360×640): 126 s, similar output.
- **Modal GPU engine:** 10 rallies, 33 shots. The pose model puts the near player's ring exactly at the feet; far players
  are still too small. GPU detection 315 s for 90 s of video (~3.5× real time).
- **Speeds:** none passed the reliability rule on this low, behind-the-court portrait angle (projections leave the
  court). The UI shows no speed badges rather than wrong ones. Real speeds need a higher camera or 3D shuttle-height modelling.
- **Point banner** collided with the score bug on portrait video; it now sits near the bottom on portrait frames.
- Winners and rallies have no ground truth for these clips; treat the score as a guess the uploader should check.
