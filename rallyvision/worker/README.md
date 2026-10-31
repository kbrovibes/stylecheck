# Modal GPU detector (`rallyvision-detector`)

Replaces step 1 of the server worker (`lib/worker/main.ts`, shuttle + player tracking) when a job
runs in "Modal GPU" mode. Event/score logic and overlay rendering stay in the Vercel Sandbox worker.

- **Shuttle:** official TrackNetV3 ([qaz812345/TrackNetV3](https://github.com/qaz812345/TrackNetV3), MIT),
  TrackNet + InpaintNet, temporal-ensemble (`--eval_mode weight`). `predict.py` from the pinned commit runs
  in-process, so the inference matches the paper's code.
- **Players:** Ultralytics YOLO11s-pose on every 2nd frame (imgsz 960). COCO-17 keypoints are mapped into
  the 33-point MediaPipe layout (`MP_FROM_COCO`: eye inner/outer → eye, mouth → nose, hand points → wrist,
  heel/toe → ankle) and clamped to the person box, so `PlayerAssigner.fromPoses` can use them unchanged.
- **Hardware:** T4, 4 vCPU, 12 GiB, `min_containers=0`, `scaledown_window=60`, 30 min timeout.

## API

All calls need the header `x-rallyvision-secret: $RALLYVISION_SECRET`.

| Call | Body / response |
|---|---|
| `POST /detect` | `{video_url, trim_sec, fps, width, height}` → `{call_id}` |
| `GET /result/{call_id}` | `{status: "running", progress, phase}` · `{status: "done", result}` · `{status: "error", error}` |
| `GET /health` | `{ok: true}` (no auth) |

`result` = `{fps, frames, width, height, shuttle: [{f,t,x,y,conf,interp}], poses: [{f, people: [{landmarks: [[x,y]×33], conf}]}], timings, engine}`.
Pixel coordinates are in the original display size (`width`×`height` from the request). `interp=true`
(conf 0.6) marks frames that InpaintNet filled in where TrackNet saw nothing.
The Node client is `lib/worker/modal.ts` (`detectWithModal`), which reads `MODAL_DETECT_URL` and
`RALLYVISION_SECRET`.

## Modal resources (workspace `kbrovibes`)

| Resource | Contents |
|---|---|
| Volume `rallyvision-weights` | `/ckpts/TrackNet_best.pt`, `/ckpts/InpaintNet_best.pt` (from `TrackNetV3_ckpts.zip`) |
| Secret `rallyvision-secret` | `RALLYVISION_SECRET` (same value as the Vercel env var) |
| Dict `rallyvision-detector-progress` | per-call progress |
| Image | YOLO11s-pose weights baked in at `/opt/yolo` |

## Deploy / redeploy

```bash
python3 -m venv .venv && .venv/bin/pip install modal python-dotenv
.venv/bin/modal token set --token-id ak-… --token-secret as-…   # Modal → Settings → API tokens
# one-time (already done for kbrovibes):
#   curl -L -o ckpts.zip "https://drive.usercontent.google.com/download?id=1CfzE87a0f6LhBp0kniSl1-89zaLCZ8cA&export=download&confirm=t"
#   unzip ckpts.zip && .venv/bin/modal volume put rallyvision-weights ckpts /ckpts
#   .venv/bin/modal secret create rallyvision-secret RALLYVISION_SECRET=<value>
.venv/bin/modal deploy worker/modal_app.py
# -> https://kbrovibes--rallyvision-detector-api.modal.run
```

Then on Vercel (from `rallyvision/`): `vercel env add MODAL_DETECT_URL production` (and `development`) with
that URL, and redeploy.

Smoke test without deploying (prints recall-ready JSON to `detect.json`):

```bash
modal run worker/modal_app.py::smoke --video-url https://rallyvision-one.vercel.app/sample/synthetic-rally.mp4
RV_GPU=none modal run worker/modal_app.py::smoke --video-url …   # CPU-only, no payment method needed
```
