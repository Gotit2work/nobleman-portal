import { SignJWT, jwtVerify } from "jose";

const COOKIE = "np_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(s);
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

/** Returns the JWT claims, or null when there is no valid session. */
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

/** Guard for routes any signed-in user may call. Returns claims or ends the response. */
export async function requireUser(req, res) {
  const s = await session(req);
  if (!s) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }
  return s;
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
