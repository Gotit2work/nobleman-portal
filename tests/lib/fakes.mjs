// Stand-ins for the outside services the portal talks to, so tests run offline. Each takes (url, init) like
// fetch and returns a Response. State lives in memory per server; GET /__fake/state shows it.
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
const body = (init) => { try { return JSON.parse(init && init.body ? String(init.body) : "{}"); } catch { return {}; } };
const auth = (init) => { const h = (init && init.headers) || {}; return h.Authorization || h.authorization || ""; };
const ago = (d) => new Date(Date.now() - d * 86400e3).toISOString();

export const state = {
  frameio: { tokens: new Set(), refresh: new Set(["fio-refresh-0"]), grants: [], comments: new Map(), webhooks: new Map(), n: 0, calls: [] },
  notion: { databases: new Map(), dataSources: new Map(), pages: new Map(), calls: [] },
  stripe: { sessions: new Map(), n: 0, calls: [] },
};

// ---------- Stripe (Checkout Sessions) ----------
// Keys starting sk_test_ work, except sk_test_bad. /__stripe/pay in dev.mjs plays the client paying.
export async function stripe(u, init) {
  const key = auth(init).replace(/^Bearer /, "");
  const S = state.stripe;
  S.calls.push((init.method || "GET") + " " + u.pathname);
  if (!/^(sk|rk)_test_/.test(key) || key === "sk_test_bad") return json({ error: { message: "Invalid API Key provided: " + key.slice(0, 12) + "…" } }, 401);
  if (u.pathname === "/v1/account") return json({ id: "acct_test", email: "studio@nobleman.test", settings: { dashboard: { display_name: "Nobleman Productions" } } });
  if (u.pathname === "/v1/checkout/sessions" && (init.method || "GET") === "GET") return json({ object: "list", data: [...S.sessions.values()].slice(-1) });
  if (u.pathname === "/v1/checkout/sessions" && init.method === "POST") {
    const f = new URLSearchParams(String(init.body || ""));
    const id = "cs_test_" + (++S.n);
    const s = {
      id, object: "checkout.session", status: "open", payment_status: "unpaid", url: "https://checkout.stripe.com/c/pay/" + id,
      amount_total: Number(f.get("line_items[0][price_data][unit_amount]")), currency: f.get("line_items[0][price_data][currency]"),
      metadata: { payment: f.get("metadata[payment]"), project: f.get("metadata[project]") }, client_reference_id: f.get("client_reference_id"),
      customer_email: f.get("customer_email"), success_url: f.get("success_url"), cancel_url: f.get("cancel_url"), payment_intent: null, customer_details: null,
      name: f.get("line_items[0][price_data][product_data][name]"),
    };
    S.sessions.set(id, s);
    return json(s);
  }
  const m = /^\/v1\/checkout\/sessions\/([\w]+)(\/expire)?$/.exec(u.pathname);
  if (m) {
    const s = S.sessions.get(m[1]);
    if (!s) return json({ error: { message: "No such checkout.session: " + m[1] } }, 404);
    if (m[2]) { if (s.status !== "open") return json({ error: { message: "Only open sessions can be expired." } }, 400); s.status = "expired"; }
    return json(s);
  }
  return json({ error: { message: "Unrecognized request URL: " + u.pathname } }, 404);
}

/** The client finishing checkout: paid by card, or a bank payment still on its way (bank=1). */
export function stripePay(id, bank) {
  const s = state.stripe.sessions.get(id);
  if (!s) return null;
  s.status = "complete";
  s.payment_status = bank ? "unpaid" : "paid";
  s.payment_intent = "pi_" + id.slice(8);
  s.customer_details = { email: s.customer_email, name: "Dana Whitfield" };
  return s;
}

