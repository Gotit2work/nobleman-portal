// Wistia. Credentials: an API token (Wistia → Account settings → API access → create a token with read access).
// A project's source is one Wistia project (folder). Uses the long-lived v1 API.
// Plays the video file itself in the portal's player, offers the original and MP4 files as downloads, and
// caption files when the video has them.
import { video, fetchJson } from "../_video.js";

const API = "https://api.wistia.com/v1";
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map();

export const meta = {
  key: "wistia",
  name: "Wistia",
  kind: "video",
  blurb: "Plays from a Wistia project, with downloads and caption files.",
  fields: [
    { key: "token", label: "API token", secret: true, help: "Wistia → Account settings → API access → Generate a new token (read access is enough)." },
  ],
  source: { label: "Project", placeholder: "Project ID", help: "Pick from the list, or paste the project’s ID from its address in Wistia." },
  features: { downloads: true, captions: true, chapters: false, upload: false, stats: false, versions: "Name versions “Title V2”, “Title V3”." },
};

const get = (conn, path, params = {}) => {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return fetchJson(url, { label: "Wistia", headers: { Authorization: "Bearer " + conn.creds.token } });
};

/** Asset URLs end in .bin; "/file.mp4" in its place makes browsers treat them as video (Wistia's own advice). */
const mp4 = (url) => String(url || "").replace(/\.bin(\?.*)?$/, "/file.mp4$1");

export async function test(conn) {
  const a = await get(conn, "/account.json");
  return { account: { name: a.name || "Wistia", link: a.url || null }, notes: [] };
}

export async function sources(conn) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const d = await get(conn, "/projects.json", { page, per_page: 100, sort_by: "updated", sort_direction: 0 });
    for (const p of d || []) out.push({ id: String(p.id), name: p.name, count: p.mediaCount || 0, modified: p.updated });
    if (!d || d.length < 100) break;
  }
  return out;
}

export function checkRef(ref) {
  return /^[\w-]{1,40}$/.test(String(ref)) ? null : "Paste the Wistia project’s ID.";
}

async function projectId(conn, ref) {
  if (/^\d+$/.test(ref)) return ref;
  const p = await get(conn, `/projects/${encodeURIComponent(ref)}.json`); // a hashed id from the address bar
  return String(p.id);
}

export async function videos(conn, ref, { fresh = false } = {}) {
  const err = checkRef(ref);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  const k = conn.id + ":" + ref;
  const hit = cache.get(k);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.videos;
  const pid = await projectId(conn, String(ref));
  const list = [];
  for (let page = 1; page <= 5; page++) {
    const d = await get(conn, "/medias.json", { project_id: pid, type: "Video", page, per_page: 100, sort_by: "created", sort_direction: 0 });
    for (const m of d || []) {
      const assets = m.assets || [];
      const best = assets.find((a) => a.type === "HdMp4VideoFile") || assets.find((a) => a.type === "Mp4VideoFile") || assets.find((a) => a.type === "OriginalFile");
      const orig = assets.find((a) => a.type === "OriginalFile") || best || {};
      list.push(video({
        id: m.hashed_id, title: m.name, description: String(m.description || "").replace(/<[^>]+>/g, ""),
        duration: m.duration, width: orig.width, height: orig.height,
        created: m.created, thumbnail: m.thumbnail ? m.thumbnail.url : null,
        link: null, shareable: true,
        ready: !m.status || m.status === "ready",
        status: m.status,
        playback: best ? { kind: "file", url: mp4(best.url) } : { kind: "iframe", url: `https://fast.wistia.net/embed/iframe/${m.hashed_id}` },
      }));
    }
    if (!d || d.length < 100) break;
  }
  cache.set(k, { at: Date.now(), videos: list });
  return list;
}

export const forget = (conn, ref) => { for (const k of cache.keys()) if (k.startsWith(conn.id + ":") && (!ref || k === conn.id + ":" + ref)) cache.delete(k); };

const LABEL = { OriginalFile: "Original file", HdMp4VideoFile: "HD video (MP4)", Mp4VideoFile: "Video for web (MP4)" };

export async function details(conn, v, want) {
  const out = {};
  if (want.downloads) {
    const m = await get(conn, `/medias/${encodeURIComponent(v.id)}.json`);
    const links = (m.assets || []).filter((a) => LABEL[a.type]).map((a) => ({
      label: LABEL[a.type], source: a.type === "OriginalFile", width: a.width || 0, height: a.height || 0,
      size: a.fileSize || 0, sizeLabel: "", link: mp4(a.url) + (a.url.includes("?") ? "&" : "?") + "disposition=attachment",
    })).sort((a, b) => (b.source - a.source) || (b.width - a.width));
    out.downloads = { links, onSite: null, why: links.length ? null : "Wistia has no files ready for this video yet." };
  }
  if (want.captions) {
    try {
      const caps = await get(conn, `/medias/${encodeURIComponent(v.id)}/captions.json`);
      out.captions = (caps || []).filter((c) => c.text).map((c) => ({
        label: c.english_name || c.language || "Captions", language: c.language || "",
        text: c.text, filename: `${v.title} (${c.language || "captions"}).srt`,
      }));
    } catch { out.captions = []; }
    out.chapters = [];
  }
  return out;
}
