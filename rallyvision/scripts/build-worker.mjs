// Bundles the server worker (lib/worker/main.ts + the shared CV/overlay code) into one ESM file
// that the sandbox runs with plain `node`. Native/runtime deps stay external; they are installed
// in the sandbox snapshot (scripts/make-sandbox-snapshot.mjs).
import { build } from "esbuild";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
await build({
  entryPoints: [path.join(root, "lib/worker/main.ts")],
  outfile: path.join(root, "public/worker/worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  alias: { "@": root },
  external: ["@napi-rs/canvas", "@vercel/blob", "@upstash/redis", "@mediapipe/tasks-vision", "onnxruntime-web"],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});
console.log("worker bundle -> public/worker/worker.mjs");
