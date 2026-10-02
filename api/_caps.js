// What a client may do on a project. Staff switch these per project in Studio → Projects; the API enforces
// them on every request (the page only hides what is off). Each person's role narrows them further
// (_roles.js: a viewer can't leave notes even where Review is on). Staff can always do everything.
//
// Adding one is the one change that needs code: add it here (key, label, plain-words detail, default),
// enforce it in the route that does the thing, and the Studio switch appears on its own.

export const CAPABILITIES = [
  { key: "review", label: "Review versions", detail: "Watch each version and leave notes pinned to a moment in the film.", default: true },
  { key: "approve", label: "Approve versions", detail: "Approve a version, or ask for changes. Needs Review versions.", default: true, needs: "review" },
  { key: "history", label: "Earlier versions", detail: "See earlier versions next to the newest one. Off: only the newest version shows, so there’s never a choice to make.", default: false, needs: "review" },
  { key: "download", label: "Download finished films", detail: "Download finished films in the sizes the video host has ready.", default: true },
  { key: "download_source", label: "Download original files", detail: "Also offer the original, full-quality file. Very large. Needs Download finished films.", default: false, needs: "download" },
  { key: "captions", label: "Captions and chapters", detail: "Download caption files and jump between chapters.", default: true },
  { key: "share", label: "Share links", detail: "Create a branded link to a finished film for colleagues. Links can expire and be turned off.", default: false },
  { key: "stats", label: "Play counts", detail: "See how many times each finished film has been played on its video host and through share links. Plays in this portal aren’t counted.", default: false },
  { key: "files", label: "Files from the studio", detail: "See and download documents you add: quotes, schedules, call sheets.", default: true },
  { key: "upload", label: "Uploads", detail: "Send files and footage to the studio. With a Vimeo source, videos go into the project’s folder.", default: false },
  { key: "messages", label: "Messages", detail: "Message the studio about this project.", default: true },
  { key: "payments", label: "Payments", detail: "See and pay what the studio asks for, by card or bank on Stripe’s secure checkout. Needs Stripe in Studio → Connections.", default: true },
  { key: "payfirst", label: "Downloads after payment", detail: "Finished films can be downloaded once everything asked for on the project is paid. Watching is never held.", default: false, needs: "payments" },
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

/** Keeps only known keys with boolean values, for saving. */
export function cleanCaps(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input)) if (KEYS.has(k) && typeof v === "boolean") out[k] = v;
  return out;
}

// Stages now live in settings (Studio → Settings → Stages; _settings.js). These are only the demo's.
export const STAGES = ["Planning", "Filming", "Editing", "Your review", "Final polish", "Delivered"];
export const STAGE_PCT = [8, 25, 50, 70, 88, 100];
