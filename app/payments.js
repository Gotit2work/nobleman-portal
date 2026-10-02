// Payments: what the studio asked to be paid on a project, and paying it on Stripe's checkout (api/_payments.js).
// Card and bank details are typed on Stripe's page, never here. Back from Stripe, the page asks the server to check
// with Stripe, so "Paid" only shows once Stripe says so.
import { html, useApp, useState, useEffect, api, Head, Link, fmtDate, fmtDay, isStaff } from "./ui.js";

export const money = (cents, currency = "usd") => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`; }
};
export const openOf = (p) => (p.payments || []).filter((x) => x.status === "open" || x.status === "processing");
const STATUS = { open: ["Due", "amber"], processing: ["On its way", "amber"], paid: ["Paid", "green"], refunded: ["Refunded", ""] };

export function Payments({ pid }) {
  const { data, user, demo, say, toast, reload } = useApp();
  const admin = isStaff(user);
  const ps = data.projects.filter((p) => p.caps.payments && (p.payments || []).length);
  const p = ps.find((x) => x.id === pid) || ps[0];
  const [busy, setBusy] = useState(null);

  // Back from Stripe (/payments/<project>?paid=<payment>&session=…): ask the server, which asks Stripe.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("paid");
    if (!id) return;
    history.replaceState(null, "", location.pathname);
    if (demo) return;
    api("/api/portal", { method: "POST", body: { action: "payCheck", paymentId: id } }).then((r) => {
      const st = r.payment.status;
      toast(st === "paid" ? `Thank you. ${r.payment.label} is paid.`
        : st === "processing" ? "Thank you. Your bank payment is on its way. It shows as paid once it clears."
        : "Stripe hasn’t confirmed this payment yet. If you finished paying, it updates here within a day.");
      reload();
    }).catch((e) => toast(e.message, { err: true }));
  }, []);

  if (!p) {
    return html`<div class="page"><${Head} eyebrow="Payments" title="Nothing to pay.">When the studio asks for a payment, it shows here with a button to pay by card or bank.<//></div>`;
  }
  const pay = async (x) => {
    if (demo) return say("", "in the real portal this opens Stripe’s secure checkout, and the payment marks itself paid.");
    setBusy(x.id);
    try {
      const r = await api("/api/portal", { method: "POST", body: { action: "pay", paymentId: x.id } });
      if (r.url) { location.assign(r.url); return; }
      toast(r.payment.status === "processing" ? "Your bank payment is already on its way. It shows as paid once it clears." : `${r.payment.label} is already paid.`);
      reload();
    } catch (e) { toast(e.message, { err: true }); }
    setBusy(null);
  };
  const open = openOf(p);
  const due = open.reduce((n, x) => n + x.amount, 0);
  const canPay = p.caps.pay && data.payReady;

  return html`<div class="page">
    <${Head} eyebrow=${p.title} title="Payments" actions=${admin ? html`<${Link} to=${"/studio/projects/" + p.id} cls="btn ghost sm">Manage in Studio<//>` : null}>
      ${open.length ? `${money(due, open[0].currency)} due. ` : "Everything asked for is paid. "}You pay on Stripe’s secure checkout, by card or bank; the portal never sees your card details.
    <//>
    ${ps.length > 1 ? html`<div class="tabs" style=${{ marginBottom: "16px" }} aria-label="Projects">${ps.map((x) => html`<${Link} key=${x.id} to=${"/payments/" + x.id} cls="tab-btn" current=${x.id === p.id}>${x.title}${openOf(x).length ? html`<span class="d" aria-label="something due"></span>` : null}<//>`)}</div>` : null}
    <div class="list">${p.payments.map((x) => {
      const [label, tone] = STATUS[x.status] || [x.status, ""];
      return html`<div class="li payrow" key=${x.id}>
        <div class="grow">
          <div class="name">${x.title}</div>
          <div class="meta">${x.status === "paid" ? `Paid ${fmtDate(x.paidAt)}${x.paidBy ? " · " + x.paidBy : ""}`
            : x.status === "processing" ? "A bank payment is on its way"
            : x.status === "refunded" ? "Refunded"
            : x.due ? `Due ${fmtDay(x.due)}` : `Asked for ${fmtDate(x.created)}`}</div>
          ${x.note ? html`<div class="meta">${x.note}</div>` : null}
        </div>
        <b class="amt">${x.label}</b>
        ${x.status === "open" && canPay
          ? html`<button class="btn primary sm" disabled=${!!busy} onClick=${() => pay(x)}>${busy === x.id ? "Opening Stripe…" : "Pay"}</button>`
          : html`<span class=${"pill " + tone}>${label}</span>`}
      </div>`;
    })}</div>
    ${open.length && !admin && !p.caps.pay ? html`<p class="muted small" style=${{ marginTop: "14px" }}>Your company’s decision makers pay. They see this same list.</p>` : null}
    ${open.length && !data.payReady ? html`<p class="muted small" style=${{ marginTop: "14px" }}>Paying here isn’t set up yet. Ask the studio how to pay.</p>` : null}
  </div>`;
}
