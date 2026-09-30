import bcrypt from "bcryptjs";
import { sql } from "./_db.js";
import { signSession, setSessionCookie, readBody, rejectCrossOrigin } from "./_auth.js";

// A real cost-10 bcrypt hash of a random string nobody knows. Unknown emails are compared against it so they
// take as long as known ones and response timing does not reveal which emails have accounts.
// (It must be a well-formed 60-character hash: bcrypt returns instantly on a malformed one.)
const DUMMY_HASH = "$2a$10$4.Uq6Yq0zEfHgAc1yFLAW.Qj5I/7AV/j9EzAe9VoE1rvjhSr80DKS";

// Failed attempts allowed inside the window before sign-in is paused.
const MAX_FAILS_PER_EMAIL = 8;
const MAX_FAILS_PER_IP = 30;
const WINDOW_MINUTES = 15;

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0];
  return String(req.headers["x-real-ip"] || fwd || "").trim() || "unknown";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (rejectCrossOrigin(req, res)) return;

  const b = readBody(req, res);
  if (!b) return;
  const email = String(b.email || "").trim().toLowerCase().slice(0, 320);
  const password = String(b.password || "");
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  const ip = clientIp(req);

  // Throttle password guessing. If the table is missing (schema.sql not re-run), log loudly and carry on
  // rather than locking everyone out of the portal.
  try {
    const [r] = await sql`
      select count(*) filter (where email = ${email})::int as by_email,
             count(*) filter (where ip = ${ip})::int as by_ip
      from login_attempts
      where at > now() - make_interval(mins => ${WINDOW_MINUTES}) and (email = ${email} or ip = ${ip})`;
    if (r.by_email >= MAX_FAILS_PER_EMAIL || r.by_ip >= MAX_FAILS_PER_IP) {
      res.setHeader("Retry-After", String(WINDOW_MINUTES * 60));
      return res.status(429).json({ error: `Too many attempts. Wait ${WINDOW_MINUTES} minutes and try again.` });
    }
  } catch (err) {
    console.error("login throttle unavailable — run schema.sql to create login_attempts", err);
  }

  try {
    const rows = await sql`
      select u.id, u.email, u.name, u.title, u.role, u.client_id, u.password_hash, c.name as client_name
      from users u left join clients c on c.id = u.client_id
      where u.email = ${email} limit 1`;

    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      await sql`
        with pruned as (delete from login_attempts where at < now() - interval '1 day')
        insert into login_attempts (email, ip) values (${email}, ${ip})`.catch((err) => console.error("could not record failed login", err));
      return res.status(401).json({ error: "That email and password do not match." });
    }

    await sql`update users set last_login_at = now() where id = ${user.id}`;
    await sql`delete from login_attempts where email = ${email}`.catch(() => {});
    setSessionCookie(res, await signSession(user));

    return res.status(200).json({
      user: {
        id: user.id, email: user.email, name: user.name, title: user.title,
        role: user.role, clientId: user.client_id, clientName: user.client_name,
      },
    });
  } catch (err) {
    console.error("login failed", err);
    return res.status(500).json({ error: "Sign-in isn’t working right now. Try again in a few minutes, or email alexis@gotit2work.com." });
  }
}
