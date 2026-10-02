// Portal API: sign-in, setup, password rules, scoping, capabilities, notes, decisions, messages, Vimeo media and
// uploads, Blob files, Studio actions, cross-origin refusal, throttling, emails.
// Usage: node api.test.mjs  (servers from ./run.sh, freshly started: 4400 seeded, 4402 empty)
const B = "http://localhost:4400", FRESH = "http://localhost:4402";
const DANA = "22222222-0000-4000-8000-000000000002", ROB = "33333333-0000-4000-8000-000000000003";
const HARBOR = "cccccccc-0000-4000-8000-000000000001", DESERT = "dddddddd-0000-4000-8000-000000000002";
let pass = 0, fail = 0;
const check = (l, c, x = "") => { c ? pass++ : fail++; if (!c || process.env.VERBOSE) console.log((c ? "PASS " : "FAIL ") + l + (x ? "  " + String(x).slice(0, 400) : "")); };

class Agent {
  constructor(base) { this.base = base; this.cookie = ""; }
  async req(method, path, body, headers = {}) {
    const r = await fetch(this.base + path, {
      method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of set) { const v = c.split(";")[0]; this.cookie = /=$/.test(v) || /Max-Age=0/.test(c) ? "" : v; }
    let data = null; try { data = await r.json(); } catch {}
    return { s: r.status, d: data };
  }
  get(p) { return this.req("GET", p); }
  post(p, b, h) { return this.req("POST", p, b, h); }
  login(email, password = "portal-test-pass") { return this.post("/api/session", { action: "login", email, password }); }
}

// ---- sign-in
const anon = new Agent(B);
let r = await anon.get("/api/portal");
check("signed out: portal data refused (401)", r.s === 401, r.s);
r = await anon.get("/api/portal?demo=1");
check("demo data is public and marked demo", r.s === 200 && r.d.demo === true && r.d.projects.length === 2, r.s);
r = await anon.login("dana@harbor.test", "wrong-password");
check("wrong password: 401 with a helpful message", r.s === 401 && /don’t match/.test(r.d.error), JSON.stringify(r.d));
const dana = new Agent(B), rob = new Agent(B), admin = new Agent(B);
r = await dana.login("dana@harbor.test");
check("client signs in", r.s === 200 && r.d.user.role === "client" && r.d.user.clientName === "Harbor Labs" && !!dana.cookie, JSON.stringify(r.d));
await rob.login("rob@moto.test");
r = await admin.login("Alexis@GotIT2Work.com");
check("admin signs in (email is case-insensitive)", r.s === 200 && r.d.user.role === "admin", JSON.stringify(r.d));

// ---- what Dana sees
r = await dana.get("/api/portal");
const hp = r.d && r.d.projects.find((p) => p.id === HARBOR);
check("client sees only their own client's projects", r.s === 200 && r.d.projects.length === 1 && !!hp, JSON.stringify(r.d && r.d.projects.map((p) => p.title)));
check("versions grouped: Harbor Spot V1–V3 and Cutdown 15s V1", hp && hp.cuts.length === 2 && hp.cuts.find((c) => c.title === "Harbor Spot").versions.map((v) => v.n).join() === "1,2,3", JSON.stringify(hp && hp.cuts.map((c) => [c.title, c.versions.map((v) => v.n)])));
check("finished films: recap + teaser; still-transcoding video left out", hp && hp.films.map((f) => f.title).sort().join() === "Harbor Summit Recap,Vertical Teaser", JSON.stringify(hp && hp.films.map((f) => f.title)));
const recap = hp.films.find((f) => f.title === "Harbor Summit Recap"), teaser = hp.films.find((f) => f.title === "Vertical Teaser");
check("share on: unlisted film gets its link, hidden film gets none", recap.link === "https://vimeo.com/5101/bbb1" && teaser.link === null, JSON.stringify([recap.link, teaser.link]));
check("stats on: play counts included", recap.plays === 487, recap.plays);
check("no Vimeo token or folder ids leak to clients", !JSON.stringify(r.d).includes("test-token") && hp.folder === undefined && hp.clientCaps === undefined);
check("caps reflect the project's settings", hp.caps.download_source === true && hp.caps.upload === true && hp.caps.review === true);
r = await rob.get("/api/portal");
const dp = r.d.projects[0];
check("another client sees their own project with its own caps", dp.id === DESERT && dp.caps.download === false && dp.caps.messages === false && dp.messages === null, JSON.stringify(dp && dp.caps));
check("stats off: no play counts; share off: no links", dp.films[0].plays === undefined && dp.films[0].link === undefined);

// ---- scoping
r = await dana.get(`/api/portal?thread=${DESERT}`);
check("client can't open another client's messages (404)", r.s === 404, r.s);
r = await dana.post("/api/portal", { action: "note", projectId: DESERT, videoId: "6001", at: 3, body: "sneaky" });
check("client can't note on another client's project (404)", r.s === 404, r.s);
r = await dana.post("/api/portal", { action: "note", projectId: HARBOR, videoId: "6001", at: 3, body: "wrong video" });
check("client can't note on a video outside their project's folder", r.s === 400, JSON.stringify(r.d));
r = await dana.get(`/api/media?project=${HARBOR}&video=6101`);
check("media for a video outside the project is refused", r.s === 404, r.s);

// ---- notes
r = await dana.post("/api/portal", { action: "note", projectId: HARBOR, videoId: "5003", at: 12.5, body: "Hold this wide a beat longer." });
check("client leaves a timecoded note", r.s === 201 && !!r.d.id, JSON.stringify(r.d));
const noteId = r.d.id;
r = await admin.post("/api/portal", { action: "note", parentId: noteId, body: "Done in V4." });
check("staff reply to the note", r.s === 201, JSON.stringify(r.d));
r = await dana.post("/api/portal", { action: "note", projectId: HARBOR, videoId: "5003", at: 3, body: "   " });
check("empty note refused", r.s === 400);
r = await dana.get(`/api/portal?notes=${HARBOR}&video=5003`);
check("notes come back with the reply and the time", r.s === 200 && r.d.notes.length === 1 && r.d.notes[0].at === 12.5 && r.d.notes[0].replies.length === 1 && r.d.notes[0].mine === true, JSON.stringify(r.d));
r = await rob.post("/api/portal", { action: "resolve", id: noteId, resolved: true });
check("another client can't touch the note", r.s === 404, r.s);
r = await dana.post("/api/portal", { action: "resolve", id: noteId, resolved: true });
check("client marks the note done", r.s === 200);
r = await rob.post("/api/portal", { action: "deleteNote", id: noteId });
check("another client can't delete it", r.s === 404);

// ---- decisions
r = await admin.post("/api/portal", { action: "decide", projectId: HARBOR, videoId: "5003", decision: "approved" });
check("staff can't approve on the client's behalf", r.s === 403, JSON.stringify(r.d));
r = await dana.post("/api/portal", { action: "decide", projectId: HARBOR, videoId: "5101", decision: "approved" });
check("a finished film (no version) can't be approved", r.s === 400, JSON.stringify(r.d));
r = await dana.post("/api/portal", { action: "decide", projectId: HARBOR, videoId: "5002", decision: "changes" });
check("asking for changes needs a note", r.s === 400, JSON.stringify(r.d));
r = await dana.post("/api/portal", { action: "decide", projectId: HARBOR, videoId: "5002", decision: "changes", note: "Middle feels long." });
check("client asks for changes on V2", r.s === 201 && r.d.decision.decision === "changes");
r = await dana.post("/api/portal", { action: "decide", projectId: HARBOR, videoId: "5003", decision: "approved" });
check("client approves V3", r.s === 201 && r.d.decision.decision === "approved", JSON.stringify(r.d));
r = await dana.get("/api/portal");
const spot = r.d.projects[0].cuts.find((c) => c.title === "Harbor Spot");
check("decisions show on each version", spot.versions[2].decision.decision === "approved" && spot.versions[1].decision.decision === "changes" && spot.versions[1].decision.note === "Middle feels long.");
check("note counts show on the version (resolved note isn't open)", spot.versions[2].comments.total === 2 && spot.versions[2].comments.open === 0, JSON.stringify(spot.versions[2].comments));

// ---- messages
r = await dana.post("/api/portal", { action: "message", projectId: HARBOR, body: "Can we get the recap by Friday?" });
check("client sends a message", r.s === 201 && r.d.message.mine === true);
r = await admin.get("/api/portal");
check("staff see it as unread", r.d.projects.find((p) => p.id === HARBOR).messages.unread === 1, JSON.stringify(r.d.projects.find((p) => p.id === HARBOR).messages));
r = await admin.get(`/api/portal?thread=${HARBOR}`);
check("staff open the thread", r.s === 200 && r.d.messages.length === 1 && r.d.messages[0].mine === false);
r = await admin.get("/api/portal");
check("opening the thread marks it read", r.d.projects.find((p) => p.id === HARBOR).messages.unread === 0);
r = await rob.post("/api/portal", { action: "message", projectId: DESERT, body: "hello" });
check("messages off for the project: refused", r.s === 403 && /isn’t switched on/.test(r.d.error), JSON.stringify(r.d));
r = await admin.post("/api/portal", { action: "message", projectId: DESERT, body: "Staff can still write" });
check("staff can always use every capability", r.s === 201);
r = await dana.get("/api/portal");
check("activity feed lists the recent actions", r.d.activity.length >= 4 && r.d.activity.some((a) => a.type === "approved") && r.d.activity.some((a) => a.type === "message"), JSON.stringify(r.d.activity.map((a) => a.type)));

// ---- Vimeo media
r = await dana.get(`/api/media?project=${HARBOR}&video=5101`);
check("downloads: every size including the original (download_source on)", r.s === 200 && r.d.downloads.links.length === 3 && r.d.downloads.links[0].source === true, JSON.stringify(r.d && r.d.downloads));
check("captions and chapters come back", r.d.captions.length === 1 && r.d.captions[0].link.endsWith(".vtt") && r.d.chapters.map((c) => c.at).join() === "0,48,112", JSON.stringify([r.d.captions, r.d.chapters]));
r = await dana.get(`/api/media?project=${HARBOR}&video=5003`);
check("versions under review aren't downloadable", r.s === 200 && r.d.downloads === null, JSON.stringify(r.d));
r = await dana.get(`/api/media?project=${HARBOR}&video=5103`);
check("no API links + hidden film: no download, plain reason for the client", r.d.downloads.links.length === 0 && r.d.downloads.onVimeo === null && /aren’t ready/.test(r.d.downloads.reason), JSON.stringify(r.d.downloads));
r = await rob.get(`/api/media?project=${DESERT}&video=6101`);
check("downloads off for the project: none offered", r.s === 200 && r.d.downloads === null, JSON.stringify(r.d));
r = await admin.get(`/api/media?project=${DESERT}&video=6101`);
check("staff get the technical reason when Vimeo has no links", r.d.downloads.links.length === 0 && /Standard plan/.test(r.d.downloads.reason), JSON.stringify(r.d.downloads));

// ---- Vimeo upload (tus)
r = await rob.post("/api/media", { action: "uploadStart", projectId: DESERT, name: "x.mp4", size: 10, type: "video/mp4" });
check("uploads off: refused", r.s === 403, JSON.stringify(r.d));
r = await dana.post("/api/media", { action: "uploadStart", projectId: HARBOR, name: "notes.pdf", size: 10, type: "application/pdf" });
check("non-video sent to Vimeo: refused with directions", r.s === 400 && /Files/.test(r.d.error));
r = await dana.post("/api/media", { action: "uploadStart", projectId: HARBOR, name: "Drone_B-roll.mp4", size: 1000, type: "video/mp4" });
check("video upload: Vimeo tus link issued", r.s === 201 && /\/__tus\//.test(r.d.uploadLink), JSON.stringify(r.d));
const up = r.d;
const t = await fetch(up.uploadLink, { method: "PATCH", headers: { "Tus-Resumable": "1.0.0", "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" }, body: Buffer.alloc(1000) });
check("bytes go straight to Vimeo's link", t.status === 204 && t.headers.get("upload-offset") === "1000");
r = await dana.post("/api/media", { action: "uploadDone", uploadId: up.uploadId });
check("upload confirmed", r.s === 200);
await fetch(B + "/__vimeo/finish");
r = await dana.get("/api/portal");
const hp2 = r.d.projects[0];
check("client's upload listed under their uploads, not under films", hp2.videoUploads.length === 1 && hp2.videoUploads[0].status === "done" && !hp2.films.some((f) => /Drone/.test(f.title)), JSON.stringify([hp2.videoUploads, hp2.films.map((f) => f.title)]));
let vstate = await (await fetch(B + "/__vimeo/state")).json();
const drone = vstate["222"].videos.find((v) => /Drone_B-roll/.test(v.name));
check("client footage is named for the client and private on Vimeo", !!drone && drone.name === "From Harbor Labs: Drone_B-roll.mp4" && drone.privacy.view === "nobody" && drone.privacy.embed === "private", JSON.stringify(drone && [drone.name, drone.privacy]));
r = await admin.post("/api/media", { action: "uploadStart", projectId: HARBOR, name: "Harbor Spot V4.mp4", size: 1000, type: "video/mp4" });
vstate = await (await fetch(B + "/__vimeo/state")).json();
const v4 = vstate["222"].videos.find((v) => /Harbor Spot V4/.test(v.name));
check("staff uploads keep their name and can play in the portal (unlisted, embeddable)", r.s === 201 && !!v4 && v4.name === "Harbor Spot V4.mp4" && v4.privacy.view === "unlisted" && v4.privacy.embed === "public", JSON.stringify(v4 && [v4.name, v4.privacy]));
await admin.post("/api/media", { action: "uploadCancel", uploadId: r.d.uploadId });

// ---- Blob files
r = await rob.post("/api/files", { action: "start", projectId: DESERT, name: "a.pdf", size: 10, contentType: "application/pdf" });
check("file upload with uploads off: refused", r.s === 403);
r = await dana.post("/api/files", { action: "start", projectId: HARBOR, name: "Brand Guide 2026.pdf", size: 2048, contentType: "application/pdf" });
check("file upload: token for one private pathname", r.s === 201 && r.d.token.startsWith("vercel_blob_client_teststore_") && r.d.pathname.startsWith(`projects/${HARBOR}/`), JSON.stringify(r.d));
const f1 = r.d;
r = await dana.post("/api/files", { action: "done", fileId: f1.fileId });
check("confirming before the file arrived is refused", r.s === 409, JSON.stringify(r.d));
await fetch(B + "/__blob/?pathname=" + encodeURIComponent(f1.pathname), { method: "PUT", headers: { "x-content-type": "application/pdf" }, body: Buffer.alloc(2048) });
r = await rob.post("/api/files", { action: "done", fileId: f1.fileId });
check("someone else can't confirm your upload", r.s === 404);
r = await dana.post("/api/files", { action: "done", fileId: f1.fileId });
check("file confirmed", r.s === 200, JSON.stringify(r.d));
r = await dana.get("/api/portal");
const file = r.d.projects[0].files.find((f) => f.name === "Brand Guide 2026.pdf");
check("file listed as the client's upload", file && file.kind === "upload" && file.mine === true && file.size === 2048, JSON.stringify(r.d.projects[0].files));
r = await dana.get("/api/files?id=" + file.id);
check("download: a short-lived signed link to the private store", r.s === 200 && /^https:\/\/teststore\.private\.blob\.vercel-storage\.com\/projects\//.test(r.d.url) && /vercel-blob-signature|signature|sig/i.test(r.d.url), r.d && r.d.url);
r = await rob.get("/api/files?id=" + file.id);
check("another client can't get the link", r.s === 404);
r = await rob.post("/api/files", { action: "delete", id: file.id });
check("another client can't delete it", r.s === 404);
r = await admin.post("/api/files", { action: "start", projectId: DESERT, name: "Quote.pdf", size: 100, contentType: "application/pdf" });
await fetch(B + "/__blob/?pathname=" + encodeURIComponent(r.d.pathname), { method: "PUT", body: Buffer.alloc(100) });
await admin.post("/api/files", { action: "done", fileId: r.d.fileId });
r = await rob.get("/api/portal");
check("staff files appear to the client as documents from Nobleman", r.d.projects[0].files.some((f) => f.name === "Quote.pdf" && f.kind === "document" && !f.mine), JSON.stringify(r.d.projects[0].files));
r = await dana.post("/api/files", { action: "delete", id: file.id });
check("client removes their own file", r.s === 200);

// ---- Studio
r = await dana.get("/api/admin");
check("clients can't open Studio", r.s === 403);
r = await admin.get("/api/admin");
check("Studio overview: clients, people, projects, capability list, Vimeo status", r.s === 200 && r.d.clients.length === 2 && r.d.people.length === 3 && r.d.projects.length === 2 && r.d.capabilities.length === 10 && r.d.vimeo.plan === "plus" && r.d.vimeo.scopes.includes("video_files") && r.d.blob === true, JSON.stringify(r.d && r.d.vimeo));
r = await admin.get("/api/admin?folders=1");
check("Vimeo folders listed for linking", r.s === 200 && r.d.folders.length === 3 && r.d.folders.some((f) => f.id === "444"), JSON.stringify(r.d));
r = await admin.post("/api/admin", { action: "projectCreate", clientName: "Northwind", title: "Launch Film", folder: "999" });
check("linking a folder Vimeo doesn't have: refused", r.s === 400 && /no folder/.test(r.d.error), JSON.stringify(r.d));
r = await admin.post("/api/admin", { action: "projectCreate", clientName: "Northwind", title: "Launch Film", folder: "abc" });
check("non-numeric folder refused", r.s === 400);
r = await admin.post("/api/admin", { action: "projectCreate", clientName: "Northwind", title: "Launch Film", type: "Product launch", folder: "444", caps: { upload: true, bogus: true } });
check("project created with a new client, linked folder, and capabilities", r.s === 201, JSON.stringify(r.d));
const NW = r.d.id;
r = await admin.post("/api/admin", { action: "personCreate", name: "Mia Chen", email: "mia@northwind.test", role: "client", clientName: "Northwind" });
check("person created with a temporary password", r.s === 201 && /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/.test(r.d.tempPassword), JSON.stringify(r.d));
const mia = new Agent(B);
const miaTemp = r.d.tempPassword;
r = await mia.login("mia@northwind.test", miaTemp);
check("new person signs in and is told to choose a password", r.s === 200 && r.d.user.mustChangePassword === true);
r = await mia.get("/api/portal");
check("until then, the portal refuses everything else", r.s === 403 && r.d.mustChangePassword === true);
r = await mia.post("/api/session", { action: "password", next: "short" });
check("short password refused", r.s === 400);
r = await mia.post("/api/session", { action: "password", next: miaTemp });
check("reusing the temporary password refused", r.s === 400);
const miaOld = mia.cookie;
r = await mia.post("/api/session", { action: "password", next: "harbor-lights-2026" });
check("new password accepted", r.s === 200 && r.d.user.mustChangePassword === false);
r = await mia.get("/api/portal");
check("then the portal opens, showing the new client's project", r.s === 200 && r.d.projects.length === 1 && r.d.projects[0].id === NW && r.d.projects[0].caps.upload === true);
r = await (new Agent(B)).req("GET", "/api/portal", null, { cookie: miaOld });
check("the session from before the password change is dead", r.s === 401);
r = await mia.post("/api/session", { action: "password", current: "wrong-one-entirely", next: "another-password-1" });
check("changing it again needs the current password", r.s === 400 && /current password/.test(r.d.error));
const me = (await admin.get("/api/session")).d.user.id;
r = await admin.post("/api/admin", { action: "personReset", id: me });
check("staff can't reset their own password from People (it would sign them out)", r.s === 400 && /your account/.test(r.d.error));
r = await admin.post("/api/admin", { action: "personReset", id: DANA });
check("staff reset a password: new temporary password", r.s === 200 && !!r.d.tempPassword);
r = await dana.get("/api/portal");
check("the reset signs the person out everywhere", r.s === 401);
r = await dana.login("dana@harbor.test", r.d ? "x" : "x");
r = await dana.login("dana@harbor.test", (await admin.post("/api/admin", { action: "personReset", id: DANA })).d.tempPassword);
await dana.post("/api/session", { action: "password", next: "dana-new-password-1" });
r = await admin.post("/api/admin", { action: "projectUpdate", id: HARBOR, caps: { upload: false, stats: false }, stage: 4, next: { label: "Delivery", date: "October 12", what: "Final films" } });
check("staff switch capabilities and stage", r.s === 200);
r = await dana.get("/api/portal");
check("client sees the change at once", r.d.projects[0].caps.upload === false && r.d.projects[0].films[0].plays === undefined && r.d.projects[0].stageName === "Final polish" && r.d.projects[0].next.what === "Final films", JSON.stringify(r.d.projects[0].caps));
r = await dana.post("/api/media", { action: "uploadStart", projectId: HARBOR, name: "x.mp4", size: 10, type: "video/mp4" });
check("and the API enforces it", r.s === 403);
r = await admin.post("/api/admin", { action: "projectUpdate", id: HARBOR, archived: true });
r = await dana.get("/api/portal");
check("archived projects disappear for the client", r.d.projects.length === 0);
await admin.post("/api/admin", { action: "projectUpdate", id: HARBOR, archived: false });
r = await admin.post("/api/admin", { action: "personUpdate", id: "11111111-0000-4000-8000-000000000001", role: "client", clientId: "aaaaaaaa-0000-4000-8000-000000000001" });
check("staff can't change their own role", r.s === 400);
r = await admin.post("/api/admin", { action: "personDelete", id: "11111111-0000-4000-8000-000000000001" });
check("staff can't remove themselves", r.s === 400);
r = await admin.post("/api/admin", { action: "personCreate", name: "Dup", email: "DANA@harbor.test", role: "client", clientName: "Harbor Labs" });
check("duplicate email refused", r.s === 409, JSON.stringify(r.d));
r = await admin.post("/api/admin", { action: "clientDelete", id: "bbbbbbbb-0000-4000-8000-000000000002", confirm: "desert moto" });
check("deleting a client needs its exact name", r.s === 400);
r = await admin.post("/api/admin", { action: "personDelete", id: ROB });
check("staff remove a person", r.s === 200);
r = await rob.get("/api/portal");
check("their session stops at once", r.s === 401);

// ---- security edges
r = await admin.post("/api/admin", { action: "clientCreate", name: "Evil" }, { origin: "https://evil.example" });
check("cross-origin POST refused", r.s === 403);
r = await admin.post("/api/admin", { action: "clientCreate", name: "Same" }, { origin: "http://localhost:4400" });
check("same-origin POST allowed", r.s === 201);
const thr = new Agent(B);
let last;
for (let i = 0; i < 9; i++) last = await thr.login("mia@northwind.test", "nope-" + i);
check("sign-in pauses after repeated failures (429)", last.s === 429, last.s);

// ---- emails (dormant unless configured; configured in this test)
const mail = await (await fetch(B + "/__mail")).json();
check("staff were emailed about client notes, decisions, messages, uploads", mail.length >= 4 && mail.every((m) => m.to[0] === "alexis@gotit2work.com" || m.to[0].endsWith(".test")) && mail.some((m) => /approved/.test(m.subject)), JSON.stringify(mail.map((m) => [m.to[0], m.subject])));
check("the client was emailed about the staff message and document", mail.some((m) => m.to[0] === "rob@moto.test"), JSON.stringify(mail.map((m) => m.to[0])));

// ---- first-run setup (empty database)
const f = new Agent(FRESH);
r = await f.get("/api/session");
check("empty portal asks for setup", r.d.setup === true && r.d.setupReady === true);
r = await f.post("/api/session", { action: "setup", code: "wrong", name: "Alexis", email: "alexis@gotit2work.com", password: "a-good-long-password" });
check("wrong setup code refused", r.s === 403);
r = await f.post("/api/session", { action: "setup", code: "setup-code-123", name: "Alexis", email: "alexis@gotit2work.com", password: "a-good-long-password" });
check("setup creates the first admin and signs them in", r.s === 201 && r.d.user.role === "admin" && !!f.cookie, JSON.stringify(r.d));
r = await (new Agent(FRESH)).post("/api/session", { action: "setup", code: "setup-code-123", name: "Eve", email: "eve@x.test", password: "a-good-long-password" });
check("setup can't run twice", r.s === 409);
r = await f.get("/api/admin");
check("the new admin's Studio works on the fresh database", r.s === 200 && r.d.people.length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
