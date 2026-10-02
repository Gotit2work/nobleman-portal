import bcrypt from "bcryptjs";
import { del } from "@vercel/blob";
import { sql, ready, dbConfigured } from "./_db.js";
import { TROUBLE, readBody, requireAdmin, isUuid, text, longText, tempPassword } from "./_auth.js";
import { CAPABILITIES, STAGES, capsOf, cleanCaps } from "./_caps.js";
import { vimeoConfigured, account, folders, folderVideos, forgetFolder } from "./_vimeo.js";
import { emailConfigured } from "./_notify.js";

/**
 * Studio: Nobleman staff only.
 *
 * GET  /api/admin              clients, people, projects (with capabilities), and connection status
 * GET  /api/admin?folders=1    the Vimeo account's folders, for linking a project
 * POST /api/admin {action}     clientCreate | clientRename | clientDelete
 *                              personCreate | personUpdate | personReset | personDelete
 *                              projectCreate | projectUpdate | projectDelete | vimeoRefresh
 *
 * New people and password resets get a temporary password, shown once to the admin; the person chooses
 * their own the first time they sign in. Deleting a client or project needs its exact name typed back.
 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const iso = (d) => (d ? new Date(d).toISOString() : null);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!dbConfigured()) return res.status(503).json({ error: "The portal isn’t connected to its database yet." });
  try { await ready(); } catch (err) { console.error("db not ready", err); return res.status(500).json({ error: TROUBLE }); }
  const u = await requireAdmin(req, res);
  if (!u) return;
  try {
    if (req.method === "GET") return (req.query && req.query.folders) ? await vimeoFolders(res) : await overview(res);
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const b = readBody(req, res);
    if (!b) return;
    const fn = ACTIONS[b.action];
    if (!fn) return res.status(400).json({ error: "Unknown action." });
    return await fn(req, res, u, b);
  } catch (err) {
    if (err && err.code === "23505") return res.status(409).json({ error: "Someone already uses that email address." });
    console.error("admin action failed", err);
    return res.status(500).json({ error: TROUBLE });
  }
}

async function overview(res) {
  const [clients, people, projects] = await Promise.all([
    sql`select c.id, c.name, c.created_at,
               (select count(*)::int from users x where x.client_id = c.id) as people,
               (select count(*)::int from projects x where x.client_id = c.id and not x.archived) as projects
        from clients c order by lower(c.name)`,
    sql`select u.id, u.name, u.email, u.title, u.role, u.client_id, u.last_login_at, u.must_change_password, u.created_at,
               c.name as client_name
        from users u left join clients c on c.id = u.client_id order by u.role, lower(u.name)`,
    sql`select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id
        order by p.archived, p.updated_at desc`,
  ]);
  let vimeo = { configured: vimeoConfigured() };
  if (vimeo.configured) {
    try {
      const a = await account();
      vimeo = { configured: true, name: a.name, link: a.link, plan: a.plan, scopes: a.scopes, upload: a.upload };
    } catch (err) {
      vimeo = { configured: true, error: err.status === 401 ? "Vimeo refused the token. It may have been revoked; create a new one (README, “Connecting Vimeo”)." : "Vimeo isn’t answering right now." };
    }
  }
  return res.status(200).json({
    clients: clients.map((c) => ({ id: c.id, name: c.name, people: c.people, projects: c.projects, created: iso(c.created_at) })),
    people: people.map((p) => ({
      id: p.id, name: p.name, email: p.email, title: p.title || "", role: p.role, clientId: p.client_id,
      clientName: p.client_name || null, lastLogin: iso(p.last_login_at), mustChangePassword: p.must_change_password, created: iso(p.created_at),
    })),
    projects: projects.map((p) => ({
      id: p.id, title: p.title, type: p.type || "", summary: p.summary || "", clientId: p.client_id, clientName: p.client_name,
      stage: p.stage_idx, pct: p.pct, next: { label: p.next_label || "", date: p.next_date || "", what: p.next_what || "" },
      folder: p.vimeo_folder_id || "", imageUrl: p.image_url || "", caps: capsOf(p.capabilities), archived: p.archived, updated: iso(p.updated_at),
    })),
    capabilities: CAPABILITIES,
    stages: STAGES,
    vimeo,
    blob: !!process.env.BLOB_READ_WRITE_TOKEN,
    email: emailConfigured(),
  });
}

async function vimeoFolders(res) {
  if (!vimeoConfigured()) return res.status(200).json({ folders: [] });
  try {
    return res.status(200).json({ folders: await folders() });
  } catch (err) {
    console.error("vimeo folders failed", err.message);
    return res.status(502).json({ error: "Couldn’t list Vimeo folders right now." });
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

async function checkFolder(folder) {
  if (!folder) return null;
  if (!/^\d+$/.test(folder)) return "A Vimeo folder number is digits only: the number at the end of the folder’s web address.";
  if (!vimeoConfigured()) return null;
  try { await folderVideos(folder, { fresh: true }); return null; } catch (err) {
    return err.status === 404 ? "Vimeo has no folder with that number in this account." : null;
  }
}

/** Removes the stored files behind some projects (their rows go with the projects themselves). */
async function deleteBlobs(projectIds) {
  if (!projectIds.length || !process.env.BLOB_READ_WRITE_TOKEN) return;
  const rows = await sql`select pathname from files where project_id = any(${projectIds})`;
  if (rows.length) await del(rows.map((r) => r.pathname)).catch((err) => console.error("blob cleanup failed", err.message));
}

