import bcrypt from "bcryptjs";
import { del } from "@vercel/blob";
import { sql, ready, dbConfigured } from "./_db.js";
import { TROUBLE, readBody, requireStaff, isUuid, text, longText } from "./_auth.js";
import { CAPABILITIES, capsOf, cleanCaps } from "./_caps.js";
import { getSettings, stageNames } from "./_settings.js";
import { STAFF_ROLES, CLIENT_ROLES, STAFF_PERMS, CLIENT_PERMS, rolePermissions, permsOf, can, accessOf, roleLabel, validAccess } from "./_roles.js";
import { listConnections, getConnection } from "./_connections.js";
import { VIDEO, LINKS_ID, providerList } from "./_providers/index.js";
import { parseLink, lookup } from "./_providers/links.js";
import { projectVideos, sourceOf, forgetSource } from "./_sources.js";
import { emailReady, originOf, notify } from "./_notify.js";
import { createLink, emailLink, emailSignup } from "./_links.js";
import { randomToken } from "./_crypto.js";
import { audit } from "./_audit.js";
import { later } from "./_later.js";
import { syncProject, trashProjectRow } from "./_notion.js";
import { MORE_GETS, MORE_ACTIONS } from "./_admin_more.js";
import { cleanDomains, domainOf } from "./_signup.js";
import { demoAdmin } from "./_demo.js";
import { paymentsFor, stripeConnection, liveMode, currencyOf, EVENTS } from "./_payments.js";
import { joinToken, joinUrl, newJoinLink, joinRole, addToProject } from "./_join.js";

