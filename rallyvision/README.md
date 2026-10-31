<div align="center">

# 🏸 RallyVision

**Upload a casual badminton video → shuttle trajectory, estimated smash speed, 2D court tracker, player tracking and an automatic score overlay.**
Everything runs in the browser. Nothing is uploaded.

[Deploy with Vercel](https://vercel.com/new/clone?repository-url=https://github.com/kbrovibes/stylecheck&root-directory=rallyvision&project-name=rallyvision) · [Decision log](DECISIONS.md) · [What needs unblocking](docs/UNBLOCK.md)

</div>

## What it does

| Reel feature | How RallyVision does it |
|---|---|
| **Shuttle trail** | Classical 3-frame-difference detector + multi-hypothesis alpha-beta tracker (`lib/cv/shuttle.ts`). Optional TrackNetV3 ONNX engine slot. |
| **Smash speed badge** | Court homography → ground-plane speed in the frames after each hit, shown as *estimated* km/h with a shot type (smash / drive / clear / drop / serve). |
| **2D court tracker** | Top-down minimap with live player dots, the shuttle's ground projection and where every rally ended (in = yellow, out = red). |
| **Player tracking** | MediaPipe Pose (self-hosted) skeletons; falls back to motion blobs. Players are assigned near/far by their court position. |
| **Score counter** | Rallies are segmented from the shuttle track; a heuristic decides the winner (in / out / net); BWF 21-point scoring with server tracking. One-click override per rally. |
| **Export** | Burn overlays into an MP4 (WebCodecs) or WebM (MediaRecorder fallback), a 1080×1350 match card PNG, and the raw analysis JSON. |
| **Coach notes** | `/api/insights`: Claude or Gemini when a key is configured, otherwise a deterministic template built from the measured stats. |

## Run it

```bash
cd rallyvision
npm install
npm run dev          # http://localhost:3000  → "Try the sample clip"
```

Record from **behind the baseline, static phone, whole court in frame**. 15–90 s clips analyse in roughly
real time on a laptop (every frame, 640p). Pick *every 2nd frame* or *480p* for long clips.

## Deploy

Vercel, zero config: import this repo, set **Root Directory = `rallyvision`**, deploy. No env vars needed.
Optional env vars are listed in [`.env.example`](.env.example) (AI keys, TrackNet model URL, cloud worker URL).

## Tests

```bash
npm run sample:make   # regenerate the synthetic clip + ground truth (needs python3, numpy, pillow, ffmpeg)
npm run test:track    # offline tracker benchmark vs ground truth (~3 s, no browser)
npm run build && npm run test:e2e   # full flow in headless Chromium: load → calibrate → analyse → override → insights → export
```

## How the pipeline works

```
video file ──seek frame by frame──▶ 640p luma ──▶ 3-frame difference ──▶ small-blob candidates
                                                   │                         (bright, compact, isolated)
                 MediaPipe Pose ──▶ player boxes ──┘ mask                    │
                                                                             ▼
   court corners (auto Hough proposal, user-adjusted) ──▶ homography ──▶ multi-hypothesis tracker
                                                              │              (metric confirm / jitter kill)
                                                              ▼              │
                                             ground-plane speeds ◀── hits (direction reversals) ◀── shuttle track
                                                              │
                                             rallies → winner heuristic → score → overlays / minimap / export
```

Honest limitations: speeds are single-camera ground-plane estimates (±15–30 %), the winner heuristic is a guess you
should glance at, and moving cameras break the motion-based detector. The neural (TrackNetV3) and cloud-GPU paths
are wired but need weights / a worker — see [docs/UNBLOCK.md](docs/UNBLOCK.md).

## Sharing with friends

The app is open: no accounts, and every finished video is public in the shared library. Send people the link
(https://rallyvision-one.vercel.app) or a video's `/v/<id>` page; links unfurl with the poster, players and score.

- **Upload from a phone:** Upload video → mark the court → Upload & analyze. Long clips default to the first 90 s,
  compressed on the phone (~25–30 MB). After the upload you can close the app; progress shows under **All uploads**.
- **Guardrails:** clips that aren't badminton are removed automatically (Gemini check). There are 40 uploads/IP/day,
  300/day in total, and 40 GPU jobs/day (`MODAL_JOBS_PER_DAY`). Stuck jobs time out daily (cron), and raw uploads are
  deleted after rendering.
- **Costs:** each job shows a rough compute cost (Sandbox CPU, Modal GPU, Gemini). On-device processing is $0.
- **Filming tips:** steady phone behind the baseline, as high as you can, the whole court in view, landscape if possible.
