// Studio, continued (api/admin.js routes here): connections, Notion, settings and roles, the activity log,
// data export, and system health. Staff only; each action checks the person's role.
import { randomUUID } from "node:crypto";
import { head, del } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { sql } from "./_db.js";
import { isUuid, text, longText } from "./_auth.js";
import { cleanCaps } from "./_caps.js";
import { getSettings, saveSection, patchSection, DEFAULTS, LOGIN_MEDIA, LOGIN_UPLOAD, MAX_LOGIN_IMAGE, instanceId } from "./_settings.js";
import { ROLE_DEFAULTS, STAFF_PERMS, CLIENT_PERMS, can, isStaff } from "./_roles.js";
import { listConnections, getConnection, createConnection, updateConnection, deleteConnection, forgetConnections } from "./_connections.js";
import { PROVIDERS, VIDEO } from "./_providers/index.js";
import * as notion from "./_notion.js";
import { emailReady, sendEmail, layout, notify, originOf } from "./_notify.js";
import { stripeConnection, liveMode, currencyOf, parseAmount, money, expire } from "./_payments.js";
import { audit } from "./_audit.js";
import { later } from "./_later.js";
import { SCHEMA_VERSION } from "./_schema.js";
import { setLive } from "./_fio_sync.js";

const iso = (d) => (d ? new Date(d).toISOString() : null);
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
const stamp = () => new Date().toISOString().slice(0, 10);

function download(res, name, type, body) {
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  return res.status(200).end(body);
}

