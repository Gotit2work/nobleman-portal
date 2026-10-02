import { SignJWT, jwtVerify } from "jose";
import { randomInt } from "node:crypto";
import { sql, ready } from "./_db.js";
import { capsOf, ALL_CAPS } from "./_caps.js";

const COOKIE = "np_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

/**
 * PORTAL_MODE=demo shows the public sample portal at / to anyone who isn't signed in (the sample is always at
 * /demo as well). It is an explicit server setting, never a fallback: with it unset, / asks everyone to sign in.
 */
export const DEMO_MODE = process.env.PORTAL_MODE === "demo";

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

export async function signSession(user) {
  return new SignJWT({ sub: user.id, sv: user.session_version || 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + MAX_AGE)
    .sign(secret());
}

export function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", [`${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`]);
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", [`${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`]);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1));
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
    select u.id, u.email, u.name, u.title, u.role, u.client_id, u.must_change_password, u.session_version,
           u.notify_email, c.name as client_name
    from users u left join clients c on c.id = u.client_id
    where u.id = ${c.sub} limit 1`;
  const u = rows[0];
  if (!u || (u.session_version || 1) !== (c.sv || 1)) return null;
  return u;
}

/** Public shape of a user for the page. */
export const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, title: u.title || "", role: u.role,
  clientId: u.client_id || null, clientName: u.client_name || null,
  mustChangePassword: !!u.must_change_password, notifyEmail: u.notify_email !== false,
});

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
    res.status(401).json({ error: "You’re signed out. Sign in again to continue." });
    return null;
  }
  if (u.must_change_password && !opts.allowMustChange) {
    res.status(403).json({ error: "Choose a new password first.", mustChangePassword: true });
    return null;
  }
  return u;
}

/** Guard for admin-only routes. */
export async function requireAdmin(req, res) {
  const u = await requireUser(req, res);
  if (!u) return null;
  if (u.role !== "admin") {
    res.status(403).json({ error: "Only Nobleman staff can do that." });
    return null;
  }
  return u;
}

/**
 * A project this person may see, with its effective capabilities, or null. Clients only ever reach their own
 * client's active projects; admins reach every project (and have every capability).
 */
export async function projectFor(user, projectId) {
  if (!isUuid(projectId)) return null;
  const rows = await sql`
    select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id
    where p.id = ${projectId} limit 1`;
  const p = rows[0];
  if (!p) return null;
  if (user.role !== "admin" && (p.client_id !== user.client_id || p.archived)) return null;
  p.caps = user.role === "admin" ? { ...ALL_CAPS } : capsOf(p.capabilities);
  p.clientCaps = capsOf(p.capabilities);
  return p;
}

/**
 * A temporary password an admin can read out or paste: three groups of four, no look-alike characters
 * (about 60 bits). The person must replace it the first time they sign in.
 */
export function tempPassword() {
  const A = "abcdefghjkmnpqrstuvwxyz23456789";
  const g = () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join("");
  return `${g()}-${g()}-${g()}`;
}

export const MIN_PASSWORD = 10;
