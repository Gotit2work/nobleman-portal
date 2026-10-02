import { sql } from "./_db.js";
import { publicUser } from "./_auth.js";
import { capsOf, ALL_CAPS, STAGES, STAGE_PCT } from "./_caps.js";
import { vimeoConfigured, folderVideos, splitFolder } from "./_vimeo.js";
import { emailConfigured } from "./_notify.js";

/** What the page needs about one video. `share`/`stats` add the Vimeo page link and play count. */
function videoOut(v, caps) {
  const o = {
    id: v.id, playId: v.id, hash: v.hash, title: v.title, description: v.description, duration: v.duration,
    durationLabel: v.durationLabel, resolution: v.resolution, vertical: v.vertical, created: v.created,
    thumbnail: v.thumbnail,
  };
  if (caps.stats) o.plays = v.plays;
  if (caps.share) o.link = v.shareable ? v.link : null;
  return o;
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

/**
 * Everything the signed-in person can see: their projects (with versions, films, files, counts, and what
 * they're allowed to do on each) and recent activity. Clients get only their own client's active projects;
 * admins get every active project.
 */
export async function buildPortal(user) {
  const admin = user.role === "admin";
  const projects = admin
    ? await sql`select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id
                where p.archived = false order by p.updated_at desc`
    : await sql`select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id
                where p.client_id = ${user.client_id} and p.archived = false order by p.updated_at desc`;
  const ids = projects.map((p) => p.id);

  const [decisions, commentCounts, msgCounts, files, uploads, activity] = ids.length ? await Promise.all([
    sql`select distinct on (project_id, video_id) project_id, video_id, version, decision, note, user_name, created_at
        from approvals where project_id = any(${ids}) order by project_id, video_id, created_at desc`,
    sql`select project_id, video_id, count(*)::int as total,
               count(*) filter (where not resolved and parent_id is null)::int as open
        from comments where project_id = any(${ids}) group by project_id, video_id`,
    sql`select m.project_id, count(*)::int as total, max(m.created_at) as last,
               count(*) filter (where m.created_at > coalesce(r.seen_at, 'epoch') and m.author_id is distinct from ${user.id})::int as unread
        from messages m left join message_reads r on r.project_id = m.project_id and r.user_id = ${user.id}
        where m.project_id = any(${ids}) group by m.project_id`,
    sql`select id, project_id, name, size, content_type, kind, uploader_name, uploader_role, uploaded_by, created_at
        from files where project_id = any(${ids}) and status = 'ready' order by created_at desc limit 500`,
    sql`select id, project_id, vimeo_id, name, size, status, uploader_name, uploader_role, uploaded_by, created_at
        from video_uploads where project_id = any(${ids}) order by created_at desc limit 200`,
    sql`select * from (
          (select 'comment' as type, project_id, author_name as who, author_role as role, body as text, created_at as at
             from comments where project_id = any(${ids}) order by created_at desc limit 15)
          union all
          (select decision as type, project_id, user_name, 'client', coalesce(note, ''), created_at
             from approvals where project_id = any(${ids}) order by created_at desc limit 15)
          union all
          (select 'message', project_id, author_name, author_role, body, created_at
             from messages where project_id = any(${ids}) order by created_at desc limit 15)
          union all
          (select case when kind = 'document' then 'document' else 'file' end, project_id, uploader_name, uploader_role, name, created_at
             from files where project_id = any(${ids}) and status = 'ready' order by created_at desc limit 15)
          union all
          (select 'video', project_id, uploader_name, uploader_role, name, created_at
             from video_uploads where project_id = any(${ids}) order by created_at desc limit 15)
        ) a order by at desc limit 25`,
  ]) : [[], [], [], [], [], []];

  const byProject = (rows) => {
    const m = new Map();
    for (const r of rows) { if (!m.has(r.project_id)) m.set(r.project_id, []); m.get(r.project_id).push(r); }
    return m;
  };
  const decisionsBy = byProject(decisions), countsBy = byProject(commentCounts), filesBy = byProject(files), uploadsBy = byProject(uploads);
  const msgBy = new Map(msgCounts.map((r) => [r.project_id, r]));

  const vimeoOn = vimeoConfigured();
  const out = await Promise.all(projects.map(async (p) => {
    const clientCaps = capsOf(p.capabilities);
    const caps = admin ? { ...ALL_CAPS } : clientCaps;
    const ups = uploadsBy.get(p.id) || [];
    let cuts = [], films = [], videosError = null;
    if (vimeoOn && p.vimeo_folder_id) {
      try {
        // Footage a client sent is for Nobleman, not a film; videos staff upload become versions or films by name.
        const split = splitFolder(await folderVideos(p.vimeo_folder_id), new Set(ups.filter((u) => u.uploader_role === "client").map((u) => u.vimeo_id)));
        const dec = new Map((decisionsBy.get(p.id) || []).map((d) => [d.video_id, d]));
        const cnt = new Map((countsBy.get(p.id) || []).map((c) => [c.video_id, c]));
        cuts = split.cuts.map((g) => ({
          key: g.key,
          title: g.title,
          versions: g.versions.map(({ n, video }) => {
            const d = dec.get(video.id), c = cnt.get(video.id);
            return {
              n,
              video: videoOut(video, caps),
              decision: d ? { decision: d.decision, note: d.note || "", by: d.user_name, at: iso(d.created_at) } : null,
              comments: { total: c ? c.total : 0, open: c ? c.open : 0 },
            };
          }),
        }));
        films = split.films.map((v) => videoOut(v, caps));
      } catch (err) {
        console.error("vimeo folder failed", p.vimeo_folder_id, err.message);
        videosError = "Films can’t load right now. Try again in a minute.";
      }
    }
    const newestThumb = [...films, ...cuts.flatMap((g) => g.versions.map((v) => v.video))]
      .filter((v) => v.thumbnail).sort((a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0))[0];
    const seeDocs = caps.files, seeUploads = caps.upload || admin;
    const fileList = (filesBy.get(p.id) || [])
      .filter((f) => (f.kind === "document" ? seeDocs : seeUploads))
      .map((f) => ({
        id: f.id, name: f.name, size: Number(f.size) || 0, contentType: f.content_type || "", kind: f.kind,
        by: f.uploader_name, byRole: f.uploader_role, mine: f.uploaded_by === user.id, at: iso(f.created_at),
      }));
    const videoUploads = seeUploads ? ups.filter((u) => u.uploader_role === "client").map((u) => ({
      id: u.id, vimeoId: u.vimeo_id, name: u.name, size: Number(u.size) || 0, status: u.status,
      by: u.uploader_name, byRole: u.uploader_role, mine: u.uploaded_by === user.id, at: iso(u.created_at),
    })) : [];
    const m = msgBy.get(p.id);
    const stage = Math.max(0, Math.min(STAGES.length - 1, p.stage_idx || 0));
    const o = {
      id: p.id,
      title: p.title,
      type: p.type || "",
      summary: p.summary || "",
      clientId: p.client_id,
      clientName: p.client_name,
      stage,
      stageName: STAGES[stage],
      pct: p.pct > 0 ? p.pct : STAGE_PCT[stage],
      next: { label: p.next_label || "", date: p.next_date || "", what: p.next_what || "" },
      cover: p.image_url || (newestThumb ? newestThumb.thumbnail : null),
      caps,
      vimeoLinked: !!p.vimeo_folder_id,
      cuts,
      films,
      videosError,
      files: fileList,
      videoUploads,
      messages: caps.messages ? { total: m ? m.total : 0, unread: m ? m.unread : 0, last: m ? iso(m.last) : null } : null,
      updated: iso(p.updated_at),
    };
    if (admin) { o.clientCaps = clientCaps; o.folder = p.vimeo_folder_id || null; }
    return o;
  }));

  const titles = new Map(projects.map((p) => [p.id, p.title]));
  const visible = new Map(out.map((p) => [p.id, p.caps]));
  const allowed = (a) => {
    const c = visible.get(a.project_id);
    if (!c) return false;
    if (a.type === "comment" || a.type === "approved" || a.type === "changes") return c.review;
    if (a.type === "message") return c.messages;
    if (a.type === "document") return c.files;
    return c.upload;
  };
  return {
    user: publicUser(user),
    demo: false,
    vimeo: { configured: vimeoOn },
    emailEnabled: emailConfigured(),
    stages: STAGES,
    projects: out,
    activity: activity.filter(allowed).map((a) => ({
      type: a.type, projectId: a.project_id, projectTitle: titles.get(a.project_id) || "", who: a.who,
      role: a.role, text: String(a.text || "").slice(0, 200), at: iso(a.at),
    })),
  };
}
