// Notes, two ways, for projects whose videos come from Frame.io.
//
//   Portal → Frame.io  A note, reply, or decision written in the portal is copied to the same video in Frame.io as
//                      a comment ("Dana Whitfield (Harbor Labs) via the portal: …"), at the same moment, as soon as
//                      it's saved (in the background, so nobody waits). Marking a note done, or deleting it, does
//                      the same there. Frame.io's API can't make replies, so a portal reply arrives as its own
//                      comment at the same moment, saying who it replies to.
//   Frame.io → Portal  Comments made in Frame.io (by the studio, or anyone reviewing there) show in the portal under
//                      their author's name, with replies under their note. They're read whenever someone opens that
//                      version's notes, and straight away when Frame.io's webhook says something changed (Studio →
//                      Connections → Frame.io → Live updates). Completed in Frame.io = done in the portal; deleted
//                      there = gone here (for comments written there; a client's own note stays in the portal).
//
// Each note remembers its Frame.io comment (comments.frameio_id) and where it was written (origin). A note that
// couldn't be copied (Frame.io was down) is sent the next time anyone opens that version's notes.
import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "./_db.js";
import { sourceOf, projectVideos, splitProject } from "./_sources.js";
import { updateConnection } from "./_connections.js";
import { notify } from "./_notify.js";
import * as fio from "./_providers/frameio.js";

const PULL_MS = 15 * 1000;
const pulledAt = new Map();
// How the portal signs what it copies to Frame.io. Reading back, this is how a copy is recognised.
const PUSHED = /^(.+?) via the portal(?:, replying to [^:]+)?: ([\s\S]*)$/;

/** The Frame.io connection a project plays from (signed in and with an account chosen), or null. */
export async function frameioOf(p) {
  const src = await sourceOf(p).catch(() => null);
  if (!src || src.conn.provider !== "frameio" || fio.needsSignIn(src.conn) || !(src.conn.config && src.conn.config.accountId)) return null;
  return src.conn;
}

const who = (name, company) => `${name}${company ? ` (${company})` : ""}`;

/**
 * Reads Frame.io's comments on one video into the portal's notes, and sends any portal notes that didn't reach
 * Frame.io yet. At most every 15 seconds per video unless forced (a webhook). Returns the notes it added.
 */
export async function pullNotes(p, videoId, { force = false, version = null } = {}) {
  const conn = await frameioOf(p);
  if (!conn) return { added: [] };
  const k = p.id + ":" + videoId;
  if (!force && (pulledAt.get(k) || 0) > Date.now() - PULL_MS) return { added: [] };
  pulledAt.set(k, Date.now());
  let remote;
  try { remote = await fio.listComments(conn, videoId); } catch (err) {
    console.error("frame.io comments failed", p.id, videoId, err.message);
    return { added: [], error: err.message };
  }
  const [rows, decisions, people] = await Promise.all([
    sql`select id, frameio_id, origin, parent_id, body, resolved, created_at from comments where project_id = ${p.id} and video_id = ${videoId}`,
    sql`select frameio_id from approvals where project_id = ${p.id} and frameio_id is not null`,
    sql`select id, name, email, role from users`,
  ]);
  const byFid = new Map(rows.filter((r) => r.frameio_id).map((r) => [r.frameio_id, r]));
  const decided = new Set(decisions.map((d) => d.frameio_id));
  const byEmail = new Map(people.map((u) => [String(u.email).toLowerCase(), u]));
  const waiting = rows.filter((r) => r.origin === "portal" && !r.frameio_id);
  const seen = new Set(), added = [];

  // One Frame.io comment; parent is the portal note it replies to. Returns the portal note it is (or null).
  const one = async (c, parent) => {
    seen.add(c.id);
    if (decided.has(c.id)) return null;
    const done = !!c.completed_at;
    const have = byFid.get(c.id);
    if (have) {
      if (have.origin === "frameio" && have.body !== c.text) await sql`update comments set body = ${String(c.text || "")} where id = ${have.id}`;
      if (!have.parent_id && have.resolved !== done) await sql`update comments set resolved = ${done} where id = ${have.id}`;
      return have.parent_id || have.id;
    }
    const m = PUSHED.exec(String(c.text || ""));
    if (m) {
      // The portal's own copy, still being recorded: link it rather than adding it twice.
      const mine = waiting.find((r) => !r.frameio_id && r.body === m[2].trim());
      if (mine) { mine.frameio_id = c.id; await sql`update comments set frameio_id = ${c.id} where id = ${mine.id}`; return mine.parent_id || mine.id; }
      return null; // a copy of a note deleted in the portal: don't bring it back
    }
    const o = c.owner || {};
    const u = byEmail.get(String(o.email || "").toLowerCase());
    const name = u ? u.name : o.name || o.email || "Frame.io";
    const at = parent ? null : fio.fromTimecode(c.timestamp);
    const [row] = await sql`
      insert into comments (project_id, video_id, version, at_seconds, body, parent_id, author_id, author_name, author_role, resolved, created_at, frameio_id, origin)
      values (${p.id}, ${videoId}, ${version}, ${at}, ${String(c.text || "").slice(0, 4000)}, ${parent}, ${u ? u.id : null}, ${name}, ${u ? u.role : "admin"},
              ${parent ? false : done}, ${c.created_at || new Date().toISOString()}, ${c.id}, 'frameio')
      on conflict (frameio_id) do nothing returning id`;
    if (!row) return null;
    added.push({ id: row.id, author: name, role: u ? u.role : "admin", body: String(c.text || ""), at, reply: !!parent });
    return parent || row.id;
  };
  for (const c of remote) {
    const anchor = await one(c, null);
    for (const r of c.replies || []) if (anchor) await one(r, anchor);
  }
  // Deleted in Frame.io: what was written there goes here too.
  const gone = rows.filter((r) => r.origin === "frameio" && r.frameio_id && !seen.has(r.frameio_id)).map((r) => r.id);
  if (gone.length) await sql`delete from comments where id = any(${gone})`;
  // Written here while Frame.io wasn't answering: send it now (the last 30 days).
  const month = Date.now() - 30 * 864e5;
  for (const r of waiting.filter((x) => !x.frameio_id && Date.parse(x.created_at) > month)) await pushNote(p, r.id).catch(() => {});
  return { added };
}

