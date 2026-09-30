import bcrypt from "bcryptjs";
import { sql } from "../_db.js";
import { requireAdmin, readBody, isUuid } from "../_auth.js";

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === "GET") {
    try {
      const rows = await sql`
        select u.id, u.email, u.name, u.title, u.role, u.client_id, u.last_login_at, c.name as client_name
        from users u left join clients c on c.id = u.client_id
        order by u.role, u.name`;
      return res.status(200).json({ users: rows });
    } catch (err) {
      console.error("list users failed", err);
      return res.status(500).json({ error: "Could not load users." });
    }
  }

  if (req.method === "POST") {
    const b = readBody(req, res);
    if (!b) return;
    const name = String(b.name || "").trim();
    const email = String(b.email || "").trim().toLowerCase();
    const title = String(b.title || "").trim() || null;
    const role = b.role === "admin" ? "admin" : "client";
    const password = String(b.password || "");
    const clientId = role === "client" && b.clientId ? String(b.clientId) : null;
    const clientName = String(b.clientName || "").trim();

    if (!name || !email) return res.status(400).json({ error: "Name and email are required." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "That email address looks wrong." });
    if (password.length < 10) return res.status(400).json({ error: "Password must be at least 10 characters." });
    if (clientId && !isUuid(clientId)) return res.status(400).json({ error: "That client id is not valid." });
    if (role === "client" && !clientId && !clientName) {
      return res.status(400).json({ error: "Pick an existing client or give a new client name." });
    }

    try {
      const hash = await bcrypt.hash(password, 10);
      const makeClient = role === "client" && !clientId;
      // One statement, so a failure (duplicate email, bad client) leaves no orphaned client row behind.
      const rows = await sql`
        with new_client as (
          insert into clients (name) select ${clientName} where ${makeClient}::boolean
          returning id
        )
        insert into users (email, name, title, role, client_id, password_hash)
        values (${email}, ${name}, ${title}, ${role}, coalesce(${clientId}::uuid, (select id from new_client)), ${hash})
        returning id, email, name, title, role, client_id`;

      return res.status(201).json({ user: rows[0] });
    } catch (err) {
      const msg = String(err.message || "");
      if (msg.includes("users_email_key")) return res.status(409).json({ error: "That email already has an account." });
      if (msg.includes("users_client_id_fkey")) return res.status(400).json({ error: "That client does not exist." });
      console.error("create user failed", err);
      return res.status(500).json({ error: "Could not create that account." });
    }
  }

  if (req.method === "DELETE") {
    const b = readBody(req, res);
    if (!b) return;
    const id = String(b.id || "");
    if (!id) return res.status(400).json({ error: "Which user?" });
    if (!isUuid(id)) return res.status(400).json({ error: "That user id is not valid." });
    if (id === admin.sub) return res.status(400).json({ error: "You cannot remove your own account." });
    try {
      const gone = await sql`delete from users where id = ${id} returning id`;
      if (!gone.length) return res.status(404).json({ error: "No such user." });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("delete user failed", err);
      return res.status(500).json({ error: "Could not remove that account." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
