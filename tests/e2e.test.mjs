// End-to-end UI tests: a real browser signs in and clicks through the portal against the local servers.
// Needs ./run.sh first (fresh databases: the tests change data). Usage: node e2e.test.mjs
import { chromium } from "playwright-core";
import { chromiumPath } from "./lib/browser.mjs";
import { totpCode, totpStep } from "../api/_crypto.js";

const B = "http://localhost:4400", DEMO = "http://localhost:4401", FRESH = "http://localhost:4402";
const PASS = "portal-test-pass";
let pass = 0, fail = 0;
const check = (l, c, x = "") => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + l + (!c && x ? "  " + String(x).slice(0, 300) : "")); };
const pageErrors = [];
const mails = async () => (await (await fetch(B + "/__mail")).json());
const linkIn = (m) => ((m && (m.html || m.text) || "").match(/https?:\/\/[^"'\s<]+\/link\/[\w-]+/) || [])[0];

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
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: B }).catch(() => {});
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|vimeocdn\.com|player\.vimeo\.com/, (r) => r.abort());
  await ctx.route("https://vercel.com/api/blob**", proxyBlob);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.setDefaultTimeout(8000);
  return page;
}
const nav = (page, name) => page.locator("nav.rail").getByRole("link", { name, exact: true });
const tab = (page, name) => page.locator(".studio-tabs").getByRole("link", { name, exact: true });
const visible = (loc) => loc.first().isVisible().catch(() => false);
const waitText = async (page, text, ms = 8000) => { try { await page.getByText(text).first().waitFor({ state: "visible", timeout: ms }); return true; } catch { return false; } };
const hello = (name) => new RegExp(`Good (morning|afternoon|evening), ${name}\\.`);
const local = (url) => String(url).replace(/^https?:\/\/[^/]+/, B);

async function signIn(page, email, password = PASS) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}
async function as(email, path = "/", opts) {
  const page = await newPage(opts);
  await page.goto(B + path);
  await signIn(page, email);
  return page;
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
  await page.getByRole("button", { name: "Create the owner account" }).click();
  check("a wrong setup code is refused on screen", await waitText(page, "That setup code isn’t right."));
  await page.locator('input[name="code"]').fill("setup-code-123");
  await page.getByRole("button", { name: "Create the owner account" }).click();
  check("the right code creates the owner and opens the portal", await waitText(page, hello("Sam")));
  check("staff see Studio in the side capsule", await visible(nav(page, "Studio")));
  await nav(page, "Studio").click();
  await waitText(page, "No projects yet.");
  const tabs = (await page.locator(".studio-tabs a").allInnerTexts()).join("|").replace(/\s+/g, "");
  check("an owner sees every Studio tab", tabs === "Projects|Clients|People|Connections|Settings|Activity", tabs);
  await page.context().close();
}

