// Builds the Vercel Sandbox snapshot the job worker boots from: Ubuntu + Node 24 + ffmpeg +
// Inter font + the worker's runtime packages. Re-run when those change (not on every deploy:
// the worker bundle itself is copied in per job).
//
//   node --env-file=.env.local scripts/make-sandbox-snapshot.mjs
//   -> prints SANDBOX_SNAPSHOT_ID; set it on Vercel (vercel env add SANDBOX_SNAPSHOT_ID production)
import { Sandbox } from "@vercel/sandbox";

const PKGS = ["@napi-rs/canvas@1.1.0", "@vercel/blob@2.8.2", "@upstash/redis@1"];

const sb = await Sandbox.create({ image: "vercel/sandbox/node:24", resources: { vcpus: 2 }, timeout: 20 * 60_000, persistent: false });
const run = async (label, opts) => {
  const r = await sb.runCommand(opts);
  if (r.exitCode !== 0) throw new Error(`${label} failed: ${(await r.stderr()).slice(-2000)}`);
  console.log(`✓ ${label}`);
};
try {
  await run("apt ffmpeg + fonts", { cmd: "bash", args: ["-c", "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg fonts-inter >/dev/null"], sudo: true });
  await run("npm runtime deps", { cmd: "bash", args: ["-c", `mkdir -p /vercel/sandbox/rt && cd /vercel/sandbox/rt && npm init -y >/dev/null && npm i --no-audit --no-fund ${PKGS.join(" ")} >/dev/null`] });
  await run("sanity", { cmd: "bash", args: ["-c", "ffmpeg -version | head -1 && cd /vercel/sandbox/rt && node -e \"require('@napi-rs/canvas')\""] });
  const snap = await sb.snapshot({ expiration: 0 });
  console.log(`SANDBOX_SNAPSHOT_ID=${snap.snapshotId}`);
} catch (e) {
  await sb.stop();
  throw e;
}
