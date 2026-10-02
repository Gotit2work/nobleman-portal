// What every video source has in common: one shape for a video, version naming, and how a source's videos
// split into versions (Review) and finished films (Films).
//
// A normalized video:
//   { id, title, description, duration, durationLabel, width, height, vertical, resolution, created, thumbnail,
//     link, shareable, plays, ready, version, baseTitle, stack, playback }
// `playback` tells the page how to play it:
//   { kind: "vimeo", id, hash }   Vimeo's player (with its API, so notes pin to the moment)
//   { kind: "youtube", id }       YouTube's privacy-enhanced player (with its API)
//   { kind: "file" }              an ordinary video file; the page asks /api/media for a fresh, signed address
//   { kind: "file", url }         an ordinary video file at a fixed public address (video links)
//   { kind: "iframe", url }       another player in a frame (Google Drive, Loom, Wistia): notes have no time

const pad = (n) => String(n).padStart(2, "0");

export const durationLabel = (s) => {
  s = Math.max(0, Math.round(s || 0));
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
};

export const resolutionLabel = (w, h) => {
  if (!w || !h) return "";
  if (h > w) return "Vertical";
  if (w >= 3840) return "4K";
  if (w >= 2560) return "2.5K";
  if (w >= 1920) return "1080p";
  if (w >= 1280) return "720p";
  return `${w}×${h}`;
};

/** ISO 8601 duration (YouTube's "PT1H2M3S") to seconds. */
export function isoDuration(s) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(s || ""));
  if (!m) return 0;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Math.round(Number(m[4] || 0));
}

// "Harbor Spot V2", "harbor spot v3", "Harbor Spot – Version 4", "Harbor Spot_v5" → version 2..5 of "Harbor Spot".
// The marker never opens a title ("V8 Engine Film" is a film), and must stand alone ("Harbor Spot V2", "… v2_final").
const VERSION_RE = /[\s_\-–—·(](?:v|ver\.?|version)\s*(\d{1,3})(?=$|[\s_\-–—·).])\)?/i;
export function parseVersion(title) {
  title = String(title || "").replace(/\.(mov|mp4|m4v|mxf|avi|mkv|webm)$/i, ""); // uploads often keep the file name
  const m = VERSION_RE.exec(title);
  if (!m) return null;
  const base = (title.slice(0, m.index) + title.slice(m.index + m[0].length)).replace(/[\s_\-–—·]+$/, "").replace(/^[\s_\-–—·]+/, "").trim();
  return { n: Number(m[1]), base: base || title };
}

/** Fills the fields every source shares from what it knows. */
export function video(o) {
  const ver = o.version != null ? { n: o.version, base: o.baseTitle || o.title } : parseVersion(o.title);
  const width = o.width || 0, height = o.height || 0;
  return {
    id: String(o.id),
    title: o.title || "Untitled",
    description: o.description || "",
    duration: Math.round(o.duration || 0),
    durationLabel: durationLabel(o.duration),
    width, height,
    vertical: height > width,
    resolution: o.resolution || resolutionLabel(width, height),
    created: o.created || null,
    thumbnail: o.thumbnail || null,
    link: o.link || null,
    // Where staff open it at the source (Vimeo's manage page, Frame.io's viewer).
    manage: o.manage || o.link || null,
    shareable: !!o.shareable,
    plays: typeof o.plays === "number" ? o.plays : null,
    downloadOnSite: !!o.downloadOnSite,
    ready: o.ready !== false,
    status: o.status || "ready",
    version: ver ? ver.n : null,
    baseTitle: ver ? ver.base : null,
    stack: o.stack || null,
    playback: o.playback,
  };
}

/**
 * Applies staff choices (video_settings rows) to a source's videos: renames, "treat as a finished film", and
 * hidden. Hidden videos are dropped unless keepHidden (Studio's video list shows them, marked).
 */
export function applySettings(videos, rows, { keepHidden = false } = {}) {
  const by = new Map(rows.map((r) => [r.video_id, r]));
  const out = [];
  for (const v of videos) {
    const s = by.get(v.id);
    if (!s) { out.push(v); continue; }
    if (s.hidden && !keepHidden) continue;
    let x = { ...v, hidden: !!s.hidden };
    if (s.title) {
      const ver = x.stack ? null : parseVersion(s.title);
      x = { ...x, title: s.title, ...(x.stack ? {} : { version: ver ? ver.n : null, baseTitle: ver ? ver.base : null }) };
    }
    if (s.kind === "film") x = { ...x, version: null, baseTitle: null, stack: null, forcedFilm: true };
    out.push(x);
  }
  return out;
}

/**
 * Splits videos into versions for review and finished films:
 *   - a video with a version number (from its title, or its place in a Frame.io version stack) is a version,
 *     grouped with the others of the same name or stack;
 *   - everything else is a finished film;
 *   - videos clients sent through the portal (excludeIds) are neither, and unfinished videos are skipped.
 */
export function splitVideos(videos, excludeIds = new Set()) {
  const groups = new Map();
  const films = [];
  for (const v of videos) {
    if (excludeIds.has(v.id) || !v.ready) continue;
    if (v.version != null) {
      const key = v.stack ? "stack:" + v.stack.id : String(v.baseTitle || v.title).toLowerCase();
      if (!groups.has(key)) groups.set(key, { key, title: v.stack ? v.stack.title : v.baseTitle, versions: [] });
      const g = groups.get(key);
      if (!g.versions.some((x) => x.n === v.version)) g.versions.push({ n: v.version, video: v });
    } else films.push(v);
  }
  const cuts = [...groups.values()].map((g) => ({ ...g, versions: g.versions.sort((a, b) => a.n - b.n) }));
  cuts.sort((a, b) => newest(b) - newest(a));
  return { cuts, films };
}
const newest = (g) => Math.max(...g.versions.map((x) => Date.parse(x.video.created) || 0));

/** A video id from the page: provider ids are letters, digits, dashes, underscores, at most 80 long. */
export const validVideoId = (id) => typeof id === "string" && /^[\w-]{1,80}$/.test(id);

/** Fetch with a timeout and a readable error: err.status is the HTTP status (0 when unreachable). */
export async function fetchJson(url, { method = "GET", headers = {}, body, timeout = 10000, label = "Source" } = {}) {
  let r;
  try {
    r = await fetch(url, {
      method,
      headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw Object.assign(new Error(`${label} isn’t answering (${err.name === "TimeoutError" ? "timed out" : "unreachable"}).`), { status: 0 });
  }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!r.ok) {
    const msg = (data && (data.message || data.error_description || (data.error && (data.error.message || data.error)) || data.developer_message)) || text.slice(0, 200);
    throw Object.assign(new Error(`${label} answered ${r.status}: ${String(msg).slice(0, 300)}`), { status: r.status, data, retryAfter: Number(r.headers.get("retry-after")) || 0 });
  }
  return data;
}
