"""
RallyVision cloud worker — reference implementation (untested here; see README).

POST /analyze  multipart video -> {"job": id}
GET  /status/{job}             -> {"state": "queued|running|done|error", "result": {...}}

Result schema mirrors lib/types.ts: shuttle: [{f,t,x,y,conf,interp}], players: [{f,t,id,side,box,feet,court,conf}]
Coordinates are in ORIGINAL video pixels.
"""
import json
import os
import tempfile
import uuid

import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install("torch", "torchvision", "opencv-python-headless", "numpy", "ultralytics", "fastapi", "python-multipart")
    .run_commands("git clone https://github.com/qaz812345/TrackNetV3 /opt/TrackNetV3")
    .add_local_dir("ckpts", remote_path="/opt/ckpts")
)
app = modal.App("rallyvision-worker", image=image)
jobs = modal.Dict.from_name("rallyvision-jobs", create_if_missing=True)
vol = modal.Volume.from_name("rallyvision-uploads", create_if_missing=True)


@app.function(gpu="T4", timeout=1800, volumes={"/data": vol})
def run_job(job: str, path: str, fps_hint: float | None):
    import sys
    sys.path.insert(0, "/opt/TrackNetV3")
    import cv2, numpy as np, torch
    from ultralytics import YOLO

    jobs[job] = {"state": "running"}
    try:
        cap = cv2.VideoCapture(path)
        fps = fps_hint or cap.get(cv2.CAP_PROP_FPS) or 30.0
        W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # --- TrackNetV3 (TrackNet module only; InpaintNet rectification is optional)
        from utils.general import get_model  # type: ignore  # from the cloned repo
        ckpt = torch.load("/opt/ckpts/TrackNet_best.pt", map_location="cuda")
        seq_len = ckpt["param_dict"]["seq_len"]
        net = get_model("TrackNet", seq_len=seq_len, bg_mode=ckpt["param_dict"].get("bg_mode", "")).cuda().eval()
        net.load_state_dict(ckpt["model"])

        pose = YOLO("yolov8n-pose.pt")

        shuttle, players = [], []
        buf, f = [], 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t = f / fps
            small = cv2.resize(frame, (512, 288))
            buf.append(torch.from_numpy(cv2.cvtColor(small, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float() / 255)
            if len(buf) > seq_len:
                buf.pop(0)
            if len(buf) == seq_len:
                x = torch.cat(buf, 0).unsqueeze(0).cuda()
                with torch.no_grad():
                    hm = torch.sigmoid(net(x))[0, -1].cpu().numpy()
                if hm.max() > 0.5:
                    ys, xs = np.where(hm == hm.max())
                    shuttle.append({"f": f, "t": t, "x": float(xs[0] * W / 512), "y": float(ys[0] * H / 288), "conf": float(hm.max()), "interp": False})
            if f % 2 == 0:
                res = pose(frame, verbose=False)[0]
                if res.boxes is not None:
                    for i, b in enumerate(res.boxes.xyxy.cpu().numpy()[:4]):
                        x1, y1, x2, y2 = map(float, b)
                        players.append({"f": f, "t": t, "id": i, "side": "near" if y2 > H * 0.55 else "far",
                                        "box": {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1}, "feet": {"x": (x1 + x2) / 2, "y": y2}, "court": None, "conf": 0.8})
            f += 1
        jobs[job] = {"state": "done", "result": {"fps": fps, "width": W, "height": H, "frames": f, "shuttle": shuttle, "players": players}}
    except Exception as e:  # noqa: BLE001
        jobs[job] = {"state": "error", "error": str(e)}


@app.function(volumes={"/data": vol})
@modal.asgi_app()
def api():
    from fastapi import FastAPI, UploadFile
    from fastapi.middleware.cors import CORSMiddleware

    web = FastAPI()
    web.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @web.post("/analyze")
    async def analyze(file: UploadFile, fps: float | None = None):
        job = uuid.uuid4().hex
        path = f"/data/{job}{os.path.splitext(file.filename or '.mp4')[1]}"
        with open(path, "wb") as fh:
            fh.write(await file.read())
        vol.commit()
        jobs[job] = {"state": "queued"}
        run_job.spawn(job, path, fps)
        return {"job": job}

    @web.get("/status/{job}")
    def status(job: str):
        return jobs.get(job, {"state": "unknown"})

    return web
