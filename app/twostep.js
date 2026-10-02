// Turning on two-step verification: scan a QR code with an authenticator app (Google Authenticator, 1Password,
// Microsoft Authenticator…), type the six-digit code it shows, then keep the recovery codes somewhere safe.
// Used on the account page, and on the screen staff see when the studio requires it.
import { html, useState, useEffect, useRef, api, Field, copy, saveText } from "./ui.js";

function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/qrcode-generator-1.4.4.js";
    s.onload = () => resolve(window.qrcode);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function Qr({ text }) {
  const box = useRef(null);
  useEffect(() => {
    loadQr().then((qrcode) => {
      const q = qrcode(0, "M");
      q.addData(text); q.make();
      if (box.current) box.current.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    }).catch(() => {});
  }, [text]);
  return html`<div class="qr" ref=${box} role="img" aria-label="QR code for your authenticator app"></div>`;
}

export function TwoStepSetup({ toast, onDone }) {
  const [step, setStep] = useState("start");
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const begin = async () => {
    setBusy(true); setErr("");
    try { setSetup(await api("/api/session", { method: "POST", body: { action: "twoStepBegin" } })); setStep("scan"); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const enable = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try { const d = await api("/api/session", { method: "POST", body: { action: "twoStepEnable", code } }); setCodes(d.recoveryCodes); setStep("codes"); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };
  if (step === "start") {
    return html`<div class="stack" style=${{ gap: "14px" }}>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>After your password, the portal asks for a six-digit code from an app on your phone. Someone who learns your password still can’t get in.</p>
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <div><button class="btn primary" disabled=${busy} onClick=${begin}>${busy ? "One moment…" : "Turn on two-step verification"}</button></div>
    </div>`;
  }
  if (step === "scan") {
    return html`<form class="stack" style=${{ gap: "16px" }} onSubmit=${enable}>
      <ol class="steps">
        <li>Open your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) and add an account.</li>
        <li>Scan this code. Can’t scan? Type the key below instead.</li>
      </ol>
      <div class="row" style=${{ gap: "20px", alignItems: "center", flexWrap: "wrap" }}>
        <${Qr} text=${setup.uri} />
        <div class="stack" style=${{ gap: "6px", minWidth: 0 }}>
          <span class="faint small">Key</span>
          <code class="key">${setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
          <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${() => copy(setup.secret, toast, "Key")}>Copy the key</button>
        </div>
      </div>
      <${Field} label="The six-digit code your app shows now">
        <input class="input code" inputMode="numeric" autoComplete="one-time-code" maxLength="7" value=${code} onInput=${(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} required />
      <//>
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <div><button class="btn primary" disabled=${busy || code.replace(/\s/g, "").length !== 6}>${busy ? "Checking…" : "Check the code and turn it on"}</button></div>
    </form>`;
  }
  return html`<div class="stack" style=${{ gap: "14px" }}>
    <div class="alert info"><b>Two-step verification is on.</b> Keep these recovery codes somewhere safe, like a password manager. Each one works once if you lose your phone. They won’t be shown again.</div>
    <div class="codes">${codes.map((c) => html`<code key=${c}>${c}</code>`)}</div>
    <div class="row">
      <button class="btn ghost" onClick=${() => copy(codes.join("\n"), toast, "Recovery codes")}>Copy the codes</button>
      <button class="btn ghost" onClick=${() => saveText(codes.join("\n") + "\n", "portal-recovery-codes.txt")}>Download them</button>
      <button class="btn primary" onClick=${onDone}>I’ve saved them</button>
    </div>
  </div>`;
}
