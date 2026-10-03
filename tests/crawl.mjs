// Clicks through the portal looking for screens that break: every page and every button once, then random walks
// without reloading (state left over from the last screen shows up on transitions). Reports page errors and a
// portal that went blank or shows "stopped working". Skips anything that deletes, sends, saves, or logs out.
//   ./run.sh, then: node crawl.mjs <base> <who> [phone 0|1] [walks] [steps]
//   node crawl.mjs http://localhost:4401 demo-studio        the demo, studio's view (or demo-client)
//   node crawl.mjs http://localhost:4400 dana@harbor.test 1  a seeded person (test password), phone size
// Run it as staff and as each client role after changing a screen. It exits 1 if anything broke.
import { chromium } from "playwright-core";
import { chromiumPath } from "./lib/browser.mjs";
const [base, who, mobileArg, walksArg, stepsArg] = process.argv.slice(2);
const mobile = mobileArg === "1", WALKS = Number(walksArg || 6), STEPS = Number(stepsArg || 50);
const SKIP = /log ?out|sign ?out|delete|remove|decline|let them in|archive|turn off|stop syncing|reset password|resend invite|log out everywhere|back to the original|put it back|send the|disconnect|cancel request|mark paid|ask for a payment|approve|ask for changes|send$|upload|choose files|create|invite|save|add a|add note|reply|export|download|copy|pay|refresh|sync now|test it|change my password$|email a review reminder|confirm/i;
const b = await chromium.launch({ executablePath: chromiumPath() });
const problems = new Map();
function report(msg, where, path, stack) {
  const k = msg + " @ " + where.replace(/\?.*/, ""); if (problems.has(k)) return;
  problems.set(k, 1);
  console.log(`PROBLEM [${who}${mobile ? " phone" : ""}] ${msg}\n    at ${where}\n    after ${path}${stack ? "\n    " + stack : ""}`);
}
async function fresh() {
  const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|vimeo\.com|vimeocdn|akamaized|youtube\.com|wistia|loom\.com|frame\.io/, (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(4000);
  page.on("pageerror", (e) => report(e.message, page.url(), page.__path ? page.__path.slice(-6).join(" → ") : "", (e.stack || "").split("\n").slice(1, 3).join(" | ")));
  if (who.includes("@")) {
    await page.goto(base + "/signin");
    await page.locator('input[name="email"]').fill(who);
    await page.locator('input[name="password"]').fill("portal-test-pass");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.waitForTimeout(1500);
  }
  return page;
}
const start = who === "demo-studio" ? "/?view=studio" : "/";
async function load(page, url) {
  await page.goto(base + url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForFunction(() => { const r = document.getElementById("root"); return r && r.childElementCount && !document.querySelector(".boot-line"); }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(150);
}
async function crashed(page) {
  // A link that loads a whole new page (the demo's Log in) leaves the root empty for a moment: wait for it first.
  await page.waitForFunction(() => document.readyState === "complete" && document.getElementById("root")?.childElementCount, null, { timeout: 5000 }).catch(() => {});
  return page.evaluate(() => { const r = document.getElementById("root"); return !r || r.childElementCount === 0 || /didn’t finish loading|stopped working\./.test(document.body.innerText); }).catch(() => false);
}
async function clickables(page) {
  return page.evaluate((skip) => {
    const re = new RegExp(skip, "i");
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none" && !el.disabled; };
    const out = [];
    document.querySelectorAll("a[href], button, [role=tab], [role=menuitem], select, summary, input[type=checkbox]").forEach((el, i) => {
      if (!vis(el)) return;
      const label = (el.getAttribute("aria-label") || el.innerText || el.value || el.tagName).trim().replace(/\s+/g, " ").slice(0, 60);
      const href = el.getAttribute("href") || "";
      if (href && (/^(https?:|mailto:|tel:)/.test(href) && !href.startsWith(location.origin))) return;
      if (/^\/api\//.test(href) || el.hasAttribute("download")) return;
      if (re.test(label)) return;
      el.dataset.crawl = String(i);
      out.push({ id: String(i), label, tag: el.tagName });
    });
    return out;
  }, SKIP.source);
}
async function act(page, c) {
  const el = page.locator(`[data-crawl="${c.id}"]`).first();
  if (c.tag === "SELECT") {
    const opts = await el.evaluate((s) => [...s.options].map((o) => o.value));
    if (opts.length > 1) await el.selectOption(opts[Math.floor(Math.random() * opts.length)]);
  } else await el.click({ timeout: 2500 });
  await page.waitForTimeout(250);
  if (await page.locator('[role="dialog"]').count()) await page.keyboard.press("Escape").catch(() => {});
}
let clicks = 0; const t0 = Date.now();
// 1. Every page reachable from the start, every control once (reloading only when a click left the page).
{
  const page = await fresh();
  await load(page, start);
  const seen = new Set(), queue = [page.url().replace(base, "")];
  while (queue.length && seen.size < 45) {
    const url = queue.shift(); if (seen.has(url)) continue; seen.add(url);
    await load(page, url);
    const here = page.url();
    for (const l of await page.$$eval("a[href^='/']", (as) => as.map((a) => a.getAttribute("href")))) if (!seen.has(l) && !/^\/api\//.test(l) && !/signin|signup|logout/.test(l)) queue.push(l);
    const labels = (await clickables(page)).map((c) => c.label);
    const done = new Map();
    for (const label of labels) {
      if (page.url() !== here || await crashed(page)) await load(page, url);
      const list = await clickables(page);
      const nth = done.get(label) || 0; done.set(label, nth + 1);
      const c = list.filter((x) => x.label === label)[nth]; if (!c) continue;
      page.__path = [url, label];
      try { await act(page, c); clicks++; } catch { continue; }
      if (await crashed(page)) report("app unmounted", page.url(), url + " → " + label);
    }
    if (process.env.VERBOSE) console.log("page", url, labels.length, Math.round((Date.now() - t0) / 1000) + "s");
  }
  console.log(`pass 1: ${seen.size} pages, ${clicks} clicks`);
  await page.context().close();
}
// 2. Random walks without reloading.
for (let w = 0; w < WALKS; w++) {
  const page = await fresh();
  await load(page, start);
  page.__path = [];
  for (let s = 0; s < STEPS; s++) {
    const list = await clickables(page); if (!list.length) break;
    const c = list[Math.floor(Math.random() * list.length)];
    page.__path.push(c.label);
    try { await act(page, c); clicks++; } catch { continue; }
    if (await crashed(page)) { report("app unmounted", page.url(), page.__path.slice(-8).join(" → ")); break; }
  }
  await page.context().close();
}
console.log(`DONE ${who}${mobile ? " (phone)" : ""}: ${clicks} clicks, ${problems.size} distinct problems, ${Math.round((Date.now() - t0) / 1000)}s`);
await b.close();
process.exit(problems.size ? 1 : 0);
