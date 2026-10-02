import { ready, dbConfigured } from "./_db.js";
import { requireStaff, signState, readState, currentUser } from "./_auth.js";
import { getConnection, updateConnection } from "./_connections.js";
import { IMS, OAUTH_SCOPES, exchangeCode, test } from "./_providers/frameio.js";
import { originOf } from "./_notify.js";
import { randomToken } from "./_crypto.js";
import { audit } from "./_audit.js";
import { can } from "./_roles.js";
import { getSettings } from "./_settings.js";

/**
 * "Sign in with Adobe" for a Frame.io connection (Studio → Connections).
 *   GET /api/connect?start=<connection>   sends the staff member to Adobe's login
 *   GET /api/connect?code=…&state=…       Adobe sends them back here; the portal stores the tokens (encrypted)
 * The redirect URI to register in the Adobe Developer Console is https://<portal>/api/connect.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const q = req.query || {};
  const back = (msg, id) => {
    res.statusCode = 302;
    res.setHeader("Location", `/studio/connections?${id ? "connected=" + encodeURIComponent(id) + "&" : ""}${msg ? "message=" + encodeURIComponent(msg) : ""}`);
    return res.end();
  };
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