/**
 * Studio: staff only. Each action checks the person's role (_roles.js).
 *
 * GET  /api/admin                       clients, people, account requests, projects, roles, connections, settings, status
 * GET  /api/admin?sources=<connection>  folders, projects, or playlists in a video connection
 * GET  /api/admin?videos=<project>      every video in a project's source, with staff choices (hidden, renamed)
 * GET  /api/admin?audit=1 | ?health=1 | ?export=… | ?notion=…   see _admin_more.js
 * POST /api/admin {action}              see ACTIONS below and in _admin_more.js
 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const iso = (d) => (d ? new Date(d).toISOString() : null);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!dbConfigured()) return res.status(503).json({ error: "The portal isn’t connected to its database yet." });
  try { await ready(); } catch (err) { console.error("db not ready", err); return res.status(500).json({ error: TROUBLE }); }
  const u = await requireStaff(req, res);
  if (!u) return;
  // The demo's studio view, for staff: sample data only, nothing read from or written to the database.
  if (req.method === "GET" && req.query && req.query.demo) return res.status(200).json(demoAdmin(req.query, originOf(req)));
  const s = await getSettings();
  const deny = (perm) => (can(u, perm, s) ? false : (res.status(403).json({ error: "Your role doesn’t allow that. Ask an owner." }), true));
  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (q.sources) return await sources(req, res, String(q.sources));
      if (q.videos) return await videos(req, res, u, String(q.videos), !!q.fresh);
      for (const [k, fn] of Object.entries(MORE_GETS)) if (q[k]) return await fn(req, res, u, s, deny);
      return await overview(req, res, u, s);
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const b = readBody(req, res);
    if (!b) return;
    const fn = ACTIONS[b.action] || MORE_ACTIONS[b.action];
    if (!fn) return res.status(400).json({ error: "Unknown action." });
    return await fn(req, res, u, b, s, deny);
  } catch (err) {
    if (err && err.code === "23505") return res.status(409).json({ error: "Someone already uses that email address." });
    if (err && err.status && err.status < 500 && err.message) return res.status(err.status === 401 || err.status === 403 ? 502 : 400).json({ error: err.message });
    console.error("admin action failed", err);
    return res.status(500).json({ error: TROUBLE });
  }
}

async function overview(req, res, u, s) {
  const [clients, people, projects, conns, signups, members] = await Promise.all([
    sql`select c.id, c.name, c.logo_url, c.notes, c.domains, c.created_at,
               (select count(*)::int from users x where x.client_id = c.id) as people,
               (select count(*)::int from projects x where x.client_id = c.id and not x.archived) as projects
        from clients c order by lower(c.name)`,
    sql`select u.id, u.name, u.email, u.title, u.role, u.access, u.client_id, u.all_projects, u.last_login_at, u.must_change_password,
               u.totp_enabled, u.created_at, c.name as client_name
        from users u left join clients c on c.id = u.client_id order by u.role, lower(u.name)`,
    sql`select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id
        order by p.archived, p.updated_at desc`,
    listConnections({ withCreds: true }),
    can(u, "people.manage", s) ? sql`select * from signup_requests where status = 'waiting' order by created_at` : [],
    sql`select pp.project_id, pp.user_id, pp.how, pp.created_at, u.name, u.email, u.access, u.role, u.last_login_at
        from project_people pp join users u on u.id = pp.user_id order by pp.created_at`,
  ]);
  // Every project has its own link for the client (_join.js); older projects get theirs the first time Studio opens.
  const origin = originOf(req);
  const links = new Map(await Promise.all(projects.map(async (p) => [p.id, p.archived ? null : await joinToken(p)])));
  const joinedBy = new Map(), joinedTo = new Map();
  for (const m of members) {
    if (!joinedBy.has(m.project_id)) joinedBy.set(m.project_id, []);
    joinedBy.get(m.project_id).push({ id: m.user_id, name: m.name, email: m.email, roleLabel: roleLabel(m), at: iso(m.created_at), lastLogin: iso(m.last_login_at) });
    if (!joinedTo.has(m.user_id)) joinedTo.set(m.user_id, []);
    joinedTo.get(m.user_id).push(m.project_id);
  }
  const names = stageNames(s);
  const connName = new Map(conns.map((c) => [c.id, c]));
  const [pays, stripeConn] = await Promise.all([paymentsFor(projects.map((p) => p.id)), stripeConnection()]);
  return res.status(200).json({
    me: { id: u.id, access: accessOf(u), perms: permsOf(u, s) },
    clients: clients.map((c) => ({ id: c.id, name: c.name, logo: c.logo_url || "", notes: c.notes || "", domains: Array.isArray(c.domains) ? c.domains : [], people: c.people, projects: c.projects, created: iso(c.created_at) })),
    // People who created an account and are waiting for the studio. `match` suggests the client they belong to.
    signups: signups.map((r) => {
      const byName = clients.find((c) => c.name.trim().toLowerCase() === String(r.company || "").trim().toLowerCase());
      const byDomain = clients.find((c) => Array.isArray(c.domains) && c.domains.includes(domainOf(r.email)));
      const match = byDomain || byName || null;
      return { id: r.id, name: r.name, email: r.email, company: r.company || "", note: r.note || "", created: iso(r.created_at), confirmed: iso(r.verified_at), match: match ? { id: match.id, name: match.name } : null };
    }),
    people: people.map((p) => ({
      id: p.id, name: p.name, email: p.email, title: p.title || "", role: p.role, access: accessOf(p), roleLabel: roleLabel(p),
      clientId: p.client_id, clientName: p.client_name || null, lastLogin: iso(p.last_login_at), twoStep: !!p.totp_enabled,
      invited: p.must_change_password && !p.last_login_at, mustChangePassword: p.must_change_password, created: iso(p.created_at),
      // Clients see every project of their company, or only the ones listed (they joined by a project's link).
      ...(p.role === "client" ? { allProjects: p.all_projects !== false, projects: joinedTo.get(p.id) || [] } : {}),
    })),
    projects: projects.map((p) => {
      const c = p.source_conn === LINKS_ID ? { id: LINKS_ID, provider: "links", name: "Video links" } : connName.get(p.source_conn);
      return {
        id: p.id, title: p.title, type: p.type || "", summary: p.summary || "", clientId: p.client_id, clientName: p.client_name,
        stage: Math.min(p.stage_idx, names.length - 1), pct: p.pct,
        next: { label: p.next_label || "", date: p.next_date || "", what: p.next_what || "", confirm: !!p.next_confirm, confirmedAt: iso(p.next_confirmed_at), confirmedBy: p.next_confirmed_by || null },
        reviewDue: day(p.review_due), remindedAt: iso(p.reminded_at),
        source: p.source_conn ? { conn: p.source_conn, ref: p.source_ref || "", provider: c ? c.provider : null, connName: c ? c.name : "A removed connection" } : null,
        imageUrl: p.image_url || "", caps: capsOf(p.capabilities), archived: p.archived, notion: !!p.notion_page_id, updated: iso(p.updated_at),
        payments: pays.get(p.id) || [],
        // The project's own link for the client, what it lets people do, and who joined with it.
        join: { link: joinUrl(origin, links.get(p.id)), off: !!p.join_off, access: joinRole(p), people: joinedBy.get(p.id) || [] },
      };
    }),
    capabilities: CAPABILITIES,
    stages: names,
    roles: { staff: STAFF_ROLES, client: CLIENT_ROLES, staffPerms: STAFF_PERMS, clientPerms: CLIENT_PERMS, permissions: rolePermissions(s) },
    providers: providerList(),
    // Never the credentials themselves: only which way Frame.io signs in, and whether that login is done.
    connections: conns.map((c) => ({
      id: c.id, provider: c.provider, name: c.name, env: c.env, status: c.status, lastError: c.lastError, checked: c.checked, config: safeConfig(c.config),
      ...(c.provider === "frameio" ? { auth: (c.creds && c.creds.auth) || "oauth", signedIn: !!(c.creds && (c.creds.auth !== "oauth" || c.creds.refreshToken)) } : {}),
    })),
    redirectUri: originOf(req) + "/api/connect",
    settings: can(u, "settings.manage", s) || can(u, "connections.manage", s) ? s : { stages: s.stages, caps: s.caps, notion: s.notion },
    email: await emailReady(),
    blob: !!process.env.BLOB_READ_WRITE_TOKEN,
    // Whether clients can pay, and what Stripe's webhook needs (never the keys).
    payments: { ready: !!stripeConn, live: liveMode(stripeConn), webhook: !!(stripeConn && stripeConn.creds.webhookSecret), currency: currencyOf(stripeConn), endpoint: originOf(req) + "/api/connect?webhook=stripe", events: EVENTS },
  });
}

/** Connection config without anything that looks like a credential. */
export const safeConfig = (c) => Object.fromEntries(Object.entries(c || {}).filter(([k]) => !/token|secret|key/i.test(k)));

async function sources(req, res, connId) {
  if (connId === LINKS_ID) return res.status(200).json({ sources: [] });
  const conn = await getConnection(connId);
  if (!conn || !VIDEO[conn.provider]) return res.status(404).json({ error: "That connection was removed." });
  try {
    return res.status(200).json({ sources: await VIDEO[conn.provider].sources(conn) });
  } catch (err) {
    console.error("sources failed", conn.provider, err.message);
    return res.status(502).json({ error: `Couldn’t list ${VIDEO[conn.provider].meta.name}: ${err.message}` });
  }
}

