// YouTube. Credentials: an API key (Google Cloud console → APIs & Services → enable "YouTube Data API v3" →
// Credentials → Create API key; restrict it to that API). Optional channel ID to list its playlists.
// A project's source is one playlist. Public and unlisted videos play with YouTube's privacy-enhanced player;
// private videos can't be played outside YouTube and are skipped. YouTube offers no downloads or captions here.
import { video, fetchJson, isoDuration } from "../_video.js";

const API = "https://www.googleapis.com/youtube/v3";
const CACHE_MS = 5 * 60 * 1000; // listing a playlist costs quota; five minutes is plenty
const cache = new Map();

export const meta = {
  key: "youtube",
  name: "YouTube",
  kind: "video",
  blurb: "Plays public and unlisted videos from a playlist. No downloads or captions.",
  fields: [
    { key: "apiKey", label: "API key", secret: true, help: "Google Cloud console → APIs & Services → enable YouTube Data API v3 → Credentials → Create credentials → API key. Restrict it to the YouTube Data API." },
    { key: "channelId", label: "Channel ID (optional)", help: "Starts with UC. Lets you pick playlists from a list instead of pasting their IDs. YouTube → your channel → Settings → Advanced settings." },
  ],
  source: { label: "Playlist", placeholder: "Playlist ID, e.g. PL…", help: "From the playlist’s address: youtube.com/playlist?list=PL…" },
  features: { downloads: false, captions: false, chapters: false, upload: false, stats: true, versions: "Name versions “Title V2”, “Title V3”." },
};

const get = (conn, path, params) => {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("key", conn.creds.apiKey);
  return fetchJson(url, { label: "YouTube" });
};

export async function test(conn) {
  if (conn.creds.channelId) {
    const d = await get(conn, "/channels", { part: "snippet", id: conn.creds.channelId });
    const c = (d.items || [])[0];
    if (!c) throw Object.assign(new Error("YouTube has no channel with that ID."), { status: 404 });
    return { account: { name: c.snippet.title, link: `https://www.youtube.com/channel/${c.id}` }, notes: [] };
  }
  // Any cheap call proves the key works.
  await get(conn, "/i18nLanguages", { part: "snippet", hl: "en" });
  return { account: { name: "YouTube API key" }, notes: ["Add your channel ID to pick playlists from a list."] };
}

export async function sources(conn) {
  if (!conn.creds.channelId) return [];
  const out = [];
  let pageToken = "";
  for (let page = 0; page < 4; page++) {
    const d = await get(conn, "/playlists", { part: "snippet,contentDetails", channelId: conn.creds.channelId, maxResults: 50, ...(pageToken ? { pageToken } : {}) });
    for (const p of d.items || []) out.push({ id: p.id, name: p.snippet.title, count: p.contentDetails.itemCount || 0, modified: p.snippet.publishedAt });
    pageToken = d.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export function checkRef(ref) {
  return /^[\w-]{10,64}$/.test(String(ref)) ? null : "Paste the playlist ID: the part after list= in the playlist’s address.";
}

export async function videos(conn, ref, { fresh = false } = {}) {
  const err = checkRef(ref);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  const k = conn.id + ":" + ref;
  const hit = cache.get(k);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.videos;
  const ids = [];
  let pageToken = "";
  for (let page = 0; page < 4; page++) {
    const d = await get(conn, "/playlistItems", { part: "contentDetails", playlistId: ref, maxResults: 50, ...(pageToken ? { pageToken } : {}) });
    for (const it of d.items || []) if (it.contentDetails && it.contentDetails.videoId) ids.push(it.contentDetails.videoId);
    pageToken = d.nextPageToken;
    if (!pageToken) break;
  }
  const list = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await get(conn, "/videos", { part: "snippet,contentDetails,statistics,status", id: ids.slice(i, i + 50).join(",") });
    for (const v of d.items || []) {
      const privacy = v.status && v.status.privacyStatus;
      if (privacy === "private") continue; // can't be embedded for anyone but the owner
      const th = v.snippet.thumbnails || {};
      const t = th.maxres || th.standard || th.high || th.medium || th.default;
      const [w, h] = v.contentDetails.definition === "hd" ? [1920, 1080] : [0, 0];
      list.push(video({
        id: v.id, title: v.snippet.title, description: v.snippet.description,
        duration: isoDuration(v.contentDetails.duration), width: w, height: h,
        resolution: v.contentDetails.definition === "hd" ? "HD" : "",
        created: v.snippet.publishedAt, thumbnail: t ? t.url : null,
        link: `https://youtu.be/${v.id}`, manage: `https://studio.youtube.com/video/${v.id}/edit`, shareable: true,
        plays: v.statistics && v.statistics.viewCount != null ? Number(v.statistics.viewCount) : null,
        ready: !v.status || v.status.uploadStatus === "processed",
        playback: { kind: "youtube", id: v.id },
      }));
    }
  }
  list.sort((a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0));
  cache.set(k, { at: Date.now(), videos: list });
  return list;
}

export const forget = (conn, ref) => { for (const k of cache.keys()) if (k.startsWith(conn.id + ":") && (!ref || k === conn.id + ":" + ref)) cache.delete(k); };

export async function details() { return {}; }
