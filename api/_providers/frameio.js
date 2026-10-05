// Frame.io (V4, Adobe). A project's source is one Frame.io folder (pick a project to use its top folder).
// Version stacks become versions in Review, in stack order; the stack's current version is the newest. Other
// videos split by name like any source ("Title V2" is a version, the rest are finished films).
//
// Three ways to connect, chosen in Studio → Connections:
//   oauth   Adobe sign-in (most accounts). Adobe Developer Console → project → add Frame.io → OAuth Web App
//           credential, redirect URI https://<portal>/api/connect. Then "Sign in with Adobe" in Studio.
//           Adobe's refresh token lasts about 14 days unused; the daily job (api/cron.js) keeps it fresh.
//   s2s     Server-to-server, for accounts managed in the Adobe Admin Console. Client ID and secret only.
//   legacy  A Frame.io developer token, for accounts not yet on Adobe sign-in. Adobe calls these transitional.
//
// Media links (playback, downloads, thumbnails) are signed and can expire within minutes of being issued, so
// playback and downloads are fetched when someone presses play or download, never stored.
import { video, fetchJson } from "../_video.js";
import { updateConnection } from "../_connections.js";

const API = "https://api.frame.io/v4";
export const IMS = "https://ims-na1.adobelogin.com/ims";
export const OAUTH_SCOPES = "openid,email,profile,offline_access,additional_info.roles";
const S2S_SCOPES = "openid,AdobeID,frame.s2s.all";
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map();

export const meta = {
  key: "frameio",
  name: "Frame.io",
  kind: "video",
  blurb: "Plays from a Frame.io folder. Version stacks become versions; downloads of the original and smaller copies.",
  fields: [
    { key: "auth", label: "How it connects", type: "select", options: [
      { value: "oauth", label: "Adobe sign-in (most accounts)" },
      { value: "s2s", label: "Server-to-server (accounts managed in Adobe Admin Console)" },
      { value: "legacy", label: "Legacy developer token" },
    ], help: "If you’re not sure, choose Adobe sign-in." },
    { key: "clientId", label: "Client ID", when: ["oauth", "s2s"], help: "Adobe Developer Console → your project → the Frame.io credential." },
    { key: "clientSecret", label: "Client secret", secret: true, when: ["oauth", "s2s"] },
    { key: "token", label: "Developer token", secret: true, when: ["legacy"], help: "From Frame.io’s developer site. Only for accounts not yet using Adobe sign-in." },
  ],
  source: { label: "Folder", placeholder: "Folder ID", help: "Pick a project to use its top folder, or paste a folder’s ID from its address in Frame.io." },
  features: { downloads: true, captions: false, chapters: false, upload: false, stats: false, notes: true, versions: "Use version stacks: drag the new version onto the old one in Frame.io." },
};

export const needsSignIn = (conn) => conn.creds.auth === "oauth" && !conn.creds.refreshToken;

/** A valid access token, refreshing (and storing the new one) when it's about to run out. */
async function accessToken(conn) {
  const c = conn.creds;
  if (c.auth === "legacy") return c.token;
  if (c.accessToken && c.expiresAt && c.expiresAt > Date.now() + 2 * 60 * 1000) return c.accessToken;
  let body;
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (c.auth === "s2s") {
    body = new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret, scope: S2S_SCOPES });
  } else {
    if (!c.refreshToken) throw Object.assign(new Error("Frame.io needs you to sign in with Adobe (Studio → Connections)."), { status: 401 });
    body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: c.refreshToken });
    headers.Authorization = "Basic " + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
  }
  const d = await fetchJson(`${IMS}/token/v3`, { method: "POST", headers, body: body.toString(), label: "Adobe sign-in" });
  const next = { ...c, accessToken: d.access_token, expiresAt: Date.now() + (Number(d.expires_in) || 3600) * 1000, refreshToken: d.refresh_token || c.refreshToken };
  conn.creds = next;
  if (!conn.env) await updateConnection(conn.id, { creds: next });
  return next.accessToken;
}

