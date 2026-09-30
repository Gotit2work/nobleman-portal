import bcrypt from "bcryptjs";
import { sql } from "./_db.js";

/**
 * One-time setup: creates the first admin.
 * Refuses to run once any admin exists, so it is safe to leave deployed.
 *
 *   curl -X POST https://portal.noblemanproductions.gotit2work.com/api/bootstrap \
 *     -H 'content-type: application/json' \
 *     -d '{"secret":"<BOOTSTRAP_SECRET>","name":"Alexis","email":"alexis@gotit2work.com","password":"..."}'
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const expected = process.env.BOOTSTRAP_SECRET;
  if (!expected) return res.status(500).json({ error: "BOOTSTRAP_SECRET is not set." });

  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (String(b.secret || "") !== expected) return res.status(403).json({ error: "Wrong secret." });

  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  if (!name || !email || password.length < 10) {
    return res.status(400).json({ error: "Name, email, and a password of at least 10 characters are required." });
  }

  try {
    const existing = await sql`select 1 from users where role = 'admin' limit 1`;
    if (existing.length) return res.status(409).json({ error: "An admin already exists. Create further admins from inside the portal." });

    const hash = await bcrypt.hash(password, 10);
    const rows = await sql`
      insert into users (email, name, role, password_hash)
      values (${email}, ${name}, 'admin', ${hash})
      returning id, email, name, role`;

    return res.status(201).json({ user: rows[0] });
  } catch (err) {
    console.error("bootstrap failed", err);
    return res.status(500).json({ error: "Could not create the first admin. Did you run schema.sql?" });
  }
}
