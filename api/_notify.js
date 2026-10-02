// Email through Resend: invitations, sign-in and reset links, review reminders, approval receipts, and updates.
// Off until a Resend connection exists (Studio → Connections), or RESEND_API_KEY + PORTAL_EMAIL_FROM are set in
// Vercel. Every email is branded with the studio's name (Studio → Settings) and its button goes straight to the
// page it's about. A failed email never fails the action that sent it.
//
// Updates are quiet: nobody is emailed about their own action, people who turned updates off (Account) aren't
// emailed, and someone using the portal right now isn't emailed (they see it there).
import { sql } from "./_db.js";
import { firstOf } from "./_connections.js";
import { getSettings } from "./_settings.js";
import { effectiveCaps } from "./_roles.js";
import { capsOf } from "./_caps.js";

const ACTIVE_MINUTES = 3;

export async function emailConnection() {
  const c = await firstOf("resend").catch(() => null);
  if (!c || !c.creds || !c.creds.apiKey) return null;
  const from = (c.config && c.config.from) || c.creds.from || process.env.PORTAL_EMAIL_FROM;
  return from ? { apiKey: c.creds.apiKey, from, replyTo: (c.config && c.config.replyTo) || null } : null;
}

export const emailReady = async () => !!(await emailConnection());

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** The branded email body. lines are plain text paragraphs; button is { label, href }. */
export function layout({ studio, eyebrow, lines, button, footer }) {
  return `<div style="background:#f4f4f2;padding:28px 12px"><div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:30px 28px;color:#0a0a0a">
<p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;margin:0 0 6px">${esc(studio)}${eyebrow ? " · " + esc(eyebrow) : ""}</p>
${lines.filter((l) => l !== null && l !== undefined && l !== "").map((l) => `<p style="font-size:16px;line-height:1.55;margin:0 0 14px;white-space:pre-wrap">${esc(l)}</p>`).join("")}
${button ? `<p style="margin:24px 0 8px"><a href="${esc(button.href)}" style="display:inline-block;padding:13px 24px;border-radius:30px;background:#031e25;color:#f4f4f2;text-decoration:none;font-size:15px;font-weight:600">${esc(button.label)}</a></p>` : ""}
${footer ? `<p style="font-size:13px;color:#6b7280;margin:18px 0 0;line-height:1.5">${esc(footer)}</p>` : ""}
</div></div>`;
}

/** Sends one email. Returns true when Resend accepted it. */
export async function sendEmail({ to, subject, html, text }) {
  const c = await emailConnection();
  if (!c) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + c.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from: c.from, to: Array.isArray(to) ? to : [to], subject, html, ...(text ? { text } : {}), ...(c.replyTo ? { reply_to: c.replyTo } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) { console.error("email: Resend answered", r.status, (await r.text()).slice(0, 200)); return false; }
    return true;
  } catch (err) {
    console.error("email failed", err.message);
    return false;
  }
}

/** The site's own origin, for links in emails. */
export function originOf(req) {
  const host = req && req.headers ? req.headers["x-forwarded-host"] || req.headers.host : null;
  if (!host) return "https://portal.noblemanproductions.gotit2work.com";
  return (/^localhost(:\d+)?$/.test(host) ? "http://" : "https://") + host;
}

/**
 * Tells people about something on a project.
 *   audience "staff": every staff member; "client": the project's client people.
 *   need: a capability the recipient must have on this project to care ("messages", "files", "review").
 *   path: where the button goes ("/review/<project>"), button: its label.
 */
export async function notify({ audience, project, actor, subject, lines, origin, path = "/", button = "Open the portal", need = null }) {
  try {
    if (!(await emailReady())) return;
    const s = await getSettings();
    const people = audience === "staff"
      ? await sql`select id, email, name, role, access, client_id, last_seen_at from users where role = 'admin' and notify_email and id <> ${actor ? actor.id : null}`
      : await sql`select id, email, name, role, access, client_id, last_seen_at from users where role = 'client' and client_id = ${project.client_id}
                  and notify_email and id <> ${actor ? actor.id : null}`;
    const caps = capsOf(project.capabilities);
    const recent = Date.now() - ACTIVE_MINUTES * 60 * 1000;
    const to = people.filter((u) => {
      if (u.last_seen_at && Date.parse(u.last_seen_at) > recent) return false;
      if (need && !effectiveCaps(u, caps, s)[need]) return false;
      return true;
    });
    if (!to.length) return;
    const html = layout({
      studio: s.brand.studio, eyebrow: project.title, lines,
      button: { label: button, href: origin + path },
      footer: "You can turn these emails off on your Account page in the portal.",
    });
    await Promise.all(to.map((u) => sendEmail({ to: u.email, subject, html })));
  } catch (err) {
    console.error("notify failed", err);
  }
}
