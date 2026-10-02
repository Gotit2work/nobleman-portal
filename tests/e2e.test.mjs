// End-to-end UI tests: a real browser signs in and clicks through the portal against the local servers.
// Needs ./run.sh first (fresh databases: the tests change data). Usage: node e2e.test.mjs
import { chromium } from "playwright-core";
import { chromiumPath } from "./lib/browser.mjs";

const B = "http://localhost:4400", DEMO = "http://localhost:4401", FRESH = "http://localhost:4402";
const PASS = "portal-test-pass";
let pass = 0, fail = 0;
const check = (l, c, x = "") => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + l + (!c && x ? "  " + String(x).slice(0, 300) : "")); };
const pageErrors = [];

const browser = await chromium.launch({ executablePath: chromiumPath() });

/** Browser uploads go to vercel.com/api/blob; send them to the fake Blob API on the same local server. */
async function proxyBlob(route) {
  const req = route.request();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,PUT,POST,DELETE,OPTIONS", "access-control-expose-headers": "*" };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const target = req.url().replace("https://vercel.com/api/blob", B + "/__blob");
  const r = await fetch(target, { method: req.method(), headers: { ...req.headers(), host: undefined }, body: req.postDataBuffer() || undefined });
  return route.fulfill({ status: r.status, headers: { ...cors, "content-type": r.headers.get("content-type") || "application/json" }, body: Buffer.from(await r.arrayBuffer()) });
}

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|vimeocdn\.com/, (r) => r.abort());
  await ctx.route("https://vercel.com/api/blob**", proxyBlob);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.setDefaultTimeout(8000);
  return page;
}
const nav = (page, name) => page.locator("nav.rail").getByRole("link", { name, exact: true });
const visible = (loc) => loc.first().isVisible().catch(() => false);
const waitText = async (page, text, ms = 8000) => { try { await page.getByText(text).first().waitFor({ state: "visible", timeout: ms }); return true; } catch { return false; } };

async function signIn(page, base, email, password = PASS) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

// ---------- 1. First-run setup on an empty portal ----------
{
  const page = await newPage();
  await page.goto(FRESH + "/");
  check("empty portal opens on first-time setup", await waitText(page, "Set up the portal"));
  await page.locator('input[name="code"]').fill("not-the-code");
  await page.locator('input[name="name"]').fill("Sam Staff");
  await page.locator('input[name="email"]').fill("sam@nobleman.test");
  await page.locator('input[name="new-password"]').fill("sam-password-123");
  await page.locator('input[name="again"]').fill("sam-password-123");
  await page.getByRole("button", { name: "Create the first staff account" }).click();
  check("a wrong setup code is refused on screen", await waitText(page, "That setup code isn’t right."));
  await page.locator('input[name="code"]').fill("setup-code-123");
  await page.getByRole("button", { name: "Create the first staff account" }).click();
  check("the right code creates the account and opens the portal", await waitText(page, /Good (morning|afternoon|evening), Sam\./));
  check("staff see Studio in the side capsule", await visible(nav(page, "Studio")));
  await page.context().close();
}

