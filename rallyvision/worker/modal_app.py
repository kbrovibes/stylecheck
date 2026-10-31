"""
RallyVision GPU detector on Modal (T4): TrackNetV3 (TrackNet + InpaintNet) for the shuttle,
YOLO11s-pose for players. Replaces only the tracking step of lib/worker/main.ts.

  POST /detect            {video_url, trim_sec, fps, width, height} -> {call_id}
  GET  /result/{call_id}  -> {status: running|done|error, progress?, error?, result?}

Both require header `x-rallyvision-secret` == Modal Secret `rallyvision-secret`.RALLYVISION_SECRET.
Result pixel coords are in the ORIGINAL display size (width x height from the request).
See worker/README.md for deploy steps.
"""

import os
import time

import modal

APP_NAME = "rallyvision-detector"
TRACKNET_REPO = "https://github.com/qaz812345/TrackNetV3"
TRACKNET_COMMIT = "6eda442ada1740573f200f836d93edc9a541ee86"
POSE_WEIGHTS = "yolo11s-pose.pt"
TN_W, TN_H = 512, 288  # TrackNetV3 input size; frames are resized to this anyway
POSE_MAX_W = 1280
POSE_STRIDE = 2
MAX_PEOPLE = 6
MAX_INPAINT_GAP_S = 0.5
# RV_GPU=none runs the detector on CPU (only for smoke tests with `modal run`).
GPU = None if os.environ.get("RV_GPU", "T4").lower() == "none" else os.environ.get("RV_GPU", "T4")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "ultralytics==8.3.40",
        "opencv-python-headless",
        "numpy<2",
        "pandas",
        "parse",
        "pillow",
        "pycocotools",
        "tqdm",
        "fastapi[standard]",
    )
    .run_commands(
        f"git clone {TRACKNET_REPO} /opt/TrackNetV3 && cd /opt/TrackNetV3 && git checkout {TRACKNET_COMMIT}",
        f"mkdir -p /opt/yolo && cd /opt/yolo && python -c \"from ultralytics import YOLO; YOLO('{POSE_WEIGHTS}')\"",
    )
    .env({"TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD": "1", "YOLO_OFFLINE": "1"})
)

app = modal.App(APP_NAME, image=image)
weights = modal.Volume.from_name("rallyvision-weights", create_if_missing=True)
progress_store = modal.Dict.from_name("rallyvision-detector-progress", create_if_missing=True)
secret = modal.Secret.from_name("rallyvision-secret")

# COCO-17 keypoint index for each of the 33 MediaPipe landmarks (nearest sensible joint for
# landmarks COCO lacks: eye inner/outer -> eye, mouth -> nose, hand points -> wrist, heel/toe -> ankle).
MP_FROM_COCO = [
    0,                  # 0 nose
    1, 1, 1,            # 1-3 left eye inner/eye/outer
    2, 2, 2,            # 4-6 right eye inner/eye/outer
    3, 4,               # 7-8 ears
    0, 0,               # 9-10 mouth
    5, 6, 7, 8, 9, 10,  # 11-16 shoulders, elbows, wrists
    9, 10, 9, 10, 9, 10,  # 17-22 pinky, index, thumb
    11, 12, 13, 14, 15, 16,  # 23-28 hips, knees, ankles
    15, 16, 15, 16,     # 29-32 heels, foot index
]


def _report(call_id: str, p: float, phase: str) -> None:
    try:
        progress_store[call_id] = {"progress": round(min(1.0, max(0.0, p)), 3), "phase": phase, "ts": time.time()}
    except Exception:  # noqa: BLE001 - progress is best effort
        pass


def _ffmpeg(args: list[str]) -> None:
    import subprocess

    r = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-y", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {r.stderr[-1500:]}")