// ---------- Adobe IMS + Frame.io V4 ----------
const FIO = {
  account: "acc-0000-0001",
  root: "f0000000-0000-4000-8000-0000000000f1",
  stack: { id: "vs000000-0000-4000-8000-000000000001", name: "Ocean Cut" },
  files: {
    "fv000000-0000-4000-8000-000000000001": { name: "Ocean Cut v1.mp4", created_at: ago(9), status: "transcoded" },
    "fv000000-0000-4000-8000-000000000002": { name: "Ocean Cut v2.mp4", created_at: ago(2), status: "transcoded" },
    "fz000000-0000-4000-8000-000000000001": { name: "Final Deliverable.mp4", created_at: ago(5), status: "transcoded" },
    "fz000000-0000-4000-8000-000000000002": { name: "Raw Upload.mov", created_at: ago(1), status: "uploaded" },
  },
};
const fioFile = (id, include = "") => {
  const f = FIO.files[id];
  const ml = {};
  if (include.includes("thumbnail")) ml.thumbnail = { url: `https://fio.example/thumb/${id}.png?sig=1` };
  if (include.includes("high_quality")) ml.high_quality = { download_url: `https://fio.example/hq/${id}.mp4?sig=1`, url: `https://fio.example/hq/${id}.mp4?sig=1&inline=1` };
  if (include.includes("efficient")) ml.efficient = { download_url: `https://fio.example/eff/${id}.mp4?sig=1` };
  if (include.includes("original")) ml.original = { download_url: `https://fio.example/orig/${id}.mov?sig=1`, inline_url: null };
  return { id, type: "file", name: f.name, status: f.status, media_type: f.name.endsWith(".mov") ? "video/quicktime" : "video/mp4", created_at: f.created_at, view_url: `https://next.frame.io/view/${id}`, media_links: ml };
};

export async function adobe(u, init) {
  if (u.pathname === "/ims/token/v3") {
    const p = new URLSearchParams(String(init.body || ""));
    const g = p.get("grant_type");
    state.frameio.grants.push(g);
    if (g === "client_credentials" && p.get("client_id") === "fio-client" && p.get("client_secret") === "fio-secret") return issue();
    const basic = auth(init).replace(/^Basic /, "");
    const ok = Buffer.from(basic, "base64").toString() === "fio-client:fio-secret";
    if (g === "authorization_code" && ok && p.get("code") === "good-code") return issue(true);
    if (g === "refresh_token" && ok && state.frameio.refresh.has(p.get("refresh_token"))) return issue(true);
    return json({ error: "invalid_grant", error_description: "bad credentials" }, 400);
  }
  return json({ error: "not found" }, 404);
}
function issue(withRefresh) {
  const t = "fio-access-" + (state.frameio.tokens.size + 1);
  state.frameio.tokens.add(t);
  const out = { access_token: t, expires_in: 86399, token_type: "bearer" };
  if (withRefresh) { const r = "fio-refresh-" + state.frameio.tokens.size; state.frameio.refresh.add(r); out.refresh_token = r; }
  return json(out);
}

