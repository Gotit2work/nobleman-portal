// Notion: one row per project in a Notion database, kept up to date by the portal.
// Set up in Studio → Connections → Notion: paste an internal connection token, then either let the portal
// create the database under a page you shared with the connection, or choose an existing database (the portal
// adds the columns it needs). Rows update when a project changes, when a client decides on a version, when
// staff press "Sync now", and once a day (api/cron.js). The portal only writes its own columns; anything else
// in the database is left alone.
//
// API version 2026-03-11 (databases hold data sources; rows belong to a data source). Each row carries a
// "Portal ID" so it's found again if its page id is lost. Columns are written by their Notion property id, so
// renaming a column in Notion doesn't break the sync.
import { sql } from "./_db.js";
import { fetchJson } from "./_video.js";
import { getConnection, firstOf } from "./_connections.js";
import { getSettings, patchSection, stageNames, stagePct } from "./_settings.js";
import { capsOf } from "./_caps.js";
import { splitProject } from "./_sources.js";
import { cutsOut, reviewStatus } from "./_build.js";

const API = "https://api.notion.com/v1";
const VERSION = "2026-03-11";

/** The columns the portal keeps, with their Notion types. */
export const COLUMNS = {
  "Name": { title: {} },
  "Client": { rich_text: {} },
  "Stage": { select: {} },
  "Progress": { number: { format: "percent" } },
  "Review": { select: { options: [
    { name: "Waiting on client", color: "yellow" }, { name: "Changes requested", color: "orange" },
    { name: "Approved", color: "green" }, { name: "Nothing in review", color: "gray" }, { name: "Archived", color: "default" },
  ] } },
  "Latest version": { rich_text: {} },
  "Open notes": { number: { format: "number" } },
  "Next": { rich_text: {} },
  "Review by": { date: {} },
  "Last activity": { date: {} },
  "Portal": { url: {} },
  "Portal ID": { rich_text: {} },
};

function call(token, method, path, body) {
  return fetchJson(API + path, {
    method, body, label: "Notion", timeout: 12000,
    headers: { Authorization: "Bearer " + token, "Notion-Version": VERSION },
  });
}

/** Retries rate limits and overloads a few times, waiting as Notion asks. */
async function callRetry(token, method, path, body) {
  for (let i = 0; ; i++) {
    try { return await call(token, method, path, body); } catch (err) {
      const retry = err.status === 429 || err.status === 529 || err.status === 409;
      if (!retry || i >= 3) throw err;
      await new Promise((r) => setTimeout(r, Math.min(10, err.retryAfter || 2 ** i) * 1000));
    }
  }
}

const titleOf = (o) => ((o && (o.title || o.name)) || []).map((t) => t.plain_text || (t.text && t.text.content) || "").join("") || "Untitled";

export async function test(conn) {
  const me = await call(conn.creds.token, "GET", "/users/me");
  const ws = (me.bot && me.bot.workspace_name) || "Notion";
  const s = await getSettings();
  return {
    account: { name: ws },
    notes: s.notion.dataSourceId && s.notion.connectionId === conn.id ? [] : ["Next: choose where the projects go (a page to create the database in, or an existing database)."],
  };
}

/** Pages (to create the database under) and databases the connection can see. */
export async function search(conn, query, kind) {
  const d = await call(conn.creds.token, "POST", "/search", {
    query: String(query || "").slice(0, 100),
    filter: { property: "object", value: kind === "database" ? "data_source" : "page" },
    sort: { timestamp: "last_edited_time", direction: "descending" },
    page_size: 50,
  });
  return (d.results || []).map((r) => ({
    id: r.id, title: kind === "database" ? titleOf(r) : titleOf(Object.values(r.properties || {}).find((p) => p.type === "title")),
    databaseId: r.parent && r.parent.database_id ? r.parent.database_id : null, url: r.url || null,
  }));
}

/** Property ids by our column name, from a data source's schema. */
function propIds(schema) {
  const out = {};
  for (const [name, def] of Object.entries(schema.properties || {})) out[name] = { id: def.id, type: def.type };
  return out;
}

