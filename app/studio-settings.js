// Studio → Settings (owners) and Studio → Activity (the log). See studio.js for the shell.
import { html, useApp, useState, useEffect, useRef, api, Head, Field, Toggle, Confirm, Link, fmtDate, fmtAgo, plural } from "./ui.js";
import { useRun } from "./studio.js";
import { loginPhoto, FOCUS } from "./gate.js";

// ---------- settings ----------
// A short list of sections; one opens at a time (side by side on desktop, one screen at a time on a phone).
const SECTIONS = [
  { key: "check", title: "System check" },
  { key: "brand", title: "Studio details" },
  { key: "signin", title: "Login screen" },
  { key: "welcome", title: "Welcome message" },
  { key: "announcement", title: "Notice for everyone" },
  { key: "stages", title: "Project stages" },
  { key: "caps", title: "New projects start with" },
  { key: "security", title: "Logins and accounts" },
  { key: "reminders", title: "Review reminders" },
];

/** The studio's photos for the login screen, with the side of each that should stay in view. */
const PHOTOS = [
  { image: "/media/login-camera.jpg", label: "Camera at night", focus: "right" },
  { image: "/media/a09.jpg", label: "Crew at sunset", focus: "center" },
  { image: "/media/a03.jpg", label: "Light in the dark", focus: "center" },
  { image: "/media/a01.jpg", label: "Sail at night", focus: "right" },
  { image: "/media/a07.jpg", label: "Wake at sunset", focus: "center" },
  { image: "/media/a08.jpg", label: "At the helm", focus: "left" },
];
const photoLabel = (image) => (PHOTOS.find((x) => x.image === image) || { label: "Your photo" }).label;
const firstSentence = (t) => (String(t || "").match(/^.*?[.!?](?=\s|$)/) || [t])[0];

function summary(key, s, d, health) {
  switch (key) {
    case "check": {
      if (!health) return "Checking…";
      const bad = health.checks.filter((c) => c.ok === false).length, warn = health.checks.filter((c) => c.ok === "warn").length;
      return bad ? `${bad} to fix` : warn ? `All working · ${plural(warn, "suggestion")}` : "All working";
    }
    case "brand": return [s.brand.studio, s.brand.support].filter(Boolean).join(" · ");
    case "signin": return photoLabel(s.signin.image) + (s.signin.quote ? " · Murphy’s Law" : "");
    case "welcome": return s.welcome.title || "None";
    case "announcement": return s.announcement.text || "None showing";
    case "stages": return `${plural(s.stages.length, "stage")}: ${s.stages[0].name} to ${s.stages[s.stages.length - 1].name}`;
    case "caps": { const on = d.capabilities.filter((c) => s.caps[c.key] && !(c.needs && !s.caps[c.needs])).length; return `${on} of ${d.capabilities.length} switched on`; }
    case "security": return (s.security.signup === "off" ? "Invitation only" : "Anyone can ask to join") + (s.security.staffTwoStep ? " · Two-step for staff" : "");
    case "reminders": return s.reminders.enabled ? (s.reminders.daysBefore ? `On, ${plural(s.reminders.daysBefore, "day")} before` : "On, on the day") : "Off";
    default: return "";
  }
}

