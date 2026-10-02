import { sql, ready, dbConfigured } from "./_db.js";
import { TROUBLE, readBody, requireUser, projectFor, isUuid, text } from "./_auth.js";
import { sourceOf, findVideo, forgetSource } from "./_sources.js";
import { notify, originOf } from "./_notify.js";
import { audit } from "./_audit.js";
import { getSettings } from "./_settings.js";
import { isStaff, can } from "./_roles.js";
import { later } from "./_later.js";
import { syncProject } from "./_notion.js";

/**
 * GET  /api/media?project=<id>&video=<id>          downloads, captions, and chapters for one film or version,
 *                                                  as far as the project and the person's role allow
 * GET  /api/media?project=<id>&video=<id>&play=1   a fresh address to play a video whose source signs them
 *                                                  (Frame.io); they expire, so they're fetched at play time
 * POST /api/media {action:"uploadStart"}           projectId, name, size, type: an upload link for one video,
 *                                                  where the project's source takes uploads (Vimeo)
 * POST /api/media {action:"uploadDone"}            uploadId
 * POST /api/media {action:"uploadCancel"}          uploadId
 */
const MAX_VIDEO = 50 * 1024 ** 3; // 50 GB

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!dbConfigured()) return res.status(503).json({ error: "The portal isn’t connected to its database yet." });
  try { await ready(); } catch (err) { console.error("db not ready", err); return res.status(500).json({ error: TROUBLE }); }
  const u = await requireUser(req, res);
  if (!u) return;
  try {
    if (req.method === "GET") return (req.query && req.query.play) ? await play(req, res, u) : await details(req, res, u);
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const b = readBody(req, res);
    if (!b) return;
    if (b.action === "uploadStart") return await uploadStart(req, res, u, b);
    if (b.action === "uploadDone") return await uploadEnd(req, res, u, b, true);
    if (b.action === "uploadCancel") return await uploadEnd(req, res, u, b, false);
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    console.error("media failed", err.message);
    if (err.status === 401 || err.status === 403) return res.status(502).json({ error: isStaff(u) ? `The video source refused the portal’s access: ${err.message}` : "The video host refused the request. Ask the studio to check the connection." });
    return res.status(502).json({ error: isStaff(u) ? `The video source isn’t answering: ${err.message}` : "The video host isn’t answering right now. Try again in a minute." });
  }
}

async function load(req, res, u) {
  const q = req.query || {};
  const p = await projectFor(u, String(q.project || ""));
  if (!p) { res.status(404).json({ error: "That project isn’t available to you." }); return null; }
  const v = await findVideo(p, String(q.video || ""), { staff: isStaff(u) });
  if (!v) { res.status(404).json({ error: "That film isn’t in this project." }); return null; }
  if (v.version != null && !p.caps.review) { res.status(403).json({ error: "Review isn’t switched on for this project." }); return null; }
  const src = await sourceOf(p);
  return { p, v, src };
}

async function play(req, res, u) {
  const x = await load(req, res, u);
  if (!x) return;
  const pb = x.v.playback || {};
  if (pb.url) return res.status(200).json({ url: pb.url });
  if (!x.src || !x.src.provider.play) return res.status(409).json({ error: "This video plays in its own player." });
  return res.status(200).json(await x.src.provider.play(x.src.conn, x.v));
}

async function details(req, res, u) {
  const x = await load(req, res, u);
  if (!x) return;
  const { p, v, src } = x;
  const staff = isStaff(u);
  const out = { downloads: null, captions: null, chapters: null };
  if (!src) return res.status(200).json(out);
  const features = src.provider.meta.features || {};
  // Downloads are for finished films. Versions under review are previews, not deliverables.
  const wantDownloads = p.caps.download && v.version == null;
  const d = await src.provider.details(src.conn, v, { downloads: wantDownloads && features.downloads, captions: p.caps.captions && (features.captions || features.chapters) });
  if (wantDownloads) {
    const dl = d.downloads || { links: [], onSite: null, why: `${src.provider.meta.name} doesn’t offer downloads through the portal.` };
    const links = (dl.links || []).filter((l) => !l.source || p.caps.download_source).map(({ link, label, sizeLabel, size, source, width, height }) => ({ link, label, sizeLabel, size, source, width, height }));
    out.downloads = {
      links,
      onSite: !links.length && dl.onSite ? dl.onSite : null,
      siteName: dl.siteName || src.provider.meta.name,
      reason: links.length || dl.onSite ? null : staff ? dl.why || "No downloads are available." : "Downloads for this film aren’t ready yet. Ask the studio and they’ll send it.",
    };
  }
  if (p.caps.captions) {
    out.captions = d.captions || [];
    out.chapters = d.chapters || [];
  }
  return res.status(200).json(out);
}

