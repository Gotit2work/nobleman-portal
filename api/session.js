import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql, ready, dbConfigured } from "./_db.js";
import {
  DEMO_MODE, TROUBLE, MIN_PASSWORD, readBody, rejectCrossOrigin, currentUser, requireUser, publicUser, text,
  signSession, setSessionCookie, clearSessionCookie,
} from "./_auth.js";
import { emailConfigured } from "./_notify.js";

/**
 * GET  /api/session                       who is signed in, and whether the portal still needs its first admin
 * POST /api/session {action:"login"}      email, password
 * POST /api/session {action:"logout"}
 * POST /api/session {action:"setup"}      code, name, email, password: creates the first admin (once)
 * POST /api/session {action:"password"}   current, next: also how someone replaces a temporary password
 * POST /api/session {action:"profile"}    name, title, notifyEmail
 */

// A real cost-10 bcrypt hash of a random string nobody knows. Unknown emails are compared against it so they
// take as long as known ones and response timing doesn't reveal which emails have accounts. (It must be a
// well-formed 60-character hash: bcrypt returns instantly on a malformed one.)
const DUMMY_HASH = "$2a$10$4.Uq6Yq0zEfHgAc1yFLAW.Qj5I/7AV/j9EzAe9VoE1rvjhSr80DKS";
const MAX_FAILS_PER_EMAIL = 8;
const MAX_FAILS_PER_IP = 30;
const WINDOW_MINUTES = 15;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const sameSecret = (a, b) =>
  timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest());

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0];
  return String(req.headers["x-real-ip"] || fwd || "").trim() || "unknown";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method === "GET") return status(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (rejectCrossOrigin(req, res)) return;
  const b = readBody(req, res);
  if (!b) return;
  switch (b.action) {
    case "login": return login(req, res, b);
    case "logout": clearSessionCookie(res); return res.status(200).json({ ok: true });
    case "setup": return setup(req, res, b);
    case "password": return password(req, res, b);
    case "profile": return profile(req, res, b);
    default: return res.status(400).json({ error: "Unknown action." });
  }
}

async function status(req, res) {
  const base = { demoAtRoot: DEMO_MODE, email: emailConfigured() };
  if (!dbConfigured()) return res.status(200).json({ ...base, user: null, db: false, setup: false });
  try {
    await ready();
    const user = await currentUser(req);
    if (user) return res.status(200).json({ ...base, db: true, setup: false, user: publicUser(user) });
    const admins = await sql`select 1 from users where role = 'admin' limit 1`;
    return res.status(200).json({
      ...base, db: true, user: null,
      setup: admins.length === 0,
      setupReady: !!process.env.BOOTSTRAP_SECRET,
    });
  } catch (err) {
    console.error("session status failed", err);
    return res.status(500).json({ ...base, error: TROUBLE });
  }
}

async function login(req, res, b) {
  const email = String(b.email || "").trim().toLowerCase().slice(0, 320);
  const pass = String(b.password || "");
  if (!email || !pass) return res.status(400).json({ error: "Enter your email and password." });
  const ip = clientIp(req);
  try {
    await ready();
    const [r] = await sql`
      select count(*) filter (where email = ${email})::int as by_email,
             count(*) filter (where ip = ${ip})::int as by_ip
      from login_attempts
      where at > now() - make_interval(mins => ${WINDOW_MINUTES}) and (email = ${email} or ip = ${ip})`;
    if (r.by_email >= MAX_FAILS_PER_EMAIL || r.by_ip >= MAX_FAILS_PER_IP) {
      res.setHeader("Retry-After", String(WINDOW_MINUTES * 60));
      return res.status(429).json({ error: `Too many tries. Wait ${WINDOW_MINUTES} minutes, then try again.` });
    }
    const rows = await sql`
      select u.*, c.name as client_name from users u left join clients c on c.id = u.client_id
      where u.email = ${email} limit 1`;
    const user = rows[0];
    const ok = await bcrypt.compare(pass, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      await sql`
        with pruned as (delete from login_attempts where at < now() - interval '1 day')
        insert into login_attempts (email, ip) values (${email}, ${ip})`.catch((err) => console.error("could not record failed login", err));
      return res.status(401).json({ error: "That email and password don’t match. Check both, or ask Nobleman to reset your password." });
    }
    await sql`update users set last_login_at = now() where id = ${user.id}`;
    await sql`delete from login_attempts where email = ${email}`.catch(() => {});
    setSessionCookie(res, await signSession(user));
    return res.status(200).json({ user: publicUser(user) });
  } catch (err) {
    console.error("login failed", err);
    return res.status(500).json({ error: "Sign-in isn’t working right now. Try again in a few minutes, or email alexis@gotit2work.com." });
  }
}

