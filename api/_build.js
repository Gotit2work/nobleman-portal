import { sql } from "./_db.js";
import { publicUser } from "./_auth.js";
import { capsOf } from "./_caps.js";
import { getSettings, stageNames, stagePct } from "./_settings.js";
import { effectiveCaps, isStaff, permsOf, accessOf, roleLabel } from "./_roles.js";
import { splitProject, sourceOf } from "./_sources.js";
import { emailReady } from "./_notify.js";
import { paymentsFor, stripeConnection } from "./_payments.js";
import { listConnections } from "./_connections.js";
import { PROVIDERS } from "./_providers/index.js";

const iso = (d) => (d ? new Date(d).toISOString() : null);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** What the page needs about one video. Play counts only where the project shows them. */
function videoOut(v, caps, staff) {
  const o = {
    id: v.id, title: v.title, description: v.description, duration: v.duration, durationLabel: v.durationLabel,
    resolution: v.resolution, vertical: v.vertical, created: v.created, thumbnail: v.thumbnail, playback: v.playback,
  };
  if (caps.stats) o.plays = v.plays;
  if (staff) { o.manage = v.manage; o.hidden = !!v.hidden; }
  return o;
}

const decisionOut = (d) => (d ? { decision: d.decision, note: d.note || "", by: d.user_name, at: iso(d.created_at) } : null);

/**
 * Where a project stands on review, from the newest version of each film in review:
 *   waiting   a newest version has no decision yet          → "Waiting on client"
 *   changes   the client asked for changes, nothing waiting → "Changes requested"
 *   approved  every newest version is approved
 *   none      nothing in review
 */
export function reviewStatus(cuts) {
  if (!cuts.length) return { key: "none", label: "Nothing in review" };
  const latest = cuts.map((c) => c.versions[c.versions.length - 1]);
  if (latest.some((v) => !v.decision)) return { key: "waiting", label: "Waiting on client" };
  if (latest.some((v) => v.decision.decision === "changes")) return { key: "changes", label: "Changes requested" };
  return { key: "approved", label: "Approved" };
}

/** The decisions and note counts for a set of projects, keyed by project then video. */
async function reviewData(ids) {
  if (!ids.length) return { dec: new Map(), cnt: new Map() };
  const [decisions, counts] = await Promise.all([
    sql`select distinct on (project_id, video_id) project_id, video_id, version, decision, note, user_name, created_at
        from approvals where project_id = any(${ids}) order by project_id, video_id, created_at desc`,
    sql`select project_id, video_id, count(*)::int as total,
               count(*) filter (where not resolved and parent_id is null)::int as open
        from comments where project_id = any(${ids}) group by project_id, video_id`,
  ]);
  const key = (r) => r.project_id + ":" + r.video_id;
  return { dec: new Map(decisions.map((d) => [key(d), d])), cnt: new Map(counts.map((c) => [key(c), c])) };
}

/** Versions grouped by film, with each version's decision and note counts. */
export function cutsOut(p, split, rd, caps, staff) {
  return split.cuts.map((g) => {
    let versions = g.versions.map(({ n, video }) => {
      const d = rd.dec.get(p.id + ":" + video.id), c = rd.cnt.get(p.id + ":" + video.id);
      return { n, video: videoOut(video, caps, staff), decision: decisionOut(d), comments: { total: c ? c.total : 0, open: c ? c.open : 0 } };
    });
    const total = versions.length;
    // Clients see only the newest version unless "Earlier versions" is on: no chance of reviewing an old one.
    if (!staff && !caps.history) versions = versions.slice(-1);
    return { key: g.key, title: g.title, versions, total };
  });
}

/**
 * Everything the signed-in person can see: their projects (versions, films, files, counts, and what they may
 * do on each), recent activity, and the studio's settings the page needs. Clients get the active projects they
 * may see (clientMaySee in _auth.js: their company's, or only the ones they joined by link); staff get every one.
 */
