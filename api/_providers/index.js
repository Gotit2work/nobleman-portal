// Every kind of connection the portal knows, and what Studio shows when adding one.
// Adding a video source: write a module like ./youtube.js (meta, test, sources, checkRef, videos, forget,
// details, and play if its videos are files with expiring addresses), then list it here.
import * as vimeo from "./vimeo.js";
import * as frameio from "./frameio.js";
import * as youtube from "./youtube.js";
import * as wistia from "./wistia.js";
import * as links from "./links.js";
import * as stripe from "../_payments.js";

export const VIDEO = { vimeo, frameio, youtube, wistia, links };

// Not video sources, but added the same way (Studio → Connections).
export const OTHER = {
  notion: {
    meta: {
      key: "notion", name: "Notion", kind: "tracking",
      blurb: "Keeps one row per project up to date in a Notion database: stage, progress, review status, next step.",
      fields: [{ key: "token", label: "Internal connection token", secret: true, help: "app.notion.com/developers/connections → Internal connections → Create a new connection → Configuration: copy the API token (starts with ntn_) and turn on Read, Update, and Insert content. Then in Notion, open the page that should hold the projects → ••• → Connections → + Add connection." }],
    },
  },
  resend: {
    meta: {
      key: "resend", name: "Email (Resend)", kind: "email",
      blurb: "Sends invitations, sign-in links, reminders, approval receipts, and updates.",
      fields: [
        { key: "apiKey", label: "API key", secret: true, help: "resend.com → API Keys → Create (sending access, your verified domain)." },
        { key: "from", label: "Send from", config: true, placeholder: "Nobleman Productions <portal@gotit2work.com>", help: "Must be on a domain verified in Resend." },
        { key: "replyTo", label: "Replies go to (optional)", config: true, placeholder: "jean@noblemanproductions.com" },
      ],
    },
  },
};

// Payments: Stripe's module is the connection (meta, test) and the payment logic (_payments.js).
OTHER.stripe = stripe;

export const PROVIDERS = { ...VIDEO, ...OTHER };

/** What the page needs to draw the "Add a connection" forms. Never includes credentials. */
export function providerList() {
  return Object.values(PROVIDERS).map(({ meta }) => ({
    key: meta.key, name: meta.name, kind: meta.kind, blurb: meta.blurb, builtin: !!meta.builtin,
    fields: meta.fields || [], source: meta.source || null, features: meta.features || null, scopes: meta.scopes || null,
  }));
}

export const LINKS_ID = "links"; // the built-in "Video links" source needs no connection row
