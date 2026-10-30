import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE || "http://localhost:3412";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("console", (m) => console.log("  browser:", m.type(), m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("  pageerror:", e.message));
await page.goto(BASE, { waitUntil: "networkidle" });
console.log("landing ok");
await page.getByTestId("sample").click();
const t0 = Date.now();
for (;;) {
  const step = await page.evaluate(() => window.__rallyvision?.getStep());
  const txt = await page.evaluate(() => document.querySelector(".card")?.textContent?.slice(0, 200));
  console.log(((Date.now() - t0) / 1000).toFixed(0) + "s", step, "|", txt);
  if (step === "calibrate" || Date.now() - t0 > 90_000) break;
  await page.waitForTimeout(3000);
}
console.log("meta", await page.evaluate(() => window.__rallyvision?.getMeta()));
console.log("corners", JSON.stringify(await page.evaluate(() => window.__rallyvision?.getCorners())));
await page.screenshot({ path: "tests/out/dbg-calibrate.png" });
if (process.env.ANALYZE) {
  if (process.env.NOPOSE) await page.evaluate(() => window.__rallyvision.setSettings({ usePose: false }));
  await page.getByTestId("analyze").click();
  const t1 = Date.now();
  for (;;) {
    const step = await page.evaluate(() => window.__rallyvision?.getStep());
    const txt = await page.evaluate(() => document.querySelector(".card")?.textContent?.slice(0, 160));
    console.log(((Date.now() - t1) / 1000).toFixed(0) + "s", step, "|", txt);
    if (step === "review" || step === "calibrate" || Date.now() - t1 > 480_000) break;
    await page.waitForTimeout(10_000);
  }
  const a = await page.evaluate(() => { const x = window.__rallyvision.getAnalysis(); return x && { engine: x.engine, stats: x.stats, shuttle: x.shuttle.length, players: x.players.length, rallies: x.rallies.map(r => [r.startT, r.endT, r.hits.length, r.winner, r.maxSpeedKmh]), hits: x.hits.length }; });
  console.log(JSON.stringify(a, null, 1));
  await page.screenshot({ path: "tests/out/dbg-review.png" });
}
await browser.close();