export async function buildPortal(user) {
  const s = await getSettings();
  const staff = isStaff(user);
  const names = stageNames(s);
  const projects = staff
    ? await sql`select p.*, c.name as client_name, c.logo_url as client_logo from projects p join clients c on c.id = p.client_id
                where p.archived = false order by p.updated_at desc`
    : await sql`select p.*, c.name as client_name, c.logo_url as client_logo from projects p join clients c on c.id = p.client_id
                where p.archived = false and ((p.client_id = ${user.client_id} and ${user.all_projects !== false})
                  or exists (select 1 from project_people pp where pp.project_id = p.id and pp.user_id = ${user.id}))
                order by p.updated_at desc`;
  const ids = projects.map((p) => p.id);

  const [rd, msgCounts, files, uploads, settingsRows, pays, stripeConn] = await Promise.all([
    reviewData(ids),
    ids.length ? sql`select m.project_id, count(*)::int as total, max(m.created_at) as last,
               count(*) filter (where m.created_at > coalesce(r.seen_at, 'epoch') and m.author_id is distinct from ${user.id})::int as unread
        from messages m left join message_reads r on r.project_id = m.project_id and r.user_id = ${user.id}
        where m.project_id = any(${ids}) group by m.project_id` : [],
    ids.length ? sql`select id, project_id, name, size, content_type, kind, uploader_name, uploader_role, uploaded_by, created_at
        from files where project_id = any(${ids}) and status = 'ready' order by created_at desc limit 500` : [],
    ids.length ? sql`select id, project_id, vimeo_id, name, size, status, uploader_name, uploader_role, uploaded_by, created_at
        from video_uploads where project_id = any(${ids}) order by created_at desc limit 200` : [],
    ids.length ? sql`select project_id, video_id, hidden, title, kind from video_settings where project_id = any(${ids})` : [],
    paymentsFor(ids),
    stripeConnection(),
  ]);

  const byProject = (rows) => {
    const m = new Map();
    for (const r of rows) { if (!m.has(r.project_id)) m.set(r.project_id, []); m.get(r.project_id).push(r); }
    return m;
  };
  const filesBy = byProject(files), uploadsBy = byProject(uploads), vsBy = byProject(settingsRows);
  const msgBy = new Map(msgCounts.map((r) => [r.project_id, r]));

  const out = await Promise.all(projects.map(async (p) => {
    const clientCaps = capsOf(p.capabilities);
    const caps = effectiveCaps(user, clientCaps, s);
    const ups = uploadsBy.get(p.id) || [];
    const src = await sourceOf(p).catch(() => null);
    let cuts = [], films = [], videosError = null;
    if (src) {
      try {
        const split = await splitProject(p, { settingsRows: vsBy.get(p.id) || [] });
        cuts = caps.review ? cutsOut(p, split, rd, caps, staff) : [];
        films = split.films.map((v) => videoOut(v, caps, staff));
      } catch (err) {
        console.error("source failed", p.id, src.conn.provider, err.message);
        videosError = staff ? `${src.provider.meta.name} didn’t answer: ${err.message}` : "Films can’t load right now. Try again in a minute.";
      }
    }
    const newestThumb = [...films, ...cuts.flatMap((g) => g.versions.map((v) => v.video))]
      .filter((v) => v.thumbnail).sort((a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0))[0];
    const seeUploads = caps.upload || staff;
    const fileList = (filesBy.get(p.id) || [])
      .filter((f) => (f.kind === "document" ? caps.files : seeUploads))
      .map((f) => ({
        id: f.id, name: f.name, size: Number(f.size) || 0, contentType: f.content_type || "", kind: f.kind,
        by: f.uploader_name, byRole: f.uploader_role, mine: f.uploaded_by === user.id, at: iso(f.created_at),
      }));
    const videoUploads = seeUploads ? ups.filter((u) => u.uploader_role === "client").map((u) => ({
      id: u.id, vimeoId: u.vimeo_id, name: u.name, size: Number(u.size) || 0, status: u.status,
      by: u.uploader_name, byRole: u.uploader_role, mine: u.uploaded_by === user.id, at: iso(u.created_at),
    })) : [];
    const m = msgBy.get(p.id);
    const stage = Math.max(0, Math.min(names.length - 1, p.stage_idx || 0));
    const o = {
      id: p.id,
      title: p.title,
      type: p.type || "",
      summary: p.summary || "",
      clientId: p.client_id,
      clientName: p.client_name,
      clientLogo: p.client_logo || null,
      stage,
      stageName: names[stage],
      pct: p.pct > 0 ? p.pct : stagePct(s, stage),
      next: {
        label: p.next_label || "", date: p.next_date || "", what: p.next_what || "",
        confirm: !!p.next_confirm, confirmedAt: iso(p.next_confirmed_at), confirmedBy: p.next_confirmed_by || null,
      },
      reviewDue: day(p.review_due),
      cover: p.image_url || (newestThumb ? newestThumb.thumbnail : null),
      caps,
      provider: src ? src.conn.provider : null,
      // Videos a client sends go straight into a Vimeo folder; with other sources they go to Files.
      videoUploadsToSource: !!(src && src.provider.meta.features && src.provider.meta.features.upload),
      cuts,
      films,
      videosError,
      files: fileList,
      videoUploads,
      messages: caps.messages ? { total: m ? m.total : 0, unread: m ? m.unread : 0, last: m ? iso(m.last) : null } : null,
      status: reviewStatus(cuts),
      updated: iso(p.updated_at),
    };
    // What the studio asked to be paid on this project, newest first (_payments.js).
    o.payments = caps.payments ? pays.get(p.id) || [] : [];
    if (staff) {
      o.clientCaps = clientCaps;
      o.source = src ? { conn: src.conn.id, provider: src.conn.provider, providerName: src.provider.meta.name, connName: src.conn.name, ref: p.source_ref } : null;
      o.remindedAt = iso(p.reminded_at);
    }
    return o;
  }));

  return {
    user: {
      ...publicUser(user), access: accessOf(user), roleLabel: roleLabel(user),
      // Managing teammates is for people who see all their company's projects, not those who joined one by link.
      perms: { ...permsOf(user, s), ...(!staff ? { team: !!(permsOf(user, s).team && s.security.clientTeams && user.all_projects !== false) } : {}) },
      twoStepRequired: staff && !!s.security.staffTwoStep,
    },
    demo: false,
    brand: s.brand,
    // First visit: the tutorial starts by itself (app/tour.js) until it's finished or skipped.
    tour: !user.welcomed_at,
    announcement: s.announcement && s.announcement.text ? s.announcement : null,
    emailEnabled: await emailReady(),
    payReady: !!stripeConn,
    stages: names,
    projects: out,
    activity: staff ? await staffActivity() : await clientActivity(user, out),
    // Owners setting up a new portal get a checklist on Home until the essentials are done.
    ...(staff && permsOf(user, s)["settings.manage"] ? { setup: await setupState(s) } : {}),
    // People waiting for the studio to let them in (staff who can approve them only).
    ...(staff && permsOf(user, s)["people.manage"] ? { signups: (await sql`select count(*)::int as n from signup_requests where status = 'waiting'`)[0].n } : {}),
  };
}

