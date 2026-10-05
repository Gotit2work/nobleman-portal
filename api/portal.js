import bcrypt from "bcryptjs";
import { sql, ready, dbConfigured } from "./_db.js";
import { TROUBLE, readBody, requireUser, requireStaff, projectFor, isUuid, longText, text } from "./_auth.js";
import { buildPortal } from "./_build.js";
import { demoPortal, demoStudioPortal } from "./_demo.js";
import { findVideo } from "./_sources.js";
import { notify, originOf, emailReady, layout, sendEmail } from "./_notify.js";
import { audit } from "./_audit.js";
import { getSettings } from "./_settings.js";
import { isStaff, permsOf, can, CLIENT_ROLES, accessOf, roleLabel } from "./_roles.js";
import { randomToken, hashToken, seal, open } from "./_crypto.js";
import { createLink, emailLink } from "./_links.js";
import { later } from "./_later.js";
import { syncProject } from "./_notion.js";
import { stripeConnection, checkout, reconcile, announce, paymentOut } from "./_payments.js";
import { pullNotes, pushNote, pushDecision, pushDone, pushDelete } from "./_fio_sync.js";

/**
 * GET  /api/portal                        everything the signed-in person can see (see _build.js)
 * GET  /api/portal?demo=1                 the sample portal, for studio staff (nothing saved)
 * GET  /api/portal?thread=<project>       a project's messages; marks them read
 * GET  /api/portal?notes=<project>&video=<id>   review notes on one version
 * GET  /api/portal?shares=<project>       share links on a project
 * GET  /api/portal?team=1                 a decision maker's teammates
 * POST /api/portal {action}               note | resolve | deleteNote | decide | message | deleteMessage |
 *                                         seen | downloaded | confirmNext | shareCreate | shareRevoke |
 *                                         teamAdd | teamUpdate | teamRemove | pay | payCheck
 *
 * Every action re-checks that the person may see the project, that the project allows it (_caps.js), and that
 * their role does (_roles.js).
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const q = req.query || {};
  if (!dbConfigured()) return res.status(503).json({ error: "The portal isn’t connected to its database yet." });
  try { await ready(); } catch (err) { console.error("db not ready", err); return res.status(500).json({ error: TROUBLE }); }
  // The sample portal, for studio staff (Client's view at the top): sample data only, nothing saved.
  if (req.method === "GET" && q.demo) { const s = await requireStaff(req, res); return s ? res.status(200).json(q.demo === "studio" ? demoStudioPortal() : demoPortal()) : undefined; }

  const u = await requireUser(req, res);
  if (!u) return;
  try {
    if (req.method === "GET") {
      if (q.thread) return await thread(req, res, u, String(q.thread));
      if (q.notes) return await notes(req, res, u, String(q.notes), String(q.video || ""));
      if (q.shares) return await shares(req, res, u, String(q.shares));
      if (q.team) return await team(req, res, u);
      // Remembered so emails wait while someone is using the portal (_notify.js).
      sql`update users set last_seen_at = now() where id = ${u.id} and (last_seen_at is null or last_seen_at < now() - interval '1 minute')`.catch(() => {});
      return res.status(200).json(await buildPortal(u));
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const b = readBody(req, res);
    if (!b) return;
    const fn = ACTIONS[b.action];
    if (!fn) return res.status(400).json({ error: "Unknown action." });
    return await fn(req, res, u, b);
  } catch (err) {
    console.error("portal action failed", err);
    if (err.status && err.status < 500) return res.status(502).json({ error: "The video source isn’t answering right now. Try again in a minute." });
    return res.status(500).json({ error: TROUBLE });
  }
}

const NOT_FOUND = { error: "That project isn’t available to you." };

/** One payment the person may see: on a project they can reach, with Payments switched on for them. */
async function payFor(req, res, u, b) {
  const pay = isUuid(b.paymentId) ? (await sql`select * from payments where id = ${b.paymentId} and status <> 'canceled'`)[0] : null;
  const p = pay && (await projectFor(u, pay.project_id));
  if (!p) { res.status(404).json({ error: "That payment isn’t available to you." }); return null; }
  if (!p.caps.payments) { res.status(403).json(OFF("Payments")); return null; }
  return { p, pay };
}
const OFF = (what) => ({ error: `${what} isn’t switched on for you on this project. Ask the studio if you need it.` });
const iso = (d) => (d ? new Date(d).toISOString() : null);
const touch = (p) => sql`update projects set updated_at = now() where id = ${p.id}`;