async function uploadStart(req, res, u, b) {
  const p = await projectFor(u, b.projectId);
  if (!p) return res.status(404).json({ error: "That project isn’t available to you." });
  const s = await getSettings();
  if (isStaff(u) ? !can(u, "projects.videos", s) : !p.caps.upload) return res.status(403).json({ error: isStaff(u) ? "Your role doesn’t allow adding videos." : "Uploads aren’t switched on for you on this project. Ask the studio if you need to send something." });
  const src = await sourceOf(p);
  if (!src || !src.provider.createUpload) return res.status(409).json({ error: "This project’s videos don’t come from a folder the portal can upload to. Send the video under Files instead, or add it at the source." });
  const name = text(b.name, 200);
  const size = Number(b.size) || 0;
  if (!name || size <= 0) return res.status(400).json({ error: "That file is empty." });
  if (size > MAX_VIDEO) return res.status(413).json({ error: "That file is larger than 50 GB. Ask the studio for another way to send it." });
  if (!/^video\//.test(String(b.type || ""))) return res.status(400).json({ error: "Only video files go to the video folder. Other files go to Files." });
  const room = src.provider.roomLeft ? await src.provider.roomLeft(src.conn) : null;
  if (room != null && size > room) return res.status(507).json({ error: "The studio’s video account doesn’t have room for this file right now. Ask the studio, or send it another way." });
  const prefix = isStaff(u) ? "" : `From ${p.client_name}: `;
  const up = await src.provider.createUpload(src.conn, src.ref, { name: prefix + name, size, description: `Sent through the client portal by ${u.name}.`, fromClient: !isStaff(u) });
  if (!up.uploadLink || up.approach !== "tus") return res.status(502).json({ error: "The video host didn’t accept the upload. Try again in a minute." });
  const [row] = await sql`
    insert into video_uploads (project_id, vimeo_id, name, size, uploaded_by, uploader_name, uploader_role)
    values (${p.id}, ${up.id}, ${name}, ${size}, ${u.id}, ${u.name}, ${u.role}) returning id`;
  return res.status(201).json({ uploadId: row.id, uploadLink: up.uploadLink, vimeoId: up.id });
}

async function uploadEnd(req, res, u, b, done) {
  if (!isUuid(b.uploadId)) return res.status(400).json({ error: "That upload isn’t valid." });
  const row = (await sql`select * from video_uploads where id = ${b.uploadId}`)[0];
  if (!row) return res.status(404).json({ error: "That upload was removed." });
  const p = await projectFor(u, row.project_id);
  if (!p || (row.uploaded_by !== u.id && !isStaff(u))) return res.status(404).json({ error: "That upload isn’t yours." });
  if (!done) {
    // The empty video stays at the source marked as an unfinished upload; staff can delete it there.
    await sql`delete from video_uploads where id = ${row.id}`;
    return res.status(200).json({ ok: true });
  }
  await sql`update video_uploads set status = 'done' where id = ${row.id}`;
  await sql`update projects set updated_at = now() where id = ${p.id}`;
  await forgetSource(p);
  const origin = originOf(req);
  if (!isStaff(u)) {
    await audit(req, u, "upload", `Sent a video: ${row.name}`, { projectId: p.id, clientId: p.client_id });
    await later(() => notify({ audience: "staff", project: p, actor: u, origin, path: `/files/${p.id}`, button: "See it in Files",
      subject: `${u.name} sent a video for ${p.title}`, lines: [`${u.name} (${p.client_name}) sent “${row.name}”. It’s in the project’s video folder.`] }), "notify");
  } else {
    await audit(req, u, "video.add", `Added ${row.name}`, { projectId: p.id, clientId: p.client_id });
    // A new version or film: tell the client. It plays once the host finishes processing it.
    await later(async () => {
      await notify({ audience: "client", project: p, actor: u, origin, path: `/review/${p.id}`, button: "Watch it",
        subject: `New on ${p.title}: ${row.name}`, lines: [`${row.name} was added to ${p.title}. You can watch it in the portal as soon as the video host finishes processing it.`] });
      await syncProject(p.id);
    }, "after upload");
  }
  return res.status(200).json({ ok: true });
}
