import { sql, ready, dbConfigured } from "./_db.js";
import { TROUBLE, readBody, requireUser, projectFor, isUuid, longText } from "./_auth.js";
import { buildPortal } from "./_build.js";
import { demoPortal } from "./_demo.js";
import { vimeoConfigured, folderVideos } from "./_vimeo.js";
import { notify, originOf } from "./_notify.js";

/**
 * GET  /api/portal                      everything the signed-in person can see (see _build.js)
 * GET  /api/portal?demo=1               the public sample portal (no sign-in, nothing saved)
 * GET  /api/portal?thread=<project>     a project's messages; marks them read
 * GET  /api/portal?notes=<project>&video=<vimeo id>   review notes on one version
 * POST /api/portal {action}             note | resolve | deleteNote | decide | message
 *
 * Every action re-checks that the person may see the project and that the project allows it (_caps.js).
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const q = req.query || {};
  if (req.method === "GET" && q.demo) return res.status(200).json(demoPortal());
  if (!dbConfigured()) return res.status(503).json({ error: "The portal isn’t connected to its database yet." });
  try { await ready(); } catch (err) { console.error("db not ready", err); return res.status(500).json({ error: TROUBLE }); }

  const u = await requireUser(req, res);
  if (!u) return;
  try {
    if (req.method === "GET") {
      if (q.thread) return await thread(req, res, u, String(q.thread));
      if (q.notes) return await notes(req, res, u, String(q.notes), String(q.video || ""));
      return res.status(200).json(await buildPortal(u));
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const b = readBody(req, res);
    if (!b) return;
    switch (b.action) {
      case "note": return await addNote(req, res, u, b);
      case "resolve": return await resolve(req, res, u, b);
      case "deleteNote": return await deleteNote(req, res, u, b);
      case "decide": return await decide(req, res, u, b);
      case "message": return await message(req, res, u, b);
      default: return res.status(400).json({ error: "Unknown action." });
    }
  } catch (err) {
    console.error("portal action failed", err);
    return res.status(500).json({ error: TROUBLE });
  }
}

const NOT_FOUND = { error: "That project isn’t available to you." };
const OFF = (what) => ({ error: `${what} isn’t switched on for this project. Ask Nobleman if you need it.` });

/** The video must be one of this project's own Vimeo videos, so ids can't be used to reach anything else. */
async function videoOf(p, videoId) {
  if (!/^\d+$/.test(videoId) || !vimeoConfigured() || !p.vimeo_folder_id) return null;
  return (await folderVideos(p.vimeo_folder_id)).find((v) => v.id === videoId) || null;
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

async function thread(req, res, u, pid) {
  const p = await projectFor(u, pid);
  if (!p) return res.status(404).json(NOT_FOUND);
  if (!p.caps.messages) return res.status(403).json(OFF("Messages"));
  const rows = await sql`
    select id, author_name, author_role, author_id, body, created_at from messages
    where project_id = ${p.id} order by created_at asc limit 300`;
  await sql`insert into message_reads (user_id, project_id, seen_at) values (${u.id}, ${p.id}, now())
            on conflict (user_id, project_id) do update set seen_at = now()`;
  return res.status(200).json({
    messages: rows.map((m) => ({ id: m.id, author: m.author_name, role: m.author_role, mine: m.author_id === u.id, body: m.body, at: iso(m.created_at) })),
  });
}

async function notes(req, res, u, pid, videoId) {
  const p = await projectFor(u, pid);
  if (!p) return res.status(404).json(NOT_FOUND);
  if (!p.caps.review) return res.status(403).json(OFF("Review"));
  if (!/^\d+$/.test(videoId)) return res.status(400).json({ error: "That video isn’t valid." });
  const rows = await sql`
    select id, parent_id, at_seconds, body, author_id, author_name, author_role, resolved, created_at from comments
    where project_id = ${p.id} and video_id = ${videoId} order by created_at asc limit 500`;
  const top = rows.filter((r) => !r.parent_id).map((r) => ({
    id: r.id, at: r.at_seconds == null ? null : Number(r.at_seconds), body: r.body, author: r.author_name,
    role: r.author_role, mine: r.author_id === u.id, resolved: r.resolved, when: iso(r.created_at), replies: [],
  }));
  const byId = new Map(top.map((t) => [t.id, t]));
  for (const r of rows.filter((x) => x.parent_id)) {
    const t = byId.get(r.parent_id);
    if (t) t.replies.push({ id: r.id, body: r.body, author: r.author_name, role: r.author_role, mine: r.author_id === u.id, when: iso(r.created_at) });
  }
  top.sort((a, b) => (a.at ?? 1e9) - (b.at ?? 1e9));
  return res.status(200).json({ notes: top });
}

async function addNote(req, res, u, b) {
  // A reply belongs to its note's project, whatever the request says.
  let projectId = b.projectId;
  if (b.parentId && isUuid(b.parentId)) {
    const pr = (await sql`select project_id from comments where id = ${b.parentId}`)[0];
    if (pr) projectId = pr.project_id;
  }
  const p = await projectFor(u, projectId);
  if (!p) return res.status(404).json(NOT_FOUND);
  if (!p.caps.review) return res.status(403).json(OFF("Review"));
  const body = longText(b.body, 4000);
  if (!body) return res.status(400).json({ error: "Write your note first." });
  const videoId = String(b.videoId || "");
  let parent = null;
  if (b.parentId) {
    if (!isUuid(b.parentId)) return res.status(400).json({ error: "That note isn’t valid." });
    parent = (await sql`select id, video_id, version, at_seconds from comments
                        where id = ${b.parentId} and project_id = ${p.id} and parent_id is null`)[0];
    if (!parent) return res.status(404).json({ error: "That note was removed." });
  }
  const video = parent ? { id: parent.video_id, version: parent.version } : await videoOf(p, videoId);
  if (!video) return res.status(400).json({ error: "That version isn’t in this project." });
  const at = parent ? null : Math.max(0, Math.min(86400, Number(b.at) || 0));
  const [row] = await sql`
    insert into comments (project_id, video_id, version, at_seconds, body, parent_id, author_id, author_name, author_role)
    values (${p.id}, ${video.id}, ${video.version ?? null}, ${at}, ${body}, ${parent ? parent.id : null}, ${u.id}, ${u.name}, ${u.role})
    returning id, created_at`;
  await sql`update projects set updated_at = now() where id = ${p.id}`;
  if (u.role === "client") {
    await notify({ audience: "staff", project: p, actor: u, origin: originOf(req),
      subject: `${u.name} left a note on ${p.title}`, lines: [`${u.name} (${p.client_name}) wrote:`, body] });
  }
  return res.status(201).json({ id: row.id, when: iso(row.created_at) });
}

async function noteRow(u, id) {
  if (!isUuid(id)) return null;
  const r = (await sql`select id, project_id, author_id, parent_id from comments where id = ${id}`)[0];
  if (!r) return null;
  const p = await projectFor(u, r.project_id);
  return p ? { r, p } : null;
}

async function resolve(req, res, u, b) {
  const x = await noteRow(u, b.id);
  if (!x || x.r.parent_id) return res.status(404).json({ error: "That note was removed." });
  if (!x.p.caps.review) return res.status(403).json(OFF("Review"));
  await sql`update comments set resolved = ${!!b.resolved} where id = ${x.r.id}`;
  return res.status(200).json({ ok: true });
}

async function deleteNote(req, res, u, b) {
  const x = await noteRow(u, b.id);
  if (!x) return res.status(404).json({ error: "That note was already removed." });
  if (x.r.author_id !== u.id && u.role !== "admin") return res.status(403).json({ error: "You can only remove your own notes." });
  await sql`delete from comments where id = ${x.r.id}`;
  return res.status(200).json({ ok: true });
}

async function decide(req, res, u, b) {
  const p = await projectFor(u, b.projectId);
  if (!p) return res.status(404).json(NOT_FOUND);
  if (u.role !== "client") return res.status(403).json({ error: "Approvals come from the client. Staff can see them, not make them." });
  if (!p.caps.approve) return res.status(403).json(OFF("Approving versions"));
  const decision = b.decision === "approved" ? "approved" : b.decision === "changes" ? "changes" : null;
  if (!decision) return res.status(400).json({ error: "Choose approve or ask for changes." });
  const note = longText(b.note, 4000) || null;
  if (decision === "changes" && !note) return res.status(400).json({ error: "Say what you’d like changed." });
  const video = await videoOf(p, String(b.videoId || ""));
  if (!video || video.version == null) return res.status(400).json({ error: "That version isn’t in this project." });
  const [row] = await sql`
    insert into approvals (project_id, video_id, version, decision, note, user_id, user_name)
    values (${p.id}, ${video.id}, ${video.version}, ${decision}, ${note}, ${u.id}, ${u.name})
    returning created_at`;
  await sql`update projects set updated_at = now() where id = ${p.id}`;
  await notify({ audience: "staff", project: p, actor: u, origin: originOf(req),
    subject: decision === "approved" ? `${u.name} approved ${video.title}` : `${u.name} asked for changes to ${video.title}`,
    lines: decision === "approved"
      ? [`${u.name} (${p.client_name}) approved ${video.title}.`]
      : [`${u.name} (${p.client_name}) asked for changes to ${video.title}:`, note] });
  return res.status(201).json({ decision: { decision, note: note || "", by: u.name, at: iso(row.created_at) } });
}

async function message(req, res, u, b) {
  const p = await projectFor(u, b.projectId);
  if (!p) return res.status(404).json(NOT_FOUND);
  if (!p.caps.messages) return res.status(403).json(OFF("Messages"));
  const body = longText(b.body, 5000);
  if (!body) return res.status(400).json({ error: "Write your message first." });
  const [row] = await sql`
    with m as (
      insert into messages (project_id, author_id, author_name, author_role, body)
      values (${p.id}, ${u.id}, ${u.name}, ${u.role}, ${body}) returning id, created_at
    ), r as (
      insert into message_reads (user_id, project_id, seen_at) values (${u.id}, ${p.id}, now())
      on conflict (user_id, project_id) do update set seen_at = now()
    )
    select id, created_at from m`;
  await sql`update projects set updated_at = now() where id = ${p.id}`;
  await notify({
    audience: u.role === "client" ? "staff" : "client", project: p, actor: u, origin: originOf(req),
    subject: `New message on ${p.title}`, lines: [`${u.name}${u.role === "client" ? ` (${p.client_name})` : ", Nobleman Productions"} wrote:`, body],
  });
  return res.status(201).json({ message: { id: row.id, author: u.name, role: u.role, mine: true, body, at: iso(row.created_at) } });
}

