// One-time links: an invitation (choose your password, 14 days), a password reset (1 hour), or a login link
// (15 minutes). The token is 256 random bits; only its SHA-256 hash is stored, and it works once.
// Also the login throttle, shared by passwords, two-step codes, and link requests.
import { sql } from "./_db.js";
import { randomToken, hashToken } from "./_crypto.js";
import { getSettings } from "./_settings.js";
import { layout, sendEmail } from "./_notify.js";

export const LINK_TTL = { invite: 14 * 24 * 60, reset: 60, signin: 15 }; // minutes

/** A fresh link for someone. Older unused links of the same kind stop working. Returns the full URL. */
export async function createLink(userId, purpose, origin, next = "") {
  const token = randomToken();
  await sql`delete from link_tokens where user_id = ${userId} and purpose = ${purpose} and used_at is null`;
  await sql`insert into link_tokens (user_id, purpose, token_hash, expires_at)
            values (${userId}, ${purpose}, ${hashToken(token)}, now() + make_interval(mins => ${LINK_TTL[purpose]}))`;
  const q = next && /^\/(?!\/)/.test(next) ? "?next=" + encodeURIComponent(next) : "";
  return `${origin}/link/${token}${q}`;
}

/**
 * Uses a link: returns { user, purpose } and marks it used, or { error } in plain words. One statement, so
 * two clicks can't both succeed.
 */
export async function redeemLink(token) {
  if (!token || typeof token !== "string" || token.length < 20 || token.length > 100) return { error: "That link isn’t complete. Copy the whole link from the email." };
  const rows = await sql`
    update link_tokens set used_at = now()
    where token_hash = ${hashToken(token)} and used_at is null and expires_at > now()
    returning user_id, purpose`;
  if (!rows.length) {
    const old = (await sql`select used_at from link_tokens where token_hash = ${hashToken(token)}`)[0];
    return { error: old && old.used_at ? "That link was already used. Ask for a new one below." : "That link has expired. Ask for a new one below." };
  }
  const u = (await sql`select u.*, c.name as client_name, c.logo_url as client_logo from users u left join clients c on c.id = u.client_id where u.id = ${rows[0].user_id}`)[0];
  if (!u) return { error: "That account was removed." };
  return { user: u, purpose: rows[0].purpose };
}

/** The emails that carry these links. Returns true if sent. */
export async function emailLink(user, purpose, link, invitedBy) {
  const s = await getSettings();
  const studio = s.brand.studio;
  const first = user.name.split(" ")[0];
  const staff = user.role === "admin";
  const copy = {
    invite: {
      subject: `Your ${studio} portal is ready`,
      lines: staff
        ? [`Hi ${first},`, `${invitedBy ? invitedBy + " has" : "We’ve"} added you to the ${studio} portal, where the studio runs every client project: versions, notes, approvals, files, and messages.`, "Choose your password to get in. The link works once, within 14 days."]
        : [`Hi ${first},`, `${invitedBy ? invitedBy + " has" : "We’ve"} set up your private portal for ${studio}. Every version of your film comes here first: watch it, leave notes on the exact moment, and approve it when it’s right.`, "Choose your password to get in. The link works once, within 14 days."],
      button: "Choose your password",
    },
    reset: {
      subject: `Choose a new password for the ${studio} portal`,
      lines: [`Hi ${first},`, "Here’s your link to choose a new password. It works once, within an hour."],
      button: "Choose a new password",
    },
    signin: {
      subject: `Your login link for the ${studio} portal`,
      lines: [`Hi ${first},`, "Here’s your link to log in. It works once, within 15 minutes."],
      button: "Log in to the portal",
    },
  }[purpose];
  const html = layout({ studio, eyebrow: "Portal", lines: copy.lines, button: { label: copy.button, href: link },
    footer: "If you didn’t expect this email, you can ignore it. Nobody can use the portal without the link." });
  return sendEmail({ to: user.email, subject: copy.subject, html });
}

/**
 * Sign-up emails. kind:
 *   confirm   prove the address is theirs (link, one hour)
 *   exists    they already have an account: a login link instead (or a password link if login links are off)
 *   declined  the studio said no, kindly
 */
export async function emailSignup(kind, to, name, link) {
  const s = await getSettings();
  const studio = s.brand.studio;
  const first = String(name || "").split(" ")[0] || "there";
  const copy = {
    confirm: {
      subject: `Confirm your email for the ${studio} portal`,
      lines: [`Hi ${first},`, `Confirm this is your email address to finish creating your account with ${studio}. The link works once, within an hour.`],
      button: "Confirm my email",
    },
    exists: {
      subject: `You already have a ${studio} portal account`,
      lines: [`Hi ${first},`, "Someone, probably you, tried to create an account with this email address. You already have one, so here’s a link to get in instead. It works once."],
      button: "Open the portal",
    },
    declined: {
      subject: `About your ${studio} portal request`,
      lines: [`Hi ${first},`, `Thanks for asking to join the ${studio} portal. The studio couldn’t give you access this time.`, `If you think that’s a mistake, write to ${s.brand.support}.`],
      button: null,
    },
  }[kind];
  const html = layout({ studio, eyebrow: "Portal", lines: copy.lines, button: copy.button ? { label: copy.button, href: link } : undefined,
    footer: "If you didn’t ask for this, you can ignore it. Nothing happens without the link." });
  return sendEmail({ to, subject: copy.subject, html });
}

// ---------- throttle ----------
export const LIMITS = {
  password: { email: 8, ip: 30, minutes: 15 },
  code: { email: 6, ip: 30, minutes: 15 },
  link: { email: 5, ip: 20, minutes: 60 },
};

/** True when this email or IP has hit the limit for this kind of attempt. */
export async function throttled(kind, email, ip) {
  const l = LIMITS[kind];
  const [r] = await sql`
    select count(*) filter (where email = ${email})::int as by_email, count(*) filter (where ip = ${ip})::int as by_ip
    from login_attempts where kind = ${kind} and at > now() - make_interval(mins => ${l.minutes}) and (email = ${email} or ip = ${ip})`;
  return r.by_email >= l.email || r.by_ip >= l.ip;
}

export async function recordAttempt(kind, email, ip) {
  await sql`
    with pruned as (delete from login_attempts where at < now() - interval '1 day')
    insert into login_attempts (email, ip, kind) values (${email}, ${ip}, ${kind})`.catch((err) => console.error("could not record attempt", err.message));
}

export async function clearAttempts(kind, email) {
  await sql`delete from login_attempts where email = ${email} and kind = ${kind}`.catch(() => {});
}
