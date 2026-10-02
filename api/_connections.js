// Accounts the portal talks to, added in Studio → Connections: video sources (Vimeo, Frame.io, YouTube,
// Wistia, video links), Notion, and email (Resend). Credentials are encrypted in the database (_crypto.js) and
// only ever decrypted on the server, for the call that needs them. The page never receives them.
//
// Two connections can also come from Vercel environment variables, for setups that predate Studio:
//   VIMEO_ACCESS_TOKEN (+ VIMEO_USER_ID)      → "env-vimeo"
//   RESEND_API_KEY + PORTAL_EMAIL_FROM         → "env-resend"
// They appear in Studio marked "from Vercel settings" and can't be edited there.
import { sql } from "./_db.js";
import { seal, open } from "./_crypto.js";

export const ENV_VIMEO = "env-vimeo";
export const ENV_RESEND = "env-resend";

function envConnections() {
  const out = [];
  if (process.env.VIMEO_ACCESS_TOKEN) {
    out.push({
      id: ENV_VIMEO, provider: "vimeo", name: "Vimeo", env: true, status: "ok", lastError: null, checked: null,
      config: {}, creds: { token: process.env.VIMEO_ACCESS_TOKEN, userId: process.env.VIMEO_USER_ID || "" },
    });
  }
  if (process.env.RESEND_API_KEY && process.env.PORTAL_EMAIL_FROM) {
    out.push({
      id: ENV_RESEND, provider: "resend", name: "Email (Resend)", env: true, status: "ok", lastError: null, checked: null,
      config: { from: process.env.PORTAL_EMAIL_FROM }, creds: { apiKey: process.env.RESEND_API_KEY },
    });
  }
  return out;
}

const iso = (d) => (d ? new Date(d).toISOString() : null);
const rowOut = (r, withCreds) => ({
  id: r.id, provider: r.provider, name: r.name, env: false, status: r.status, lastError: r.last_error || null,
  checked: iso(r.checked_at), config: r.config || {}, ...(withCreds ? { creds: open(r.secret) || {} } : {}),
});

const CACHE_MS = 10000;
let cache = null;

/** Every connection. withCreds adds the decrypted credentials (server use only). */
export async function listConnections({ withCreds = false } = {}) {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const rows = await sql`select * from connections order by provider, created_at`;
    cache = { at: Date.now(), rows };
  }
  const db = cache.rows.map((r) => rowOut(r, withCreds));
  const env = envConnections().map((c) => (withCreds ? c : { ...c, creds: undefined }));
  return [...db, ...env];
}

export const forgetConnections = () => { cache = null; };

/** One connection with its credentials, or null. */
export async function getConnection(id) {
  if (!id) return null;
  const all = await listConnections({ withCreds: true });
  return all.find((c) => c.id === id) || null;
}

/** The first connection for a provider (email and Notion use at most one). */
export async function firstOf(provider) {
  const all = await listConnections({ withCreds: true });
  return all.find((c) => c.provider === provider) || null;
}

export async function createConnection({ provider, name, creds, config = {} }) {
  const [r] = await sql`
    insert into connections (provider, name, secret, config, status, checked_at)
    values (${provider}, ${name}, ${seal(creds || {})}, ${JSON.stringify(config)}::jsonb, 'ok', now())
    returning id`;
  forgetConnections();
  return r.id;
}

/** Updates any of name, creds (replaced whole), config (merged), status. */
export async function updateConnection(id, { name, creds, config, status, lastError } = {}) {
  const cur = (await sql`select * from connections where id = ${id}`)[0];
  if (!cur) return false;
  await sql`
    update connections set
      name = ${name === undefined ? cur.name : name},
      secret = ${creds === undefined ? cur.secret : seal(creds)},
      config = ${JSON.stringify(config === undefined ? cur.config : { ...(cur.config || {}), ...config })}::jsonb,
      status = ${status === undefined ? cur.status : status},
      last_error = ${lastError === undefined ? cur.last_error : lastError},
      checked_at = ${status === undefined ? cur.checked_at : new Date()},
      updated_at = now()
    where id = ${id}`;
  forgetConnections();
  return true;
}

export async function deleteConnection(id) {
  await sql`delete from connections where id = ${id}`;
  forgetConnections();
}

/** Records how the last call to a connection went, so Studio can show problems. Never throws. */
export async function markConnection(id, ok, error) {
  if (!id || String(id).startsWith("env-")) return;
  try {
    await sql`update connections set status = ${ok ? "ok" : "error"}, last_error = ${ok ? null : String(error || "").slice(0, 300)},
              checked_at = now() where id = ${id} and (status <> ${ok ? "ok" : "error"} or ${!ok})`;
    forgetConnections();
  } catch { /* status is a nicety */ }
}
