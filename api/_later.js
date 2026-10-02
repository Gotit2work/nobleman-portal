// Work that shouldn't make someone wait: emails, the Notion sync. On Vercel it runs after the response is sent
// (waitUntil keeps the function alive until it finishes). Anywhere else (the local test server) it's awaited,
// so tests see its effects straight away. Failures are logged, never thrown at the caller.
import { waitUntil } from "@vercel/functions";

export function later(work, label = "background work") {
  const p = Promise.resolve().then(work).catch((err) => console.error(label + " failed", err && err.message ? err.message : err));
  if (process.env.VERCEL) { waitUntil(p); return Promise.resolve(); }
  return p;
}
