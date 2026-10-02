// Server-side Vimeo API client. The access token never leaves the server; the browser only gets the
// normalized fields below, plays films through Vimeo's embed player, and uploads straight to the tus link
// Vimeo issues for one file.
//
//   VIMEO_ACCESS_TOKEN  personal access token from Jean's Vimeo account (developer.vimeo.com → your app →
//                       Authentication → Authenticated (you)). Scopes: public, private, edit, upload,
//                       video_files, stats (README, "Connecting Vimeo").
//   VIMEO_USER_ID       optional; the account that owns the folders. Defaults to the token's own account.
//
// What depends on Jean's Vimeo plan: download links through the API need Standard or above (Vimeo returns
// none on Plus). The portal then offers "Download on Vimeo" when the film allows downloads on its own page.

const API = "https://api.vimeo.com";
const FIELDS = [
  "uri", "name", "description", "duration", "width", "height", "created_time", "release_time", "modified_time",
  "link", "player_embed_url", "pictures.sizes", "privacy.view", "privacy.download", "status", "stats.plays",
].join(",");
const CACHE_MS = 2 * 60 * 1000; // folder listings, per server instance, to spare the API quota
const cache = new Map();

export class VimeoError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const vimeoConfigured = () => !!process.env.VIMEO_ACCESS_TOKEN;

async function call(method, path, { params, body } = {}) {
  const url = new URL(path.startsWith("http") ? path : API + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: "bearer " + process.env.VIMEO_ACCESS_TOKEN,
      Accept: "application/vnd.vimeo.*+json;version=3.4",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new VimeoError(r.status, `Vimeo ${r.status} on ${method} ${url.pathname}: ${t.slice(0, 300)}`);
  }
  return r.status === 204 ? null : r.json();
}
const get = (path, params) => call("GET", path, { params });

const owner = () => (process.env.VIMEO_USER_ID ? "/users/" + process.env.VIMEO_USER_ID : "/me");

const pad = (n) => String(n).padStart(2, "0");
export const durationLabel = (s) => {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
};
const resolutionLabel = (w, h) => {
  if (h > w) return "Vertical";
  if (w >= 3840) return "4K";
  if (w >= 2560) return "2.5K";
  if (w >= 1920) return "1080p";
  if (w >= 1280) return "720p";
  return w ? `${w}×${h}` : "";
};

// "Harbor Spot V2", "harbor spot v3", "Harbor Spot – Version 4", "Harbor Spot_v5" → version 2..5 of "Harbor Spot".
// The marker never opens a title ("V8 Engine Film" is a film), and must stand alone ("Harbor Spot V2", "… v2_final").
const VERSION_RE = /[\s_\-–—·(](?:v|ver\.?|version)\s*(\d{1,3})(?=$|[\s_\-–—·).])\)?/i;
export function parseVersion(title) {
  title = String(title || "").replace(/\.(mov|mp4|m4v|mxf|avi|mkv)$/i, ""); // uploads often keep the file name
  const m = VERSION_RE.exec(title);
  if (!m) return null;
  const base = (title.slice(0, m.index) + title.slice(m.index + m[0].length)).replace(/[\s_\-–—·]+$/, "").replace(/^[\s_\-–—·]+/, "").trim();
  return { n: Number(m[1]), base: base || title };
}