/** Creates the projects database under a page and remembers it. */
export async function createDatabase(conn, pageId, title = "Client portal projects") {
  const d = await call(conn.creds.token, "POST", "/databases", {
    parent: { type: "page_id", page_id: pageId },
    title: [{ type: "text", text: { content: title } }],
    initial_data_source: { properties: COLUMNS },
  });
  const ds = (d.data_sources || [])[0];
  if (!ds) throw new Error("Notion created the database but didn’t say where its rows go. Try choosing it as an existing database.");
  return useDataSource(conn, ds.id, { databaseId: d.id, url: d.url });
}

/** Uses an existing data source: adds the columns it lacks, refuses one whose column has the wrong type. */
export async function useDataSource(conn, dataSourceId, extra = {}) {
  const token = conn.creds.token;
  let schema = await call(token, "GET", `/data_sources/${dataSourceId}`);
  const have = propIds(schema);
  const titleCol = Object.entries(have).find(([, v]) => v.type === "title");
  const missing = {};
  const wrong = [];
  for (const [name, def] of Object.entries(COLUMNS)) {
    const type = Object.keys(def)[0];
    if (type === "title") continue; // every database has exactly one title column: we use it, whatever it's called
    if (!have[name]) missing[name] = def;
    else if (have[name].type !== type) wrong.push(`“${name}” is a ${have[name].type.replace("_", " ")} column, not ${type.replace("_", " ")}`);
  }
  if (wrong.length) throw Object.assign(new Error(`This database has columns the portal can’t use: ${wrong.join("; ")}. Rename them, or choose another database.`), { status: 400 });
  if (Object.keys(missing).length) schema = await call(token, "PATCH", `/data_sources/${dataSourceId}`, { properties: missing });
  const ids = propIds(schema);
  const props = { Name: titleCol ? titleCol[1].id : "title" };
  for (const name of Object.keys(COLUMNS)) if (name !== "Name" && ids[name]) props[name] = ids[name].id;
  const databaseId = extra.databaseId || (schema.parent && schema.parent.database_id) || null;
  await patchSection("notion", {
    connectionId: conn.id, dataSourceId, databaseId, props, url: extra.url || (databaseId ? `https://www.notion.so/${databaseId.replace(/-/g, "")}` : null),
    title: titleOf(schema), lastError: null,
  });
  return { dataSourceId, databaseId };
}

/** The Notion side is set up and its connection still exists. */
async function target() {
  const s = await getSettings();
  const n = s.notion;
  if (!n.connectionId || !n.dataSourceId) return null;
  const conn = await getConnection(n.connectionId);
  if (!conn || !conn.creds || !conn.creds.token) return null;
  return { conn, n, s };
}

const rt = (s) => [{ type: "text", text: { content: String(s || "").slice(0, 1900) } }];

/** The row's values for one project. */
async function rowFor(p, s) {
  const names = stageNames(s);
  const stage = Math.max(0, Math.min(names.length - 1, p.stage_idx || 0));
  let cuts = [], latest = "";
  try {
    const split = await splitProject(p);
    const [decisions, counts] = await Promise.all([
      sql`select distinct on (video_id) project_id, video_id, decision, note, user_name, created_at from approvals where project_id = ${p.id} order by video_id, created_at desc`,
      sql`select project_id, video_id, count(*)::int as total, count(*) filter (where not resolved and parent_id is null)::int as open from comments where project_id = ${p.id} group by project_id, video_id`,
    ]);
    const rd = { dec: new Map(decisions.map((d) => [p.id + ":" + d.video_id, d])), cnt: new Map(counts.map((c) => [p.id + ":" + c.video_id, c])) };
    cuts = cutsOut(p, split, rd, { history: false, stats: false }, false);
    latest = cuts.map((c) => {
      const v = c.versions[c.versions.length - 1];
      const d = v.decision ? (v.decision.decision === "approved" ? "approved" : "changes requested") : "waiting";
      return `${c.title} V${v.n} (${d})`;
    }).join(", ");
  } catch { /* the source is unreachable: sync what we know */ }
  const open = cuts.reduce((n, c) => n + c.versions[c.versions.length - 1].comments.open, 0);
  const status = p.archived ? "Archived" : reviewStatus(cuts).label;
  const next = [p.next_label, p.next_what, p.next_date].filter(Boolean).join(" · ");
  const pct = (p.pct > 0 ? p.pct : stagePct(s, stage)) / 100;
  return {
    Name: { title: rt(p.title) },
    Client: { rich_text: rt(p.client_name) },
    Stage: { select: { name: names[stage].replace(/,/g, " ") } },
    Progress: { number: Math.round(pct * 100) / 100 },
    Review: { select: { name: status } },
    "Latest version": { rich_text: rt(latest) },
    "Open notes": { number: open },
    Next: { rich_text: rt(next) },
    "Review by": { date: p.review_due ? { start: new Date(p.review_due).toISOString().slice(0, 10) } : null },
    "Last activity": { date: { start: new Date(p.updated_at || Date.now()).toISOString() } },
    Portal: { url: `${s.brand.portal}/projects/${p.id}` },
    "Portal ID": { rich_text: rt(p.id) },
  };
}