async function setup(req, res, b) {
  const expected = process.env.BOOTSTRAP_SECRET;
  if (!expected) return res.status(409).json({ error: "Setup isn’t switched on. Add BOOTSTRAP_SECRET in Vercel and redeploy (README, “First admin”)." });
  if (!sameSecret(b.code || "", expected)) return res.status(403).json({ error: "That setup code isn’t right." });
  const name = text(b.name, 100);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 320);
  const pass = String(b.password || "");
  if (!name || !EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter your name and a valid email." });
  if (pass.length < MIN_PASSWORD) return res.status(400).json({ error: `Choose a password of at least ${MIN_PASSWORD} characters.` });
  try {
    await ready();
    const hash = await bcrypt.hash(pass, 10);
    // One statement: insert only if there is still no admin, so two people racing can't both win.
    const rows = await sql`
      insert into users (email, name, role, password_hash)
      select ${email}, ${name}, 'admin', ${hash}
      where not exists (select 1 from users where role = 'admin')
      returning *`;
    if (!rows.length) return res.status(409).json({ error: "The portal is already set up. Sign in instead." });
    setSessionCookie(res, await signSession(rows[0]));
    return res.status(201).json({ user: publicUser(rows[0]) });
  } catch (err) {
    console.error("setup failed", err);
    return res.status(500).json({ error: TROUBLE });
  }
}

async function password(req, res, b) {
  const u = await requireUser(req, res, { allowMustChange: true });
  if (!u) return;
  const next = String(b.next || "");
  if (next.length < MIN_PASSWORD) return res.status(400).json({ error: `Choose a password of at least ${MIN_PASSWORD} characters.` });
  try {
    const [row] = await sql`select password_hash from users where id = ${u.id}`;
    // Someone replacing a temporary password has just typed it to sign in, so they aren't asked again.
    if (!u.must_change_password) {
      const ok = await bcrypt.compare(String(b.current || ""), row.password_hash);
      if (!ok) return res.status(400).json({ error: "Your current password isn’t right." });
    }
    if (await bcrypt.compare(next, row.password_hash)) return res.status(400).json({ error: "Choose a password you haven’t used here before." });
    const hash = await bcrypt.hash(next, 10);
    const [updated] = await sql`
      update users set password_hash = ${hash}, must_change_password = false, session_version = session_version + 1
      where id = ${u.id} returning *`;
    // Other sessions stop working (their session version is now stale); this one carries on.
    setSessionCookie(res, await signSession(updated));
    updated.client_name = u.client_name;
    return res.status(200).json({ user: publicUser(updated) });
  } catch (err) {
    console.error("password change failed", err);
    return res.status(500).json({ error: TROUBLE });
  }
}

async function profile(req, res, b) {
  const u = await requireUser(req, res);
  if (!u) return;
  const name = text(b.name, 100);
  if (!name) return res.status(400).json({ error: "Your name can’t be empty." });
  const title = text(b.title, 100) || null;
  const notify = b.notifyEmail === undefined ? u.notify_email : !!b.notifyEmail;
  try {
    const [updated] = await sql`update users set name = ${name}, title = ${title}, notify_email = ${notify} where id = ${u.id} returning *`;
    updated.client_name = u.client_name;
    return res.status(200).json({ user: publicUser(updated) });
  } catch (err) {
    console.error("profile update failed", err);
    return res.status(500).json({ error: TROUBLE });
  }
}