/** Maps a Vimeo video object to what the portal uses. Exported for tests. */
export function normalizeVideo(v) {
  const id = String(v.uri || "").split("/").pop();
  let hash = null;
  try { hash = new URL(v.player_embed_url || "").searchParams.get("h"); } catch {}
  if (!hash) {
    const m = /vimeo\.com\/\d+\/([0-9a-f]+)/i.exec(v.link || "");
    if (m) hash = m[1];
  }
  const sizes = (v.pictures && v.pictures.sizes) || [];
  const pick = sizes.filter((p) => p.width <= 1920).sort((a, b) => b.width - a.width)[0] || sizes[sizes.length - 1];
  const ver = parseVersion(v.name);
  return {
    id,
    hash,
    title: v.name || "Untitled",
    description: v.description || "",
    duration: v.duration || 0,
    durationLabel: durationLabel(v.duration),
    width: v.width || 0,
    height: v.height || 0,
    vertical: (v.height || 0) > (v.width || 0),
    resolution: resolutionLabel(v.width || 0, v.height || 0),
    created: v.release_time || v.created_time || null,
    thumbnail: pick ? pick.link : null,
    link: v.link || null,
    plays: v.stats && typeof v.stats.plays === "number" ? v.stats.plays : null,
    downloadOnVimeo: !!(v.privacy && v.privacy.download),
    // Only "anybody" and "unlisted" films have a Vimeo page someone else can open.
    shareable: !!(v.privacy && (v.privacy.view === "anybody" || v.privacy.view === "unlisted")),
    ready: !v.status || v.status === "available",
    status: v.status || "available",
    version: ver ? ver.n : null,
    baseTitle: ver ? ver.base : null,
  };
}