/** Studio's video list for a project: every video at the source, with what the client sees of each. */
async function videos(req, res, u, pid, fresh) {
  if (!isUuid(pid)) return res.status(400).json({ error: "That project isn’t valid." });
  const p = (await sql`select * from projects where id = ${pid}`)[0];
  if (!p) return res.status(404).json({ error: "That project was removed." });
  const src = await sourceOf(p);
  if (!src) return res.status(200).json({ videos: [], source: null });
  if (fresh) await forgetSource(p);
  try {
    const list = await projectVideos(p, { keepHidden: true, fresh });
    const ups = new Set((await sql`select vimeo_id from video_uploads where project_id = ${p.id} and uploader_role = 'client'`).map((r) => r.vimeo_id));
    const links = src.conn.provider === "links" ? await sql`select id, url from link_videos where project_id = ${p.id}` : [];
    const linkBy = new Map(links.map((l) => [l.id.replace(/-/g, ""), l]));
    return res.status(200).json({
      source: { provider: src.conn.provider, name: src.provider.meta.name },
      videos: list.map((v) => ({
        id: v.id, title: v.title, thumbnail: v.thumbnail, durationLabel: v.durationLabel, created: v.created, ready: v.ready, status: v.status,
        hidden: !!v.hidden, kind: ups.has(v.id) ? "client" : v.version != null ? "version" : "film", version: v.version, baseTitle: v.baseTitle,
        forcedFilm: !!v.forcedFilm, stacked: !!v.stack, manage: v.manage, link: linkBy.has(v.id) ? linkBy.get(v.id).url : null,
        linkId: linkBy.has(v.id) ? linkBy.get(v.id).id : null,
      })),
    });
  } catch (err) {
    return res.status(502).json({ error: `${src.provider.meta.name} didn’t answer: ${err.message}` });
  }
}

/** A client id from the body, or a new client created from clientName. */
async function clientFrom(b) {
  if (isUuid(b.clientId)) {
    const c = (await sql`select id from clients where id = ${b.clientId}`)[0];
    if (c) return c.id;
  }
  const name = text(b.clientName, 120);
  if (!name) return null;
  const existing = (await sql`select id from clients where lower(name) = lower(${name}) limit 1`)[0];
  if (existing) return existing.id;
  return (await sql`insert into clients (name) values (${name}) returning id`)[0].id;
}

/** Checks a project source: the connection exists and the folder/playlist is reachable. Returns an error or null. */
async function checkSource(source) {
  if (!source || !source.conn) return null;
  if (source.conn === LINKS_ID) return null;
  const conn = await getConnection(source.conn);
  if (!conn || !VIDEO[conn.provider]) return "Choose a video connection (Studio → Connections).";
  const prov = VIDEO[conn.provider];
  const ref = String(source.ref || "").trim();
  if (!ref) return `Choose the ${prov.meta.source ? prov.meta.source.label.toLowerCase() : "source"} in ${conn.name}.`;
  const bad = prov.checkRef(ref);
  if (bad) return bad;
  try { await prov.videos(conn, ref, { fresh: true }); return null; } catch (err) {
    return err.status === 404 ? `${prov.meta.name} has no ${prov.meta.source.label.toLowerCase()} with that ID in this account.` : `${prov.meta.name} didn’t answer: ${err.message}`;
  }
}

/** Removes the stored files behind some projects (their rows go with the projects). */
async function deleteBlobs(projectIds) {
  if (!projectIds.length || !process.env.BLOB_READ_WRITE_TOKEN) return;
  const rows = await sql`select pathname from files where project_id = any(${projectIds})`;
  if (rows.length) await del(rows.map((r) => r.pathname)).catch((err) => console.error("blob cleanup failed", err.message));
}

const cleanDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);

