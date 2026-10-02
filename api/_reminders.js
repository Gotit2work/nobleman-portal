// Review reminders: an email to a client's decision makers that a version is waiting for them, with the review
// date if there is one. Sent by staff (Studio → project → "Send a reminder") or automatically by the daily job
// (api/cron.js) the configured number of days before the project's review date, once per date.
import { sql } from "./_db.js";
import { getSettings } from "./_settings.js";
import { permsOf } from "./_roles.js";
import { capsOf } from "./_caps.js";
import { splitProject } from "./_sources.js";
import { layout, sendEmail } from "./_notify.js";

/** Versions whose newest version has no decision yet: "Harbor Spot Version 3". */
export async function waitingVersions(p) {
  const split = await splitProject(p);
  if (!split.cuts.length) return [];
  const dec = await sql`select distinct on (video_id) video_id from approvals where project_id = ${p.id} order by video_id, created_at desc`;
  const decided = new Set(dec.map((d) => d.video_id));
  return split.cuts.map((c) => c.versions[c.versions.length - 1]).filter((v) => !decided.has(v.video.id)).map((v) => `${v.video.baseTitle || v.video.title} Version ${v.n}`);
}

const longDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

/** Sends the reminder. Returns how many people were emailed (0 when nothing is waiting or nobody to tell). */
export async function remind(p, origin, { manual = false } = {}) {
  const s = await getSettings();
  if (!capsOf(p.capabilities).approve) return 0;
  const waiting = await waitingVersions(p);
  if (!waiting.length) return 0;
  const people = (await sql`select id, email, name, role, access from users where role = 'client' and client_id = ${p.client_id} and notify_email`)
    .filter((x) => permsOf(x, s).approve);
  if (!people.length) return 0;
  const due = p.review_due ? new Date(p.review_due).toISOString().slice(0, 10) : null;
  const list = waiting.length === 1 ? waiting[0] : waiting.slice(0, -1).join(", ") + " and " + waiting[waiting.length - 1];
  let sent = 0;
  for (const x of people) {
    const html = layout({
      studio: s.brand.studio, eyebrow: p.title,
      lines: [`Hi ${x.name.split(" ")[0]},`, `${list} ${waiting.length === 1 ? "is" : "are"} ready for you${due ? `, with review planned by ${longDate(due)}` : ""}.`,
        "Watch, leave a note on anything you’d change, then approve it or ask for changes. It takes a few minutes, and it keeps the schedule on track."],
      button: { label: "Review it now", href: `${origin}/review/${p.id}` },
      footer: manual ? "Sent by the studio from the client portal." : "An automatic reminder from the client portal. You can turn these emails off on your Account page.",
    });
    if (await sendEmail({ to: x.email, subject: `Ready for your review: ${waiting[0]}${waiting.length > 1 ? ` and ${waiting.length - 1} more` : ""}`, html })) sent++;
  }
  if (sent) await sql`update projects set reminded_at = now() where id = ${p.id}`;
  return sent;
}

/** The daily job's part: projects whose review date is within the reminder window and not yet reminded. */
export async function dueReminders(origin) {
  const s = await getSettings();
  if (!s.reminders.enabled) return 0;
  const days = Math.max(0, Math.min(14, Number(s.reminders.daysBefore) || 0));
  const rows = await sql`
    select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id
    where not p.archived and p.review_due is not null and p.reminded_at is null
      and p.review_due <= (current_date + make_interval(days => ${days}))::date and p.review_due >= current_date - 1`;
  let n = 0;
  for (const p of rows) {
    try { if (await remind(p, origin)) n++; } catch (err) { console.error("reminder failed", p.id, err.message); }
  }
  return n;
}