export function Settings({ admin, section }) {
  const { d } = admin;
  const s = d.settings;
  const [health, setHealth] = useState(null);
  useEffect(() => { api("/api/admin?health=1").then(setHealth).catch((e) => setHealth({ checks: [{ label: "System check", ok: false, detail: e.message }] })); }, []);
  const open = SECTIONS.some((x) => x.key === section) ? section : null;
  const cur = open || "brand";
  const title = SECTIONS.find((x) => x.key === cur).title;
  const pane = {
    check: () => html`<${Health} h=${health} />`,
    brand: () => html`<${Section} admin=${admin} section="brand" title=${title} value=${brandForm(s.brand)} render=${(v, set) => html`
      <div class="formgrid">
        <${Field} label="Studio name"><input class="input" value=${v.studio} onInput=${(e) => set({ studio: e.target.value })} /><//>
        <${Field} label="Help email"><input class="input" type="email" value=${v.support} onInput=${(e) => set({ support: e.target.value })} /><//>
        <${Field} label="Portal address" hint="Change it only when the portal moves. It’s checked before it’s saved."><input class="input" value=${v.portal} onInput=${(e) => set({ portal: e.target.value })} placeholder="https://" /><//>
        <${Field} label="Website" hint="Empty follows the portal’s address."><input class="input" value=${v.website} onInput=${(e) => set({ website: e.target.value })} placeholder=${"Automatic: " + s.brand.website} /><//>
        <${Field} label="Privacy page" hint="Empty is the website’s privacy page."><input class="input" value=${v.privacy} onInput=${(e) => set({ privacy: e.target.value })} placeholder=${"Automatic: " + s.brand.privacy} /><//>
      </div>
      <${Field} label="Above Messages, for clients" hint="Promise only what’s always true."><input class="input" value=${v.replies || ""} onInput=${(e) => set({ replies: e.target.value })} /><//>`} />`,
    signin: () => html`<${Section} admin=${admin} section="signin" title=${title} value=${s.signin} render=${(v, set) => html`<${LoginScreen} v=${v} set=${set} />`} />`,
    welcome: () => html`<${Section} admin=${admin} section="welcome" title=${title} hint="Shown once, the first time a client logs in." value=${s.welcome} render=${(v, set) => html`
      <${Field} label="Heading"><input class="input" value=${v.title} onInput=${(e) => set({ title: e.target.value })} /><//>
      <${Field} label="Text"><textarea class="textarea" rows="3" value=${v.text} onInput=${(e) => set({ text: e.target.value })}></textarea><//>`} />`,
    announcement: () => html`<${Section} admin=${admin} section="announcement" title=${title} hint="One line at the top of every page. Empty shows nothing." value=${s.announcement} render=${(v, set) => html`
      <${Field} label="Notice"><input class="input" value=${v.text} onInput=${(e) => set({ text: e.target.value })} placeholder="We’re filming offshore until Friday; replies may be slower." /><//>
      <div class="seg s3" role="group" aria-label="Tone">${[["info", "Information"], ["warning", "Important"]].map(([k, l]) => html`<button type="button" key=${k} aria-pressed=${v.tone === k} onClick=${() => set({ tone: k })}>${l}</button>`)}</div>`} />`,
    stages: () => html`<${Section} admin=${admin} section="stages" title=${title} hint="Each stage and the progress it shows." value=${s.stages} array render=${(v, setAll) => html`
      <div class="stack" style=${{ gap: "8px" }}>${v.map((st, i) => html`<div class="row stage-row" key=${i}>
        <span class="faint mono" style=${{ width: "18px" }}>${i + 1}</span>
        <input class="input" style=${{ flex: "1 1 160px" }} aria-label=${"Stage " + (i + 1) + " name"} value=${st.name} onInput=${(e) => setAll(v.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
        <input class="input" style=${{ width: "78px" }} type="number" min="0" max="100" aria-label=${"Stage " + (i + 1) + " progress %"} value=${st.pct} onInput=${(e) => setAll(v.map((x, j) => j === i ? { ...x, pct: Number(e.target.value) || 0 } : x))} />
        <span class="faint small">%</span>
        <button type="button" class="btn ghost sm" disabled=${i === 0} aria-label="Move up" onClick=${() => { const c = v.slice(); [c[i - 1], c[i]] = [c[i], c[i - 1]]; setAll(c); }}>↑</button>
        <button type="button" class="btn ghost sm" disabled=${i === v.length - 1} aria-label="Move down" onClick=${() => { const c = v.slice(); [c[i + 1], c[i]] = [c[i], c[i + 1]]; setAll(c); }}>↓</button>
        <button type="button" class="btn ghost sm" disabled=${v.length <= 2} aria-label=${"Remove stage " + (i + 1)} onClick=${() => setAll(v.filter((_, j) => j !== i))}>✕</button>
      </div>`)}</div>
      <div><button type="button" class="btn ghost sm" disabled=${v.length >= 10} onClick=${() => setAll(v.concat([{ name: "", pct: 100 }]))}>Add a stage</button></div>`} />`,
    caps: () => html`<${Section} admin=${admin} section="caps" title=${title} hint="For projects you create from now on. Existing projects keep theirs." value=${s.caps} render=${(v, set) => html`
      <div class="setrows">${d.capabilities.map((c) => html`<div class="setopt" key=${c.key}>
        <div><b>${c.label}</b><span>${firstSentence(c.detail)}</span></div>
        <${Toggle} checked=${!!v[c.key] && !(c.needs && !v[c.needs])} disabled=${c.needs && !v[c.needs]} onChange=${(x) => set({ [c.key]: x })} label=${c.label} />
      </div>`)}</div>`} />`,
    security: () => html`<${Section} admin=${admin} section="security" title=${title} value=${s.security} render=${(v, set) => html`
      <div class="setrows">
        <div class="setopt"><div><b>Two-step verification for staff</b><span>Staff set it up before they can do anything. Turn yours on first.</span></div>
          <${Toggle} checked=${v.staffTwoStep} onChange=${(x) => set({ staffTwoStep: x })} label="Require two-step verification for staff" /></div>
        <div class="setopt"><div><b>Emailed login links</b><span>Log in from a link instead of a password.${d.email ? "" : " Needs email."}</span></div>
          <${Toggle} checked=${v.signinLinks} onChange=${(x) => set({ signinLinks: x })} label="Emailed login links" /></div>
        <div class="setopt"><div><b>Clients manage their team</b><span>Decision makers invite and remove colleagues.</span></div>
          <${Toggle} checked=${v.clientTeams} onChange=${(x) => set({ clientTeams: x })} label="Clients manage their own team" /></div>
        <div class="setopt"><div><b>Join by email domain</b><span>People at a client’s domain get in once they confirm their email.</span></div>
          <${Toggle} checked=${v.domainJoin} disabled=${v.signup === "off"} onChange=${(x) => set({ domainJoin: x })} label="Join by email domain" /></div>
      </div>
      <div class="formgrid">
        <${Field} label="Who can create an account" hint=${d.email ? "" : "Needs email (Connections)."}>
          <select class="select" value=${v.signup} onChange=${(e) => set({ signup: e.target.value })}>
            <option value="request">Anyone, and the studio lets them in</option>
            <option value="off">Only people the studio invites</option>
          </select>
        <//>
        ${v.signup !== "off" && v.domainJoin ? html`<${Field} label="People at a client’s domain join as">
          <select class="select" value=${v.domainRole} onChange=${(e) => set({ domainRole: e.target.value })}>
            ${d.roles.client.map((r) => html`<option key=${r.key} value=${r.key}>${r.label}</option>`)}
          </select>
        <//>` : null}
        <${Field} label="Stay logged in for (days)"><input class="input" style=${{ maxWidth: "120px" }} type="number" min="1" max="30" value=${v.sessionDays} onInput=${(e) => set({ sessionDays: Number(e.target.value) || 1 })} /><//>
      </div>`} />`,
    reminders: () => html`<${Section} admin=${admin} section="reminders" title=${title} hint="For a version still waiting when its “Review by” date nears." value=${s.reminders} render=${(v, set) => html`
      <div class="setrows"><div class="setopt"><div><b>Send automatic reminders</b><span>One email per version, to the client’s decision makers.</span></div>
        <${Toggle} checked=${v.enabled} onChange=${(x) => set({ enabled: x })} label="Send automatic reminders" /></div></div>
      <${Field} label="Days before the date" hint="0 sends it on the day."><input class="input" style=${{ maxWidth: "120px" }} type="number" min="0" max="14" value=${v.daysBefore} onInput=${(e) => set({ daysBefore: Number(e.target.value) || 0 })} /><//>`} />`,
  }[cur];
  return html`
    <${Head} eyebrow="Studio" title="Settings" />
    <div class=${"setwrap" + (open ? " open" : "")}>
      <nav class="setlist" aria-label="Settings sections">${SECTIONS.map((x) => html`<${Link} key=${x.key} to=${"/studio/settings/" + x.key} cls="setrow" current=${x.key === cur}>
        <span class="grow"><b>${x.title}</b><span>${summary(x.key, s, d, health)}</span></span><span class="chev" aria-hidden="true">›</span>
      <//>`)}</nav>
      <div class="setpane">
        <${Link} to="/studio/settings" cls="setback">‹ Settings<//>
        ${pane()}
      </div>
    </div>
  `;
}

/** Login screen: the photo (one of the studio's, or an upload), which side stays in view, and the Murphy's Law. */
function LoginScreen({ v, set }) {
  const { demo, say, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState(null);
  const input = useRef(null);
  const own = /^upload:/.test(v.image) ? [{ image: v.image, label: "Your photo", focus: v.focus }] : [];
  const url = (image) => (local && local.image === image ? local.url : loginPhoto({ image }));
  const upload = async (file) => {
    if (!file) return;
    if (demo) return say("", "your photo stays on your computer.");
    setBusy(true);
    try {
      const { blob, width } = await shrink(file);
      const st = await api("/api/admin", { method: "POST", body: { action: "loginImageStart", size: blob.size } });
      const { put } = await import("/vendor/vercel-blob-client-2.8.0.js");
      await put(st.pathname, blob, { access: "private", token: st.token, contentType: "image/jpeg" });
      setLocal({ image: st.image, url: URL.createObjectURL(blob) });
      set({ image: st.image, focus: "center" });
      toast(width < 1600 ? "Uploaded. It’s small, so it may look soft on big screens. Save to use it." : "Uploaded. Save to use it on the login screen.");
    } catch (e) { toast(e.message, { err: !e.demo }); }
    setBusy(false);
    if (input.current) input.current.value = "";
  };
  const pos = FOCUS[v.focus] || FOCUS.right;
  return html`
    <div class="loginprev" aria-label="Preview of the login screen">
      <div class="img" style=${{ backgroundImage: `url('${url(v.image)}')`, backgroundPosition: `${pos[0]} 50%` }}></div>
      <div class="txt"><span class="t">The <em>screening room.</em></span>
        ${v.quote ? html`<span class="q">“${v.quote}”</span>` : null}</div>
    </div>
    <div class="stack" style=${{ gap: "10px" }}>
      <span class="label">Photo</span>
      <div class="photos" role="group" aria-label="Login photo">
        ${PHOTOS.concat(own).map((x) => html`<button type="button" key=${x.image} class="photo" aria-pressed=${v.image === x.image} aria-label=${x.label} title=${x.label}
          style=${{ backgroundImage: `url('${url(x.image)}')`, backgroundPosition: `${(FOCUS[x.focus] || FOCUS.center)[0]} 50%` }}
          onClick=${() => set({ image: x.image, focus: x.focus })}></button>`)}
        <button type="button" class="photo add" disabled=${busy} onClick=${() => input.current && input.current.click()}>${busy ? "Uploading…" : "Upload a photo"}</button>
      </div>
      <input ref=${input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange=${(e) => upload(e.target.files[0])} />
    </div>
    <div class="stack" style=${{ gap: "10px" }}>
      <span class="label">Keep in view</span>
      <div class="seg s3" role="group" aria-label="Keep in view">${[["left", "Left"], ["center", "Center"], ["right", "Right"]].map(([k, l]) => html`<button type="button" key=${k} aria-pressed=${v.focus === k} onClick=${() => set({ focus: k })}>${l}</button>`)}</div>
    </div>
    <${Field} label="Murphy’s Law: small heading"><input class="input" value=${v.kicker} onInput=${(e) => set({ kicker: e.target.value })} /><//>
    <${Field} label="The law"><input class="input" value=${v.quote} onInput=${(e) => set({ quote: e.target.value })} /><//>
    <${Field} label="The answer"><input class="input" value=${v.answer} onInput=${(e) => set({ answer: e.target.value })} /><//>`;
}

/** Makes an upload a sensible size for the web: at most 2400 px wide, as a JPEG. */
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPEG, PNG, or WebP photo.");
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("That photo couldn’t be opened. Try another.")); i.src = src; });
    const scale = Math.min(1, 2400 / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext("2d");
    g.fillStyle = "#010d10"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.86));
    if (!blob) throw new Error("That photo couldn’t be prepared. Try another.");
    return { blob, width: c.width };
  } finally { URL.revokeObjectURL(src); }
}