const ACTIONS = {
  // ---------- clients ----------
  async clientCreate(req, res, u, b, s, deny) {
    if (deny("clients.manage")) return;
    const name = text(b.name, 120);
    if (!name) return res.status(400).json({ error: "Enter the client’s name." });
    const domains = await cleanDomains(b.domains, null);
    const [c] = await sql`insert into clients (name, logo_url, notes, domains) values (${name}, ${httpsUrl(b.logo)}, ${longText(b.notes, 2000) || null}, ${JSON.stringify(domains)}::jsonb) returning id`;
    await audit(req, u, "client.create", `Added client ${name}`, { clientId: c.id });
    return res.status(201).json({ id: c.id });
  },

  async clientUpdate(req, res, u, b, s, deny) {
    if (deny("clients.manage")) return;
    if (!isUuid(b.id)) return res.status(400).json({ error: "That client isn’t valid." });
    const cur = (await sql`select * from clients where id = ${b.id}`)[0];
    if (!cur) return res.status(404).json({ error: "That client was removed." });
    const name = b.name === undefined ? cur.name : text(b.name, 120);
    if (!name) return res.status(400).json({ error: "Enter the client’s name." });
    const domains = b.domains === undefined ? (Array.isArray(cur.domains) ? cur.domains : []) : await cleanDomains(b.domains, cur.id);
    await sql`update clients set name = ${name}, logo_url = ${b.logo === undefined ? cur.logo_url : httpsUrl(b.logo)},
              notes = ${b.notes === undefined ? cur.notes : longText(b.notes, 2000) || null}, domains = ${JSON.stringify(domains)}::jsonb where id = ${cur.id}`;
    await audit(req, u, "client.update", name !== cur.name ? `Renamed client ${cur.name} to ${name}` : `Updated client ${name}`, { clientId: cur.id });
    return res.status(200).json({ ok: true });
  },
  // Older pages call it clientRename.
  async clientRename(req, res, u, b, s, deny) { return ACTIONS.clientUpdate(req, res, u, { id: b.id, name: b.name }, s, deny); },

  async clientDelete(req, res, u, b, s, deny) {
    if (deny("clients.delete")) return;
    if (!isUuid(b.id)) return res.status(400).json({ error: "That client isn’t valid." });
    const c = (await sql`select id, name from clients where id = ${b.id}`)[0];
    if (!c) return res.status(404).json({ error: "That client was already removed." });
    if (String(b.confirm || "").trim() !== c.name) return res.status(400).json({ error: `Type “${c.name}” exactly to confirm.` });
    const ps = await sql`select id, notion_page_id from projects where client_id = ${c.id}`;
    await deleteBlobs(ps.map((p) => p.id));
    await sql`delete from clients where id = ${c.id}`;
    await audit(req, u, "client.delete", `Deleted client ${c.name}, with ${ps.length} project${ps.length === 1 ? "" : "s"}`);
    await later(async () => { for (const p of ps) await trashProjectRow(p.notion_page_id); }, "notion trash");
    return res.status(200).json({ ok: true });
  },

  // ---------- people ----------
  async personCreate(req, res, u, b, s) {
    const name = text(b.name, 100);
    const email = String(b.email || "").trim().toLowerCase().slice(0, 320);
    const role = b.role === "admin" ? "admin" : "client";
    if (!can(u, role === "admin" ? "staff.manage" : "people.manage", s)) return res.status(403).json({ error: "Your role doesn’t allow adding " + (role === "admin" ? "staff." : "people.") });
    const access = validAccess(role, b.access) ? b.access : role === "admin" ? "editor" : "approver";
    if (!name || !EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a name and a valid email." });
    const clientId = role === "client" ? await clientFrom(b) : null;
    if (role === "client" && !clientId) return res.status(400).json({ error: "Choose which client this person belongs to." });
    const [p] = await sql`
      insert into users (email, name, title, role, access, client_id, password_hash, must_change_password)
      values (${email}, ${name}, ${text(b.title, 100) || null}, ${role}, ${access}, ${clientId}, ${await bcrypt.hash(randomToken(), 10)}, true)
      returning *`;
    const link = await createLink(p.id, "invite", originOf(req));
    const emailed = b.send !== false && (await emailReady()) ? await emailLink(p, "invite", link, u.name) : false;
    await audit(req, u, "person.create", `Invited ${name} (${email}) as ${roleLabel(p)}${emailed ? ", by email" : ""}`, { clientId });
    return res.status(201).json({ id: p.id, inviteLink: link, emailed });
  },

  async personUpdate(req, res, u, b, s) {
    if (!isUuid(b.id)) return res.status(400).json({ error: "That person isn’t valid." });
    const cur = (await sql`select * from users where id = ${b.id}`)[0];
    if (!cur) return res.status(404).json({ error: "That person was removed." });
    const role = b.role === "admin" || b.role === "client" ? b.role : cur.role;
    const touchesStaff = cur.role === "admin" || role === "admin";
    if (!can(u, touchesStaff ? "staff.manage" : "people.manage", s)) return res.status(403).json({ error: "Your role doesn’t allow changing " + (touchesStaff ? "staff." : "people.") });
    const access = validAccess(role, b.access) ? b.access : role === cur.role ? accessOf(cur) : role === "admin" ? "editor" : "approver";
    if (cur.id === u.id && (role !== cur.role || access !== accessOf(cur))) return res.status(400).json({ error: "You can’t change your own role. Ask another owner." });
    if (cur.role === "admin" && accessOf(cur) === "owner" && (role !== "admin" || access !== "owner") && (await ownerCount()) <= 1) {
      return res.status(400).json({ error: "The portal needs at least one owner. Make someone else an owner first." });
    }
    const name = text(b.name, 100) || cur.name;
    const title = b.title === undefined ? cur.title : text(b.title, 100) || null;
    const email = b.email === undefined ? cur.email : String(b.email || "").trim().toLowerCase().slice(0, 320);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email." });
    const clientId = role === "client" ? (await clientFrom(b)) || cur.client_id : null;
    if (role === "client" && !clientId) return res.status(400).json({ error: "Choose which client this person belongs to." });
    // Which projects a client sees: all of their company's, or only the ones chosen (projectIds).
    const allProjects = role !== "client" ? true : b.allProjects === undefined ? cur.all_projects !== false : !!b.allProjects;
    let picked = null;
    if (role === "client" && !allProjects && Array.isArray(b.projectIds)) {
      picked = b.projectIds.filter(isUuid).slice(0, 200);
      const real = picked.length ? await sql`select id from projects where id = any(${picked})` : [];
      picked = real.map((r) => r.id);
    }
    // Changing what someone can see or how they log in restarts their sessions.
    const bump = role !== cur.role || access !== accessOf(cur) || clientId !== cur.client_id || email !== cur.email;
    await sql`update users set name = ${name}, title = ${title}, email = ${email}, role = ${role}, access = ${access}, client_id = ${clientId},
              all_projects = ${allProjects}, session_version = session_version + ${bump ? 1 : 0} where id = ${cur.id}`;
    if (picked) {
      await sql`delete from project_people where user_id = ${cur.id} and not (project_id = any(${picked}))`;
      for (const pid of picked) await addToProject(cur.id, pid, "studio");
    }
    const scope = allProjects !== (cur.all_projects !== false) || picked ? (allProjects ? "sees every project of their company" : `sees ${picked ? picked.length : "only the chosen"} project${picked && picked.length === 1 ? "" : "s"}`) : "";
    const what = [role !== cur.role || access !== accessOf(cur) ? `role to ${roleLabel({ role, access })}` : "", email !== cur.email ? `email to ${email}` : "", clientId !== cur.client_id ? "company" : "", scope].filter(Boolean);
    await audit(req, u, "person.update", `Updated ${name}${what.length ? ": " + what.join(", ") : ""}`, { clientId });
    return res.status(200).json({ ok: true });
  },

  /** A fresh invite (never logged in) or password-reset link, shown to staff and emailed if they choose. */
  async personInvite(req, res, u, b, s) {
    const p = isUuid(b.id) && (await sql`select * from users where id = ${b.id}`)[0];
    if (!p) return res.status(404).json({ error: "That person was removed." });
    if (!can(u, p.role === "admin" ? "staff.manage" : "people.manage", s)) return res.status(403).json({ error: "Your role doesn’t allow that." });
    if (p.id === u.id) return res.status(400).json({ error: "Change your own password on your account page." });
    const purpose = p.last_login_at ? "reset" : "invite";
    const link = await createLink(p.id, purpose, originOf(req));
    const emailed = b.send !== false && (await emailReady()) ? await emailLink(p, purpose, link, u.name) : false;
    await audit(req, u, "person." + purpose, `${purpose === "invite" ? "Sent a new invitation to" : "Sent a password reset link to"} ${p.name}${emailed ? " by email" : ""}`, { clientId: p.client_id });
    return res.status(200).json({ link, purpose, emailed });
  },
  // Older pages call it personReset.
  async personReset(req, res, u, b, s) { return ACTIONS.personInvite(req, res, u, b, s); },

  async personSignOut(req, res, u, b, s) {
    const p = isUuid(b.id) && (await sql`select * from users where id = ${b.id}`)[0];
    if (!p) return res.status(404).json({ error: "That person was removed." });
    if (!can(u, p.role === "admin" ? "staff.manage" : "people.manage", s)) return res.status(403).json({ error: "Your role doesn’t allow that." });
    await sql`update users set session_version = session_version + 1 where id = ${p.id}`;
    await audit(req, u, "person.signout", `Signed ${p.name} out everywhere`, { clientId: p.client_id });
    return res.status(200).json({ ok: true });
  },

  async personTwoStepReset(req, res, u, b, s) {
    const p = isUuid(b.id) && (await sql`select * from users where id = ${b.id}`)[0];
    if (!p) return res.status(404).json({ error: "That person was removed." });
    if (!can(u, p.role === "admin" ? "staff.manage" : "people.manage", s)) return res.status(403).json({ error: "Your role doesn’t allow that." });
    if (p.id === u.id) return res.status(400).json({ error: "Ask another owner to do this for you." });
    await sql`update users set totp_enabled = false, totp_secret = null, recovery_codes = '[]'::jsonb, session_version = session_version + 1 where id = ${p.id}`;
    await audit(req, u, "person.twostep", `Turned off two-step verification for ${p.name} (lost device)`, { clientId: p.client_id });
    return res.status(200).json({ ok: true });
  },

  async personDelete(req, res, u, b, s) {
    if (!isUuid(b.id)) return res.status(400).json({ error: "That person isn’t valid." });
    if (b.id === u.id) return res.status(400).json({ error: "You can’t remove yourself. Ask another owner." });
    const p = (await sql`select * from users where id = ${b.id}`)[0];
    if (!p) return res.status(200).json({ ok: true });
    if (!can(u, p.role === "admin" ? "staff.manage" : "people.manage", s)) return res.status(403).json({ error: "Your role doesn’t allow that." });
    if (p.role === "admin" && accessOf(p) === "owner" && (await ownerCount()) <= 1) return res.status(400).json({ error: "The portal needs at least one owner." });
    await sql`delete from users where id = ${p.id}`;
    await audit(req, u, "person.delete", `Removed ${p.name} (${p.email})`, { clientId: p.client_id });
    return res.status(200).json({ ok: true });
  },

  // ---------- account requests (sign-up) ----------
  /** Lets someone who asked in: puts them in a client with a role and emails their invitation. */
  async signupApprove(req, res, u, b, s, deny) {
    if (deny("people.manage")) return;
    const r = isUuid(b.id) && (await sql`select * from signup_requests where id = ${b.id}`)[0];
    if (!r || r.status !== "waiting") return res.status(404).json({ error: "That request was already handled." });
    const access = validAccess("client", b.access) ? b.access : "approver";
    const clientId = await clientFrom(b);
    if (!clientId) return res.status(400).json({ error: "Choose which client they belong to, or type a new client’s name." });
    if ((await sql`select 1 from users where email = ${r.email} union all select 1 from user_emails where email = ${r.email}`)[0]) {
      await sql`update signup_requests set status = 'joined', decided_by = ${u.name}, decided_at = now() where id = ${r.id}`;
      return res.status(409).json({ error: `${r.email} already has an account.` });
    }
    const [p] = await sql`
      insert into users (email, name, role, access, client_id, password_hash, must_change_password)
      values (${r.email}, ${r.name}, 'client', ${access}, ${clientId}, ${await bcrypt.hash(randomToken(), 10)}, true)
      returning *`;
    await sql`update signup_requests set status = 'approved', client_id = ${clientId}, user_id = ${p.id}, decided_by = ${u.name}, decided_at = now() where id = ${r.id}`;
    const link = await createLink(p.id, "invite", originOf(req));
    const emailed = (await emailReady()) ? await emailLink(p, "invite", link, u.name) : false;
    const c = (await sql`select name from clients where id = ${clientId}`)[0];
    await audit(req, u, "signup.approve", `Approved ${r.name} (${r.email}) into ${c.name} as ${roleLabel(p)}`, { clientId });
    return res.status(200).json({ id: p.id, inviteLink: link, emailed });
  },

  async signupDecline(req, res, u, b, s, deny) {
    if (deny("people.manage")) return;
    const r = isUuid(b.id) && (await sql`select * from signup_requests where id = ${b.id}`)[0];
    if (!r || r.status !== "waiting") return res.status(404).json({ error: "That request was already handled." });
    await sql`update signup_requests set status = 'declined', decided_by = ${u.name}, decided_at = now() where id = ${r.id}`;
    const told = b.tell !== false && (await emailReady()) ? await emailSignup("declined", r.email, r.name) : false;
    await audit(req, u, "signup.decline", `Declined ${r.name} (${r.email})${told ? ", and told them" : ""}`);
    return res.status(200).json({ ok: true, told });
  },

  // ---------- projects ----------
  async projectCreate(req, res, u, b, s, deny) {
    if (deny("projects.create")) return;
    const title = text(b.title, 140);
    if (!title) return res.status(400).json({ error: "Give the project a name." });
    const clientId = await clientFrom(b);
    if (!clientId) return res.status(400).json({ error: "Choose a client, or type a new client’s name." });
    const source = b.source && b.source.conn ? { conn: String(b.source.conn), ref: String(b.source.ref || "").trim() } : null;
    const bad = await checkSource(source);
    if (bad) return res.status(400).json({ error: bad });
    const stage = Math.max(0, Math.min(s.stages.length - 1, Number(b.stage) || 0));
    const caps = { ...cleanCaps(s.caps), ...cleanCaps(b.caps) };
    const [p] = await sql`
      insert into projects (client_id, title, type, summary, stage_idx, source_conn, source_ref, capabilities)
      values (${clientId}, ${title}, ${text(b.type, 140) || null}, ${longText(b.summary, 600) || null}, ${stage},
              ${source ? source.conn : null}, ${source && source.conn !== LINKS_ID ? source.ref : null}, ${JSON.stringify(caps)}::jsonb)
      returning id`;
    await audit(req, u, "project.create", `Created project ${title}`, { projectId: p.id, clientId });
    await later(() => syncProject(p.id), "notion sync");
    // Its own link for the client, ready to share straight away.
    const token = await newJoinLink(p.id);
    return res.status(201).json({ id: p.id, link: joinUrl(originOf(req), token) });
  },

  async projectUpdate(req, res, u, b, s) {
    if (!isUuid(b.id)) return res.status(400).json({ error: "That project isn’t valid." });
    const cur = (await sql`select * from projects where id = ${b.id}`)[0];
    if (!cur) return res.status(404).json({ error: "That project was removed." });
    const editing = ["title", "type", "summary", "clientId", "clientName", "source", "caps", "imageUrl"].some((k) => b[k] !== undefined);
    const progress = ["stage", "pct", "next", "reviewDue"].some((k) => b[k] !== undefined);
    const need = [editing && "projects.edit", progress && "projects.progress", b.archived !== undefined && "projects.delete"].filter(Boolean);
    const missing = need.filter((perm) => !can(u, perm, s));
    if (missing.length) return res.status(403).json({ error: "Your role doesn’t allow " + missing.map((m) => STAFF_PERMS.find((x) => x.key === m).label.toLowerCase()).join(" or ") + "." });
    const title = b.title === undefined ? cur.title : text(b.title, 140);
    if (!title) return res.status(400).json({ error: "Give the project a name." });
    let srcConn = cur.source_conn, srcRef = cur.source_ref;
    if (b.source !== undefined) {
      const source = b.source && b.source.conn ? { conn: String(b.source.conn), ref: String(b.source.ref || "").trim() } : null;
      if (!source || source.conn !== cur.source_conn || source.ref !== (cur.source_ref || "")) {
        const bad = await checkSource(source);
        if (bad) return res.status(400).json({ error: bad });
      }
      srcConn = source ? source.conn : null;
      srcRef = source && source.conn !== LINKS_ID ? source.ref : null;
    }
    const stage = b.stage === undefined ? cur.stage_idx : Math.max(0, Math.min(s.stages.length - 1, Number(b.stage) || 0));
    const pct = b.pct === undefined ? cur.pct : Math.max(0, Math.min(100, Math.round(Number(b.pct) || 0)));
    const next = b.next || {};
    const nextChanged = ["label", "date", "what"].some((k) => next[k] !== undefined && (text(next[k], 200) || null) !== (cur["next_" + k] || null));
    const caps = b.caps === undefined ? cur.capabilities || {} : { ...(cur.capabilities || {}), ...cleanCaps(b.caps) };
    const clientId = b.clientId || b.clientName ? (await clientFrom(b)) || cur.client_id : cur.client_id;
    const img = b.imageUrl === undefined ? cur.image_url : httpsUrl(b.imageUrl);
    const due = b.reviewDue === undefined ? cur.review_due : cleanDate(b.reviewDue);
    await sql`
      update projects set
        title = ${title},
        type = ${b.type === undefined ? cur.type : text(b.type, 140) || null},
        summary = ${b.summary === undefined ? cur.summary : longText(b.summary, 600) || null},
        client_id = ${clientId},
        stage_idx = ${stage},
        pct = ${pct},
        next_label = ${next.label === undefined ? cur.next_label : text(next.label, 80) || null},
        next_date = ${next.date === undefined ? cur.next_date : text(next.date, 80) || null},
        next_what = ${next.what === undefined ? cur.next_what : text(next.what, 200) || null},
        next_confirm = ${next.confirm === undefined ? cur.next_confirm : !!next.confirm},
        next_confirmed_at = ${nextChanged || next.confirm === false ? null : cur.next_confirmed_at},
        next_confirmed_by = ${nextChanged || next.confirm === false ? null : cur.next_confirmed_by},
        review_due = ${due},
        reminded_at = ${b.reviewDue !== undefined && due !== (cur.review_due ? new Date(cur.review_due).toISOString().slice(0, 10) : null) ? null : cur.reminded_at},
        source_conn = ${srcConn},
        source_ref = ${srcRef},
        image_url = ${img},
        capabilities = ${JSON.stringify(caps)}::jsonb,
        archived = ${b.archived === undefined ? cur.archived : !!b.archived},
        updated_at = now()
      where id = ${cur.id}`;
    await forgetSource(cur);
    const changes = [];
    if (b.caps !== undefined && JSON.stringify(capsOf(caps)) !== JSON.stringify(capsOf(cur.capabilities))) {
      const before = capsOf(cur.capabilities), after = capsOf(caps);
      const on = CAPABILITIES.filter((c) => after[c.key] && !before[c.key]).map((c) => c.label);
      const off = CAPABILITIES.filter((c) => !after[c.key] && before[c.key]).map((c) => c.label);
      changes.push([on.length ? "switched on " + on.join(", ") : "", off.length ? "switched off " + off.join(", ") : ""].filter(Boolean).join("; "));
    }
    if (stage !== cur.stage_idx) changes.push(`stage to ${stageNames(s)[stage]}`);
    if (b.archived !== undefined && !!b.archived !== cur.archived) changes.push(b.archived ? "archived it" : "brought it back");
    if (srcConn !== cur.source_conn || srcRef !== cur.source_ref) changes.push("changed its video source");
    if (b.reviewDue !== undefined && due !== day(cur.review_due)) changes.push(due ? `review date ${due}` : "cleared the review date");
    await audit(req, u, "project.update", `Updated ${title}${changes.length ? ": " + changes.join("; ") : ""}`, { projectId: cur.id, clientId });
    await later(() => syncProject(cur.id), "notion sync");
    return res.status(200).json({ ok: true });
  },

  async projectDelete(req, res, u, b, s, deny) {
    if (deny("projects.delete")) return;
    if (!isUuid(b.id)) return res.status(400).json({ error: "That project isn’t valid." });
    const p = (await sql`select id, title, client_id, notion_page_id from projects where id = ${b.id}`)[0];
    if (!p) return res.status(404).json({ error: "That project was already removed." });
    if (String(b.confirm || "").trim() !== p.title) return res.status(400).json({ error: `Type “${p.title}” exactly to confirm.` });
    await deleteBlobs([p.id]);
    await sql`delete from projects where id = ${p.id}`;
    await audit(req, u, "project.delete", `Deleted project ${p.title}`, { clientId: p.client_id });
    await later(() => trashProjectRow(p.notion_page_id), "notion trash");
    return res.status(200).json({ ok: true });
  },

  /**
   * A project's link for the client: op "new" (replace it; the old one stops working), "off", "on", or "role"
   * (what people who join can do: access). People who already joined keep their access either way.
   */
  async joinLink(req, res, u, b, s, deny) {
    if (deny("people.manage")) return;
    const p = isUuid(b.projectId) && (await sql`select * from projects where id = ${b.projectId}`)[0];
    if (!p) return res.status(404).json({ error: "That project was removed." });
    let what;
    if (b.op === "new") { await newJoinLink(p.id); what = "Made a new link (the old one stopped working)"; }
    else if (b.op === "off") { await sql`update projects set join_off = true where id = ${p.id}`; what = "Switched the project link off"; }
    else if (b.op === "on") { await sql`update projects set join_off = false where id = ${p.id}`; what = "Switched the project link on"; }
    else if (b.op === "role" && CLIENT_ROLES.some((r) => r.key === b.access)) {
      await sql`update projects set join_access = ${b.access} where id = ${p.id}`;
      what = `People who join with the link are now ${roleLabel({ role: "client", access: b.access })}s`;
    } else return res.status(400).json({ error: "That change isn’t valid." });
    await audit(req, u, "project.link", `${what} for ${p.title}`, { projectId: p.id, clientId: p.client_id });
    const fresh = (await sql`select * from projects where id = ${p.id}`)[0];
    return res.status(200).json({ link: joinUrl(originOf(req), await joinToken(fresh)), off: !!fresh.join_off, access: joinRole(fresh) });
  },

  /** Takes someone off a project they joined (their login stays; they no longer see this project). */
  async projectPersonRemove(req, res, u, b, s, deny) {
    if (deny("people.manage")) return;
    if (!isUuid(b.projectId) || !isUuid(b.userId)) return res.status(400).json({ error: "That isn’t valid." });
    const r = (await sql`delete from project_people where project_id = ${b.projectId} and user_id = ${b.userId}
                          returning (select title from projects where id = ${b.projectId}) as title, (select name from users where id = ${b.userId}) as name`)[0];
    if (r) await audit(req, u, "project.person.remove", `Took ${r.name} off ${r.title}`, { projectId: b.projectId });
    return res.status(200).json({ ok: true });
  },

  /** Emails the client's decision makers that a version is waiting (and when it's due). */
  async projectRemind(req, res, u, b, s, deny) {
    if (deny("projects.progress")) return;
    const p = isUuid(b.id) && (await sql`select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id where p.id = ${b.id}`)[0];
    if (!p) return res.status(404).json({ error: "That project was removed." });
    if (!(await emailReady())) return res.status(409).json({ error: "Connect email first (Studio → Connections)." });
    const { remind } = await import("./_reminders.js");
    const sent = await remind(p, originOf(req), { manual: true });
    if (!sent) return res.status(409).json({ error: "Nobody to remind: no decision maker on this client has email updates on, or nothing is waiting for review." });
    await audit(req, u, "reminder", `Sent a review reminder for ${p.title} to ${sent} ${sent === 1 ? "person" : "people"}`, { projectId: p.id, clientId: p.client_id });
    return res.status(200).json({ sent });
  },

  // ---------- videos ----------
  /** Hide a video from the client, rename it, or say it's a finished film. */
  async videoSet(req, res, u, b, s, deny) {
    if (deny("projects.videos")) return;
    if (!isUuid(b.projectId) || !/^[\w-]{1,80}$/.test(String(b.videoId || ""))) return res.status(400).json({ error: "That video isn’t valid." });
    const p = (await sql`select * from projects where id = ${b.projectId}`)[0];
    if (!p) return res.status(404).json({ error: "That project was removed." });
    const cur = (await sql`select * from video_settings where project_id = ${p.id} and video_id = ${b.videoId}`)[0] || {};
    const hidden = b.hidden === undefined ? !!cur.hidden : !!b.hidden;
    const title = b.title === undefined ? cur.title || null : text(b.title, 200) || null;
    const kind = b.kind === undefined ? cur.kind || "auto" : b.kind === "film" ? "film" : "auto";
    await sql`insert into video_settings (project_id, video_id, hidden, title, kind) values (${p.id}, ${b.videoId}, ${hidden}, ${title}, ${kind})
              on conflict (project_id, video_id) do update set hidden = excluded.hidden, title = excluded.title, kind = excluded.kind`;
    await sql`update projects set updated_at = now() where id = ${p.id}`;
    const what = b.hidden !== undefined ? (hidden ? "Hid a video from the client" : "Showed a video to the client") : b.title !== undefined ? `Renamed a video to “${title || "its original name"}”` : kind === "film" ? "Marked a video as a finished film" : "Let a video’s name decide what it is";
    await audit(req, u, "video.set", `${what} on ${p.title}`, { projectId: p.id, clientId: p.client_id });
    return res.status(200).json({ ok: true });
  },

  /** Adds a video by link to a project whose source is "Video links" (or that has no source yet). */
  async linkAdd(req, res, u, b, s, deny) {
    if (deny("projects.videos")) return;
    const p = isUuid(b.projectId) && (await sql`select * from projects where id = ${b.projectId}`)[0];
    if (!p) return res.status(404).json({ error: "That project was removed." });
    if (p.source_conn && p.source_conn !== LINKS_ID) return res.status(409).json({ error: "This project’s videos come from a connected account. Switch its source to Video links first." });
    const parsed = parseLink(b.url);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const found = await lookup(String(b.url).trim(), parsed);
    const title = text(b.title, 200) || text(found.title, 200);
    if (!title) return res.status(400).json({ error: "Give the video a title (add “V2” for a second version)." });
    await sql`insert into link_videos (project_id, title, url, description, thumbnail, duration)
              values (${p.id}, ${title}, ${String(b.url).trim().slice(0, 1000)}, ${longText(b.description, 2000) || null}, ${found.thumbnail || null}, ${Number(found.duration) || null})`;
    await sql`update projects set source_conn = ${LINKS_ID}, source_ref = null, updated_at = now() where id = ${p.id}`;
    await audit(req, u, "video.add", `Added ${title} by link (${parsed.host}) to ${p.title}`, { projectId: p.id, clientId: p.client_id });
    const origin = originOf(req);
    await later(async () => {
      const proj = (await sql`select * from projects where id = ${p.id}`)[0];
      await notify({ audience: "client", project: proj, actor: u, origin, path: `/review/${p.id}`, button: "Watch it",
        subject: `New on ${p.title}: ${title}`, lines: [`${title} was added to ${p.title}.`], need: "review" });
      await syncProject(p.id);
    }, "after link");
    return res.status(201).json({ ok: true, host: parsed.host });
  },

  async linkRemove(req, res, u, b, s, deny) {
    if (deny("projects.videos")) return;
    if (!isUuid(b.id)) return res.status(400).json({ error: "That video isn’t valid." });
    const r = (await sql`delete from link_videos where id = ${b.id} returning project_id, title`)[0];
    if (r) await audit(req, u, "video.remove", `Removed ${r.title}`, { projectId: r.project_id });
    return res.status(200).json({ ok: true });
  },
};

async function ownerCount() {
  return (await sql`select count(*)::int as n from users where role = 'admin' and coalesce(access, 'owner') = 'owner'`)[0].n;
}

function httpsUrl(v) {
  const s = String(v || "").trim();
  return /^https:\/\/[^\s"'<>]{4,490}$/.test(s) ? s : null;
}
