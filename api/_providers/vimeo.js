// Vimeo. Credentials: a personal access token from the account that owns the videos (developer.vimeo.com →
// your app → Generate an access token → Authenticated (you)), scopes public, private, edit, upload,
// video_files, stats. A project's source is one Vimeo folder (the number at the end of its address).
//
// Plan limits: download links through the API need Standard or above. On Plus the portal offers "Download on
// Vimeo" instead, for films that allow downloads on their Vimeo page.
import { video, fetchJson } from "../_video.js";

const API = "https://api.vimeo.com";
const FIELDS = [
  "uri", "name", "description", "duration", "width", "height", "created_time", "release_time",
  "link", "player_embed_url", "pictures.sizes", "privacy.view", "privacy.download", "status", "stats.plays",
].join(",");
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map();
const accounts = new Map();

export const meta = {
  key: "vimeo",
  name: "Vimeo",
  kind: "video",
  blurb: "Plays, downloads, captions, chapters, play counts, and uploads straight into a folder.",
  fields: [
    { key: "token", label: "Access token", secret: true, help: "developer.vimeo.com → Create an app → Generate an access token → Authenticated (you), with the scopes Public, Private, Edit, Upload, Video Files, and Stats." },
    { key: "userId", label: "Vimeo user ID (optional)", help: "Only if the folders belong to a different Vimeo account than the token’s. Usually leave empty." },
  ],
  source: { label: "Folder", placeholder: "Folder number, e.g. 12345678", help: "The number at the end of the folder’s address on vimeo.com (…/folder/12345678)." },
  features: { downloads: true, captions: true, chapters: true, upload: true, stats: true, versions: "Name versions “Title V2”, “Title V3”." },
  scopes: [
    { key: "public", label: "See the account" },
    { key: "private", label: "See private and hidden videos" },
    { key: "edit", label: "Name uploads and set their privacy" },
    { key: "upload", label: "Accept uploads" },
    { key: "video_files", label: "Download links (Standard plan or above)" },
    { key: "stats", label: "Play counts" },
  ],
};

const owner = (conn) => (conn.creds.userId ? "/users/" + encodeURIComponent(conn.creds.userId) : "/me");

