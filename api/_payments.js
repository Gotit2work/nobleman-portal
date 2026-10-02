// Payments through Stripe (Studio → Connections → Payments). The studio asks a client to pay an amount on a
// project (a deposit, the balance); the client pays on Stripe's own checkout page, so card and bank details never
// reach the portal. A payment is marked paid by whichever comes first:
//   - Stripe's webhook (POST /api/connect?webhook=stripe, signed with the connection's webhook secret),
//   - the client coming back from checkout (POST /api/portal {action:"payCheck"}), or
//   - the daily job (api/cron.js), which asks Stripe about anything still open.
// Each path asks Stripe, never the browser, and a payment only moves from open to paid once, so nobody is told
// twice. No Stripe library: three REST calls, form-encoded, with the API version pinned.
import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "./_db.js";
import { firstOf } from "./_connections.js";
import { notify } from "./_notify.js";
import { audit } from "./_audit.js";

const API = "https://api.stripe.com/v1";
const VERSION = "2024-06-20";

export const meta = {
  key: "stripe", name: "Payments (Stripe)", kind: "payments",
  blurb: "Clients pay deposits and balances by card or bank on Stripe’s secure checkout, and each payment marks itself paid.",
  fields: [
    { key: "secretKey", label: "Secret key", secret: true, help: "dashboard.stripe.com → Developers → API keys → Secret key (sk_live_…). A restricted key (rk_live_…) also works with Checkout Sessions: Write. A test key (sk_test_…) lets you try it with Stripe’s test cards." },
    { key: "webhookSecret", label: "Webhook signing secret (optional, recommended)", secret: true, help: "dashboard.stripe.com → Developers → Webhooks → Add endpoint, using the address shown on this connection and the four events listed there. Then copy its signing secret (whsec_…)." },
    { key: "currency", label: "Currency", config: true, placeholder: "usd", help: "Three letters, like usd. New payment requests use it." },
  ],
};

/** The events the webhook needs (Stripe → Developers → Webhooks → Add endpoint). */
export const EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "charge.refunded"];

export const stripeConnection = async () => {
  const c = await firstOf("stripe").catch(() => null);
  return c && c.creds && c.creds.secretKey ? c : null;
};
export const currencyOf = (conn) => {
  const c = String((conn && conn.config && conn.config.currency) || "usd").trim().toLowerCase();
  return /^[a-z]{3}$/.test(c) ? c : "usd";
};
export const liveMode = (conn) => /_live_/.test(String((conn && conn.creds && conn.creds.secretKey) || ""));