// ---------- 2. A client signs in and works through a review ----------
const dana = await newPage();
{
  const page = dana;
  await page.goto(B + "/review");
  check("signed out, the portal shows the screening-room sign-in", await waitText(page, "screening room") && await visible(page.getByRole("heading", { name: "Sign in" })));
  await signIn(page, B, "dana@harbor.test", "wrong-password-here");
  check("a wrong password says so", await waitText(page, /email and password don’t match/));
  await signIn(page, B, "dana@harbor.test");
  check("after signing in, the link they followed opens (Review)", await waitText(page, /Review Harbor Spot/) && new URL(page.url()).pathname.startsWith("/review"));
  check("desktop: the side capsule is shown and the bottom bar isn't", await visible(page.locator("nav.rail")) && !(await visible(page.locator("nav.bottombar"))));
  check("the capsule marks Review as the current page", (await page.locator("nav.rail .rail-item[aria-current=page]").innerText()).includes("Review"));

  await nav(page, "Home").click();
  check("Home leads with the next step", await waitText(page, "Version 3 of Harbor Spot is ready for you."));
  await page.getByRole("link", { name: /Review Version 3/ }).click();
  check("the next-step button opens Version 3", await waitText(page, "Is Version 3 right?"));

  await page.getByPlaceholder("What would you change at this moment?").fill("Hold the wide shot a beat longer.");
  await page.getByRole("button", { name: "Add note" }).click();
  check("a note can be added and shows in the list", await waitText(page, "Hold the wide shot a beat longer."));
  check("the open-notes count goes up", await waitText(page, "Open 1"));

  await page.getByRole("button", { name: "Approve Version 3" }).click();
  check("approving asks for confirmation first", await visible(page.getByRole("dialog")));
  await page.getByRole("button", { name: "Yes, approve Version 3" }).click();
  check("after approving, the page says who approved it", await waitText(page, /Dana Whitfield approved Version 3/));

  await nav(page, "Messages").click();
  await page.getByPlaceholder(/Write to Nobleman/).fill("Thanks, the new cut looks great.");
  await page.keyboard.press("Enter");
  check("Enter sends a message and it appears in the thread", await waitText(page, "Thanks, the new cut looks great."));

  await nav(page, "Files").click();
  await waitText(page, "Send files to Nobleman");
  await page.locator('input[type="file"]').setInputFiles({ name: "brand-guide.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(4096, 1) });
  check("a document uploads to file storage and is listed", await waitText(page, "brand-guide.pdf", 12000) && await waitText(page, "brand-guide.pdf sent to Nobleman."));
  await page.locator('input[type="file"]').setInputFiles({ name: "broll-take2.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(8192, 2) });
  check("a video uploads to the project's Vimeo folder", await waitText(page, "broll-take2.mp4 sent to Nobleman.", 15000));

  await nav(page, "Films").click();
  await page.getByRole("link", { name: /Watch Harbor Summit Recap/ }).click();
  check("a film offers its download sizes, including the original", await waitText(page, "Original file") && await waitText(page, "HD 1080p"));
  check("a shareable film offers its link", await visible(page.getByRole("button", { name: "Copy the link" })));
  check("chapters are listed", await waitText(page, "Keynote"));
}

// ---------- 3. Staff switch capabilities off and add a person ----------
{
  const page = await newPage();
  await page.goto(B + "/");
  await signIn(page, B, "alexis@gotit2work.com");
  await waitText(page, /Good (morning|afternoon|evening), Alexis\./);
  check("staff Home shows what clients just did", await waitText(page, "Dana Whitfield approved Version 3") || await waitText(page, /approved/));
  await nav(page, "Studio").click();
  await page.getByRole("row", { name: /Harbor Summit/ }).getByRole("link", { name: "Edit", exact: true }).click();
  await waitText(page, "What Harbor Labs can do");
  check("the save bar is calm until something changes", await waitText(page, "Everything is saved."));
  await page.getByRole("switch", { name: "Messages" }).click();
  await page.getByRole("switch", { name: "Download finished films" }).click();
  check("switching off downloads also blocks original files (it depends on it)", await page.getByRole("switch", { name: "Download original files" }).isDisabled());
  check("unsaved changes are flagged", await waitText(page, "You have unsaved changes."));
  await page.getByRole("button", { name: "Save changes" }).click();
  check("saving clears the flag", await waitText(page, "Everything is saved."));

  await nav(page, "Studio").click();
  await page.locator(".studio-tabs").getByRole("link", { name: "People" }).click();
  await page.getByRole("button", { name: "Add a person" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator("input").first().fill("Mia Chen");
  await dlg.locator('input[type="email"]').fill("mia@harbor.test");
  await dlg.locator("select").last().selectOption({ label: "Harbor Labs" });
  await dlg.getByRole("button", { name: "Add and get their password" }).click();
  await waitText(page, "Send Mia Chen their sign-in");
  const temp = (await page.locator(".copybox code").innerText()).trim();
  check("adding a person shows a one-time temporary password", /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(temp), temp);
  await page.getByRole("button", { name: "Done" }).click();
  check("your own row offers your account, not a reset", await visible(page.getByRole("row", { name: /Alexis/ }).getByRole("link", { name: "Change my password" })));

  // Mia signs in with the temporary password and has to choose her own.
  const mia = await newPage();
  await mia.goto(B + "/");
  await signIn(mia, B, "mia@harbor.test", temp);
  check("a temporary password leads to 'Choose your own password'", await waitText(mia, "Choose your own password"));
  await mia.locator('input[name="new-password"]').fill("mia-own-password-1");
  await mia.locator('input[name="again"]').fill("mia-own-password-1");
  await mia.getByRole("button", { name: "Save and open the portal" }).click();
  check("then the portal opens for her", await waitText(mia, /Good (morning|afternoon|evening), Mia\./));
  await mia.context().close();
  await page.context().close();
}

// ---------- 4. The client's portal follows the switches ----------
{
  const page = dana;
  await page.goto(B + "/");
  await waitText(page, /Good (morning|afternoon|evening), Dana\./);
  check("with Messages off, the client's capsule has no Messages", !(await visible(nav(page, "Messages"))));
  await page.goto(B + "/films");
  await page.getByRole("link", { name: /Watch Harbor Summit Recap/ }).click();
  await waitText(page, "Harbor Summit Recap");
  check("with downloads off, the film has no Download card", !(await waitText(page, "Original file", 1500)));
  await page.locator("nav.rail").getByRole("link", { name: /Your account/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  check("signing out returns to the sign-in screen", await page.getByRole("heading", { name: "Sign in" }).waitFor().then(() => true, () => false));
  await page.context().close();
}

// ---------- 5. Phone: bottom bar instead of the capsule ----------
{
  const page = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(B + "/");
  await signIn(page, B, "rob@moto.test");
  await waitText(page, /Good (morning|afternoon|evening), Rob\./);
  check("phone: the bottom bar shows and the side capsule doesn't", await visible(page.locator("nav.bottombar")) && !(await visible(page.locator("nav.rail"))));
  check("phone: Rob's project has messages off, so no Messages tab", !(await visible(page.locator("nav.bottombar").getByText("Messages"))));
  await page.locator("nav.bottombar").getByRole("link", { name: /^Review/ }).click();
  await page.waitForURL(/\/review/, { timeout: 5000 }).catch(() => {});
  check("phone: the bottom bar navigates", new URL(page.url()).pathname.startsWith("/review") && await waitText(page, /Review Desert/), page.url());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check("phone: no sideways scrolling", overflow <= 0, overflow);
  await page.context().close();
}

// ---------- 6. The demo ----------
{
  const page = await newPage();
  await page.goto(DEMO + "/");
  check("demo mode: the sample project opens without signing in", await waitText(page, /Good (morning|afternoon|evening), Jonathan\./));
  check("the demo says it's a demo", await waitText(page, /Demo · sample project/i));
  await page.getByRole("link", { name: /Review Version 3/ }).click();
  await page.getByRole("button", { name: "Approve Version 3" }).click();
  await page.getByRole("button", { name: "Yes, approve Version 3" }).click();
  check("demo actions say plainly that nothing was sent", await waitText(page, /Demo only:/));
  await page.goto(DEMO + "/signin");
  check("/signin still reaches the real sign-in in demo mode", await page.getByRole("heading", { name: "Sign in" }).waitFor().then(() => true, () => false));
  await page.goto(B + "/demo");
  check("/demo works on the live portal too", await waitText(page, /Jonathan/));
  await page.context().close();
}

// ---------- 7. A dropped connection while loading ----------
{
  const page = await newPage();
  await page.route("**/app/films.js", (r) => r.abort());
  await page.goto(DEMO + "/");
  check("if a portal file doesn't arrive, the page says so and offers a reload", await waitText(page, /didn’t finish loading/) && await visible(page.getByRole("button", { name: "Reload the page" })));
  await page.context().close();
}

check("no JavaScript errors on any page", pageErrors.length === 0, pageErrors.join(" | "));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
