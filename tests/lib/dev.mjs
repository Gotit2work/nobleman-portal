// Local stand-in for Vercel serving the portal: static files with SPA fallback, /api/<name> → api/<name>.js,
// plus fakes for everything external so the whole portal runs offline:
//   FAKE_VIMEO=<fixtures.json>  api.vimeo.com (folders, videos, downloads, captions, chapters, me, uploads)
//   /__tus/<id>                 Vimeo's tus upload endpoint
//   /__blob/...                 Vercel Blob API (point VERCEL_BLOB_API_URL here)
//   /__mail                     emails "sent" through Resend (when RESEND_API_KEY is set)
//   Frame.io + Adobe sign-in, YouTube, Wistia, Notion, oEmbed: lib/fakes.mjs (GET /__fake/state shows their state)
// Usage: node dev.mjs <portal copy> <port>   (tests/run.sh starts three of these)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as fakes from "./fakes.mjs";

const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 4400);
const ORIGIN = `http://localhost:${port}`;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain" };

const realFetch = globalThis.fetch;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

// ---------- fake Vimeo ----------
const V = process.env.FAKE_VIMEO ? JSON.parse(fs.readFileSync(process.env.FAKE_VIMEO, "utf8")) : null;
const vimeoCalls = [];
const tus = new Map(); // id → { size, offset }
let nextVideo = 9000;
function findVideo(id) {
  for (const f of Object.values(V.folders)) { const v = f.videos.find((x) => x.uri === "/videos/" + id); if (v) return v; }
  return null;
}
async function fakeVimeo(u, init) {
  const method = (init && init.method) || "GET";
  vimeoCalls.push(method + " " + u.pathname);
  fs.appendFileSync((process.env.FAKE_BLOB_DIR || "/tmp") + "/vimeo.calls", method + " " + u.pathname + u.search + "\n");
  const auth = (init && init.headers && (init.headers.Authorization || init.headers.authorization)) || "";
  if (auth !== "bearer " + V.token) return json({ error: "Unauthorized" }, 401);
  let m;
  const p = u.pathname.replace(/^\/users\/\d+/, "/me");
  if (method === "GET" && p === "/me") return json(V.me);
  if (method === "GET" && p === "/oauth/verify") return json({ scope: V.scope });
  if (method === "GET" && p === "/me/projects") return json({ data: Object.entries(V.folders).map(([id, f]) => ({ uri: "/users/100/projects/" + id, name: f.name, modified_time: "2026-09-01T00:00:00Z", metadata: { connections: { videos: { total: f.videos.length } } } })), paging: {} });
  if (method === "GET" && (m = /^\/me\/projects\/(\d+)\/videos$/.exec(p))) {
    const f = V.folders[m[1]];
    return f ? json({ total: f.videos.length, data: f.videos, paging: {} }) : json({ error: "Not found" }, 404);
  }
  if (method === "GET" && (m = /^\/videos\/(\d+)$/.exec(p))) {
    const v = findVideo(m[1]);
    if (!v) return json({ error: "Not found" }, 404);
    return json({ download: (V.downloads || {})[m[1]] || [], privacy: v.privacy || {}, link: v.link });
  }
  if (method === "GET" && (m = /^\/videos\/(\d+)\/texttracks$/.exec(p))) return json({ data: (V.texttracks || {})[m[1]] || [] });
  if (method === "GET" && (m = /^\/videos\/(\d+)\/chapters$/.exec(p))) return json({ data: (V.chapters || {})[m[1]] || [] });
  if (method === "POST" && p === "/me/videos") {
    const body = JSON.parse(init.body);
    const fid = String(body.folder_uri || "").split("/").pop();
    if (!V.folders[fid]) return json({ error: "No folder" }, 400);
    const id = String(++nextVideo);
    V.folders[fid].videos.unshift({ uri: "/videos/" + id, name: body.name, status: "uploading", duration: 0, width: 0, height: 0, created_time: new Date().toISOString(), link: "https://vimeo.com/" + id, player_embed_url: "https://player.vimeo.com/video/" + id, pictures: { sizes: [] }, privacy: body.privacy || {} });
    tus.set(id, { size: Number(body.upload.size), offset: 0 });
    return json({ uri: "/videos/" + id, upload: { approach: "tus", upload_link: `${ORIGIN}/__tus/${id}` } });
  }
  return json({ error: "fake vimeo: unhandled " + method + " " + p }, 404);
}

