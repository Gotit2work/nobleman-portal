import { sql } from "./_db.js";
import { session, clearSessionCookie, isUuid, DEMO_MODE, DEMO_USER } from "./_auth.js";

// Without a session: 401, or the sample client when PORTAL_MODE=demo.
const signedOut = (res) =>
  DEMO_MODE ? res.status(200).json({ user: DEMO_USER, demo: true }) : res.status(401).json({ error: "Not signed in" });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const s = await session(req);
  if (!s || !isUuid(s.sub)) return signedOut(res);

  try {
    const rows = await sql`
      select u.id, u.email, u.name, u.title, u.role, u.client_id, c.name as client_name
      from users u left join clients c on c.id = u.client_id
      where u.id = ${s.sub} limit 1`;

    const u = rows[0];
    if (!u) {
      clearSessionCookie(res);
      return signedOut(res);
    }

    return res.status(200).json({
      user: {
        id: u.id, email: u.email, name: u.name, title: u.title,
        role: u.role, clientId: u.client_id, clientName: u.client_name,
      },
    });
  } catch (err) {
    console.error("me failed", err);
    return res.status(500).json({ error: "Could not load your account." });
  }
}
