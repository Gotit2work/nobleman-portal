import { sql } from "../_db.js";
import { requireAdmin } from "../_auth.js";

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === "GET") {
    try {
      const rows = await sql`
        select c.id, c.name, count(u.id)::int as user_count
        from clients c left join users u on u.client_id = c.id
        group by c.id, c.name order by c.name`;
      return res.status(200).json({ clients: rows });
    } catch (err) {
      console.error("list clients failed", err);
      return res.status(500).json({ error: "Could not load clients." });
    }
  }

  if (req.method === "POST") {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ error: "A client name is required." });
    try {
      const rows = await sql`insert into clients (name) values (${name}) returning id, name`;
      return res.status(201).json({ client: rows[0] });
    } catch (err) {
      console.error("create client failed", err);
      return res.status(500).json({ error: "Could not create that client." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
