import { sql } from "./_db.js";
import { session } from "./_auth.js";

export default async function handler(req, res) {
  const s = await session(req);
  if (!s) return res.status(401).json({ error: "Not signed in" });

  try {
    const rows = await sql`
      select u.id, u.email, u.name, u.title, u.role, u.client_id, c.name as client_name
      from users u left join clients c on c.id = u.client_id
      where u.id = ${s.sub} limit 1`;

    const u = rows[0];
    if (!u) return res.status(401).json({ error: "Not signed in" });

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