/** One settings section with its own Save, Discard, and Reset. */
/** Studio details as the form edits them: addresses left automatic show as empty, with the automatic one shown. */
const brandForm = (b) => ({ studio: b.studio, support: b.support, portal: b.portal, website: b.auto && b.auto.website ? "" : b.website, privacy: b.auto && b.auto.privacy ? "" : b.privacy, replies: b.replies });

function Section({ admin, section, title, hint, value, render, array }) {
  const { run, busy } = useRun(admin);
  const [v, setV] = useState(value);
  const [reset, setReset] = useState(false);
  useEffect(() => { setV(value); }, [JSON.stringify(value)]);
  const dirty = JSON.stringify(v) !== JSON.stringify(value);
  const set = array ? setV : (patch) => setV((x) => ({ ...x, ...patch }));
  return html`<section class="card pad stack setcard" style=${{ gap: "18px" }}>
    <div class="stack" style=${{ gap: "4px" }}><h2 class="h3">${title}</h2>${hint ? html`<span class="muted small">${hint}</span>` : null}</div>
    ${render(v, set)}
    <div class="row">
      <button class="btn primary sm" disabled=${!dirty || busy} onClick=${() => run({ action: "settingsSave", section, value: v }, "Saved.")}>${busy ? "Saving…" : "Save"}</button>
      ${dirty ? html`<button class="btn ghost sm" disabled=${busy} onClick=${() => setV(value)}>Discard</button>` : null}
      <button class="link small faint" style=${{ marginLeft: "auto" }} onClick=${() => setReset(true)}>Back to the original</button>
    </div>
    ${reset ? html`<${Confirm} title=${`Put “${title}” back to the original?`} yes="Put it back" busy=${busy} onYes=${async () => { await run({ action: "settingsReset", section }, "Back to the original."); setReset(false); }} onNo=${() => setReset(false)}>
      This replaces what’s there now with the portal’s original wording and values.
    <//>` : null}
  </section>`;
}

/** System check: everything the portal needs to run properly, with what to do about anything that isn't right. */
function Health({ h }) {
  if (!h) return html`<div class="boot-line"><i></i></div>`;
  const bad = h.checks.filter((c) => c.ok === false), warn = h.checks.filter((c) => c.ok === "warn");
  return html`<section class=${"card pad stack setcard health " + (bad.length ? "bad" : warn.length ? "warn" : "ok")} style=${{ gap: "14px" }}>
    <div class="stack" style=${{ gap: "4px" }}><h2 class="h3">System check</h2>
      <span class="muted small">${bad.length ? `${bad.length} thing${bad.length === 1 ? " needs" : "s need"} fixing.` : warn.length ? `All working. ${plural(warn.length, "suggestion")}.` : "Everything is set up."}</span></div>
    <div class="stack" style=${{ gap: "10px" }}>${h.checks.map((c) => html`<div key=${c.label} class=${"check " + (c.ok === true ? "ok" : c.ok === "warn" ? "warn" : "no")}>
      <i>${c.ok === true ? "✓" : c.ok === "warn" ? "!" : "✕"}</i><span><b>${c.label}.</b> ${c.detail}</span></div>`)}</div>
  </section>`;
}

// ---------- activity ----------

export function Activity({ admin }) {
  const { d } = admin;
  const [f, setF] = useState({ kind: "", project: "", client: "", q: "" });
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");
  const qs = (extra = {}) => new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v)).toString();
  const load = async (before) => {
    setErr("");
    try {
      const r = await api("/api/admin?audit=1&" + qs(before ? { before } : {}));
      setRows((x) => (before ? (x || []).concat(r.entries) : r.entries)); setMore(r.more);
    } catch (e) { setErr(e.message); setRows([]); }
  };
  useEffect(() => { setRows(null); const t = setTimeout(() => load(), f.q ? 300 : 0); return () => clearTimeout(t); }, [f.kind, f.project, f.client, f.q]);
  return html`
    <${Head} eyebrow="Studio" title="Activity" actions=${d.demo ? null : html`<a class="btn ghost" href=${"/api/admin?audit=csv&" + qs()} download>Export to a spreadsheet</a>`}>
      Who did what, and when: logins, views, downloads, approvals, changes in Studio. Kept for about 13 months.
    <//>
    <div class="row filters" style=${{ marginBottom: "16px" }}>
      <select class="select" style=${{ width: "auto", maxWidth: "100%" }} aria-label="Show" value=${f.kind ? "kind:" + f.kind : f.client ? "client:" + f.client : f.project ? "project:" + f.project : ""}
        onChange=${(e) => { const [k, v] = e.target.value.split(":"); setF({ ...f, kind: k === "kind" ? v : "", client: k === "client" ? v : "", project: k === "project" ? v : "" }); }}>
        <option value="">Everything</option>
        <optgroup label="Who">${[["client", "Client people only"], ["staff", "Staff only"], ["system", "The portal itself"]].map(([k, l]) => html`<option key=${k} value=${"kind:" + k}>${l}</option>`)}</optgroup>
        ${d.clients.length ? html`<optgroup label="Client">${d.clients.map((c) => html`<option key=${c.id} value=${"client:" + c.id}>${c.name}</option>`)}</optgroup>` : null}
        ${d.projects.length ? html`<optgroup label="Project">${d.projects.map((p) => html`<option key=${p.id} value=${"project:" + p.id}>${p.title}</option>`)}</optgroup>` : null}
      </select>
      <input class="input" style=${{ width: "240px" }} type="search" placeholder="Find a name or word" aria-label="Find in the activity" value=${f.q} onInput=${(e) => setF({ ...f, q: e.target.value })} />
    </div>
    ${err ? html`<div class="alert">${err}</div>` : null}
    ${rows == null ? html`<div class="boot-line"><i></i></div>` : !rows.length ? html`<p class="muted">Nothing yet${f.kind || f.project || f.client || f.q ? " that matches" : ""}.</p>`
      : html`<table class="table log"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Project</th></tr></thead>
        <tbody>${rows.map((r) => html`<tr key=${r.id}>
          <td class="small nowrap" title=${fmtDate(r.at, true)}>${fmtAgo(r.at)}</td>
          <td class="small"><b>${r.who || "The portal"}</b>${r.kind === "client" && r.client ? html`<div class="faint">${r.client}</div>` : r.kind === "staff" ? html`<div class="faint">studio</div>` : null}</td>
          <td>${r.summary}</td>
          <td class="small muted">${r.project || ""}</td>
        </tr>`)}</tbody></table>
        ${more ? html`<p><button class="btn ghost" onClick=${() => load(rows[rows.length - 1].id)}>Show older</button></p>` : null}`}
  `;
}
