// Studio (staff only): everything the studio runs, without touching code. Each tab and button appears only
// when the person's role allows it (api/_roles.js); the server checks again on every action.
//   Projects     each client project: progress, video source, videos, what the client can do
//   Clients      companies: logo, notes, data export          (studio-people.js)
//   People       accounts, roles, login help, the roles table (studio-people.js)
//   Connections  video sources, Notion, email, file storage     (studio-connect.js)
//   Settings     brand, login screen, stages, defaults, security, reminders, system check (studio-settings.js)
//   Activity     who did what, filterable, exportable           (studio-settings.js)
import { html, useApp, useState, useEffect, api, Head, Empty, Link, Field, Toggle, Modal, Confirm, More, Icon, fmtDate, fmtAgo, fmtDay, plural, can } from "./ui.js";
import { Clients, People } from "./studio-people.js";
import { Connections } from "./studio-connect.js";
import { Settings, Activity } from "./studio-settings.js";
import { openOf, money } from "./payments.js";

const R = window.React;

const TABS = [
  { key: "projects", label: "Projects", icon: "camera", any: [] },
  { key: "clients", label: "Clients", icon: "anchor", any: ["clients.manage", "data.export"] },
  { key: "people", label: "People", icon: "crew", any: ["people.manage", "staff.manage"] },
  { key: "connections", label: "Connections", icon: "play", any: ["connections.manage"] },
  { key: "settings", label: "Settings", icon: "key", any: ["settings.manage"] },
  { key: "activity", label: "Activity", icon: "grid", any: ["audit.view"] },
];

function useAdmin() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const load = async () => { try { const x = await api("/api/admin"); setD(x); setErr(""); return x; } catch (e) { setErr(e.message); return null; } };
  useEffect(() => { load(); }, []);
  // Studio's own data plus the person's permissions, so every tab asks the same question the server does.
  return { d, err, load, can: (perm) => !!(d && d.me && d.me.perms && d.me.perms[perm]) };
}

/** Runs one Studio action: busy state, toast on success, the server's message on failure. */
export function useRun(admin) {
  const { toast, reload } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (body, done, { refresh = true } = {}) => {
    setBusy(true);
    try {
      const r = await api("/api/admin", { method: "POST", body });
      if (refresh) { await admin.load(); reload(); }
      if (done) toast(typeof done === "function" ? done(r) : done);
      return r || {};
    } catch (e) { toast(e.message, { err: !e.demo }); return null; }
    finally { setBusy(false); }
  };
  return { busy, run };
}