export async function frameio(u, init) {
  const a = auth(init).replace(/^Bearer /, "");
  const legacy = ((init.headers || {})["x-frameio-legacy-token-auth"]) === "true";
  if (!(state.frameio.tokens.has(a) || (legacy && a === "fio-legacy-token"))) return json({ errors: [{ detail: "Unauthorized" }] }, 401);
  const p = u.pathname.replace(/^\/v4/, "");
  const inc = u.searchParams.get("include") || "";
  let m;
  if (p === "/me") return json({ data: { id: "user-1", name: "Jean Gotay", email: "jean@nobleman.test" } });
  if (p === "/accounts") return json({ data: [{ id: FIO.account, display_name: "Nobleman Productions" }], links: {} });
  if (p === `/accounts/${FIO.account}/projects`) return json({ data: [{ id: "proj-1", name: "Ocean Campaign", root_folder_id: FIO.root, updated_at: ago(1) }], links: {} });
  if (p === `/accounts/${FIO.account}/folders/${FIO.root}/children`) {
    return json({ data: [
      { id: FIO.stack.id, type: "version_stack", name: FIO.stack.name, head_version: { id: "fv000000-0000-4000-8000-000000000002" } },
      fioFile("fz000000-0000-4000-8000-000000000001", inc),
      fioFile("fz000000-0000-4000-8000-000000000002", inc),
      { id: "folder-1", type: "folder", name: "Selects" },
      { id: "doc-1", type: "file", name: "Script.pdf", media_type: "application/pdf", status: "uploaded" },
    ], links: {} });
  }
  if ((m = new RegExp(`^/accounts/${FIO.account}/folders/([\\w-]+)/children$`).exec(p))) return json({ errors: [{ detail: "Not found" }] }, 404);
  if (p === `/accounts/${FIO.account}/version_stacks/${FIO.stack.id}/children`) {
    return json({ data: [fioFile("fv000000-0000-4000-8000-000000000002", inc), fioFile("fv000000-0000-4000-8000-000000000001", inc)], links: {} });
  }
  if ((m = new RegExp(`^/accounts/${FIO.account}/files/([\\w-]+)$`).exec(p)) && FIO.files[m[1]]) return json({ data: fioFile(m[1], inc) });
  // Comments and webhooks (the portal's two-way notes, _fio_sync.js).
  const F = state.frameio, method = init.method || "GET";
  F.calls.push(method + " " + p);
  if ((m = new RegExp(`^/accounts/${FIO.account}/files/([\\w-]+)/comments$`).exec(p)) && FIO.files[m[1]]) {
    if (method === "POST") {
      const d = body(init).data || {};
      if (!d.text) return json({ errors: [{ detail: "text is required" }] }, 422);
      return json({ data: fioComment(addComment({ file_id: m[1], text: d.text, timestamp: d.timestamp ?? null })) }, 201);
    }
    const top = [...F.comments.values()].filter((c) => c.file_id === m[1] && !c.parent_id);
    return json({ data: top.map((c) => fioComment(c, inc)), links: {} });
  }
  if ((m = new RegExp(`^/accounts/${FIO.account}/comments/([\\w-]+)$`).exec(p))) {
    const c = F.comments.get(m[1]);
    if (!c) return json({ errors: [{ detail: "Not found" }] }, 404);
    if (method === "DELETE") { for (const [k, x] of F.comments) if (k === c.id || x.parent_id === c.id) F.comments.delete(k); return new Response(null, { status: 204 }); }
    if (method === "PATCH") { const d = body(init).data || {}; if (d.completed !== undefined) c.completed_at = d.completed ? new Date().toISOString() : null; if (d.text) c.text = d.text; }
    return json({ data: fioComment(c, inc) });
  }
  if (p === `/accounts/${FIO.account}/workspaces`) return json({ data: [{ id: "ws-1", name: "Nobleman" }], links: {} });
  if ((m = new RegExp(`^/accounts/${FIO.account}/workspaces/([\\w-]+)/webhooks$`).exec(p)) && method === "POST") {
    const d = body(init).data || {};
    const w = { id: "wh-" + (++F.n), workspace_id: m[1], name: d.name, url: d.url, events: d.events, secret: "whsec-fio-" + F.n };
    F.webhooks.set(w.id, w);
    return json({ data: w }, 201);
  }
  if ((m = new RegExp(`^/accounts/${FIO.account}/webhooks/([\\w-]+)$`).exec(p)) && method === "DELETE") { F.webhooks.delete(m[1]); return new Response(null, { status: 204 }); }
  return json({ errors: [{ detail: "Not found " + p }] }, 404);
}

