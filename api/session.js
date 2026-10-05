import bcrypt from "bcryptjs";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { sql, ready, dbConfigured } from "./_db.js";
import {
  TROUBLE, MIN_PASSWORD, readBody, rejectCrossOrigin, currentUser, requireUser, publicUser, text,
  signSession, setSessionCookie, clearSessionCookie, signTicket, readTicket, needsTwoStepSetup,
} from "./_auth.js";
import { seal, open, totpSecret, totpUri, verifyTotp, recoveryCodes, hashToken } from "./_crypto.js";
import { getSettings, DEFAULTS, LOGIN_UPLOAD, OWNER_EMAILS, resolveBrand, instanceId } from "./_settings.js";
import { emailReady, originOf } from "./_notify.js";
import { createLink, redeemLink, emailLink, emailSignup, throttled, recordAttempt, clearAttempts } from "./_links.js";
import { audit, clientIp } from "./_audit.js";
import { isStaff, roleLabel } from "./_roles.js";
import { clientForEmail } from "./_signup.js";
import { notify } from "./_notify.js";
import { randomToken } from "./_crypto.js";
import { projectByJoin, addToProject, joinRole } from "./_join.js";
import { capsOf } from "./_caps.js";
import { effectiveCaps } from "./_roles.js";

/**
 * GET  /api/session                        who is logged in, plus what the login screen shows
 * GET  /api/session?loginImage=<id>         the login photo staff uploaded (Studio → Settings → Login screen)
 * POST /api/session {action:"login"}       email, password → logged in, or { twoStep, ticket }
 * POST /api/session {action:"twoStep"}     ticket, code (or a recovery code) → logged in
 * POST /api/session {action:"requestLink"} email, purpose ("signin" | "reset"), next → emails a one-time link
 * POST /api/session {action:"signup"}      name, email, company, note → emails a link to confirm the address
 * POST /api/session {action:"redeem"}      token → logged in (invite and reset links then ask for a password);
 *                                          a sign-up confirmation joins the company or waits for the studio
 * GET  /api/session?join=<token>          which project a project link opens, and what joining it gives
 * POST /api/session {action:"join"}        token + name, email, password, agree → a login for that project, already
 *                                          let in; or, logged in, adds the project to that login
 * POST /api/session {action:"logout"}
 * POST /api/session {action:"setup"}       code, name, email, password: the first owner (once)
 * POST /api/session {action:"password"}    current, next
 * POST /api/session {action:"profile"}     name, title, notifyEmail, welcomed (finished or skipped the tutorial)
 * POST /api/session {action:"twoStepBegin" | "twoStepEnable" | "twoStepDisable" | "recoveryCodes"}
 */

// A real cost-10 bcrypt hash of a random string nobody knows: unknown emails take as long as known ones.
const DUMMY_HASH = "$2a$10$4.Uq6Yq0zEfHgAc1yFLAW.Qj5I/7AV/j9EzAe9VoE1rvjhSr80DKS";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LINK_SENT = "If that email has an account, a link is on its way. It can take a minute to arrive; check spam too.";
const safeNext = (n) => (typeof n === "string" && /^\/(?!\/)[\w\-./%?=&]*$/.test(n) && n.length < 300 ? n : "");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method === "GET") return req.query && req.query.loginImage ? loginImage(req, res) : req.query && req.query.join ? joinInfo(req, res) : status(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (rejectCrossOrigin(req, res)) return;
  const b = readBody(req, res);
  if (!b) return;
  if (b.action === "logout") { clearSessionCookie(res); return res.status(200).json({ ok: true }); }
  if (!dbConfigured()) return res.status(503).json({ error: "The portal is still being set up. Try again soon." });
  try {
    await ready();
    switch (b.action) {
      case "login": return await login(req, res, b);
      case "twoStep": return await twoStep(req, res, b);
      case "requestLink": return await requestLink(req, res, b);
      case "redeem": return await redeem(req, res, b);
      case "signup": return await signup(req, res, b);
      case "join": return await join(req, res, b);
      case "password": return await password(req, res, b);
      case "profile": return await profile(req, res, b);
      case "twoStepBegin": return await twoStepBegin(req, res);
      case "twoStepEnable": return await twoStepEnable(req, res, b);
      case "twoStepDisable": return await twoStepDisable(req, res, b);
      case "recoveryCodes": return await newRecoveryCodes(req, res, b);
      default: return res.status(400).json({ error: "Unknown action." });
    }
  } catch (err) {
    console.error("session action failed", b.action, err);
    return res.status(500).json({ error: TROUBLE });
  }
}

