import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives in a sub-folder of a larger repo; without an explicit root
  // Turbopack walks up to the parent lockfile and tries to compile its files.
  turbopack: { root: path.resolve(process.cwd()) },
  // onnxruntime-web ships worker + wasm bundles that must not be resolved by
  // the server build; it is only ever imported dynamically on the client.
  serverExternalPackages: ["onnxruntime-web"],
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
      {
        // WASM + model files are immutable; cache hard.
        source: "/(mediapipe|models|sample)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
