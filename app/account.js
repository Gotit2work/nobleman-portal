// Account: your details, email updates, password, and sign out.
import { html, useApp, useState, api, Head, Field, Toggle, Avatar } from "./ui.js";

export function Account() {
  const app = useApp();
  const { user, demo, say, toast, setData, signOut } = app;
  const [name, setName] = useState(user.name);
  const [title, setTitle] = useState(user.title || "");
  const [notify, setNotify] = useState(user.notifyEmail);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const emailOn = app.data.emailEnabled;

  const save = async () => {
    if (demo) return say("", "your details weren’t saved.");
    setBusy(true);
    try {
      const d = await api("/api/session", { method: "POST", body: { action: "profile", name, title, notifyEmail: notify } });
      setData((x) => ({ ...x, user: d.user }));
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
      toast("Password changed. You’re signed out everywhere else.");
    } catch (x) { setPwErr(x.message); }
    setPwBusy(false);
  };

  return html`<div class="page">
    <${Head} eyebrow="Account" title="Your account">Your details, how Nobleman reaches you, and your password.<//>
    <div class="grid c2">
      <section class="card pad stack" style=${{ gap: "18px" }} data-reveal="card">
        <div class="row"><${Avatar} name=${user.name} size=${52} /><div><div class="h3">${user.name}</div><div class="muted small">${user.email || ""}${user.clientName ? " · " + user.clientName : user.role === "admin" ? " · Nobleman Productions" : ""}</div></div></div>
        <${Field} label="Your name"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} autoComplete="name" /><//>
        <${Field} label="Job title (optional)"><input class="input" value=${title} onInput=${(e) => setTitle(e.target.value)} autoComplete="organization-title" /><//>
        <${Field} label="Email" hint="To change the email you sign in with, ask Nobleman."><input class="input" value=${user.email || ""} disabled /><//>
        ${emailOn ? html`<div class="row" style=${{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <div><b>Email me about updates</b><div class="muted small" style=${{ lineHeight: 1.5 }}>${user.role === "admin" ? "When a client leaves notes, decides on a version, sends a message, or uploads." : "When Nobleman messages you or adds a new film or file."}</div></div>
          <${Toggle} checked=${notify} onChange=${setNotify} label="Email me about updates" />
        </div>` : null}
        <div><button class="btn primary" disabled=${busy || !name.trim()} onClick=${save}>${busy ? "Saving…" : "Save my details"}</button></div>
      </section>
      <section class="card pad stack" style=${{ gap: "18px" }} data-reveal="card">
        <div class="h3">Password</div>
        <form class="stack" style=${{ gap: "16px" }} onSubmit=${change}>
          <${Field} label="Current password"><input class="input" type="password" autoComplete="current-password" required value=${pw.current} onInput=${(e) => setPw({ ...pw, current: e.target.value })} /><//>
          <${Field} label="New password" hint="At least 10 characters. A short phrase is easy to remember and hard to guess."><input class="input" type="password" autoComplete="new-password" required value=${pw.next} onInput=${(e) => setPw({ ...pw, next: e.target.value })} /><//>
          <${Field} label="New password again"><input class="input" type="password" autoComplete="new-password" required value=${pw.again} onInput=${(e) => setPw({ ...pw, again: e.target.value })} /><//>
          ${pwErr ? html`<div class="alert" role="alert">${pwErr}</div>` : null}
          <div><button class="btn primary" disabled=${pwBusy}>${pwBusy ? "Changing…" : "Change my password"}</button></div>
        </form>
      </section>
    </div>
    <section class="section row" style=${{ justifyContent: "space-between" }}>
      <button class="btn ghost" onClick=${signOut}>Sign out</button>
      <span class="muted small">How we handle your information: <a href="https://noblemanproductions.gotit2work.com/privacy#portal">Privacy</a></span>
    </section>
  </div>`;
}
