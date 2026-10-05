// Portal API, end to end against the local servers: sign-in (passwords, emailed links, two-step codes), roles,
// scoping, capabilities, newest-version-only review, notes, decisions, messages, media from every video source
// (Vimeo, Frame.io, YouTube, Wistia, video links), uploads, files, share links, client teams, reminders,
// Studio (clients, people, projects, connections, settings, roles), Notion sync, activity log, exports,
// health, the daily job, cross-origin refusal, throttling, and emails.
// Usage: node api.test.mjs  (servers from ./run.sh, freshly started: 4400 seeded, 4402 empty)
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { totpCode, totpStep } from "../api/_crypto.js";

const B = "http://localhost:4400", FRESH = "http://localhost:4402";
const ALEXIS = "11111111-0000-4000-8000-000000000001", PAT = "11111111-0000-4000-8000-000000000002", EDDIE = "11111111-0000-4000-8000-000000000003";
const DANA = "22222222-0000-4000-8000-000000000002", RAE = "22222222-0000-4000-8000-000000000003", VIC = "22222222-0000-4000-8000-000000000004";
const ROB = "33333333-0000-4000-8000-000000000003";
const HARBOR = "cccccccc-0000-4000-8000-000000000001", DESERT = "dddddddd-0000-4000-8000-000000000002";
const HARBOR_LABS = "aaaaaaaa-0000-4000-8000-000000000001", DESERT_MOTO = "bbbbbbbb-0000-4000-8000-000000000002";
let pass = 0, fail = 0;
const check = (l, c, x = "") => { c ? pass++ : fail++; if (!c || process.env.VERBOSE) console.log((c ? "PASS " : "FAIL ") + l + (x ? "  " + String(x).slice(0, 500) : "")); };
const J = (o) => JSON.stringify(o);

