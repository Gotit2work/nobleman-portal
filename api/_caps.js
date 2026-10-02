// What a client may do on a project. Admins switch these per project in Studio → Projects; the API enforces
// them on every request (the page only hides what is off). Admins themselves can always do everything.
//
// Adding one: add it here (key, label, plain-words detail, default), enforce it in the route that does the
// thing, and the Studio toggle appears on its own.

export const CAPABILITIES = [
  { key: "review", label: "Review versions", detail: "Watch each version and leave notes pinned to a moment in the film.", default: true },
  { key: "approve", label: "Approve versions", detail: "Approve a version, or ask for changes. Needs Review versions.", default: true, needs: "review" },
  { key: "download", label: "Download finished films", detail: "Download finished films in the sizes Vimeo has ready.", default: true },
  { key: "download_source", label: "Download original files", detail: "Also offer the original, full-quality file. Very large. Needs Download finished films.", default: false, needs: "download" },
  { key: "captions", label: "Captions and chapters", detail: "Download caption files and jump between chapters.", default: true },
  { key: "share", label: "Share links", detail: "Copy a private link to a finished film, to pass to colleagues.", default: false },
  { key: "stats", label: "Play counts", detail: "See how many times each finished film has been played on Vimeo or through a shared link. Plays in this portal aren’t counted.", default: false },
  { key: "files", label: "Files from Nobleman", detail: "See and download documents you add: quotes, schedules, call sheets.", default: true },
  { key: "upload", label: "Uploads", detail: "Send files and footage to Nobleman. Videos go into this project's Vimeo folder.", default: false },
  { key: "messages", label: "Messages", detail: "Message Nobleman about this project.", default: true },
];

const KEYS = new Set(CAPABILITIES.map((c) => c.key));

/** The project's effective capabilities: stored values over defaults, with dependencies applied. */
export function capsOf(stored) {
  const s = stored && typeof stored === "object" ? stored : {};
  const out = {};
  for (const c of CAPABILITIES) out[c.key] = typeof s[c.key] === "boolean" ? s[c.key] : c.default;
  for (const c of CAPABILITIES) if (c.needs && !out[c.needs]) out[c.key] = false;
  return out;
}

/** Everything on: what an admin gets on every project. */
export const ALL_CAPS = Object.fromEntries(CAPABILITIES.map((c) => [c.key, true]));

/** Keeps only known keys with boolean values, for saving. */
export function cleanCaps(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input)) if (KEYS.has(k) && typeof v === "boolean") out[k] = v;
  return out;
}

export const STAGES = ["Planning", "Filming", "Editing", "Your review", "Final polish", "Delivered"];
// Progress shown for each stage when the project's own percentage hasn't been set.
export const STAGE_PCT = [8, 25, 50, 70, 88, 100];
