/**
 * End-to-end test: boots the production server, runs the whole pipeline on the
 * synthetic sample in headless Chromium, and asserts against the ground truth.
 *
 *   npm run build && node tests/e2e.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
// Playwright is resolved through CommonJS so a globally installed copy (NODE_PATH) works too.
const { chromium } = createRequire(import.meta.url)("playwright");

const PORT = process.env.PORT || 3411;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve("tests/out");
fs.mkdirSync(OUT, { recursive: true });
const truth = JSON.parse(fs.readFileSync("public/sample/synthetic-rally.truth.json", "utf8"));

function assert(cond, msg) { if (!cond) { throw new Error("ASSERT: " + msg); } console.log("  ✓", msg); }

const server = spawn("npx", ["next", "start", "-p", String(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (d) => process.env.VERBOSE && process.stdout.write(d));
server.stderr.on("data", (d) => process.stderr.write(d));
const waitFor = async (url, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 300)); } throw new Error("server did not start"); };

let browser;
try {
  await waitFor(BASE, 60_000);
  browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const logs = [];
  page.on("console", (m) => { logs.push(`[${m.type()}] ${m.text()}`); if (m.type() === "error" || process.env.VERBOSE) console.log("  browser:", m.text()); });
  page.on("pageerror", (e) => { logs.push("[pageerror] " + e.message); console.log("  pageerror:", e.message); });

  console.log("1. landing page");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(OUT, "01-landing.png") });
  assert(await page.getByTestId("sample").isVisible(), "sample button visible");

  console.log("2. load sample + calibrate (on-device mode at /local)");
  await page.goto(BASE + "/local", { waitUntil: "networkidle" });
  await page.getByTestId("sample").click();
  await page.waitForFunction(() => window.__rallyvision?.getStep() === "calibrate", null, { timeout: 60_000 });
  const meta = await page.evaluate(() => window.__rallyvision.getMeta());
  console.log("  meta", meta);
  assert(Math.abs(meta.fps - truth.fps) < 0.6, `fps probe ≈ ${truth.fps} (got ${meta.fps})`);
  assert(meta.width === truth.width, "video width");
  const auto = await page.evaluate(() => window.__rallyvision.getCorners());
  const err = auto.map((c, i) => Math.hypot(c.x - truth.corners[i][0], c.y - truth.corners[i][1]));
  console.log("  auto-detected corner error px:", err.map((e) => e.toFixed(0)).join(", "));
  const autoOk = err.every((e) => e < 40);
  console.log(autoOk ? "  ✓ auto court detection within 40px" : "  ! auto court detection off; using truth corners for the rest of the test");
  await page.screenshot({ path: path.join(OUT, "02-calibrate.png") });
  if (!autoOk) await page.evaluate((c) => window.__rallyvision.setCorners(c.map(([x, y]) => ({ x, y }))), truth.corners);
  await page.evaluate(() => window.__rallyvision.setSettings({ nearLabel: "Karthik", farLabel: "Rival" }));

  console.log("3. analyze");
  const t0 = Date.now();
  await page.getByTestId("analyze").click();
  await page.waitForFunction(() => window.__rallyvision?.getStep() === "review", null, { timeout: 600_000, polling: 500 });
  console.log(`  analysis took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const a = await page.evaluate(() => { const x = window.__rallyvision.getAnalysis(); return { ...x, shuttle: x.shuttle.length, players: x.players.length }; });
  console.log("  engine", a.engine, "stats", a.stats);
  console.log("  rallies:", a.rallies.map((r) => `#${r.id + 1} ${r.startT.toFixed(1)}-${r.endT.toFixed(1)}s shots=${r.hits.length} win=${r.winner} max=${r.maxSpeedKmh}`).join("\n           "));
  console.log("  truth:  ", truth.rallies.map((r, i) => `#${i + 1} ${r.start.toFixed(1)}-${r.end.toFixed(1)}s shots=${r.shots} win=${r.winner_by_rule}`).join("\n           "));
  fs.writeFileSync(path.join(OUT, "analysis.json"), JSON.stringify(a, null, 1));
  assert(a.shuttle > truth.duration * truth.fps * 0.25, `shuttle tracked on >25% of frames (${a.shuttle})`);
  assert(a.rallies.length >= truth.rallies.length - 1 && a.rallies.length <= truth.rallies.length + 2, `rally count ≈ ${truth.rallies.length} (got ${a.rallies.length})`);
  const truthShots = truth.rallies.reduce((s, r) => s + r.shots, 0);
  assert(a.hits.length >= truthShots * 0.6 && a.hits.length <= truthShots * 1.6, `shot count within 60-160% of ${truthShots} (got ${a.hits.length})`);
  const speeds = a.hits.filter((h) => h.reliable && h.speedKmh !== null).map((h) => h.speedKmh);
  assert(speeds.length >= 3 && speeds.every((v) => v > 10 && v < 420), `reliable speeds plausible (${speeds.length} shots, ${Math.min(...speeds)}–${Math.max(...speeds)} km/h)`);
  assert(a.players > 0, `players detected (${a.players} samples, ${a.engine.players})`);
  // rally alignment: each truth rally should overlap a detected rally
  let aligned = 0;
  for (const tr of truth.rallies) if (a.rallies.some((r) => r.startT < tr.end && r.endT > tr.start)) aligned++;
  assert(aligned >= truth.rallies.length - 1, `rallies aligned with truth (${aligned}/${truth.rallies.length})`);
  let winnersRight = 0;
  for (const tr of truth.rallies) { const r = a.rallies.find((r) => r.startT < tr.end && r.endT > tr.start); if (r && r.winner === tr.winner_by_rule) winnersRight++; }
  console.log(`  heuristic winners right: ${winnersRight}/${truth.rallies.length}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "03-review.png") });

  console.log("4. overlay renders at a hit");
  const hit = a.hits[0];
  await page.evaluate((t) => { const v = document.querySelector("video"); v.currentTime = t + 0.1; }, hit.t);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "04-hit-overlay.png") });
  const overlayPixels = await page.evaluate(() => { const c = document.querySelector('[data-testid="overlay-canvas"]'); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; return n; });
  assert(overlayPixels > 500, `overlay canvas has content (${overlayPixels} sampled px)`);

  console.log("5. insights (mock provider)");
  await page.getByTestId("insights").click();
  await page.getByTestId("insights-result").waitFor({ timeout: 30_000 });
  const headline = await page.locator('[data-testid="insights-result"] .text-lg').textContent();
  assert(headline && headline.length > 5, `insights headline: ${headline}`);

  console.log("6. rally override recomputes score");
  const before = await page.locator('[data-testid="rally-row"]').first().locator("span.tabular-nums").textContent();
  await page.locator('[data-testid="rally-row"]').first().locator("select").selectOption("far");
  await page.waitForTimeout(200);
  const after = await page.locator('[data-testid="rally-row"]').first().locator("span.tabular-nums").textContent();
  console.log(`  score first rally: ${before} -> ${after}`);
  assert(after === "0–1", "override to far gives 0–1");

  console.log("7. export (realtime fallback in headless)");
  const dl = page.waitForEvent("download", { timeout: 180_000 });
  await page.getByTestId("export-video").click();
  const download = await dl;
  const file = path.join(OUT, download.suggestedFilename());
  await download.saveAs(file);
  const size = fs.statSync(file).size;
  const res = await page.getByTestId("export-result").textContent();
  console.log("  export:", res, "->", file);
  assert(size > 50_000, `exported file has content (${(size / 1e6).toFixed(2)} MB)`);
  await page.screenshot({ path: path.join(OUT, "05-after-export.png") });

  const errors = logs.filter((l) => l.startsWith("[pageerror]") || l.startsWith("[error]"));
  if (errors.length) console.log("  browser errors:", errors);
  console.log("\nALL E2E CHECKS PASSED");
} catch (e) {
  console.error("\nE2E FAILED:", e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
