import { SignJWT, jwtVerify } from "jose";
import { sql } from "./_db.js";

const COOKIE = "np_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

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
  return new SignJWT({ sub: user.id, role: user.role, cid: user.client_id || null })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + MAX_AGE)
    .sign(secret());
}

export function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", [
    `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`,
  ]);
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

/** Returns the JWT claims, or null when there is no valid session. Checks signature and expiry only. */
export async function session(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload;
  } catch {
    return null;
  }
}

/**
 * Guard for routes any signed-in user may call. Returns { sub, role, cid } or ends the response.
 * The account is re-read from the database on every call, so removing someone or changing their role
 * takes effect immediately instead of when their 7-day cookie runs out.
 */
export async function requireUser(req, res) {
  if (rejectCrossOrigin(req, res)) return null;
  const s = await session(req);
  if (!s || !isUuid(s.sub)) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }
  let rows;
  try {
    rows = await sql`select id, role, client_id from users where id = ${s.sub} limit 1`;
  } catch (err) {
    console.error("session lookup failed", err);
    res.status(500).json({ error: "The portal is having trouble. Try again in a moment." });
    return null;
  }
  const u = rows[0];
  if (!u) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Not signed in" });
    return null;
  }
  return { sub: u.id, role: u.role, cid: u.client_id };
}

/** Guard for admin-only routes. */
export async function requireAdmin(req, res) {
  const s = await requireUser(req, res);
  if (!s) return null;
  if (s.role !== "admin") {
    res.status(403).json({ error: "Admins only" });
    return null;
  }
  return s;
}
