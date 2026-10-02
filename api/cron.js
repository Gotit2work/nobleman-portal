import { sql, ready, dbConfigured } from "./_db.js";
import { sameText } from "./_crypto.js";
import { getSettings } from "./_settings.js";
import { dueReminders } from "./_reminders.js";
import { syncAll } from "./_notion.js";
import { listConnections } from "./_connections.js";
import { VIDEO } from "./_providers/index.js";
import { audit } from "./_audit.js";
import { reconcileOpen, announce } from "./_payments.js";
import { originOf } from "./_notify.js";

/**
 * The daily job (vercel.json → crons). Vercel calls it with "Authorization: Bearer <CRON_SECRET>"; without
 * CRON_SECRET set it does nothing. It:
 *   - sends review reminders that are due (Studio → Settings → Reminders),
 *   - refreshes Frame.io's Adobe sign-in so it doesn't lapse (Adobe's refresh tokens last about 14 days unused),
 *   - catches Notion up with anything that changed at the video sources,
 *   - asks Stripe about payments still open, in case its webhook didn't arrive,
 *   - prunes old records: activity log after about 13 months, used or expired links after a week, unconfirmed
 *     sign-ups after a day, handled sign-ups after 30 days.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  const auth = String(req.headers.authorization || "");
  if (!secret || !sameText(auth, "Bearer " + secret)) return res.status(401).json({ error: "Not allowed." });
  if (!dbConfigured()) return res.status(503).json({ error: "No database." });
  await ready();
  const s = await getSettings();
  const out = { reminders: 0, frameio: 0, notion: null, payments: 0, pruned: true };
  try { out.reminders = await dueReminders(s.brand.portal); } catch (err) { console.error("cron reminders", err.message); }
  try {
    for (const c of await listConnections({ withCreds: true })) {
      if (c.provider === "frameio" && c.creds.auth === "oauth" && c.creds.refreshToken) {
        await VIDEO.frameio.test(c).then(() => out.frameio++).catch((err) => console.error("cron frame.io", err.message));
      }
    }
  } catch (err) { console.error("cron connections", err.message); }
  try { out.notion = await syncAll(); } catch (err) { console.error("cron notion", err.message); }
  try {
    const changed = await reconcileOpen();
    for (const t of changed) await announce(t, { req, origin: s.brand.portal || originOf(req) });
    out.payments = changed.length;
  } catch (err) { console.error("cron payments", err.message); }
  try {
    await sql`delete from audit_log where at < now() - interval '400 days'`;
    await sql`delete from link_tokens where (used_at is not null or expires_at < now()) and created_at < now() - interval '7 days'`;
    await sql`delete from login_attempts where at < now() - interval '1 day'`;
    // Sign-ups: unconfirmed ones after a day; handled ones (approved, declined, joined) after 30 days.
    await sql`delete from signup_requests where (status = 'new' and created_at < now() - interval '1 day')
              or (status in ('approved', 'declined', 'joined') and coalesce(decided_at, created_at) < now() - interval '30 days')`;
  } catch (err) { out.pruned = false; console.error("cron prune", err.message); }
  if (out.reminders) await audit(req, null, "reminder", `Sent ${out.reminders} automatic review reminder${out.reminders === 1 ? "" : "s"}`);
  return res.status(200).json(out);
}
