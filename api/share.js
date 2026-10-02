import { sql, ready, dbConfigured } from "./_db.js";
import { TROUBLE } from "./_auth.js";
import { hashToken } from "./_crypto.js";
import { getSettings } from "./_settings.js";
import { findVideo, sourceOf } from "./_sources.js";

/**
 * Public share links (/watch/<token>): one finished film on a page branded with the studio's name, for
 * whoever has the link. No sign-in. Each link can expire and can be turned off at any time.
 *
 * GET /api/share?token=<token>          the film's title, description, and how to play it (counts a view)
 * GET /api/share?token=<token>&play=1   a fresh address for sources that sign them (Frame.io)
 *
 * Nothing about the client or project is shown beyond the film itself.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!dbConfigured()) return res.status(404).json({ error: "This link isn’t working." });
  try {
    await ready();
    const token = String((req.query && req.query.token) || "");
    const gone = { error: "This link isn’t available. It may have expired or been turned off. Ask whoever sent it for a new one." };
    if (token.length < 20 || token.length > 100) return res.status(404).json(gone);
    const sh = (await sql`select * from share_links where token_hash = ${hashToken(token)}`)[0];
    if (!sh || sh.revoked_at || (sh.expires_at && Date.parse(sh.expires_at) < Date.now())) return res.status(404).json(gone);
    const p = (await sql`select * from projects where id = ${sh.project_id}`)[0];
    if (!p || p.archived) return res.status(404).json(gone);
    const v = await findVideo(p, sh.video_id);
    if (!v || v.version != null) return res.status(404).json(gone);
    const s = await getSettings();
    if (req.query.play) {
      if (v.playback && v.playback.url) return res.status(200).json({ url: v.playback.url });
      const src = await sourceOf(p);
      if (!src || !src.provider.play) return res.status(409).json({ error: "This film plays in its own player." });
      return res.status(200).json(await src.provider.play(src.conn, v));
    }
    await sql`update share_links set views = views + 1, last_viewed_at = now() where id = ${sh.id}`;
    return res.status(200).json({
      studio: s.brand.studio, website: s.brand.website || null,
      film: {
        id: v.id, title: v.title, description: v.description, durationLabel: v.durationLabel, resolution: v.resolution,
        vertical: v.vertical, thumbnail: v.thumbnail, playback: v.playback,
      },
      expires: sh.expires_at ? new Date(sh.expires_at).toISOString() : null,
    });
  } catch (err) {
    console.error("share failed", err.message);
    return res.status(500).json({ error: TROUBLE });
  }
}
