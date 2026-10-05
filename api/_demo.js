import { CAPABILITIES, STAGES } from "./_caps.js";
import { DEFAULTS, resolveBrand } from "./_settings.js";
import { ROLE_DEFAULTS, STAFF_ROLES, CLIENT_ROLES, STAFF_PERMS, CLIENT_PERMS, rolePermissions } from "./_roles.js";
import { providerList } from "./_providers/index.js";
import { EVENTS } from "./_payments.js";

// The public sample portal (/demo, and / when PORTAL_MODE=demo). Same shape as buildPortal() in _build.js, so
// the page renders it exactly like real data. Everything is made up; every film plays Nobleman's reel. Notes
// and messages are included inline, and nothing the visitor does is saved or sent (the page says so).

const REEL = { playback: { kind: "vimeo", id: "1197058424", hash: "796798a19d" } };
const ago = (days, hours = 0) => new Date(Date.now() - (days * 24 + hours) * 3600 * 1000).toISOString();
const ahead = (days) => new Date(Date.now() + days * 24 * 3600 * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric" });
const ahead8601 = (days) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
// What a decision maker sees: everything on except earlier versions, so only the newest version shows.
const allCaps = { ...Object.fromEntries(CAPABILITIES.map((c) => [c.key, true])), history: false, payfirst: false, notes: true, team: true, pay: true };
const usd = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const payment = (id, project, title, amount, extra) => ({ id, projectId: project, title, amount, currency: "usd", label: usd(amount), due: null, note: "", status: "open", method: null, paidAt: null, paidBy: null, created: ago(4), createdBy: "Jean", ...extra });

function film(id, title, extra) {
  return { id, ...REEL, title, description: "", duration: 0, durationLabel: "", resolution: "4K", vertical: false, created: ago(9), thumbnail: null, plays: null, ...extra };
}

export function demoPortal() {
  const v3 = film("demo-campaign-v3", "Campaign Film", { durationLabel: "4:21", duration: 261, created: ago(4), thumbnail: "media/a00.jpg", description: "Opening reworked around the wide shot. Color adjusted on the water scenes." });
  const s1 = film("demo-cutdown-v1", "15-Second Cutdown", { durationLabel: "0:15", duration: 15, created: ago(3), thumbnail: "media/a08.jpg", description: "The short version for social ads." });

  const meridian = {
    id: "demo-meridian",
    title: "Meridian Campaign",
    type: "Brand campaign · Commercial",
    summary: "A four-minute brand film, a TV commercial, and short versions for social, filmed on the water off San Diego.",
    clientId: "demo-client", clientName: "Meridian",
    stage: 3, stageName: STAGES[3], pct: 72,
    next: { label: "Next", date: ahead(4), what: "Final polish (color and sound) once Version 3 is approved", confirm: false, confirmedAt: null, confirmedBy: null },
    reviewDue: ahead8601(2),
    cover: "media/a00.jpg",
    caps: allCaps,
    payments: [
      payment("demo-pay-2", "demo-meridian", "Balance (50%)", 900000, { due: ahead8601(8), note: "Due on delivery of the final cut." }),
      payment("demo-pay-1", "demo-meridian", "Deposit (50%)", 900000, { status: "paid", method: "stripe", paidAt: ago(35), paidBy: "Jonathan Reyes", created: ago(38) }),
    ],
    provider: "vimeo",
    videoUploadsToSource: true,
    // Versions 1 and 2 had notes and change requests; clients see only the newest (Earlier versions is off).
    cuts: [
      { key: "campaign film", title: "Campaign Film", total: 3, versions: [
        { n: 3, video: v3, decision: null, comments: { total: 3, open: 2 } },
      ] },
      { key: "15-second cutdown", title: "15-Second Cutdown", total: 1, versions: [
        { n: 1, video: s1, decision: null, comments: { total: 0, open: 0 } },
      ] },
    ],
    status: { key: "waiting", label: "Waiting on client" },
    films: [
      film("demo-hero", "Campaign Hero Film", { durationLabel: "4:21", duration: 261, created: ago(12), thumbnail: "media/a07.jpg", description: "The four-minute brand film, for the web, the launch event, and the dealer network.", plays: 1284 }),
      film("demo-30", "30-Second Commercial", { durationLabel: "0:30", duration: 30, created: ago(10), thumbnail: "media/a08.jpg", description: "The TV version, with stereo and surround sound.", plays: 642 }),
      film("demo-vertical", "Vertical Social Video", { durationLabel: "0:45", duration: 45, resolution: "Vertical", vertical: true, created: ago(10), thumbnail: "media/a05.jpg", description: "For Instagram Reels, YouTube Shorts, and TikTok. Captions built in.", plays: 3910 }),
      film("demo-bts", "Behind the Scenes", { durationLabel: "2:48", duration: 168, created: ago(8), thumbnail: "media/a09.jpg", description: "Three filming days on the water and in the studio.", plays: 215 }),
    ],
    videosError: null,
    files: [
      { id: "demo-f1", name: "Meridian_Quote_Signed.pdf", size: 412000, contentType: "application/pdf", kind: "document", by: "Jean", byRole: "admin", mine: false, at: ago(30) },
      { id: "demo-f2", name: "Shoot_Schedule_and_Call_Sheet.pdf", size: 1880000, contentType: "application/pdf", kind: "document", by: "Justin", byRole: "admin", mine: false, at: ago(24) },
      { id: "demo-f3", name: "Meridian_Brand_Guide_2026.pdf", size: 14200000, contentType: "application/pdf", kind: "upload", by: "Jonathan Reyes", byRole: "client", mine: true, at: ago(29) },
      { id: "demo-f4", name: "Meridian_Logo_Primary.ai", size: 2800000, contentType: "application/postscript", kind: "upload", by: "Jonathan Reyes", byRole: "client", mine: true, at: ago(29) },
    ],
    videoUploads: [
      { id: "demo-u1", vimeoId: "0", name: "Reference_Sea_Trials.mp4", size: 420000000, status: "done", by: "Jonathan Reyes", byRole: "client", mine: true, at: ago(26) },
    ],
    messages: { total: 3, unread: 1, last: ago(4) },
    updated: ago(4),
    thread: [
      { id: "demo-m1", author: "Jean", role: "admin", body: "Filming wrapped Thursday. Editing starts today; expect Version 1 within the week.", at: ago(22) },
      { id: "demo-m2", author: "Jonathan Reyes", role: "client", body: "Notes are in on Version 2. The middle section is the main one.", at: ago(8) },
      { id: "demo-m3", author: "Justin", role: "admin", body: "Version 3 is up. We reworked the opening around your note on the wide shot.", at: ago(4) },
    ],
    notes: {
      "demo-campaign-v3": [
        { id: "demo-c1", at: 12, body: "Can we hold this wide a beat longer before the cut?", author: "Jonathan Reyes", role: "client", resolved: false, when: ago(3), replies: [] },
        { id: "demo-c2", at: 41, body: "Love this shot.", author: "Jonathan Reyes", role: "client", resolved: false, when: ago(3), replies: [
          { id: "demo-c2r", body: "Thank you. That one took three passes to catch the light.", author: "Justin", role: "admin", when: ago(2) },
        ] },
        { id: "demo-c3", at: 65, body: "Swapped to the alternate angle here, as you asked.", author: "Justin", role: "admin", resolved: true, when: ago(4), replies: [] },
        // Written in Frame.io: notes go both ways (api/_fio_sync.js).
        { id: "demo-c4", at: 88, body: "Music swells here in the final mix. This is the temp track.", author: "Sam Rivera", role: "admin", resolved: false, when: ago(1), replies: [], via: "frameio" },
      ],
    },
  };

  const social = {
    id: "demo-social",
    title: "Social Content Package",
    type: "Twelve short vertical videos",
    summary: "Short vertical videos for Instagram, TikTok, and YouTube Shorts.",
    clientId: "demo-client", clientName: "Meridian",
    stage: 1, stageName: STAGES[1], pct: 28,
    next: { label: "Next filming day", date: ahead(2), what: "Day 2 of 3, San Diego. Call time 7:00 AM", confirm: true, confirmedAt: null, confirmedBy: null },
    reviewDue: null,
    cover: "media/a03.jpg",
    caps: allCaps,
    payments: [payment("demo-pay-3", "demo-social", "Deposit (50%)", 360000, { status: "paid", method: "stripe", paidAt: ago(12), paidBy: "Jonathan Reyes", created: ago(14) })],
    provider: "vimeo",
    videoUploadsToSource: true,
    cuts: [], films: [], videosError: null, files: [], videoUploads: [],
    status: { key: "none", label: "Nothing in review" },
    messages: { total: 0, unread: 0, last: null },
    updated: ago(6),
    thread: [], notes: {},
  };

  const P = [meridian, social];
  return {
    user: { id: "demo-user", email: "jonathan@meridian.example", name: "Jonathan Reyes", title: "Marketing Director", role: "client", access: "approver",
      roleLabel: "Decision maker", perms: ROLE_DEFAULTS.approver, clientId: "demo-client", clientName: "Meridian", clientLogo: null, mustChangePassword: false, notifyEmail: true, twoStep: false },
    demo: true,
    brand: resolveBrand(DEFAULTS.brand),
    tour: false,
    announcement: null,
    emailEnabled: true,
    payReady: true,
    stages: STAGES,
    projects: P,
    activity: [
      { type: "message", projectId: "demo-meridian", projectTitle: "Meridian Campaign", who: "Justin", role: "admin", text: "Version 3 is up. We reworked the opening around your note on the wide shot.", at: ago(4) },
      { type: "comment", projectId: "demo-meridian", projectTitle: "Meridian Campaign", who: "Jonathan Reyes", role: "client", text: "Can we hold this wide a beat longer before the cut?", at: ago(3) },
      { type: "changes", projectId: "demo-meridian", projectTitle: "Meridian Campaign", who: "Jonathan Reyes", role: "client", text: "Music works. The middle section still feels long.", at: ago(8) },
      { type: "document", projectId: "demo-meridian", projectTitle: "Meridian Campaign", who: "Justin", role: "admin", text: "Shoot_Schedule_and_Call_Sheet.pdf", at: ago(24) },
    ],
  };
}

// ---------- the studio's view of the demo ----------
// The same sample, seen by the studio: every version, the management side (Studio), and someone asking to join.
// Studio's own calls (GET /api/admin?demo=1…) are answered by demoAdmin(); the page refuses every change.
const STUDIO_USER = { id: "demo-staff", email: "studio@nobleman.example", name: "Jean", title: "Founder", role: "admin", access: "owner", roleLabel: "Owner",
  clientId: null, clientName: null, clientLogo: null, mustChangePassword: false, notifyEmail: true, twoStep: true, twoStepRequired: false };
const SOURCE = { conn: "env-vimeo", provider: "vimeo", providerName: "Vimeo", connName: "Vimeo" };
const REFS = { "demo-meridian": "1180001", "demo-social": "1180002" };

export function demoStudioPortal() {
  const d = demoPortal();
  const all = Object.fromEntries(STAFF_PERMS.map((p) => [p.key, true]));
  const v = (n, created, extra) => film(`demo-campaign-v${n}`, "Campaign Film", { durationLabel: "4:1" + n, duration: 250 + n, created: ago(created), thumbnail: "media/a00.jpg", ...extra });
  const projects = d.projects.map((p) => {
    const out = { ...p, clientCaps: p.caps, caps: { ...Object.fromEntries(Object.keys(p.caps).map((k) => [k, true])), team: false },
      source: { ...SOURCE, ref: REFS[p.id] }, remindedAt: null,
      files: p.files.map((f) => ({ ...f, mine: false })), thread: (p.thread || []).map((m) => ({ ...m, mine: m.author === "Jean" })) };
    if (p.id === "demo-meridian") {
      // Staff see every version and every decision.
      out.cuts = p.cuts.map((c) => c.key !== "campaign film" ? c : { ...c, versions: [
        { n: 1, video: v(1, 16), decision: { decision: "changes", note: "Shorter opening, and more of the boat.", by: "Jonathan Reyes", at: ago(14) }, comments: { total: 6, open: 0 } },
        { n: 2, video: v(2, 9), decision: { decision: "changes", note: "Music works. The middle section still feels long.", by: "Jonathan Reyes", at: ago(8) }, comments: { total: 4, open: 0 } },
        ...c.versions,
      ] });
    }
    return out;
  });
  return {
    ...d,
    user: { ...STUDIO_USER, perms: all },
    projects,
    signups: 1,
    activity: STUDIO_LOG.slice(0, 8).map((e) => ({ type: e.action, projectId: e.projectId, projectTitle: e.project || "", who: e.who, role: e.kind === "staff" ? "admin" : "client", text: e.summary, at: e.at, log: true })),
  };
}

const STUDIO_LOG = [
  { who: "Portal", kind: "system", action: "signup.request", summary: "Kim Lowell (kim@lowellmarine.example, Lowell Marine) asked for an account", project: null, projectId: null, client: null, h: 3 },
  { who: "Jonathan Reyes", kind: "client", action: "watched", summary: "Watched Campaign Film Version 3", project: "Meridian Campaign", projectId: "demo-meridian", client: "Meridian", h: 20 },
  { who: "Jonathan Reyes", kind: "client", action: "note", summary: "Left a note on Campaign Film Version 3 at 0:12", project: "Meridian Campaign", projectId: "demo-meridian", client: "Meridian", h: 21 },
  { who: "Priya Shah", kind: "client", action: "downloaded", summary: "Downloaded Vertical Social Video (HD 1080p)", project: "Meridian Campaign", projectId: "demo-meridian", client: "Meridian", h: 30 },
  { who: "Justin", kind: "staff", action: "project.update", summary: "Updated Meridian Campaign: stage to Your review; review date set", project: "Meridian Campaign", projectId: "demo-meridian", client: "Meridian", h: 96 },
  { who: "Justin", kind: "staff", action: "video.add", summary: "Campaign Film Version 3 arrived from Vimeo", project: "Meridian Campaign", projectId: "demo-meridian", client: "Meridian", h: 97 },
  { who: "Jonathan Reyes", kind: "client", action: "share.create", summary: "Created a share link to Campaign Hero Film (30 days)", project: "Meridian Campaign", projectId: "demo-meridian", client: "Meridian", h: 120 },
  { who: "Jonathan Reyes", kind: "client", action: "changes", summary: "Asked for changes on Campaign Film Version 2", project: "Meridian Campaign", projectId: "demo-meridian", client: "Meridian", h: 192 },
  { who: "Jonathan Reyes", kind: "client", action: "team.add", summary: "Added Priya Shah (priya@meridian.example) as Reviewer", project: null, projectId: null, client: "Meridian", h: 240 },
  { who: "Jean", kind: "staff", action: "project.create", summary: "Created project Social Content Package", project: "Social Content Package", projectId: "demo-social", client: "Meridian", h: 300 },
  { who: "Jean", kind: "staff", action: "signin", summary: "Logged in (password, two-step)", project: null, projectId: null, client: null, h: 1 },
].map((e, i) => ({ id: 1000 - i, at: ago(0, e.h), ip: e.kind === "system" ? null : "203.0.113." + (10 + i), ...e }));

/** Studio's data for the demo: GET /api/admin?demo=1 (overview), &videos=, &sources=, &audit=, &health=, &notion=. */
export function demoAdmin(q, origin = "https://portal.noblemanproductions.gotit2work.com") {
  const portal = demoStudioPortal();
  if (q.videos) {
    const p = portal.projects.find((x) => x.id === q.videos);
    if (!p) return { source: null, videos: [] };
    const versions = p.cuts.flatMap((c) => c.versions.map((x) => ({ id: x.video.id, title: c.title + (c.total > 1 || c.versions.length > 1 ? " V" + x.n : ""), thumbnail: x.video.thumbnail, durationLabel: x.video.durationLabel,
      created: x.video.created, ready: true, hidden: false, kind: "version", version: x.n, baseTitle: c.title, forcedFilm: false, stacked: false, manage: null, link: null, linkId: null })));
    const films = p.films.map((f) => ({ id: f.id, title: f.title, thumbnail: f.thumbnail, durationLabel: f.durationLabel, created: f.created, ready: true, hidden: false, kind: "film", version: null, forcedFilm: false, stacked: false, manage: null, link: null, linkId: null }));
    const ups = (p.videoUploads || []).map((u) => ({ id: "up-" + u.id, title: `From Meridian: ${u.name}`, thumbnail: null, durationLabel: "", created: u.at, ready: true, hidden: false, kind: "client", version: null, forcedFilm: false, manage: null, link: null, linkId: null }));
    return { source: { provider: "vimeo", name: "Vimeo" }, videos: [...versions, ...films, ...ups] };
  }
  if (q.sources) return { sources: [{ id: "1180001", name: "Meridian Campaign", count: 9, modified: ago(4) }, { id: "1180002", name: "Meridian Social", count: 0, modified: ago(6) }, { id: "1180003", name: "Reel 2026", count: 12, modified: ago(30) }] };
  if (q.audit) {
    const kind = ["staff", "client", "system"].includes(q.kind) ? q.kind : null;
    const find = String(q.q || "").toLowerCase();
    return { entries: STUDIO_LOG.filter((e) => (!kind || e.kind === kind) && (!q.project || e.projectId === q.project) && (!find || (e.summary + e.who).toLowerCase().includes(find))), more: false };
  }
  if (q.health) {
    return { checks: [
      { label: "This is the demo", ok: "warn", detail: "These checks are examples. In the real portal they show what’s set up and what needs attention." },
      { label: "Database", ok: true, detail: "Connected." },
      { label: "Login key", ok: true, detail: "SESSION_SECRET is set." },
      { label: "File storage", ok: true, detail: "A private Vercel Blob store is connected." },
      { label: "Email", ok: true, detail: "Connected: invitations, login links, reminders, receipts, and updates go out." },
      { label: "Daily job", ok: true, detail: "Reminders, Notion catch-up, and Frame.io sign-in refresh run daily." },
      { label: "Vimeo", ok: true, detail: "Vimeo: working." },
      { label: "Owners", ok: "warn", detail: "Only one owner. Make a second person an owner so the studio is never locked out." },
    ] };
  }
  if (q.notion) return { results: [] };
  const people = [
    { id: "demo-staff", name: "Jean", email: "studio@nobleman.example", title: "Founder", role: "admin", access: "owner", clientId: null, clientName: null, h: 1, twoStep: true },
    { id: "demo-justin", name: "Justin", email: "justin@nobleman.example", title: "Founder", role: "admin", access: "manager", clientId: null, clientName: null, h: 5, twoStep: true },
    { id: "demo-sam", name: "Sam Rivera", email: "sam@nobleman.example", title: "Editor", role: "admin", access: "editor", clientId: null, clientName: null, h: 30, twoStep: false },
    { id: "demo-user", name: "Jonathan Reyes", email: "jonathan@meridian.example", title: "Marketing Director", role: "client", access: "approver", clientId: "demo-client", clientName: "Meridian", h: 20, twoStep: false },
    { id: "demo-priya", name: "Priya Shah", email: "priya@meridian.example", title: "Brand Manager", role: "client", access: "reviewer", clientId: "demo-client", clientName: "Meridian", h: 30, twoStep: false },
    { id: "demo-ceo", name: "Alex Moreno", email: "alex@meridian.example", title: "CEO", role: "client", access: "viewer", clientId: "demo-client", clientName: "Meridian", h: null, twoStep: false },
    // Joined with Meridian Campaign's link: sees only that project.
    { id: "demo-dev", name: "Dev Patel", email: "dev@harborlight.example", title: "Agency producer", role: "client", access: "approver", clientId: "demo-client", clientName: "Meridian", h: 5, twoStep: false, allProjects: false, projects: ["demo-meridian"] },
  ].map((p) => ({ allProjects: p.role === "client" ? true : undefined, projects: p.role === "client" ? [] : undefined, ...p, roleLabel: [...STAFF_ROLES, ...CLIENT_ROLES].find((r) => r.key === p.access).label, lastLogin: p.h ? ago(0, p.h) : null, invited: !p.h, mustChangePassword: !p.h, created: ago(40) }));
  return {
    me: { id: STUDIO_USER.id, access: "owner", perms: portal.user.perms },
    clients: [{ id: "demo-client", name: "Meridian", logo: "", notes: "Billing: accounts@meridian.example. Logo only on the end card.", domains: ["meridian.example"], people: 3, projects: 2, created: ago(40) }],
    people,
    signups: [{ id: "demo-req-1", name: "Kim Lowell", email: "kim@lowellmarine.example", company: "Lowell Marine", note: "A boat launch film in May.", created: ago(0, 3), confirmed: ago(0, 3), match: null }],
    projects: portal.projects.map((p) => ({
      id: p.id, title: p.title, type: p.type, summary: p.summary, clientId: p.clientId, clientName: p.clientName, stage: p.stage, pct: p.pct, next: p.next,
      reviewDue: p.reviewDue, remindedAt: null,
      source: p.id === "demo-meridian" ? { conn: "demo-frameio", ref: "f0a1c2d3-meridian", provider: "frameio", connName: "Frame.io" } : { conn: SOURCE.conn, ref: REFS[p.id], provider: "vimeo", connName: "Vimeo" },
      imageUrl: "", caps: p.clientCaps, archived: false, notion: true, updated: p.updated, payments: p.payments || [],
      // Each project's own link for the client; the demo's opens the sample link page.
      join: { link: `${origin}/demo/join/${p.id === "demo-meridian" ? "meridian" : "social"}`, off: false, access: "approver",
        people: p.id === "demo-meridian" ? [{ id: "demo-dev", name: "Dev Patel", email: "dev@harborlight.example", roleLabel: "Decision maker", at: ago(6), lastLogin: ago(0, 5) }] : [] },
    })),
    capabilities: CAPABILITIES,
    stages: STAGES,
    roles: { staff: STAFF_ROLES, client: CLIENT_ROLES, staffPerms: STAFF_PERMS, clientPerms: CLIENT_PERMS, permissions: rolePermissions(DEFAULTS) },
    providers: providerList(),
    connections: [
      { id: "env-vimeo", provider: "vimeo", name: "Vimeo", env: false, status: "ok", lastError: null, checked: ago(0, 2), config: { account: "Nobleman Productions" } },
      { id: "demo-frameio", provider: "frameio", name: "Frame.io", env: false, status: "ok", lastError: null, checked: ago(0, 1), auth: "oauth", signedIn: true,
        config: { account: "Jean Gotay", accountId: "demo-account", live: { at: ago(9), workspaces: 1 } } },
      { id: "demo-resend", provider: "resend", name: "Email (Resend)", env: false, status: "ok", lastError: null, checked: ago(0, 2), config: { from: "Nobleman Productions <portal@nobleman.example>", account: "Nobleman Productions <portal@nobleman.example>" } },
      { id: "demo-notion", provider: "notion", name: "Notion", env: false, status: "ok", lastError: null, checked: ago(0, 2), config: { account: "Nobleman HQ" } },
      { id: "demo-stripe", provider: "stripe", name: "Payments (Stripe)", env: false, status: "ok", lastError: null, checked: ago(0, 2), config: { account: "Nobleman Productions", currency: "usd" } },
    ],
    payments: { ready: true, live: true, webhook: true, currency: "usd", endpoint: "https://portal.noblemanproductions.gotit2work.com/api/connect?webhook=stripe", events: EVENTS },
    settings: { ...DEFAULTS, brand: resolveBrand(DEFAULTS.brand), notion: { ...DEFAULTS.notion, connectionId: "demo-notion", dataSourceId: "demo", title: "Nobleman Productions projects", lastSync: ago(0, 1) } },
    email: true,
    blob: true,
    redirectUri: "https://portal.noblemanproductions.gotit2work.com/api/connect",
    demo: true,
  };
}
