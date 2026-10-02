// Prints manual.html to Nobleman-Portal-Manual.pdf (US Letter), and refuses to if any page's content doesn't fit.
// Uses the tests' playwright-core: run `npm install` in tests/ once, then `node docs/manual/build.mjs` from the
// repository root. Chromium: CHROMIUM_PATH, the cloud containers' copy, or `npx playwright install chromium`.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromiumPath } from "../../tests/lib/browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../tests/package.json"));
const { chromium } = require("playwright-core");
const out = path.join(here, process.argv[2] || "Nobleman-Portal-Manual.pdf");

const browser = await chromium.launch({ executablePath: chromiumPath() });
try {
  const page = await browser.newPage();
  await page.emulateMedia({ media: "print" });
  await page.goto(pathToFileURL(path.join(here, "manual.html")).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  // Every image loaded, and nothing cut off: each page's body must hold its content.
  const broken = await page.$$eval("img", (els) => els.filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute("src")));
  const over = await page.$$eval(".page", (pages) => pages.flatMap((p, i) => {
    const b = p.querySelector(".body");
    if (!b) return [];
    const extra = b.scrollHeight - b.clientHeight;
    return extra > 1 ? [`page ${i + 1} (${p.dataset.title}): ${extra}px too long`] : [];
  }));
  if (broken.length || over.length) {
    for (const s of broken) console.error(`missing image: ${s}`);
    for (const s of over) console.error(s);
    process.exitCode = 1;
  } else {
    await page.pdf({ path: out, width: "8.5in", height: "11in", printBackground: true, preferCSSPageSize: true });
    const n = await page.$$eval(".page", (p) => p.length);
    console.log(`${path.relative(process.cwd(), out)}: ${n} pages, ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
  }
} finally {
  await browser.close();
}