/** Copies one portal note (or reply) to Frame.io. Returns the comment's id there, or null. */
export async function pushNote(p, id) {
  const conn = await frameioOf(p);
  if (!conn) return null;
  const r = (await sql`select c.*, cl.name as company from comments c left join users u on u.id = c.author_id left join clients cl on cl.id = u.client_id
                       where c.id = ${id}`)[0];
  if (!r || r.frameio_id || r.origin !== "portal") return null;
  let at = r.at_seconds, reply = "";
  if (r.parent_id) {
    const par = (await sql`select author_name, at_seconds from comments where id = ${r.parent_id}`)[0];
    at = par ? par.at_seconds : null;
    reply = par ? `, replying to ${par.author_name}` : "";
  }
  const c = await fio.createComment(conn, r.video_id, { text: `${who(r.author_name, r.company)} via the portal${reply}: ${r.body}`, at: at === null ? null : Number(at) });
  // If a read from Frame.io picked the copy up in the meantime, keep the portal's note and drop that duplicate.
  await sql`delete from comments where frameio_id = ${c.id} and origin = 'frameio'`;
  await sql`update comments set frameio_id = ${c.id} where id = ${r.id}`;
  return c.id;
}

/** Copies a client's decision on a version to Frame.io, as a comment on that version. */
export async function pushDecision(p, approvalId) {
  const conn = await frameioOf(p);
  if (!conn) return null;
  const a = (await sql`select a.*, cl.name as company from approvals a left join users u on u.id = a.user_id left join clients cl on cl.id = u.client_id
                       where a.id = ${approvalId}`)[0];
  if (!a || a.frameio_id) return null;
  const v = a.version ? `Version ${a.version}` : "this version";
  const what = a.decision === "approved" ? `Approved ${v}.${a.note ? ` Small fixes: ${a.note}` : ""}` : `Asked for changes to ${v}: ${a.note || ""}`;
  const c = await fio.createComment(conn, a.video_id, { text: `${who(a.user_name, a.company)} via the portal: ${what}` });
  await sql`update approvals set frameio_id = ${c.id} where id = ${a.id}`;
  return c.id;
}

/** Marks the Frame.io copy of a note done (or not). */
export async function pushDone(p, frameioId, done) {
  const conn = frameioId && (await frameioOf(p));
  if (conn) await fio.completeComment(conn, frameioId, done);
}

/** Deletes the Frame.io copies of notes deleted in the portal. */
export async function pushDelete(p, frameioIds) {
  const conn = frameioIds.length && (await frameioOf(p));
  if (conn) for (const id of frameioIds) await fio.deleteComment(conn, id);
}

// ---------- live updates (Frame.io webhooks) ----------

