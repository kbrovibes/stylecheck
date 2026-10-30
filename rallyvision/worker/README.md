# Cloud GPU worker (optional, reference implementation — NOT deployed)

The in-browser pipeline is the product. This folder is the "pro" path used by the
reel-making tools: TrackNetV3 for the shuttle + YOLO-pose for players on a GPU.

**Status:** written as a reference, **untested** in this environment (no GPU, PyTorch
download blocked, model weights on Google Drive blocked). Treat it as a starting point.

## Deploy with Modal

```bash
pip install modal
modal setup
# put TrackNet_best.pt + InpaintNet_best.pt (from https://github.com/qaz812345/TrackNetV3) in ./ckpts
modal deploy worker/modal_app.py
# -> prints https://<you>--rallyvision-worker-analyze.modal.run
```

Then set `NEXT_PUBLIC_ML_WORKER_URL=https://<that-url>` on Vercel. The web app
posts the video, polls `/status/{job}` and consumes the same JSON shape the
browser pipeline produces (`ShuttleSample[]`, `PlayerSample[]`), so everything
downstream (hits, rallies, score, overlays, export) stays identical.
