// Portal-wide settings that staff change in Studio → Settings, so nothing here needs a code change.
// Stored as one JSON value per section in the settings table (key "s:<section>"); anything missing falls back
// to DEFAULTS. Read through getSettings(), which caches for a few seconds per server instance.
import crypto from "node:crypto";
import { sql } from "./_db.js";
import { CAPABILITIES } from "./_caps.js";

// The studio's web address. The website is https://<HOME> and the portal https://portal.<HOME>. Moving to another
// domain (noblemanproductions.com) is scripts/move-domain.mjs plus the steps in the website repo's docs/MOVE.md;
// a live portal switches with Studio → Settings → Studio details → Portal address, which is checked before saving.
export const HOME = "noblemanproductions.gotit2work.com";

// The studio's first owner (Jean): until a staff account exists, only these addresses can create an account, and
// the one confirmed becomes the owner. It's one person with two addresses: either one logs in (user_emails).
export const OWNER_EMAILS = ["jeancgotay@gmail.com", "jean@noblemanproductions.com"];

export const DEFAULTS = {
  brand: {
    studio: "Nobleman Productions",
    support: "alexis@gotit2work.com",
    // Empty = automatic: the portal's address without "portal.", and its /privacy page (see addresses()).
    website: "",
    privacy: "",
    // The portal's own address: links in emails and Notion, and where other addresses send people (app/main.js).
    portal: `https://portal.${HOME}`,
    // The line above Messages for clients: who they're writing to, and when to expect a reply.
    replies: "Write to Jean and Justin about this project. They usually reply the same business day.",
  },
  // The login screen's photo.
  signin: {
    image: "/media/login-camera.jpg", // one of the portal's photos, or "upload:brand/login-<id>.jpg" (LOGIN_UPLOAD)
    focus: "right",                    // which side of the photo stays in view: left | center | right
  },
  // A short notice at the top of every page, for everyone logged in. Empty = none.
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
    staffTwoStep: false,     // staff must turn on two-step verification
    signinLinks: true,       // "Email me a login link" on the login screen (needs email)
    sessionDays: 7,          // how long a login lasts
    clientTeams: true,       // decision makers can add teammates from their own company
    signup: "request",       // who can create an account: "off" (invitation only) | "request" (anyone; the studio approves)
    domainJoin: true,        // people at a client's email domain join that client without waiting (Studio → Clients)
    domainRole: "reviewer",  // the role they join with
  },
  email: { fromName: "Nobleman Productions", from: "", replyTo: "" },
  reminders: { enabled: true, daysBefore: 1 },
  notion: { connectionId: null, databaseId: null, dataSourceId: null, url: null, lastSync: null, lastError: null },
};

/** The addresses everything links to. The website and privacy page follow the portal unless set in Studio. */
export function addresses(brand = {}) {
  const portal = String(brand.portal || DEFAULTS.brand.portal).replace(/\/+$/, "");
  const website = String(brand.website || portal.replace("://portal.", "://")).replace(/\/+$/, "");
  return { portal, website, privacy: brand.privacy || `${website}/privacy#portal` };
}

/** Brand settings with the addresses filled in; `auto` says which ones were left to follow the portal. */
export const resolveBrand = (brand) => ({ ...brand, ...addresses(brand), auto: { website: !brand.website, privacy: !brand.privacy } });

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
  value.brand = resolveBrand(value.brand);
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

/** This portal's own ID, made once. Another address proves it serves this same portal by answering with it. */
let instance = null;
export async function instanceId() {
  if (instance) return instance;
  await sql`insert into settings (key, value) values ('instance', ${crypto.randomUUID()}) on conflict (key) do nothing`;
  instance = (await sql`select value from settings where key = 'instance'`)[0].value;
  return instance;
}

/** Stage names and the progress shown for each, from settings. */
export const stageNames = (s) => s.stages.map((x) => x.name);
export const stagePct = (s, i) => (s.stages[i] ? s.stages[i].pct : 0);

// The login screen's photo (Studio → Settings → Login screen): one of the portal's own in media/, or one staff
// uploaded to file storage, served by GET /api/session?loginImage=<id>.
export const LOGIN_MEDIA = /^\/media\/[\w-]+\.jpg$/;
export const LOGIN_UPLOAD = /^upload:(brand\/login-([0-9a-f-]{36})\.jpg)$/;
export const MAX_LOGIN_IMAGE = 8 * 1024 ** 2;