async function thread(req, res, u, pid) {
  const p = await projectFor(u, pid);
  if (!p) return res.status(404).json(NOT_FOUND);
  if (!p.caps.messages) return res.status(403).json(OFF("Messages"));
  const rows = await sql`
    select id, author_name, author_role, author_id, body, created_at from messages
    where project_id = ${p.id} order by created_at asc limit 300`;
  await sql`insert into message_reads (user_id, project_id, seen_at) values (${u.id}, ${p.id}, now())
            on conflict (user_id, project_id) do update set seen_at = now()`;
  const mod = can(u, "notes.moderate", await getSettings());
  return res.status(200).json({
    messages: rows.map((m) => ({ id: m.id, author: m.author_name, role: m.author_role, mine: m.author_id === u.id, canRemove: mod || m.author_id === u.id, body: m.body, at: iso(m.created_at) })),
  });
}

async function notes(req, res, u, pid, videoId) {
  const p = await projectFor(u, pid);
  if (!p) return res.status(404).json(NOT_FOUND);
  if (!p.caps.review) return res.status(403).json(OFF("Review"));
  if (!/^[\w-]{1,80}$/.test(videoId)) return res.status(400).json({ error: "That video isn’t valid." });
  // Frame.io projects: bring in comments made there first (_fio_sync.js). A slow Frame.io never holds the notes up
  // for more than a few seconds; the read finishes in the background and shows next time.
  await Promise.race([pullNotes(p, videoId).catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
  const rows = await sql`
    select id, parent_id, at_seconds, body, author_id, author_name, author_role, resolved, created_at, origin from comments
    where project_id = ${p.id} and video_id = ${videoId} order by created_at asc limit 500`;
  const mod = can(u, "notes.moderate", await getSettings());
  const top = rows.filter((r) => !r.parent_id).map((r) => ({
    id: r.id, at: r.at_seconds == null ? null : Number(r.at_seconds), body: r.body, author: r.author_name,
    role: r.author_role, mine: r.author_id === u.id, canRemove: mod || r.author_id === u.id, resolved: r.resolved, when: iso(r.created_at), replies: [],
    via: r.origin === "frameio" ? "frameio" : null,
  }));
  const byId = new Map(top.map((t) => [t.id, t]));
  for (const r of rows.filter((x) => x.parent_id)) {
    const t = byId.get(r.parent_id);
    if (t) t.replies.push({ id: r.id, body: r.body, author: r.author_name, role: r.author_role, mine: r.author_id === u.id, canRemove: mod || r.author_id === u.id, when: iso(r.created_at), via: r.origin === "frameio" ? "frameio" : null });
  }
  top.sort((a, b) => (a.at ?? 1e9) - (b.at ?? 1e9));
  return res.status(200).json({ notes: top });
}

/** A version or film of this project the person can see, or null. */
const videoFor = (u, p, id) => findVideo(p, String(id || ""), { staff: isStaff(u) });

async function noteRow(u, id) {
  if (!isUuid(id)) return null;
  const r = (await sql`select id, project_id, author_id, parent_id from comments where id = ${id}`)[0];
  if (!r) return null;
  const p = await projectFor(u, r.project_id);
  return p ? { r, p } : null;
}

const ACTIONS = {
  async note(req, res, u, b) {
    // A reply belongs to its note's project, whatever the request says.
    let projectId = b.projectId;
    if (b.parentId && isUuid(b.parentId)) {
      const pr = (await sql`select project_id from comments where id = ${b.parentId}`)[0];
      if (pr) projectId = pr.project_id;
    }
    const p = await projectFor(u, projectId);
    if (!p) return res.status(404).json(NOT_FOUND);
    if (!p.caps.notes) return res.status(403).json(OFF("Leaving notes"));
    const body = longText(b.body, 4000);
    if (!body) return res.status(400).json({ error: "Write your note first." });
    let parent = null;
    if (b.parentId) {
      if (!isUuid(b.parentId)) return res.status(400).json({ error: "That note isn’t valid." });
      parent = (await sql`select id, video_id, version, at_seconds from comments
                          where id = ${b.parentId} and project_id = ${p.id} and parent_id is null`)[0];
      if (!parent) return res.status(404).json({ error: "That note was removed." });
    }
    const video = parent ? { id: parent.video_id, version: parent.version, title: "" } : await videoFor(u, p, b.videoId);
    if (!video) return res.status(400).json({ error: "That version isn’t in this project." });
    const at = parent || b.at === null || b.at === undefined ? null : Math.max(0, Math.min(86400, Number(b.at) || 0));
    const [row] = await sql`
      insert into comments (project_id, video_id, version, at_seconds, body, parent_id, author_id, author_name, author_role)
      values (${p.id}, ${video.id}, ${video.version ?? null}, ${at}, ${body}, ${parent ? parent.id : null}, ${u.id}, ${u.name}, ${u.role})
      returning id, created_at`;
    await touch(p);
    await audit(req, u, parent ? "note.reply" : "note", `${parent ? "Replied to a note" : "Left a note"} on ${p.title}${video.title ? ": " + video.title : ""}`, { projectId: p.id, clientId: p.client_id });
    await later(() => pushNote(p, row.id), "frame.io note");
    if (!isStaff(u)) {
      await later(() => notify({ audience: "staff", project: p, actor: u, origin: originOf(req), path: `/review/${p.id}`, button: "Open the notes",
        subject: `${u.name} left a note on ${p.title}`, lines: [`${u.name} (${p.client_name}) wrote:`, body] }), "notify");
    }
    return res.status(201).json({ id: row.id, when: iso(row.created_at) });
  },

  async resolve(req, res, u, b) {
    const x = await noteRow(u, b.id);
    if (!x || x.r.parent_id) return res.status(404).json({ error: "That note was removed." });
    if (!x.p.caps.notes) return res.status(403).json(OFF("Notes"));
    const [row] = await sql`update comments set resolved = ${!!b.resolved} where id = ${x.r.id} returning frameio_id`;
    if (row && row.frameio_id) await later(() => pushDone(x.p, row.frameio_id, !!b.resolved), "frame.io done");
    return res.status(200).json({ ok: true });
  },

  async deleteNote(req, res, u, b) {
    const x = await noteRow(u, b.id);
    if (!x) return res.status(404).json({ error: "That note was already removed." });
    if (x.r.author_id !== u.id && !can(u, "notes.moderate", await getSettings())) return res.status(403).json({ error: "You can only remove your own notes." });
    // Its replies go with it; their Frame.io copies too.
    const copies = (await sql`delete from comments where id = ${x.r.id} or parent_id = ${x.r.id} returning frameio_id`).map((c) => c.frameio_id).filter(Boolean);
    if (copies.length) await later(() => pushDelete(x.p, copies), "frame.io delete");
    if (x.r.author_id !== u.id) await audit(req, u, "note.remove", `Removed someone else’s note on ${x.p.title}`, { projectId: x.p.id, clientId: x.p.client_id });
    return res.status(200).json({ ok: true });
  },

  async decide(req, res, u, b) {
    const p = await projectFor(u, b.projectId);
    if (!p) return res.status(404).json(NOT_FOUND);
    if (isStaff(u)) return res.status(403).json({ error: "Approvals come from the client. Staff can see them, not make them." });
    if (!p.caps.approve) return res.status(403).json(p.clientCaps.approve ? { error: "Only your company’s decision makers can approve. Leave a note instead, and they’ll see it." } : OFF("Approving versions"));
    const decision = b.decision === "approved" ? "approved" : b.decision === "changes" ? "changes" : null;
    if (!decision) return res.status(400).json({ error: "Choose approve or ask for changes." });
    const note = longText(b.note, 4000) || null;
    if (decision === "changes" && !note) return res.status(400).json({ error: "Say what you’d like changed." });
    const video = await videoFor(u, p, b.videoId);
    if (!video || video.version == null) return res.status(400).json({ error: "That version isn’t in this project." });
    const [row] = await sql`
      insert into approvals (project_id, video_id, version, decision, note, user_id, user_name)
      values (${p.id}, ${video.id}, ${video.version}, ${decision}, ${note}, ${u.id}, ${u.name})
      returning id, created_at`;
    await touch(p);
    const what = `${video.baseTitle || video.title} Version ${video.version}`;
    await audit(req, u, decision === "approved" ? "approved" : "changes",
      decision === "approved" ? `Approved ${what}${note ? " with small fixes" : ""}` : `Asked for changes to ${what}`, { projectId: p.id, clientId: p.client_id });
    const origin = originOf(req);
    await later(async () => {
      await notify({ audience: "staff", project: p, actor: u, origin, path: `/review/${p.id}`, button: "See the decision",
        subject: decision === "approved" ? `${u.name} approved ${what}` : `${u.name} asked for changes to ${what}`,
        lines: decision === "approved"
          ? [`${u.name} (${p.client_name}) approved ${what}.`, note ? "Small fixes they’d like:" : "", note || ""]
          : [`${u.name} (${p.client_name}) asked for changes to ${what}:`, note] });
      if (decision === "approved") await receipt(u, p, what, note, row.created_at, origin);
      await syncProject(p.id);
      await pushDecision(p, row.id);
    }, "after decision");
    return res.status(201).json({ decision: { decision, note: note || "", by: u.name, at: iso(row.created_at) } });
  },

  async message(req, res, u, b) {
    const p = await projectFor(u, b.projectId);
    if (!p) return res.status(404).json(NOT_FOUND);
    if (!p.caps.messages) return res.status(403).json(OFF("Messages"));
    const body = longText(b.body, 5000);
    if (!body) return res.status(400).json({ error: "Write your message first." });
    const [row] = await sql`
      with m as (
        insert into messages (project_id, author_id, author_name, author_role, body)
        values (${p.id}, ${u.id}, ${u.name}, ${u.role}, ${body}) returning id, created_at
      ), r as (
        insert into message_reads (user_id, project_id, seen_at) values (${u.id}, ${p.id}, now())
        on conflict (user_id, project_id) do update set seen_at = now()
      )
      select id, created_at from m`;
    await touch(p);
    const s = await getSettings();
    await later(() => notify({
      audience: isStaff(u) ? "client" : "staff", project: p, actor: u, origin: originOf(req), need: "messages",
      path: `/messages/${p.id}`, button: "Reply in the portal",
      subject: `New message on ${p.title}`, lines: [`${u.name}${isStaff(u) ? ", " + s.brand.studio : ` (${p.client_name})`} wrote:`, body],
    }), "notify");
    return res.status(201).json({ message: { id: row.id, author: u.name, role: u.role, mine: true, canRemove: true, body, at: iso(row.created_at) } });
  },

  async deleteMessage(req, res, u, b) {
    if (!isUuid(b.id)) return res.status(400).json({ error: "That message isn’t valid." });
    const m = (await sql`select id, project_id, author_id from messages where id = ${b.id}`)[0];
    const p = m && (await projectFor(u, m.project_id));
    if (!m || !p) return res.status(404).json({ error: "That message was already removed." });
    if (m.author_id !== u.id && !can(u, "notes.moderate", await getSettings())) return res.status(403).json({ error: "You can only remove your own messages." });
    await sql`delete from messages where id = ${m.id}`;
    await audit(req, u, "message.remove", `Removed a message on ${p.title}`, { projectId: p.id, clientId: p.client_id });
    return res.status(200).json({ ok: true });
  },

  /** A client started watching a version or film: noted once a day per video, for staff (activity log). */
  async seen(req, res, u, b) {
    if (isStaff(u)) return res.status(200).json({ ok: true });
    const p = await projectFor(u, b.projectId);
    if (!p) return res.status(404).json(NOT_FOUND);
    const v = await videoFor(u, p, b.videoId);
    if (!v) return res.status(200).json({ ok: true });
    const label = v.version != null ? `${v.baseTitle || v.title} Version ${v.version}` : v.title;
    const dup = await sql`select 1 from audit_log where actor_id = ${u.id} and action = 'watched' and project_id = ${p.id}
                          and summary = ${"Watched " + label} and at > now() - interval '1 day' limit 1`;
    if (!dup.length) await audit(req, u, "watched", "Watched " + label, { projectId: p.id, clientId: p.client_id });
    return res.status(200).json({ ok: true });
  },

  /** A client downloaded something: noted for staff. */
  async downloaded(req, res, u, b) {
    if (isStaff(u)) return res.status(200).json({ ok: true });
    const p = await projectFor(u, b.projectId);
    if (!p) return res.status(404).json(NOT_FOUND);
    await audit(req, u, "downloaded", `Downloaded ${text(b.what, 160) || "a file"}`, { projectId: p.id, clientId: p.client_id });
    return res.status(200).json({ ok: true });
  },

  /** Pay: a Stripe checkout page for one payment the studio asked for. The browser goes there next. */
  async pay(req, res, u, b) {
    const x = await payFor(req, res, u, b);
    if (!x) return;
    const { p, pay } = x;
    if (!p.caps.pay) return res.status(403).json({ error: "Your company’s decision makers pay. You can see what’s due here." });
    if (pay.status === "paid") return res.status(200).json({ payment: paymentOut(pay) });
    if (pay.status === "processing") return res.status(409).json({ error: "Your bank payment is on its way. It shows as paid once it clears." });
    if (pay.status !== "open") return res.status(409).json({ error: "This payment isn’t open any more." });
    const conn = await stripeConnection();
    if (!conn) return res.status(409).json({ error: "Payments aren’t set up yet. Ask the studio how to pay." });
    const r = await checkout(conn, pay, p, u, originOf(req));
    if (r.settled) {
      await announce(r.settled, { req, actor: u, origin: originOf(req) });
      return res.status(200).json({ payment: paymentOut(r.settled.row) });
    }
    return res.status(200).json({ url: r.url });
  },

  /** Back from Stripe's checkout: asks Stripe how it went (never trusts the address) and settles the payment. */
  async payCheck(req, res, u, b) {
    const x = await payFor(req, res, u, b);
    if (!x) return;
    const conn = await stripeConnection();
    let t = null;
    if (conn && ["open", "processing"].includes(x.pay.status)) {
      try { t = await reconcile(conn, x.pay); } catch (err) { console.error("stripe check", err.message); }
      if (t) await announce(t, { req, actor: u, origin: originOf(req) });
    }
    const fresh = (await sql`select * from payments where id = ${x.pay.id}`)[0];
    return res.status(200).json({ payment: paymentOut(fresh) });
  },

  /** The client confirms the next milestone (a filming day, a delivery date). */
  async confirmNext(req, res, u, b) {
    const p = await projectFor(u, b.projectId);
    if (!p) return res.status(404).json(NOT_FOUND);
    if (isStaff(u)) return res.status(403).json({ error: "The client confirms this." });
    if (!p.next_confirm) return res.status(409).json({ error: "This milestone doesn’t need confirming." });
    if (permsOf(u, await getSettings()).approve !== true) return res.status(403).json({ error: "Only your company’s decision makers can confirm this." });
    await sql`update projects set next_confirmed_at = now(), next_confirmed_by = ${u.name}, updated_at = now() where id = ${p.id}`;
    const what = [p.next_label, p.next_what, p.next_date].filter(Boolean).join(" · ");
    await audit(req, u, "confirmed", `Confirmed ${what || "the next milestone"}`, { projectId: p.id, clientId: p.client_id });
    await later(() => notify({ audience: "staff", project: p, actor: u, origin: originOf(req), path: `/projects/${p.id}`,
      subject: `${u.name} confirmed: ${what || p.title}`, lines: [`${u.name} (${p.client_name}) confirmed ${what || "the next milestone"} on ${p.title}.`] }), "notify");
    return res.status(200).json({ ok: true });
  },

  async shareCreate(req, res, u, b) {
    const p = await projectFor(u, b.projectId);
    if (!p) return res.status(404).json(NOT_FOUND);
    if (!p.caps.share) return res.status(403).json(OFF("Share links"));
    const v = await videoFor(u, p, b.videoId);
    if (!v || v.version != null) return res.status(400).json({ error: "Share links are for finished films." });
    const days = [7, 30, 90].includes(Number(b.days)) ? Number(b.days) : null;
    const token = randomToken(24);
    const [row] = await sql`
      insert into share_links (token_hash, token_enc, project_id, video_id, title, created_by, created_by_name, expires_at)
      values (${hashToken(token)}, ${seal(token)}, ${p.id}, ${v.id}, ${v.title}, ${u.id}, ${u.name},
              ${days ? new Date(Date.now() + days * 86400e3) : null})
      returning id`;
    await audit(req, u, "share.create", `Created a share link to ${v.title}${days ? ` (${days} days)` : ""}`, { projectId: p.id, clientId: p.client_id });
    return res.status(201).json({ id: row.id, url: `${originOf(req)}/watch/${token}` });
  },

  async shareRevoke(req, res, u, b) {
    if (!isUuid(b.id)) return res.status(400).json({ error: "That link isn’t valid." });
    const sh = (await sql`select * from share_links where id = ${b.id}`)[0];
    const p = sh && (await projectFor(u, sh.project_id));
    if (!sh || !p) return res.status(404).json({ error: "That link was already removed." });
    const s = await getSettings();
    if (!(isStaff(u) ? can(u, "shares.manage", s) : p.caps.share)) return res.status(403).json(OFF("Share links"));
    await sql`update share_links set revoked_at = now() where id = ${sh.id} and revoked_at is null`;
    await audit(req, u, "share.revoke", `Turned off a share link to ${sh.title}`, { projectId: p.id, clientId: p.client_id });
    return res.status(200).json({ ok: true });
  },

  async teamAdd(req, res, u, b) {
    if (!(await teamAllowed(u))) return res.status(403).json({ error: "Only your company’s decision makers can add teammates." });
    if (!(await emailReady())) return res.status(409).json({ error: "The portal can’t send invitations yet. Ask the studio to add your teammate." });
    const name = text(b.name, 100);
    const email = String(b.email || "").trim().toLowerCase().slice(0, 320);
    const access = CLIENT_ROLES.some((r) => r.key === b.access) ? b.access : "reviewer";
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Enter their name and email." });
    const exists = (await sql`select 1 from users where email = ${email} union all select 1 from user_emails where email = ${email}`)[0];
    if (exists) return res.status(409).json({ error: "That email already has an account. Ask the studio if they should be on your team." });
    const [nu] = await sql`
      insert into users (email, name, role, access, client_id, password_hash, must_change_password)
      values (${email}, ${name}, 'client', ${access}, ${u.client_id}, ${await bcrypt.hash(randomToken(), 10)}, true) returning *`;
    const link = await createLink(nu.id, "invite", originOf(req));
    await emailLink(nu, "invite", link, u.name);
    await audit(req, u, "team.add", `Added ${name} (${email}) as ${roleLabel(nu)}`, { clientId: u.client_id });
    await later(() => staffHeadsUp(u, `${u.name} added ${name} to ${u.client_name}`, [`${u.name} (${u.client_name}) added ${name} (${email}) as ${roleLabel(nu)}. They’ve been emailed an invitation.`], originOf(req)), "notify");
    return res.status(201).json({ id: nu.id });
  },

  async teamUpdate(req, res, u, b) {
    if (!(await teamAllowed(u))) return res.status(403).json({ error: "Only your company’s decision makers can change roles." });
    const t = await teammate(u, b.id);
    if (!t) return res.status(404).json({ error: "That person isn’t on your team." });
    if (!CLIENT_ROLES.some((r) => r.key === b.access)) return res.status(400).json({ error: "Choose a role." });
    await sql`update users set access = ${b.access}, session_version = session_version + 1 where id = ${t.id}`;
    await audit(req, u, "team.role", `Made ${t.name} a ${roleLabel({ role: "client", access: b.access })}`, { clientId: u.client_id });
    return res.status(200).json({ ok: true });
  },

  async teamRemove(req, res, u, b) {
    if (!(await teamAllowed(u))) return res.status(403).json({ error: "Only your company’s decision makers can remove teammates." });
    const t = await teammate(u, b.id);
    if (!t) return res.status(404).json({ error: "That person isn’t on your team." });
    await sql`delete from users where id = ${t.id}`;
    await audit(req, u, "team.remove", `Removed ${t.name} (${t.email})`, { clientId: u.client_id });
    await later(() => staffHeadsUp(u, `${u.name} removed ${t.name} from ${u.client_name}`, [`${u.name} (${u.client_name}) removed ${t.name} (${t.email}) from the portal.`], originOf(req)), "notify");
    return res.status(200).json({ ok: true });
  },
};

async function teamAllowed(u) {
  if (isStaff(u)) return false;
  const s = await getSettings();
  return !!(permsOf(u, s).team && s.security.clientTeams && u.all_projects !== false);
}

async function teammate(u, id) {
  if (!isUuid(id) || id === u.id) return null;
  return (await sql`select id, name, email, access from users where id = ${id} and role = 'client' and client_id = ${u.client_id}`)[0] || null;
}

async function team(req, res, u) {
  if (!(await teamAllowed(u))) return res.status(403).json({ error: "Only your company’s decision makers can see the team." });
  const rows = await sql`select id, name, email, title, access, role, last_login_at, must_change_password from users
                         where role = 'client' and client_id = ${u.client_id} order by lower(name)`;
  return res.status(200).json({
    people: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, title: r.title || "", access: accessOf(r), me: r.id === u.id,
      lastLogin: iso(r.last_login_at), invited: r.must_change_password && !r.last_login_at })),
    roles: CLIENT_ROLES,
    canInvite: await emailReady(),
  });
}