export function Studio({ tab = "projects", id }) {
  const { user } = useApp();
  const admin = useAdmin();
  const { d, err } = admin;
  const tabs = TABS.filter((x) => !x.any.length || x.any.some((p) => can(user, p)));
  const t = tabs.some((x) => x.key === tab) ? tab : tab === "vimeo" && tabs.some((x) => x.key === "connections") ? "connections" : "projects";
  // On a phone the tabs scroll sideways: keep the open one in view.
  useEffect(() => { const el = document.querySelector(".studio-tabs [aria-current]"); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [t]);
  return html`<div class="page wide studio">
    <nav class="studio-tabs" aria-label="Studio sections">${tabs.map((x) => html`<${Link} key=${x.key} to=${"/studio/" + x.key} cls="tab-btn" current=${x.key === t}><${Icon} name=${x.icon} size=${18} />${x.label}<//>`)}</nav>
    ${err ? html`<div class="alert">${err}</div>` : !d ? html`<div class="boot-line"><i></i></div>`
      : t === "projects" ? (id ? html`<${ProjectEdit} id=${id} admin=${admin} key=${id} />` : html`<${Projects} admin=${admin} />`)
      : t === "clients" ? html`<${Clients} admin=${admin} />`
      : t === "people" ? html`<${People} admin=${admin} view=${id} />`
      : t === "connections" ? html`<${Connections} admin=${admin} />`
      : t === "settings" ? html`<${Settings} admin=${admin} section=${id} />`
      : html`<${Activity} admin=${admin} />`}
  </div>`;
}

// ---------- shared pickers ----------
export function ClientPicker({ clients, value, onChange, disabled }) {
  const isNew = value.clientId === "__new";
  return html`<div class="stack" style=${{ gap: "10px" }}>
    <${Field} label="Client">
      <select class="select" value=${value.clientId} disabled=${disabled} onChange=${(e) => onChange({ clientId: e.target.value, clientName: "" })}>
        <option value="">Choose a client…</option>
        ${clients.map((c) => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}
        <option value="__new">+ A new client</option>
      </select>
    <//>
    ${isNew ? html`<${Field} label="New client’s name"><input class="input" value=${value.clientName} onInput=${(e) => onChange({ clientId: "__new", clientName: e.target.value })} placeholder="For example: Meridian" /><//>` : null}
  </div>`;
}

export const providerOf = (d, key) => d.providers.find((p) => p.key === key) || null;
const videoConns = (d) => d.connections.filter((c) => { const p = providerOf(d, c.provider); return p && p.kind === "video"; });

/** Where a project's videos come from: a connection plus a folder / playlist / project in it, or pasted links. */
function SourcePicker({ d, value, onChange, projects, selfId, disabled }) {
  const conns = videoConns(d);
  const connId = value ? value.conn : "";
  const conn = conns.find((c) => c.id === connId);
  const prov = conn ? providerOf(d, conn.provider) : null;
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [paste, setPaste] = useState(false);
  const load = async () => {
    if (!conn || !prov || !prov.source) return;
    setList(null); setErr("");
    try { setList((await api("/api/admin?sources=" + encodeURIComponent(conn.id))).sources); } catch (e) { setErr(e.message); setList([]); }
  };
  useEffect(() => { load(); }, [connId]);
  const ref = (value && value.ref) || "";
  const usedBy = (rid) => projects.filter((p) => p.id !== selfId && p.source && p.source.conn === connId && p.source.ref === rid).map((p) => p.title);
  const known = list && list.some((s) => s.id === ref);
  const nameOf = (c) => { const pv = providerOf(d, c.provider) || {}; return `${pv.name}${c.name !== pv.name ? " · " + c.name : ""}${c.status !== "ok" ? " (not working)" : ""}`; };
  return html`<div class="stack" style=${{ gap: "12px" }}>
    <${Field} label="Videos come from" hint=${!conns.length ? "Connect Vimeo, Frame.io, YouTube, or Wistia in Studio → Connections, or paste video links." : ""}>
      <select class="select" disabled=${disabled} value=${connId || ""} onChange=${(e) => onChange(e.target.value ? { conn: e.target.value, ref: "" } : null)}>
        <option value="">Nowhere yet</option>
        ${conns.map((c) => html`<option key=${c.id} value=${c.id}>${nameOf(c)}</option>`)}
        <option value="links">Video links (paste a link for each video)</option>
      </select>
    <//>
    ${prov && prov.source ? html`
      ${list && list.length ? html`<${Field} label=${prov.source.label}>
        <select class="select" disabled=${disabled} value=${known || !ref ? ref : "__typed"} onChange=${(e) => e.target.value !== "__typed" && onChange({ conn: connId, ref: e.target.value })}>
          <option value="">Choose…</option>
          ${list.map((s) => { const u = usedBy(s.id); return html`<option key=${s.id} value=${s.id}>${s.name}${s.count != null ? " · " + plural(s.count, "video") : ""}${u.length ? " · also used by " + u.join(", ") : ""}</option>`; })}
          ${ref && !known ? html`<option value="__typed">${prov.source.label} ${ref}</option>` : null}
        </select>
      <//>` : null}
      ${!list || !list.length || paste || (ref && !known) ? html`<${Field} label=${list && list.length ? `Or paste the ${prov.source.label.toLowerCase()} ID` : `${prov.source.label} ID`} hint=${prov.source.help}>
        <input class="input mono" disabled=${disabled} value=${ref} placeholder=${prov.source.placeholder} onInput=${(e) => onChange({ conn: connId, ref: e.target.value.trim() })} />
      <//>` : null}
      ${err ? html`<span class="small muted">${err}</span>` : null}
      ${list ? html`<div class="row small" style=${{ gap: "16px" }}>
        <button type="button" class="link small" onClick=${load}>Refresh the ${prov.source.label.toLowerCase()} list</button>
        ${list.length && !paste && !(ref && !known) ? html`<button type="button" class="link small" onClick=${() => setPaste(true)}>Paste an ID instead</button>` : null}
      </div>` : html`<span class="faint small">Loading from ${prov.name}…</span>`}` : null}
    ${connId === "links" ? html`<span class="muted small" style=${{ lineHeight: 1.6 }}>After saving, add each video under Videos by pasting its link: YouTube, Vimeo, Google Drive, Loom, Wistia, Dropbox, or a video file.</span>` : null}
    ${connId ? html`<span class="muted small" style=${{ lineHeight: 1.6 }}>${(prov && prov.features && prov.features.versions) || "Name versions “Title V2”, “Title V3”."} Versions go to Review, where the client sees only the newest; everything else is a finished film.</span>` : null}
  </div>`;
}

// ---------- projects ----------
const capCount = (caps) => Object.values(caps).filter(Boolean).length;

function sourceLabel(d, p) {
  if (!p.source) return null;
  if (p.source.conn === "links") return "Video links";
  const prov = providerOf(d, p.source.provider);
  return `${prov ? prov.name : p.source.connName}${p.source.ref ? " · " + p.source.ref : ""}`;
}

function Projects({ admin }) {
  const { d } = admin;
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState("");
  const find = q.trim().toLowerCase();
  const list = d.projects.filter((p) => (showArchived || !p.archived) && (!find || (p.title + " " + p.clientName + " " + p.type).toLowerCase().includes(find)));
  return html`
    <${Head} eyebrow="Studio" title="Projects" actions=${html`<div class="row">
      ${admin.can("data.export") && d.projects.length && !d.demo ? html`<a class="btn ghost" href="/api/admin?export=projects" download>Export to a spreadsheet</a>` : null}
      ${admin.can("projects.create") ? html`<button class="btn primary" onClick=${() => setCreating(true)}>New project</button>` : null}</div>`}>
      Each project belongs to a client, plays from one video source, and has its own switches for what the client can do.
    <//>
    ${!d.projects.length ? html`<${Empty} icon="camera" title="No projects yet." action=${admin.can("projects.create") ? html`<button class="btn primary" onClick=${() => setCreating(true)}>Create the first project</button>` : null}>
      Create one, choose where its videos come from, and add the client’s people. They see it the moment they log in.<//>`
    : html`
    ${d.projects.length > 6 ? html`<div class="row" style=${{ marginBottom: "14px" }}><input class="input" style=${{ maxWidth: "340px" }} type="search" placeholder="Find a project or client" aria-label="Find a project or client" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>` : null}
    <table class="table">
      <thead><tr><th>Project</th><th>Stage</th><th>Videos from</th><th>Review by</th><th>Client can</th><th></th></tr></thead>
      <tbody>${list.map((p) => html`<tr key=${p.id}>
        <td><${Link} to=${"/studio/projects/" + p.id} cls="name" label=${"Edit " + p.title}><b>${p.title}</b><//><div class="muted small">${p.clientName}${p.type ? " · " + p.type : ""}${p.notion ? " · in Notion" : ""}</div></td>
        <td data-label="Stage">${d.stages[p.stage]}${p.archived ? html` <span class="pill">Archived</span>` : null}</td>
        <td class="small" data-label="Videos from">${p.source ? sourceLabel(d, p) : html`<span class="pill amber">Not set</span>`}</td>
        <td class="small" data-label="Review by">${p.reviewDue ? fmtDay(p.reviewDue) : html`<span class="faint">—</span>`}</td>
        <td class="small muted" data-label="Client can">${capCount(p.caps)} of ${d.capabilities.length}</td>
        <td style=${{ textAlign: "right" }}><${Link} to=${"/studio/projects/" + p.id} cls="btn ghost sm">Open<//></td>
      </tr>`)}</tbody>
    </table>
    ${!list.length ? html`<p class="muted">Nothing matches “${q}”.</p>` : null}
    ${d.projects.some((p) => p.archived) ? html`<p><button class="link small" onClick=${() => setShowArchived(!showArchived)}>${showArchived ? "Hide archived projects" : `Show ${plural(d.projects.filter((p) => p.archived).length, "archived project")}`}</button></p>` : null}`}
    ${creating ? html`<${NewProject} admin=${admin} onClose=${() => setCreating(false)} />` : null}
  `;
}

function NewProject({ admin, onClose }) {
  const { go, toast, reload } = useApp();
  const { d } = admin;
  const [f, setF] = useState({ clientId: "", clientName: "", title: "", type: "", source: null, stage: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const body = { action: "projectCreate", title: f.title, type: f.type, stage: f.stage, source: f.source, ...(f.clientId === "__new" ? { clientName: f.clientName } : { clientId: f.clientId }) };
      const r = await api("/api/admin", { method: "POST", body });
      await admin.load(); reload();
      toast(`${f.title} created. Check what the client can do, then add their people.`);
      onClose();
      go("/studio/projects/" + r.id);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return html`<${Modal} title="New project" onClose=${onClose} wide>
    <form class="stack" style=${{ gap: "18px" }} onSubmit=${submit}>
      <${ClientPicker} clients=${d.clients} value=${f} onChange=${(v) => setF({ ...f, ...v })} />
      <div class="formgrid">
        <${Field} label="Project name"><input class="input" required value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} placeholder="For example: Launch Film" /><//>
        <${Field} label="Kind of project (optional)"><input class="input" value=${f.type} onInput=${(e) => setF({ ...f, type: e.target.value })} placeholder="Brand film · Commercial" /><//>
      </div>
      <${SourcePicker} d=${d} value=${f.source} onChange=${(v) => setF({ ...f, source: v })} projects=${d.projects} />
      <${Field} label="Stage"><select class="select" value=${f.stage} onChange=${(e) => setF({ ...f, stage: Number(e.target.value) })}>${d.stages.map((s, i) => html`<option key=${s} value=${i}>${i + 1}. ${s}</option>`)}</select><//>
      <span class="faint small">What the client can do starts from Studio → Settings → New projects. You can change it on the next screen.</span>
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <div class="row"><button class="btn primary" disabled=${busy || !f.title.trim() || !(f.clientId && (f.clientId !== "__new" || f.clientName.trim()))}>${busy ? "Creating…" : "Create project"}</button><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button></div>
    </form>
  <//>`;
}

// A project's page in Studio, in parts so it never becomes one long form; one Save covers them all (payments
// save as you go: each request is its own action).
const PARTS = [["details", "Details"], ["progress", "Progress"], ["videos", "Videos"], ["payments", "Payments"], ["access", "What they can do"]];
const firstSentence = (t) => (String(t || "").match(/^.*?[.!?](?=\s|$)/) || [t])[0];

function ProjectEdit({ id, admin }) {
  const { go, toast, reload } = useApp();
  const { d } = admin;
  const src = d.projects.find((p) => p.id === id);
  const formOf = (s) => s && ({ title: s.title, type: s.type, summary: s.summary, clientId: s.clientId, clientName: "", stage: s.stage, pct: s.pct || 0,
    next: { label: s.next.label, date: s.next.date, what: s.next.what, confirm: s.next.confirm }, reviewDue: s.reviewDue || "",
    source: s.source ? { conn: s.source.conn, ref: s.source.ref || "" } : null, imageUrl: s.imageUrl || "", caps: { ...s.caps } });
  const init = () => formOf(src);
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [del, setDel] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [part, setPart] = useState("details");
  if (!src) return html`<${Empty} title="That project isn’t here." action=${html`<${Link} to="/studio/projects" cls="btn primary">All projects<//>`}>It may have been deleted.<//>`;
  const base = init();
  const changed = Object.keys(f).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(base[k]));
  const dirty = changed.length > 0;
  const mayEdit = admin.can("projects.edit"), mayProgress = admin.can("projects.progress");
  const setCap = (k, v) => setF({ ...f, caps: { ...f.caps, [k]: v } });
  const sourceChanged = changed.includes("source");

  const save = async (extra = {}) => {
    setBusy(true); setErr("");
    try {
      // Only what changed, so someone who may update progress but not edit details can still save.
      const body = { action: "projectUpdate", id, ...extra };
      for (const k of changed) if (k !== "clientName") body[k] = f[k];
      if (f.clientId === "__new") { delete body.clientId; body.clientName = f.clientName; }
      await api("/api/admin", { method: "POST", body });
      // Start again from what the server saved: it also switches off anything that depends on a switch you turned off.
      const fresh = await admin.load(); reload();
      const saved = fresh && fresh.projects.find((p) => p.id === id);
      if (saved) setF(formOf(saved));
      toast(extra.archived === true ? `${f.title} archived. ${src.clientName} no longer sees it.` : extra.archived === false ? `${f.title} is back for ${src.clientName}.` : "Saved. The client sees the change straight away.");
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api("/api/admin", { method: "POST", body: { action: "projectDelete", id, confirm: confirmText } });
      await admin.load(); reload();
      toast(`${src.title} deleted.`);
      go("/studio/projects");
    } catch (x) { toast(x.message, { err: true }); setBusy(false); }
  };

  return html`
    <p style=${{ margin: "0 0 14px" }}><${Link} to="/studio/projects" cls="link">← All projects<//></p>
    <${Head} eyebrow=${src.clientName} title=${src.title} actions=${html`<${Link} to=${"/projects/" + id} cls="btn ghost sm">See it as the client does<//>`}>
      ${src.archived ? "Archived: the client can’t see this project." : "Changes reach the client as soon as you save."}${src.notion ? " Kept up to date in Notion." : ""}
    <//>

    <div class="tabs parts" role="group" aria-label="Parts of the project" style=${{ marginBottom: "18px" }}>${PARTS.map(([k, l]) => html`<button type="button" key=${k} class="tab-btn" aria-pressed=${part === k} onClick=${() => setPart(k)}>${l}</button>`)}</div>

    ${part === "details" ? html`<section class="card pad stack" style=${{ gap: "18px" }}>
      <div class="formgrid">
        <${Field} label="Project name"><input class="input" disabled=${!mayEdit} value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} /><//>
        <${Field} label="Kind of project"><input class="input" disabled=${!mayEdit} value=${f.type} onInput=${(e) => setF({ ...f, type: e.target.value })} placeholder="Brand film · Commercial" /><//>
      </div>
      <${Field} label="Summary (shown on the project page)"><textarea class="textarea" rows="3" disabled=${!mayEdit} value=${f.summary} onInput=${(e) => setF({ ...f, summary: e.target.value })} placeholder="One or two sentences about what you’re making."></textarea><//>
      <${ClientPicker} clients=${d.clients} value=${f} disabled=${!mayEdit} onChange=${(v) => setF({ ...f, ...v })} />
      <${Field} label="Cover image link (optional)" hint="Empty uses the newest film’s thumbnail."><input class="input" disabled=${!mayEdit} value=${f.imageUrl} onInput=${(e) => setF({ ...f, imageUrl: e.target.value })} placeholder="https://…" /><//>
    </section>
    ${admin.can("projects.delete") ? html`<section class="stack" style=${{ gap: "10px", marginTop: "24px" }}>
      <div class="row">
        <button class="btn ghost sm" disabled=${busy || dirty} onClick=${() => save({ archived: !src.archived })}>${src.archived ? "Bring it back for the client" : "Archive (hide from the client)"}</button>
        <button class="btn danger sm" onClick=${() => setDel(true)}>Delete project…</button>
      </div>
      <span class="faint small">Archiving can be undone. Deleting removes its notes, decisions, messages, share links, and files for good.</span>
    </section>` : null}` : null}

    ${part === "progress" ? html`<${Progress} f=${f} setF=${setF} src=${src} d=${d} may=${mayProgress} admin=${admin} />` : null}

    ${part === "videos" ? html`<section class="card pad stack" style=${{ gap: "16px" }}>
      <div class="h3">Video source</div>
      <${SourcePicker} d=${d} value=${f.source} disabled=${!mayEdit} onChange=${(v) => setF({ ...f, source: v })} projects=${d.projects} selfId=${id} />
    </section>
    ${src.source && !sourceChanged ? html`<${Videos} p=${src} admin=${admin} />` : null}` : null}

    ${part === "payments" ? html`<${PaymentsPart} p=${src} admin=${admin} />` : null}

    ${part === "access" ? html`<section class="card pad stack" style=${{ gap: "16px" }}>
      <div class="stack" style=${{ gap: "4px" }}><div class="h3">What ${src.clientName} can do</div>
        <span class="muted small">Off means hidden from the client. Roles narrow it further (People → Roles).</span></div>
      <div class="setrows">${d.capabilities.map((c) => {
        const blocked = c.needs && !f.caps[c.needs];
        return html`<div class="setopt" key=${c.key}>
          <div><b>${c.label}</b><span>${firstSentence(c.detail)}</span></div>
          <${Toggle} checked=${!!f.caps[c.key] && !blocked} disabled=${blocked || !mayEdit} onChange=${(v) => setCap(c.key, v)} label=${c.label} />
        </div>`;
      })}</div>
    </section>` : null}

    ${err ? html`<div class="alert" role="alert" style=${{ marginTop: "16px" }}>${err}</div>` : null}
    <div class=${"savebar" + (dirty ? " dirty" : "")}>
      <span class="muted small grow" style=${{ alignSelf: "center", paddingLeft: "10px" }}>${dirty ? "You have unsaved changes." : "Everything is saved."}</span>
      <button class="btn ghost" disabled=${!dirty || busy} onClick=${() => setF(init())}>Discard</button>
      <button class="btn primary" disabled=${!dirty || busy || !f.title.trim()} onClick=${() => save()}>${busy ? "Saving…" : "Save changes"}</button>
    </div>
    ${del ? html`<${Modal} title=${`Delete ${src.title}?`} onClose=${() => setDel(false)}>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>This permanently removes the project’s notes, decisions, messages, share links, and files. Its videos stay at the source. This can’t be undone.</p>
      <${Field} label=${`Type “${src.title}” to confirm`}><input class="input" value=${confirmText} onInput=${(e) => setConfirmText(e.target.value)} /><//>
      <div class="row"><button class="btn solid-red" disabled=${busy || confirmText.trim() !== src.title} onClick=${remove}>Delete for good</button><button class="btn ghost" onClick=${() => setDel(false)}>Keep it</button></div>
    <//>` : null}
  `;
}

function Progress({ f, setF, src, d, may, admin }) {
  const { run, busy } = useRun(admin);
  const n = f.next;
  const setN = (k, v) => setF({ ...f, next: { ...n, [k]: v } });
  return html`<section class="card pad stack section" style=${{ gap: "18px", marginTop: 0 }}>
    <div class="h3">Progress</div>
    <div class="seg" role="group" aria-label="Stage">${d.stages.map((s, i) => html`<button type="button" key=${s} disabled=${!may} aria-pressed=${f.stage === i} onClick=${() => setF({ ...f, stage: i })}>${i + 1}. ${s}</button>`)}</div>
    <div class="formgrid">
      <${Field} label="Next milestone: label" hint="For example “Next filming day” or “Next”."><input class="input" disabled=${!may} value=${n.label} onInput=${(e) => setN("label", e.target.value)} /><//>
      <${Field} label="When" hint="Plain words are fine: “October 9”, “early next week”."><input class="input" disabled=${!may} value=${n.date} onInput=${(e) => setN("date", e.target.value)} /><//>
      <${Field} label="What happens"><input class="input" disabled=${!may} value=${n.what} onInput=${(e) => setN("what", e.target.value)} placeholder="Version 2 ready to watch" /><//>
      <${Field} label="Progress shown (%)" hint="Leave it empty to follow the stage."><input class="input" type="number" min="0" max="100" placeholder="From the stage" disabled=${!may} value=${f.pct || ""} onInput=${(e) => setF({ ...f, pct: Number(e.target.value) || 0 })} /><//>
    </div>
    <div class="cap" style=${{ maxWidth: "720px" }}>
      <${Toggle} checked=${!!n.confirm} disabled=${!may} onChange=${(v) => setN("confirm", v)} label="Ask the client to confirm" />
      <div><b>Ask the client to confirm the milestone</b><span>${src.next.confirmedAt ? `${src.next.confirmedBy || "The client"} confirmed it ${fmtAgo(src.next.confirmedAt)}. Changing the milestone asks again.` : "Shows a “Confirm” button on their home page, for filming days and deliveries. You’re told when they press it."}</span></div>
    </div>
    <div class="formgrid">
      <${Field} label="Review by (optional)" hint="Shown to the client on the version waiting for them. Their decision makers get a reminder before it (Settings → Reminders).">
        <input class="input" type="date" disabled=${!may} value=${f.reviewDue} onInput=${(e) => setF({ ...f, reviewDue: e.target.value })} />
      <//>
      <div class="stack" style=${{ gap: "8px", justifyContent: "flex-end" }}>
        ${may && d.email ? html`<button type="button" class="btn ghost" disabled=${busy} onClick=${() => run({ action: "projectRemind", id: src.id }, (r) => `Reminder sent to ${plural(r.sent, "person", "people")}.`)}>Email a review reminder now</button>` : null}
        <span class="faint small">${src.remindedAt ? "Last reminder " + fmtAgo(src.remindedAt) + "." : d.email ? "No reminder sent yet." : "Reminders need email (Studio → Connections)."}</span>
      </div>
    </div>
  </section>`;
}

/** A project's payments: ask the client to pay, cancel a request, or mark one paid another way. */
function PaymentsPart({ p, admin }) {
  const { d } = admin;
  const { run, busy } = useRun(admin);
  const [asking, setAsking] = useState(false);
  const [f, setF] = useState({ title: "", amount: "", due: "", note: "", tell: true });
  const [act, setAct] = useState(null); // { kind: "cancel" | "paid", x, how }
  const may = admin.can("payments.manage");
  const pays = p.payments || [];
  const open = openOf(p);
  const STAT = { open: ["Due", "amber"], processing: ["Bank payment on its way", "amber"], paid: ["Paid", "green"], refunded: ["Refunded", ""] };
  if (!d.payments.ready) {
    return html`<section class="card pad stack" style=${{ gap: "12px" }}>
      <div class="h3">Payments</div>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>Connect Stripe to ask ${p.clientName} for deposits and balances here. They pay by card or bank on Stripe’s checkout, and each payment marks itself paid.</p>
      ${admin.can("connections.manage") ? html`<div><${Link} to="/studio/connections" cls="btn primary sm">Connect Stripe<//></div>` : html`<span class="faint small">An owner connects it in Studio → Connections.</span>`}
    </section>`;
  }
  const ask = async () => {
    const r = await run({ action: "paymentCreate", projectId: p.id, ...f }, (x) => `Asked ${p.clientName} for ${x.label}.${f.tell && d.email ? " They’ve been emailed." : ""}`);
    if (r) { setAsking(false); setF({ title: "", amount: "", due: "", note: "", tell: true }); }
  };
  return html`<section class="card pad stack" style=${{ gap: "14px" }}>
    <div class="row" style=${{ justifyContent: "space-between" }}>
      <div class="stack" style=${{ gap: "4px" }}><div class="h3">Payments</div>
        <span class="muted small">${open.length ? `${money(open.reduce((n, x) => n + x.amount, 0), open[0].currency)} due` : pays.length ? "Everything is paid" : "Nothing asked for yet"} · Stripe ${d.payments.live ? "live" : "test mode"} · ${p.caps.payfirst ? "downloads wait for payment" : "downloads don’t wait for payment"}</span></div>
      ${may ? html`<button class="btn primary sm" onClick=${() => setAsking(true)}>Ask for a payment</button>` : null}
    </div>
    ${!p.caps.payments ? html`<div class="alert info small">Payments is off for ${p.clientName} on this project, so they can’t see or pay these. Turn it on under What they can do.</div>` : null}
    ${pays.length ? html`<div class="list">${pays.map((x) => html`<div class="li payrow" key=${x.id}>
      <div class="grow"><div class="name">${x.title}</div>
        <div class="meta">${x.status === "paid" ? `Paid ${fmtDate(x.paidAt)}${x.paidBy ? " · " + x.paidBy : ""}` : x.due ? `Due ${fmtDay(x.due)}` : `Asked ${fmtDate(x.created)}`}${x.createdBy ? " · asked by " + x.createdBy : ""}</div></div>
      <b class="amt">${x.label}</b>
      <span class=${"pill " + (STAT[x.status] || ["", ""])[1]}>${(STAT[x.status] || [x.status])[0]}</span>
      ${may && x.status === "open" ? html`<div class="row" style=${{ gap: "6px" }}>
        <button class="btn ghost sm" onClick=${() => setAct({ kind: "paid", x, how: "Check" })}>Mark paid…</button>
        <button class="btn ghost sm" onClick=${() => setAct({ kind: "cancel", x })}>Cancel</button></div>` : null}
    </div>`)}</div>` : null}
    ${asking ? html`<${Modal} title=${`Ask ${p.clientName} to pay`} onClose=${() => setAsking(false)}>
      <${Field} label="What it’s for"><input class="input" value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} placeholder="Deposit (50%)" /><//>
      <div class="formgrid">
        <${Field} label=${`Amount (${d.payments.currency.toUpperCase()})`}><input class="input" inputMode="decimal" value=${f.amount} onInput=${(e) => setF({ ...f, amount: e.target.value })} placeholder="4,500" /><//>
        <${Field} label="Due (optional)"><input class="input" type="date" value=${f.due} onInput=${(e) => setF({ ...f, due: e.target.value })} /><//>
      </div>
      <${Field} label="Note for the client (optional)"><input class="input" value=${f.note} onInput=${(e) => setF({ ...f, note: e.target.value })} placeholder="Balance on delivery of the final cut." /><//>
      ${d.email ? html`<div class="setopt"><div><b>Email ${p.clientName}</b><span>Their decision makers get a link to pay.</span></div><${Toggle} checked=${f.tell} onChange=${(v) => setF({ ...f, tell: v })} label="Email the client" /></div>` : null}
      <div class="row"><button class="btn primary" disabled=${busy || !f.title.trim() || !f.amount.trim()} onClick=${ask}>${busy ? "Asking…" : "Ask for it"}</button><button class="btn ghost" onClick=${() => setAsking(false)}>Not now</button></div>
    <//>` : null}
    ${act && act.kind === "cancel" ? html`<${Confirm} title=${`Cancel “${act.x.title}”?`} yes="Cancel the request" danger busy=${busy}
      onYes=${async () => { if (await run({ action: "paymentCancel", id: act.x.id }, "Canceled. It can’t be paid any more.")) setAct(null); }} onNo=${() => setAct(null)}>
      ${p.clientName} won’t see it any more, and its checkout stops working.
    <//>` : null}
    ${act && act.kind === "paid" ? html`<${Modal} title=${`Mark ${act.x.label} paid`} onClose=${() => setAct(null)}>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>For a payment that came another way. ${p.clientName} sees it as paid, and anything waiting for it opens.</p>
      <${Field} label="How it was paid"><input class="input" value=${act.how} onInput=${(e) => setAct({ ...act, how: e.target.value })} placeholder="Check, bank transfer" /><//>
      <div class="row"><button class="btn primary" disabled=${busy} onClick=${async () => { if (await run({ action: "paymentMarkPaid", id: act.x.id, how: act.how }, "Marked paid.")) setAct(null); }}>Mark it paid</button><button class="btn ghost" onClick=${() => setAct(null)}>Not now</button></div>
    <//>` : null}
  </section>`;
}

/** Groups a source's videos so each film's versions sit together, newest first. */
function groupVersions(vs) {
  const out = [], by = new Map();
  for (const v of vs) {
    if (v.kind !== "version") { out.push({ one: v }); continue; }
    const k = String(v.baseTitle || v.title).toLowerCase();
    if (!by.has(k)) { const g = { key: k, vs: [] }; by.set(k, g); out.push(g); }
    by.get(k).vs.push(v);
  }
  for (const g of by.values()) g.vs.sort((a, b) => (b.version || 0) - (a.version || 0));
  return out;
}

/** Every video at the project's source, with what the client sees: hide, rename, or mark as a finished film. */
function Videos({ p, admin }) {
  const { run, busy } = useRun(admin);
  const [vs, setVs] = useState(null);
  const [err, setErr] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState({ url: "", title: "", description: "" });
  const [removing, setRemoving] = useState(null);
  const [shown, setShown] = useState({});
  const may = admin.can("projects.videos");
  const load = async (fresh) => {
    setErr("");
    try { setVs((await api(`/api/admin?videos=${p.id}${fresh ? "&fresh=1" : ""}`)).videos); } catch (e) { setErr(e.message); setVs([]); }
  };
  useEffect(() => { load(); }, [p.id]);
  const set = async (v, patch, msg) => { if (await run({ action: "videoSet", projectId: p.id, videoId: v.id, ...patch }, msg, { refresh: false })) load(); };
  const links = p.source && p.source.conn === "links";
  const kindPill = (v) => v.kind === "client" ? html`<span class="pill">From the client</span>`
    : v.kind === "version" ? html`<span class="pill amber">Version ${v.version}</span>` : html`<span class="pill green">Finished film</span>`;
  // One row per video; versions of the same film sit together, newest first, with earlier ones folded away.
  const row = (v, { newest, earlier } = {}) => html`<div class=${"li vrow" + (earlier ? " earlier" : "")} key=${v.id} style=${{ opacity: v.hidden ? 0.6 : 1 }}>
          <div class="vthumb" style=${{ backgroundImage: v.thumbnail ? `url('${v.thumbnail}')` : "none" }}></div>
          <div class="grow" style=${{ minWidth: "200px" }}>
            <div class="name">${v.title}</div>
            <div class="meta row" style=${{ gap: "6px" }}>${kindPill(v)}${newest ? html`<span class="faint">newest</span>` : null}${v.hidden ? html`<span class="warn-text">hidden from the client</span>` : null}${v.forcedFilm ? html`<span class="faint">marked as a film</span>` : null}
              <span>${[v.durationLabel, v.created ? fmtDate(v.created) : "", v.ready === false ? "still processing" : ""].filter(Boolean).join(" · ")}</span></div>
          </div>
          ${may ? html`<${More} items=${[
            [v.hidden ? "Show to the client" : "Hide from the client", () => set(v, { hidden: !v.hidden }, v.hidden ? "The client can see it again." : "Hidden from the client.")],
            ["Rename for the client", () => setRenaming({ v, title: v.title })],
            (v.kind === "version" || v.forcedFilm) && [v.forcedFilm ? "Go by its name" : "Make it a finished film", () => set(v, { kind: v.forcedFilm ? "auto" : "film" }, v.forcedFilm ? "Its name decides again." : "It’s now a finished film.")],
            v.manage && ["Open at the source ↗", () => window.open(v.manage, "_blank", "noopener")],
            v.linkId && ["Remove", () => setRemoving(v)],
          ].filter(Boolean)} />` : null}
        </div>`;
  return html`<section class="card pad stack section" style=${{ gap: "14px", marginTop: "16px" }}>
    <div class="row" style=${{ justifyContent: "space-between" }}>
      <div class="h3">Videos</div>
      <div class="row">
        ${links && may ? html`<button class="btn primary sm" onClick=${() => setAdding(true)}>Add a video by link</button>` : null}
        ${!links ? html`<button class="btn ghost sm" onClick=${() => { setVs(null); load(true); }}>Refresh from the source</button>` : null}
      </div>
    </div>
    ${err ? html`<div class="alert">${err}</div>` : null}
    ${vs == null ? html`<span class="muted small">Loading videos…</span>`
      : !vs.length ? html`<p class="muted" style=${{ margin: 0 }}>${links ? "No videos yet. Add one by pasting its link." : "No videos at the source yet. New uploads appear within a couple of minutes, or press Refresh."}</p>`
      : html`<div class="list">${groupVersions(vs).map((g) => !g.vs ? row(g.one)
        : html`<${R.Fragment} key=${g.key}>
          ${row(g.vs[0], { newest: g.vs.length > 1 })}
          ${g.vs.length > 1 ? html`<button type="button" class="li vmore" aria-expanded=${!!shown[g.key]} onClick=${() => setShown({ ...shown, [g.key]: !shown[g.key] })}>
            <span class="muted small">${shown[g.key] ? "Hide earlier versions" : `${plural(g.vs.length - 1, "earlier version")} of ${g.vs[0].baseTitle || g.vs[0].title}`}</span><span aria-hidden="true">${shown[g.key] ? "▴" : "▾"}</span>
          </button>` : null}
          ${shown[g.key] ? g.vs.slice(1).map((v) => row(v, { earlier: true })) : null}
        <//>`)}</div>`}
    ${renaming ? html`<${Modal} title="Rename for the client" onClose=${() => setRenaming(null)}>
      <${Field} label="Name the client sees" hint="Keep “V2”, “V3” at the end for versions. Empty = the name at the source. Nothing changes at the source.">
        <input class="input" value=${renaming.title} onInput=${(e) => setRenaming({ ...renaming, title: e.target.value })} />
      <//>
      <div class="row"><button class="btn primary" disabled=${busy} onClick=${async () => { await set(renaming.v, { title: renaming.title }, "Renamed."); setRenaming(null); }}>Save</button><button class="btn ghost" onClick=${() => setRenaming(null)}>Cancel</button></div>
    <//>` : null}
    ${adding ? html`<${Modal} title="Add a video by link" onClose=${() => setAdding(false)}>
      <${Field} label="Link" hint="YouTube, Vimeo, Google Drive (shared with anyone with the link), Loom, Wistia, Dropbox, or a direct .mp4 link.">
        <input class="input" type="url" value=${link.url} onInput=${(e) => setLink({ ...link, url: e.target.value })} placeholder="https://…" />
      <//>
      <${Field} label="Title (optional)" hint="Empty = the title the link’s site gives. Add “V2” for a second version: the client then sees only the newest."><input class="input" value=${link.title} onInput=${(e) => setLink({ ...link, title: e.target.value })} /><//>
      <${Field} label="Description (optional)"><textarea class="textarea" rows="2" value=${link.description} onInput=${(e) => setLink({ ...link, description: e.target.value })}></textarea><//>
      <div class="row"><button class="btn primary" disabled=${busy || !link.url.trim()} onClick=${async () => {
        const r = await run({ action: "linkAdd", projectId: p.id, ...link }, (x) => `Added from ${x.host}. The client is told.`);
        if (r) { setAdding(false); setLink({ url: "", title: "", description: "" }); load(); }
      }}>${busy ? "Checking the link…" : "Add the video"}</button><button class="btn ghost" onClick=${() => setAdding(false)}>Cancel</button></div>
    <//>` : null}
    ${removing ? html`<${Modal} title=${`Remove ${removing.title}?`} onClose=${() => setRemoving(null)}>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>It disappears from the portal. The video itself stays where the link points.</p>
      <div class="row"><button class="btn solid-red" disabled=${busy} onClick=${async () => { if (await run({ action: "linkRemove", id: removing.linkId }, "Removed.", { refresh: false })) { setRemoving(null); load(); } }}>Remove it</button><button class="btn ghost" onClick=${() => setRemoving(null)}>Keep it</button></div>
    <//>` : null}
  </section>`;
}
