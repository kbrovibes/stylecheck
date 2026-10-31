# What I could not do from the build environment — and how you unblock it

Everything below is **optional**: the app is fully functional without any of it.
Items are ordered by how much they improve the product.

## 1. Deploy to Vercel — ✅ lifted 2026-10-30

Live at **https://rallyvision-one.vercel.app** (project `rallyvision` in `kbrovibes-projects`; `rallyvision.vercel.app`
was already taken). Deployed with the CLI from `rallyvision/` (`vercel --prod`); `.vercelignore` keeps local files
out of the upload. The project is **not Git-connected**, so pushes don't redeploy it. To set that up, connect the repo
in Vercel → Settings → Git with Root Directory `rallyvision` and Production Branch `claude/rallyvision`; otherwise
redeploy with `vercel --prod` from `rallyvision/`.

## 1b. Cloud processing (Sandbox + Blob + Redis)

- Blob store `rallyvision-media` (public): created and linked. ✅
- Sandbox snapshot: created, `SANDBOX_SNAPSHOT_ID` set for production + development. ✅ Rebuild with
  `node --env-file=.env.local scripts/make-sandbox-snapshot.mjs` when the worker's runtime deps change.
- Upstash Redis `rallyvision-jobs`: provisioned and connected 2026-10-31. ✅ (Originally needed the account owner to accept Upstash's Marketplace terms once:
  (https://vercel.com/kbrovibes-projects/~/integrations/accept-terms/upstash), then
  `vercel integration add upstash/upstash-kv --name rallyvision-jobs`. Until then `/api/config` reports cloud as
  unavailable and the app falls back to on-device mode.)

## 2. AI coach notes (mocked today)

Without a key the `/api/insights` route returns deterministic template notes built from the stats
(`lib/ai/mock.ts`). To get real notes set **one** of these in Vercel → Settings → Environment Variables:

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Uses Claude (`claude-opus-5-5` by default, override with `ANTHROPIC_MODEL`). Structured JSON output, server-side refusal fallback enabled. |
| `GEMINI_API_KEY` | Uses Gemini (`gemini-2.5-flash` by default, override with `GEMINI_MODEL`). You already have a Gemini key in the Hanger Management project — it can be reused. |
| `AI_PROVIDER` | Force `anthropic`, `gemini` or `mock` regardless of keys. |

If a provider errors at runtime the route logs the error and falls back to the mock so the UI never breaks.

## 3. Neural shuttle tracker — TrackNetV3 (wired, no weights shipped in the browser)

The official checkpoints live on Google Drive (`TrackNetV3_ckpts.zip`, MIT licence) which the sandbox
could not reach, and `download.pytorch.org` / `huggingface.co` were blocked, so I could not export ONNX.
The engine (`lib/cv/tracknet.ts`) is complete and selectable once a model URL exists:

```bash
git clone https://github.com/qaz812345/TrackNetV3 && cd TrackNetV3
pip install torch onnx
# download + unzip TrackNetV3_ckpts.zip into ./ckpts (link in the repo README)
python - <<'PY'
import torch
from utils.general import get_model
ck = torch.load("ckpts/TrackNet_best.pt", map_location="cpu")
seq = ck["param_dict"]["seq_len"]
m = get_model("TrackNet", seq_len=seq, bg_mode=ck["param_dict"].get("bg_mode","")).eval()
m.load_state_dict(ck["model"])
torch.onnx.export(m, torch.zeros(1, 3*seq, 288, 512), "tracknetv3.onnx", opset_version=17,
                  input_names=["frames"], output_names=["heatmaps"])
PY
```

The checkpoints are now downloadable with `curl` (see `worker/README.md`) and live in the Modal volume
`rallyvision-weights`; the browser ONNX export below is still not done.

Upload `tracknetv3.onnx` somewhere with CORS (Vercel Blob, S3, or `public/models/`) and set
`NEXT_PUBLIC_TRACKNET_ONNX_URL=https://…/tracknetv3.onnx`. The UI then offers "TrackNetV3 neural tracker".
Note: onnxruntime-web loads its WASM from jsDelivr by default (see `tracknet.ts`); self-host it the same
way MediaPipe is self-hosted if you want zero third-party requests.

## 4. Modal GPU detector — ⚠️ built and tested; deploy blocked on a payment method (2026-10-31)

`worker/modal_app.py` is the `rallyvision-detector` Modal app (TrackNetV3 + YOLO11s-pose on a T4) that the
server worker calls in "Modal GPU" mode through `lib/worker/modal.ts`. Details and the API are in `worker/README.md`.

Done:
- Modal API token `rallyvision-cli` created (stored in `~/.modal.toml`, profile `kbrovibes`).
- Volume `rallyvision-weights` holds `TrackNet_best.pt` + `InpaintNet_best.pt` (the Google Drive zip downloads
  fine with `curl`); Secret `rallyvision-secret` holds `RALLYVISION_SECRET`.
- Vercel `RALLYVISION_SECRET` set for Production + Development (same value as the Modal secret).
- End-to-end CPU run on Modal (`RV_GPU=none modal run worker/modal_app.py::smoke …`) on the synthetic sample.

**Blocked:** `modal deploy` stops with "Please add a payment method to use T4 GPU functions". The workspace is on
Starter with $1 of credit. To lift it:

1. Modal → Settings → Usage & billing → add a payment method (the Starter plan still includes its monthly free credit).
2. From `rallyvision/`: `modal deploy worker/modal_app.py`. The endpoint is
   `https://kbrovibes--rallyvision-detector-api.modal.run`.
3. `printf %s https://kbrovibes--rallyvision-detector-api.modal.run | vercel env add MODAL_DETECT_URL production`
   (repeat for `development`), then `vercel --prod`. `MODAL_DETECT_URL` is deliberately unset until the
   endpoint is live, so the app doesn't offer a Modal mode that would fail.

To redeploy after code changes, run `modal deploy worker/modal_app.py` again. The URL stays the same.

## 5. Real-footage validation

I tested on a synthetic clip (`public/sample/synthetic-rally.mp4`, generated by `tests/make_synthetic.py`)
because every public-video host (YouTube, Wikimedia Commons, Pexels, archive.org) was blocked. The
classical tracker's thresholds (`lib/cv/shuttle.ts`: `threshold`, `minArea/maxArea`, tracker gates) were
tuned on that clip. Drop 2–3 of your real phone clips into `tests/fixtures/` and run the app on them; the
most likely knobs to touch are the motion threshold (lower for dim gyms) and `maxMisses` (higher for 60fps).

## 6. Fonts

I used the system font stack instead of `next/font/google` so the build never depends on Google Fonts being
reachable. Swap in a brand font in `app/layout.tsx` if you want.
