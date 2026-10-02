import { sql } from "./_db.js";

// Optional email notifications through Resend. Off until both are set:
//   RESEND_API_KEY     an API key from resend.com (the account whose domain is verified)
//   PORTAL_EMAIL_FROM  a sender on that verified domain, e.g. "Nobleman Portal <portal@send.gotit2work.com>"
// Staff hear about client notes, decisions, messages, and uploads; clients hear about staff messages.
// Each person can turn emails off on their Account page. A failed email never fails the action itself.

export const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.PORTAL_EMAIL_FROM);

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * audience: "staff" (every admin) or "client" (the project's client users). The person who acted is never
 * emailed about their own action.
 */
export async function notify({ audience, project, actor, subject, lines, origin }) {
  if (!emailConfigured()) return;
  try {
    const people = audience === "staff"
      ? await sql`select email, name from users where role = 'admin' and notify_email and id <> ${actor.id}`
      : await sql`select email, name from users where role = 'client' and client_id = ${project.client_id}
                  and notify_email and id <> ${actor.id}`;
    if (!people.length) return;
    const link = (origin || "https://portal.noblemanproductions.gotit2work.com") + "/";
    const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;color:#0a0a0a">
<p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;margin:0 0 8px">${esc(project.title)}</p>
${lines.map((l) => `<p style="font-size:16px;line-height:1.55;margin:0 0 14px;white-space:pre-wrap">${esc(l)}</p>`).join("")}
<p style="margin:22px 0"><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;border-radius:30px;background:#031e25;color:#f4f4f2;text-decoration:none;font-size:15px">Open the portal</a></p>
<p style="font-size:13px;color:#6b7280;margin:0">You can turn these emails off on your Account page in the portal.</p></div>`;
    await Promise.all(people.map((p) => fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.PORTAL_EMAIL_FROM, to: [p.email], subject, html }),
      signal: AbortSignal.timeout(5000),
    }).then((r) => { if (!r.ok) console.error("notify: Resend answered", r.status); }).catch((e) => console.error("notify failed", e.message))));
  } catch (err) {
    console.error("notify failed", err);
  }
}

/** The site's own origin, for links in emails. */
export function originOf(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return host ? `https://${host}` : undefined;
}