// ---------- GET ----------
export const MORE_GETS = {
  /** The activity log: newest first, 100 at a time, filtered by project, client, person, or kind. */
  async audit(req, res, u, s, deny) {
    if (deny("audit.view")) return;
    const q = req.query;
    const before = Number(q.before) || null;
    const project = isUuid(q.project) ? q.project : null;
    const client = isUuid(q.client) ? q.client : null;
    const kind = ["staff", "client", "system"].includes(q.kind) ? q.kind : null;
    const find = text(q.q, 80);
    const rows = await sql`
      select a.*, p.title as project_title, c.name as client_name from audit_log a
      left join projects p on p.id = a.project_id left join clients c on c.id = a.client_id
      where (${before}::bigint is null or a.id < ${before})
        and (${project}::uuid is null or a.project_id = ${project})
        and (${client}::uuid is null or a.client_id = ${client})
        and (${kind}::text is null or a.actor_kind = ${kind})
        and (${find || null}::text is null or a.summary ilike ${"%" + find + "%"} or a.actor_name ilike ${"%" + find + "%"})
      order by a.id desc limit ${q.audit === "csv" ? 5000 : 100}`;
    const out = rows.map((r) => ({
      id: Number(r.id), at: iso(r.at), who: r.actor_name, kind: r.actor_kind, action: r.action, summary: r.summary,
      project: r.project_title || null, projectId: r.project_id, client: r.client_name || null, ip: r.ip || null,
    }));
    if (q.audit === "csv") {
      return download(res, `activity-log-${stamp()}.csv`, "text/csv; charset=utf-8",
        csv([["When (UTC)", "Who", "Kind", "What", "Project", "Client", "IP"], ...out.map((r) => [r.at, r.who, r.kind, r.summary, r.project, r.client, r.ip])]));
    }
    return res.status(200).json({ entries: out, more: rows.length === 100 });
  },

  async export(req, res, u, s, deny) {
    if (deny("data.export")) return;
    const q = req.query;
    if (q.export === "projects") {
      const rows = await sql`select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id order by c.name, p.title`;
      return download(res, `projects-${stamp()}.csv`, "text/csv; charset=utf-8", csv([
        ["Project", "Client", "Kind", "Stage", "Progress %", "Next", "Review by", "Archived", "Created", "Updated"],
        ...rows.map((p) => [p.title, p.client_name, p.type, s.stages[Math.min(p.stage_idx, s.stages.length - 1)].name, p.pct || "",
          [p.next_label, p.next_what, p.next_date].filter(Boolean).join(" · "), p.review_due ? iso(p.review_due).slice(0, 10) : "", p.archived ? "yes" : "", iso(p.created_at), iso(p.updated_at)]),
      ]));
    }
    if (q.export === "client" && isUuid(q.id)) {
      const c = (await sql`select * from clients where id = ${q.id}`)[0];
      if (!c) return res.status(404).json({ error: "That client was removed." });
      const ps = await sql`select * from projects where client_id = ${c.id}`;
      const ids = ps.map((p) => p.id);
      const [people, comments, approvals, messages, files, uploads, shares, log, payments] = await Promise.all([
        sql`select id, email, name, title, access, created_at, last_login_at, notify_email, totp_enabled from users where client_id = ${c.id}`,
        ids.length ? sql`select id, project_id, video_id, version, at_seconds, body, parent_id, author_name, author_role, resolved, created_at from comments where project_id = any(${ids})` : [],
        ids.length ? sql`select project_id, video_id, version, decision, note, user_name, created_at from approvals where project_id = any(${ids})` : [],
        ids.length ? sql`select project_id, author_name, author_role, body, created_at from messages where project_id = any(${ids})` : [],
        ids.length ? sql`select project_id, name, size, content_type, kind, uploader_name, created_at from files where project_id = any(${ids})` : [],
        ids.length ? sql`select project_id, name, size, status, uploader_name, created_at from video_uploads where project_id = any(${ids})` : [],
        ids.length ? sql`select project_id, title, created_by_name, created_at, expires_at, revoked_at, views from share_links where project_id = any(${ids})` : [],
        sql`select at, actor_name, action, summary, ip from audit_log where client_id = ${c.id} order by at`,
        ids.length ? sql`select project_id, title, amount, currency, due, status, method, paid_at, paid_by_name, created_at from payments where project_id = any(${ids})` : [],
      ]);
      await audit(req, u, "export", `Exported all data for ${c.name}`, { clientId: c.id });
      const body = JSON.stringify({
        exported: new Date().toISOString(), studio: s.brand.studio,
        client: { id: c.id, name: c.name, created: iso(c.created_at) },
        people, projects: ps.map((p) => ({ id: p.id, title: p.title, type: p.type, summary: p.summary, created: iso(p.created_at), archived: p.archived })),
        comments, approvals, messages, files, videoUploads: uploads, shareLinks: shares, payments, activity: log,
        note: "Files and videos themselves are not included; they can be downloaded from the portal or the video host.",
      }, null, 2);
      return download(res, `${c.name.replace(/[^\w-]+/g, "-")}-data-${stamp()}.json`, "application/json; charset=utf-8", body);
    }
    return res.status(400).json({ error: "Choose what to export." });
  },

  /** Notion pages (to create the database under) or databases, for the setup picker. */
  async notion(req, res, u, s, deny) {
    if (deny("connections.manage")) return;
    const conn = await notion.notionConnection();
    if (!conn) return res.status(409).json({ error: "Add the Notion connection first." });
    try {
      return res.status(200).json({ results: await notion.search(conn, req.query.q, req.query.notion === "database" ? "database" : "page") });
    } catch (err) {
      return res.status(502).json({ error: `Notion didn’t answer: ${err.message}` });
    }
  },

  async health(req, res, u, s, deny) {
    if (deny("settings.manage")) return;
    const conns = await listConnections();
    const [owners, staffNo2] = await Promise.all([
      sql`select count(*)::int as n from users where role = 'admin' and coalesce(access, 'owner') = 'owner'`,
      sql`select count(*)::int as n from users where role = 'admin' and not totp_enabled`,
    ]);
    const checks = [
      { label: "Database", ok: true, detail: `Connected. Schema version ${SCHEMA_VERSION}.` },
      { label: "Login key", ok: (process.env.SESSION_SECRET || "").length >= 32, detail: (process.env.SESSION_SECRET || "").length >= 32 ? "SESSION_SECRET is set." : "SESSION_SECRET is missing or shorter than 32 characters." },
      { label: "Stored-credential key", ok: true, detail: process.env.PORTAL_ENCRYPTION_KEY ? "PORTAL_ENCRYPTION_KEY is set." : "Derived from SESSION_SECRET. Changing SESSION_SECRET means reconnecting every connection. Set PORTAL_ENCRYPTION_KEY to keep them independent." },
      { label: "Setup code", ok: !process.env.BOOTSTRAP_SECRET ? true : "warn", detail: process.env.BOOTSTRAP_SECRET ? "BOOTSTRAP_SECRET is still set. Setup is done: delete it in Vercel and redeploy." : "Removed after setup, as it should be." },
      { label: "Public demo at the front door", ok: process.env.PORTAL_MODE === "demo" ? "warn" : true, detail: process.env.PORTAL_MODE === "demo" ? "PORTAL_MODE=demo: visitors see the sample project at / instead of login. Delete it to go live." : "Off: visitors see login. The sample stays at /demo." },
      { label: "File storage", ok: !!process.env.BLOB_READ_WRITE_TOKEN, detail: process.env.BLOB_READ_WRITE_TOKEN ? "A Vercel Blob store is connected." : "No Blob store: files can’t be uploaded. Vercel → Storage → Create → Blob (private) → connect." },
      { label: "Email", ok: (await emailReady()) ? true : "warn", detail: (await emailReady()) ? "Connected: invitations, login links, reminders, receipts, and updates go out." : "Not connected: invitations are copied by hand and nobody gets updates. Studio → Connections → Email." },
      { label: "Daily job", ok: process.env.CRON_SECRET ? true : "warn", detail: process.env.CRON_SECRET ? "CRON_SECRET is set: reminders, Notion catch-up, and Frame.io sign-in refresh run daily." : "Set CRON_SECRET in Vercel so the daily job (reminders, Notion catch-up, Frame.io refresh) can run." },
      ...conns.filter((c) => PROVIDERS[c.provider] && PROVIDERS[c.provider].meta.kind === "video").map((c) => ({ label: c.name, ok: c.status === "ok" ? true : false, detail: c.status === "ok" ? `${PROVIDERS[c.provider].meta.name}: working${c.env ? " (from Vercel settings)" : ""}.` : `${PROVIDERS[c.provider].meta.name}: ${c.lastError || "not working"}` })),
      await paymentsCheck(),
      ...(await addressChecks(req, s)),
      { label: "Notion", ok: !s.notion.dataSourceId ? "warn" : s.notion.lastError ? false : true, detail: !s.notion.dataSourceId ? "Not set up." : s.notion.lastError ? `Last sync failed: ${s.notion.lastError}` : `Syncing to ${s.notion.title || "your database"}${s.notion.lastSync ? ", last at " + iso(s.notion.lastSync) : ""}.` },
      { label: "Owners", ok: owners[0].n >= 2 ? true : "warn", detail: owners[0].n >= 2 ? `${owners[0].n} owners.` : "Only one owner. Make a second person an owner so the studio is never locked out." },
      { label: "Staff two-step verification", ok: staffNo2[0].n === 0 ? true : "warn", detail: staffNo2[0].n === 0 ? "Every staff account uses it." : `${staffNo2[0].n} staff ${staffNo2[0].n === 1 ? "account doesn’t" : "accounts don’t"} use two-step verification. Settings → Security can require it.` },
    ];
    return res.status(200).json({ checks });
  },
};