// ---------- 2. A decision maker works through a review ----------
const dana = await newPage();
{
  const page = dana;
  await page.goto(B + "/review");
  check("logged out, everyone sees the same login (not a client login)", await waitText(page, "screening room") && await visible(page.getByRole("heading", { name: "Log in" })) && !(await waitText(page, /client portal|client login/i, 500)));
  check("the login offers creating an account", await visible(page.getByRole("tab", { name: "Create an account" })));
  check("the login screen carries its Murphy’s Law", await waitText(page, "The one frame nobody checked is the one everyone sees."));
  check("emailed login links are offered", await visible(page.getByRole("button", { name: "Email me a login link instead" })));
  await signIn(page, "dana@harbor.test", "wrong-password-here");
  check("a wrong password says so", await waitText(page, /email and password don’t match/));
  await signIn(page, "dana@harbor.test");
  check("after signing in, the link they followed opens (Review)", await waitText(page, /Review Harbor Spot/) && new URL(page.url()).pathname.startsWith("/review"));
  check("desktop: the side capsule is shown and the bottom bar isn't", await visible(page.locator("nav.rail")) && !(await visible(page.locator("nav.bottombar"))));

  check("the client sees only the newest version: no version picker", !(await visible(page.locator(".versions"))));
  check("…and is told it replaces the earlier ones", await waitText(page, "It replaces Version 2 and earlier."));
  check("the version under review is marked as a preview", (await page.locator(".player-mark").first().textContent().catch(() => "") || "").includes("Version 3"));

  await nav(page, "Home").click();
  check("Home leads with the next step", await waitText(page, "Version 3 of Harbor Spot is ready for you."));
  check("a first visit shows the welcome", await waitText(page, "Welcome to your screening room."));
  await page.getByRole("button", { name: "Got it" }).click();
  await page.getByRole("link", { name: /Watch Version 3/ }).first().click();
  check("the next-step button opens Version 3", await waitText(page, "Is Version 3 right?"));

  await page.getByPlaceholder("What would you change at this moment?").fill("Hold the wide shot a beat longer.");
  await page.getByRole("button", { name: "Add note" }).click();
  check("a note can be added and shows in the list", await waitText(page, "Hold the wide shot a beat longer."));

  await page.getByRole("button", { name: "Approve Version 3" }).click();
  const dlg = page.getByRole("dialog");
  check("approving asks for confirmation first, with room for small fixes", await visible(dlg) && await visible(dlg.locator("textarea")));
  await dlg.locator("textarea").fill("Lift the logo a touch.");
  await dlg.getByRole("button", { name: "Approve Version 3 with these fixes" }).click();
  check("after approving, the page says who approved it and the fixes", await waitText(page, /Dana Whitfield approved Version 3/) && await waitText(page, "Approved with small fixes") && await waitText(page, "Lift the logo a touch."));
  await page.waitForTimeout(400);
  check("an approval receipt is emailed to the approver", (await mails()).some((m) => [].concat(m.to).includes("dana@harbor.test") && /approv/i.test(m.subject)));

  await nav(page, "Messages").click();
  check("Messages says who replies and when (an editable setting)", await waitText(page, "They usually reply the same business day."));
  await page.getByPlaceholder(/Write to the studio/).fill("Thanks, the new cut looks great.");
  await page.keyboard.press("Enter");
  check("Enter sends a message and it appears in the thread", await waitText(page, "Thanks, the new cut looks great."));

  await nav(page, "Files").click();
  await waitText(page, "Send files to the studio");
  await page.locator('input[type="file"]').setInputFiles({ name: "brand-guide.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(4096, 1) });
  check("a document uploads to file storage and is listed", await waitText(page, "brand-guide.pdf", 12000) && await waitText(page, "brand-guide.pdf sent to the studio."));
  await page.locator('input[type="file"]').setInputFiles({ name: "broll-take2.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(8192, 2) });
  check("a video uploads straight to the project's video folder", await waitText(page, "broll-take2.mp4 sent to the studio.", 15000));

  await nav(page, "Films").click();
  await page.getByRole("link", { name: /Watch Harbor Summit Recap/ }).click();
  check("a film offers its download sizes, including the original", await waitText(page, "Original file") && await waitText(page, "HD 1080p"));
  check("chapters are listed", await waitText(page, "Keynote"));
  await page.getByRole("button", { name: "Create and copy a link" }).click();
  check("a share link can be created and is listed", await waitText(page, /^Until /) && await visible(page.getByRole("button", { name: "Turn off" })));
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check("the share link is copied", /\/watch\/[\w-]{20,}/.test(shareUrl), shareUrl);

  const guest = await newPage();
  await guest.goto(local(shareUrl));
  check("the share page shows the film with the studio's name, without signing in", await waitText(guest, "Harbor Summit Recap") && await waitText(guest, "Shared with you by Nobleman Productions"));
  check("the share page shows nothing else from the portal", !(await visible(guest.locator("nav.rail"))) && !(await waitText(guest, "Harbor Labs", 800)));
  await page.getByRole("button", { name: "Turn off" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Turn it off" }).click();
  await waitText(page, "That link no longer works.");
  await guest.reload();
  check("a link that was turned off stops working", await waitText(guest, "This link isn’t available."));
  await guest.context().close();

  await page.locator("nav.rail").getByRole("link", { name: /Your account/ }).click();
  check("a decision maker sees their team", await waitText(page, "Your team at Harbor Labs") && await waitText(page, "Rae Reviewer"));
  await page.getByRole("button", { name: "Add a teammate" }).click();
  const t = page.getByRole("dialog");
  await t.locator("input").first().fill("Tom Teammate");
  await t.locator('input[type="email"]').fill("tom@harbor.test");
  await t.getByRole("button", { name: "Send the invitation" }).click();
  check("adding a teammate emails them an invitation", await waitText(page, "Tom Teammate has been emailed an invitation.") && (await mails()).some((m) => [].concat(m.to).includes("tom@harbor.test") && linkIn(m)));
}

// ---------- 3. Roles: a reviewer can't approve, a viewer only watches ----------
{
  const rae = await as("rae@harbor.test", "/review");
  await waitText(rae, /Notes on Version/);
  check("a reviewer can leave notes", await visible(rae.getByRole("button", { name: "Add note" })));
  check("…but has no approve button", !(await visible(rae.getByRole("button", { name: /^Approve Version/ }))));
  await rae.context().close();
  const vic = await as("vic@harbor.test", "/review");
  await waitText(vic, /Notes on Version/);
  check("a viewer watches and reads notes, with no note box", !(await visible(vic.getByRole("button", { name: "Add note" }))) && await waitText(vic, "You can watch and read the notes."));
  check("a viewer has no Messages", !(await visible(nav(vic, "Messages"))));
  await vic.context().close();
}

// ---------- 4. Staff run everything from Studio ----------
{
  const page = await as("alexis@gotit2work.com");
  await waitText(page, hello("Alexis"));
  check("staff Home shows what needs the studio and what waits on clients", await waitText(page, "Needs the studio") && await waitText(page, "Waiting on clients"));
  await nav(page, "Studio").click();
  await page.getByRole("row", { name: /Harbor Summit/ }).getByRole("link", { name: "Open", exact: true }).click();
  await waitText(page, "What Harbor Labs can do");
  check("the save bar is calm until something changes", await waitText(page, "Everything is saved."));
  check("the project lists its videos with what the client sees", await waitText(page, "Version 3") && await waitText(page, "Finished film"));
  await page.getByRole("switch", { name: "Messages" }).click();
  await page.getByRole("switch", { name: "Download finished films" }).click();
  check("switching off downloads also blocks original files (it depends on it)", await page.getByRole("switch", { name: "Download original files" }).isDisabled());
  await page.locator('input[type="date"]').fill("2026-12-01");
  check("unsaved changes are flagged", await waitText(page, "You have unsaved changes."));
  await page.getByRole("button", { name: "Save changes" }).click();
  check("saving clears the flag", await waitText(page, "Everything is saved."));

  await tab(page, "People").click();
  await page.getByRole("button", { name: "Invite a person" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator("input").first().fill("Mia Chen");
  await dlg.locator('input[type="email"]').fill("mia@harbor.test");
  await dlg.locator("label.rolecard", { hasText: "Reviewer" }).click();
  await dlg.locator("select").last().selectOption({ label: "Harbor Labs" });
  await dlg.getByRole("button", { name: "Invite", exact: true }).click();
  check("inviting emails a one-time link, and shows it to copy", await waitText(page, "Mia Chen is invited") && await waitText(page, "We emailed it to mia@harbor.test."));
  const link = (await page.locator(".copybox code").innerText()).trim();
  check("the invitation link is a one-time /link/ address", /\/link\/[\w-]{20,}$/.test(link), link);
  await page.getByRole("button", { name: "Done" }).click();
  check("people show their role", await visible(page.getByRole("row", { name: /Mia Chen/ }).getByText("Reviewer")));
  check("your own row offers your account, not a reset", await visible(page.getByRole("row", { name: /Alexis/ }).getByRole("link", { name: "My account" })));

  const mia = await newPage();
  await mia.goto(local(link));
  check("the invitation link opens 'Choose your password'", await waitText(mia, "Choose your password"));
  await mia.locator('input[name="new-password"]').fill("mia-own-password-1");
  await mia.locator('input[name="again"]').fill("mia-own-password-1");
  await mia.getByRole("button", { name: "Save and open the portal" }).click();
  check("then the portal opens for her", await waitText(mia, hello("Mia")));
  await mia.context().close();
  const again = await newPage();
  await again.goto(local(link));
  check("the same link doesn't work twice", await waitText(again, "That link didn’t work"));
  await again.context().close();

  await page.getByRole("button", { name: "What roles can do" }).click();
  check("the roles table shows every role", await waitText(page, "Decision maker") && await waitText(page, "Producer"));
  check("owners always keep every permission", await page.getByRole("checkbox", { name: "Change settings and roles: owner" }).isDisabled());

  await tab(page, "Connections").click();
  await page.getByRole("button", { name: "Add a connection" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /YouTube/ }).click();
  const yt = page.getByRole("dialog");
  await yt.getByLabel("API key").fill("yt-key");
  await yt.getByLabel("Channel ID (optional)").fill("UCtestchannel0000000001");
  await yt.getByRole("button", { name: "Connect and test" }).click();
  check("a video account connects from Studio, and is tested", await waitText(page, "YouTube is connected."));

  await page.getByRole("button", { name: "Connect Notion" }).click();
  await page.getByRole("dialog").getByLabel("Internal connection token").fill("ntn_test_token");
  await page.getByRole("dialog").getByRole("button", { name: "Connect and test" }).click();
  await waitText(page, "Where should the projects go?");
  await page.getByRole("button", { name: "Create a new database in a page" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create it here" }).click();
  check("Notion: a projects database is created from Studio", await waitText(page, "Projects sync to"));
  await page.waitForTimeout(800);
  const fake = await (await fetch(B + "/__fake/state")).json();
  check("…and the projects arrive in Notion", fake.notion.pages.length >= 2, fake.notion.pages.length);

  await tab(page, "Settings").click();
  check("Settings opens with a system check", await waitText(page, "System check"));
  const law = page.locator("section.card", { has: page.getByText("Login screen", { exact: true }) });
  await law.getByLabel("The law").fill("Anything that can go wrong in the edit will show up in the final cut.");
  await law.getByRole("button", { name: "Save", exact: true }).click();
  await waitText(page, "Saved.");
  const out = await newPage();
  await out.goto(B + "/");
  check("the login screen's law changes without code", await waitText(out, "Anything that can go wrong in the edit will show up in the final cut."));
  await out.context().close();

  await tab(page, "Activity").click();
  check("the activity log shows what clients did", await waitText(page, /Approved Harbor Spot/i) && await waitText(page, /Created a share link/));
  await page.getByRole("button", { name: "Clients", exact: true }).click();
  check("…and filters by who did it", await waitText(page, "Dana Whitfield"));
  await page.context().close();
}

// ---------- 4b. Creating an account ----------
{
  const page = await newPage();
  await page.goto(B + "/signup");
  check("/signup opens on Create an account", await waitText(page, "Create your account") && (await page.getByRole("tab", { name: "Create an account" }).getAttribute("aria-selected")) === "true");
  check("…with three steps, the first one lit", (await page.locator(".stepline li.now").innerText()).includes("Your details"));
  await page.locator('input[name="name"]').fill("Kim Lowell");
  await page.locator('input[name="email"]').fill("kim@lowellmarine.test");
  await page.locator('input[name="company"]').fill("Lowell Marine");
  await page.getByRole("button", { name: "Add a note for the studio" }).click();
  await page.locator("textarea").fill("A boat launch film in May.");
  await page.getByRole("button", { name: "Create my account" }).click();
  check("then it asks them to confirm their email", await waitText(page, "We sent a link to") && (await page.locator(".stepline li.now").innerText()).includes("Confirm your email"));
  await page.waitForTimeout(400);
  const link = linkIn((await mails()).reverse().find((m) => [].concat(m.to).includes("kim@lowellmarine.test")));
  await page.goto(local(link));
  check("confirming puts them on the list, with what happens next", await waitText(page, "You’re on the list, Kim.") && await waitText(page, "we’ll email you a link to choose your password"));
  await page.context().close();

  const staff = await as("alexis@gotit2work.com");
  check("staff home leads with who's asking to join", await waitText(staff, "Someone is asking to join."));
  await staff.getByRole("link", { name: /Review the request/ }).click();
  check("Studio → People lists the request with their note", await waitText(staff, "Asking to join") && await waitText(staff, "A boat launch film in May."));
  await staff.getByRole("button", { name: "Let them in…" }).click();
  const dlg = staff.getByRole("dialog");
  check("letting them in suggests a new client named after their company", (await dlg.locator('input[placeholder="For example: Meridian"]').inputValue()) === "Lowell Marine");
  await dlg.getByRole("button", { name: "Let them in and send the invitation" }).click();
  check("approving invites them by email", await waitText(staff, "Kim Lowell is invited") && await waitText(staff, "We emailed it to kim@lowellmarine.test."));
  await staff.getByRole("button", { name: "Done" }).click();
  check("…and the request is gone from the list", !(await waitText(staff, "Asking to join", 1200)));

  // A client's email domain lets their people straight in.
  await tab(staff, "Clients").click();
  await staff.getByRole("row", { name: /Harbor Labs/ }).getByRole("button", { name: "Edit" }).click();
  await staff.getByRole("dialog").getByLabel("Their email domain (optional)").fill("harbor.test");
  await staff.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  check("a client's email domain is saved and shown", await waitText(staff, "Joins by email: @harbor.test"));
  await staff.context().close();

  const lee = await newPage();
  await lee.goto(B + "/signup");
  await lee.locator('input[name="name"]').fill("Lee Harbor");
  await lee.locator('input[name="email"]').fill("lee@harbor.test");
  await lee.locator('input[name="company"]').fill("Harbor Labs");
  await lee.getByRole("button", { name: "Create my account" }).click();
  await waitText(lee, "We sent a link to");
  await lee.waitForTimeout(400);
  await lee.goto(local(linkIn((await mails()).reverse().find((m) => [].concat(m.to).includes("lee@harbor.test")))));
  check("someone at the client's domain goes straight to choosing a password, told which company", await waitText(lee, "Choose your password") && await waitText(lee, "You’re joining Harbor Labs."));
  await lee.locator('input[name="new-password"]').fill("lee-own-password-1");
  await lee.locator('input[name="again"]').fill("lee-own-password-1");
  await lee.getByRole("button", { name: "Save and open the portal" }).click();
  check("…and lands in their company's portal, as a client", await waitText(lee, hello("Lee")) && !(await visible(nav(lee, "Studio"))));
  await lee.context().close();
}

// ---------- 5. An editor's Studio is limited to their role ----------
{
  const page = await as("eddie@studio.test", "/studio");
  await waitText(page, "Harbor Summit");
  const tabs = (await page.locator(".studio-tabs a").allInnerTexts()).join("|").replace(/\s+/g, "");
  check("an editor sees only the Studio tabs their role allows", tabs === "Projects", tabs);
  check("…and can't create projects", !(await visible(page.getByRole("button", { name: "New project" }))));
  await page.context().close();
}

// ---------- 6. Two-step verification for staff ----------
{
  const page = await as("pat@studio.test", "/account");
  await waitText(page, "Two-step verification");
  await page.getByRole("button", { name: "Set up two-step verification" }).click();
  await page.getByRole("button", { name: "Turn on two-step verification" }).click();
  await page.locator("code.key").waitFor();
  const secret = (await page.locator("code.key").innerText()).replace(/\s/g, "");
  await page.locator(".qr svg").waitFor({ timeout: 4000 }).catch(() => {});
  check("setup shows a QR code and the key", await visible(page.locator(".qr svg")) && secret.length >= 32, secret);
  await page.getByLabel("The six-digit code your app shows now").fill(totpCode(secret, totpStep()));
  await page.getByRole("button", { name: "Check the code and turn it on" }).click();
  check("turning it on shows recovery codes once", await waitText(page, "Two-step verification is on.") && (await page.locator(".codes code").count()) >= 8);
  await page.getByRole("button", { name: "I’ve saved them" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("heading", { name: "Log in" }).waitFor();
  await signIn(page, "pat@studio.test");
  check("signing in now asks for the code", await waitText(page, "One more step"));
  await page.locator('input[name="code"]').fill(totpCode(secret, totpStep() + 1));
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  check("the right code opens the portal", await waitText(page, hello("Pat")));
  await page.context().close();
}

// ---------- 7. The client's portal follows the switches ----------
{
  const page = dana;
  await page.goto(B + "/");
  await waitText(page, hello("Dana"));
  check("with Messages off, the client's capsule has no Messages", !(await visible(nav(page, "Messages"))));
  await page.goto(B + "/films");
  await page.getByRole("link", { name: /Watch Harbor Summit Recap/ }).click();
  await waitText(page, "Harbor Summit Recap");
  check("with downloads off, the film has no Download card", !(await waitText(page, "Original file", 1500)));
  await page.locator("nav.rail").getByRole("link", { name: /Your account/ }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  check("logging out returns to the login screen", await page.getByRole("heading", { name: "Log in" }).waitFor().then(() => true, () => false));
  await page.context().close();
}

// ---------- 8. Phone: bottom bar instead of the capsule ----------
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
{
  const page = await as("rob@moto.test", "/", PHONE);
  await waitText(page, hello("Rob"));
  check("phone: the bottom bar shows and the side capsule doesn't", await visible(page.locator("nav.bottombar")) && !(await visible(page.locator("nav.rail"))));
  check("phone: Rob's project has messages off, so no Messages tab", !(await visible(page.locator("nav.bottombar").getByText("Messages"))));
  await page.locator("nav.bottombar").getByRole("link", { name: /^Review/ }).click();
  await page.waitForURL(/\/review/, { timeout: 5000 }).catch(() => {});
  check("phone: the bottom bar navigates", new URL(page.url()).pathname.startsWith("/review") && await waitText(page, /Review Desert/), page.url());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check("phone: no sideways scrolling", overflow <= 0, overflow);
  await page.context().close();
}
{
  const page = await as("alexis@gotit2work.com", "/studio/projects", PHONE);
  await waitText(page, "Harbor Summit");
  for (const t of ["projects", "clients", "people", "connections", "settings", "activity"]) {
    await page.goto(B + "/studio/" + t);
    await page.waitForTimeout(900);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`phone: Studio ${t} has no sideways scrolling`, overflow <= 0, overflow);
  }
  await page.context().close();
}

// ---------- 9. The demo ----------
{
  const page = await newPage();
  await page.goto(DEMO + "/");
  check("demo mode: the sample project opens without signing in", await waitText(page, hello("Jonathan")));
  check("the demo says it's a demo", await waitText(page, /Demo · sample project/i));
  await page.getByRole("link", { name: /Watch Version 3/ }).first().click();
  await page.getByRole("button", { name: "Approve Version 3" }).click();
  await page.getByRole("button", { name: "Yes, approve Version 3" }).click();
  check("demo actions say plainly that nothing was sent", await waitText(page, /Demo only:/));
  check("the demo shows the client's view first, with a switch to the studio's", (await page.locator(".demo-switch button[aria-pressed=true]").first().innerText()).includes("Client") && !(await visible(nav(page, "Studio"))));
  await page.locator(".demo-switch").first().getByRole("button", { name: "Studio’s view" }).click();
  check("the studio's view adds Studio and leads with who's asking to join", await waitText(page, "Someone is asking to join.") && await visible(nav(page, "Studio")));
  await page.getByRole("link", { name: /Review the request/ }).click();
  check("demo Studio shows the management side with sample data", await waitText(page, "Asking to join") && await waitText(page, "Kim Lowell") && await waitText(page, "Jonathan Reyes"));
  await page.getByRole("button", { name: "Let them in…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Let them in and send the invitation" }).click();
  check("…and refuses changes, saying it's the demo", await waitText(page, /Demo only: nothing here is saved/));
  await page.keyboard.press("Escape");
  for (const t of ["Projects", "Connections", "Settings", "Activity"]) {
    await page.locator(".studio-tabs").getByRole("link", { name: t, exact: true }).click();
    check(`demo Studio ${t} opens`, await waitText(page, t === "Projects" ? "Meridian Campaign" : t === "Connections" ? "Video sources" : t === "Settings" ? "System check" : "Asked to join|Watched Campaign Film".split("|")[1]));
  }
  await page.goto(DEMO + "/studio/projects");
  check("reloading a Studio page in the demo keeps the studio's view", await waitText(page, "Meridian Campaign") && await visible(nav(page, "Studio")));
  await page.goto(DEMO + "/signin");
  check("/signin still reaches the real login in demo mode", await page.getByRole("heading", { name: "Log in" }).waitFor().then(() => true, () => false));
  await page.goto(B + "/demo");
  check("/demo works on the live portal too", await waitText(page, /Jonathan/));
  await page.context().close();
}

// ---------- 10. A dropped connection while loading ----------
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
