import { SignJWT, jwtVerify } from "jose";
import { sql, ready } from "./_db.js";
import { capsOf } from "./_caps.js";
import { getSettings } from "./_settings.js";
import { effectiveCaps, isStaff, can, accessOf } from "./_roles.js";

const COOKIE = "np_session";
const DEFAULT_DAYS = 7;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

export const TROUBLE = "The portal is having trouble. Try again in a moment, or email alexis@gotit2work.com.";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(s);
}

/** Parses the JSON body. Returns null (after answering 400) when it is not valid JSON. */
export function readBody(req, res) {
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    return b && typeof b === "object" ? b : {};
  } catch {
    res.status(400).json({ error: "That request was not readable." });
    return null;
  }
}

/** Trimmed single-line text, capped. */
export const text = (v, max = 200) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
/** Trimmed multi-line text, capped. */
export const longText = (v, max = 5000) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, "").trim().slice(0, max);

/**
 * Refuses state-changing requests a browser sends from another origin. Browsers always attach Origin to
 * cross-origin POST/DELETE, and SameSite=Lax does not cover this case because every *.gotit2work.com host
 * counts as the same site. Requests without Origin (curl, server to server) are allowed.
 * Returns true when it has already answered 403.
 */
export function rejectCrossOrigin(req, res) {
  if (req.method === "GET" || req.method === "HEAD") return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  let ok = false;
  try { ok = new URL(origin).host === host; } catch { ok = false; }
  if (!ok) res.status(403).json({ error: "Cross-origin request refused." });
  return !ok;
}

/** How long a login lasts, in seconds (Studio → Settings → Security, 1 to 30 days). */
async function maxAge() {
  try {
    const d = Number((await getSettings()).security.sessionDays) || DEFAULT_DAYS;
    return Math.max(1, Math.min(30, d)) * 86400;
  } catch { return DEFAULT_DAYS * 86400; }
}

export async function signSession(user) {
  const age = await maxAge();
  return new SignJWT({ sub: user.id, sv: user.session_version || 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + age)
    .sign(secret());
}

/** A short-lived ticket between a correct password (or link) and the two-step code. Not a session. */
export async function signTicket(user, purpose = "two-step") {
  return new SignJWT({ sub: user.id, sv: user.session_version || 1, pur: purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 5 * 60)
    .sign(secret());
}

/** The user id a ticket is for, or null when it's invalid, expired, or for another purpose. */
export async function readTicket(token, purpose = "two-step") {
  try {
    const { payload } = await jwtVerify(String(token || ""), secret());
    return payload.pur === purpose && isUuid(payload.sub) ? payload : null;
  } catch { return null; }
}

/** Signs a short-lived value with the session key (OAuth state). */
export async function signState(value, minutes = 10) {
  return new SignJWT({ v: value })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + minutes * 60)
    .sign(secret());
}
export async function readState(token) {
  try { return (await jwtVerify(String(token || ""), secret())).payload.v; } catch { return null; }
}

export async function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", [`${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${await maxAge()}`]);
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", [`${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`]);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1)); } catch { return null; } }   // garbled: logged out, not an error
  }
  return null;
}

/** The JWT claims, or null when there is no valid session. Signature and expiry only. */
async function claims(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return isUuid(payload.sub) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * The signed-in person, re-read from the database (so removal, role changes, and password resets take effect
 * immediately), or null. Throws if the database is unreachable.
 */
export async function currentUser(req) {
  const c = await claims(req);
  if (!c) return null;
  await ready();
  const rows = await sql`
    select u.id, u.email, u.name, u.title, u.role, u.access, u.client_id, u.all_projects, u.must_change_password, u.session_version,
           u.notify_email, u.totp_enabled, u.welcomed_at, u.last_seen_at, c.name as client_name, c.logo_url as client_logo
    from users u left join clients c on c.id = u.client_id
    where u.id = ${c.sub} limit 1`;
  const u = rows[0];
  if (!u || (u.session_version || 1) !== (c.sv || 1)) return null;
  return u;
}

/** Public shape of a user for the page. */
export const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, title: u.title || "", role: u.role, access: accessOf(u),
  clientId: u.client_id || null, clientName: u.client_name || null, clientLogo: u.client_logo || null,
  mustChangePassword: !!u.must_change_password, notifyEmail: u.notify_email !== false, twoStep: !!u.totp_enabled,
  allProjects: u.role !== "client" || u.all_projects !== false,
});

/** Staff who must use two-step verification (Studio → Settings → Security) but haven't turned it on yet. */
export async function needsTwoStepSetup(u) {
  if (!isStaff(u) || u.totp_enabled) return false;
  try { return !!(await getSettings()).security.staffTwoStep; } catch { return false; }
}

/**
 * Guard for routes any signed-in person may call. Returns the user row or ends the response. Someone who must
 * choose a new password can only do that (pass { allowMustChange: true } on the routes that allow it).
 */
export async function requireUser(req, res, opts = {}) {
  if (rejectCrossOrigin(req, res)) return null;
  let u;
  try {
    u = await currentUser(req);
  } catch (err) {
    console.error("session lookup failed", err);
    res.status(500).json({ error: TROUBLE });
    return null;
  }
  if (!u) {
    if (readCookie(req, COOKIE)) clearSessionCookie(res);
    res.status(401).json({ error: "You’re logged out. Log in again to continue." });
    return null;
  }
  if (u.must_change_password && !opts.allowMustChange) {
    res.status(403).json({ error: "Choose a new password first.", mustChangePassword: true });
    return null;
  }
  if (!opts.allowTwoStepSetup && (await needsTwoStepSetup(u))) {
    res.status(403).json({ error: "Turn on two-step verification first (your account page).", needsTwoStep: true });
    return null;
  }
  return u;
}

/** Guard for staff routes. With a permission, the person's role must allow it (_roles.js). */
export async function requireStaff(req, res, perm) {
  const u = await requireUser(req, res);
  if (!u) return null;
  if (!isStaff(u)) {
    res.status(403).json({ error: "Only studio staff can do that." });
    return null;
  }
  if (perm && !can(u, perm, await getSettings())) {
    res.status(403).json({ error: "Your role doesn’t allow that. Ask an owner." });
    return null;
  }
  return u;
}
export const requireAdmin = (req, res) => requireStaff(req, res);

/**
 * Whether a client may see a project: an active one of their company (unless they see only the projects they
 * joined by link, all_projects = false), or one they joined (project_people), whichever company it belongs to.
 */
export async function clientMaySee(user, p) {
  if (!p || p.archived) return false;
  if (p.client_id === user.client_id && user.all_projects !== false) return true;
  return !!(await sql`select 1 from project_people where project_id = ${p.id} and user_id = ${user.id}`)[0];
}

/**
 * A project this person may see, with its effective capabilities, or null. Clients reach only what
 * clientMaySee allows; staff reach every project (and have every capability).
 */
export async function projectFor(user, projectId) {
  if (!isUuid(projectId)) return null;
  const rows = await sql`
    select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id
    where p.id = ${projectId} limit 1`;
  const p = rows[0];
  if (!p) return null;
  if (!isStaff(user) && !(await clientMaySee(user, p))) return null;
  p.clientCaps = capsOf(p.capabilities);
  p.caps = effectiveCaps(user, p.clientCaps, await getSettings());
  return p;
}

export const MIN_PASSWORD = 10;