// A comment as Frame.io's V4 API returns it: owner and replies when asked for, timestamp as stored (a timecode).
const FIO_USERS = { jean: { id: "user-1", name: "Jean Gotay", email: "jean@nobleman.test" }, editor: { id: "user-2", name: "Eddie Editor", email: "eddie@studio.test" } };
function fioComment(c, inc = "") {
  const o = { id: c.id, file_id: c.file_id, text: c.text, timestamp: c.timestamp, created_at: c.created_at, updated_at: c.created_at, completed_at: c.completed_at || null };
  if (inc.includes("owner")) o.owner = c.owner;
  if (inc.includes("replies")) o.replies = [...state.frameio.comments.values()].filter((x) => x.parent_id === c.id).map((x) => fioComment(x, inc.replace("replies", "")));
  return o;
}
/** A comment made "in Frame.io": by the connected account (Jean) unless owner says otherwise. */
export function addComment({ file_id, text, timestamp = null, parent_id = null, owner = "jean" }) {
  const F = state.frameio;
  const c = { id: "fc-" + String(++F.n).padStart(4, "0"), file_id, text, timestamp, parent_id, owner: FIO_USERS[owner] || FIO_USERS.jean, created_at: new Date().toISOString(), completed_at: null };
  F.comments.set(c.id, c);
  return c;
}
export function editComment(id, patch) {
  const c = state.frameio.comments.get(id);
  if (!c) return null;
  if (patch.completed !== undefined) c.completed_at = patch.completed ? new Date().toISOString() : null;
  if (patch.text) c.text = patch.text;
  if (patch.delete) for (const [k, x] of state.frameio.comments) if (k === id || x.parent_id === id) state.frameio.comments.delete(k);
  return c;
}
/** Plays Frame.io's webhook: a signed POST of { type, resource } to every webhook the portal created. */
export async function fireWebhook(type, resourceId, { badSignature = false, oldTimestamp = false } = {}) {
  const { createHmac } = await import("node:crypto");
  const out = [];
  for (const w of state.frameio.webhooks.values()) {
    const raw = JSON.stringify({ type, resource: { id: resourceId, type: type.split(".")[0] }, account: { id: FIO.account }, workspace: { id: w.workspace_id }, user: { id: "user-1" } });
    const ts = String(Math.floor(Date.now() / 1000) - (oldTimestamp ? 3600 : 0));
    const sig = "v0=" + createHmac("sha256", badSignature ? "wrong-secret" : w.secret).update(`v0:${ts}:${raw}`).digest("hex");
    const r = await fetch(w.url, { method: "POST", headers: { "content-type": "application/json", "x-frameio-request-timestamp": ts, "x-frameio-signature": sig, "user-agent": "Frame.io V4 API" }, body: raw });
    out.push(r.status);
  }
  return out;
}

