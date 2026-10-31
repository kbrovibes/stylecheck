import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { listJobs, read, write } from "@/lib/jobs/store";
import { ACTIVE_STATES } from "@/lib/jobs/types";

/** Daily: fail jobs that stopped reporting, delete raw uploads of failed jobs after 7 days. */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = Date.now();
  let timedOut = 0, purged = 0;
  for (const j of await listJobs(500)) {
    const s = await read(j.id);
    if (!s) continue;
    if (ACTIVE_STATES.includes(j.state) && now - j.heartbeatAt > 2 * 3600e3) {
      await write({ ...s, job: { ...j, state: "failed", phase: "Timed out", error: "Stopped reporting progress for over 2 hours.", updatedAt: now } });
      timedOut++;
    } else if ((j.state === "failed" || j.state === "cancelled") && j.upload?.url && now - j.updatedAt > 7 * 86400e3) {
      await del(j.upload.url).catch(() => {});
      await write({ ...s, job: { ...j, upload: { ...j.upload, url: "" }, updatedAt: now } });
      purged++;
    }
  }
  return NextResponse.json({ timedOut, purged });
}
