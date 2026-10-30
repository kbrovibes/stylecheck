"""
Generate a synthetic badminton clip for end-to-end tests and as the in-app sample.

Camera behind the near baseline; perspective court drawn with a real homography;
two blocky players; a white shuttle flying parabolic shots between them, with
rally pauses. Ground-truth (corners, rally count, hits) is written next to the
video as JSON so the e2e test can assert against it.

Usage: python3 tests/make_synthetic.py public/sample/synthetic-rally.mp4
"""
import json, math, random, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H, FPS = 1280, 720, 30
COURT_L, COURT_W = 13.4, 6.1
# image corners: near-left, near-right, far-right, far-left
CORNERS = [(150, 690), (1130, 690), (860, 235), (420, 235)]
random.seed(7)

def homography(src, dst):
    A, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        A.append([-x, -y, -1, 0, 0, 0, u * x, u * y]); b.append(-u)
        A.append([0, 0, 0, -x, -y, -1, v * x, v * y]); b.append(-v)
    h = np.linalg.solve(np.array(A, float), np.array(b, float))
    return np.append(h, 1).reshape(3, 3)

court_pts = [(0, 0), (COURT_W, 0), (COURT_W, COURT_L), (0, COURT_L)]
H_c2i = homography(court_pts, CORNERS)  # court -> image

def to_img(cx, cy, h=0.0):
    """court metres (+ height in metres) -> image px. Height is faked as a vertical offset
    scaled by local perspective (good enough for a synthetic clip)."""
    v = H_c2i @ np.array([cx, cy, 1.0])
    x, y = v[0] / v[2], v[1] / v[2]
    v2 = H_c2i @ np.array([cx, cy + 1.0, 1.0])
    mpp = abs(v2[1] / v2[2] - y)  # px per metre along court at this depth
    return x, y - h * mpp * 1.6

def lines():
    L, Wd, sw = COURT_L, COURT_W, 5.18
    sx = (Wd - sw) / 2; net = L / 2; ss = 1.98; dl = 0.76
    return [((0, 0), (Wd, 0)), ((0, L), (Wd, L)), ((0, 0), (0, L)), ((Wd, 0), (Wd, L)), ((sx, 0), (sx, L)), ((Wd - sx, 0), (Wd - sx, L)),
            ((0, net - ss), (Wd, net - ss)), ((0, net + ss), (Wd, net + ss)), ((0, dl), (Wd, dl)), ((0, L - dl), (Wd, L - dl)),
            ((Wd / 2, 0), (Wd / 2, net - ss)), ((Wd / 2, net + ss), (Wd / 2, L))]

# background (static): floor gradient + court + walls
bg = Image.new("RGB", (W, H), (38, 52, 70))
d = ImageDraw.Draw(bg)
d.rectangle([0, 0, W, 260], fill=(70, 72, 80))
d.polygon([CORNERS[0], CORNERS[1], CORNERS[2], CORNERS[3]], fill=(32, 110, 84))
for i in range(0, W, 7):  # subtle floor texture
    d.line([(i, 260), (i + 120, H)], fill=(36, 116, 90), width=1)
d.polygon([CORNERS[0], CORNERS[1], CORNERS[2], CORNERS[3]], outline=None)
for (p, q) in lines():
    a = to_img(*p); b = to_img(*q)
    d.line([a, b], fill=(240, 240, 240), width=3)
# net
nl = to_img(0, COURT_L / 2); nr = to_img(COURT_W, COURT_L / 2); nh = 1.55
d.line([nl, to_img(0, COURT_L / 2, nh)], fill=(200, 200, 200), width=3)
d.line([nr, to_img(COURT_W, COURT_L / 2, nh)], fill=(200, 200, 200), width=3)
d.line([to_img(0, COURT_L / 2, nh), to_img(COURT_W, COURT_L / 2, nh)], fill=(230, 230, 230), width=2)
for k in range(1, 6):
    d.line([to_img(0, COURT_L / 2, nh * k / 6), to_img(COURT_W, COURT_L / 2, nh * k / 6)], fill=(120, 130, 140), width=1)
bg_np = np.array(bg).astype(np.int16)

# rallies: list of shots; each shot: (from_side, start court xy, end court xy, duration s, apex h)
def make_rallies():
    rallies = []
    t = 1.0
    specs = [5, 7, 3, 6]  # shots per rally
    for n in specs:
        shots = []
        side = "near"
        pos = {"near": (random.uniform(2.0, 4.0), random.uniform(1.5, 3.5)), "far": (random.uniform(2.0, 4.0), random.uniform(9.5, 12.0))}
        for i in range(n):
            frm = pos[side]
            other = "far" if side == "near" else "near"
            last = i == n - 1
            if last:
                # landing point: in or out
                out = random.random() < 0.35
                ty = random.uniform(8.0, 13.0) if other == "far" else random.uniform(0.4, 5.4)
                tx = random.uniform(-0.6, -0.2) if out else random.uniform(0.6, 5.5)
                to = (tx, ty)
                apex = random.uniform(0.3, 2.0); dur = random.uniform(0.45, 0.8); kind = "land"
            else:
                to = (random.uniform(1.0, 5.1), random.uniform(9.0, 12.6) if other == "far" else random.uniform(0.8, 4.4))
                apex = random.uniform(1.0, 4.5); dur = random.uniform(0.55, 1.0); kind = "shot"
                pos[other] = to
            shots.append({"t": t, "by": side, "from": frm, "to": to, "dur": dur, "apex": apex, "kind": kind})
            t += dur
            side = other
        rallies.append({"start": shots[0]["t"], "end": t + 0.3, "shots": shots})
        t += random.uniform(2.2, 3.2)
    return rallies, t + 1.0