/** Every video in a Vimeo folder (newest first), playable or not. Cached for two minutes. */
export async function folderVideos(folderId, { fresh = false } = {}) {
  if (!/^\d+$/.test(String(folderId))) throw new VimeoError(400, "Vimeo folder ids are numeric: " + folderId);
  const hit = cache.get(folderId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.videos;
  const videos = [];
  let next = `${owner()}/projects/${folderId}/videos`;
  let params = { per_page: 100, sort: "date", direction: "desc", fields: FIELDS };
  for (let page = 0; next && page < 5; page++) {
    const d = await get(next, params);
    for (const v of d.data || []) videos.push(normalizeVideo(v));
    next = d.paging && d.paging.next ? d.paging.next : null;
    params = {};
  }
  cache.set(folderId, { at: Date.now(), videos });
  return videos;
}

export const forgetFolder = (folderId) => cache.delete(String(folderId));

/**
 * Splits a folder into versions for review and finished films:
 *   - titles with a version number ("… V2") are versions, grouped by the rest of the title;
 *   - everything else is a finished film;
 *   - videos clients uploaded through the portal (excludeIds) are neither.
 */
export function splitFolder(videos, excludeIds = new Set()) {
  const groups = new Map();
  const films = [];
  for (const v of videos) {
    if (excludeIds.has(v.id) || !v.ready) continue;
    if (v.version != null) {
      const key = v.baseTitle.toLowerCase();
      if (!groups.has(key)) groups.set(key, { key, title: v.baseTitle, versions: [] });
      const g = groups.get(key);
      if (!g.versions.some((x) => x.n === v.version)) g.versions.push({ n: v.version, video: v });
    } else films.push(v);
  }
  const cuts = [...groups.values()].map((g) => ({ ...g, versions: g.versions.sort((a, b) => a.n - b.n) }));
  cuts.sort((a, b) => latest(b) - latest(a));
  return { cuts, films };
}
const latest = (g) => Math.max(...g.versions.map((x) => Date.parse(x.video.created) || 0));

/**
 * Download links for one video, freshly signed by Vimeo (they expire). Needs the video_files scope and a
 * Standard plan or above; on Plus Vimeo returns none, and the caller falls back to "Download on Vimeo".
 */
export async function videoDownloads(id) {
  const d = await get(`/videos/${id}`, { fields: "download,privacy.download,link" });
  const list = (d.download || []).map((x) => {
    const source = x.rendition === "source" || x.quality === "source";
    const label = source ? "Original file" : x.public_name || x.rendition || x.quality || "Video";
    return {
      label,
      source,
      width: x.width || 0,
      height: x.height || 0,
      size: x.size || 0,
      sizeLabel: x.size_short || "",
      type: x.type || "video/mp4",
      link: x.link,
      expires: x.expires || null,
    };
  }).filter((x) => x.link);
  list.sort((a, b) => (b.source - a.source) || (b.width - a.width));
  return { links: list, onVimeo: d.privacy && d.privacy.download ? d.link : null };
}

/** Caption and subtitle files (WebVTT). Links are temporary, so they are fetched when needed. */
export async function textTracks(id) {
  const d = await get(`/videos/${id}/texttracks`);
  return (d.data || []).filter((t) => t.link && t.active !== false).map((t) => ({
    label: t.name || t.language || "Captions",
    language: t.language || "",
    kind: t.type || "captions",
    link: t.link,
  }));
}

/** Chapter markers, if the film has any. Not every plan or video has them; that's an empty list. */
export async function chapters(id) {
  try {
    const d = await get(`/videos/${id}/chapters`);
    return (d.data || []).map((c) => ({ title: c.title || "Chapter", at: Number(c.timecode) || 0 }))
      .sort((a, b) => a.at - b.at);
  } catch (err) {
    if (err.status === 403 || err.status === 404) return [];
    throw err;
  }
}

let acct = null;
/** The Vimeo account behind the token: name, plan, upload allowance, and granted scopes. Cached ten minutes. */
export async function account({ fresh = false } = {}) {
  if (!fresh && acct && Date.now() - acct.at < 10 * 60 * 1000) return acct.value;
  const [me, verify] = await Promise.all([
    get(owner(), { fields: "uri,name,link,account,upload_quota" }),
    get("/oauth/verify").catch(() => null),
  ]);
  const q = me.upload_quota || {};
  const periodic = q.periodic || {};
  const space = q.space || {};
  const value = {
    uri: me.uri,
    name: me.name || "",
    link: me.link || "",
    plan: me.account || "",
    scopes: verify && verify.scope ? String(verify.scope).split(/\s+/).filter(Boolean) : [],
    upload: {
      free: typeof space.free === "number" ? space.free : null,
      max: typeof space.max === "number" ? space.max : null,
      periodFree: typeof periodic.free === "number" ? periodic.free : null,
      periodReset: periodic.reset_date || null,
    },
  };
  acct = { at: Date.now(), value };
  return value;
}

/** The account's folders, for linking a project to one. */
export async function folders() {
  const out = [];
  let next = `${owner()}/projects`;
  let params = { per_page: 100, sort: "modified_time", direction: "desc", fields: "uri,name,modified_time,metadata.connections.videos.total" };
  for (let page = 0; next && page < 5; page++) {
    const d = await get(next, params);
    for (const f of d.data || []) {
      out.push({
        id: String(f.uri || "").split("/").pop(),
        name: f.name || "Untitled folder",
        videos: (f.metadata && f.metadata.connections && f.metadata.connections.videos && f.metadata.connections.videos.total) || 0,
        modified: f.modified_time || null,
      });
    }
    next = d.paging && d.paging.next ? d.paging.next : null;
    params = {};
  }
  return out;
}

/**
 * Starts a resumable (tus) upload into a project's folder and returns Vimeo's upload link. The browser sends
 * the file straight to that link, so it never passes through the portal's servers.
 * Client footage (`fromClient`) is raw material for Nobleman: private on Vimeo ("only me"), never embedded.
 * Staff uploads are versions and films the client watches in the portal, so they must embed: unlisted (kept
 * off vimeo.com search and profiles, playable with its private link), downloads off until Jean turns them on.
 */
export async function createUpload({ name, size, folderId, description, fromClient }) {
  const me = await account();
  const body = {
    upload: { approach: "tus", size: String(size) },
    name,
    description: description || "",
    folder_uri: `${me.uri}/projects/${folderId}`,
    privacy: fromClient ? { view: "nobody", embed: "private", download: false } : { view: "unlisted", embed: "public", download: false },
  };
  let d;
  try {
    d = await call("POST", `${owner()}/videos`, { body });
  } catch (err) {
    // Some plans refuse a privacy setting at upload time; upload with the account's defaults instead.
    if (err.status !== 400) throw err;
    delete body.privacy;
    d = await call("POST", `${owner()}/videos`, { body });
  }
  forgetFolder(folderId);
  return {
    id: String(d.uri || "").split("/").pop(),
    uploadLink: d.upload && d.upload.upload_link,
    approach: d.upload && d.upload.approach,
  };
}
