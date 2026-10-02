// Screenshots of every portal screen, desktop (1440) and phone (390), listing any console errors.
// Usage (servers from run.sh): node shots.mjs [outdir=.work/shots] [only screens whose name contains this]
import { chromium } from "playwright-core";
import { chromiumPath } from "./lib/browser.mjs";
import fs from "node:fs";
const OUT = process.argv[2] || new URL("./.work/shots", import.meta.url).pathname, ONLY = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const B = "http://localhost:4400";
const browser = await chromium.launch({ executablePath: chromiumPath() });
const errs = [];
async function ctxFor(vp, mobile) {
  const c = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  await c.route(/player\.vimeo\.com\/video|i\.vimeocdn\.com/, (r) => r.fulfill({ contentType: "text/html", body: "<body style='margin:0;background:#123'></body>" }));
  await c.route(/player\.vimeo\.com\/api\/player\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  return c;
}
async function shoot(c, path, name, wait = 1200, act) {
  if (ONLY && !name.includes(ONLY)) return;
  const p = await c.newPage();
  p.on("pageerror", (e) => errs.push(name + ": " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push(name + ": console " + m.text()); });
  await p.goto(B + path, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(wait);
  if (act) await act(p);
  // Scroll the whole page once, as a person would, so scroll-triggered reveals fire before the capture.
  await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await p.close();
}
async function login(c, email, pass = "portal-test-pass") {
  const r = await c.request.post(B + "/api/session", { data: { action: "login", email, password: pass } });
  if (!r.ok()) throw new Error("login failed " + (await r.text()));
}
for (const [tag, vp, mobile] of [["d", { width: 1440, height: 900 }, false], ["m", { width: 390, height: 844 }, true]]) {
  const anon = await ctxFor(vp, mobile);
  await shoot(anon, "/", tag + "-signin", 1500);
  await shoot(anon, "/demo", tag + "-demo-home", 1500);
  await anon.close();
  const dana = await ctxFor(vp, mobile); await login(dana, "dana@harbor.test");
  for (const [path, name] of [["/", "home"], ["/projects/cccccccc-0000-4000-8000-000000000001", "project"], ["/review", "review"], ["/films", "films"], ["/films/cccccccc-0000-4000-8000-000000000001/5101", "film"], ["/files", "files"], ["/messages", "messages"], ["/account", "account"]]) await shoot(dana, path, `${tag}-client-${name}`);
  await dana.close();
  const admin = await ctxFor(vp, mobile); await login(admin, "alexis@gotit2work.com");
  for (const [path, name] of [["/", "home"], ["/studio", "studio-projects"], ["/studio/projects/cccccccc-0000-4000-8000-000000000001", "studio-project"], ["/studio/people", "studio-people"], ["/studio/clients", "studio-clients"], ["/studio/vimeo", "studio-vimeo"]]) await shoot(admin, path, `${tag}-admin-${name}`);
  await admin.close();
}
await browser.close();
console.log(errs.length ? "ERRORS:\n" + [...new Set(errs)].join("\n") : "no errors");