rallies, total = make_rallies()
frames = int(total * FPS)

def shuttle_at(time):
    for r in rallies:
        for s in r["shots"]:
            if s["t"] <= time < s["t"] + s["dur"]:
                k = (time - s["t"]) / s["dur"]
                cx = s["from"][0] + (s["to"][0] - s["from"][0]) * k
                cy = s["from"][1] + (s["to"][1] - s["from"][1]) * k
                h0 = 1.4 if s["kind"] else 1.4
                hend = 0.0 if s["kind"] == "land" else 1.3
                h = h0 + (hend - h0) * k + s["apex"] * 4 * k * (1 - k)
                return cx, cy, h
    return None

def player_at(time, side):
    # players stand where their last/next shot is
    base = (3.05, 2.2) if side == "near" else (3.05, 11.2)
    best = None
    for r in rallies:
        for s in r["shots"]:
            if s["by"] == side:
                if s["t"] <= time + 0.6:
                    best = s["from"]
    if best is None:
        return base
    bx, by = best
    bx += 0.12 * math.sin(time * 2.1); by += 0.06 * math.sin(time * 1.3)
    return bx, by

def draw_player(d, cx, cy, time, col):
    fx, fy = to_img(cx, cy)
    hx, hy = to_img(cx, cy, 1.75)
    hgt = fy - hy
    w = hgt * 0.32
    swing = math.sin(time * 6.0) * 0.25
    # legs
    d.line([(fx - w * 0.25, fy), (fx - w * 0.1, fy - hgt * 0.45)], fill=(30, 30, 40), width=max(3, int(w * 0.22)))
    d.line([(fx + w * 0.25, fy), (fx + w * 0.1, fy - hgt * 0.45)], fill=(30, 30, 40), width=max(3, int(w * 0.22)))
    # torso
    d.rounded_rectangle([fx - w / 2, fy - hgt * 0.78, fx + w / 2, fy - hgt * 0.42], radius=int(w * 0.3), fill=col)
    # head
    r = hgt * 0.09
    d.ellipse([fx - r, hy, fx + r, hy + 2 * r], fill=(214, 170, 130))
    # arm + racket
    ax, ay = fx + w * 0.55, fy - hgt * 0.72
    ex, ey = ax + math.cos(swing) * w * 0.8, ay - math.sin(swing + 0.8) * hgt * 0.35
    d.line([(ax, ay), (ex, ey)], fill=(214, 170, 130), width=max(3, int(w * 0.18)))
    d.ellipse([ex - w * 0.22, ey - w * 0.3, ex + w * 0.22, ey + w * 0.3], outline=(220, 40, 40), width=2)

out_path = sys.argv[1] if len(sys.argv) > 1 else "public/sample/synthetic-rally.mp4"
proc = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-preset", "medium", "-movflags", "+faststart", out_path], stdin=subprocess.PIPE)
rng = np.random.default_rng(1)
truth_frames = []
for f in range(frames):
    time = f / FPS
    img = Image.fromarray(np.clip(bg_np + rng.integers(-3, 4, size=bg_np.shape, dtype=np.int16), 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    # far player first (depth order)
    fx, fy = player_at(time, "far"); draw_player(d, fx, fy, time, (240, 120, 40))
    nx, ny = player_at(time, "near"); draw_player(d, nx, ny, time, (40, 160, 230))
    s = shuttle_at(time)
    truth_frames.append([round(float(v), 1) for v in to_img(s[0], s[1], s[2])] if s else None)
    if s:
        x, y = to_img(s[0], s[1], s[2])
        r = 4.5 + (1.0 - s[1] / COURT_L) * 3.0
        d.ellipse([x - r, y - r, x + r, y + r], fill=(252, 252, 240))
        d.ellipse([x - r * 0.5, y - r * 0.5, x + r * 0.5, y + r * 0.5], fill=(255, 255, 255))
    proc.stdin.write(img.tobytes())
proc.stdin.close(); proc.wait()

truth = {
    "width": W, "height": H, "fps": FPS, "duration": frames / FPS, "corners": CORNERS,
    "shuttle": truth_frames,
    "hits": [{"t": sh["t"], "by": sh["by"], "pos": [round(float(v), 1) for v in to_img(sh["from"][0], sh["from"][1], 1.4)]} for r in rallies for sh in r["shots"]],
    "rallies": [{"start": r["start"], "end": r["end"], "shots": len(r["shots"]),
                 "landing": r["shots"][-1]["to"], "winner_by_rule": ("near" if (r["shots"][-1]["by"] == "near") == (0 <= r["shots"][-1]["to"][0] <= COURT_W) else "far")} for r in rallies],
}
json.dump(truth, open(out_path.rsplit(".", 1)[0] + ".truth.json", "w"), indent=1)
print("wrote", out_path, frames, "frames", f"{frames / FPS:.1f}s", "rallies", len(rallies))