/**
 * Checks Frame.io's signature: HMAC-SHA256 of "v0:<timestamp>:<body>" with the webhook's secret, sent as
 * "v0=<hex>", within five minutes. One connection can have a webhook (and secret) per workspace.
 */
export function verifyFrameio(raw, timestamp, signature, secrets) {
  const t = Number(timestamp);
  if (!t || !signature || !secrets.length) return false;
  const sec = t > 1e12 ? t / 1000 : t;
  if (Math.abs(Date.now() / 1000 - sec) > 300) return false;
  const got = Buffer.from(String(signature));
  return secrets.some((secret) => {
    const want = Buffer.from("v0=" + createHmac("sha256", String(secret)).update(`v0:${timestamp}:`).update(raw).digest("hex"));
    return want.length === got.length && timingSafeEqual(want, got);
  });
}

/** Switches live updates on (a webhook in each workspace of the account) or off. Returns how many workspaces. */
export async function setLive(conn, on, url) {
  const hooks = { ...((conn.creds && conn.creds.webhooks) || {}) };
  for (const [ws, h] of Object.entries(hooks)) { await fio.deleteWebhook(conn, h.id).catch(() => {}); delete hooks[ws]; }
  let n = 0;
  if (on) {
    for (const ws of await fio.workspaces(conn)) {
      hooks[ws.id] = await fio.createWebhook(conn, ws.id, { name: "Nobleman client portal", url });
      n++;
    }
  }
  await updateConnection(conn.id, { creds: { ...conn.creds, webhooks: hooks }, config: { live: on && n ? { at: new Date().toISOString(), workspaces: n, url } : null } });
  return n;
}

const clock = (s) => (s === null || s === undefined ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

/**
 * One event from Frame.io. Comments: re-read that video's notes and tell the client about anything new from the
 * studio. A new or finished file: forget the cached listing, and tell the client when it's a new newest version.
 */
export async function handleEvent(conn, evt, origin) {
  const type = String(evt && evt.type || ""), rid = evt && evt.resource && evt.resource.id;
  if (!rid) return;
  const projects = await sql`select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id
                             where p.source_conn = ${conn.id} and not p.archived`;
  if (type.startsWith("comment.")) {
    const local = (await sql`select video_id from comments where frameio_id = ${rid} limit 1`)[0];
    const fileId = local ? local.video_id : type === "comment.deleted" ? null : ((await fio.showComment(conn, rid).catch(() => null)) || {}).file_id;
    if (!fileId) return;
    for (const p of projects) {
      const v = (await projectVideos(p, { keepHidden: true })).find((x) => x.id === fileId);
      if (!v) continue;
      if (v.hidden) { await pullNotes(p, fileId, { force: true, version: v.version ?? null }); continue; }
      const { added } = await pullNotes(p, fileId, { force: true, version: v.version ?? null });
      const fromStudio = added.filter((a) => a.role === "admin");
      if (!fromStudio.length) continue;
      const title = v.version != null ? `${v.baseTitle || v.title} Version ${v.version}` : v.title;
      await notify({ audience: "client", project: p, actor: null, origin, path: `/review/${p.id}`, button: "See the note", need: "review",
        subject: `${fromStudio[0].author} left ${fromStudio.length === 1 ? "a note" : "notes"} on ${title}`,
        lines: fromStudio.slice(0, 5).flatMap((a) => [`${a.author}${a.at !== null ? ` at ${clock(a.at)}` : ""}${a.reply ? " (a reply)" : ""}:`, a.body]) });
    }
    return;
  }
  if (type === "file.ready" || type === "file.versioned") {
    fio.forget(conn);
    for (const p of projects) {
      const split = await splitProject(p, { fresh: true }).catch(() => null);
      const cut = split && split.cuts.find((c) => c.versions[c.versions.length - 1].video.id === rid);
      if (!cut) continue;
      const v = cut.versions[cut.versions.length - 1];
      if (v.video.ready === false || v.video.hidden) continue;
      const [fresh] = await sql`insert into video_announcements (project_id, video_id) values (${p.id}, ${rid}) on conflict do nothing returning video_id`;
      if (!fresh) continue;
      await notify({ audience: "client", project: p, actor: null, origin, path: `/review/${p.id}`, button: "Watch it", need: "review",
        subject: `Ready for your review: ${cut.title} Version ${v.n}`,
        lines: [`${cut.title} Version ${v.n} is ready in the portal.`, "Watch it, leave a note on anything you’d change, then approve it or ask for changes."] });
    }
  }
}
