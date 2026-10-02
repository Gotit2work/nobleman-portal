// Prints manual.html to Nobleman-Portal-Manual.pdf (US Letter), built to open fast and look sharp in Acrobat.
// Uses the tests' playwright-core: run `npm install` in tests/ once, then `node docs/manual/build.mjs` from the
// repository root. Chromium: CHROMIUM_PATH, the cloud containers' copy, or `npx playwright install chromium`.
//
// It refuses to write the PDF when:
//   - an image is missing, or a page's content doesn't fit;
//   - a font would be embedded as drawn shapes ("Type3", which Chrome does with variable fonts): use one fixed-weight
//     file per weight in fonts/ (fonts.css says how they were made);
//   - something would need a transparency mask (a see-through gradient or a CSS filter).
// Photos with a gradient over them (the cover and each chapter band) are flattened into one image first, so the
// PDF has no transparency to work out. If qpdf is installed, the PDF is also saved for fast opening ("Fast Web View").
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromiumPath } from "../../tests/lib/browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../tests/package.json"));
const { chromium } = require("playwright-core");
const out = path.join(here, process.argv[2] || "Nobleman-Portal-Manual.pdf");
const fail = (lines) => { for (const s of lines) console.error(s); process.exitCode = 1; };

const browser = await chromium.launch({ executablePath: chromiumPath() });
try {
  // 96 px per inch × 2.5 = 240 dpi for the flattened photos.
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2.5 });
  await page.goto(pathToFileURL(path.join(here, "manual.html")).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  // Every image loaded, and nothing cut off: each page's body must hold its content.
  await page.emulateMedia({ media: "print" });
  const broken = await page.$$eval("img", (els) => els.filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute("src")));
  const over = await page.$$eval(".page", (pages) => pages.flatMap((p, i) => {
    const b = p.querySelector(".body");
    if (!b) return [];
    const extra = b.scrollHeight - b.clientHeight;
    return extra > 1 ? [`page ${i + 1} (${p.dataset.title}): ${extra}px too long`] : [];
  }));
  if (broken.length || over.length) {
    fail([...broken.map((s) => `missing image: ${s}`), ...over]);
  } else {
    // Flatten each photo and its gradient into one JPEG, exactly as it looks. Everything else on that page (titles,
    // the logo, the frame) is hidden for the moment, so it isn't baked into the photo and printed twice.
    const flats = await page.$$(".cover .photo, .cband");
    for (const el of flats) {
      await el.evaluate((e) => {
        for (const x of e.closest(".page").querySelectorAll("*")) if (x !== e && !x.contains(e)) { x.dataset.vis = x.style.visibility; x.style.visibility = "hidden"; }
      });
      const jpeg = await el.screenshot({ type: "jpeg", quality: 90, animations: "disabled" });
      await el.evaluate((e, data) => {
        e.style.backgroundImage = `url(data:image/jpeg;base64,${data})`;
        e.style.backgroundSize = "100% 100%";
        e.style.backgroundPosition = "center";
        e.classList.add("flat");
        for (const x of e.closest(".page").querySelectorAll("[data-vis]")) { x.style.visibility = x.dataset.vis; delete x.dataset.vis; }
      }, jpeg.toString("base64"));
    }
    await page.evaluate(() => {
      // Bookmarks: chapters and page titles only, not every small heading on a card.
      for (const h of document.querySelectorAll("h3")) h.setAttribute("role", "none");
      return document.fonts.ready;
    });
    // Tagged, with bookmarks from the chapter and section headings, so Acrobat can navigate and read it aloud.
    await page.pdf({ path: out, width: "8.5in", height: "11in", printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });

    // What Acrobat struggles with: fonts drawn as shapes, and transparency masks.
    const pdf = fs.readFileSync(out).toString("latin1");
    const type3 = (pdf.match(/\/Subtype\s*\/Type3/g) || []).length;
    const masks = (pdf.match(/\/Type\s*\/Mask/g) || []).length;
    if (type3 || masks) {
      fs.rmSync(out);
      fail([
        type3 ? `${type3} font${type3 === 1 ? "" : "s"} would be drawn as shapes (Type3). A variable font, or a character none of the fonts has, is the usual cause: see fonts.css.` : null,
        masks ? `${masks} transparency mask${masks === 1 ? "" : "s"}: a see-through gradient or a CSS filter outside the flattened photos. Use solid colors.` : null,
        "Nothing was written.",
      ].filter(Boolean));
    } else {
      let fast = "";
      try {
        execFileSync("qpdf", ["--linearize", "--object-streams=generate", "--replace-input", out], { stdio: "ignore" });
        fast = ", saved for fast opening";
      } catch { fast = " (install qpdf to also save it for fast opening)"; }
      const n = await page.$$eval(".page", (p) => p.length);
      console.log(`${path.relative(process.cwd(), out)}: ${n} pages, ${(fs.statSync(out).size / 1048576).toFixed(1)} MB, real fonts, no transparency${fast}.`);
    }
  }
} finally {
  await browser.close();
}