async function shares(req, res, u, pid) {
  const p = await projectFor(u, pid);
  if (!p) return res.status(404).json(NOT_FOUND);
  const s = await getSettings();
  if (!(isStaff(u) ? can(u, "shares.manage", s) : p.caps.share)) return res.status(200).json({ links: [] });
  const rows = await sql`select * from share_links where project_id = ${p.id} order by created_at desc limit 200`;
  const origin = originOf(req);
  return res.status(200).json({
    links: rows.map((r) => {
      const token = open(r.token_enc);
      const expired = r.expires_at && Date.parse(r.expires_at) < Date.now();
      return {
        id: r.id, videoId: r.video_id, title: r.title, by: r.created_by_name, mine: r.created_by === u.id,
        url: token && !r.revoked_at && !expired ? `${origin}/watch/${token}` : null,
        created: iso(r.created_at), expires: iso(r.expires_at), revoked: iso(r.revoked_at), expired: !!expired,
        views: r.views, lastViewed: iso(r.last_viewed_at),
      };
    }),
  });
}

/** Tells staff about client-side team changes. */
async function staffHeadsUp(u, subject, lines, origin) {
  const fake = { id: null, title: u.client_name, client_id: u.client_id, capabilities: {} };
  await notify({ audience: "staff", project: fake, actor: u, origin, path: "/studio/people", button: "See people", subject, lines });
}

/** The approver's own record of what they approved, by email. */
async function receipt(u, p, what, note, at, origin) {
  const s = await getSettings();
  const when = new Date(at).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Los_Angeles" }) + " (Pacific)";
  const html = layout({
    studio: s.brand.studio, eyebrow: "Approval receipt",
    lines: [`You approved ${what} on ${p.title}.`, `Approved by ${u.name} (${u.email}) on ${when}.`, note ? `Small fixes you asked for: ${note}` : "", "Keep this email as your record. The approval is also saved in the portal."],
    button: { label: "Open the project", href: `${origin}/review/${p.id}` },
  });
  await sendEmail({ to: u.email, subject: `Approved: ${what}`, html });
}