/** Our column names → the database's property ids. */
const keyed = (values, props) => Object.fromEntries(Object.entries(values).filter(([k]) => props[k]).map(([k, v]) => [props[k], v]));

/** Creates or updates one project's row. Quietly does nothing when Notion isn't set up. */
export async function syncProject(projectId) {
  const t = await target().catch(() => null);
  if (!t) return { skipped: true };
  const p = (await sql`select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id where p.id = ${projectId}`)[0];
  if (!p) return { skipped: true };
  const token = t.conn.creds.token;
  const props = t.n.props || {};
  const properties = keyed(await rowFor(p, t.s), props);
  try {
    if (p.notion_page_id) {
      try {
        await callRetry(token, "PATCH", `/pages/${p.notion_page_id}`, { properties, in_trash: false });
        await noteResult(null);
        return { updated: true };
      } catch (err) {
        if (err.status !== 404 && err.status !== 400) throw err; // deleted or trashed: find it or recreate it
      }
    }
    const found = props["Portal ID"] ? await callRetry(token, "POST", `/data_sources/${t.n.dataSourceId}/query`, {
      filter: { property: props["Portal ID"], rich_text: { equals: p.id } }, page_size: 1,
    }) : { results: [] };
    let pageId;
    if (found.results && found.results[0]) {
      pageId = found.results[0].id;
      await callRetry(token, "PATCH", `/pages/${pageId}`, { properties, in_trash: false });
    } else {
      const created = await callRetry(token, "POST", "/pages", { parent: { type: "data_source_id", data_source_id: t.n.dataSourceId }, properties });
      pageId = created.id;
    }
    await sql`update projects set notion_page_id = ${pageId} where id = ${p.id}`;
    await noteResult(null);
    return { created: true };
  } catch (err) {
    await noteResult(err.message);
    throw err;
  }
}

/** Moves a deleted project's row to Notion's trash. */
export async function trashProjectRow(pageId) {
  const t = await target().catch(() => null);
  if (!t || !pageId) return;
  await callRetry(t.conn.creds.token, "PATCH", `/pages/${pageId}`, { in_trash: true }).catch((err) => console.error("notion trash failed", err.message));
}

/** Every project, one at a time (Notion allows about three requests a second). */
export async function syncAll() {
  const t = await target();
  if (!t) return { synced: 0, failed: 0, skipped: true };
  const ids = await sql`select id from projects order by updated_at desc limit 500`;
  let synced = 0, failed = 0, lastError = null;
  for (const { id } of ids) {
    try { await syncProject(id); synced++; } catch (err) { failed++; lastError = err.message; }
    await new Promise((r) => setTimeout(r, 400));
  }
  await patchSection("notion", { lastSync: new Date().toISOString(), lastError: failed ? lastError : null });
  return { synced, failed };
}

/** Keeps Studio's "last synced" and "last problem" current, writing settings at most once a minute when fine. */
async function noteResult(error) {
  const s = await getSettings();
  if (error) return patchSection("notion", { lastError: String(error).slice(0, 300) });
  const stale = !s.notion.lastSync || Date.now() - Date.parse(s.notion.lastSync) > 60000;
  if (s.notion.lastError || stale) await patchSection("notion", { lastError: null, lastSync: new Date().toISOString() });
}

export const notionConnection = () => firstOf("notion");