/** Stripe's form encoding: nested objects and arrays as a[b][0][c]=v. */
function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(conn, method, path, params) {
  const qs = method === "GET" && params ? "?" + form(params).toString() : "";
  const r = await fetch(API + path + qs, {
    method,
    headers: {
      Authorization: "Bearer " + conn.creds.secretKey, "Stripe-Version": VERSION,
      ...(method === "GET" ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
    },
    body: method === "GET" || !params ? undefined : form(params).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((d.error && d.error.message) || `Stripe answered ${r.status}.`), { status: r.status });
  return d;
}

/** Studio → Connections → Test it. */
export async function test(conn) {
  const key = String(conn.creds.secretKey || "");
  if (!/^(sk|rk)_(live|test)_\w+/.test(key)) throw Object.assign(new Error("That isn’t a Stripe secret key. It starts with sk_live_ (or sk_test_ for test mode)."), { status: 400 });
  await stripe(conn, "GET", "/checkout/sessions", { limit: 1 });
  let name = "";
  try {
    const a = await stripe(conn, "GET", "/account");
    name = (a.settings && a.settings.dashboard && a.settings.dashboard.display_name) || (a.business_profile && a.business_profile.name) || a.email || "";
  } catch { /* a restricted key may not read the account; that's fine */ }
  const live = liveMode(conn);
  return {
    account: { name: (name || "Stripe") + (live ? "" : " (test mode)") },
    notes: [
      live ? "Live mode: clients pay for real." : "Test mode: pay with Stripe’s test card 4242 4242 4242 4242. Nothing is charged.",
      conn.creds.webhookSecret ? "Webhook secret saved." : "No webhook secret yet: payments still mark themselves paid when the client comes back from Stripe, and the daily job catches the rest.",
      `Currency: ${currencyOf(conn).toUpperCase()}.`,
    ],
  };
}

/** "$4,500.00" for 450000 cents. */
export function money(amount, currency = "usd") {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100); }
  catch { return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`; }
}

/** "4,500", "$4,500.00", "4500.5" → cents. Null when it isn't a sensible amount. */
export function parseAmount(v) {
  const s = String(v ?? "").replace(/[\s,$€£]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents >= 50 && cents <= 99999999 ? cents : null;
}

const iso = (d) => (d ? new Date(d).toISOString() : null);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** What the page gets for one payment. */
export function paymentOut(r) {
  return {
    id: r.id, projectId: r.project_id, title: r.title, amount: Number(r.amount), currency: r.currency, label: money(Number(r.amount), r.currency),
    due: day(r.due), note: r.note || "", status: r.status, method: r.method || null,
    paidAt: iso(r.paid_at), paidBy: r.paid_by_name || null, created: iso(r.created_at), createdBy: r.created_by_name || null,
  };
}

/** Every payment on these projects, newest first, keyed by project. */
export async function paymentsFor(projectIds) {
  const by = new Map();
  if (!projectIds.length) return by;
  const rows = await sql`select * from payments where project_id = any(${projectIds}) and status <> 'canceled' order by created_at desc`;
  for (const r of rows) { if (!by.has(r.project_id)) by.set(r.project_id, []); by.get(r.project_id).push(paymentOut(r)); }
  return by;
}

/**
 * A Stripe checkout page for one payment. An open checkout from earlier is used again, so two taps on Pay can't
 * become two charges; one that was already paid settles the payment instead.
 */
export async function checkout(conn, pay, project, user, origin) {
  if (pay.stripe_session) {
    try {
      const old = await stripe(conn, "GET", "/checkout/sessions/" + encodeURIComponent(pay.stripe_session));
      if (old.payment_status === "paid" || old.status === "complete") return { settled: await settle(old) };
      if (old.status === "open" && old.url) return { url: old.url, session: old.id };
    } catch { /* gone or expired: make a new one */ }
  }
  const back = `${origin}/payments/${project.id}`;
  const s = await stripe(conn, "POST", "/checkout/sessions", {
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: pay.currency, unit_amount: pay.amount, product_data: { name: pay.title, description: `${project.title} · ${project.client_name}` } } }],
    customer_email: user.email,
    client_reference_id: pay.id,
    metadata: { payment: pay.id, project: project.id },
    payment_intent_data: { description: `${project.title}: ${pay.title}`, metadata: { payment: pay.id, project: project.id } },
    success_url: `${back}?paid=${pay.id}&session={CHECKOUT_SESSION_ID}`,
    cancel_url: back,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
  });
  await sql`update payments set stripe_session = ${s.id}, updated_at = now() where id = ${pay.id}`;
  return { url: s.url, session: s.id };
}

/** Asks Stripe about a payment's checkout and settles it. Returns the transition (or null if nothing changed). */
export async function reconcile(conn, pay) {
  if (!pay.stripe_session) return null;
  const s = await stripe(conn, "GET", "/checkout/sessions/" + encodeURIComponent(pay.stripe_session));
  return settle(s);
}

/**
 * Moves a payment on from what Stripe says about its checkout: paid, or processing (a bank payment that takes a
 * few days). Checks the amount and currency match what was asked for. Returns { row, change } once per change.
 */
export async function settle(s) {
  const id = (s.metadata && s.metadata.payment) || s.client_reference_id;
  if (!/^[0-9a-f-]{36}$/.test(String(id || ""))) return null;
  const pay = (await sql`select * from payments where id = ${id}`)[0];
  if (!pay) return null;
  if (s.amount_total != null && (Number(s.amount_total) !== Number(pay.amount) || String(s.currency).toLowerCase() !== pay.currency)) {
    console.error("stripe: amount mismatch", pay.id, s.amount_total, s.currency);
    return null;
  }
  const who = (s.customer_details && (s.customer_details.name || s.customer_details.email)) || null;
  if (s.payment_status === "paid" || s.payment_status === "no_payment_required") {
    const [row] = await sql`update payments set status = 'paid', method = 'stripe', paid_at = now(), stripe_session = ${s.id},
        stripe_intent = ${typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || null},
        paid_by_name = coalesce(paid_by_name, ${who}), updated_at = now()
      where id = ${pay.id} and status in ('open', 'processing') returning *`;
    return row ? { row, change: "paid" } : null;
  }
  if (s.status === "complete" && s.payment_status === "unpaid") {
    const [row] = await sql`update payments set status = 'processing', stripe_session = ${s.id}, paid_by_name = coalesce(paid_by_name, ${who}), updated_at = now()
      where id = ${pay.id} and status = 'open' returning *`;
    return row ? { row, change: "processing" } : null;
  }
  return null;
}

/** A bank payment that failed after checkout: the payment is open again. */
export async function failed(s) {
  const id = (s.metadata && s.metadata.payment) || s.client_reference_id;
  if (!/^[0-9a-f-]{36}$/.test(String(id || ""))) return null;
  const [row] = await sql`update payments set status = 'open', updated_at = now() where id = ${id} and status = 'processing' returning *`;
  return row ? { row, change: "failed" } : null;
}

/** A charge refunded in full in Stripe: the payment shows as refunded. */
export async function refunded(charge) {
  const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent && charge.payment_intent.id;
  if (!intent || !charge.refunded) return null;
  const [row] = await sql`update payments set status = 'refunded', updated_at = now() where stripe_intent = ${intent} and status = 'paid' returning *`;
  return row ? { row, change: "refunded" } : null;
}

/** Stops an open checkout (when the studio cancels the request), so it can't be paid any more. */
export async function expire(conn, pay) {
  if (!conn || !pay.stripe_session) return;
  await stripe(conn, "POST", `/checkout/sessions/${encodeURIComponent(pay.stripe_session)}/expire`).catch(() => {});
}

/**
 * Checks the Stripe-Signature header: HMAC-SHA256 of "<t>.<raw body>" with the webhook secret, within five
 * minutes, compared in constant time.
 */
export function verifySignature(raw, header, secret, toleranceSec = 300) {
  if (!raw || !header || !secret) return false;
  const parts = String(header).split(",").map((x) => x.trim().split("="));
  const t = Number((parts.find(([k]) => k === "t") || [])[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v || "");
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const want = createHmac("sha256", secret).update(`${t}.${raw.toString("utf8")}`).digest("hex");
  return sigs.some((v) => v.length === want.length && timingSafeEqual(Buffer.from(v), Buffer.from(want)));
}

/** Everything still waiting on Stripe, for the daily job. */
export async function reconcileOpen() {
  const conn = await stripeConnection();
  if (!conn) return [];
  const rows = await sql`select * from payments where status in ('open', 'processing') and stripe_session is not null
                         and updated_at > now() - interval '40 days' order by updated_at limit 200`;
  const out = [];
  for (const r of rows) {
    try { const t = await reconcile(conn, r); if (t) out.push(t); } catch (err) { console.error("stripe reconcile", r.id, err.message); }
  }
  return out;
}

/** Are downloads on this project waiting for payment? (The project's "Downloads after payment" switch.) */
export async function heldForPayment(projectId) {
  const [r] = await sql`select count(*)::int as n from payments where project_id = ${projectId} and status in ('open', 'processing')`;
  return r.n > 0;
}

/**
 * Tells everyone what changed: the activity log, the studio, and the client's team (by email; the person who
 * just paid sees it on screen). t is what settle(), failed() or refunded() returned.
 */
export async function announce(t, { req = null, actor = null, origin } = {}) {
  if (!t) return;
  const r = t.row;
  const p = (await sql`select p.*, c.name as client_name from projects p join clients c on c.id = p.client_id where p.id = ${r.project_id}`)[0];
  if (!p) return;
  const label = money(Number(r.amount), r.currency);
  const ids = { projectId: p.id, clientId: p.client_id };
  const staff = (subject, line) => notify({ audience: "staff", project: p, actor, origin, path: `/studio/projects/${p.id}`, button: "See the payments", subject, lines: [line] });
  const client = (subject, line) => notify({ audience: "client", project: p, actor, origin, need: "payments", path: `/payments/${p.id}`, button: "See your payments", subject, lines: [line] });
  if (t.change === "paid") {
    await audit(req, actor, "payment.paid", `${r.paid_by_name || p.client_name} paid ${label}: ${r.title}`, ids);
    await staff(`${p.client_name} paid ${label}`, `${r.title} on ${p.title} is paid: ${label}${r.paid_by_name ? `, by ${r.paid_by_name}` : ""}.`);
    await client(`Paid: ${r.title}, ${label}`, `Thank you. ${r.title} for ${p.title} is paid: ${label}.`);
  } else if (t.change === "processing") {
    await audit(req, actor, "payment.processing", `A bank payment of ${label} is on its way: ${r.title}`, ids);
    await staff(`${p.client_name} is paying ${label} by bank`, `${r.title} on ${p.title}: a bank payment of ${label} is on its way. It shows as paid once it clears, usually within a few business days.`);
  } else if (t.change === "failed") {
    await audit(req, actor, "payment.failed", `A bank payment of ${label} didn’t go through: ${r.title}`, ids);
    await staff(`A payment from ${p.client_name} didn’t go through`, `The bank payment of ${label} for ${r.title} on ${p.title} didn’t go through. It’s open again in the portal.`);
    await client(`Your payment of ${label} didn’t go through`, `The bank payment for ${r.title} on ${p.title} didn’t go through. You can pay again in the portal, by card or bank.`);
  } else if (t.change === "refunded") {
    await audit(req, actor, "payment.refunded", `Refunded ${label}: ${r.title}`, ids);
  }
}
