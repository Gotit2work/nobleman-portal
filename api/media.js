import { sql, ready, dbConfigured } from "./_db.js";
import { TROUBLE, readBody, requireUser, projectFor, isUuid, text } from "./_auth.js";
import { vimeoConfigured, folderVideos, forgetFolder, videoDownloads, textTracks, chapters, createUpload, account } from "./_vimeo.js";
import { notify, originOf } from "./_notify.js";

/**
 * GET  /api/media?project=<id>&video=<vimeo id>   downloads, captions, and chapters for one film or version,
 *                                                 as far as the project allows (_caps.js)
 * POST /api/media {action:"uploadStart"}          projectId, name, size, type: a Vimeo upload link for one video
 * POST /api/media {action:"uploadDone"}           uploadId
 * POST /api/media {action:"uploadCancel"}         uploadId
 *
 * Videos only ever come from the project's own Vimeo folder. Download and caption links are signed by Vimeo
 * and expire, so they are fetched when someone asks, never stored.
 */
const MAX_VIDEO = 50 * 1024 ** 3; // 50 GB, well above any single file clients send

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!dbConfigured()) return res.status(503).json({ error: "The portal isn’t connected to its database yet." });
  try { await ready(); } catch (err) { console.error("db not ready", err); return res.status(500).json({ error: TROUBLE }); }
  const u = await requireUser(req, res);
  if (!u) return;
  if (!vimeoConfigured()) return res.status(503).json({ error: "Vimeo isn’t connected yet." });
  try {
    if (req.method === "GET") return await details(req, res, u);
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const b = readBody(req, res);
    if (!b) return;
    if (b.action === "uploadStart") return await uploadStart(req, res, u, b);
    if (b.action === "uploadDone") return await uploadEnd(req, res, u, b, true);
    if (b.action === "uploadCancel") return await uploadEnd(req, res, u, b, false);
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    console.error("media failed", err);
    if (err.status === 401) return res.status(502).json({ error: "Vimeo refused the portal’s access. Ask Nobleman to check the Vimeo connection." });
    return res.status(502).json({ error: "Vimeo isn’t answering right now. Try again in a minute." });
  }
}

async function details(req, res, u) {
  const q = req.query || {};
  const p = await projectFor(u, String(q.project || ""));
  if (!p) return res.status(404).json({ error: "That project isn’t available to you." });
  const id = String(q.video || "");
  if (!/^\d+$/.test(id) || !p.vimeo_folder_id) return res.status(404).json({ error: "That film isn’t in this project." });
  const video = (await folderVideos(p.vimeo_folder_id)).find((v) => v.id === id);
  if (!video) return res.status(404).json({ error: "That film isn’t in this project." });

  const out = { downloads: null, captions: null, chapters: null };
  const jobs = [];
  // Downloads are for finished films. Versions under review are previews, not deliverables.
  if (p.caps.download && video.version == null) {
    jobs.push(videoDownloads(id).then((d) => {
      const links = d.links.filter((l) => !l.source || p.caps.download_source).map(({ link, label, sizeLabel, size, source, width, height }) => ({ link, label, sizeLabel, size, source, width, height }));
      const onVimeo = !links.length && d.onVimeo && video.shareable ? d.onVimeo : null;
      out.downloads = {
        links,
        onVimeo,
        reason: links.length || onVimeo ? null : u.role === "admin"
          ? "Vimeo returned no download links. Download links through the API need a Vimeo Standard plan or above and the token’s video_files scope; or allow downloads on this film in Vimeo and make it unlisted to offer “Download on Vimeo”."
          : "Downloads for this film aren’t ready yet. Ask Nobleman and they’ll send it.",
      };
    }).catch((err) => {
      console.error("downloads failed", id, err.message);
      out.downloads = { links: [], onVimeo: null, reason: u.role === "admin" ? `Vimeo refused the download request (${err.status || "error"}). Check the token’s video_files scope.` : "Downloads aren’t available right now. Ask Nobleman." };
    }));
  }
  if (p.caps.captions) {
    jobs.push(textTracks(id).then((t) => { out.captions = t; }).catch(() => { out.captions = []; }));
    jobs.push(chapters(id).then((c) => { out.chapters = c; }).catch(() => { out.chapters = []; }));
  }
  await Promise.all(jobs);
  return res.status(200).json(out);
}

async function uploadStart(req, res, u, b) {
  const p = await projectFor(u, b.projectId);
  if (!p) return res.status(404).json({ error: "That project isn’t available to you." });
  if (!p.caps.upload) return res.status(403).json({ error: "Uploads aren’t switched on for this project. Ask Nobleman if you need to send something." });
  if (!p.vimeo_folder_id) return res.status(409).json({ error: "This project has no Vimeo folder yet, so videos can’t be sent here. Ask Nobleman to link one." });
  const name = text(b.name, 200);
  const size = Number(b.size) || 0;
  if (!name || size <= 0) return res.status(400).json({ error: "That file is empty." });
  if (size > MAX_VIDEO) return res.status(413).json({ error: "That file is larger than 50 GB. Ask Nobleman for another way to send it." });
  if (!/^video\//.test(String(b.type || ""))) return res.status(400).json({ error: "Only video files go to Vimeo. Other files go to Files." });
  try {
    const a = await account();
    if (a.upload.free != null && size > a.upload.free) {
      return res.status(507).json({ error: "Nobleman’s Vimeo account doesn’t have room for this file right now. Ask Nobleman, or send it another way." });
    }
  } catch { /* quota unknown: let Vimeo decide */ }
  const prefix = u.role === "client" ? `From ${p.client_name}: ` : "";
  const up = await createUpload({ name: prefix + name, size, folderId: p.vimeo_folder_id, description: `Sent through the client portal by ${u.name}.`, fromClient: u.role === "client" });
  if (!up.uploadLink || up.approach !== "tus") return res.status(502).json({ error: "Vimeo didn’t accept the upload. Try again in a minute." });
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
  if (!p || (row.uploaded_by !== u.id && u.role !== "admin")) return res.status(404).json({ error: "That upload isn’t yours." });
  if (done) {
    await sql`update video_uploads set status = 'done' where id = ${row.id}`;
    await sql`update projects set updated_at = now() where id = ${p.id}`;
    forgetFolder(p.vimeo_folder_id);
    if (u.role === "client") {
      await notify({ audience: "staff", project: p, actor: u, origin: originOf(req),
        subject: `${u.name} sent a video for ${p.title}`, lines: [`${u.name} (${p.client_name}) sent “${row.name}”. It’s in the project’s Vimeo folder.`] });
    } else {
      // Staff added a version or a finished film: tell the client once Vimeo has it ready to play.
      await notify({ audience: "client", project: p, actor: u, origin: originOf(req),
        subject: `New on ${p.title}: ${row.name}`, lines: [`Nobleman added “${row.name}” to ${p.title}. You can watch it in the portal as soon as Vimeo finishes processing it.`] });
    }
  } else {
    // The empty video stays in Vimeo marked as an unfinished upload; staff can delete it there.
    await sql`delete from video_uploads where id = ${row.id}`;
  }
  return res.status(200).json({ ok: true });
}