/** Exchanges the code Adobe sends back after "Sign in with Adobe" (api/connect.js). */
export async function exchangeCode(conn, code, redirectUri) {
  const c = conn.creds;
  const d = await fetchJson(`${IMS}/token/v3`, {
    method: "POST", label: "Adobe sign-in",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
  });
  if (!d.refresh_token) throw new Error("Adobe didn’t return a refresh token. Check the credential includes offline access.");
  return { ...c, accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
}

async function call(conn, path, params = {}, { method = "GET", body } = {}) {
  const token = await accessToken(conn);
  const url = new URL(path.startsWith("http") ? path : path.startsWith("/v4") ? "https://api.frame.io" + path : API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return fetchJson(url, {
    method, body, label: "Frame.io",
    headers: { Authorization: "Bearer " + token, ...(conn.creds.auth === "legacy" ? { "x-frameio-legacy-token-auth": "true" } : {}) },
  });
}

/** Every item of a paged list (Frame.io pages with links.next). */
async function all(conn, path, params, max = 5) {
  const out = [];
  let next = path, p = { page_size: 100, ...params };
  for (let i = 0; next && i < max; i++) {
    const d = await call(conn, next, p);
    out.push(...(d.data || []));
    next = d.links && d.links.next ? d.links.next : null;
    p = {};
  }
  return out;
}

const account = (conn) => {
  const a = conn.config && conn.config.accountId;
  if (!a) throw Object.assign(new Error("Choose which Frame.io account to use (Studio → Connections)."), { status: 409 });
  return a;
};

export async function test(conn) {
  if (needsSignIn(conn)) return { account: null, needsSignIn: true, notes: ["Next: sign in with Adobe to finish connecting."] };
  const [me, accounts] = await Promise.all([call(conn, "/me"), all(conn, "/accounts", {}, 1)]);
  const list = accounts.map((a) => ({ id: a.id, name: a.display_name || a.name || "Frame.io account" }));
  const chosen = (conn.config && conn.config.accountId) || (list.length === 1 ? list[0].id : null);
  return {
    account: { name: (me.data && (me.data.name || me.data.email)) || "Frame.io" },
    accounts: list,
    configPatch: chosen && chosen !== (conn.config && conn.config.accountId) ? { accountId: chosen } : null,
    notes: chosen ? [] : ["Choose which Frame.io account to use."],
  };
}

export async function sources(conn) {
  const a = account(conn);
  let projects;
  try {
    projects = await all(conn, `/accounts/${a}/projects`);
  } catch (err) {
    if (err.status !== 404) throw err;
    projects = [];
    for (const ws of await all(conn, `/accounts/${a}/workspaces`)) projects.push(...await all(conn, `/accounts/${a}/workspaces/${ws.id}/projects`));
  }
  return projects.filter((p) => p.root_folder_id).map((p) => ({ id: p.root_folder_id, name: p.name, count: null, modified: p.updated_at || null }));
}

export function checkRef(ref) {
  return /^[\w-]{8,64}$/.test(String(ref)) ? null : "Paste the Frame.io folder’s ID.";
}

const clean = (name) => String(name || "Untitled").replace(/\.(mov|mp4|m4v|mxf|avi|mkv|webm|prores)$/i, "");
const isVideo = (f) => f && (/^video\//.test(f.media_type || "") || /\.(mov|mp4|m4v|mxf|webm)$/i.test(f.name || ""));
const ready = (f) => !f.status || ["transcoded", "ready", "uploaded"].includes(f.status);
const thumb = (f) => (f.media_links && f.media_links.thumbnail && (f.media_links.thumbnail.url || f.media_links.thumbnail.download_url)) || null;

function fileVideo(f, extra = {}) {
  return video({
    id: f.id, title: clean(f.name), created: f.created_at || null, thumbnail: thumb(f),
    link: f.view_url || null, shareable: false, ready: ready(f) && f.status !== "uploaded", status: f.status,
    playback: { kind: "file" }, ...extra,
  });
}

export async function videos(conn, ref, { fresh = false } = {}) {
  const err = checkRef(ref);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  const k = conn.id + ":" + ref;
  const hit = cache.get(k);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.videos;
  const a = account(conn);
  const items = await all(conn, `/accounts/${a}/folders/${ref}/children`, { include: "media_links.thumbnail", sort: "created_at_desc" });
  const list = [];
  for (const it of items) {
    if (it.type === "file" && isVideo(it)) list.push(fileVideo(it));
    if (it.type === "version_stack") {
      const kids = (await all(conn, `/accounts/${a}/version_stacks/${it.id}/children`, { include: "media_links.thumbnail" }, 2)).filter(isVideo);
      kids.sort((x, y) => (Date.parse(x.created_at) || 0) - (Date.parse(y.created_at) || 0));
      const head = it.head_version && it.head_version.id;
      if (head) { const i = kids.findIndex((x) => x.id === head); if (i >= 0 && i !== kids.length - 1) kids.push(kids.splice(i, 1)[0]); }
      const title = clean(it.name || (kids[0] && kids[0].name));
      kids.forEach((f, i) => list.push(fileVideo(f, { version: i + 1, baseTitle: title, stack: { id: it.id, title } })));
    }
  }
  cache.set(k, { at: Date.now(), videos: list });
  return list;
}

export const forget = (conn, ref) => { for (const k of cache.keys()) if (k.startsWith(conn.id + ":") && (!ref || k === conn.id + ":" + ref)) cache.delete(k); };

const linkOf = (m) => (m ? m.url || m.inline_url || m.download_url || null : null);

/** A fresh, signed address to play one video (the high-quality copy, or the smallest if that isn't ready). */
export async function play(conn, v) {
  const d = await call(conn, `/accounts/${account(conn)}/files/${v.id}`, { include: "media_links.high_quality,media_links.efficient" });
  const m = (d.data && d.data.media_links) || {};
  const url = linkOf(m.high_quality) || linkOf(m.efficient);
  if (!url) throw Object.assign(new Error("Frame.io hasn’t finished preparing this video yet."), { status: 409 });
  return { url };
}

export async function details(conn, v, want) {
  const out = {};
  if (want.downloads) {
    const a = account(conn);
    let d;
    try {
      d = await call(conn, `/accounts/${a}/files/${v.id}`, { include: "media_links.original,media_links.high_quality,media_links.efficient" });
    } catch (err) {
      if (err.status !== 403) throw err; // the original can be off-limits; offer the copies instead
      d = await call(conn, `/accounts/${a}/files/${v.id}`, { include: "media_links.high_quality,media_links.efficient" });
    }
    const m = (d.data && d.data.media_links) || {};
    const links = [
      m.original && m.original.download_url ? { label: "Original file", source: true, link: m.original.download_url } : null,
      m.high_quality && m.high_quality.download_url ? { label: "High quality (MP4)", source: false, link: m.high_quality.download_url } : null,
      m.efficient && m.efficient.download_url ? { label: "Smaller file (MP4)", source: false, link: m.efficient.download_url } : null,
    ].filter(Boolean).map((l) => ({ ...l, width: 0, height: 0, size: 0, sizeLabel: "" }));
    out.downloads = { links, onSite: null, why: links.length ? null : "Frame.io has no downloadable copies of this video yet, or downloads are off for this account." };
  }
  if (want.captions) { out.captions = []; out.chapters = []; }
  return out;
}

// ---------- comments: the portal's notes, mirrored both ways (api/_fio_sync.js) ----------
// Frame.io places a comment by timecode (HH:MM:SS:FF). The portal pins notes to the second, so it writes whole
// seconds (frame 00) and reads the hours, minutes, and seconds. A bare number is a frame count: read at 24 fps.

/** 83.4 seconds → "00:01:23:00". */
export function toTimecode(sec) {
  const t = Math.max(0, Math.floor(Number(sec) || 0));
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(t / 3600))}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}:00`;
}
/** "00:01:23:12" → 83; 2000 (frames) → 83; nothing → null. */
export function fromTimecode(ts) {
  if (ts === null || ts === undefined || ts === "") return null;
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:[:;](\d+))?$/.exec(String(ts));
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const n = Number(ts);
  return Number.isFinite(n) ? Math.floor(n / 24) : null;
}

/** Every comment on a file, oldest first, each with its replies and its author (owner). */
export async function listComments(conn, fileId) {
  return all(conn, `/accounts/${account(conn)}/files/${fileId}/comments`, { include: "owner,replies", timestamp_as_timecode: true, sort: "created_at_asc" }, 6);
}
/** One comment with its author; its file_id says which video it's on. */
export async function showComment(conn, id) {
  return (await call(conn, `/accounts/${account(conn)}/comments/${id}`, { include: "owner", timestamp_as_timecode: true })).data;
}
/** A new comment on a file, at a moment (seconds) or on the whole video (at = null). Returns it (its id). */
export async function createComment(conn, fileId, { text, at = null }) {
  const data = { text: String(text).slice(0, 5000), ...(at === null || at === undefined ? {} : { timestamp: toTimecode(at) }) };
  return (await call(conn, `/accounts/${account(conn)}/files/${fileId}/comments`, { timestamp_as_timecode: true }, { method: "POST", body: { data } })).data;
}
/** Marks a comment done (or not) in Frame.io: the portal's "resolved". */
export async function completeComment(conn, id, done) {
  return call(conn, `/accounts/${account(conn)}/comments/${id}`, {}, { method: "PATCH", body: { data: { completed: !!done } } });
}
export async function deleteComment(conn, id) {
  try { await call(conn, `/accounts/${account(conn)}/comments/${id}`, {}, { method: "DELETE" }); } catch (err) { if (err.status !== 404) throw err; }
}

// ---------- webhooks: Frame.io tells the portal straight away (api/connect.js, ?webhook=frameio) ----------
export const WEBHOOK_EVENTS = ["comment.created", "comment.updated", "comment.deleted", "comment.completed", "comment.uncompleted", "file.ready", "file.versioned"];

export async function workspaces(conn) {
  return (await all(conn, `/accounts/${account(conn)}/workspaces`)).map((w) => ({ id: w.id, name: w.name || "Workspace" }));
}
/** Creates a webhook in one workspace. Returns { id, secret }: Frame.io shows the secret only this once. */
export async function createWebhook(conn, workspaceId, { name, url, events = WEBHOOK_EVENTS }) {
  const d = (await call(conn, `/accounts/${account(conn)}/workspaces/${workspaceId}/webhooks`, {}, { method: "POST", body: { data: { name, url, events } } })).data;
  return { id: d.id, secret: d.secret };
}
export async function deleteWebhook(conn, id) {
  try { await call(conn, `/accounts/${account(conn)}/webhooks/${id}`, {}, { method: "DELETE" }); } catch (err) { if (err.status !== 404) throw err; }
}
