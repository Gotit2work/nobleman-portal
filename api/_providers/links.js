// Video links: no account needed. Staff add videos to a project by pasting a link (Studio → project → Videos →
// Add a video by link). Works for YouTube, Vimeo, Google Drive, Loom, Wistia, Dropbox, and direct video files.
// Name versions "Title V2" as with any other source.
import { sql } from "../_db.js";
import { video, fetchJson } from "../_video.js";

export const meta = {
  key: "links",
  name: "Video links",
  kind: "video",
  builtin: true,
  blurb: "No account needed: paste a YouTube, Vimeo, Google Drive, Loom, Wistia, Dropbox, or video file link.",
  fields: [],
  source: null,
  features: { downloads: false, captions: false, chapters: false, upload: false, stats: false, versions: "Name versions “Title V2”, “Title V3”." },
};

/**
 * What a pasted link is and how to play it, or { error }. Only hosts that allow their player inside another
 * site are accepted; anything else would show a blank frame to the client.
 */
export function parseLink(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return { error: "That isn’t a web address. Paste the whole link, starting with https://." }; }
  if (u.protocol !== "https:") return { error: "Use an https:// link." };
  const host = u.hostname.replace(/^www\./, "");
  let m;
  if (host === "youtu.be" && (m = /^\/([\w-]{11})/.exec(u.pathname))) return yt(m[1]);
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    const id = u.searchParams.get("v") || (/^\/(?:embed|shorts|live)\/([\w-]{11})/.exec(u.pathname) || [])[1];
    if (id && /^[\w-]{11}$/.test(id)) return yt(id);
  }
  if (host === "vimeo.com" && (m = /^\/(?:.*\/)?(\d{6,12})(?:\/([0-9a-f]{6,20}))?/.exec(u.pathname))) {
    return { playback: { kind: "vimeo", id: m[1], hash: m[2] || u.searchParams.get("h") || null }, host: "Vimeo" };
  }
  if (host === "player.vimeo.com" && (m = /^\/video\/(\d{6,12})/.exec(u.pathname))) {
    return { playback: { kind: "vimeo", id: m[1], hash: u.searchParams.get("h") || null }, host: "Vimeo" };
  }
  if (host === "drive.google.com" && (m = /^\/file\/d\/([\w-]{10,})/.exec(u.pathname))) {
    return { playback: { kind: "iframe", url: `https://drive.google.com/file/d/${m[1]}/preview` }, host: "Google Drive" };
  }
  if (host === "loom.com" && (m = /^\/(?:share|embed)\/([0-9a-f]{20,})/.exec(u.pathname))) {
    return { playback: { kind: "iframe", url: `https://www.loom.com/embed/${m[1]}` }, host: "Loom" };
  }
  if ((/(^|\.)wistia\.(com|net)$/.test(host) || host === "wi.st") && (m = /\/(?:medias|iframe|embed\/iframe)\/([a-z0-9]{6,})/i.exec(u.pathname))) {
    return { playback: { kind: "iframe", url: `https://fast.wistia.net/embed/iframe/${m[1]}` }, host: "Wistia" };
  }
  if (host === "dropbox.com" || host === "dl.dropboxusercontent.com") {
    u.searchParams.delete("dl");
    u.searchParams.set("raw", "1");
    return { playback: { kind: "file", url: u.toString() }, host: "Dropbox" };
  }
  if (/\.(mp4|m4v|mov|webm)$/i.test(u.pathname)) return { playback: { kind: "file", url: u.toString() }, host: host };
  if (/frame\.io$/.test(host)) return { error: "Frame.io links can’t play inside another site. Connect Frame.io in Studio → Connections instead." };
  return { error: "That link can’t play inside the portal. Use a YouTube, Vimeo, Google Drive, Loom, Wistia, or Dropbox link, or a direct link to a video file (.mp4, .mov)." };
}
const yt = (id) => ({ playback: { kind: "youtube", id }, host: "YouTube" });

/**
 * Title, thumbnail, and duration from the host's public oEmbed, when it has one. Best effort: a link still
 * works without them.
 */
export async function lookup(url, parsed) {
  try {
    const p = parsed.playback;
    if (p.kind === "youtube") {
      const d = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + p.id)}`, { timeout: 5000, label: "YouTube" });
      return { title: d.title, thumbnail: `https://i.ytimg.com/vi/${p.id}/hqdefault.jpg` };
    }
    if (p.kind === "vimeo") {
      const d = await fetchJson(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`, { timeout: 5000, label: "Vimeo" });
      return { title: d.title, thumbnail: d.thumbnail_url, duration: d.duration };
    }
  } catch { /* fine: staff can type the title */ }
  return {};
}

export async function test() {
  return { account: { name: "Video links" }, notes: [] };
}

export async function sources() { return []; }
export const checkRef = () => null;
export const forget = () => {};

/** The links added to this project. `ref` is unused: the project itself holds them. */
export async function videos(conn, ref, { projectId } = {}) {
  const rows = await sql`select * from link_videos where project_id = ${projectId} order by created_at desc`;
  return rows.map((r) => {
    const parsed = parseLink(r.url);
    return video({
      id: r.id.replace(/-/g, ""),
      title: r.title, description: r.description, duration: r.duration || 0,
      created: r.created_at ? new Date(r.created_at).toISOString() : null,
      thumbnail: r.thumbnail || null,
      link: r.url,
      shareable: parsed.playback && parsed.playback.kind !== "file",
      ready: !parsed.error,
      playback: parsed.playback || { kind: "iframe", url: "about:blank" },
    });
  });
}

export async function details() { return {}; }
