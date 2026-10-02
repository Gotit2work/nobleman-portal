import { randomUUID } from "node:crypto";
import { head, del, issueSignedToken, presignUrl } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { sql, ready, dbConfigured } from "./_db.js";
import { TROUBLE, readBody, requireUser, projectFor, isUuid, text } from "./_auth.js";
import { notify, originOf } from "./_notify.js";

/**
 * Documents (from Nobleman) and uploads (from the client), kept in a *private* Vercel Blob store. Nothing in it
 * has a public URL: the browser gets a short-lived signed link after the portal checks who is asking.
 *
 * POST /api/files {action:"start"}   projectId, name, size, contentType → an upload token for one pathname
 *      (the browser sends the file straight to Blob, so large files never pass through the portal's servers)
 * POST /api/files {action:"done"}    fileId: confirms the upload landed and lists it
 * POST /api/files {action:"cancel"}  fileId
 * POST /api/files {action:"delete"}  id: your own upload, or anything if you're staff
 * GET  /api/files?id=<file id>       { url, name }: a download link that works for ten minutes
 *
 * Needs BLOB_READ_WRITE_TOKEN, which Vercel sets when a Blob store is connected to the project.
 */
const MAX_FILE = 500 * 1024 ** 2; // 500 MB. Bigger video goes to Vimeo instead (api/media.js).
const LINK_MINUTES = 10;

const blobConfigured = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const safeName = (n) => n.replace(/[^\w.\-() ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!dbConfigured()) return res.status(503).json({ error: "The portal isn’t connected to its database yet." });
  try { await ready(); } catch (err) { console.error("db not ready", err); return res.status(500).json({ error: TROUBLE }); }
  const u = await requireUser(req, res);
  if (!u) return;
  if (!blobConfigured()) return res.status(503).json({ error: "File storage isn’t connected yet. Ask Nobleman." });
  try {
    if (req.method === "GET") return await link(req, res, u);
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const b = readBody(req, res);
    if (!b) return;
    switch (b.action) {
      case "start": return await start(req, res, u, b);
      case "done": return await done(req, res, u, b);
      case "cancel": return await cancel(req, res, u, b);
      case "delete": return await remove(req, res, u, b);
      default: return res.status(400).json({ error: "Unknown action." });
    }
  } catch (err) {
    console.error("files failed", err);
    return res.status(500).json({ error: TROUBLE });
  }
}

/** May this person see this file? Documents need "Files from Nobleman"; uploads need "Uploads" (staff: always). */
function canSee(p, f) {
  return f.kind === "document" ? p.caps.files : p.caps.upload;
}

async function start(req, res, u, b) {
  const p = await projectFor(u, b.projectId);
  if (!p) return res.status(404).json({ error: "That project isn’t available to you." });
  if (!p.caps.upload) return res.status(403).json({ error: "Uploads aren’t switched on for this project. Ask Nobleman if you need to send something." });
  const name = text(b.name, 200);
  const size = Number(b.size) || 0;
  if (!name || size <= 0) return res.status(400).json({ error: "That file is empty." });
  if (size > MAX_FILE) return res.status(413).json({ error: "Files here can be up to 500 MB. Send videos as videos (they go to Vimeo), or ask Nobleman for another way." });
  const kind = u.role === "admin" ? "document" : "upload";
  const pathname = `projects/${p.id}/${randomUUID()}/${safeName(name)}`;
  const [row] = await sql`
    insert into files (project_id, name, size, content_type, pathname, kind, status, uploaded_by, uploader_name, uploader_role)
    values (${p.id}, ${name}, ${size}, ${text(b.contentType, 100) || null}, ${pathname}, ${kind}, 'pending', ${u.id}, ${u.name}, ${u.role})
    returning id`;
  const token = await generateClientTokenFromReadWriteToken({
    pathname,
    maximumSizeInBytes: MAX_FILE,
    validUntil: Date.now() + 60 * 60 * 1000,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return res.status(201).json({ fileId: row.id, pathname, token, multipart: size > 50 * 1024 ** 2 });
}

async function pendingRow(u, id) {
  if (!isUuid(id)) return null;
  const r = (await sql`select * from files where id = ${id}`)[0];
  return r && r.uploaded_by === u.id ? r : null;
}

async function done(req, res, u, b) {
  const r = await pendingRow(u, b.fileId);
  if (!r) return res.status(404).json({ error: "That upload wasn’t found. Try sending the file again." });
  const p = await projectFor(u, r.project_id);
  if (!p) return res.status(404).json({ error: "That project isn’t available to you." });
  let meta;
  try { meta = await head(r.pathname); } catch { meta = null; }
  if (!meta) return res.status(409).json({ error: "The file didn’t finish uploading. Try sending it again." });
  await sql`update files set status = 'ready', size = ${meta.size || r.size}, content_type = ${meta.contentType || r.content_type}
            where id = ${r.id}`;
  await sql`update projects set updated_at = now() where id = ${p.id}`;
  await notify({
    audience: u.role === "client" ? "staff" : "client", project: p, actor: u, origin: originOf(req),
    subject: u.role === "client" ? `${u.name} sent a file for ${p.title}` : `New file on ${p.title}: ${r.name}`,
    lines: [u.role === "client" ? `${u.name} (${p.client_name}) sent “${r.name}”.` : `Nobleman added “${r.name}” to ${p.title}.`],
  });
  return res.status(200).json({ ok: true });
}

async function cancel(req, res, u, b) {
  const r = await pendingRow(u, b.fileId);
  if (!r) return res.status(200).json({ ok: true });
  await del(r.pathname).catch(() => {});
  await sql`delete from files where id = ${r.id}`;
  return res.status(200).json({ ok: true });
}

async function remove(req, res, u, b) {
  if (!isUuid(b.id)) return res.status(400).json({ error: "That file isn’t valid." });
  const r = (await sql`select * from files where id = ${b.id}`)[0];
  const p = r && (await projectFor(u, r.project_id));
  if (!r || !p || !canSee(p, r)) return res.status(404).json({ error: "That file was already removed." });
  if (r.uploaded_by !== u.id && u.role !== "admin") return res.status(403).json({ error: "You can only remove files you sent." });
  await del(r.pathname).catch((err) => console.error("blob delete failed", r.pathname, err.message));
  await sql`delete from files where id = ${r.id}`;
  return res.status(200).json({ ok: true });
}

async function link(req, res, u) {
  const id = String((req.query && req.query.id) || "");
  if (!isUuid(id)) return res.status(400).json({ error: "That file isn’t valid." });
  const r = (await sql`select * from files where id = ${id} and status = 'ready'`)[0];
  const p = r && (await projectFor(u, r.project_id));
  if (!r || !p || !canSee(p, r)) return res.status(404).json({ error: "That file isn’t available to you." });
  const validUntil = Date.now() + LINK_MINUTES * 60 * 1000;
  const signed = await issueSignedToken({ pathname: r.pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(signed, { operation: "get", pathname: r.pathname, access: "private", validUntil });
  return res.status(200).json({ url: presignedUrl, name: r.name });
}