class Agent {
  constructor(base = B) { this.base = base; this.cookie = ""; }
  async req(method, path, body, headers = {}, raw = false) {
    const r = await fetch(this.base + path, {
      method, redirect: "manual",
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of set) { const v = c.split(";")[0]; this.cookie = /=$/.test(v) || /Max-Age=0/.test(c) ? "" : v; }
    if (raw) return { s: r.status, text: await r.text(), h: r.headers };
    let data = null; try { data = await r.json(); } catch {}
    return { s: r.status, d: data, h: r.headers };
  }
  get(p) { return this.req("GET", p); }
  post(p, b, h) { return this.req("POST", p, b, h); }
  login(email, password = "portal-test-pass") { return this.post("/api/session", { action: "login", email, password }); }
  admin(action, b = {}) { return this.post("/api/admin", { action, ...b }); }
  act(action, b = {}) { return this.post("/api/portal", { action, ...b }); }
}
const mails = async () => (await (await fetch(B + "/__mail")).json());
const linkIn = (m) => (/\/link\/([\w-]+)(\?next=[^"]+)?/.exec(m.html) || [])[1];
const fake = async () => (await (await fetch(B + "/__fake/state")).json());

// ================= sign-in =================
const anon = new Agent();
let r = await anon.get("/api/portal");
check("signed out: portal data refused (401)", r.s === 401, r.s);
r = await anon.get("/api/session");
check("sign-in screen gets the studio's name and photo, and no Murphy's Law", r.s === 200 && r.d.brand.studio === "Nobleman Productions" && Object.keys(r.d.signin).sort().join() === "focus,image" && r.d.email === true && r.d.signinLinks === true, J(r.d));
r = await anon.get("/api/portal?demo=1");
check("the sample portal isn't public: logged out gets 401", r.s === 401, r.s);
r = await anon.get("/api/admin?demo=1");
check("…nor the sample Studio", r.s === 401, r.s);
r = await anon.login("dana@harbor.test", "wrong-password");
check("wrong password: 401 with a helpful message", r.s === 401 && /don’t match/.test(r.d.error), J(r.d));
const dana = new Agent(), rae = new Agent(), vic = new Agent(), rob = new Agent(), admin = new Agent(), pat = new Agent(), eddie = new Agent();
r = await dana.login("dana@harbor.test");
check("client signs in, with their role", r.s === 200 && r.d.user.role === "client" && r.d.user.access === "approver" && r.d.user.clientName === "Harbor Labs", J(r.d));
await Promise.all([rae.login("rae@harbor.test"), vic.login("vic@harbor.test"), rob.login("rob@moto.test"), pat.login("pat@studio.test"), eddie.login("eddie@studio.test")]);
r = await admin.login("Alexis@GotIT2Work.com");
check("owner signs in (email is case-insensitive)", r.s === 200 && r.d.user.role === "admin" && r.d.user.access === "owner", J(r.d));
r = await admin.get("/api/portal?demo=1");
check("studio staff open the sample portal: marked demo, newest version only", r.s === 200 && r.d.demo === true && r.d.projects[0].cuts[0].versions.length === 1 && r.d.projects[0].cuts[0].total === 3, r.s);
r = await dana.get("/api/portal?demo=1");
check("…clients can't", r.s === 403, r.s);

// ================= what Dana sees =================
r = await dana.get("/api/portal");
let hp = r.d && r.d.projects.find((p) => p.id === HARBOR);
check("client sees only their own company's projects", r.s === 200 && r.d.projects.length === 1 && !!hp, J(r.d && r.d.projects.map((p) => p.title)));
const spotOf = (p) => p.cuts.find((c) => c.title === "Harbor Spot");
check("the client sees only the newest version (V3 of 3), not V1 and V2", spotOf(hp).versions.map((v) => v.n).join() === "3" && spotOf(hp).total === 3, J(hp.cuts.map((c) => [c.title, c.versions.map((v) => v.n), c.total])));
check("finished films: recap + teaser; still-processing video left out", hp.films.map((f) => f.title).sort().join() === "Harbor Summit Recap,Vertical Teaser", J(hp.films.map((f) => f.title)));
const recap = hp.films.find((f) => f.title === "Harbor Summit Recap");
check("films play through Vimeo with the private hash", recap.playback.kind === "vimeo" && recap.playback.id === "5101" && recap.playback.hash === "bbb1", J(recap.playback));
check("stats on: play counts included", recap.plays === 487, recap.plays);
check("no credentials, source ids, or staff fields reach clients", !J(r.d).includes("test-token") && hp.source === undefined && hp.clientCaps === undefined && recap.manage === undefined);
check("caps combine the project and the role (decision maker: notes, approve, team)", hp.caps.notes && hp.caps.approve && hp.caps.team && hp.caps.upload && !hp.caps.history, J(hp.caps));
check("review status: waiting on the client", hp.status.key === "waiting", J(hp.status));
check("a first visit starts the tutorial", r.d.tour === true && !("welcome" in r.d), J({ tour: r.d.tour, welcome: r.d.welcome }));
await dana.post("/api/session", { action: "profile", welcomed: true });
r = await dana.get("/api/portal");
check("finishing or skipping the tutorial keeps it from starting again", r.d.tour === false);
r = await rob.get("/api/portal");
const dp = r.d.projects[0];
check("another client sees their own project with its own switches", dp.id === DESERT && dp.caps.download === false && dp.caps.messages === false && dp.messages === null, J(dp.caps));

// ================= roles on the client side =================
r = await rae.get("/api/portal");
let rp = r.d.projects[0];
check("reviewer: can leave notes, can't approve or manage the team", rp.caps.notes === true && rp.caps.approve === false && rp.caps.team === false, J(rp.caps));
r = await rae.act("decide", { projectId: HARBOR, videoId: "5003", decision: "approved" });
check("reviewer's approval refused, pointing to the decision makers", r.s === 403 && /decision makers/.test(r.d.error), J(r.d));
r = await vic.get("/api/portal");
check("viewer: watch and download only", r.d.projects[0].caps.notes === false && r.d.projects[0].caps.messages === false && r.d.projects[0].caps.download === true && r.d.projects[0].messages === null, J(r.d.projects[0].caps));
r = await vic.act("note", { projectId: HARBOR, videoId: "5003", at: 2, body: "nope" });
check("viewer's note refused", r.s === 403, J(r.d));
r = await vic.act("message", { projectId: HARBOR, body: "hi" });
check("viewer's message refused", r.s === 403);

// ================= scoping =================
r = await dana.get(`/api/portal?thread=${DESERT}`);
check("client can't open another client's messages (404)", r.s === 404, r.s);
r = await dana.act("note", { projectId: DESERT, videoId: "6001", at: 3, body: "sneaky" });
check("client can't note on another client's project (404)", r.s === 404, r.s);
r = await dana.act("note", { projectId: HARBOR, videoId: "6001", at: 3, body: "wrong video" });
check("client can't note on a video outside their project's source", r.s === 400, J(r.d));
r = await dana.act("note", { projectId: HARBOR, videoId: "5002", at: 3, body: "an older version" });
check("an older version is still a real video of the project (notes allowed by id)", r.s === 201, J(r.d));
r = await dana.get(`/api/media?project=${HARBOR}&video=6101`);
check("media for a video outside the project is refused", r.s === 404, r.s);

// ================= notes =================
r = await dana.act("note", { projectId: HARBOR, videoId: "5003", at: 12.5, body: "Hold this wide a beat longer." });
check("client leaves a timecoded note", r.s === 201 && !!r.d.id, J(r.d));
const noteId = r.d.id;
r = await eddie.act("note", { parentId: noteId, body: "Done in V4." });
check("an editor replies to the note", r.s === 201, J(r.d));
r = await dana.get(`/api/portal?notes=${HARBOR}&video=5003`);
check("notes come back with the reply and the time", r.s === 200 && r.d.notes.length === 1 && r.d.notes[0].at === 12.5 && r.d.notes[0].replies.length === 1 && r.d.notes[0].mine === true, J(r.d));
r = await rob.act("resolve", { id: noteId, resolved: true });
check("another client can't touch the note", r.s === 404, r.s);
r = await dana.act("resolve", { id: noteId, resolved: true });
check("client marks the note done", r.s === 200);
r = await rae.act("note", { projectId: HARBOR, videoId: "5003", at: 30, body: "Reviewer note" });
const raeNote = r.d.id;
r = await eddie.act("deleteNote", { id: raeNote });
check("an editor can't remove a client's note", r.s === 403, J(r.d));
r = await pat.act("deleteNote", { id: raeNote });
check("a producer can (moderation)", r.s === 200, J(r.d));

// ================= decisions =================
r = await admin.act("decide", { projectId: HARBOR, videoId: "5003", decision: "approved" });
check("staff can't approve on the client's behalf", r.s === 403, J(r.d));
r = await dana.act("decide", { projectId: HARBOR, videoId: "5101", decision: "approved" });
check("a finished film can't be approved", r.s === 400, J(r.d));
r = await dana.act("decide", { projectId: HARBOR, videoId: "5003", decision: "changes" });
check("asking for changes needs a note", r.s === 400, J(r.d));
r = await dana.act("decide", { projectId: HARBOR, videoId: "5003", decision: "approved", note: "Lift the logo a touch." });
check("client approves V3 with small fixes", r.s === 201 && r.d.decision.decision === "approved" && r.d.decision.note === "Lift the logo a touch.", J(r.d));
let m = await mails();
check("the approver gets an approval receipt by email", m.some((x) => x.to[0] === "dana@harbor.test" && /^Approved: Harbor Spot Version 3/.test(x.subject) && /Dana Whitfield/.test(x.html)), J(m.map((x) => [x.to[0], x.subject])));
check("staff are told, with a button straight to the review", m.some((x) => x.to[0] === "alexis@gotit2work.com" && /approved Harbor Spot Version 3/.test(x.subject) && x.html.includes(`/review/${HARBOR}`)), J(m.map((x) => x.subject)));
r = await dana.get("/api/portal");
hp = r.d.projects[0];
check("the newest version shows the decision", spotOf(hp).versions[0].decision.decision === "approved" && spotOf(hp).versions[0].decision.note === "Lift the logo a touch.");
check("note counts show on the version (resolved note isn't open)", spotOf(hp).versions[0].comments.total === 2 && spotOf(hp).versions[0].comments.open === 0, J(spotOf(hp).versions[0].comments));
r = await admin.admin("projectUpdate", { id: HARBOR, caps: { history: true } });
r = await dana.get("/api/portal");
check("with Earlier versions on, the client sees V1–V3", spotOf(r.d.projects[0]).versions.map((v) => v.n).join() === "1,2,3");
await admin.admin("projectUpdate", { id: HARBOR, caps: { history: false } });
r = await admin.get("/api/portal");
check("staff get the tutorial on their first visit too", r.d.tour === true);
check("staff always see every version", spotOf(r.d.projects.find((p) => p.id === HARBOR)).versions.length === 3);

// ================= messages =================
r = await dana.act("message", { projectId: HARBOR, body: "Can we get the recap by Friday?" });
check("client sends a message", r.s === 201 && r.d.message.mine === true);
const msgId = r.d.message.id;
r = await admin.get("/api/portal");
check("staff see it as unread", r.d.projects.find((p) => p.id === HARBOR).messages.unread === 1);
r = await admin.get(`/api/portal?thread=${HARBOR}`);
check("staff open the thread", r.s === 200 && r.d.messages.length === 1 && r.d.messages[0].mine === false);
r = await admin.get("/api/portal");
check("opening the thread marks it read", r.d.projects.find((p) => p.id === HARBOR).messages.unread === 0);
r = await rob.act("message", { projectId: DESERT, body: "hello" });
check("messages off for the project: refused", r.s === 403 && /isn’t switched on/.test(r.d.error), J(r.d));
r = await admin.act("message", { projectId: DESERT, body: "Staff can still write" });
check("staff can use every capability", r.s === 201);
r = await rae.act("deleteMessage", { id: msgId });
check("a client can't remove someone else's message", r.s === 403);

// ================= Vimeo media =================
r = await dana.get(`/api/media?project=${HARBOR}&video=5101`);
check("downloads: every size including the original (download_source on)", r.s === 200 && r.d.downloads.links.length === 3 && r.d.downloads.links[0].source === true, J(r.d && r.d.downloads));
check("captions and chapters come back", r.d.captions.length === 1 && r.d.captions[0].link.endsWith(".vtt") && r.d.chapters.map((c) => c.at).join() === "0,48,112", J([r.d.captions, r.d.chapters]));
r = await dana.get(`/api/media?project=${HARBOR}&video=5003`);
check("versions under review aren't downloadable", r.s === 200 && r.d.downloads === null, J(r.d));
r = await dana.get(`/api/media?project=${HARBOR}&video=5103`);
check("no API links + hidden film: plain reason for the client", r.d.downloads.links.length === 0 && r.d.downloads.onSite === null && /aren’t ready/.test(r.d.downloads.reason), J(r.d.downloads));
r = await rob.get(`/api/media?project=${DESERT}&video=6101`);
check("downloads off for the project: none offered", r.s === 200 && r.d.downloads === null, J(r.d));
r = await admin.get(`/api/media?project=${DESERT}&video=6101`);
check("staff get the technical reason when Vimeo has no links", r.d.downloads.links.length === 0 && /Standard plan/.test(r.d.downloads.reason), J(r.d.downloads));
r = await dana.act("downloaded", { projectId: HARBOR, what: "Harbor Summit Recap (HD)" });
check("a client download is noted for staff", r.s === 200);
r = await dana.act("seen", { projectId: HARBOR, videoId: "5003" });
await dana.act("seen", { projectId: HARBOR, videoId: "5003" });

// ================= Vimeo uploads (tus) =================
r = await rob.post("/api/media", { action: "uploadStart", projectId: DESERT, name: "x.mp4", size: 10, type: "video/mp4" });
check("uploads off: refused", r.s === 403, J(r.d));
r = await dana.post("/api/media", { action: "uploadStart", projectId: HARBOR, name: "notes.pdf", size: 10, type: "application/pdf" });
check("non-video sent to the video folder: refused with directions", r.s === 400 && /Files/.test(r.d.error));
r = await dana.post("/api/media", { action: "uploadStart", projectId: HARBOR, name: "Drone_B-roll.mp4", size: 1000, type: "video/mp4" });
check("video upload: Vimeo tus link issued", r.s === 201 && /\/__tus\//.test(r.d.uploadLink), J(r.d));
const up = r.d;
const t = await fetch(up.uploadLink, { method: "PATCH", headers: { "Tus-Resumable": "1.0.0", "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" }, body: Buffer.alloc(1000) });
check("bytes go straight to Vimeo's link", t.status === 204 && t.headers.get("upload-offset") === "1000");
r = await dana.post("/api/media", { action: "uploadDone", uploadId: up.uploadId });
check("upload confirmed", r.s === 200);
await fetch(B + "/__vimeo/finish");
r = await dana.get("/api/portal");
check("client's upload listed under their uploads, not under films", r.d.projects[0].videoUploads.length === 1 && !r.d.projects[0].films.some((f) => /Drone/.test(f.title)));
let vstate = await (await fetch(B + "/__vimeo/state")).json();
const drone = vstate["222"].videos.find((v) => /Drone_B-roll/.test(v.name));
check("client footage is named for the client and private on Vimeo", !!drone && drone.name === "From Harbor Labs: Drone_B-roll.mp4" && drone.privacy.view === "nobody", J(drone && drone.privacy));
r = await eddie.post("/api/media", { action: "uploadStart", projectId: HARBOR, name: "Harbor Spot V4.mp4", size: 1000, type: "video/mp4" });
vstate = await (await fetch(B + "/__vimeo/state")).json();
const v4 = vstate["222"].videos.find((v) => /Harbor Spot V4/.test(v.name));
check("an editor uploads a version: unlisted and embeddable", r.s === 201 && !!v4 && v4.privacy.view === "unlisted" && v4.privacy.embed === "public", J(v4 && v4.privacy));
await eddie.post("/api/media", { action: "uploadCancel", uploadId: r.d.uploadId });

// ================= Blob files =================
r = await rob.post("/api/files", { action: "start", projectId: DESERT, name: "a.pdf", size: 10, contentType: "application/pdf" });
check("file upload with uploads off: refused", r.s === 403);
r = await dana.post("/api/files", { action: "start", projectId: HARBOR, name: "Brand Guide 2026.pdf", size: 2048, contentType: "application/pdf" });
check("file upload: token for one private pathname", r.s === 201 && r.d.token.startsWith("vercel_blob_client_teststore_") && r.d.pathname.startsWith(`projects/${HARBOR}/`), J(r.d));
const f1 = r.d;
r = await dana.post("/api/files", { action: "done", fileId: f1.fileId });
check("confirming before the file arrived is refused", r.s === 409);
await fetch(B + "/__blob/?pathname=" + encodeURIComponent(f1.pathname), { method: "PUT", headers: { "x-content-type": "application/pdf" }, body: Buffer.alloc(2048) });
r = await rob.post("/api/files", { action: "done", fileId: f1.fileId });
check("someone else can't confirm your upload", r.s === 404);
r = await dana.post("/api/files", { action: "done", fileId: f1.fileId });
check("file confirmed", r.s === 200, J(r.d));
r = await dana.get("/api/portal");
const file = r.d.projects[0].files.find((f) => f.name === "Brand Guide 2026.pdf");
check("file listed as the client's upload", file && file.kind === "upload" && file.mine === true && file.size === 2048);
r = await dana.get("/api/files?id=" + file.id);
check("download: a short-lived signed link to the private store", r.s === 200 && /^https:\/\/teststore\.private\.blob\.vercel-storage\.com\/projects\//.test(r.d.url), r.d && r.d.url);
r = await rob.get("/api/files?id=" + file.id);
check("another client can't get the link", r.s === 404);
r = await eddie.post("/api/files", { action: "start", projectId: DESERT, name: "Quote.pdf", size: 100, contentType: "application/pdf" });
await fetch(B + "/__blob/?pathname=" + encodeURIComponent(r.d.pathname), { method: "PUT", body: Buffer.alloc(100) });
r = await eddie.post("/api/files", { action: "done", fileId: r.d.fileId });
check("an editor adds a document", r.s === 200);
r = await rob.get("/api/portal");
check("staff files appear to the client as documents from the studio", r.d.projects[0].files.some((f) => f.name === "Quote.pdf" && f.kind === "document" && !f.mine));
r = await dana.post("/api/files", { action: "delete", id: file.id });
check("client removes their own file", r.s === 200);

// ================= Studio permissions by role =================
r = await dana.get("/api/admin");
check("clients can't open Studio", r.s === 403);
r = await eddie.get("/api/admin");
check("an editor can open Studio, with an editor's permissions", r.s === 200 && r.d.me.access === "editor" && r.d.me.perms["projects.progress"] === true && r.d.me.perms["people.manage"] === false, J(r.d && r.d.me));
check("non-owners don't receive settings they can't change", r.d.settings.security === undefined && r.d.settings.brand === undefined);
r = await eddie.admin("projectCreate", { clientId: HARBOR_LABS, title: "Nope" });
check("editor: can't create projects", r.s === 403);
r = await eddie.admin("projectUpdate", { id: HARBOR, caps: { share: false } });
check("editor: can't change what the client can do", r.s === 403 && /edit projects/i.test(r.d.error), J(r.d));
r = await eddie.admin("projectUpdate", { id: HARBOR, stage: 4, next: { label: "Delivery", date: "October 12", what: "Final films" } });
check("editor: can update progress", r.s === 200, J(r.d));
r = await eddie.admin("personCreate", { name: "X", email: "x@harbor.test", role: "client", clientId: HARBOR_LABS });
check("editor: can't invite people", r.s === 403);
r = await pat.admin("personCreate", { name: "New Staff", email: "staff2@studio.test", role: "admin", access: "editor" });
check("producer: can't add staff (owners only)", r.s === 403);
r = await pat.admin("clientDelete", { id: DESERT_MOTO, confirm: "Desert Moto" });
check("producer: can't delete clients", r.s === 403);
r = await pat.admin("settingsSave", { section: "brand", value: { studio: "Hacked" } });
check("producer: can't change settings", r.s === 403);
r = await pat.admin("connectionCreate", { provider: "youtube", values: { apiKey: "x" } });
check("producer: can't manage connections", r.s === 403);
r = await pat.get("/api/admin?audit=1");
check("producer: can read the activity log", r.s === 200 && r.d.entries.length > 0);

// ================= Studio overview (owner) =================
r = await admin.get("/api/admin");
const ov = r.d;
check("overview: clients, people with roles, projects with sources, 13 capabilities, roles, providers, connections", r.s === 200 && ov.clients.length === 2 && ov.people.length === 7 && ov.projects.length === 2
  && ov.capabilities.length === 13 && ov.roles.staff.length === 3 && ov.providers.some((p) => p.key === "frameio") && ov.connections.some((c) => c.id === "env-vimeo" && c.env) && ov.projects[0].source.conn === "env-vimeo", J({ c: ov.capabilities && ov.capabilities.length, conns: ov.connections }));
check("overview never includes credentials", !J(ov).includes("test-token") && !J(ov).includes("re_test"));
r = await admin.get("/api/admin?sources=env-vimeo");
check("Vimeo folders listed for linking", r.s === 200 && r.d.sources.length === 3 && r.d.sources.some((f) => f.id === "444"), J(r.d));
r = await admin.admin("projectCreate", { clientName: "Northwind", title: "Launch Film", source: { conn: "env-vimeo", ref: "999" } });
check("linking a folder Vimeo doesn't have: refused", r.s === 400 && /no folder/.test(r.d.error), J(r.d));
r = await admin.admin("projectCreate", { clientName: "Northwind", title: "Launch Film", source: { conn: "env-vimeo", ref: "abc" } });
check("a malformed folder number is refused", r.s === 400);
r = await admin.admin("projectCreate", { clientName: "Northwind", title: "Launch Film", type: "Product launch", source: { conn: "env-vimeo", ref: "444" }, caps: { upload: true, bogus: true } });
check("project created with a new client, a source, and capabilities", r.s === 201, J(r.d));
const NW = r.d.id;
r = await admin.get(`/api/admin?videos=${HARBOR}`);
check("Studio's video list shows every video and what it is", r.s === 200 && r.d.videos.some((v) => v.id === "5003" && v.kind === "version" && v.version === 3) && r.d.videos.some((v) => v.id === "5101" && v.kind === "film") && r.d.videos.some((v) => v.kind === "client"), J(r.d.videos && r.d.videos.map((v) => [v.id, v.kind])));

// ---- per-video choices
r = await eddie.admin("videoSet", { projectId: HARBOR, videoId: "5103", hidden: true });
check("an editor hides a video from the client", r.s === 200, J(r.d));
r = await admin.admin("videoSet", { projectId: HARBOR, videoId: "5101", title: "Harbor Summit 2026 Recap" });
r = await dana.get("/api/portal");
hp = r.d.projects[0];
check("hidden video gone for the client; renamed video shows its new name", !hp.films.some((f) => f.id === "5103") && hp.films.some((f) => f.id === "5101" && f.title === "Harbor Summit 2026 Recap"), J(hp.films.map((f) => [f.id, f.title])));
r = await dana.get(`/api/media?project=${HARBOR}&video=5103`);
check("and a hidden video can't be reached by id", r.s === 404);
r = await admin.admin("videoSet", { projectId: HARBOR, videoId: "5004", kind: "film" });
r = await dana.get("/api/portal");
check("“Cutdown 15s V1” marked as a finished film moves to Films", r.d.projects[0].films.some((f) => f.id === "5004") && !r.d.projects[0].cuts.some((c) => c.title === "Cutdown 15s"), J(r.d.projects[0].cuts.map((c) => c.title)));
await admin.admin("videoSet", { projectId: HARBOR, videoId: "5103", hidden: false });
await admin.admin("videoSet", { projectId: HARBOR, videoId: "5004", kind: "auto" });

// ================= connections: YouTube =================
r = await admin.admin("connectionCreate", { provider: "youtube", name: "Studio YouTube", values: { apiKey: "wrong-key", channelId: "UCtestchannel0000000001" } });
check("a wrong key is saved but marked not working, with the reason", r.s === 201 && r.d.test.ok === false && /refused|not valid|400/.test(r.d.test.error), J(r.d));
const YTC = r.d.id;
r = await admin.admin("connectionUpdate", { id: YTC, values: { apiKey: "yt-key", channelId: "UCtestchannel0000000001" } });
check("fixing the key: the connection works and finds the channel", r.s === 200 && r.d.test.ok === true && r.d.test.account.name === "Nobleman Productions", J(r.d));
r = await admin.get("/api/admin");
check("the stored key never comes back to the page", !J(r.d).includes("yt-key") && r.d.connections.find((c) => c.id === YTC).status === "ok");
r = await admin.get(`/api/admin?sources=${YTC}`);
check("YouTube playlists listed", r.s === 200 && r.d.sources[0].id === "PLtestplaylist00001", J(r.d));
await admin.admin("projectUpdate", { id: NW, source: { conn: YTC, ref: "PLtestplaylist00001" } });
r = await admin.get("/api/portal");
let nw = r.d.projects.find((p) => p.id === NW);
check("YouTube: versions by name, films, private videos skipped", nw.cuts[0].title === "Launch Teaser" && nw.cuts[0].versions.length === 2 && nw.films.map((f) => f.title).join() === "Brand Story" && nw.films[0].playback.kind === "youtube", J([nw.cuts, nw.films.map((f) => f.title), nw.videosError]));

// ================= connections: Frame.io (server-to-server) =================
r = await admin.admin("connectionCreate", { provider: "frameio", name: "Frame.io", values: { auth: "s2s", clientId: "fio-client", clientSecret: "fio-secret" } });
check("Frame.io (server-to-server) connects and picks the only account", r.s === 201 && r.d.test.ok === true && r.d.test.accounts.length === 1, J(r.d));
const FIOC = r.d.id;
r = await admin.get(`/api/admin?sources=${FIOC}`);
check("Frame.io projects listed by their top folder", r.s === 200 && r.d.sources[0].id === "f0000000-0000-4000-8000-0000000000f1", J(r.d));
r = await admin.admin("projectCreate", { clientId: HARBOR_LABS, title: "Ocean Campaign", source: { conn: FIOC, ref: "f0000000-0000-4000-8000-0000000000f1" } });
const OCEAN = r.d.id;
r = await dana.get("/api/portal");
const oc = r.d.projects.find((p) => p.id === OCEAN);
check("version stack → versions; the client sees the stack's current version only", oc.cuts.length === 1 && oc.cuts[0].title === "Ocean Cut" && oc.cuts[0].total === 2 && oc.cuts[0].versions[0].n === 2 && oc.cuts[0].versions[0].video.id === "fv000000-0000-4000-8000-000000000002", J(oc.cuts));
check("finished film listed; unprocessed upload and non-video skipped", oc.films.map((f) => f.title).join() === "Final Deliverable", J(oc.films.map((f) => f.title)));
check("Frame.io videos play as files fetched at play time", oc.films[0].playback.kind === "file" && !oc.films[0].playback.url);
r = await dana.get(`/api/media?project=${OCEAN}&video=${oc.films[0].id}&play=1`);
check("play: a fresh signed address", r.s === 200 && /^https:\/\/fio\.example\/hq\//.test(r.d.url), J(r.d));
r = await dana.get(`/api/media?project=${OCEAN}&video=${oc.films[0].id}`);
check("Frame.io downloads: high quality and smaller copy (original off for this project)", r.s === 200 && r.d.downloads.links.map((l) => l.label).join() === "High quality (MP4),Smaller file (MP4)", J(r.d.downloads));
r = await dana.act("decide", { projectId: OCEAN, videoId: "fv000000-0000-4000-8000-000000000002", decision: "changes", note: "Warmer grade." });
check("decisions work on Frame.io versions", r.s === 201);

// ---- Frame.io: notes both ways (_fio_sync.js)
{
  const fio = async (what, b) => (await fetch(B + "/__fio/" + what, { method: "POST", body: JSON.stringify(b) })).json();
  const comments = async () => (await fake()).frameio.comments;
  const V2 = "fv000000-0000-4000-8000-000000000002";
  const notesOf = async (who) => (await who.get(`/api/portal?notes=${OCEAN}&video=${V2}`)).d.notes;
  // Someone at Harbor Labs who hasn't opened the portal yet, so the emails below aren't held back for them.
  const quinn = (await admin.admin("personCreate", { name: "Quinn Harbor", email: "quinn@harbor.test", role: "client", access: "reviewer", clientId: HARBOR_LABS, send: false })).d.id;
  let fc = await comments();
  check("a client's decision is copied to Frame.io, on that version", fc.some((c) => c.file_id === V2 && c.text === "Dana Whitfield (Harbor Labs) via the portal: Asked for changes to Version 2: Warmer grade."), J(fc));
  r = await dana.act("note", { projectId: OCEAN, videoId: V2, at: 12.4, body: "Logo bigger here." });
  const danaNote = r.d.id;
  fc = await comments();
  const copy = fc.find((c) => /Logo bigger here\./.test(c.text));
  check("a note written in the portal appears in Frame.io at the same moment, signed with who wrote it", r.s === 201 && copy && copy.text === "Dana Whitfield (Harbor Labs) via the portal: Logo bigger here." && copy.timestamp === "00:00:12:00", J(copy));
  const studioNote = await fio("comment", { file_id: V2, text: "Will do in the next version.", timestamp: "00:00:20:05" });
  await fio("comment", { file_id: V2, text: "Bigger by 20%, and centred.", parent_id: copy.id });
  let ns = await notesOf(dana);
  const sn = ns.find((x) => x.body === "Will do in the next version.");
  const dn = ns.find((x) => x.id === danaNote);
  check("a comment made in Frame.io shows in the portal, under its author, at its moment", sn && sn.author === "Jean Gotay" && sn.role === "admin" && sn.at === 20 && sn.via === "frameio", J(ns));
  check("…and a reply in Frame.io to a client's note shows as a reply to it in the portal", dn && dn.replies.length === 1 && dn.replies[0].body === "Bigger by 20%, and centred." && dn.replies[0].author === "Jean Gotay", J(dn));
  check("…while the copies of portal notes and decisions aren't brought back twice", ns.filter((x) => /Logo bigger/.test(x.body)).length === 1 && !ns.some((x) => /via the portal/.test(x.body)), J(ns.map((x) => x.body)));
  r = await dana.act("note", { parentId: sn.id, body: "Thank you!" });
  fc = await comments();
  check("a reply in the portal reaches Frame.io at the same moment, saying who it answers", r.s === 201 && fc.some((c) => c.text === "Dana Whitfield (Harbor Labs) via the portal, replying to Jean Gotay: Thank you!" && c.timestamp === "00:00:20:00"), J(fc.map((c) => [c.text, c.timestamp])));
  ns = await notesOf(dana);
  check("…and isn't brought back from Frame.io as a second reply", ns.find((x) => x.id === sn.id).replies.length === 1, J(ns.find((x) => x.id === sn.id)));
  r = await admin.act("resolve", { id: danaNote, resolved: true });
  fc = await comments();
  check("marking a note done in the portal marks its Frame.io copy completed", r.s === 200 && !!fc.find((c) => c.id === copy.id).completed_at, J(fc.find((c) => c.id === copy.id)));

  // Live updates: a webhook per workspace, signed.
  r = await admin.admin("frameioLive", { id: FIOC, on: true });
  let fk = await fake();
  check("live updates: a webhook in each Frame.io workspace, pointing at the portal", r.s === 200 && r.d.on === true && fk.frameio.webhooks.length === 1 && fk.frameio.webhooks[0].url === `http://localhost:4400/api/connect?webhook=frameio&c=${FIOC}` && fk.frameio.webhooks[0].events.includes("comment.created"), J([r.d, fk.frameio.webhooks]));
  r = await admin.get("/api/admin");
  const fconn = r.d.connections.find((c) => c.id === FIOC);
  check("…shown in Studio, without the signing secret", fconn.config.live && fconn.config.live.workspaces === 1 && !JSON.stringify(fconn).includes("whsec"), J(fconn));
  await fio("edit", { id: studioNote.id, completed: true });
  const statuses = await fio("fire", { type: "comment.completed", id: studioNote.id });
  ns = await notesOf(dana);
  check("Frame.io's signed event arrives, and completing a comment there marks the note done here", J(statuses) === J([200]) && ns.find((x) => x.id === sn.id).resolved === true, J([statuses, ns.find((x) => x.id === sn.id)]));
  let mb0 = (await mails()).length;
  const fresh = await fio("comment", { file_id: V2, text: "New grade is uploading now.", timestamp: "00:01:05:00", owner: "editor" });
  await fio("fire", { type: "comment.created", id: fresh.id });
  ns = await notesOf(dana);
  let mm = (await mails()).slice(mb0);
  check("a new Frame.io comment shows straight away, under the matching studio person", ns.some((x) => x.body === "New grade is uploading now." && x.author === "Eddie Editor" && x.at === 65), J(ns.map((x) => [x.body, x.author, x.at])));
  check("…and the client is emailed about it, with a button to the notes", mm.some((x) => x.to[0] === "quinn@harbor.test" && /Eddie Editor left a note on Ocean Cut Version 2/.test(x.subject) && x.html.includes(`/review/${OCEAN}`)), J(mm.map((x) => [x.to[0], x.subject])));
  await fio("edit", { id: fresh.id, delete: true });
  await fio("fire", { type: "comment.deleted", id: fresh.id });
  ns = await notesOf(dana);
  check("deleting a comment in Frame.io removes it here", !ns.some((x) => x.body === "New grade is uploading now."), J(ns.map((x) => x.body)));
  r = await dana.act("deleteNote", { id: danaNote });
  fc = await comments();
  check("deleting a note in the portal deletes its Frame.io copy (and the replies under it)", r.s === 200 && !fc.some((c) => c.id === copy.id) && !fc.some((c) => /Bigger by 20%/.test(c.text)), J(fc.map((c) => c.text)));
  mb0 = (await mails()).length;
  await fio("fire", { type: "file.ready", id: V2 });
  await fio("fire", { type: "file.ready", id: V2 });
  mm = (await mails()).slice(mb0).filter((x) => x.to[0] === "quinn@harbor.test" && /Ready for your review: Ocean Cut Version 2/.test(x.subject));
  check("a new version finishing in Frame.io emails the client once", mm.length === 1, J((await mails()).slice(mb0).map((x) => [x.to[0], x.subject])));
  const evtBody = JSON.stringify({ type: "comment.created", resource: { id: "x" } });
  r = await anon.req("POST", `/api/connect?webhook=frameio&c=${FIOC}`, null, { "content-type": "application/json", "x-frameio-request-timestamp": String(Math.floor(Date.now() / 1000)), "x-frameio-signature": "v0=00" });
  check("an event without Frame.io's signature is refused", r.s === 401 || r.s === 400, r.s);
  check("…and so is one signed with another secret, or one more than five minutes old", J(await fio("fire", { type: "comment.created", id: "x", badSignature: true })) === J([401]) && J(await fio("fire", { type: "comment.created", id: "x", oldTimestamp: true })) === J([401]));
  r = await anon.req("POST", `/api/connect?webhook=frameio&c=00000000-0000-4000-8000-000000000000`, null, { "content-type": "application/json" });
  check("…and events for a connection without live updates are turned away", r.s === 404, r.s);
  r = await admin.admin("frameioLive", { id: FIOC, on: false });
  check("switching live updates off removes the webhooks from Frame.io", r.s === 200 && r.d.on === false && (await fake()).frameio.webhooks.length === 0, J(r.d));
  r = await rae.act("frameioLive", { id: FIOC, on: true });
  check("clients can't switch live updates", r.s === 400 || r.s === 403, r.s);
  await admin.admin("personDelete", { id: quinn });   // later sections count Harbor Labs' people
}

// ---- Frame.io (Adobe sign-in)
r = await admin.admin("connectionCreate", { provider: "frameio", name: "Frame.io (Adobe)", values: { auth: "oauth", clientId: "fio-client", clientSecret: "fio-secret" } });
check("Adobe sign-in connection waits for sign-in", r.s === 201 && r.d.test.needsSignIn === true, J(r.d));
const OAC = r.d.id;
r = await admin.req("GET", `/api/connect?start=${OAC}`);
const loc = r.h.get("location") || "";
check("“Sign in with Adobe” sends staff to Adobe with the portal's callback", r.s === 302 && loc.startsWith("https://ims-na1.adobelogin.com/ims/authorize/v2?") && loc.includes("redirect_uri=http%3A%2F%2Flocalhost%3A4400%2Fapi%2Fconnect") && /offline_access/.test(decodeURIComponent(loc)), loc);
const state = new URL(loc).searchParams.get("state");
r = await dana.req("GET", `/api/connect?code=good-code&state=${encodeURIComponent(state)}`);
check("someone else can't finish another person's sign-in", r.s === 302 && /started this/.test(decodeURIComponent(r.h.get("location"))), r.h.get("location"));
r = await admin.req("GET", `/api/connect?code=good-code&state=${encodeURIComponent(state)}`);
check("Adobe's callback stores the sign-in and returns to Studio", r.s === 302 && (r.h.get("location") || "").includes("connected=" + OAC), r.h.get("location"));
r = await admin.admin("connectionTest", { id: OAC });
check("the signed-in Frame.io connection works (token refresh included)", r.s === 200 && r.d.test.ok === true, J(r.d));

// ================= connections: Wistia =================
r = await admin.admin("connectionCreate", { provider: "wistia", values: { token: "wistia-token" } });
check("Wistia connects", r.s === 201 && r.d.test.ok === true, J(r.d));
const WIC = r.d.id;
r = await admin.get(`/api/admin?sources=${WIC}`);
check("Wistia projects listed", r.d.sources[0].id === "501", J(r.d));
r = await admin.admin("projectCreate", { clientId: DESERT_MOTO, title: "Product Demo", source: { conn: WIC, ref: "wproj00001" }, caps: { download_source: true } });
check("a Wistia project can be chosen by the ID in its address", r.s === 201, J(r.d));
const WP = r.d.id;
r = await rob.get("/api/portal");
const wp = r.d.projects.find((p) => p.id === WP);
check("Wistia: versions by name, films play the MP4 file directly", wp.cuts[0].versions[0].n === 2 && wp.films[0].title === "Customer Story" && wp.films[0].playback.kind === "file" && /\/file\.mp4$/.test(wp.films[0].playback.url), J([wp.cuts, wp.films]));
r = await rob.get(`/api/media?project=${WP}&video=wmdemo0003`);
check("Wistia downloads (original, HD, web) and caption files", r.s === 200 && r.d.downloads.links.length === 3 && r.d.downloads.links[0].source && /disposition=attachment/.test(r.d.downloads.links[0].link) && r.d.captions[0].text.includes("Hello"), J(r.d));

// ================= video links =================
r = await admin.admin("projectCreate", { clientId: DESERT_MOTO, title: "Links Project" });
const LP = r.d.id;
r = await admin.admin("linkAdd", { projectId: LP, url: "https://example.com/page" });
check("a link that can't play in the portal is refused, with what works", r.s === 400 && /YouTube, Vimeo/.test(r.d.error), J(r.d));
r = await admin.admin("linkAdd", { projectId: LP, url: "https://vimeo.com/123456789/abcdef1234" });
check("a Vimeo link is added, its title looked up", r.s === 201 && r.d.host === "Vimeo", J(r.d));
r = await admin.admin("linkAdd", { projectId: LP, url: "https://youtu.be/ytAAAAAAAA4", title: "Launch Film" });
r = await admin.admin("linkAdd", { projectId: LP, url: "https://cdn.example.com/final/master.mp4", title: "Launch Film Vertical" });
r = await admin.admin("linkAdd", { projectId: OCEAN, url: "https://youtu.be/ytAAAAAAAA4" });
check("links can't be added to a project on a connected account", r.s === 409);
r = await rob.get("/api/portal");
const lp = r.d.projects.find((p) => p.id === LP);
check("links: “… V1” is a version; the rest are films with the right player", lp.cuts[0].title === "Linked Vimeo Film" && lp.cuts[0].versions[0].video.playback.kind === "vimeo" && lp.cuts[0].versions[0].video.playback.hash === "abcdef1234"
  && lp.films.some((f) => f.playback.kind === "youtube") && lp.films.some((f) => f.playback.kind === "file" && f.playback.url.endsWith("master.mp4")), J([lp.cuts, lp.films]));

// ================= Notion =================
r = await admin.admin("connectionCreate", { provider: "notion", values: { token: "ntn_test_token" } });
check("Notion connects and asks where projects go", r.s === 201 && r.d.test.ok === true && r.d.test.account.name === "Nobleman HQ" && /choose where/.test(r.d.test.notes[0]), J(r.d));
r = await admin.admin("connectionCreate", { provider: "notion", values: { token: "ntn_test_token" } });
check("only one Notion connection", r.s === 409);
r = await admin.get("/api/admin?notion=page&q=studio");
check("pages the Notion connection can see are listed", r.s === 200 && r.d.results[0].title === "Studio HQ", J(r.d));
r = await admin.admin("notionCreateDatabase", { pageId: r.d.results[0].id });
check("the portal creates the projects database", r.s === 200, J(r.d));
let fk = await fake();
const ds = fk.notion.dataSources[0];
check("the database has the portal's columns", ds && ["Name", "Client", "Stage", "Progress", "Review", "Latest version", "Open notes", "Next", "Review by", "Last activity", "Portal", "Portal ID"].every((c) => ds.properties[c]), J(ds && Object.keys(ds.properties)));
const projectCount = (await admin.get("/api/admin")).d.projects.length;
check("every project gets a row", fk.notion.pages.length === projectCount, `${fk.notion.pages.length} rows for ${projectCount} projects`);
const harborRow = fk.notion.pages.find((p) => J(p.properties).includes(HARBOR));
const prop = (row, name) => row.properties[ds.properties[name].id];
check("a row carries stage, progress (as a fraction), review status, the newest versions, and the portal link", prop(harborRow, "Stage").select.name === "Final polish" && prop(harborRow, "Progress").number === 0.88 && prop(harborRow, "Review").select.name === "Waiting on client" && /Harbor Spot V3 \(approved\), Cutdown 15s V1 \(waiting\)/.test(prop(harborRow, "Latest version").rich_text[0].text.content) && prop(harborRow, "Portal").url.endsWith(`/projects/${HARBOR}`), J(harborRow.properties));
await admin.admin("projectUpdate", { id: HARBOR, stage: 5 });
fk = await fake();
check("a change updates the same row, never a duplicate", fk.notion.pages.length === projectCount && prop(fk.notion.pages.find((p) => J(p.properties).includes(HARBOR)), "Stage").select.name === "Delivered");
r = await admin.admin("notionSyncAll");
fk = await fake();
check("syncing everything again still makes no duplicates", r.s === 200 && fk.notion.pages.length === projectCount);
r = await admin.admin("projectDelete", { id: LP, confirm: "Links Project" });
fk = await fake();
check("deleting a project moves its row to Notion's trash", fk.notion.pages.filter((p) => p.in_trash).length === 1);
await admin.admin("projectUpdate", { id: HARBOR, stage: 4 });

// ================= settings =================
r = await anon.get("/api/session");
check("the login photo starts as the camera at night", r.d.signin.image === "/media/login-camera.jpg" && r.d.signin.focus === "right", J(r.d.signin));
r = await admin.admin("settingsSave", { section: "signin", value: { ...r.d.signin, image: "/media/a09.jpg", focus: "center" } });
check("owner picks another of the studio's photos", r.s === 200 && r.d.value.image === "/media/a09.jpg" && r.d.value.focus === "center", J(r.d));
r = await admin.admin("settingsSave", { section: "signin", value: { ...r.d.value, image: "https://elsewhere.example/x.jpg", focus: "sideways" } });
check("a photo from another site, or a made-up side, is ignored", r.d.value.image === "/media/a09.jpg" && r.d.value.focus === "center", J(r.d));
r = await pat.admin("loginImageStart", { size: 1000 });
check("only people who may change settings can upload a login photo", r.s === 403);
r = await admin.admin("loginImageStart", { size: 20 * 1024 ** 2 });
check("a login photo over 8 MB is refused", r.s === 413);
r = await admin.admin("loginImageStart", { size: 1000 });
const photo = r.d;
check("owner gets an upload link for one login photo", r.s === 201 && /^brand\/login-[0-9a-f-]{36}\.jpg$/.test(photo.pathname) && photo.token && photo.image === "upload:" + photo.pathname, J(r.d));
r = await admin.admin("settingsSave", { section: "signin", value: { image: photo.image, focus: "center" } });
check("a photo that never arrived can't be used", r.s === 409 && /didn’t finish uploading/.test(r.d.error), J(r.d));
await fetch(B + "/__blob/?pathname=" + encodeURIComponent(photo.pathname), { method: "PUT", body: Buffer.alloc(1000, 1), headers: { "x-content-type": "image/jpeg" } });
r = await admin.admin("settingsSave", { section: "signin", value: { quote: "An old Murphy’s Law.", image: photo.image, focus: "center" } });
check("once it's uploaded, the photo is saved (and an old Murphy's Law field is dropped)", r.s === 200 && r.d.value.image === photo.image && !("quote" in r.d.value), J(r.d));
r = await anon.get("/api/session");
check("the login screen gets the uploaded photo", r.d.signin.image === photo.image);
let img = await fetch(B + "/api/session?loginImage=00000000-0000-4000-8000-000000000000");
check("the photo address serves only the photo the settings name", img.status === 404);
img = await fetch(B + "/api/session?loginImage=../../projects");
check("…and nothing that isn't a photo id", img.status === 404);
r = await admin.admin("settingsSave", { section: "signin", value: { image: "/media/login-camera.jpg", focus: "right" } });
const blobCalls = fs.readFileSync(new URL("./.work/blob/blob.calls", import.meta.url), "utf8");
check("replacing an uploaded photo deletes it from storage", r.s === 200 && /POST \/__blob\/delete/.test(blobCalls));
r = await admin.admin("settingsSave", { section: "stages", value: [{ name: "Only" }] });
check("fewer than two stages refused", r.s === 400);
r = await admin.admin("settingsSave", { section: "stages", value: [{ name: "Plan", pct: 10 }, { name: "Shoot", pct: 30 }, { name: "Cut", pct: 60 }, { name: "Your review", pct: 80 }, { name: "Polish", pct: 90 }, { name: "Done", pct: 100 }] });
r = await dana.get("/api/portal");
check("renamed stages appear for clients", r.d.stages.join() === "Plan,Shoot,Cut,Your review,Polish,Done" && r.d.projects.find((p) => p.id === HARBOR).stageName === "Polish", J(r.d.stages));
await admin.admin("settingsReset", { section: "stages" });
// ---- moving to another domain (docs/MOVE.md in the website repo) ----
r = await anon.get("/api/session");
const inst = r.d.instance;
check("the website and privacy page follow the portal's address", /^[0-9a-f-]{36}$/.test(inst || "") && r.d.brand.website === r.d.brand.portal.replace("://portal.", "://") && r.d.brand.privacy === r.d.brand.website + "/privacy#portal", J(r.d.brand));
const brandNow = (await admin.get("/api/admin")).d.settings.brand;
const brandIn = { studio: brandNow.studio, support: brandNow.support, replies: brandNow.replies, website: "", privacy: "" };
r = await admin.admin("settingsSave", { section: "brand", value: { ...brandIn, portal: "https://portal.nowhere.invalid" } });
check("a new portal address that doesn't answer yet is refused, saying what to do", r.s === 400 && /doesn’t answer yet/.test(r.d.error) && (await anon.get("/api/session")).d.brand.portal === brandNow.portal, J(r.d));
r = await admin.admin("settingsSave", { section: "brand", value: { ...brandIn, portal: "https://portal.moved.portal.test/" } });
const moved = (await anon.get("/api/session")).d;
check("…one that answers as this same portal is saved, and everything follows it", r.s === 200 && moved.brand.portal === "https://portal.moved.portal.test" && moved.brand.website === "https://moved.portal.test" && moved.brand.privacy === "https://moved.portal.test/privacy#portal" && moved.instance === inst, J(moved.brand));
r = await admin.get("/api/admin?health=1");
const addr = (k) => (r.d.checks.find((c) => c.label === k) || {});
check("the system check confirms the portal's address and that the privacy page opens", addr("Portal address").ok === true && addr("Website and privacy page").ok === true, J([addr("Portal address"), addr("Website and privacy page")]));
r = await admin.admin("settingsSave", { section: "brand", value: { ...brandIn, portal: "https://portal.moved.portal.test", website: "https://www.website.test" } });
check("a website set by hand is kept, with its own privacy page", (await anon.get("/api/session")).d.brand.privacy === "https://www.website.test/privacy#portal");
await admin.admin("settingsReset", { section: "brand" });
check("…and Back to the original returns to the portal's own address", (await anon.get("/api/session")).d.brand.portal === brandNow.portal);
r = await admin.admin("settingsSave", { section: "announcement", value: { text: "The portal is down for maintenance Sunday 6–7 AM." } });
r = await dana.get("/api/portal");
check("an announcement reaches everyone", r.d.announcement && /maintenance/.test(r.d.announcement.text));
await admin.admin("settingsSave", { section: "announcement", value: { text: "" } });
r = await admin.admin("settingsSave", { section: "caps", value: { share: true, upload: true } });
r = await admin.admin("projectCreate", { clientId: DESERT_MOTO, title: "Defaults Check" });
r = await admin.get("/api/admin");
check("new projects start from the default switches", r.d.projects.find((p) => p.title === "Defaults Check").caps.share === true);
r = await admin.admin("settingsSave", { section: "security", value: { staffTwoStep: true } });
check("requiring two-step for staff is refused until the owner uses it", r.s === 400 && /yourself first/.test(r.d.error), J(r.d));

// ================= roles =================
r = await admin.admin("rolesSave", { roles: { editor: { "people.manage": true }, manager: { "staff.manage": true, "settings.manage": true } } });
check("owner adjusts what roles can do", r.s === 200);
r = await admin.get("/api/admin");
check("owner-only permissions can't be granted to producers", r.d.roles.permissions.manager["staff.manage"] === false && r.d.roles.permissions.manager["settings.manage"] === false && r.d.roles.permissions.editor["people.manage"] === true);
r = await eddie.admin("personCreate", { name: "Kim Client", email: "kim@harbor.test", role: "client", access: "viewer", clientId: HARBOR_LABS, send: false });
check("…and it takes effect at once (editor now invites people)", r.s === 201 && /\/link\//.test(r.d.inviteLink) && r.d.emailed === false, J(r.d));
await admin.admin("settingsReset", { section: "roles" });
r = await eddie.admin("personCreate", { name: "Kim2", email: "kim2@harbor.test", role: "client", clientId: HARBOR_LABS });
check("resetting roles to the defaults takes it away again", r.s === 403);

// ================= people: invitations, links, sign-out =================
r = await admin.admin("personCreate", { name: "Mia Chen", email: "mia@northwind.test", role: "client", access: "approver", clientName: "Northwind" });
check("inviting a person: a one-time link, emailed to them", r.s === 201 && /\/link\//.test(r.d.inviteLink) && r.d.emailed === true, J(r.d));
const miaToken = r.d.inviteLink.split("/link/")[1];
m = await mails();
check("the invitation email has the link and the inviter's name", m.some((x) => x.to[0] === "mia@northwind.test" && x.html.includes(miaToken) && /Alexis has set up/.test(x.html)));
const mia = new Agent();
r = await mia.post("/api/session", { action: "redeem", token: miaToken });
check("the invite link signs them in and asks for a password", r.s === 200 && r.d.user.mustChangePassword === true, J(r.d));
r = await new Agent().post("/api/session", { action: "redeem", token: miaToken });
check("an invite link works once", r.s === 400 && /already used/.test(r.d.error));
r = await mia.get("/api/portal");
check("until they choose a password, the portal refuses everything else", r.s === 403 && r.d.mustChangePassword === true);
r = await mia.post("/api/session", { action: "password", next: "short" });
check("short password refused", r.s === 400);
r = await mia.post("/api/session", { action: "password", next: "harbor-lights-2026" });
check("password chosen, without being asked for an old one", r.s === 200 && r.d.user.mustChangePassword === false);
r = await mia.get("/api/portal");
check("then the portal opens on their company's project", r.s === 200 && r.d.projects.some((p) => p.id === NW));
r = await admin.admin("personInvite", { id: ALEXIS });
check("staff can't reset themselves from People", r.s === 400 && /your account/.test(r.d.error));
r = await admin.admin("personInvite", { id: DANA, send: false });
check("for someone who has signed in, it's a password reset link", r.s === 200 && r.d.purpose === "reset" && /\/link\//.test(r.d.link), J(r.d));
r = await admin.admin("personSignOut", { id: DANA });
r = await dana.get("/api/portal");
check("“Sign out everywhere” ends their session at once", r.s === 401);
await dana.login("dana@harbor.test");
r = await pat.admin("personUpdate", { id: RAE, access: "approver" });
check("a producer makes a reviewer a decision maker", r.s === 200);
r = await rae.get("/api/portal");
check("a role change restarts their sessions", r.s === 401);
await rae.login("rae@harbor.test");
await pat.admin("personUpdate", { id: RAE, access: "reviewer" });
await rae.login("rae@harbor.test");
r = await admin.admin("personUpdate", { id: ALEXIS, access: "editor" });
check("nobody changes their own role", r.s === 400);
r = await admin.admin("personDelete", { id: ALEXIS });
check("nobody removes themselves", r.s === 400);
r = await admin.admin("personCreate", { name: "Dup", email: "DANA@harbor.test", role: "client", clientName: "Harbor Labs" });
check("duplicate email refused", r.s === 409, J(r.d));
r = await admin.admin("clientDelete", { id: DESERT_MOTO, confirm: "desert moto" });
check("deleting a client needs its exact name", r.s === 400);

// ================= sign-in links =================
const before = (await mails()).length;
r = await anon.post("/api/session", { action: "requestLink", email: "dana@harbor.test", purpose: "signin", next: `/review/${HARBOR}` });
check("asking for a sign-in link", r.s === 200 && /on its way/.test(r.d.message));
r = await anon.post("/api/session", { action: "requestLink", email: "nobody@nowhere.test", purpose: "signin" });
check("an unknown email gets the same answer (no account fishing)", r.s === 200 && /on its way/.test(r.d.message));
m = await mails();
const signinMail = m.slice(before).filter((x) => x.to[0] === "dana@harbor.test");
check("exactly one email: to the real account, none to the unknown one", m.length - before === 1 && signinMail.length === 1 && /login link/.test(signinMail[0].subject), J(m.slice(before).map((x) => [x.to[0], x.subject])));
const dana2 = new Agent();
r = await dana2.post("/api/session", { action: "redeem", token: linkIn(signinMail[0]), next: `/review/${HARBOR}` });
check("the link signs them straight in and returns them to the page they asked for", r.s === 200 && r.d.user.email === "dana@harbor.test" && r.d.next === `/review/${HARBOR}` && !r.d.user.mustChangePassword, J(r.d));
for (let i = 0; i < 5; i++) await anon.post("/api/session", { action: "requestLink", email: "vic@harbor.test", purpose: "reset" });
r = await anon.post("/api/session", { action: "requestLink", email: "vic@harbor.test", purpose: "reset" });
check("link requests are throttled", r.s === 429);

// ================= two-step sign-in =================
r = await dana.post("/api/session", { action: "twoStepBegin" });
check("turning on two-step: a secret and an authenticator link", r.s === 200 && /^otpauth:\/\/totp\//.test(r.d.uri) && r.d.secret.length >= 32, J(r.d));
const secret = r.d.secret;
r = await dana.post("/api/session", { action: "twoStepEnable", code: "000000" });
check("a wrong code doesn't turn it on", r.s === 400);
r = await dana.post("/api/session", { action: "twoStepEnable", code: totpCode(secret, totpStep()) });
check("the right code turns it on and gives ten recovery codes", r.s === 200 && r.d.recoveryCodes.length === 10, J(r.d));
const recovery = r.d.recoveryCodes;
const d3 = new Agent();
r = await d3.login("dana@harbor.test");
check("now a password alone isn't enough: a code is asked for", r.s === 200 && r.d.twoStep === true && !!r.d.ticket && !d3.cookie, J(r.d));
const ticket = r.d.ticket;
r = await d3.post("/api/session", { action: "twoStep", ticket, code: "123456" });
check("a wrong code is refused", r.s === 401);
r = await d3.post("/api/session", { action: "twoStep", ticket, code: totpCode(secret, totpStep()) });
check("the same code as setup can't be used twice", r.s === 401);
r = await d3.post("/api/session", { action: "twoStep", ticket, code: totpCode(secret, totpStep() + 1) });
check("the next code signs them in", r.s === 200 && !!d3.cookie, J(r.d));
const d4 = new Agent();
r = await d4.login("dana@harbor.test");
r = await d4.post("/api/session", { action: "twoStep", ticket: r.d.ticket, code: recovery[0] });
check("a recovery code works", r.s === 200);
r = await d4.login("dana@harbor.test");
r = await d4.post("/api/session", { action: "twoStep", ticket: r.d.ticket, code: recovery[0] });
check("…once", r.s === 401);
r = await admin.admin("personTwoStepReset", { id: DANA });
check("staff turn off two-step for someone who lost their phone", r.s === 200);
r = await dana.login("dana@harbor.test");
check("then a password works alone again", r.s === 200 && !r.d.twoStep);
// The owner turns it on, then requires it for staff.
r = await admin.post("/api/session", { action: "twoStepBegin" });
const aSecret = r.d.secret;
await admin.post("/api/session", { action: "twoStepEnable", code: totpCode(aSecret, totpStep()) });
r = await admin.admin("settingsSave", { section: "security", value: { staffTwoStep: true } });
check("with their own two-step on, the owner requires it for staff", r.s === 200, J(r.d));
r = await pat.get("/api/portal");
check("staff without it are sent to turn it on first", r.s === 403 && r.d.needsTwoStep === true, J(r.d));
r = await pat.post("/api/session", { action: "twoStepBegin" });
check("…and can do exactly that", r.s === 200);
r = await dana.get("/api/portal");
check("clients aren't affected", r.s === 200);
await admin.admin("settingsSave", { section: "security", value: { staffTwoStep: false } });

// ================= share links =================
r = await dana.act("shareCreate", { projectId: HARBOR, videoId: "5101", days: 7 });
check("a decision maker creates a 7-day share link to a finished film", r.s === 201 && /\/watch\/[\w-]{30,}$/.test(r.d.url), J(r.d));
const shareToken = r.d.url.split("/watch/")[1];
const shareId = r.d.id;
r = await dana.act("shareCreate", { projectId: HARBOR, videoId: "5003" });
check("share links are only for finished films", r.s === 400);
r = await rae.act("shareCreate", { projectId: HARBOR, videoId: "5101" });
check("a reviewer can't create share links", r.s === 403);
r = await anon.get(`/api/share?token=${shareToken}`);
check("anyone with the link sees the film, branded, and nothing else", r.s === 200 && r.d.film.title === "Harbor Summit 2026 Recap" && r.d.studio === "Nobleman Productions" && !J(r.d).includes("Harbor Labs") && !!r.d.expires, J(r.d));
await anon.get(`/api/share?token=${shareToken}`);
r = await dana.get(`/api/portal?shares=${HARBOR}`);
check("the link is listed with its view count", r.d.links[0].views === 2 && r.d.links[0].url.endsWith(shareToken), J(r.d));
r = await dana.act("shareRevoke", { id: shareId });
r = await anon.get(`/api/share?token=${shareToken}`);
check("a turned-off link stops working at once", r.s === 404 && /expired or been turned off/.test(r.d.error));
r = await anon.get(`/api/share?token=not-a-real-token-but-long-enough`);
check("an unknown link says so plainly", r.s === 404);

// ================= client teams =================
r = await rae.act("teamAdd", { name: "Lee", email: "lee@harbor.test" });
check("a reviewer can't add teammates", r.s === 403);
r = await dana.get("/api/portal?team=1");
check("a decision maker sees their company's people", r.s === 200 && r.d.people.length === 4 && r.d.canInvite === true, J(r.d));
r = await dana.act("teamAdd", { name: "Lee Park", email: "lee@harbor.test", access: "viewer" });
check("…adds a teammate, who gets an invitation", r.s === 201 && (await mails()).some((x) => x.to[0] === "lee@harbor.test" && /Dana Whitfield has set up/.test(x.html)));
const LEE = r.d.id;
r = await dana.act("teamUpdate", { id: LEE, access: "reviewer" });
check("…changes their role", r.s === 200);
r = await dana.act("teamRemove", { id: ROB });
check("…can't touch people outside the company", r.s === 404);
r = await dana.act("teamRemove", { id: LEE });
check("…and removes them", r.s === 200);

// ================= milestones and reminders =================
await admin.admin("projectUpdate", { id: HARBOR, next: { label: "Filming day", date: "October 20", what: "Day 2, call time 7 AM", confirm: true } });
r = await rae.act("confirmNext", { projectId: HARBOR });
check("only a decision maker confirms the next milestone", r.s === 403);
r = await dana.act("confirmNext", { projectId: HARBOR });
r = await dana.get("/api/portal");
check("the confirmation is recorded with who and when", r.d.projects.find((p) => p.id === HARBOR).next.confirmedBy === "Dana Whitfield");
r = await admin.admin("projectUpdate", { id: HARBOR, next: { date: "October 21" } });
r = await dana.get("/api/portal");
check("changing the milestone asks for confirmation again", r.d.projects.find((p) => p.id === HARBOR).next.confirmedBy === null);
r = await admin.admin("projectUpdate", { id: OCEAN, reviewDue: "2026-10-05" });
r = await dana.act("decide", { projectId: OCEAN, videoId: "fv000000-0000-4000-8000-000000000002", decision: "approved" });
r = await admin.admin("projectRemind", { id: OCEAN });
check("nothing waiting: no reminder sent", r.s === 409, J(r.d));
await admin.admin("projectUpdate", { id: HARBOR, reviewDue: new Date(Date.now() + 86400e3).toISOString().slice(0, 10) });
await admin.admin("videoSet", { projectId: HARBOR, videoId: "5004", kind: "auto" });
const beforeR = (await mails()).length;
r = await eddie.admin("projectRemind", { id: HARBOR });
m = (await mails()).slice(beforeR);
check("an editor sends a review reminder to the decision makers only", r.s === 200 && r.d.sent === 1 && m.length === 1 && m[0].to[0] === "dana@harbor.test" && /Ready for your review/.test(m[0].subject) && m[0].html.includes(`/review/${HARBOR}`), J([r.d, m.map((x) => [x.to[0], x.subject])]));
r = await anon.req("GET", "/api/cron", null, { authorization: "Bearer wrong" });
check("the daily job refuses callers without the secret", r.s === 401);
r = await anon.req("GET", "/api/cron", null, { authorization: "Bearer cron-secret-test" });
check("the daily job runs: reminders, Frame.io refresh, Notion catch-up, pruning", r.s === 200 && r.d.frameio === 1 && r.d.notion && r.d.notion.synced >= 1 && r.d.pruned === true, J(r.d));

// ================= activity log, exports, health =================
r = await admin.get("/api/admin?audit=1");
const kinds = new Set(r.d.entries.map((e) => e.action));
check("the activity log records sign-ins, decisions, watching, downloads, settings, connections, people", ["signin", "approved", "watched", "downloaded", "settings", "connection.add", "person.create", "share.create", "team.add"].every((k) => kinds.has(k)), J([...kinds]));
check("watching is recorded once a day, not on every play", r.d.entries.filter((e) => e.action === "watched").length === 1);
r = await admin.get(`/api/admin?audit=1&project=${HARBOR}&kind=client`);
check("filtering by project and by clients", r.s === 200 && r.d.entries.every((e) => e.kind === "client" && e.projectId === HARBOR) && r.d.entries.length > 3);
r = await admin.req("GET", "/api/admin?audit=csv", null, {}, true);
check("the log exports as CSV", r.s === 200 && /text\/csv/.test(r.h.get("content-type")) && r.text.startsWith("When (UTC),Who,Kind,What"));
r = await eddie.get("/api/admin?audit=1");
check("an editor can't read the log", r.s === 403);
r = await admin.req("GET", `/api/admin?export=client&id=${HARBOR_LABS}`, null, {}, true);
const ex = JSON.parse(r.text || "{}");
check("a client's data exports as one file (for privacy requests), without passwords", r.s === 200 && ex.client.name === "Harbor Labs" && ex.people.length >= 4 && ex.approvals.length >= 1 && !r.text.includes("password_hash") && !r.text.includes("$2a$"), r.text.slice(0, 200));
r = await admin.req("GET", "/api/admin?export=projects", null, {}, true);
check("projects export as CSV", r.s === 200 && r.text.startsWith("Project,Client,Kind,Stage"));
r = await admin.get("/api/admin?health=1");
check("system health lists every check, with warnings in plain words", r.s === 200 && r.d.checks.length >= 10 && r.d.checks.some((c) => c.label === "Owners" && c.ok === "warn") && !r.d.checks.some((c) => /Setup code|demo/i.test(c.label)), J(r.d && r.d.checks.map((c) => [c.label, c.ok])));

// ================= payments (Stripe) =================
{
  const WHSEC = "whsec_test_portal_secret";
  const fake = async () => (await (await fetch(B + "/__fake/state")).json()).stripe;
  const sign = (body, secret = WHSEC, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  const hook = async (type, object, sig) => {
    const body = JSON.stringify({ id: "evt_" + Math.random().toString(36).slice(2), type, data: { object } });
    const r = await fetch(B + "/api/connect?webhook=stripe", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sig === undefined ? sign(body) : sig }, body });
    let d = null; try { d = await r.json(); } catch {}
    return { s: r.status, d };
  };
  const payOf = async (agent, id) => { const x = await agent.get("/api/portal"); return x.d.projects.flatMap((p) => p.payments || []).find((y) => y.id === id); };

  r = await admin.admin("paymentCreate", { projectId: HARBOR, title: "Deposit (50%)", amount: "4500" });
  check("payments: asking for one needs Stripe connected first", r.s === 409 && /Connect Stripe/.test(r.d.error), J(r.d));
  r = await admin.admin("connectionCreate", { provider: "stripe", values: { secretKey: "hello", currency: "usd" } });
  const stripeId = r.d.id;
  check("payments: a key that isn't a Stripe key is refused by the test", r.s === 201 && r.d.test.ok === false && /isn’t a Stripe secret key/.test(r.d.test.error), J(r.d));
  r = await admin.admin("connectionCreate", { provider: "stripe", values: { secretKey: "sk_test_again" } });
  check("payments: only one Stripe connection", r.s === 409);
  r = await admin.admin("connectionUpdate", { id: stripeId, values: { secretKey: "sk_test_portal_key", webhookSecret: WHSEC, currency: "usd" } });
  check("payments: a test key works, and says it's test mode", r.s === 200 && r.d.test.ok === true && /test mode/.test(r.d.test.account.name) && r.d.test.notes.some((n) => /4242/.test(n)), J(r.d));
  r = await admin.get("/api/admin");
  check("payments: Studio knows it's ready and what the webhook needs, never the keys", r.d.payments.ready === true && r.d.payments.live === false && r.d.payments.webhook === true
    && r.d.payments.endpoint.endsWith("/api/connect?webhook=stripe") && r.d.payments.events.length === 4 && !J(r.d).includes("sk_test_portal_key") && !J(r.d).includes(WHSEC), J(r.d.payments));
  r = await eddie.admin("paymentCreate", { projectId: HARBOR, title: "Deposit (50%)", amount: "4500" });
  check("payments: an editor can't ask for payments", r.s === 403);
  r = await admin.admin("paymentCreate", { projectId: HARBOR, title: "Deposit (50%)", amount: "abc" });
  check("payments: a made-up amount is refused", r.s === 400 && /amount/.test(r.d.error));
  r = await admin.admin("paymentCreate", { projectId: HARBOR, title: "Deposit (50%)", amount: "0.10" });
  check("payments: under 50 cents is refused (Stripe's minimum)", r.s === 400);
  const before = (await mails()).length;
  r = await admin.admin("paymentCreate", { projectId: HARBOR, title: "Deposit (50%)", amount: "$4,500", due: "2026-12-01", note: "Half now, half on delivery." });
  const dep = r.d.id;
  check("payments: owner asks Harbor Labs for $4,500", r.s === 201 && r.d.label === "$4,500.00", J(r.d));
  await new Promise((x) => setTimeout(x, 300));
  const asked = (await mails()).slice(before);
  check("payments: Harbor Labs' decision makers are emailed a link to pay (not Dana, who's using the portal right now)", asked.some((m) => [].concat(m.to).some((t) => t.endsWith("@harbor.test")) && /Deposit \(50%\), \$4,500\.00/.test(m.subject) && /\/payments\//.test(m.html))
    && !asked.some((m) => [].concat(m.to).includes("dana@harbor.test")), J(asked.map((m) => [m.to, m.subject])));
  let x = await payOf(dana, dep);
  r = await dana.get("/api/portal");
  check("payments: Dana sees it due, with the date and note, and can pay", x && x.status === "open" && x.label === "$4,500.00" && x.due === "2026-12-01" && x.note === "Half now, half on delivery." && r.d.payReady === true
    && r.d.projects.find((p) => p.id === HARBOR).caps.pay === true, J(x));
  r = await rae.get("/api/portal");
  check("payments: a reviewer sees it but doesn't pay", r.d.projects.find((p) => p.id === HARBOR).payments.length === 1 && r.d.projects.find((p) => p.id === HARBOR).caps.pay === false);
  r = await rae.act("pay", { paymentId: dep });
  check("payments: …and the server refuses if she tries", r.s === 403 && /decision makers pay/.test(r.d.error), J(r.d));
  r = await rob.act("pay", { paymentId: dep });
  check("payments: another client can't see or pay it", r.s === 404);
  r = await dana.act("pay", { paymentId: dep });
  const s1 = (await fake()).sessions.at(-1);
  check("payments: Pay opens Stripe's checkout for exactly that amount", r.s === 200 && /^https:\/\/checkout\.stripe\.com\//.test(r.d.url) && s1.amount_total === 450000 && s1.currency === "usd"
    && s1.metadata.payment === dep && s1.customer_email === "dana@harbor.test" && s1.success_url.includes(`/payments/${HARBOR}?paid=${dep}&session={CHECKOUT_SESSION_ID}`), J([r.d, s1]));
  r = await dana.act("pay", { paymentId: dep });
  check("payments: pressing Pay again reuses the same checkout (no double charge)", r.d.url === s1.url && (await fake()).sessions.length === 1);
  r = await dana.act("payCheck", { paymentId: dep });
  check("payments: coming back without paying changes nothing", r.s === 200 && r.d.payment.status === "open");
  const paid = await (await fetch(B + "/__stripe/pay?session=" + s1.id)).json();
  r = await hook("checkout.session.completed", paid, sign(JSON.stringify({ wrong: 1 })));
  check("payments: a webhook with a bad signature is refused", r.s === 400);
  r = await hook("checkout.session.completed", paid, sign("x", WHSEC, Math.floor(Date.now() / 1000) - 3600));
  check("payments: …and so is an old one", r.s === 400);
  const before2 = (await mails()).length;
  r = await hook("checkout.session.completed", paid);
  check("payments: Stripe's signed webhook marks it paid", r.s === 200 && r.d.changed === "paid", J(r.d));
  r = await hook("checkout.session.completed", paid);
  check("payments: the same event again changes nothing (nobody is told twice)", r.s === 200 && r.d.changed === null);
  x = await payOf(dana, dep);
  check("payments: Dana sees it paid, and by whom", x.status === "paid" && x.paidBy === "Dana Whitfield" && x.method === "stripe" && x.paidAt, J(x));
  await new Promise((y) => setTimeout(y, 300));
  const told = (await mails()).slice(before2);
  check("payments: the studio is emailed that it's paid", told.some((m) => /Harbor Labs paid \$4,500\.00/.test(m.subject)), J(told.map((m) => m.subject)));

  r = await admin.admin("paymentCreate", { projectId: HARBOR, title: "Balance (50%)", amount: "4500", tell: false });
  const bal = r.d.id;
  r = await dana.act("pay", { paymentId: bal });
  const s2 = (await fake()).sessions.at(-1);
  await fetch(B + "/__stripe/pay?session=" + s2.id);
  r = await dana.act("payCheck", { paymentId: bal });
  check("payments: coming back from Stripe marks it paid even with no webhook", r.s === 200 && r.d.payment.status === "paid", J(r.d));

  r = await admin.admin("paymentCreate", { projectId: HARBOR, title: "Extra edit", amount: "750", tell: false });
  const extra = r.d.id;
  r = await dana.act("pay", { paymentId: extra });
  const s3 = (await fake()).sessions.at(-1);
  const bank = await (await fetch(B + "/__stripe/pay?bank=1&session=" + s3.id)).json();
  r = await hook("checkout.session.completed", bank);
  check("payments: a bank payment shows as on its way until it clears", r.d.changed === "processing" && (await payOf(dana, extra)).status === "processing", J(r.d));
  r = await dana.act("pay", { paymentId: extra });
  check("payments: …and can't be paid twice meanwhile", r.s === 409 && /on its way/.test(r.d.error));
  r = await hook("checkout.session.async_payment_failed", bank);
  check("payments: if the bank payment fails, it's open again", r.d.changed === "failed" && (await payOf(dana, extra)).status === "open", J(r.d));

  r = await admin.admin("projectUpdate", { id: HARBOR, caps: { payfirst: true } });
  r = await dana.get(`/api/media?project=${HARBOR}&video=5101`);
  check("payments: with Downloads after payment on, an unpaid request holds downloads", r.d.downloads.held === true && r.d.downloads.links.length === 0 && r.d.downloads.payTo === `/payments/${HARBOR}`, J(r.d.downloads));
  r = await dana.get(`/api/portal`);
  r = await admin.get(`/api/media?project=${HARBOR}&video=5101`);
  check("payments: …never for staff", !r.d.downloads.held && r.d.downloads.links.length > 0);
  r = await eddie.admin("paymentMarkPaid", { id: extra, how: "Check" });
  check("payments: an editor can't mark payments paid", r.s === 403);
  r = await admin.admin("paymentMarkPaid", { id: extra, how: "Check" });
  x = await payOf(dana, extra);
  check("payments: paid another way, marked by the studio", r.s === 200 && x.status === "paid" && x.method === "outside" && /Recorded by Alexis \(Check\)/.test(x.paidBy), J(x));
  r = await dana.get(`/api/media?project=${HARBOR}&video=5101`);
  check("payments: once everything is paid, downloads open", !r.d.downloads.held && r.d.downloads.links.length > 0, J(r.d.downloads));
  await admin.admin("projectUpdate", { id: HARBOR, caps: { payfirst: false } });

  r = await admin.admin("paymentCreate", { projectId: HARBOR, title: "Rush fee", amount: "300", tell: false });
  const rush = r.d.id;
  await dana.act("pay", { paymentId: rush });
  const s4 = (await fake()).sessions.at(-1);
  r = await admin.admin("paymentCancel", { id: rush });
  check("payments: canceling a request stops its checkout", r.s === 200 && (await fake()).sessions.find((y) => y.id === s4.id).status === "expired");
  check("payments: …and the client no longer sees it", !(await payOf(dana, rush)));
  r = await admin.admin("paymentCancel", { id: dep });
  check("payments: a paid one can't be canceled", r.s === 409);

  r = await hook("charge.refunded", { object: "charge", payment_intent: paid.payment_intent, refunded: true });
  check("payments: a full refund in Stripe shows as refunded", r.d.changed === "refunded" && (await payOf(dana, dep)).status === "refunded", J(r.d));

  r = await admin.admin("paymentCreate", { projectId: HARBOR, title: "Music license", amount: "200", tell: false });
  const lic = r.d.id;
  await dana.act("pay", { paymentId: lic });
  await fetch(B + "/__stripe/pay?session=" + (await fake()).sessions.at(-1).id);
  r = await anon.req("GET", "/api/cron", null, { authorization: "Bearer cron-secret-test" });
  check("payments: the daily job catches a payment whose webhook never came", r.d.payments >= 1 && (await payOf(dana, lic)).status === "paid", J(r.d));

  r = await admin.get("/api/admin?health=1");
  check("payments: the system check reports Stripe", r.d.checks.some((c) => c.label === "Payments" && c.ok === true && /test mode/.test(c.detail)), J(r.d.checks.find((c) => c.label === "Payments")));
}

// ================= removing things =================
r = await admin.admin("connectionDelete", { id: YTC });
check("removing a connection that projects use asks first", r.s === 409 && r.d.inUse === 1);
r = await admin.admin("connectionDelete", { id: YTC, force: true });
r = await admin.get("/api/admin");
check("…and then leaves those projects without a source", r.d.projects.find((p) => p.id === NW).source === null && !r.d.connections.some((c) => c.id === YTC));
r = await admin.admin("personDelete", { id: ROB });
check("staff remove a person", r.s === 200);
r = await rob.get("/api/portal");
check("their session stops at once", r.s === 401);

// ================= sign-up =================
// Each request comes from its own address, so these don't share the link throttle with the tests above.
let mb = 0;
const IP = (n) => ({ "x-forwarded-for": "203.0.113." + n });
const newcomer = new Agent();
r = await newcomer.get("/api/session");
check("the login screen offers sign-up when email works", r.d.signup === true, J(r.d));
r = await newcomer.post("/api/session", { action: "signup", name: "Zoe Newman", email: "zoe@newco.test" }, IP(1));
check("sign-up needs a company", r.s === 400 && /company/.test(r.d.error), J(r.d));
mb = (await mails()).length;
r = await newcomer.post("/api/session", { action: "signup", name: "Zoe Newman", email: "Zoe@NewCo.test", company: "Newco", note: "Launch film for March." }, IP(1));
m = await mails();
const zoeMail = m.slice(mb).find((x) => x.to[0] === "zoe@newco.test");
check("sign-up emails a link to confirm the address, and nothing else happens yet", r.s === 200 && /Check your email/.test(r.d.message) && zoeMail && /Confirm your email/.test(zoeMail.subject) && !!linkIn(zoeMail), J([r.d, m.slice(mb).map((x) => x.subject)]));
r = await admin.get("/api/admin");
check("an unconfirmed sign-up isn't an account or a request yet", !r.d.people.some((p) => p.email === "zoe@newco.test") && !r.d.signups.some((x) => x.email === "zoe@newco.test"));
const zoeLink = linkIn(zoeMail);
r = await newcomer.post("/api/session", { action: "redeem", token: zoeLink });
check("confirming puts them on the studio's list (no matching company)", r.s === 200 && r.d.signup === "waiting" && r.d.name === "Zoe Newman" && !newcomer.cookie, J(r.d));
r = await newcomer.post("/api/session", { action: "redeem", token: zoeLink });
check("the confirmation link works once", r.s === 400, J(r.d));
mb = (await mails()).length;
r = await newcomer.post("/api/session", { action: "signup", name: "Zoe Newman", email: "zoe@newco.test", company: "Newco" }, IP(2));
check("signing up again while waiting doesn't send more email", r.s === 200 && (await mails()).length === mb, J(r.d));
r = await admin.get("/api/admin");
const zoeReq = r.d.signups.find((x) => x.email === "zoe@newco.test");
check("Studio lists the request with their company and note", !!zoeReq && zoeReq.company === "Newco" && zoeReq.note === "Launch film for March." && zoeReq.match === null && !!zoeReq.confirmed, J(r.d.signups));
r = await admin.get("/api/portal");
check("staff home counts who's waiting", r.d.signups >= 1, r.d.signups);
r = await eddie.admin("signupApprove", { id: zoeReq.id, clientName: "Newco", access: "approver" });
check("an editor can't approve requests", r.s === 403);
r = await eddie.get("/api/admin");
check("…and doesn't see them", Array.isArray(r.d.signups) && r.d.signups.length === 0);
mb = (await mails()).length;
r = await pat.admin("signupApprove", { id: zoeReq.id, clientName: "Newco", access: "approver" });
check("a producer approves them into a new client, and they're emailed an invitation", r.s === 200 && /\/link\//.test(r.d.inviteLink) && r.d.emailed === true && (await mails()).slice(mb).some((x) => x.to[0] === "zoe@newco.test" && /portal is ready/.test(x.subject)), J(r.d));
r = await pat.admin("signupApprove", { id: zoeReq.id, clientName: "Newco" });
check("a request can't be approved twice", r.s === 404);
r = await admin.get("/api/admin");
const zoeP = r.d.people.find((p) => p.email === "zoe@newco.test");
check("…as a decision maker at Newco, waiting to choose a password", zoeP && zoeP.clientName === "Newco" && zoeP.access === "approver" && zoeP.invited && !r.d.signups.some((x) => x.id === zoeReq.id), J(zoeP));

// Declined.
mb = (await mails()).length;
await newcomer.post("/api/session", { action: "signup", name: "Yan Other", email: "yan@other.test", company: "Other Co" }, IP(3));
const yanLink = linkIn((await mails()).slice(mb).find((x) => x.to[0] === "yan@other.test"));
await newcomer.post("/api/session", { action: "redeem", token: yanLink });
r = await admin.get("/api/admin");
const yanReq = r.d.signups.find((x) => x.email === "yan@other.test");
mb = (await mails()).length;
r = await admin.admin("signupDecline", { id: yanReq.id });
check("declining tells them kindly, and no account is made", r.s === 200 && r.d.told === true && (await mails()).slice(mb).some((x) => x.to[0] === "yan@other.test" && /About your/.test(x.subject)) && !(await admin.get("/api/admin")).d.people.some((p) => p.email === "yan@other.test"));

// Joining by email domain.
r = await admin.admin("clientUpdate", { id: HARBOR_LABS, domains: "gmail.com" });
check("a client can't claim a free email service's domain", r.s === 400 && /free email/.test(r.d.error), J(r.d));
r = await admin.admin("clientUpdate", { id: HARBOR_LABS, domains: "not a domain" });
check("…or something that isn't a domain", r.s === 400, J(r.d));
r = await admin.admin("clientUpdate", { id: HARBOR_LABS, domains: "@Harbor.test, harbor.test" });
check("a client lists its email domain", r.s === 200);
r = await admin.get("/api/admin");
check("…cleaned up and shown in Studio", J(r.d.clients.find((c) => c.id === HARBOR_LABS).domains) === J(["harbor.test"]), J(r.d.clients.find((c) => c.id === HARBOR_LABS).domains));
r = await admin.admin("clientUpdate", { id: DESERT_MOTO, domains: "harbor.test" });
check("two clients can't share a domain", r.s === 400 && /already belongs to Harbor Labs/.test(r.d.error), J(r.d));
mb = (await mails()).length;
const max = new Agent();
await max.post("/api/session", { action: "signup", name: "Max Harbor", email: "max@harbor.test", company: "Harbor" }, IP(4));
r = await max.post("/api/session", { action: "redeem", token: linkIn((await mails()).slice(mb).find((x) => x.to[0] === "max@harbor.test")) });
check("someone at a client's domain joins it straight away, as a reviewer, and chooses a password next", r.s === 200 && r.d.user && r.d.user.clientName === "Harbor Labs" && r.d.user.access === "reviewer" && r.d.user.mustChangePassword === true && !!max.cookie, J(r.d));
r = await max.post("/api/session", { action: "password", next: "max-own-password-1" });
r = await max.get("/api/portal");
check("…and then sees their company's projects, with a reviewer's limits", r.s === 200 && r.d.projects.some((p) => p.id === HARBOR) && r.d.projects.find((p) => p.id === HARBOR).caps.approve === false, J(r.d && r.d.projects.map((p) => [p.title, p.caps.approve])));
r = await admin.get("/api/admin?audit=1&q=email domain");
check("joining by domain is in the activity log", r.d.entries.some((e) => e.action === "signup.joined"), J(r.d.entries.map((e) => e.summary)));

// Someone who already has an account.
mb = (await mails()).length;
r = await newcomer.post("/api/session", { action: "signup", name: "Dana", email: "dana@harbor.test", company: "Harbor Labs" }, IP(5));
const danaMail = (await mails()).slice(mb).find((x) => x.to[0] === "dana@harbor.test");
check("signing up with an existing account gets the same answer, and a way in by email", r.s === 200 && /Check your email/.test(r.d.message) && danaMail && /already have/.test(danaMail.subject) && !!linkIn(danaMail), J(r.d));

// Switched off.
r = await admin.admin("settingsSave", { section: "security", value: { signup: "off" } });
r = await newcomer.get("/api/session");
check("with sign-up off, the login screen doesn't offer it", r.d.signup === false);
r = await newcomer.post("/api/session", { action: "signup", name: "Ann", email: "ann@x.test", company: "X" }, IP(6));
check("…and the server refuses it", r.s === 403, J(r.d));
await admin.admin("settingsSave", { section: "security", value: { signup: "request" } });

// ================= a project's own link (/join/<token>) =================
{
  // The owner's session from the start (two-step is on for that account by now); fresh logins for the clients.
  const st = admin, dd = new Agent(), rb = new Agent(), nia = new Agent(), lee = new Agent(), outsider = new Agent();
  // Mia is at another company (Northwind, from the invitations section).
  const okLogins = (await dd.login("dana@harbor.test")).s === 200 && (await rb.login("mia@northwind.test", "harbor-lights-2026")).s === 200;
  r = await st.admin("projectCreate", { clientId: HARBOR_LABS, title: "Harbor Launch Film" });
  const LAUNCH = r.d.id, link = r.d.link || "";
  const token = (link.match(/\/join\/([\w-]+)$/) || [])[1];
  check("a new project comes with its own link for the client", okLogins && r.s === 201 && !!token && link.startsWith("http://localhost:4400/join/"), J(r.d));
  r = await outsider.get("/api/session?join=" + token);
  check("the link says which project it opens and what joining gives, and nothing else", r.s === 200 && r.d.project.title === "Harbor Launch Film" && r.d.project.client === "Harbor Labs" && r.d.role === "approver" && r.d.can.includes("Approve a version, or ask for changes") && r.d.user === null && !r.d.project.id, J(r.d));
  r = await outsider.get("/api/session?join=not-a-real-token-at-all-000");
  check("a wrong link says so plainly", r.s === 404 && /isn’t working/.test(r.d.error), J(r.d));
  r = await nia.post("/api/session", { action: "join", token, name: "Nia New", email: "nia@agency.test", password: "nia-password-1" }, IP(21));
  check("joining needs the acknowledgement ticked", r.s === 400 && /Tick the box/.test(r.d.error), J(r.d));
  r = await nia.post("/api/session", { action: "join", token, name: "Nia New", email: "nia@agency.test", password: "short", agree: true }, IP(21));
  check("…and a password of 10 characters or more", r.s === 400 && /at least 10/.test(r.d.error), J(r.d));
  r = await nia.post("/api/session", { action: "join", token, name: "Nia New", email: "Nia@Agency.test", password: "nia-password-1", agree: true }, IP(21));
  check("someone with the link creates a login and is in straight away, nothing to approve", r.s === 200 && r.d.joined === true && r.d.projectId === LAUNCH && r.d.user.clientName === "Harbor Labs" && r.d.user.access === "approver" && r.d.user.allProjects === false && !r.d.user.mustChangePassword && !!nia.cookie, J(r.d));
  r = await nia.get("/api/portal");
  check("…and sees only that project, not the rest of the company's", r.s === 200 && r.d.projects.length === 1 && r.d.projects[0].id === LAUNCH, J(r.d && r.d.projects.map((p) => p.title)));
  r = await nia.get(`/api/portal?thread=${HARBOR}`);
  check("…and can't reach another of the company's projects directly", r.s === 404, r.s);
  check("…and can't manage the company's team (that's for people who see all its projects)", (await nia.get("/api/portal")).d.user.perms.team === false && (await nia.act("teamAdd", { name: "X", email: "x@agency.test" })).s === 403);
  r = await nia.login("nia@agency.test", "nia-password-1");
  check("…and logs in again later with the password they chose", r.s === 200 && r.d.user.name === "Nia New", J(r.d));
  r = await outsider.post("/api/session", { action: "join", token, name: "Dana", email: "dana@harbor.test", password: "any-password-1", agree: true }, IP(22));
  check("an email that already has a login is asked to log in instead, never taken over", r.s === 409 && r.d.exists === true && /Log in/.test(r.d.error), J(r.d));
  r = await rb.get("/api/session?join=" + token);
  check("someone logged in sees the project isn't theirs yet", r.s === 200 && r.d.user && r.d.user.name === "Mia Chen" && r.d.member === false, J(r.d));
  r = await rb.post("/api/session", { action: "join", token });
  const robSees = (await rb.get("/api/portal")).d.projects.map((p) => p.id);
  check("…and adds it to their login with one press, even from another company, keeping their own company's projects", r.s === 200 && r.d.joined === true && robSees.includes(LAUNCH) && robSees.includes(NW), J(robSees));
  r = await dd.get("/api/session?join=" + token);
  check("someone who already sees every company project is told it's already theirs", r.s === 200 && r.d.member === true, J(r.d));
  r = await st.get("/api/admin");
  let lp = r.d.projects.find((p) => p.id === LAUNCH);
  const niaRow = r.d.people.find((p) => p.email === "nia@agency.test");
  check("Studio shows the link and who joined with it", lp.join.link === link && lp.join.off === false && lp.join.access === "approver" && lp.join.people.map((x) => x.name).sort().join() === "Mia Chen,Nia New", J(lp.join));
  check("…and each person's projects: Nia sees only the one she joined", niaRow.allProjects === false && J(niaRow.projects) === J([LAUNCH]), J(niaRow));
  check("older projects get their own link too", r.d.projects.filter((p) => !p.archived).every((p) => /\/join\/[\w-]{20,}$/.test(p.join.link)), J(r.d.projects.map((p) => p.join)));
  // (Staff using the portal right now aren't emailed: they see it there.)
  check("staff are told when someone joins", (await mails()).some((x) => /Nia New joined Harbor Launch Film/.test(x.subject) && /@studio\.test$|@gotit2work\.com$/.test(x.to[0])), J((await mails()).slice(-5).map((x) => [x.to[0], x.subject])));
  r = await st.admin("joinLink", { projectId: LAUNCH, op: "role", access: "reviewer" });
  check("staff choose what people who join can do", r.s === 200 && r.d.access === "reviewer", J(r.d));
  r = await lee.post("/api/session", { action: "join", token, name: "Lee Reviewer", email: "lee@agency.test", password: "lee-password-1", agree: true }, IP(23));
  check("…and the next person joins with that role", r.s === 200 && r.d.user.access === "reviewer", J(r.d));
  r = await st.admin("joinLink", { projectId: LAUNCH, op: "new" });
  const token2 = (r.d.link.match(/\/join\/([\w-]+)$/) || [])[1];
  check("“Make a new link”: the old one stops working at once", r.s === 200 && token2 && token2 !== token && (await outsider.get("/api/session?join=" + token)).s === 404 && (await outsider.get("/api/session?join=" + token2)).s === 200, J(r.d));
  check("…and people who already joined keep the project", (await nia.get("/api/portal")).d.projects.some((p) => p.id === LAUNCH));
  r = await st.admin("joinLink", { projectId: LAUNCH, op: "off" });
  check("switching the link off stops it", r.s === 200 && r.d.off === true && r.d.link === null && (await outsider.get("/api/session?join=" + token2)).s === 404, J(r.d));
  r = await st.admin("joinLink", { projectId: LAUNCH, op: "on" });
  check("…and switching it on brings the same link back", r.s === 200 && r.d.link && r.d.link.endsWith(token2), J(r.d));
  r = await rae.admin("joinLink", { projectId: LAUNCH, op: "new" });
  check("clients can't change a project's link", r.s === 403, r.s);
  r = await eddie.admin("joinLink", { projectId: LAUNCH, op: "new" });
  check("…nor can staff whose role doesn't manage people", r.s === 403, r.s);
  r = await st.admin("personUpdate", { id: niaRow.id, allProjects: true });
  check("staff can let someone see every project of their company", r.s === 200 && (await nia.get("/api/portal")).d.projects.some((p) => p.id === HARBOR));
  await st.admin("personUpdate", { id: niaRow.id, allProjects: false, projectIds: [LAUNCH] });
  r = await st.admin("projectPersonRemove", { projectId: LAUNCH, userId: niaRow.id });
  check("…or take someone off a project: they no longer see it, and their login stays", r.s === 200 && (await nia.get("/api/portal")).d.projects.length === 0 && (await nia.get("/api/session")).d.user.email === "nia@agency.test");
  await st.admin("projectUpdate", { id: LAUNCH, archived: true });
  check("an archived project's link doesn't work", (await outsider.get("/api/session?join=" + token2)).s === 404);
  r = await st.get("/api/admin?audit=1&q=link");
  check("joining and link changes are in the activity log", ["join", "project.link"].every((a) => r.d.entries.some((e) => e.action === a)), J(r.d.entries.map((e) => e.action)));
  check("the activity log records the acknowledgement", r.d.entries.some((e) => e.action === "join" && /confirmed they’re working on it/.test(e.summary)), J(r.d.entries.filter((e) => e.action === "join").map((e) => e.summary)));
}

// ================= security edges =================
r = await admin.post("/api/admin", { action: "clientCreate", name: "Evil" }, { origin: "https://evil.example" });
check("cross-origin POST refused", r.s === 403);
r = await admin.post("/api/admin", { action: "clientCreate", name: "Same" }, { origin: "http://localhost:4400" });
check("same-origin POST allowed", r.s === 201);
const thr = new Agent();
let last;
for (let i = 0; i < 9; i++) last = await thr.login("mia@northwind.test", "nope-" + i);
check("sign-in pauses after repeated failures (429)", last.s === 429, last.s);

// ================= emails =================
m = await mails();
check("emails go to the right people and never to whoever acted", m.every((x) => !(x.to[0] === "dana@harbor.test" && /Dana Whitfield (left|approved|asked)/.test(x.subject))), J(m.map((x) => [x.to[0], x.subject])));
check("every email carries the studio's name and a button to the right page", m.every((x) => x.html.includes("Nobleman Productions")) && m.filter((x) => /left a note/.test(x.subject)).every((x) => x.html.includes("/review/")));

// ================= a garbled session cookie =================
{
  const g = await fetch(B + "/api/session", { headers: { cookie: "np_session=%E0%A4%A" } });
  const d = await g.json().catch(() => ({}));
  check("a garbled session cookie reads as logged out, not a server error", g.status === 200 && !d.user, g.status);
}

// ================= first run: the studio's first owner (OWNER_EMAILS) claims the empty portal =================
const fm = async () => (await (await fetch(FRESH + "/__mail")).json());
const f = new Agent(FRESH);
r = await f.get("/api/session");
check("an empty portal opens for its first owner, with no setup code and no demo", r.d.firstRun === true && r.d.signup === true && !("setup" in r.d) && !("demoAtRoot" in r.d), J(r.d));
r = await f.post("/api/session", { action: "signup", name: "Eve", email: "eve@x.test" });
check("…nobody else can create an account yet", r.s === 403 && /isn’t open/.test(r.d.error), J(r.d));
r = await f.post("/api/session", { action: "setup", code: "anything", name: "Eve", email: "eve@x.test", password: "a-good-long-password" });
check("…and the old setup code no longer exists", r.s >= 400 && !(await f.get("/api/session")).d.user);
let fmb = (await fm()).length;
r = await f.post("/api/session", { action: "signup", name: "Jean Gotay", email: "  JeanCGotay@gmail.com " });
const jeanMail = (await fm()).slice(fmb).find((x) => x.to[0] === "jeancgotay@gmail.com");
check("the owner's address (any capitals) gets a confirmation email, with no company asked", r.s === 200 && !!jeanMail && !!linkIn(jeanMail), J(r.d));
r = await f.post("/api/session", { action: "redeem", token: linkIn(jeanMail) });
check("confirming makes them the owner, who then chooses a password", r.s === 200 && r.d.user.role === "admin" && r.d.user.access === "owner" && r.d.user.mustChangePassword === true, J(r.d));
r = await f.post("/api/session", { action: "password", next: "jean-owner-password-1" });
check("…and the password is saved", r.s === 200, J(r.d));
const jean2 = new Agent(FRESH);
r = await jean2.post("/api/session", { action: "login", email: "jean@noblemanproductions.com", password: "jean-owner-password-1" });
check("the owner's second address logs into the same account", r.s === 200 && r.d.user.email === "jeancgotay@gmail.com" && r.d.user.access === "owner", J(r.d));
r = await f.get("/api/session");
check("once there's an owner, the portal is no longer in its first run", r.d.firstRun === false);
r = await (new Agent(FRESH)).get("/api/session");
check("…for anyone", r.d.firstRun === false);
fmb = (await fm()).length;
r = await (new Agent(FRESH)).post("/api/session", { action: "signup", name: "Imposter", email: "jean@noblemanproductions.com", company: "Imposter Co" });
const again = (await fm()).slice(fmb).find((x) => x.to[0] === "jean@noblemanproductions.com");
check("signing up again with the second address only emails the owner a way to log in, never a second owner", r.s === 200 && !!again && !/Confirm your email/.test(again.subject), J(again && again.subject));
r = await f.admin("personCreate", { name: "Other", email: "jean@noblemanproductions.com", role: "admin", access: "editor" });
check("nobody else can be given the owner's second address", r.s === 409, J(r));
r = await f.admin("personCreate", { name: "Justin", email: "justin@nobleman.test", role: "admin", access: "owner" });
check("the owner can add the rest of the team (Justin, as an owner)", r.s === 200 || r.s === 201, J(r));
r = await f.get("/api/admin");
check("the owner's Studio works on the fresh database", r.s === 200 && r.d.people.length === 2 && r.d.me.perms["settings.manage"] === true);
r = await (new Agent(FRESH)).post("/api/session", { action: "signup", name: "Ana", email: "ana@client.test", company: "Client Co" });
check("after that, new accounts follow the studio's setting (asking to join)", r.s === 200, J(r.d));
r = await (new Agent(FRESH)).get("/api/portal?demo=1");
check("the sample portal is only for logged-in studio staff", r.s === 401);
r = await f.get("/api/portal?demo=1");
check("…which the owner can open", r.s === 200 && r.d.demo === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
