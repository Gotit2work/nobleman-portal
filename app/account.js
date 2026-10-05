// Account: your details, email updates, password, two-step verification, your team (decision makers), and sign out.
import { html, useApp, useState, useEffect, api, Head, Field, Toggle, Avatar, Confirm, Modal, copy, saveText, fmtAgo, isStaff } from "./ui.js";
import { TwoStepSetup } from "./twostep.js";

export function Account() {
  const app = useApp();
  const { user, demo, say, toast, setData, signOut, data } = app;
  const staff = isStaff(user);
  const [name, setName] = useState(user.name);
  const [title, setTitle] = useState(user.title || "");
  const [notify, setNotify] = useState(user.notifyEmail);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [pwErr, setPwErr] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const emailOn = data.emailEnabled;
  const brand = data.brand || {};
  const studio = brand.studio || "the studio";
  const dirty = name !== user.name || title !== (user.title || "") || notify !== user.notifyEmail;

  const save = async () => {
    if (demo) return say("", "your details weren’t saved.");
    setBusy(true);
    try {
      const d = await api("/api/session", { method: "POST", body: { action: "profile", name, title, notifyEmail: notify } });
      setData((x) => ({ ...x, user: { ...x.user, ...d.user } }));
      toast("Your details are saved.");
    } catch (e) { toast(e.message, { err: true }); }
    setBusy(false);
  };
  const change = async (e) => {
    e.preventDefault();
    if (demo) return say("", "passwords can’t be changed in the demo.");
    if (pw.next !== pw.again) return setPwErr("The two new passwords don’t match.");
    setPwBusy(true); setPwErr("");
    try {
      await api("/api/session", { method: "POST", body: { action: "password", current: pw.current, next: pw.next } });
      setPw({ current: "", next: "", again: "" });
      setPwOpen(false);
      toast("Password changed. You’re logged out everywhere else.");
    } catch (x) { setPwErr(x.message); }
    setPwBusy(false);
  };

  return html`<div class="page">
    <${Head} eyebrow="Account" title="Your account" />
    <div class="grid c2">
      <section class="card pad stack" style=${{ gap: "18px" }}>
        <div class="row"><${Avatar} name=${user.name} size=${52} /><div><div class="h3">${user.name}</div>
          <div class="muted small">${[user.email, user.clientName || (staff ? studio : ""), user.roleLabel].filter(Boolean).join(" · ")}</div></div></div>
        <${Field} label="Your name"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} autoComplete="name" /><//>
        <${Field} label="Job title (optional)"><input class="input" value=${title} onInput=${(e) => setTitle(e.target.value)} autoComplete="organization-title" /><//>
        <${Field} label="Email" hint=${staff ? "An owner can change it in Studio → People." : "To change the email you log in with, ask the studio."}><input class="input" value=${user.email || ""} disabled /><//>
        ${emailOn ? html`<div class="row" style=${{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <div><b>Email me about updates</b><div class="muted small" style=${{ lineHeight: 1.5 }}>${staff ? "When a client leaves notes, decides on a version, sends a message, or uploads." : "When the studio shares a new version, film, file, or message."} Not while you’re using the portal.</div></div>
          <${Toggle} checked=${notify} onChange=${setNotify} label="Email me about updates" />
        </div>` : null}
        <div><button class="btn primary" disabled=${busy || !name.trim() || !dirty} onClick=${save}>${busy ? "Saving…" : "Save my details"}</button></div>
      </section>
      <section class="card pad stack" style=${{ gap: "18px", alignSelf: "start" }}>
        <div class="h3">Password</div>
        ${!pwOpen ? html`<p class="muted small" style=${{ margin: 0 }}>Changing it logs you out on your other devices.</p>
        <div><button class="btn ghost" onClick=${() => setPwOpen(true)}>Change my password</button></div>` : html`
        <form class="stack" style=${{ gap: "16px" }} onSubmit=${change}>
          <input type="email" autoComplete="username" value=${user.email || ""} readOnly hidden />
          <${Field} label="Current password"><input class="input" type="password" autoComplete="current-password" required value=${pw.current} onInput=${(e) => setPw({ ...pw, current: e.target.value })} /><//>
          <${Field} label="New password" hint="At least 10 characters. A short phrase is easy to remember and hard to guess."><input class="input" type="password" autoComplete="new-password" required value=${pw.next} onInput=${(e) => setPw({ ...pw, next: e.target.value })} /><//>
          <${Field} label="New password again"><input class="input" type="password" autoComplete="new-password" required value=${pw.again} onInput=${(e) => setPw({ ...pw, again: e.target.value })} /><//>
          ${pwErr ? html`<div class="alert" role="alert">${pwErr}</div>` : null}
          <div class="row"><button class="btn primary" disabled=${pwBusy}>${pwBusy ? "Changing…" : "Change my password"}</button>
            <button type="button" class="btn ghost" onClick=${() => { setPwOpen(false); setPwErr(""); setPw({ current: "", next: "", again: "" }); }}>Cancel</button></div>
        </form>`}
      </section>
    </div>
    <${TwoStep} />
    ${!staff && user.perms && user.perms.team ? html`<${Team} />` : null}
    <section class="section row" style=${{ justifyContent: "space-between" }}>
      <button class="btn ghost" onClick=${signOut}>Log out</button>
      <span class="muted small">How we handle your information: <a href=${brand.privacy || "https://noblemanproductions.gotit2work.com/privacy#portal"}>Privacy</a></span>
    </section>
  </div>`;
}

// The six-digit code (or a recovery code) that confirms it's you before turning two-step off or making new codes.
function CodeAsk({ title, yes, onDone, onClose, action, toast }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try { onDone(await api("/api/session", { method: "POST", body: { action, code } })); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return html`<${Modal} title=${title} onClose=${onClose}>
    <form class="stack" style=${{ gap: "14px" }} onSubmit=${go}>
      <${Field} label="The six-digit code from your authenticator app" hint="Or one of your recovery codes.">
        <input class="input code" autoComplete="one-time-code" autoFocus value=${code} onInput=${(e) => setCode(e.target.value)} required />
      <//>
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <div class="row"><button class="btn primary" disabled=${busy || !code.trim()}>${busy ? "Checking…" : yes}</button><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button></div>
    </form>
  <//>`;
}

function TwoStep() {
  const { user, demo, say, toast, setData } = useApp();
  const [mode, setMode] = useState(null);   // "setup" | "off" | "codes"
  const [codes, setCodes] = useState(null);
  const on = user.twoStep;
  const set = (v) => setData((x) => ({ ...x, user: { ...x.user, twoStep: v } }));
  return html`<section class="card pad stack section" style=${{ gap: "14px" }}>
    <div class="row" style=${{ justifyContent: "space-between" }}>
      <div class="h3">Two-step verification</div>
      <span class=${"pill " + (on ? "green" : "")}>${on ? "On" : "Off"}</span>
    </div>
    ${mode === "setup" ? html`<${TwoStepSetup} toast=${toast} onDone=${() => { set(true); setMode(null); toast("Two-step verification is on."); }} />`
      : on ? html`<p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>After your password, enter the code from your phone. Lost it? Use a recovery code.</p>
          <div class="row">
            <button class="btn ghost" onClick=${() => setMode("codes")}>Make new recovery codes</button>
            ${user.twoStepRequired ? html`<span class="faint small">Staff must keep it on.</span>` : html`<button class="btn ghost" onClick=${() => setMode("off")}>Turn it off</button>`}
          </div>`
      : html`<p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>A code from your phone after your password, so a stolen password isn’t enough. Takes a minute.</p>
          <div><button class="btn primary" onClick=${() => demo ? say("", "two-step verification can’t be turned on in the demo.") : setMode("setup")}>Set up two-step verification</button></div>`}
    ${mode === "off" ? html`<${CodeAsk} title="Turn off two-step verification?" yes="Turn it off" action="twoStepDisable" toast=${toast}
      onClose=${() => setMode(null)} onDone=${() => { set(false); setMode(null); toast("Two-step verification is off."); }} />` : null}
    ${mode === "codes" ? html`<${CodeAsk} title="Make new recovery codes?" yes="Make new codes" action="recoveryCodes" toast=${toast}
      onClose=${() => setMode(null)} onDone=${(d) => { setCodes(d.recoveryCodes); setMode(null); }} />` : null}
    ${codes ? html`<${Modal} title="Your new recovery codes" onClose=${() => setCodes(null)}>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>Your old codes no longer work. Keep these somewhere safe; each works once.</p>
      <div class="codes">${codes.map((c) => html`<code key=${c}>${c}</code>`)}</div>
      <div class="row">
        <button class="btn ghost" onClick=${() => copy(codes.join("\n"), toast, "Recovery codes")}>Copy</button>
        <button class="btn ghost" onClick=${() => saveText(codes.join("\n") + "\n", "portal-recovery-codes.txt")}>Download</button>
        <button class="btn primary" onClick=${() => setCodes(null)}>I’ve saved them</button>
      </div>
    <//>` : null}
  </section>`;
}

/** Decision makers manage their own company's people: add (emailed an invitation), change role, remove. */
function Team() {
  const { user, demo, say, toast } = useApp();
  const [t, setT] = useState(null);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", access: "reviewer" });
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const load = () => api("/api/portal?team=1").then(setT).catch((e) => setErr(e.message));
  useEffect(() => {
    if (demo) setT({ people: [{ id: user.id, name: user.name, email: user.email, access: "approver", me: true, lastLogin: new Date().toISOString() }, { id: "t2", name: "Marco Reyes", email: "marco@example.com", access: "reviewer", lastLogin: new Date(Date.now() - 3 * 864e5).toISOString() }],
      roles: [{ key: "approver", label: "Decision maker", detail: "Reviews, approves versions, and can add teammates." }, { key: "reviewer", label: "Reviewer", detail: "Watches and leaves notes. Can’t approve." }, { key: "viewer", label: "Viewer", detail: "Watches and downloads. No notes or messages." }], canInvite: true });
    else load();
  }, []);
  const act = async (body, done) => {
    if (demo) return say("", "your team can’t be changed in the demo.");
    setBusy(true);
    try { await api("/api/portal", { method: "POST", body }); toast(done); await load(); return true; }
    catch (e) { toast(e.message, { err: true }); return false; }
    finally { setBusy(false); }
  };
  const add = async (e) => {
    e.preventDefault();
    if (await act({ action: "teamAdd", ...form }, `${form.name} has been emailed an invitation.`)) { setAdding(false); setForm({ name: "", email: "", access: "reviewer" }); }
  };
  if (err) return html`<section class="section"><div class="alert">${err}</div></section>`;
  if (!t) return null;
  const label = (k) => (t.roles.find((r) => r.key === k) || {}).label || k;
  return html`<section class="card pad stack section" style=${{ gap: "14px" }}>
    <div class="row" style=${{ justifyContent: "space-between" }}>
      <div class="h3">Your team at ${user.clientName}</div>
      ${t.canInvite ? html`<button class="btn ghost sm" onClick=${() => setAdding(true)}>Add a teammate</button>` : null}
    </div>
    <details class="small muted"><summary style=${{ cursor: "pointer" }}>What each role can do</summary>
      <ul style=${{ margin: "8px 0 0", paddingLeft: "18px", lineHeight: 1.6 }}>${t.roles.map((r) => html`<li key=${r.key}><b>${r.label}:</b> ${r.detail}</li>`)}</ul></details>
    <div class="list">${t.people.map((x) => html`<div class="li" key=${x.id} style=${{ flexWrap: "wrap" }}>
      <${Avatar} name=${x.name} />
      <div class="grow" style=${{ minWidth: "160px" }}><div class="name">${x.name}${x.me ? html` <span class="faint">· you</span>` : null}</div>
        <div class="meta">${x.email} · ${x.invited ? "Invited, hasn’t logged in yet" : x.lastLogin ? "Last logged in " + fmtAgo(x.lastLogin) : "Hasn’t logged in yet"}</div></div>
      ${x.me ? html`<span class="pill">${label(x.access)}</span>` : html`
        <label class="sr" for=${"role-" + x.id}>Role for ${x.name}</label>
        <select id=${"role-" + x.id} class="select" style=${{ width: "auto" }} value=${x.access} disabled=${busy}
          onChange=${(e) => act({ action: "teamUpdate", id: x.id, access: e.target.value }, `${x.name} is now a ${label(e.target.value)}.`)}>
          ${t.roles.map((r) => html`<option key=${r.key} value=${r.key}>${r.label}</option>`)}
        </select>
        <button class="btn ghost sm" onClick=${() => setDel(x)}>Remove</button>`}
    </div>`)}</div>
    ${!t.canInvite ? html`<p class="faint small" style=${{ margin: 0 }}>To add someone, ask the studio: the portal can’t send invitations yet.</p>` : null}
    ${adding ? html`<${Modal} title="Add a teammate" onClose=${() => setAdding(false)}>
      <form class="stack" style=${{ gap: "14px" }} onSubmit=${add}>
        <${Field} label="Their name"><input class="input" required value=${form.name} onInput=${(e) => setForm({ ...form, name: e.target.value })} /><//>
        <${Field} label="Their work email" hint="They get an email with a link to set their password. It works for 14 days."><input class="input" type="email" required value=${form.email} onInput=${(e) => setForm({ ...form, email: e.target.value })} /><//>
        <${Field} label="What they can do">
          <select class="select" value=${form.access} onChange=${(e) => setForm({ ...form, access: e.target.value })}>${t.roles.map((r) => html`<option key=${r.key} value=${r.key}>${r.label}: ${r.detail}</option>`)}</select>
        <//>
        <div class="row"><button class="btn primary" disabled=${busy}>${busy ? "Sending…" : "Send the invitation"}</button><button type="button" class="btn ghost" onClick=${() => setAdding(false)}>Cancel</button></div>
      </form>
    <//>` : null}
    ${del ? html`<${Confirm} title=${`Remove ${del.name}?`} yes=${`Remove ${del.name}`} busy=${busy}
      onYes=${async () => { await act({ action: "teamRemove", id: del.id }, `${del.name} was removed.`); setDel(null); }} onNo=${() => setDel(null)}>
      They’re logged out and can’t log in again. Their notes and messages stay. The studio is told.
    <//>` : null}
  </section>`;
}