// ---------- fake Vercel Blob ----------
const BLOB_DIR = process.env.FAKE_BLOB_DIR;
const blobs = new Map(); // pathname → { size, contentType }
if (BLOB_DIR) { try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(BLOB_DIR + "/blobs.json", "utf8")))) blobs.set(k, v); } catch {} }
const saveBlobs = () => BLOB_DIR && fs.writeFileSync(BLOB_DIR + "/blobs.json", JSON.stringify(Object.fromEntries(blobs)));
const b64url = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function fakeBlob(req, res, url, raw) {
  fs.appendFileSync((BLOB_DIR || "/tmp") + "/blob.calls", req.method + " " + url.pathname + url.search + "\n");
  const send = (o, s = 200) => { res.writeHead(s, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); res.end(JSON.stringify(o)); };
  if (req.method === "OPTIONS") return send({});
  const sub = url.pathname.replace(/^\/__blob/, "");
  if (req.method === "PUT") {
    const pathname = url.searchParams.get("pathname");
    blobs.set(pathname, { size: raw.length, contentType: req.headers["x-content-type"] || "application/octet-stream" });
    saveBlobs();
    const u = `https://teststore.private.blob.vercel-storage.com/${pathname}`;
    return send({ url: u, downloadUrl: u + "?download=1", pathname, contentType: blobs.get(pathname).contentType, contentDisposition: "attachment", etag: '"1"' });
  }
  if (req.method === "GET" && url.searchParams.get("url")) {
    const pathname = url.searchParams.get("url").replace(/^https:\/\/[^/]+\//, "");
    const b = blobs.get(pathname);
    if (!b) return send({ error: { code: "not_found", message: "The requested blob does not exist" } }, 404);
    const u = `https://teststore.private.blob.vercel-storage.com/${pathname}`;
    return send({ url: u, downloadUrl: u, pathname, size: b.size, contentType: b.contentType, contentDisposition: "attachment", cacheControl: "", uploadedAt: new Date().toISOString(), etag: '"1"' });
  }
  if (req.method === "POST" && sub === "/delete") {
    const { urls } = JSON.parse(raw.toString() || "{}");
    for (const u of urls || []) blobs.delete(String(u).replace(/^https:\/\/[^/]+\//, ""));
    saveBlobs();
    return send({});
  }
  if (req.method === "POST" && sub === "/signed-token") {
    const body = JSON.parse(raw.toString() || "{}");
    const validUntil = body.validUntil || Date.now() + 3600e3;
    return send({ delegationToken: b64url(JSON.stringify({ storeId: "teststore", pathname: body.pathname || "*", operations: body.operations || ["get"], validUntil })) + ".sig", clientSigningToken: b64url("fake-signing-key"), validUntil });
  }
  return send({ error: { code: "unhandled", message: req.method + " " + sub } }, 404);
}

// ---------- fake Resend ----------
const mail = [];

globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url || String(input));
  if (V && u.host === "api.vimeo.com") return fakeVimeo(u, init);
  if (u.host === "api.resend.com") {
    if (u.pathname === "/domains") return init.headers && /re_test/.test(init.headers.Authorization || "") ? json({ data: [{ name: "test.example", status: "verified" }] }) : json({ message: "API key is invalid" }, 401);
    mail.push(JSON.parse(init.body)); return json({ id: "mail_" + mail.length });
  }
  if (u.host === "ims-na1.adobelogin.com") return fakes.adobe(u, init);
  if (u.host === "api.frame.io") return fakes.frameio(u, init);
  if (u.host === "www.googleapis.com" && u.pathname.startsWith("/youtube/")) return fakes.youtube(u, init);
  if (u.host === "api.wistia.com") return fakes.wistia(u, init);
  if (u.host === "api.notion.com") return fakes.notion(u, init);
  if ((u.host === "www.youtube.com" && u.pathname === "/oembed") || (u.host === "vimeo.com" && u.pathname === "/api/oembed.json")) return fakes.oembed(u);
  return realFetch(input, init);
};

function helpers(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { if (!res.getHeader("content-type")) res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); return res; };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const p = decodeURIComponent(url.pathname);
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);

  if (p.startsWith("/__blob")) return fakeBlob(req, res, url, raw);
  if (p === "/__mail") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(mail)); }
  if (p === "/__fake/state") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(fakes.snapshot())); }
  if (p === "/__vimeo/state") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(V.folders)); }
  if (p === "/__vimeo/finish") { // mark every finished upload as transcoded
    for (const f of Object.values(V.folders)) for (const v of f.videos) if (v.status === "uploading" && tus.get(v.uri.split("/").pop())?.offset > 0) v.status = "available";
    res.writeHead(200); return res.end("ok");
  }
  if (p.startsWith("/__tus/")) {
    const id = p.split("/").pop(), t = tus.get(id);
    const h = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "PATCH,HEAD,OPTIONS", "access-control-expose-headers": "Upload-Offset,Upload-Length,Tus-Resumable", "Tus-Resumable": "1.0.0" };
    if (req.method === "OPTIONS") { res.writeHead(204, h); return res.end(); }
    if (!t) { res.writeHead(404, h); return res.end(); }
    if (req.method === "HEAD") { res.writeHead(200, { ...h, "Upload-Offset": String(t.offset), "Upload-Length": String(t.size) }); return res.end(); }
    if (req.method === "PATCH") {
      if (Number(req.headers["upload-offset"]) !== t.offset) { res.writeHead(409, h); return res.end(); }
      t.offset += raw.length;
      res.writeHead(204, { ...h, "Upload-Offset": String(t.offset) }); return res.end();
    }
  }

  if (p.startsWith("/api/")) {
    req.query = Object.fromEntries(url.searchParams);
    const file = path.join(root, p + ".js");
    if (!fs.existsSync(file) || path.basename(file).startsWith("_")) { res.statusCode = 404; return res.end("no such function"); }
    Object.defineProperty(req, "body", { get() {
      const s = raw.toString();
      if (!s) return undefined;
      if ((req.headers["content-type"] || "").includes("application/json")) return JSON.parse(s);
      return s;
    }});
    try {
      const mod = await import(pathToFileURL(file).href);
      await mod.default(req, helpers(res));
    } catch (e) {
      console.error("function crashed", e);
      if (!res.headersSent) { res.statusCode = 500; res.end("FUNCTION_INVOCATION_FAILED"); }
    }
    return;
  }
  let file = path.join(root, p === "/" ? "index.html" : p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // SPA fallback, as vercel.json's rewrite does: any path without a file extension is the app.
    if (!path.extname(p)) file = path.join(root, "index.html");
    else { res.writeHead(404, { "content-type": "text/plain" }); return res.end("404"); }
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log("portal dev on", port, "root", root));
