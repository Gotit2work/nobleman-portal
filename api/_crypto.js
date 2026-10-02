// Small crypto helpers, all on Node's built-in crypto (no dependencies):
//   - seal()/open(): AES-256-GCM for credentials kept in the database (connections.secret, users.totp_secret).
//     The key comes from PORTAL_ENCRYPTION_KEY if set, otherwise from SESSION_SECRET (HKDF, its own label).
//     Changing the key makes stored credentials unreadable: reconnect them in Studio → Connections.
//   - randomToken()/hashToken(): one-time links and share links. Only hashes are stored.
//   - TOTP (RFC 6238): the six-digit codes authenticator apps show, for two-step sign-in.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

let key = null;
function aesKey() {
  if (key) return key;
  const ikm = process.env.PORTAL_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!ikm || ikm.length < 32) throw new Error("SESSION_SECRET (or PORTAL_ENCRYPTION_KEY) must be at least 32 characters");
  key = Buffer.from(hkdfSync("sha256", ikm, "nobleman-portal", "stored-credentials-v1", 32));
  return key;
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");

/** Encrypts any JSON value. The result is a string safe to store in a text column. */
export function seal(value) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", aesKey(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return "v1." + b64u(Buffer.concat([iv, c.getAuthTag(), data]));
}

/** Decrypts what seal() made. Returns null if it can't (wrong key, tampered, empty). */
export function open(sealed) {
  if (!sealed || typeof sealed !== "string" || !sealed.startsWith("v1.")) return null;
  try {
    const raw = Buffer.from(sealed.slice(3), "base64url");
    const d = createDecipheriv("aes-256-gcm", aesKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

/** A URL-safe random token (32 bytes = 256 bits by default). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** SHA-256 hex of a token: what the database stores and looks up. */
export const hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");

/** Constant-time comparison of two strings of any length. */
export const sameText = (a, b) =>
  timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest());

// ---------- TOTP ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new authenticator secret (160 bits, base32 as apps expect). */
export const totpSecret = () => base32(randomBytes(20));

/** The six-digit code for a 30-second step. Exported for tests. */
export function totpCode(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}

export const totpStep = (ms = Date.now()) => Math.floor(ms / 30000);

/**
 * Checks a code against the current step and one either side (clock drift). Returns the matching step, which
 * must be stored and must be greater than lastStep, so a code works once. Returns null when it doesn't match.
 */
export function verifyTotp(secret, code, lastStep = 0) {
  const c = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const now = totpStep();
  for (const s of [now, now - 1, now + 1]) {
    if (s > lastStep && sameText(totpCode(secret, s), c)) return s;
  }
  return null;
}

/** otpauth:// link that authenticator apps read from a QR code. */
export function totpUri(secret, account, issuer) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Ten recovery codes like "k7qp-2mxd", returned in plain text once; store hashToken() of each. */
export function recoveryCodes(n = 10) {
  const A = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => A[x % A.length]).join("");
    return s.slice(0, 4) + "-" + s.slice(4, 8);
  });
}
