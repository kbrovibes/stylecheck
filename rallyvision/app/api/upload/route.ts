import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { checkKey } from "@/lib/jobs/store";
import { LIMITS } from "@/lib/jobs/types";

/** Issues client-upload tokens for a job's source video (phone -> Blob directly, no 4.5 MB function limit). */
export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const { jobId, editKey } = JSON.parse(clientPayload ?? "{}") as { jobId?: string; editKey?: string };
        if (!jobId || !(await checkKey(jobId, editKey ?? null))) throw new Error("Not allowed");
        if (!pathname.startsWith(`uploads/${jobId}/`)) throw new Error("Bad path");
        return {
          allowedContentTypes: ["video/*"],
          maximumSizeInBytes: LIMITS.maxUploadBytes,
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "upload error" }, { status: 400 });
  }
}
