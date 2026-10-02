// A project's videos: from its source (a connection plus a folder, project, or playlist in it), with staff
// choices applied (Studio → project → Videos: hide, rename, "this is a finished film").
import { sql } from "./_db.js";
import { getConnection, markConnection } from "./_connections.js";
import { VIDEO, LINKS_ID } from "./_providers/index.js";
import { applySettings, splitVideos } from "./_video.js";

/** The project's source: { conn, provider, ref } or null when it has none. */
export async function sourceOf(p) {
  if (p.source_conn === LINKS_ID) return { conn: { id: LINKS_ID, provider: "links", creds: {}, config: {} }, provider: VIDEO.links, ref: p.id };
  if (!p.source_conn || !p.source_ref) return null;
  const conn = await getConnection(p.source_conn);
  if (!conn || !VIDEO[conn.provider]) return null;
  return { conn, provider: VIDEO[conn.provider], ref: p.source_ref };
}

/**
 * Every video in the project's source with staff choices applied. keepHidden: Studio's list shows hidden ones
 * (marked) so they can be shown again. Throws when the source can't be reached.
 */
export async function projectVideos(p, { fresh = false, keepHidden = false, settingsRows } = {}) {
  const src = await sourceOf(p);
  if (!src) return [];
  let list;
  try {
    list = await src.provider.videos(src.conn, src.ref, { fresh, projectId: p.id });
    markConnection(src.conn.id, true);
  } catch (err) {
    markConnection(src.conn.id, false, err.message);
    throw err;
  }
  const rows = settingsRows || (await sql`select video_id, hidden, title, kind from video_settings where project_id = ${p.id}`);
  return applySettings(list, rows, { keepHidden });
}

/** One video of this project, visible to the person asking, or null. Ids can't reach outside the project. */
export async function findVideo(p, id, { staff = false } = {}) {
  if (typeof id !== "string" || !/^[\w-]{1,80}$/.test(id)) return null;
  const list = await projectVideos(p, { keepHidden: staff });
  return list.find((v) => v.id === id) || null;
}

/** Versions and finished films, leaving out videos clients sent (they're footage, listed under Files). */
export async function splitProject(p, opts = {}) {
  const ups = await sql`select vimeo_id from video_uploads where project_id = ${p.id} and uploader_role = 'client'`;
  const videos = await projectVideos(p, opts);
  return { ...splitVideos(videos, new Set(ups.map((u) => u.vimeo_id))), all: videos };
}

/** Clears cached listings after something changed at the source. */
export async function forgetSource(p) {
  const src = await sourceOf(p).catch(() => null);
  if (src && src.provider.forget) src.provider.forget(src.conn, src.ref);
}