/** What's set up so far, for the Getting started checklist on an owner's Home. */
async function setupState(s) {
  const conns = await listConnections().catch(() => []);
  const kinds = new Set(conns.map((c) => PROVIDERS[c.provider] && PROVIDERS[c.provider].meta.kind));
  const [n] = await sql`select (select count(*)::int from clients) as clients, (select count(*)::int from projects) as projects,
    (select count(*)::int from users where role = 'client') as people,
    (select count(*)::int from users where role = 'admin' and coalesce(access, 'owner') = 'owner') as owners,
    (select count(*)::int from projects where source_conn = 'links') as linked`;
  return {
    video: kinds.has("video") || n.linked > 0, email: await emailReady(), storage: !!process.env.BLOB_READ_WRITE_TOKEN,
    payments: kinds.has("payments"), notion: !!(s.notion && s.notion.dataSourceId),
    clients: n.clients, projects: n.projects, people: n.people, owners: n.owners,
  };
}

/** Staff see the activity log's latest entries: what clients and colleagues did. */
async function staffActivity() {
  const rows = await sql`
    select a.at, a.actor_name, a.actor_kind, a.action, a.summary, a.project_id, p.title as project_title
    from audit_log a left join projects p on p.id = a.project_id
    where a.action not like 'signin%' order by a.at desc limit 30`;
  return rows.map((r) => ({
    type: r.action, projectId: r.project_id, projectTitle: r.project_title || "", who: r.actor_name || "Portal",
    role: r.actor_kind === "staff" ? "admin" : "client", text: r.summary, at: iso(r.at), log: true,
  }));
}

/** Clients see notes, decisions, messages, and files on their own projects, as far as each project allows. */
async function clientActivity(user, projects) {
  const ids = projects.map((p) => p.id);
  if (!ids.length) return [];
  const rows = await sql`select * from (
      (select 'comment' as type, project_id, author_name as who, author_role as role, body as text, created_at as at
         from comments where project_id = any(${ids}) order by created_at desc limit 15)
      union all
      (select decision, project_id, user_name, 'client', coalesce(note, ''), created_at
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
    ) a order by at desc limit 25`;
  const caps = new Map(projects.map((p) => [p.id, p.caps]));
  const titles = new Map(projects.map((p) => [p.id, p.title]));
  const allowed = (a) => {
    const c = caps.get(a.project_id);
    if (!c) return false;
    if (a.type === "comment" || a.type === "approved" || a.type === "changes") return c.review;
    if (a.type === "message") return c.messages;
    if (a.type === "document") return c.files;
    return c.upload;
  };
  return rows.filter(allowed).map((a) => ({
    type: a.type, projectId: a.project_id, projectTitle: titles.get(a.project_id) || "", who: a.who,
    role: a.role, text: String(a.text || "").slice(0, 200), at: iso(a.at),
  }));
}