// ---------- YouTube Data API ----------
const YT = {
  key: "yt-key", channel: "UCtestchannel0000000001", playlist: "PLtestplaylist00001",
  videos: [
    { id: "ytAAAAAAAA1", title: "Launch Teaser V1", privacy: "unlisted", at: ago(6), dur: "PT45S", views: 12 },
    { id: "ytAAAAAAAA2", title: "Launch Teaser V2", privacy: "public", at: ago(2), dur: "PT47S", views: 30 },
    { id: "ytAAAAAAAA3", title: "Secret", privacy: "private", at: ago(1), dur: "PT10S", views: 0 },
    { id: "ytAAAAAAAA4", title: "Brand Story", privacy: "public", at: ago(4), dur: "PT2M5S", views: 900 },
  ],
};
export async function youtube(u) {
  if (u.searchParams.get("key") !== YT.key) return json({ error: { code: 400, message: "API key not valid." } }, 400);
  const p = u.pathname.replace("/youtube/v3", "");
  if (p === "/i18nLanguages") return json({ items: [] });
  if (p === "/channels") return json({ items: u.searchParams.get("id") === YT.channel ? [{ id: YT.channel, snippet: { title: "Nobleman Productions" } }] : [] });
  if (p === "/playlists") return json({ items: [{ id: YT.playlist, snippet: { title: "Launch", publishedAt: ago(10) }, contentDetails: { itemCount: 4 } }] });
  if (p === "/playlistItems") {
    if (u.searchParams.get("playlistId") !== YT.playlist) return json({ error: { code: 404, message: "playlistNotFound" } }, 404);
    return json({ items: YT.videos.map((v) => ({ contentDetails: { videoId: v.id } })) });
  }
  if (p === "/videos") {
    const ids = (u.searchParams.get("id") || "").split(",");
    return json({ items: YT.videos.filter((v) => ids.includes(v.id)).map((v) => ({
      id: v.id, snippet: { title: v.title, description: "", publishedAt: v.at, thumbnails: { high: { url: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` } } },
      contentDetails: { duration: v.dur, definition: "hd" }, statistics: { viewCount: String(v.views) }, status: { privacyStatus: v.privacy, uploadStatus: "processed" },
    })) });
  }
  return json({ error: { code: 404, message: "not found" } }, 404);
}

// ---------- Wistia v1 ----------
const asset = (type, w, h, id) => ({ type, width: w, height: h, fileSize: 1000 * w, contentType: "video/mp4", url: `https://embed-ssl.wistia.com/deliveries/${id}.bin` });
const WI = {
  token: "wistia-token",
  medias: [
    { hashed_id: "wmdemo0001", name: "Product Demo V1", duration: 61.2, created: ago(8), status: "ready", thumbnail: { url: "https://embed-ssl.wistia.com/deliveries/t1.jpg" }, assets: [asset("OriginalFile", 3840, 2160, "o1"), asset("HdMp4VideoFile", 1920, 1080, "h1")] },
    { hashed_id: "wmdemo0002", name: "Product Demo V2", duration: 59.9, created: ago(3), status: "ready", thumbnail: { url: "https://embed-ssl.wistia.com/deliveries/t2.jpg" }, assets: [asset("OriginalFile", 3840, 2160, "o2"), asset("HdMp4VideoFile", 1920, 1080, "h2")] },
    { hashed_id: "wmdemo0003", name: "Customer Story", duration: 140, created: ago(5), status: "ready", thumbnail: { url: "https://embed-ssl.wistia.com/deliveries/t3.jpg" }, assets: [asset("OriginalFile", 3840, 2160, "o3"), asset("Mp4VideoFile", 960, 540, "m3"), asset("HdMp4VideoFile", 1920, 1080, "h3")] },
  ],
};
export async function wistia(u, init) {
  if (auth(init) !== "Bearer " + WI.token) return json({ error: "Unauthorized" }, 401);
  const p = u.pathname.replace("/v1", "");
  let m;
  if (p === "/account.json") return json({ name: "Nobleman on Wistia", url: "https://nobleman.wistia.com" });
  if (p === "/projects.json") return json([{ id: 501, hashedId: "wproj00001", name: "Wistia Project", mediaCount: 3, updated: ago(1) }]);
  if (p === "/projects/wproj00001.json") return json({ id: 501, hashedId: "wproj00001", name: "Wistia Project" });
  if (p === "/medias.json") return json(u.searchParams.get("project_id") === "501" && u.searchParams.get("page") === "1" ? WI.medias : []);
  if ((m = /^\/medias\/(\w+)\.json$/.exec(p))) { const x = WI.medias.find((y) => y.hashed_id === m[1]); return x ? json(x) : json({ error: "nf" }, 404); }
  if ((m = /^\/medias\/(\w+)\/captions\.json$/.exec(p))) return json(m[1] === "wmdemo0003" ? [{ language: "eng", english_name: "English", text: "1\n00:00:01,000 --> 00:00:02,000\nHello\n" }] : []);
  return json({ error: "not found" }, 404);
}

// ---------- Notion ----------
let nid = 0;
const uuid = (prefix) => `${prefix}${String(++nid).padStart(4, "0")}-0000-4000-8000-${String(nid).padStart(12, "0")}`.slice(0, 36);
export const NOTION = { token: "ntn_test_token", page: "11112222-3333-4444-5555-666677778888" };
export async function notion(u, init) {
  const N = state.notion;
  N.calls.push((init.method || "GET") + " " + u.pathname);
  if (auth(init) !== "Bearer " + NOTION.token) return json({ object: "error", code: "unauthorized", message: "API token is invalid." }, 401);
  if (((init.headers || {})["Notion-Version"]) !== "2026-03-11") return json({ object: "error", code: "missing_version", message: "Notion-Version header" }, 400);
  const p = u.pathname.replace("/v1", "");
  const b = body(init);
  const method = init.method || "GET";
  let m;
  if (p === "/users/me") return json({ object: "user", type: "bot", bot: { workspace_name: "Nobleman HQ" } });
  if (p === "/search" && method === "POST") {
    if (b.filter && b.filter.value === "page") return json({ results: [{ object: "page", id: NOTION.page, url: "https://app.notion.com/p/studio", properties: { title: { type: "title", title: [{ plain_text: "Studio HQ" }] } } }] });
    return json({ results: [...N.dataSources.values()].map((d) => ({ object: "data_source", id: d.id, title: [{ plain_text: d.title }], parent: { database_id: d.databaseId } })) });
  }
  if (p === "/databases" && method === "POST") {
    if (b.parent.page_id !== NOTION.page) return json({ object: "error", code: "object_not_found", message: "Could not find page." }, 404);
    const db = uuid("db"), ds = uuid("ds");
    const props = {};
    for (const [name, def] of Object.entries(b.initial_data_source.properties)) props[name] = { id: name === "Name" ? "title" : uuid("pr").slice(0, 8), type: Object.keys(def)[0], name };
    N.dataSources.set(ds, { id: ds, databaseId: db, title: b.title[0].text.content, properties: props });
    N.databases.set(db, { id: db });
    return json({ object: "database", id: db, url: "https://app.notion.com/p/" + db, data_sources: [{ id: ds, name: b.title[0].text.content }] });
  }
  if ((m = /^\/data_sources\/([\w-]+)$/.exec(p))) {
    const d = N.dataSources.get(m[1]);
    if (!d) return json({ object: "error", code: "object_not_found", message: "Not shared" }, 404);
    if (method === "PATCH") for (const [name, def] of Object.entries(b.properties || {})) d.properties[name] = { id: uuid("pr").slice(0, 8), type: Object.keys(def)[0], name };
    return json({ object: "data_source", id: d.id, parent: { database_id: d.databaseId }, title: [{ plain_text: d.title }], properties: d.properties });
  }
  if ((m = /^\/data_sources\/([\w-]+)\/query$/.exec(p))) {
    const f = b.filter;
    const rows = [...N.pages.values()].filter((pg) => pg.ds === m[1] && !pg.in_trash && (!f || ((pg.properties[f.property] || {}).rich_text || [])[0]?.text?.content === f.rich_text.equals));
    return json({ results: rows.map((r) => ({ id: r.id })) });
  }
  if (p === "/pages" && method === "POST") {
    const id = uuid("pg");
    N.pages.set(id, { id, ds: b.parent.data_source_id, properties: b.properties, in_trash: false });
    return json({ object: "page", id });
  }
  if ((m = /^\/pages\/([\w-]+)$/.exec(p)) && method === "PATCH") {
    const pg = N.pages.get(m[1]);
    if (!pg) return json({ object: "error", code: "object_not_found", message: "Not found" }, 404);
    if (b.properties) pg.properties = { ...pg.properties, ...b.properties };
    if (typeof b.in_trash === "boolean") pg.in_trash = b.in_trash;
    return json({ object: "page", id: pg.id });
  }
  return json({ object: "error", code: "invalid_request_url", message: p }, 400);
}

// ---------- oEmbed (video links) ----------
export async function oembed(u) {
  if (u.hostname.endsWith("youtube.com")) return json({ title: "Linked YouTube Film", thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg" });
  return json({ title: "Linked Vimeo Film V1", thumbnail_url: "https://i.vimeocdn.com/video/x.jpg", duration: 95 });
}

export function snapshot() {
  return {
    frameio: { grants: state.frameio.grants, tokens: state.frameio.tokens.size, comments: [...state.frameio.comments.values()], webhooks: [...state.frameio.webhooks.values()].map(({ secret, ...w }) => w), calls: state.frameio.calls },
    notion: { pages: [...state.notion.pages.values()], dataSources: [...state.notion.dataSources.values()], calls: state.notion.calls },
    stripe: { sessions: [...state.stripe.sessions.values()], calls: state.stripe.calls },
  };
}
