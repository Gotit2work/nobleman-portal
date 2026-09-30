import { sql } from "./_db.js";
import { session, isUuid, DEMO_MODE } from "./_auth.js";
import { vimeoConfigured, folderVideos } from "./_vimeo.js";

/**
 * GET /api/videos — the viewer's films from Vimeo, grouped by project.
 *
 *   client  → every active project of their own client that has a vimeo_folder_id
 *   admin   → ?project=<uuid> for one project; otherwise the demo folder (demo mode only)
 *   no session, PORTAL_MODE=demo → VIMEO_DEMO_FOLDER_ID only
 *   no session otherwise → 401
 *
 * Only folders tied to the viewer are ever requested, so the endpoint can't be used to browse the Vimeo
 * account. With no VIMEO_ACCESS_TOKEN it answers { configured: false } and the portal keeps its demo films.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control", "private, no-store");

  const s = await session(req);
  let user = null;
  if (s && isUuid(s.sub)) {
    try {
      user = (await sql`select id, role, client_id from users where id = ${s.sub} limit 1`)[0] || null;
    } catch (err) {
      console.error("videos: session lookup failed", err);
      return res.status(500).json({ error: "Videos are unavailable right now." });
    }
  }
  if (!user && !DEMO_MODE) return res.status(401).json({ error: "Not signed in" });
  if (!vimeoConfigured()) return res.status(200).json({ configured: false, projects: [] });

  let targets = [];
  try {
    if (user && user.role === "client") {
      targets = await sql`
        select id, title, vimeo_folder_id as folder from projects
        where client_id = ${user.client_id} and archived = false and vimeo_folder_id is not null
        order by created_at desc limit 5`;
    } else if (user && user.role === "admin") {
      const pid = String((req.query && req.query.project) || "");
      if (pid && !isUuid(pid)) return res.status(400).json({ error: "That project id is not valid." });
      if (pid) targets = await sql`select id, title, vimeo_folder_id as folder from projects where id = ${pid} and vimeo_folder_id is not null`;
    }
  } catch (err) {
    console.error("videos: project lookup failed", err);
    return res.status(500).json({ error: "Videos are unavailable right now." });
  }
  if (!targets.length && (!user || user.role === "admin") && DEMO_MODE && process.env.VIMEO_DEMO_FOLDER_ID) {
    targets = [{ id: "demo", title: "Demo", folder: process.env.VIMEO_DEMO_FOLDER_ID }];
  }

  try {
    const projects = await Promise.all(
      targets.map(async (t) => ({ id: t.id, title: t.title, videos: await folderVideos(t.folder) })),
    );
    return res.status(200).json({ configured: true, projects });
  } catch (err) {
    console.error("videos: Vimeo request failed", err);
    return res.status(502).json({ error: "Videos are unavailable right now." });
  }
}