const ACTIONS = {
  async clientCreate(req, res, u, b) {
    const name = text(b.name, 120);
    if (!name) return res.status(400).json({ error: "Enter the client’s name." });
    const [c] = await sql`insert into clients (name) values (${name}) returning id`;
    return res.status(201).json({ id: c.id });
  },

  async clientRename(req, res, u, b) {
    const name = text(b.name, 120);
    if (!isUuid(b.id) || !name) return res.status(400).json({ error: "Enter the client’s name." });
    await sql`update clients set name = ${name} where id = ${b.id}`;
    return res.status(200).json({ ok: true });
  },

  async clientDelete(req, res, u, b) {
    if (!isUuid(b.id)) return res.status(400).json({ error: "That client isn’t valid." });
    const c = (await sql`select id, name from clients where id = ${b.id}`)[0];
    if (!c) return res.status(404).json({ error: "That client was already removed." });
    if (String(b.confirm || "").trim() !== c.name) return res.status(400).json({ error: `Type “${c.name}” exactly to confirm.` });
    const ps = await sql`select id from projects where client_id = ${c.id}`;
    await deleteBlobs(ps.map((p) => p.id));
    await sql`delete from clients where id = ${c.id}`;
    return res.status(200).json({ ok: true });
  },

  async personCreate(req, res, u, b) {
    const name = text(b.name, 100);
    const email = String(b.email || "").trim().toLowerCase().slice(0, 320);
    const role = b.role === "admin" ? "admin" : "client";
    if (!name || !EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a name and a valid email." });
    const clientId = role === "client" ? await clientFrom(b) : null;
    if (role === "client" && !clientId) return res.status(400).json({ error: "Choose which client this person belongs to." });
    const pass = tempPassword();
    const hash = await bcrypt.hash(pass, 10);
    const [p] = await sql`
      insert into users (email, name, title, role, client_id, password_hash, must_change_password)
      values (${email}, ${name}, ${text(b.title, 100) || null}, ${role}, ${clientId}, ${hash}, true) returning id`;
    return res.status(201).json({ id: p.id, tempPassword: pass });
  },

  async personUpdate(req, res, u, b) {
    if (!isUuid(b.id)) return res.status(400).json({ error: "That person isn’t valid." });
    const cur = (await sql`select * from users where id = ${b.id}`)[0];
    if (!cur) return res.status(404).json({ error: "That person was removed." });
    const name = text(b.name, 100) || cur.name;
    const title = b.title === undefined ? cur.title : text(b.title, 100) || null;
    const role = b.role === "admin" || b.role === "client" ? b.role : cur.role;
    if (cur.id === u.id && role !== cur.role) return res.status(400).json({ error: "You can’t change your own role. Ask another admin." });
    const clientId = role === "client" ? (await clientFrom(b)) || cur.client_id : null;
    if (role === "client" && !clientId) return res.status(400).json({ error: "Choose which client this person belongs to." });
    // Changing role or client changes what they can see, so their sessions restart.
    const bump = role !== cur.role || clientId !== cur.client_id;
    await sql`update users set name = ${name}, title = ${title}, role = ${role}, client_id = ${clientId},
              session_version = session_version + ${bump ? 1 : 0} where id = ${cur.id}`;
    return res.status(200).json({ ok: true });
  },

  async personReset(req, res, u, b) {
    if (!isUuid(b.id)) return res.status(400).json({ error: "That person isn’t valid." });
    if (b.id === u.id) return res.status(400).json({ error: "Change your own password under your account instead." });
    const pass = tempPassword();
    const hash = await bcrypt.hash(pass, 10);
    const rows = await sql`update users set password_hash = ${hash}, must_change_password = true,
                           session_version = session_version + 1 where id = ${b.id} returning id`;
    if (!rows.length) return res.status(404).json({ error: "That person was removed." });
    await sql`delete from login_attempts where email = (select email from users where id = ${b.id})`;
    return res.status(200).json({ tempPassword: pass });
  },

  async personDelete(req, res, u, b) {
    if (!isUuid(b.id)) return res.status(400).json({ error: "That person isn’t valid." });
    if (b.id === u.id) return res.status(400).json({ error: "You can’t remove yourself. Ask another admin." });
    await sql`delete from users where id = ${b.id}`;
    return res.status(200).json({ ok: true });
  },

  async projectCreate(req, res, u, b) {
    const title = text(b.title, 140);
    if (!title) return res.status(400).json({ error: "Give the project a name." });
    const clientId = await clientFrom(b);
    if (!clientId) return res.status(400).json({ error: "Choose a client, or type a new client’s name." });
    const folder = String(b.folder || "").trim();
    const bad = await checkFolder(folder);
    if (bad) return res.status(400).json({ error: bad });
    const stage = Math.max(0, Math.min(STAGES.length - 1, Number(b.stage) || 0));
    const caps = cleanCaps(b.caps);
    const [p] = await sql`
      insert into projects (client_id, title, type, summary, stage_idx, vimeo_folder_id, capabilities)
      values (${clientId}, ${title}, ${text(b.type, 140) || null}, ${longText(b.summary, 600) || null}, ${stage},
              ${folder || null}, ${JSON.stringify(caps)}::jsonb)
      returning id`;
    return res.status(201).json({ id: p.id });
  },

  async projectUpdate(req, res, u, b) {
    if (!isUuid(b.id)) return res.status(400).json({ error: "That project isn’t valid." });
    const cur = (await sql`select * from projects where id = ${b.id}`)[0];
    if (!cur) return res.status(404).json({ error: "That project was removed." });
    const title = b.title === undefined ? cur.title : text(b.title, 140);
    if (!title) return res.status(400).json({ error: "Give the project a name." });
    const folder = b.folder === undefined ? cur.vimeo_folder_id || "" : String(b.folder || "").trim();
    if (folder !== (cur.vimeo_folder_id || "")) {
      const bad = await checkFolder(folder);
      if (bad) return res.status(400).json({ error: bad });
    }
    const stage = b.stage === undefined ? cur.stage_idx : Math.max(0, Math.min(STAGES.length - 1, Number(b.stage) || 0));
    const pct = b.pct === undefined ? cur.pct : Math.max(0, Math.min(100, Math.round(Number(b.pct) || 0)));
    const next = b.next || {};
    const caps = b.caps === undefined ? cur.capabilities || {} : { ...(cur.capabilities || {}), ...cleanCaps(b.caps) };
    const clientId = b.clientId || b.clientName ? (await clientFrom(b)) || cur.client_id : cur.client_id;
    const img = b.imageUrl === undefined ? cur.image_url : (/^https:\/\//.test(String(b.imageUrl)) ? text(b.imageUrl, 500) : null);
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
        vimeo_folder_id = ${folder || null},
        image_url = ${img},
        capabilities = ${JSON.stringify(caps)}::jsonb,
        archived = ${b.archived === undefined ? cur.archived : !!b.archived},
        updated_at = now()
      where id = ${cur.id}`;
    if (cur.vimeo_folder_id) forgetFolder(cur.vimeo_folder_id);
    return res.status(200).json({ ok: true });
  },

  async projectDelete(req, res, u, b) {
    if (!isUuid(b.id)) return res.status(400).json({ error: "That project isn’t valid." });
    const p = (await sql`select id, title from projects where id = ${b.id}`)[0];
    if (!p) return res.status(404).json({ error: "That project was already removed." });
    if (String(b.confirm || "").trim() !== p.title) return res.status(400).json({ error: `Type “${p.title}” exactly to confirm.` });
    await deleteBlobs([p.id]);
    await sql`delete from projects where id = ${p.id}`;
    return res.status(200).json({ ok: true });
  },

  async vimeoRefresh(req, res) {
    const rows = await sql`select vimeo_folder_id from projects where vimeo_folder_id is not null`;
    for (const r of rows) forgetFolder(r.vimeo_folder_id);
    if (vimeoConfigured()) await account({ fresh: true }).catch(() => {});
    return res.status(200).json({ ok: true });
  },
};
