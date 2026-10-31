import { NextResponse } from "next/server";
import { storeBackend } from "@/lib/jobs/store";

/** What this deployment can do, so the UI can grey out unavailable options. */
export async function GET() {
  const cloud = !!process.env.SANDBOX_SNAPSHOT_ID && !!process.env.BLOB_READ_WRITE_TOKEN && storeBackend === "redis";
  return NextResponse.json({
    ai: { anthropic: !!process.env.ANTHROPIC_API_KEY, gemini: !!process.env.GEMINI_API_KEY },
    processing: {
      cloud,
      // the GPU detector runs inside the same Sandbox job, so it needs the cloud pipeline too
      modal: cloud && !!process.env.MODAL_DETECT_URL && !!process.env.RALLYVISION_SECRET,
    },
    storage: { blob: !!process.env.BLOB_READ_WRITE_TOKEN, jobs: storeBackend },
    tracknet: !!process.env.NEXT_PUBLIC_TRACKNET_ONNX_URL,
  }, { headers: { "cache-control": "no-store" } });
}
