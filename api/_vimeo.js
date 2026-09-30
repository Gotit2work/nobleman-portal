// Server-side Vimeo API client. The access token never leaves the server; the browser only ever receives
// the normalized fields below and plays videos through the public embed player.
//
//   VIMEO_ACCESS_TOKEN  personal access token (developer.vimeo.com → your app → Authentication),
//                       scopes: public, private. Required for anything here to run.
//   VIMEO_USER_ID       optional; the account that owns the folders. Defaults to the token's own account.

const API = "https://api.vimeo.com";
const FIELDS = [
  "uri", "name", "description", "duration", "width", "height", "created_time", "release_time",
  "link", "player_embed_url", "pictures.sizes", "privacy.view", "status",
].join(",");
const CACHE_MS = 2 * 60 * 1000; // folder listings are cached per server instance to spare the API quota
const cache = new Map();

export const vimeoConfigured = () => !!process.env.VIMEO_ACCESS_TOKEN;

async function vimeoGet(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url, {
    headers: {
      Authorization: "bearer " + process.env.VIMEO_ACCESS_TOKEN,
      Accept: "application/vnd.vimeo.*+json;version=3.4",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Vimeo ${r.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

const pad = (n) => String(n).padStart(2, "0");
const durationLabel = (s) => {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
};
const resolutionLabel = (w, h) => {
  if (h > w) return "9:16";
  if (w >= 3840) return "4K";
  if (w >= 1920) return "1080p";
  if (w >= 1280) return "720p";
  return w ? `${w}×${h}` : "";
};

/** Maps a Vimeo video object to the shape the portal uses. Exported for tests. */
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
  };
}

/** Playable videos in a Vimeo folder, newest first. */
export async function folderVideos(folderId) {
  if (!/^\d+$/.test(String(folderId))) throw new Error("Vimeo folder ids are numeric: " + folderId);
  const hit = cache.get(folderId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.videos;
  const user = process.env.VIMEO_USER_ID ? "users/" + process.env.VIMEO_USER_ID : "me";
  const d = await vimeoGet(`/${user}/projects/${folderId}/videos`, {
    per_page: 50, sort: "date", direction: "desc", fields: FIELDS,
  });
  const videos = (d.data || []).filter((v) => !v.status || v.status === "available").map(normalizeVideo);
  cache.set(folderId, { at: Date.now(), videos });
  return videos;
}