// The login screen's wording: saved settings, or the defaults when there's no database yet (so the
// Murphy's Law and studio name show before go-live too).
const DEFAULT_SCREEN = { brand: resolveBrand(DEFAULTS.brand), signin: DEFAULTS.signin, signinLinks: false, signup: false };
async function screen() {
  const s = await getSettings().catch(() => null);
  // Sign-up needs email (the address is confirmed by a link), so it only shows when email works.
  return s ? { brand: s.brand, signin: s.signin, signinLinks: !!s.security.signinLinks, signup: s.security.signup !== "off" && (await emailReady()) } : DEFAULT_SCREEN;
}

/**
 * The login photo staff uploaded. It's in private file storage, so it passes through here; only the photo the
 * settings name is served, never another file. Its address carries its id, so Vercel's CDN keeps a copy for a day.
 */
async function loginImage(req, res) {
  const id = String(req.query.loginImage || "");
  if (!/^[0-9a-f-]{36}$/.test(id) || !dbConfigured() || !process.env.BLOB_READ_WRITE_TOKEN) return res.status(404).end();
  try {
    await ready();
    const s = await getSettings();
    const m = LOGIN_UPLOAD.exec(String(s.signin.image || ""));
    if (!m || m[2] !== id) return res.status(404).end();
    const validUntil = Date.now() + 60 * 1000;
    const signed = await issueSignedToken({ pathname: m[1], operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(signed, { operation: "get", pathname: m[1], access: "private", validUntil });
    const r = await fetch(presignedUrl);
    if (!r.ok) return res.status(404).end();
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Vercel-CDN-Cache-Control", "max-age=86400");
    return res.status(200).end(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    console.error("login photo failed", err.message);
    return res.status(404).end();
  }
}

// The portal has no owner yet: only the first owner can create an account (OWNER_EMAILS).
const noOwner = async () => !(await sql`select 1 from users where role = 'admin' limit 1`)[0];

async function status(req, res) {
  const base = {};
  if (!dbConfigured()) return res.status(200).json({ ...base, ...DEFAULT_SCREEN, user: null, db: false, firstRun: false });
  try {
    await ready();
    const [user, sc, email, instance] = await Promise.all([currentUser(req), screen(), emailReady(), instanceId()]);
    const out = { ...base, ...sc, email, db: true, instance };
    if (user) return res.status(200).json({ ...out, firstRun: false, user: publicUser(user), needsTwoStep: await needsTwoStepSetup(user) });
    return res.status(200).json({ ...out, user: null, firstRun: await noOwner() });
  } catch (err) {
    console.error("session status failed", err);
    return res.status(500).json({ ...base, error: TROUBLE });
  }
}

/** Finishes a login: session cookie, last login time, activity log. */
async function signIn(req, res, user, how, extra = {}) {
  await sql`update users set last_login_at = now() where id = ${user.id}`;
  await setSessionCookie(res, await signSession(user));
  await audit(req, user, "signin", `Logged in (${how})`, { clientId: user.client_id });
  return res.status(200).json({ user: publicUser(user), needsTwoStep: await needsTwoStepSetup(user), ...extra });
}

/** The person who logs in with this address: their main email, or an extra one (user_emails). */
async function userByEmail(email) {
  return (await sql`select u.*, c.name as client_name, c.logo_url as client_logo from users u left join clients c on c.id = u.client_id
                    where u.email = ${email} or u.id = (select user_id from user_emails where email = ${email}) limit 1`)[0] || null;
}

async function login(req, res, b) {
  const email = String(b.email || "").trim().toLowerCase().slice(0, 320);
  const pass = String(b.password || "");
  if (!email || !pass) return res.status(400).json({ error: "Enter your email and password." });
  const ip = clientIp(req) || "unknown";
  if (await throttled("password", email, ip)) {
    res.setHeader("Retry-After", "900");
    return res.status(429).json({ error: "Too many tries. Wait 15 minutes, then try again, or ask for a login link." });
  }
  const user = await userByEmail(email);
  const ok = await bcrypt.compare(pass, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    await recordAttempt("password", email, ip);
    return res.status(401).json({ error: "That email and password don’t match. Check both, or use “Forgot your password?”." });
  }
  await clearAttempts("password", email);
  if (user.totp_enabled) return res.status(200).json({ twoStep: true, ticket: await signTicket(user) });
  return signIn(req, res, user, "password");
}

/** Checks a two-step code, or uses up one recovery code. Returns true when it's good. */
async function checkCode(user, code) {
  const secret = open(user.totp_secret);
  const c = String(code || "").trim().toLowerCase();
  if (secret && /^\d{6}$/.test(c.replace(/\s/g, ""))) {
    const step = verifyTotp(secret, c, Number(user.totp_last_step) || 0);
    if (step) { await sql`update users set totp_last_step = ${step} where id = ${user.id}`; return true; }
    return false;
  }
  if (/^[a-z0-9]{4}-?[a-z0-9]{4}$/.test(c)) {
    const h = hashToken(c.includes("-") ? c : c.slice(0, 4) + "-" + c.slice(4));
    const codes = Array.isArray(user.recovery_codes) ? user.recovery_codes : [];
    if (!codes.includes(h)) return false;
    await sql`update users set recovery_codes = ${JSON.stringify(codes.filter((x) => x !== h))}::jsonb where id = ${user.id}`;
    return true;
  }
  return false;
}

async function twoStep(req, res, b) {
  const t = await readTicket(b.ticket);
  if (!t) return res.status(401).json({ error: "That took too long. Log in again.", restart: true });
  const user = (await sql`select u.*, c.name as client_name, c.logo_url as client_logo from users u left join clients c on c.id = u.client_id where u.id = ${t.sub}`)[0];
  if (!user || (user.session_version || 1) !== (t.sv || 1)) return res.status(401).json({ error: "Log in again.", restart: true });
  const ip = clientIp(req) || "unknown";
  if (await throttled("code", user.email, ip)) return res.status(429).json({ error: "Too many wrong codes. Wait 15 minutes, then log in again." });
  if (!(await checkCode(user, b.code))) {
    await recordAttempt("code", user.email, ip);
    return res.status(401).json({ error: "That code isn’t right. Use the newest code in your authenticator app, or a recovery code." });
  }
  await clearAttempts("code", user.email);
  return signIn(req, res, user, "two-step", { next: safeNext(b.next) });
}

async function requestLink(req, res, b) {
  const email = String(b.email || "").trim().toLowerCase().slice(0, 320);
  const purpose = b.purpose === "reset" ? "reset" : "signin";
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter the email address your account uses." });
  if (!(await emailReady())) return res.status(409).json({ error: "The portal can’t send email yet. Ask the studio to reset your password." });
  const s = await getSettings();
  if (purpose === "signin" && !s.security.signinLinks) return res.status(409).json({ error: "Login links are switched off. Use your password." });
  const ip = clientIp(req) || "unknown";
  if (await throttled("link", email, ip)) return res.status(429).json({ error: "Several links were sent already. Check your inbox and spam, or wait an hour." });
  await recordAttempt("link", email, ip);
  const user = await userByEmail(email);
  // The same answer either way, so nobody can find out which emails have accounts.
  if (user) {
    const link = await createLink(user.id, purpose, originOf(req), safeNext(b.next));
    await emailLink(user, purpose, link);
    await audit(req, user, "link." + purpose, purpose === "reset" ? "Asked for a password reset link" : "Asked for a login link", { clientId: user.client_id });
  }
  return res.status(200).json({ ok: true, message: LINK_SENT });
}

async function redeem(req, res, b) {
  const signupDone = await confirmSignup(req, res, String(b.token || ""), b);
  if (signupDone) return;
  const r = await redeemLink(String(b.token || ""));
  if (r.error) return res.status(400).json({ error: r.error });
  let user = r.user;
  if (r.purpose === "invite" || r.purpose === "reset") {
    // They prove who they are by the link; now they choose a password (the forced new-password screen).
    [user] = await sql`update users set must_change_password = true where id = ${user.id} returning *`;
    user.client_name = r.user.client_name; user.client_logo = r.user.client_logo;
  }
  await clearAttempts("password", user.email);
  if (user.totp_enabled) return res.status(200).json({ twoStep: true, ticket: await signTicket(user), next: safeNext(b.next) });
  return signIn(req, res, user, r.purpose === "signin" ? "email link" : r.purpose + " link", { next: safeNext(b.next) });
}

const SIGNUP_SENT = "Check your email. We’ve sent a link to confirm it’s you. It can take a minute to arrive; check spam too.";

/**
 * Someone creates an account. Nothing is created until they confirm the address: this only stores the request
 * and emails the link. The answer is the same whether or not the email already has an account.
 */
async function signup(req, res, b) {
  const s = await getSettings();
  const name = text(b.name, 100);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 320);
  const company = text(b.company, 120);
  // Until there's an owner, only the first owner's addresses may create an account (they then confirm by email).
  const first = await noOwner();
  if (first && EMAIL_RE.test(email) && !OWNER_EMAILS.includes(email)) return res.status(403).json({ error: "The portal isn’t open for new accounts yet." });
  if (!first && s.security.signup === "off") return res.status(403).json({ error: "New accounts are by invitation. Ask the studio to invite you." });
  if (!(await emailReady())) return res.status(409).json({ error: first ? "The portal can’t send email yet, so this account can’t be confirmed. Email needs setting up first (Vercel: RESEND_API_KEY and PORTAL_EMAIL_FROM)." : "Accounts can’t be created here yet. Ask the studio to invite you." });
  if (!name) return res.status(400).json({ error: "Enter your name." });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter your work email address." });
  if (!company && !first) return res.status(400).json({ error: "Enter your company’s name." });
  const ip = clientIp(req) || "unknown";
  if (await throttled("link", email, ip)) return res.status(429).json({ error: "Several emails were sent already. Check your inbox and spam, or wait an hour." });
  await recordAttempt("link", email, ip);
  const existing = await userByEmail(email);
  if (existing) {
    const purpose = s.security.signinLinks ? "signin" : "reset";
    await emailSignup("exists", email, existing.name, await createLink(existing.id, purpose, originOf(req)));
    return res.status(200).json({ ok: true, message: SIGNUP_SENT });
  }
  const waiting = (await sql`select 1 from signup_requests where email = ${email} and status = 'waiting' limit 1`)[0];
  if (waiting) return res.status(200).json({ ok: true, message: SIGNUP_SENT, waiting: true });
  const token = randomToken();
  await sql`delete from signup_requests where email = ${email} and status = 'new'`;
  await sql`insert into signup_requests (email, name, company, note, token_hash, token_expires_at, ip)
            values (${email}, ${name}, ${company}, ${text(b.note, 600) || null}, ${hashToken(token)}, now() + interval '1 hour', ${ip})`;
  await emailSignup("confirm", email, name, `${originOf(req)}/link/${token}`);
  return res.status(200).json({ ok: true, message: SIGNUP_SENT });
}

/**
 * The link in a sign-up email. Returns true when it handled the request (it was a sign-up link), false to let
 * redeem() try the other kinds. Their company's email domain lets them straight in; otherwise they wait for
 * the studio, who is told.
 */
async function confirmSignup(req, res, token, b) {
  if (!token || token.length < 20 || token.length > 100) return false;
  const h = hashToken(token);
  const [r] = await sql`update signup_requests set verified_at = now(), token_hash = null, status = 'waiting'
                        where token_hash = ${h} and status = 'new' and token_expires_at > now() returning *`;
  if (!r) {
    const old = (await sql`select 1 from signup_requests where token_hash = ${h}`)[0];
    if (!old) return false;
    res.status(400).json({ error: "That link has expired. Create your account again: it only takes a moment." });
    return true;
  }
  const origin = originOf(req);
  // The studio may have invited them in the meantime: the link proves the address, so it opens their account.
  const existing = await userByEmail(r.email);
  if (existing) {
    await sql`update signup_requests set status = 'joined', user_id = ${existing.id}, decided_at = now(), decided_by = 'Already had an account' where id = ${r.id}`;
    if (existing.totp_enabled) { res.status(200).json({ twoStep: true, ticket: await signTicket(existing) }); return true; }
    await signIn(req, res, existing, "sign-up link");
    return true;
  }
  // The first owner: their confirmed address makes them the owner (only while there is none), with both addresses.
  if (OWNER_EMAILS.includes(r.email) && (await noOwner())) {
    const [u] = await sql`
      insert into users (email, name, role, access, password_hash, must_change_password)
      select ${r.email}, ${r.name}, 'admin', 'owner', ${await bcrypt.hash(randomToken(), 10)}, true
      where not exists (select 1 from users where role = 'admin')
      returning *`;
    if (u) {
      for (const e of OWNER_EMAILS) if (e !== r.email) {
        await sql`insert into user_emails (email, user_id) select ${e}, ${u.id} where not exists (select 1 from users where email = ${e}) on conflict do nothing`;
      }
      await sql`update signup_requests set status = 'joined', user_id = ${u.id}, decided_at = now(), decided_by = 'First owner' where id = ${r.id}`;
      await audit(req, u, "setup", `Became the portal’s first owner (${OWNER_EMAILS.join(" or ")})`);
      await signIn(req, res, u, "first owner");
      return true;
    }
  }
  const s = await getSettings();
  const company = s.security.domainJoin ? await clientForEmail(r.email) : null;
  if (company) {
    const access = s.security.domainRole || "reviewer";
    const [u] = await sql`
      insert into users (email, name, role, access, client_id, password_hash, must_change_password)
      values (${r.email}, ${r.name}, 'client', ${access}, ${company.id}, ${await bcrypt.hash(randomToken(), 10)}, true)
      returning *`;
    u.client_name = company.name;
    await sql`update signup_requests set status = 'joined', client_id = ${company.id}, user_id = ${u.id}, decided_at = now(), decided_by = 'Email domain' where id = ${r.id}`;
    await audit(req, u, "signup.joined", `Created an account and joined ${company.name} by email domain, as ${roleLabel(u)}`, { clientId: company.id });
    const fake = { id: null, title: company.name, client_id: company.id, capabilities: {} };
    const lines = [`${r.name} (${r.email}) created an account and joined ${company.name} in the portal as ${roleLabel(u)}, because their email is on ${company.name}’s domain.`];
    await notify({ audience: "staff", project: fake, actor: null, origin, path: "/studio/people", button: "See people", staffPerm: "people.manage", subject: `${r.name} joined ${company.name}`, lines });
    await notify({ audience: "client", project: fake, actor: u, origin, path: "/account", button: "See your team", need: "team", subject: `${r.name} joined ${company.name} in the portal`, lines });
    await signIn(req, res, u, "sign-up");
    return true;
  }
  await audit(req, null, "signup.request", `${r.name} (${r.email}, ${r.company || "no company"}) asked for an account`);
  await notify({ audience: "staff", project: { id: null, title: "New account request", client_id: null, capabilities: {} }, actor: null, origin,
    path: "/studio/people", button: "Review the request", staffPerm: "people.manage", subject: `${r.name} asked to join the portal`,
    lines: [`${r.name} (${r.email}) from ${r.company || "an unnamed company"} confirmed their email and asked for an account.`, ...(r.note ? [`They wrote: “${r.note}”`] : []), "Approve them (and choose their company and role) or decline in Studio → People."] });
  res.status(200).json({ signup: "waiting", name: r.name, email: r.email, studio: s.brand.studio });
  return true;
}

// ---------- a project's own link (/join/<token>, _join.js) ----------
const JOIN_DEAD = "This link isn’t working any more. Ask the person who sent it for the project’s current link.";

/** What a project link's person can do there, in plain words, from the project's switches and the link's role. */
function joinCan(p, s) {
  const c = effectiveCaps({ role: "client", access: joinRole(p) }, capsOf(p.capabilities), s);
  return [
    c.review && "Watch each new version",
    c.notes && "Leave notes on any moment",
    c.approve && "Approve a version, or ask for changes",
    !c.review && "Watch the finished films",
    c.download && "Download the finished films",
    c.messages && "Message the studio",
  ].filter(Boolean).slice(0, 4);
}

/** GET ?join=<token>: the page behind a project link. Only what the link's holder needs; never other projects. */
async function joinInfo(req, res) {
  if (!dbConfigured()) return res.status(503).json({ error: "The portal is still being set up. Try the link again soon." });
  try {
    await ready();
    const p = await projectByJoin(req.query.join);
    if (!p) return res.status(404).json({ error: JOIN_DEAD });
    const [s, me] = await Promise.all([getSettings(), currentUser(req).catch(() => null)]);
    const member = me ? isStaff(me) || (await sql`select 1 from users u where u.id = ${me.id} and ((u.client_id = ${p.client_id} and u.all_projects)
      or exists (select 1 from project_people pp where pp.user_id = u.id and pp.project_id = ${p.id}))`).length > 0 : false;
    return res.status(200).json({
      project: { title: p.title, client: p.client_name, type: p.type || "" },
      studio: s.brand.studio, role: joinRole(p), roleLabel: roleLabel({ role: "client", access: joinRole(p) }), can: joinCan(p, s),
      minPassword: MIN_PASSWORD, privacy: s.brand.privacy,
      user: me ? { name: me.name, email: me.email, staff: isStaff(me) } : null, member,
    });
  } catch (err) {
    console.error("join info failed", err);
    return res.status(500).json({ error: TROUBLE });
  }
}

/**
 * POST {action:"join"}: someone with a project's link. Logged in: the project is added to their login (staff see
 * it anyway). Otherwise: a new login, already let in, that sees only this project; their company is the project's
 * client. An email that already has a login is asked to log in instead, so nobody takes over an account.
 */
async function join(req, res, b) {
  const p = await projectByJoin(b.token);
  if (!p) return res.status(404).json({ error: JOIN_DEAD });
  const me = await currentUser(req).catch(() => null);
  if (me) {
    if (!isStaff(me) && (await addToProject(me.id, p.id, "link"))) {
      await audit(req, me, "join", `Added ${p.title} with the project link`, { projectId: p.id, clientId: p.client_id });
    }
    return res.status(200).json({ joined: true, projectId: p.id, user: publicUser(me) });
  }
  const name = text(b.name, 100);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 320);
  const pass = String(b.password || "");
  if (!name) return res.status(400).json({ error: "Enter your name." });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter your email address." });
  if (pass.length < MIN_PASSWORD) return res.status(400).json({ error: `Choose a password of at least ${MIN_PASSWORD} characters.` });
  if (!b.agree) return res.status(400).json({ error: "Tick the box to confirm you’re working on this project." });
  const ip = clientIp(req) || "unknown";
  if (await throttled("join", email, ip)) return res.status(429).json({ error: "Several logins were made from here already. Wait an hour, or ask the studio to add you." });
  await recordAttempt("join", email, ip);
  if (await userByEmail(email)) return res.status(409).json({ exists: true, error: "That email already has a login. Log in, and this project is added to it." });
  const access = joinRole(p);
  let u;
  try {
    [u] = await sql`
      insert into users (email, name, role, access, client_id, all_projects, password_hash, must_change_password)
      values (${email}, ${name}, 'client', ${access}, ${p.client_id}, false, ${await bcrypt.hash(pass, 10)}, false)
      returning *`;
  } catch (err) {
    if (err && err.code === "23505") return res.status(409).json({ exists: true, error: "That email already has a login. Log in, and this project is added to it." });
    throw err;
  }
  u.client_name = p.client_name;
  await addToProject(u.id, p.id, "link");
  await audit(req, u, "join", `Created a login with the link for ${p.title}, as ${roleLabel(u)}, and confirmed they’re working on it`, { projectId: p.id, clientId: p.client_id });
  await notify({ audience: "staff", project: p, actor: null, origin: originOf(req), path: "/studio/projects/" + p.id, button: "See who joined",
    subject: `${name} joined ${p.title}`, lines: [`${name} (${email}) used the link for ${p.title} and can now see it in the portal, as ${roleLabel(u)}.`] });
  return signIn(req, res, u, "project link", { joined: true, created: true, projectId: p.id });
}

async function password(req, res, b) {
  const u = await requireUser(req, res, { allowMustChange: true, allowTwoStepSetup: true });
  if (!u) return;
  const next = String(b.next || "");
  if (next.length < MIN_PASSWORD) return res.status(400).json({ error: `Choose a password of at least ${MIN_PASSWORD} characters.` });
  const [row] = await sql`select password_hash from users where id = ${u.id}`;
  // Someone choosing a password after an invite or reset link has just proved who they are.
  if (!u.must_change_password) {
    const ok = await bcrypt.compare(String(b.current || ""), row.password_hash);
    if (!ok) return res.status(400).json({ error: "Your current password isn’t right." });
  }
  if (await bcrypt.compare(next, row.password_hash)) return res.status(400).json({ error: "Choose a password you haven’t used here before." });
  const hash = await bcrypt.hash(next, 10);
  const [updated] = await sql`
    update users set password_hash = ${hash}, must_change_password = false, session_version = session_version + 1
    where id = ${u.id} returning *`;
  updated.client_name = u.client_name; updated.client_logo = u.client_logo;
  // Other sessions stop working (their session version is now stale); this one carries on.
  await setSessionCookie(res, await signSession(updated));
  await audit(req, u, "password", u.must_change_password ? "Chose a password" : "Changed their password", { clientId: u.client_id });
  return res.status(200).json({ user: publicUser(updated), needsTwoStep: await needsTwoStepSetup(updated) });
}

async function profile(req, res, b) {
  const u = await requireUser(req, res, { allowTwoStepSetup: true });
  if (!u) return;
  const name = b.name === undefined ? u.name : text(b.name, 100);
  if (!name) return res.status(400).json({ error: "Your name can’t be empty." });
  const title = b.title === undefined ? u.title : text(b.title, 100) || null;
  const notify = b.notifyEmail === undefined ? u.notify_email : !!b.notifyEmail;
  const [updated] = await sql`update users set name = ${name}, title = ${title}, notify_email = ${notify},
                              welcomed_at = ${b.welcomed ? new Date() : u.welcomed_at || null} where id = ${u.id} returning *`;
  updated.client_name = u.client_name; updated.client_logo = u.client_logo;
  return res.status(200).json({ user: publicUser(updated) });
}

// ---------- two-step verification ----------
async function twoStepBegin(req, res) {
  const u = await requireUser(req, res, { allowTwoStepSetup: true });
  if (!u) return;
  if (u.totp_enabled) return res.status(409).json({ error: "Two-step verification is already on." });
  const secret = totpSecret();
  await sql`update users set totp_secret = ${seal(secret)}, totp_last_step = 0 where id = ${u.id}`;
  const s = await getSettings();
  return res.status(200).json({ secret, uri: totpUri(secret, u.email, s.brand.studio) });
}

async function twoStepEnable(req, res, b) {
  const u = await requireUser(req, res, { allowTwoStepSetup: true });
  if (!u) return;
  const row = (await sql`select totp_secret, totp_enabled from users where id = ${u.id}`)[0];
  const secret = open(row.totp_secret);
  if (row.totp_enabled) return res.status(409).json({ error: "Two-step verification is already on." });
  if (!secret) return res.status(400).json({ error: "Start again: the setup expired." });
  const step = verifyTotp(secret, b.code, 0);
  if (!step) return res.status(400).json({ error: "That code isn’t right. Type the six digits your app shows now." });
  const codes = recoveryCodes();
  await sql`update users set totp_enabled = true, totp_last_step = ${step}, recovery_codes = ${JSON.stringify(codes.map(hashToken))}::jsonb
            where id = ${u.id}`;
  await audit(req, u, "twostep.on", "Turned on two-step verification", { clientId: u.client_id });
  return res.status(200).json({ recoveryCodes: codes });
}

async function twoStepDisable(req, res, b) {
  const u = await requireUser(req, res);
  if (!u) return;
  const s = await getSettings();
  if (isStaff(u) && s.security.staffTwoStep) return res.status(403).json({ error: "Staff must keep two-step verification on (Studio → Settings → Security)." });
  const row = (await sql`select * from users where id = ${u.id}`)[0];
  if (!row.totp_enabled) return res.status(200).json({ ok: true });
  if (!(await checkCode(row, b.code))) return res.status(400).json({ error: "That code isn’t right." });
  await sql`update users set totp_enabled = false, totp_secret = null, recovery_codes = '[]'::jsonb where id = ${u.id}`;
  await audit(req, u, "twostep.off", "Turned off two-step verification", { clientId: u.client_id });
  return res.status(200).json({ ok: true });
}

async function newRecoveryCodes(req, res, b) {
  const u = await requireUser(req, res);
  if (!u) return;
  const row = (await sql`select * from users where id = ${u.id}`)[0];
  if (!row.totp_enabled) return res.status(409).json({ error: "Turn on two-step verification first." });
  if (!(await checkCode(row, b.code))) return res.status(400).json({ error: "That code isn’t right." });
  const codes = recoveryCodes();
  await sql`update users set recovery_codes = ${JSON.stringify(codes.map(hashToken))}::jsonb where id = ${u.id}`;
  await audit(req, u, "twostep.codes", "Made new recovery codes", { clientId: u.client_id });
  return res.status(200).json({ recoveryCodes: codes });
}