function call(conn, method, path, { params, body } = {}) {
  const url = new URL(path.startsWith("http") ? path : API + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
  return fetchJson(url, {
    method, body, label: "Vimeo",
    headers: { Authorization: "bearer " + conn.creds.token, Accept: "application/vnd.vimeo.*+json;version=3.4" },
  });
}

function normalize(v) {
  const id = String(v.uri || "").split("/").pop();
  let hash = null;
  try { hash = new URL(v.player_embed_url || "").searchParams.get("h"); } catch {}
  if (!hash) {
    const m = /vimeo\.com\/\d+\/([0-9a-f]+)/i.exec(v.link || "");
    if (m) hash = m[1];
  }
  const sizes = (v.pictures && v.pictures.sizes) || [];
  const pick = sizes.filter((p) => p.width <= 1920).sort((a, b) => b.width - a.width)[0] || sizes[sizes.length - 1];
  return video({
    id, title: v.name, description: v.description, duration: v.duration, width: v.width, height: v.height,
    created: v.release_time || v.created_time || null,
    thumbnail: pick ? pick.link : null,
    link: v.link || null,
    manage: `https://vimeo.com/manage/videos/${id}`,
    plays: v.stats && typeof v.stats.plays === "number" ? v.stats.plays : null,
    downloadOnSite: !!(v.privacy && v.privacy.download),
    // Only "anybody" and "unlisted" videos have a Vimeo page someone else can open.
    shareable: !!(v.privacy && (v.privacy.view === "anybody" || v.privacy.view === "unlisted")),
    ready: !v.status || v.status === "available",
    status: v.status || "available",
    playback: { kind: "vimeo", id, hash },
  });
}

export async function test(conn) {
  const a = await account(conn, { fresh: true });
  const missing = meta.scopes.filter((s) => !a.scopes.includes(s.key)).map((s) => s.label);
  return {
    account: { name: a.name, plan: a.plan, link: a.link },
    scopes: meta.scopes.map((s) => ({ ...s, ok: a.scopes.includes(s.key) })),
    upload: a.upload,
    notes: [
      ...(missing.length ? [`The token is missing: ${missing.join(", ")}. Create a new token with every scope.`] : []),
      ...(!["standard", "advanced", "pro_unlimited", "business", "premium", "enterprise", "live_business", "live_premium"].includes(String(a.plan).toLowerCase())
        ? ["On this plan Vimeo gives no download links through its API. Films that allow downloads on Vimeo get a “Download on Vimeo” button instead."] : []),
    ],
  };
}

/** The account behind the token: name, plan, upload allowance, granted scopes. Cached ten minutes. */
export async function account(conn, { fresh = false } = {}) {
  const hit = accounts.get(conn.id);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;
  const [me, verify] = await Promise.all([
    call(conn, "GET", owner(conn), { params: { fields: "uri,name,link,account,upload_quota" } }),
    call(conn, "GET", "/oauth/verify").catch(() => null),
  ]);
  const q = me.upload_quota || {};
  const value = {
    uri: me.uri, name: me.name || "", link: me.link || "", plan: me.account || "",
    scopes: verify && verify.scope ? String(verify.scope).split(/\s+/).filter(Boolean) : [],
    upload: {
      free: q.space && typeof q.space.free === "number" ? q.space.free : null,
      periodFree: q.periodic && typeof q.periodic.free === "number" ? q.periodic.free : null,
    },
  };
  accounts.set(conn.id, { at: Date.now(), value });
  return value;
}

export async function sources(conn) {
  const out = [];
  let next = `${owner(conn)}/projects`;
  let params = { per_page: 100, sort: "modified_time", direction: "desc", fields: "uri,name,modified_time,metadata.connections.videos.total" };
  for (let page = 0; next && page < 5; page++) {
    const d = await call(conn, "GET", next, { params });
    for (const f of d.data || []) {
      out.push({
        id: String(f.uri || "").split("/").pop(),
        name: f.name || "Untitled folder",
        count: (f.metadata && f.metadata.connections && f.metadata.connections.videos && f.metadata.connections.videos.total) || 0,
        modified: f.modified_time || null,
      });
    }
    next = d.paging && d.paging.next ? d.paging.next : null;
    params = {};
  }
  return out;
}

export function checkRef(ref) {
  return /^\d{1,20}$/.test(String(ref)) ? null : "A Vimeo folder number is digits only: the number at the end of the folder’s web address.";
}

/** Every video in the folder (newest first), playable or not. Cached two minutes. */
export async function videos(conn, ref, { fresh = false } = {}) {
  const err = checkRef(ref);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  const k = conn.id + ":" + ref;
  const hit = cache.get(k);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.videos;
  const list = [];
  let next = `${owner(conn)}/projects/${ref}/videos`;
  let params = { per_page: 100, sort: "date", direction: "desc", fields: FIELDS };
  for (let page = 0; next && page < 5; page++) {
    const d = await call(conn, "GET", next, { params });
    for (const v of d.data || []) list.push(normalize(v));
    next = d.paging && d.paging.next ? d.paging.next : null;
    params = {};
  }
  cache.set(k, { at: Date.now(), videos: list });
  return list;
}

export const forget = (conn, ref) => { for (const k of cache.keys()) if (k.startsWith(conn.id + ":") && (!ref || k === conn.id + ":" + ref)) cache.delete(k); };

/** Downloads (finished films), captions, and chapters for one video. Links are signed by Vimeo and expire. */
export async function details(conn, v, want) {
  const out = {};
  const jobs = [];
  if (want.downloads) {
    jobs.push(call(conn, "GET", `/videos/${v.id}`, { params: { fields: "download,privacy.download,link" } }).then((d) => {
      const links = (d.download || []).map((x) => {
        const source = x.rendition === "source" || x.quality === "source";
        return {
          label: source ? "Original file" : x.public_name || x.rendition || x.quality || "Video",
          source, width: x.width || 0, height: x.height || 0, size: x.size || 0, sizeLabel: x.size_short || "", link: x.link,
        };
      }).filter((x) => x.link).sort((a, b) => (b.source - a.source) || (b.width - a.width));
      out.downloads = { links, onSite: d.privacy && d.privacy.download && v.shareable ? d.link : null, siteName: "Vimeo",
        why: links.length ? null : "Vimeo gave no download links. They need a Standard plan or above and the token’s Video Files scope. Or allow downloads on this film in Vimeo and make it unlisted to offer “Download on Vimeo”." };
    }));
  }
  if (want.captions) {
    jobs.push(call(conn, "GET", `/videos/${v.id}/texttracks`).then((d) => {
      out.captions = (d.data || []).filter((t) => t.link && t.active !== false).map((t) => ({ label: t.name || t.language || "Captions", language: t.language || "", link: t.link }));
    }).catch(() => { out.captions = []; }));
    jobs.push(call(conn, "GET", `/videos/${v.id}/chapters`).then((d) => {
      out.chapters = (d.data || []).map((c) => ({ title: c.title || "Chapter", at: Number(c.timecode) || 0 })).sort((a, b) => a.at - b.at);
    }).catch(() => { out.chapters = []; }));
  }
  await Promise.all(jobs);
  return out;
}

/**
 * Starts a resumable (tus) upload into the folder. The browser sends the file straight to Vimeo.
 * Client footage (fromClient) is raw material: private ("only me"), never embedded. Staff uploads are
 * versions and films the client watches in the portal, so they're unlisted and embeddable.
 */
export async function createUpload(conn, ref, { name, size, description, fromClient }) {
  const me = await account(conn);
  const body = {
    upload: { approach: "tus", size: String(size) },
    name, description: description || "",
    folder_uri: `${me.uri}/projects/${ref}`,
    privacy: fromClient ? { view: "nobody", embed: "private", download: false } : { view: "unlisted", embed: "public", download: false },
  };
  let d;
  try {
    d = await call(conn, "POST", `${owner(conn)}/videos`, { body });
  } catch (err) {
    if (err.status !== 400) throw err;
    delete body.privacy; // some plans refuse privacy at upload time: use the account's defaults
    d = await call(conn, "POST", `${owner(conn)}/videos`, { body });
  }
  forget(conn, ref);
  return { id: String(d.uri || "").split("/").pop(), uploadLink: d.upload && d.upload.upload_link, approach: d.upload && d.upload.approach };
}

/** Upload room left, in bytes, or null when unknown. */
export async function roomLeft(conn) {
  try { return (await account(conn)).upload.free; } catch { return null; }
}
