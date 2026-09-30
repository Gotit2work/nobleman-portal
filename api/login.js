import bcrypt from "bcryptjs";
import { sql } from "./_db.js";
import { signSession, setSessionCookie } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  try {
    const rows = await sql`
      select u.id, u.email, u.name, u.title, u.role, u.client_id, u.password_hash, c.name as client_name
      from users u left join clients c on c.id = u.client_id
      where u.email = ${email} limit 1`;

    const user = rows[0];
    // Compare against a dummy hash when the user is missing so timing does not leak existence.
    const hash = user ? user.password_hash : "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) return res.status(401).json({ error: "That email and password do not match." });

    await sql`update users set last_login_at = now() where id = ${user.id}`;
    setSessionCookie(res, await signSession(user));

    return res.status(200).json({
      user: {
        id: user.id, email: user.email, name: user.name, title: user.title,
        role: user.role, clientId: user.client_id, clientName: user.client_name,
      },
    });
  } catch (err) {
    console.error("login failed", err);
    return res.status(500).json({ error: "Sign-in is unavailable right now." });
  }
}