def _run_tracknet(video: str, frames_hint: int, report) -> tuple[dict, dict]:
    """Run the official predict.py in-process and return (tracknet_pred_dict, inpaint_pred_dict)."""
    import runpy
    import sys

    import tqdm as tqdm_mod

    repo = "/opt/TrackNetV3"
    batch = 16
    phases = iter([(0.12, 0.62, "TrackNet"), (0.62, 0.66, "InpaintNet")])

    class ProgressIter:
        def __init__(self, iterable=None, *a, **k):
            self.it = iterable
            self.lo, self.hi, self.name = next(phases, (0.66, 0.66, "TrackNetV3"))
            try:
                self.total = len(iterable)
            except TypeError:
                self.total = max(1, -(-frames_hint // batch))

        def __iter__(self):
            last = 0.0
            for n, x in enumerate(self.it):
                now = time.time()
                if now - last > 2:
                    last = now
                    report(self.lo + (self.hi - self.lo) * min(1.0, n / self.total), self.name)
                yield x

    tqdm_mod.tqdm = ProgressIter
    sys.path.insert(0, repo)
    cwd = os.getcwd()
    os.chdir(repo)
    sys.argv = [
        "predict.py",
        "--video_file", video,
        "--tracknet_file", "/weights/ckpts/TrackNet_best.pt",
        "--inpaintnet_file", "/weights/ckpts/InpaintNet_best.pt",
        "--batch_size", str(batch),
        "--eval_mode", "weight",
        "--max_sample_num", "300",
        "--large_video",
        "--save_dir", "/tmp/pred",
    ]
    try:
        g = runpy.run_path(os.path.join(repo, "predict.py"), run_name="__main__")
    finally:
        os.chdir(cwd)
    return g["tracknet_pred_dict"], g["inpaint_pred_dict"]


def _run_pose(src: str, fps: float, trim: list[str], pw: int, ph: int, sx: float, sy: float, frames: int, report) -> list[dict]:
    import subprocess

    import numpy as np
    import torch
    from ultralytics import YOLO

    model = YOLO(f"/opt/yolo/{POSE_WEIGHTS}")
    frame_bytes = pw * ph * 3
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", src, *trim, "-vf", f"fps={fps},scale={pw}:{ph}", "-fps_mode", "cfr",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        stdout=subprocess.PIPE,
    )
    out: list[dict] = []
    batch_imgs: list = []
    batch_f: list[int] = []
    last = 0.0

    def flush():
        if not batch_imgs:
            return
        results = model(batch_imgs, imgsz=960, conf=0.3, verbose=False, half=torch.cuda.is_available())
        for f, res in zip(batch_f, results):
            people = []
            if res.keypoints is not None and res.boxes is not None and len(res.boxes):
                kps = res.keypoints.xy.cpu().numpy()
                boxes = res.boxes.xyxy.cpu().numpy()
                confs = res.boxes.conf.cpu().numpy()
                for k in np.argsort(-confs)[:MAX_PEOPLE]:
                    x1, y1, x2, y2 = boxes[k]
                    kp = kps[k]
                    # undetected keypoints come back as (0,0): pull everything into the person box
                    xs = np.clip(kp[:, 0], x1, x2) * sx
                    ys = np.clip(kp[:, 1], y1, y2) * sy
                    people.append({
                        "landmarks": [[round(float(xs[c]), 1), round(float(ys[c]), 1)] for c in MP_FROM_COCO],
                        "conf": round(float(confs[k]), 3),
                    })
            out.append({"f": f, "people": people})
        batch_imgs.clear()
        batch_f.clear()

    f = 0
    assert proc.stdout is not None
    while True:
        buf = proc.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        if f % POSE_STRIDE == 0:
            batch_imgs.append(np.frombuffer(buf, np.uint8).reshape(ph, pw, 3))
            batch_f.append(f)
            if len(batch_imgs) == 32:
                flush()
        f += 1
        now = time.time()
        if now - last > 2:
            last = now
            report(0.66 + 0.34 * min(1.0, f / max(1, frames)), "Pose")
    flush()
    proc.wait()
    return out


@app.function(
    gpu=GPU,
    cpu=4.0,
    memory=12288,
    timeout=1800,
    scaledown_window=60,
    min_containers=0,
    volumes={"/weights": weights},
)
def detect(video_url: str, trim_sec: float | None, fps: float, width: int, height: int) -> dict:
    import json
    import subprocess
    import urllib.request

    call_id = modal.current_function_call_id() or "local"
    report = lambda p, phase: _report(call_id, p, phase)  # noqa: E731
    t0 = time.time()
    timings: dict[str, float] = {}

    report(0.0, "Downloading")
    os.makedirs("/tmp/rv", exist_ok=True)
    src = "/tmp/rv/source"
    req = urllib.request.Request(video_url, headers={"User-Agent": "rallyvision-detector"})
    with urllib.request.urlopen(req, timeout=300) as r, open(src, "wb") as fh:
        while chunk := r.read(1 << 20):
            fh.write(chunk)
    timings["download_s"] = round(time.time() - t0, 2)

    # ffmpeg autorotates by default, so decoded frames are in display orientation.
    report(0.05, "Decoding")
    t1 = time.time()
    trim = ["-t", f"{trim_sec:.3f}"] if trim_sec else []
    tn_video = "/tmp/rv/tn.mp4"
    _ffmpeg(["-i", src, *trim, "-vf", f"fps={fps},scale={TN_W}:{TN_H}:flags=area", "-fps_mode", "cfr",
             "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "yuv420p", tn_video])
    probe = subprocess.run(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v:0",
                            "-show_entries", "stream=nb_read_packets", "-of", "json", tn_video],
                           capture_output=True, text=True, check=True)
    frames = int(json.loads(probe.stdout)["streams"][0]["nb_read_packets"])
    timings["decode_s"] = round(time.time() - t1, 2)
    report(0.12, "TrackNet")

    t2 = time.time()
    tn, ip = _run_tracknet(tn_video, frames, report)
    timings["tracknet_s"] = round(time.time() - t2, 2)
    sx_tn, sy_tn = width / TN_W, height / TN_H
    tn_vis = {int(fi): bool(v) for fi, v in zip(tn["Frame"], tn["Visibility"])}
    # InpaintNet also "fills" the gaps between rallies and before the first detection. Keep its
    # points only inside short gaps bracketed by real TrackNet detections (occlusions, blur).
    raw_frames = sorted(fi for fi, v in tn_vis.items() if v)
    max_gap = max(1, round(MAX_INPAINT_GAP_S * fps))
    fillable = set()
    for a, b in zip(raw_frames, raw_frames[1:]):
        if 1 < b - a <= max_gap + 1:
            fillable.update(range(a + 1, b))
    shuttle = []
    for fi, x, y, v in zip(ip["Frame"], ip["X"], ip["Y"], ip["Visibility"]):
        fi = int(fi)
        raw = tn_vis.get(fi, False)
        if not v or not (raw or fi in fillable):
            continue
        shuttle.append({
            "f": fi,
            "t": round(fi / fps, 4),
            "x": round(float(x) * sx_tn, 1),
            "y": round(float(y) * sy_tn, 1),
            "conf": 1.0 if raw else 0.6,
            "interp": not raw,
        })

    t3 = time.time()
    pw = min(POSE_MAX_W, width) // 2 * 2
    ph = max(2, round(height * pw / width / 2) * 2)
    poses = _run_pose(src, fps, trim, pw, ph, width / pw, height / ph, frames, report)
    timings["pose_s"] = round(time.time() - t3, 2)
    timings["total_s"] = round(time.time() - t0, 2)
    report(1.0, "Done")
    return {"fps": fps, "frames": frames, "width": width, "height": height,
            "shuttle": shuttle, "poses": poses, "timings": timings,
            "engine": {"shuttle": "tracknetv3", "pose": POSE_WEIGHTS, "pose_stride": POSE_STRIDE}}


@app.function(secrets=[secret], scaledown_window=300, min_containers=0)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def api():
    import hmac

    from fastapi import FastAPI, Header, HTTPException
    from pydantic import BaseModel, Field

    web = FastAPI(title="rallyvision-detector")
    expected = os.environ["RALLYVISION_SECRET"]

    def check(token: str | None) -> None:
        if not token or not hmac.compare_digest(token, expected):
            raise HTTPException(status_code=401, detail="unauthorized")

    class DetectIn(BaseModel):
        video_url: str
        trim_sec: float | None = None
        fps: float = Field(gt=0, le=240)
        width: int = Field(gt=0, le=8192)
        height: int = Field(gt=0, le=8192)

    @web.post("/detect")
    async def start(body: DetectIn, x_rallyvision_secret: str | None = Header(default=None)):
        check(x_rallyvision_secret)
        if not body.video_url.startswith(("https://", "http://")):
            raise HTTPException(status_code=400, detail="video_url must be http(s)")
        call = await detect.spawn.aio(body.video_url, body.trim_sec, body.fps, body.width, body.height)
        return {"call_id": call.object_id}

    @web.get("/result/{call_id}")
    async def result(call_id: str, x_rallyvision_secret: str | None = Header(default=None)):
        check(x_rallyvision_secret)
        try:
            call = modal.FunctionCall.from_id(call_id)
            out = await call.get.aio(timeout=0)
        except TimeoutError:
            p = await progress_store.get.aio(call_id, None)
            return {"status": "running", "progress": (p or {}).get("progress", 0.0), "phase": (p or {}).get("phase")}
        except Exception as e:  # noqa: BLE001 - surface remote failures to the caller
            return {"status": "error", "error": f"{type(e).__name__}: {e}"[:2000]}
        return {"status": "done", "progress": 1.0, "result": out}

    @web.get("/health")
    async def health():
        return {"ok": True}

    return web


@app.local_entrypoint()
def smoke(video_url: str, fps: float = 30.0, width: int = 1280, height: int = 720, out: str = "detect.json", trim_sec: float = 0.0):
    import json

    t = time.time()
    res = detect.remote(video_url, trim_sec or None, fps, width, height)
    res["wall_s"] = round(time.time() - t, 2)
    with open(out, "w") as fh:
        json.dump(res, fh)
    print(f"shuttle={len(res['shuttle'])} pose_frames={len(res['poses'])} frames={res['frames']} timings={res['timings']} wall={res['wall_s']}s")
