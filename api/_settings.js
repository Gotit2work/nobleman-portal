// Portal-wide settings that staff change in Studio → Settings, so nothing here needs a code change.
// Stored as one JSON value per section in the settings table (key "s:<section>"); anything missing falls back
// to DEFAULTS. Read through getSettings(), which caches for a few seconds per server instance.
import { sql } from "./_db.js";
import { CAPABILITIES } from "./_caps.js";

export const DEFAULTS = {
  brand: {
    studio: "Nobleman Productions",
    support: "alexis@gotit2work.com",
    website: "https://noblemanproductions.gotit2work.com",
    privacy: "https://noblemanproductions.gotit2work.com/privacy#portal",
    // The portal's own address, for links in emails the daily job sends and in Notion.
    portal: "https://portal.noblemanproductions.gotit2work.com",
    // The line above Messages for clients: who they're writing to, and when to expect a reply.
    replies: "Write to Jean and Justin about this project. They usually reply the same business day.",
  },
  // The Murphy's Law on the sign-in screen (docs/WRITING.md, "Voice").
  signin: {
    kicker: "Murphy’s Law, review edition",
    quote: "The one frame nobody checked is the one everyone sees.",
    answer: "So every version comes here first, for you to check before it’s final.",
  },
  welcome: {
    title: "Welcome to your screening room.",
    text: "Every version of your film lands here first. Watch it, pause on anything you’d change and leave a note, then approve it when it’s right.",
  },
  // A short notice at the top of every page, for everyone signed in. Empty = none.
  announcement: { text: "", tone: "info" },
  stages: [
    { name: "Planning", pct: 8 },
    { name: "Filming", pct: 25 },
    { name: "Editing", pct: 50 },
    { name: "Your review", pct: 70 },
    { name: "Final polish", pct: 88 },
    { name: "Delivered", pct: 100 },
  ],
  // What a new project's client can do, before anyone changes it (Studio → Settings → New projects).
  caps: Object.fromEntries(CAPABILITIES.map((c) => [c.key, c.default])),
  // Overrides to what each role may do (_roles.js has the defaults; Studio → People → Roles edits these).
  roles: {},
  security: {
    staffTwoStep: false,     // staff must turn on two-step sign-in
    signinLinks: true,       // "Email me a sign-in link" on the sign-in screen (needs email)
    sessionDays: 7,          // how long a sign-in lasts
    clientTeams: true,       // decision makers can add teammates from their own company
  },
  email: { fromName: "Nobleman Productions", from: "", replyTo: "" },
  reminders: { enabled: true, daysBefore: 1 },
  notion: { connectionId: null, databaseId: null, dataSourceId: null, url: null, lastSync: null, lastError: null },
};

const CACHE_MS = 5000;
let cache = null;

/** Every section, stored values over defaults (one query, cached briefly). */
export async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await sql`select key, value from settings where key like 's:%'`;
  const stored = {};
  for (const r of rows) {
    try { stored[r.key.slice(2)] = JSON.parse(r.value); } catch { /* a damaged value falls back to its default */ }
  }
  const value = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    const s = stored[k];
    value[k] = Array.isArray(def) ? (Array.isArray(s) && s.length ? s : def)
      : def && typeof def === "object" ? { ...def, ...(s && typeof s === "object" && !Array.isArray(s) ? s : {}) }
      : s ?? def;
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Replaces one section. Callers validate first (see cleanSection in api/admin.js). */
export async function saveSection(section, value) {
  if (!(section in DEFAULTS)) throw new Error("Unknown settings section " + section);
  await sql`insert into settings (key, value) values (${"s:" + section}, ${JSON.stringify(value)})
            on conflict (key) do update set value = excluded.value`;
  cache = null;
}

/** Merges into one section (for small updates like the Notion sync status). */
export async function patchSection(section, patch) {
  const s = await getSettings({ fresh: true });
  await saveSection(section, { ...s[section], ...patch });
}

export const forgetSettings = () => { cache = null; };

/** Stage names and the progress shown for each, from settings. */
export const stageNames = (s) => s.stages.map((x) => x.name);
export const stagePct = (s, i) => (s.stages[i] ? s.stages[i].pct : 0);
