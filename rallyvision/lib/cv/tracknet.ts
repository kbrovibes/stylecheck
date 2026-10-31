/**
 * TrackNet (V2/V3) ONNX shuttle engine — optional neural tracker.
 *
 * Status: WIRED BUT NOT SHIPPED WITH WEIGHTS. The official TrackNetV3
 * checkpoints are PyTorch files on Google Drive, which this build environment
 * could not reach, so no ONNX export is bundled. Set
 * NEXT_PUBLIC_TRACKNET_ONNX_URL to an exported model and this engine becomes
 * selectable in the UI. See docs/UNBLOCK.md for the export recipe.
 *
 * Expected model contract (TrackNetV2/V3 "TrackNet" module):
 *   input  [1, 3*seqLen, 288, 512] float32 RGB in 0..1, frames oldest->newest
 *   output [1, seqLen, 288, 512]   heatmap logits/probabilities per frame
 * seqLen is read from the model's input shape when available (3 for V2, 8 for V3).
 */

import type { Candidate, ShuttleEngine, Box } from "@/lib/cv/shuttle";

const TN_W = 512, TN_H = 288;

type OrtSession = {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>;
  inputMetadata?: ReadonlyArray<{ shape?: ReadonlyArray<number | string> }>;
};

export class TrackNetEngine implements ShuttleEngine {
  readonly name = "tracknet" as const;
  private frames: Float32Array[] = [];
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tmp: HTMLCanvasElement;
  private session: OrtSession;
  private ort: { Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown };
  readonly seqLen: number;
  readonly width: number;
  readonly height: number;
  private constructor(session: OrtSession, ort: { Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown }, seqLen: number, width: number, height: number) {
    this.session = session;
    this.ort = ort;
    this.seqLen = seqLen;
    this.width = width;
    this.height = height;
    this.canvas = document.createElement("canvas");
    this.canvas.width = TN_W; this.canvas.height = TN_H;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    this.tmp = document.createElement("canvas");
  }

  static async create(modelUrl: string, width: number, height: number): Promise<TrackNetEngine> {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";
    const session = (await ort.InferenceSession.create(modelUrl, { executionProviders: ["webgpu", "wasm"] })) as unknown as OrtSession;
    let seqLen = 3;
    const shape = session.inputMetadata?.[0]?.shape;
    if (shape && typeof shape[1] === "number" && shape[1] % 3 === 0) seqLen = shape[1] / 3;
    return new TrackNetEngine(session, ort as unknown as TrackNetEngine["ort"], seqLen, width, height);
  }

  async detect(frame: { image: ImageData; width: number; height: number }, exclude: Box[]): Promise<Candidate[]> {
    this.tmp.width = frame.width; this.tmp.height = frame.height;
    this.tmp.getContext("2d")!.putImageData(frame.image, 0, 0);
    this.ctx.drawImage(this.tmp, 0, 0, TN_W, TN_H);
    const d = this.ctx.getImageData(0, 0, TN_W, TN_H).data;
    const plane = TN_W * TN_H;
    const chw = new Float32Array(3 * plane);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      chw[j] = d[i] / 255; chw[plane + j] = d[i + 1] / 255; chw[2 * plane + j] = d[i + 2] / 255;
    }
    this.frames.push(chw);
    if (this.frames.length > this.seqLen) this.frames.shift();
    if (this.frames.length < this.seqLen) return [];
    const input = new Float32Array(3 * this.seqLen * plane);
    this.frames.forEach((f, k) => input.set(f, k * 3 * plane));
    const tensor = new this.ort.Tensor("float32", input, [1, 3 * this.seqLen, TN_H, TN_W]);
    const out = await this.session.run({ [this.session.inputNames[0]]: tensor });
    const hm = out[this.session.outputNames[0]];
    const last = hm.dims[1] - 1;
    const off = last * plane;
    let best = -Infinity, bi = -1;
    for (let i = 0; i < plane; i++) if (hm.data[off + i] > best) { best = hm.data[off + i]; bi = i; }
    const prob = best > 1 || best < 0 ? 1 / (1 + Math.exp(-best)) : best;
    if (bi < 0 || prob < 0.5) return [];
    const x = ((bi % TN_W) + 0.5) * (this.width / TN_W), y = (Math.floor(bi / TN_W) + 0.5) * (this.height / TN_H);
    for (const b of exclude) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return [];
    return [{ x, y, area: 9, contrast: 60, score: prob, w: 3, h: 3 }];
  }
}

export function trackNetModelUrl(): string | null {
  const u = process.env.NEXT_PUBLIC_TRACKNET_ONNX_URL;
  return u && u.length > 0 ? u : null;
}