// ---------- settings validation ----------
const bool = (v, d) => (typeof v === "boolean" ? v : d);
const int = (v, min, max, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d; };
const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || ""));
const httpsOk = (v) => /^https:\/\/[^\s"'<>]{4,300}$/.test(String(v || ""));

const CLEAN = {
  brand(v, cur) {
    const studio = text(v.studio, 80);
    if (!studio) throw bad("Enter the studio’s name.");
    if (v.support && !emailOk(v.support)) throw bad("The support email isn’t valid.");
    for (const k of ["website", "privacy", "portal"]) if (v[k] && !httpsOk(v[k])) throw bad("Web addresses must start with https://.");
    return { studio, support: text(v.support, 120) || cur.support, website: text(v.website, 300), privacy: text(v.privacy, 300), portal: text(v.portal, 300).replace(/\/+$/, "") || cur.portal, replies: text(v.replies, 200) };
  },
  signin: (v, cur) => ({
    kicker: text(v.kicker, 80), quote: text(v.quote, 200), answer: text(v.answer, 200),
    image: LOGIN_MEDIA.test(String(v.image)) || LOGIN_UPLOAD.test(String(v.image)) ? String(v.image) : (cur && cur.image) || DEFAULTS.signin.image,
    focus: ["left", "center", "right"].includes(v.focus) ? v.focus : (cur && cur.focus) || DEFAULTS.signin.focus,
  }),
  announcement: (v) => ({ text: text(v.text, 300), tone: v.tone === "warning" ? "warning" : "info" }),
  stages(v) {
    if (!Array.isArray(v) || v.length < 2 || v.length > 10) throw bad("Keep between 2 and 10 stages.");
    const out = v.map((x) => ({ name: text(x && x.name, 40), pct: int(x && x.pct, 0, 100, 0) }));
    if (out.some((x) => !x.name)) throw bad("Every stage needs a name.");
    return out;
  },
  caps: (v) => ({ ...DEFAULTS.caps, ...cleanCaps(v) }),
  security: (v, cur) => ({
    staffTwoStep: bool(v.staffTwoStep, cur.staffTwoStep), signinLinks: bool(v.signinLinks, cur.signinLinks),
    sessionDays: int(v.sessionDays, 1, 30, cur.sessionDays), clientTeams: bool(v.clientTeams, cur.clientTeams),
    signup: ["off", "request"].includes(v.signup) ? v.signup : cur.signup,
    domainJoin: bool(v.domainJoin, cur.domainJoin),
    domainRole: ["approver", "reviewer", "viewer"].includes(v.domainRole) ? v.domainRole : cur.domainRole,
  }),
  reminders: (v, cur) => ({ enabled: bool(v.enabled, cur.enabled), daysBefore: int(v.daysBefore, 0, 14, cur.daysBefore) }),
};
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/** System check: the addresses every link leads to (docs/MOVE.md in the website repo covers moving them). */
async function addressChecks(req, s) {
  const here = originOf(req), { portal, website, privacy } = s.brand;
  const fine = /^http:\/\/localhost(:\d+)?$/.test(here) || here === portal;
  const page = privacy.split("#")[0];
  let opens = false;
  try { opens = (await fetch(page, { redirect: "follow", signal: AbortSignal.timeout(6000) })).ok; } catch { opens = false; }
  return [
    { label: "Portal address", ok: fine ? true : "warn", detail: fine ? `${portal}. Links in emails and Notion lead here.` : `You opened the portal at ${here}, but its address is ${portal}, so links in emails lead there. If the portal has moved, change Portal address in Settings → Studio details.` },
    { label: "Website and privacy page", ok: opens ? true : "warn", detail: opens ? `${website}, and its privacy page opens.` : `${page} didn’t open. Every page links to it: check Website in Settings → Studio details.` },
  ];
}

/** A new portal address must already serve this portal; otherwise links in emails, and visitors sent on from the
 *  old address (app/main.js), would lead nowhere. Returns why not, or null when it does. */
async function portalAnswers(url) {
  try {
    const r = await fetch(url + "/api/session", { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => null);
    if (j && j.instance && j.instance === (await instanceId())) return null;
    return `${url} answers, but not as this portal. In Vercel, add it to the nobleman-portal project’s domains, then try again.`;
  } catch {
    return `${url} doesn’t answer yet. Add it in Vercel and at the domain’s DNS, wait until Vercel says it’s valid, then try again.`;
  }
}

/** System check: payments. */
async function paymentsCheck() {
  const c = await stripeConnection();
  if (!c) return { label: "Payments", ok: "warn", detail: "Not set up. Studio → Connections → Payments (Stripe) lets clients pay deposits and balances in the portal." };
  if (c.status !== "ok") return { label: "Payments", ok: false, detail: `Stripe: ${c.lastError || "not working"}` };
  return { label: "Payments", ok: c.creds.webhookSecret ? true : "warn", detail: `Stripe ${liveMode(c) ? "live" : "test"} mode, ${currencyOf(c).toUpperCase()}.${c.creds.webhookSecret ? " Webhook connected." : " Add the webhook signing secret so payments are marked paid even if the client closes the page."}` };
}

/** One payment with its project, for the staff actions below. */
async function paymentRow(id) {
  if (!isUuid(id)) return null;
  return (await sql`select pay.*, p.title as project_title, p.client_id, p.capabilities, c.name as client_name
    from payments pay join projects p on p.id = pay.project_id join clients c on c.id = p.client_id where pay.id = ${id}`)[0] || null;
}

/** A replaced login photo that staff uploaded is deleted from file storage; the portal's own photos stay. */
async function dropLoginImage(image) {
  const m = LOGIN_UPLOAD.exec(String(image || ""));
  if (m && process.env.BLOB_READ_WRITE_TOKEN) await del(m[1]).catch((err) => console.error("login photo delete failed", err.message));
}

// ---------- POST ----------
export const MORE_ACTIONS = {
  async settingsSave(req, res, u, b, s, deny) {
    if (deny("settings.manage")) return;
    const section = String(b.section || "");
    if (!CLEAN[section]) return res.status(400).json({ error: "Unknown settings section." });
    const value = CLEAN[section](b.value || {}, s[section]);
    if (section === "brand" && value.portal !== s.brand.portal) {
      const why = await portalAnswers(value.portal);
      if (why) return res.status(400).json({ error: why });
    }
    if (section === "security" && value.staffTwoStep && !s.security.staffTwoStep && !u.totp_enabled) {
      return res.status(400).json({ error: "Turn on two-step verification for yourself first (your account page), so requiring it can’t lock you out." });
    }
    const was = s[section] && s[section].image;
    if (section === "signin" && value.image !== was && LOGIN_UPLOAD.test(value.image)) {
      const meta = await head(LOGIN_UPLOAD.exec(value.image)[1]).catch(() => null);
      if (!meta) return res.status(409).json({ error: "The photo didn’t finish uploading. Try it again." });
    }
    await saveSection(section, value);
    if (section === "signin" && value.image !== was) await dropLoginImage(was);
    await audit(req, u, "settings", `Changed settings: ${section}`);
    return res.status(200).json({ ok: true, value });
  },

  /** An upload link for a new login photo: one JPEG (the browser resizes it first), used once Login screen is saved. */
  async loginImageStart(req, res, u, b, s, deny) {
    if (deny("settings.manage")) return;
    if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: "Uploading a photo needs file storage (Vercel → Storage → Blob). Until then, choose one of the photos here." });
    const size = Number(b.size) || 0;
    if (size <= 0) return res.status(400).json({ error: "That photo is empty." });
    if (size > MAX_LOGIN_IMAGE) return res.status(413).json({ error: "That photo is too large. Try a smaller one." });
    const pathname = `brand/login-${randomUUID()}.jpg`;
    const token = await generateClientTokenFromReadWriteToken({
      pathname, maximumSizeInBytes: MAX_LOGIN_IMAGE, allowedContentTypes: ["image/jpeg"],
      validUntil: Date.now() + 15 * 60 * 1000, addRandomSuffix: false, allowOverwrite: false,
    });
    return res.status(201).json({ pathname, token, image: "upload:" + pathname });
  },

  async settingsReset(req, res, u, b, s, deny) {
    if (deny("settings.manage")) return;
    const section = String(b.section || "");
    if (!CLEAN[section] && section !== "roles") return res.status(400).json({ error: "Unknown settings section." });
    await saveSection(section, DEFAULTS[section]);
    if (section === "signin") await dropLoginImage(s.signin && s.signin.image);
    await audit(req, u, "settings", `Reset settings to defaults: ${section}`);
    return res.status(200).json({ ok: true });
  },

  /** What each role may do. Owners always have everything; owner-only permissions can't be granted. */
  async rolesSave(req, res, u, b, s, deny) {
    if (deny("settings.manage")) return;
    const input = b.roles && typeof b.roles === "object" ? b.roles : {};
    const out = {};
    for (const role of ["manager", "editor", "approver", "reviewer", "viewer"]) {
      const keys = Object.keys(ROLE_DEFAULTS[role]);
      const given = input[role] && typeof input[role] === "object" ? input[role] : {};
      out[role] = {};
      for (const k of keys) {
        const ownerOnly = STAFF_PERMS.some((p) => p.key === k && p.owner);
        out[role][k] = ownerOnly ? false : typeof given[k] === "boolean" ? given[k] : ROLE_DEFAULTS[role][k];
      }
    }
    await saveSection("roles", out);
    await audit(req, u, "roles", "Changed what roles can do");
    return res.status(200).json({ ok: true });
  },

  // ---------- payments (Stripe; _payments.js) ----------
  /** Asks the client to pay: what for, how much, and by when. The client is emailed a link to pay. */
  async paymentCreate(req, res, u, b, s, deny) {
    if (deny("payments.manage")) return;
    const conn = await stripeConnection();
    if (!conn) return res.status(409).json({ error: "Connect Stripe first (Studio → Connections → Payments)." });
    if (!isUuid(b.projectId)) return res.status(400).json({ error: "That project isn’t valid." });
    const p = (await sql`select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id where p.id = ${b.projectId}`)[0];
    if (!p) return res.status(404).json({ error: "That project was removed." });
    const title = text(b.title, 120);
    if (!title) return res.status(400).json({ error: "Say what it’s for, like “Deposit (50%)”." });
    const amount = parseAmount(b.amount);
    if (!amount) return res.status(400).json({ error: "Enter an amount between 0.50 and 999,999.99." });
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due || "")) ? b.due : null;
    const currency = currencyOf(conn);
    const [row] = await sql`insert into payments (project_id, title, amount, currency, due, note, created_by, created_by_name)
      values (${p.id}, ${title}, ${amount}, ${currency}, ${due}, ${longText(b.note, 600) || null}, ${u.id}, ${u.name}) returning id`;
    await sql`update projects set updated_at = now() where id = ${p.id}`;
    const label = money(amount, currency);
    await audit(req, u, "payment.request", `Asked ${p.client_name} to pay ${label}: ${title}`, { projectId: p.id, clientId: p.client_id });
    const origin = originOf(req);
    if (b.tell !== false) await later(() => notify({ audience: "client", project: p, actor: u, origin, need: "payments", path: `/payments/${p.id}`, button: `Pay ${label}`,
      subject: `${s.brand.studio}: ${title}, ${label}`, lines: [`${title} for ${p.title}: ${label}${due ? `, due ${new Date(due + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : ""}.`, b.note ? text(b.note, 600) : "", "You can pay by card or bank on Stripe’s secure checkout. The portal never sees your card details."] }), "notify");
    return res.status(201).json({ id: row.id, label });
  },

  /** Takes back a request that hasn't been paid. An open checkout is stopped so it can't be paid any more. */
  async paymentCancel(req, res, u, b, s, deny) {
    if (deny("payments.manage")) return;
    const pay = await paymentRow(b.id);
    if (!pay) return res.status(404).json({ error: "That payment was removed." });
    if (pay.status !== "open") return res.status(409).json({ error: pay.status === "processing" ? "A bank payment is already on its way for this one. Refund it in Stripe if you need to." : "Only an unpaid request can be canceled." });
    await expire(await stripeConnection(), pay);
    await sql`update payments set status = 'canceled', updated_at = now() where id = ${pay.id} and status = 'open'`;
    await audit(req, u, "payment.cancel", `Canceled the request for ${money(pay.amount, pay.currency)}: ${pay.title}`, { projectId: pay.project_id, clientId: pay.client_id });
    return res.status(200).json({ ok: true });
  },

  /** Paid another way (a check, a wire): marks it paid so the client sees it and anything held opens. */
  async paymentMarkPaid(req, res, u, b, s, deny) {
    if (deny("payments.manage")) return;
    const pay = await paymentRow(b.id);
    if (!pay) return res.status(404).json({ error: "That payment was removed." });
    if (pay.status !== "open") return res.status(409).json({ error: "Only an unpaid request can be marked paid." });
    await expire(await stripeConnection(), pay);
    const how = text(b.how, 80) || "another way";
    await sql`update payments set status = 'paid', method = 'outside', paid_at = now(), paid_by_name = ${`Recorded by ${u.name} (${how})`}, updated_at = now()
              where id = ${pay.id} and status = 'open'`;
    await audit(req, u, "payment.outside", `Marked ${money(pay.amount, pay.currency)} paid (${how}): ${pay.title}`, { projectId: pay.project_id, clientId: pay.client_id });
    return res.status(200).json({ ok: true });
  },

  // ---------- connections ----------
  async connectionCreate(req, res, u, b, s, deny) {
    if (deny("connections.manage")) return;
    const prov = PROVIDERS[b.provider];
    if (!prov || prov.meta.builtin) return res.status(400).json({ error: "Choose what to connect." });
    if (["notion", "resend", "stripe"].includes(prov.meta.key) && (await listConnections()).some((c) => c.provider === prov.meta.key && !c.env)) {
      return res.status(409).json({ error: `${prov.meta.name} is already connected. Edit that connection instead.` });
    }
    const { creds, config, missing } = splitFields(prov.meta, b.values || {}, {});
    if (missing.length) return res.status(400).json({ error: `Fill in: ${missing.join(", ")}.` });
    const name = text(b.name, 80) || prov.meta.name;
    const id = await createConnection({ provider: prov.meta.key, name, creds, config });
    const result = await runTest(id);
    await audit(req, u, "connection.add", `Connected ${prov.meta.name} (${name})${result.ok ? "" : " — it isn’t working yet"}`);
    return res.status(201).json({ id, test: result });
  },

  async connectionUpdate(req, res, u, b, s, deny) {
    if (deny("connections.manage")) return;
    const conn = await getConnection(b.id);
    if (!conn || conn.env) return res.status(404).json({ error: conn && conn.env ? "This connection comes from Vercel settings; change it there." : "That connection was removed." });
    const prov = PROVIDERS[conn.provider];
    const { creds, config, missing } = splitFields(prov.meta, b.values || {}, conn.creds || {});
    if (missing.length) return res.status(400).json({ error: `Fill in: ${missing.join(", ")}.` });
    // Changing how Frame.io signs in starts its login over.
    const resetAuth = conn.provider === "frameio" && (creds.auth !== conn.creds.auth || creds.clientId !== conn.creds.clientId);
    await updateConnection(conn.id, { name: text(b.name, 80) || conn.name, creds: resetAuth ? { ...creds, accessToken: null, refreshToken: null, expiresAt: null } : { ...conn.creds, ...creds }, config });
    const result = await runTest(conn.id);
    await audit(req, u, "connection.update", `Changed the ${prov.meta.name} connection (${conn.name})`);
    return res.status(200).json({ ok: true, test: result });
  },

  async connectionTest(req, res, u, b, s, deny) {
    if (deny("connections.manage")) return;
    return res.status(200).json({ test: await runTest(b.id) });
  },

  /** Frame.io: which account to use, when the login can see several. */
  async connectionAccount(req, res, u, b, s, deny) {
    if (deny("connections.manage")) return;
    const conn = await getConnection(b.id);
    if (!conn || conn.provider !== "frameio") return res.status(404).json({ error: "That connection was removed." });
    await updateConnection(conn.id, { config: { accountId: text(b.accountId, 64) } });
    return res.status(200).json({ test: await runTest(conn.id) });
  },

  async connectionDelete(req, res, u, b, s, deny) {
    if (deny("connections.manage")) return;
    const conn = await getConnection(b.id);
    if (!conn || conn.env) return res.status(404).json({ error: conn && conn.env ? "This connection comes from Vercel settings; remove it there." : "That connection was already removed." });
    const used = (await sql`select count(*)::int as n from projects where source_conn = ${conn.id}`)[0].n;
    if (used && !b.force) return res.status(409).json({ error: `${used} project${used === 1 ? " plays" : "s play"} from this connection. Removing it leaves ${used === 1 ? "it" : "them"} without videos until you choose another source.`, inUse: used });
    if (used) await sql`update projects set source_conn = null, source_ref = null where source_conn = ${conn.id}`;
    if (conn.provider === "notion" && s.notion.connectionId === conn.id) await saveSection("notion", DEFAULTS.notion);
    if (conn.provider === "frameio" && conn.creds.webhooks && Object.keys(conn.creds.webhooks).length) await setLive(conn, false, "").catch(() => {});
    await deleteConnection(conn.id);
    await audit(req, u, "connection.remove", `Removed the ${PROVIDERS[conn.provider].meta.name} connection (${conn.name})${used ? `; ${used} project(s) now have no video source` : ""}`);
    return res.status(200).json({ ok: true });
  },

  /**
   * Frame.io live updates on or off: a webhook in each workspace of the connected account, so new comments and
   * versions reach the portal (and the client's email) straight away instead of when someone next opens them.
   */
  async frameioLive(req, res, u, b, s, deny) {
    if (deny("connections.manage")) return;
    const conn = await getConnection(b.id);
    if (!conn || conn.provider !== "frameio") return res.status(404).json({ error: "That Frame.io connection was removed." });
    const url = `${originOf(req)}/api/connect?webhook=frameio&c=${conn.id}`;
    if (b.on && !/^https:\/\//.test(url) && !/^http:\/\/localhost(:\d+)?\//.test(url)) return res.status(409).json({ error: "Live updates need the portal’s public https address." });
    try {
      const n = await setLive(conn, !!b.on, url);
      await audit(req, u, "connection.live", b.on ? `Turned on Frame.io live updates (${n} workspace${n === 1 ? "" : "s"})` : "Turned off Frame.io live updates");
      return res.status(200).json({ on: !!b.on && n > 0, workspaces: n });
    } catch (err) {
      console.error("frame.io live updates failed", err.message);
      return res.status(502).json({ error: `Frame.io didn’t accept it: ${err.message.slice(0, 200)}` });
    }
  },

  /** Clears every cached listing, so the next page load reads straight from the sources. */
  async sourceRefresh(req, res, u) {
    const conns = await listConnections({ withCreds: true });
    for (const c of conns) if (VIDEO[c.provider] && VIDEO[c.provider].forget) VIDEO[c.provider].forget(c);
    forgetConnections();
    return res.status(200).json({ ok: true });
  },

  /** Sends a test email to the person pressing the button. */
  async emailTest(req, res, u, b, s, deny) {
    if (deny("connections.manage")) return;
    if (!(await emailReady())) return res.status(409).json({ error: "Add the email connection first." });
    const ok = await sendEmail({ to: u.email, subject: `Test email from the ${s.brand.studio} portal`,
      html: layout({ studio: s.brand.studio, eyebrow: "Test", lines: ["This is a test from Studio → Connections. If you’re reading it, email works."] }) });
    return ok ? res.status(200).json({ ok: true, to: u.email }) : res.status(502).json({ error: "Resend didn’t accept the email. Check the API key and that the sender’s domain is verified in Resend." });
  },

  // ---------- Notion ----------
  async notionCreateDatabase(req, res, u, b, s, deny) {
    if (deny("connections.manage")) return;
    const conn = await notion.notionConnection();
    if (!conn) return res.status(409).json({ error: "Add the Notion connection first." });
    if (!/^[\w-]{20,40}$/.test(String(b.pageId || ""))) return res.status(400).json({ error: "Choose a page." });
    await notion.createDatabase(conn, b.pageId, text(b.title, 100) || `${s.brand.studio} projects`);
    await audit(req, u, "notion", "Created the Notion projects database");
    await later(() => notion.syncAll(), "notion sync");
    return res.status(200).json({ ok: true });
  },

  async notionUseDatabase(req, res, u, b, s, deny) {
    if (deny("connections.manage")) return;
    const conn = await notion.notionConnection();
    if (!conn) return res.status(409).json({ error: "Add the Notion connection first." });
    if (!/^[\w-]{20,40}$/.test(String(b.dataSourceId || ""))) return res.status(400).json({ error: "Choose a database." });
    await notion.useDataSource(conn, b.dataSourceId);
    await audit(req, u, "notion", "Chose the Notion database for projects");
    await later(() => notion.syncAll(), "notion sync");
    return res.status(200).json({ ok: true });
  },

  async notionSyncAll(req, res, u, b, s, deny) {
    if (deny("connections.manage")) return;
    if (!s.notion.dataSourceId) return res.status(409).json({ error: "Choose the Notion database first." });
    const n = (await sql`select count(*)::int as n from projects`)[0].n;
    await audit(req, u, "notion", "Synced every project to Notion");
    await later(() => notion.syncAll(), "notion sync");
    return res.status(200).json({ ok: true, projects: n });
  },

  async notionDisconnect(req, res, u, b, s, deny) {
    if (deny("connections.manage")) return;
    await saveSection("notion", DEFAULTS.notion);
    await sql`update projects set notion_page_id = null`;
    await audit(req, u, "notion", "Stopped syncing to Notion (the database stays in Notion)");
    return res.status(200).json({ ok: true });
  },
};

/** Splits submitted form values into credentials (encrypted) and config, keeping stored secrets left blank. */
function splitFields(meta, values, current) {
  const creds = {}, config = {}, missing = [];
  const authChoice = values.auth || current.auth;
  for (const f of meta.fields || []) {
    if (f.when && !f.when.includes(authChoice)) continue;
    const raw = values[f.key];
    const v = raw === undefined || raw === null ? "" : String(raw).trim().slice(0, 4000);
    if (f.config) { if (v) config[f.key] = v; else if (f.key === "from") missing.push(f.label); continue; }
    if (v) creds[f.key] = v;
    else if (current[f.key]) creds[f.key] = current[f.key];
    else if (!/optional/i.test(f.label)) missing.push(f.label);
  }
  return { creds, config, missing };
}

/** Tests a connection, records the result, and applies anything the test learned (e.g. the only account). */
async function runTest(id) {
  const conn = await getConnection(id);
  if (!conn) return { ok: false, error: "That connection was removed." };
  const prov = conn.provider === "notion" ? notion : PROVIDERS[conn.provider];
  try {
    const t = conn.provider === "resend" ? await testResend(conn) : await prov.test(conn);
    if (t.configPatch) await updateConnection(conn.id, { config: t.configPatch });
    await updateConnection(conn.id, { status: t.needsSignIn ? "error" : "ok", lastError: t.needsSignIn ? "Needs Adobe sign-in" : null, config: t.account ? { account: t.account.name || "" } : undefined });
    return { ok: !t.needsSignIn, ...t, configPatch: undefined };
  } catch (err) {
    await updateConnection(conn.id, { status: "error", lastError: err.message.slice(0, 300) });
    return { ok: false, error: err.status === 401 || err.status === 403 ? `${PROVIDERS[conn.provider].meta.name} refused the credentials. Check them and try again. (${err.message})` : err.message };
  }
}

async function testResend(conn) {
  const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: "Bearer " + conn.creds.apiKey }, signal: AbortSignal.timeout(8000) });
  if (r.status === 401 || r.status === 403) {
    // A "sending access" key can't list domains; that's still a working key.
    const t = await r.text();
    if (r.status === 401 && /restricted|sending/i.test(t)) return { account: { name: conn.config.from || "Resend" }, notes: ["Press “Send a test email” to check it end to end."] };
    throw Object.assign(new Error("Resend refused the API key."), { status: r.status });
  }
  if (!r.ok) throw new Error(`Resend answered ${r.status}.`);
  const d = await r.json();
  const domains = (d.data || []).map((x) => `${x.name} (${x.status})`);
  return { account: { name: conn.config.from || "Resend" }, notes: domains.length ? [`Domains: ${domains.join(", ")}.`, "Press “Send a test email” to check it end to end."] : ["Press “Send a test email” to check it end to end."] };
}
