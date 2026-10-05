import { ready, dbConfigured } from "./_db.js";
import { requireStaff, signState, readState, currentUser } from "./_auth.js";
import { getConnection, updateConnection } from "./_connections.js";
import { IMS, OAUTH_SCOPES, exchangeCode, test } from "./_providers/frameio.js";
import { originOf } from "./_notify.js";
import { randomToken } from "./_crypto.js";
import { audit } from "./_audit.js";
import { can } from "./_roles.js";
import { getSettings } from "./_settings.js";
import { stripeConnection, verifySignature, settle, failed, refunded, announce } from "./_payments.js";
import { verifyFrameio, handleEvent } from "./_fio_sync.js";
import { later } from "./_later.js";

/**
 * "Sign in with Adobe" for a Frame.io connection (Studio → Connections).
 *   GET /api/connect?start=<connection>   sends the staff member to Adobe's login
 *   GET /api/connect?code=…&state=…       Adobe sends them back here; the portal stores the tokens (encrypted)
 * The redirect URI to register in the Adobe Developer Console is https://<portal>/api/connect.
 *
 * Also Stripe's webhook (Studio → Connections → Payments):
 *   POST /api/connect?webhook=stripe        signed with the connection's webhook secret; marks payments paid
 * And Frame.io's (Studio → Connections → Frame.io → Live updates, _fio_sync.js):
 *   POST /api/connect?webhook=frameio&c=<connection>   signed per workspace; new comments and versions, straight away
 */
// The webhooks' signatures cover the body's exact bytes, so Vercel mustn't parse it first (nothing here reads req.body).
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const q = req.query || {};
  const back = (msg, id) => {
    res.statusCode = 302;
    res.setHeader("Location", `/studio/connections?${id ? "connected=" + encodeURIComponent(id) + "&" : ""}${msg ? "message=" + encodeURIComponent(msg) : ""}`);
    return res.end();
  };
  if (req.method === "POST" && q.webhook === "stripe") return stripeWebhook(req, res);
  if (req.method === "POST" && q.webhook === "frameio") return frameioWebhook(req, res, String(q.c || ""));
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!dbConfigured()) return back("The portal isn’t connected to its database yet.");
  await ready();
  const redirectUri = originOf(req) + "/api/connect";

  if (q.start) {
    const u = await requireStaff(req, res, "connections.manage");
    if (!u) return;
    const conn = await getConnection(String(q.start));
    if (!conn || conn.provider !== "frameio" || conn.creds.auth !== "oauth") return back("That Frame.io connection doesn’t use Adobe sign-in.");
    const state = await signState({ c: conn.id, u: u.id, n: randomToken(8) });
    const url = new URL(`${IMS}/authorize/v2`);
    url.search = new URLSearchParams({ client_id: conn.creds.clientId, redirect_uri: redirectUri, scope: OAUTH_SCOPES, response_type: "code", state }).toString();
    res.statusCode = 302;
    res.setHeader("Location", url.toString());
    return res.end();
  }

  const st = await readState(q.state);
  if (!st) return back("The sign-in took too long or didn’t come from this portal. Try again.");
  const u = await currentUser(req).catch(() => null);
  if (!u || u.id !== st.u || !can(u, "connections.manage", await getSettings())) return back("Log in to the portal as the person who started this, then try again.");
  if (q.error) return back(`Adobe said: ${String(q.error_description || q.error).slice(0, 200)}`);
  const conn = await getConnection(st.c);
  if (!conn || conn.provider !== "frameio") return back("That Frame.io connection was removed.");
  try {
    const creds = await exchangeCode(conn, String(q.code || ""), redirectUri);
    await updateConnection(conn.id, { creds, status: "ok", lastError: null });
    const fresh = await getConnection(conn.id);
    const t = await test(fresh);
    if (t.configPatch) await updateConnection(conn.id, { config: t.configPatch });
    await updateConnection(conn.id, { config: { account: t.account ? t.account.name : "" } });
    await audit(req, u, "connection.signin", "Signed Frame.io in with Adobe");
    return back(t.configPatch || (fresh.config && fresh.config.accountId) ? "Frame.io is connected." : "Signed in. Now choose which Frame.io account to use.", conn.id);
  } catch (err) {
    console.error("frame.io sign-in failed", err.message);
    await updateConnection(conn.id, { status: "error", lastError: err.message.slice(0, 300) });
    return back(`Adobe sign-in didn’t finish: ${err.message.slice(0, 200)}`);
  }
}

/** The request body exactly as Stripe sent it: the signature covers these bytes, so a re-encoded body won't do. */
async function rawBody(req) {
  if (req.rawBody) return Buffer.from(req.rawBody);
  const chunks = [];
  try { for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } catch { /* already read */ }
  return chunks.length ? Buffer.concat(chunks) : null;
}

/**
 * Frame.io tells the portal about new comments and versions. Anything unsigned, signed with another secret, or more
 * than five minutes old is refused. The work happens after the answer, so Frame.io never waits (it allows 5 seconds).
 */
async function frameioWebhook(req, res, connId) {
  if (!dbConfigured()) return res.status(503).json({ error: "No database." });
  await ready();
  const conn = await getConnection(connId).catch(() => null);
  const secrets = conn && conn.provider === "frameio" ? Object.values((conn.creds && conn.creds.webhooks) || {}).map((h) => h.secret).filter(Boolean) : [];
  if (!secrets.length) return res.status(404).json({ error: "Live updates aren’t on for that connection." });
  const raw = await rawBody(req);
  if (!raw || !verifyFrameio(raw, req.headers["x-frameio-request-timestamp"], req.headers["x-frameio-signature"], secrets)) {
    console.error("frame.io webhook: signature didn’t match");
    return res.status(401).json({ error: "Signature didn’t match." });
  }
  let evt;
  try { evt = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "Not JSON." }); }
  const origin = originOf(req);
  await later(() => handleEvent(conn, evt, origin), "frame.io event");
  return res.status(200).json({ received: true });
}

/**
 * Stripe tells the portal when a checkout is paid, when a bank payment clears or fails, and when a charge is
 * refunded. Anything unsigned, or signed with another secret, is refused. Answers 200 to events it doesn't use, so
 * Stripe doesn't retry them.
 */
async function stripeWebhook(req, res) {
  if (!dbConfigured()) return res.status(503).json({ error: "No database." });
  await ready();
  const conn = await stripeConnection();
  if (!conn || !conn.creds.webhookSecret) return res.status(404).json({ error: "Payments aren’t set up for webhooks here." });
  const raw = await rawBody(req);
  if (!raw || !verifySignature(raw, req.headers["stripe-signature"], conn.creds.webhookSecret)) {
    console.error("stripe webhook: signature didn’t match");
    return res.status(400).json({ error: "Signature didn’t match." });
  }
  let evt;
  try { evt = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "Not JSON." }); }
  const obj = (evt.data && evt.data.object) || {};
  const origin = originOf(req);
  try {
    let t = null;
    if (evt.type === "checkout.session.completed" || evt.type === "checkout.session.async_payment_succeeded") t = await settle(obj);
    else if (evt.type === "checkout.session.async_payment_failed") t = await failed(obj);
    else if (evt.type === "charge.refunded") t = await refunded(obj);
    if (t) await announce(t, { req, origin });
    return res.status(200).json({ received: true, changed: t ? t.change : null });
  } catch (err) {
    console.error("stripe webhook failed", evt.type, err.message);
    return res.status(500).json({ error: "Try again." });
  }
}
