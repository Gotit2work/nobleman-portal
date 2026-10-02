// Studio (staff only): projects and what each client can do on them, clients, people, and the Vimeo connection.
import { html, useApp, useState, useEffect, useMemo, api, Head, Empty, Link, Field, Toggle, Modal, Confirm, Icon, copy, fmtDate, fmtAgo, fmtBytes, plural } from "./ui.js";

const TABS = [
  { key: "projects", label: "Projects", icon: "camera" },
  { key: "clients", label: "Clients", icon: "anchor" },
  { key: "people", label: "People", icon: "crew" },
  { key: "vimeo", label: "Vimeo & connections", icon: "play" },
];
const PORTAL = "https://portal.noblemanproductions.gotit2work.com";

function useAdmin() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const load = async () => { try { const x = await api("/api/admin"); setD(x); setErr(""); return x; } catch (e) { setErr(e.message); return null; } };
  useEffect(() => { load(); }, []);
  return { d, err, load };
}

function useFolders(enabled) {
  const [folders, setFolders] = useState(null);
  const [err, setErr] = useState("");
  const load = async () => { try { setFolders((await api("/api/admin?folders=1")).folders); setErr(""); } catch (e) { setErr(e.message); setFolders([]); } };
  useEffect(() => { if (enabled) load(); }, [enabled]);
  return { folders, err, load };
}

export function Studio({ tab = "projects", id }) {
  const admin = useAdmin();
  const { d, err } = admin;
  const t = TABS.some((x) => x.key === tab) ? tab : "projects";
  return html`<div class="page wide">
    <nav class="studio-tabs" aria-label="Studio sections">${TABS.map((x) => html`<${Link} key=${x.key} to=${"/studio/" + x.key} cls="tab-btn" current=${x.key === t}><${Icon} name=${x.icon} size=${18} />${x.label}<//>`)}</nav>
    ${err ? html`<div class="alert">${err}</div>` : !d ? html`<p class="muted">Loading Studio…</p>`
      : t === "projects" ? (id ? html`<${ProjectEdit} id=${id} admin=${admin} key=${id} />` : html`<${Projects} admin=${admin} />`)
      : t === "clients" ? html`<${Clients} admin=${admin} />`
      : t === "people" ? html`<${People} admin=${admin} />`
      : html`<${Connections} admin=${admin} />`}
  </div>`;
}

// ---------- projects ----------
function capCount(caps) { return Object.values(caps).filter(Boolean).length; }

function Projects({ admin }) {
  const { d } = admin;
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const list = d.projects.filter((p) => showArchived || !p.archived);
  return html`
    <${Head} eyebrow="Studio" title="Projects" actions=${html`<button class="btn primary" onClick=${() => setCreating(true)}>New project</button>`}>
      Each project belongs to a client, plays from one Vimeo folder, and has its own switches for what the client can do.
    <//>
    ${!d.projects.length ? html`<${Empty} icon="camera" title="No projects yet." action=${html`<button class="btn primary" onClick=${() => setCreating(true)}>Create the first project</button>`}>
      Create one, link it to its Vimeo folder, and add the client’s people. They see it the moment they sign in.<//>`
    : html`<table class="table">
      <thead><tr><th>Project</th><th>Stage</th><th>Vimeo folder</th><th>Client can</th><th></th></tr></thead>
      <tbody>${list.map((p) => html`<tr key=${p.id}>
        <td><${Link} to=${"/studio/projects/" + p.id} cls="name" label=${"Edit " + p.title}><b>${p.title}</b><//><div class="muted small">${p.clientName}${p.type ? " · " + p.type : ""}</div></td>
        <td>${d.stages[p.stage]}${p.archived ? html` <span class="pill">Archived</span>` : null}</td>
        <td>${p.folder ? html`<span class="mono small">#${p.folder}</span>` : html`<span class="pill amber">Not linked</span>`}</td>
        <td class="small muted">${capCount(p.caps)} of ${d.capabilities.length} switched on</td>
        <td style=${{ textAlign: "right" }}><${Link} to=${"/studio/projects/" + p.id} cls="btn ghost sm">Edit<//></td>
      </tr>`)}</tbody>
    </table>
    ${d.projects.some((p) => p.archived) ? html`<p><button class="link small" onClick=${() => setShowArchived(!showArchived)}>${showArchived ? "Hide archived projects" : `Show ${plural(d.projects.filter((p) => p.archived).length, "archived project")}`}</button></p>` : null}`}
    ${creating ? html`<${NewProject} admin=${admin} onClose=${() => setCreating(false)} />` : null}
  `;
}

function ClientPicker({ clients, value, onChange }) {
  const isNew = value.clientId === "__new";
  return html`<div class="stack" style=${{ gap: "10px" }}>
    <${Field} label="Client">
      <select class="select" value=${value.clientId} onChange=${(e) => onChange({ clientId: e.target.value, clientName: "" })}>
        <option value="">Choose a client…</option>
        ${clients.map((c) => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}
        <option value="__new">+ A new client</option>
      </select>
    <//>
    ${isNew ? html`<${Field} label="New client’s name"><input class="input" value=${value.clientName} onInput=${(e) => onChange({ clientId: "__new", clientName: e.target.value })} placeholder="For example: Meridian" /><//>` : null}
  </div>`;
}

function FolderPicker({ value, onChange, folders, projects, selfId }) {
  const { folders: list, err, load } = folders;
  const linked = (fid) => projects.filter((p) => p.folder === fid && p.id !== selfId).map((p) => p.title);
  const known = list && list.some((f) => f.id === value);
  return html`<div class="stack" style=${{ gap: "10px" }}>
    ${list && list.length ? html`<${Field} label="Vimeo folder" hint="The folder in Jean’s Vimeo account that holds this project’s videos.">
      <select class="select" value=${known || !value ? value : "__manual"} onChange=${(e) => onChange(e.target.value === "__manual" ? value : e.target.value)}>
        <option value="">No folder yet</option>
        ${list.map((f) => { const l = linked(f.id); return html`<option key=${f.id} value=${f.id}>${f.name} · ${plural(f.videos, "video")}${l.length ? " · also used by " + l.join(", ") : ""}</option>`; })}
        ${value && !known ? html`<option value="__manual">Folder #${value}</option>` : null}
      </select>
    <//>` : null}
    <${Field} label=${list && list.length ? "Or type the folder number" : "Vimeo folder number"} hint="The number at the end of the folder’s address on vimeo.com (…/folder/12345678).">
      <input class="input mono" inputMode="numeric" value=${value} onInput=${(e) => onChange(e.target.value.replace(/\D/g, ""))} placeholder="12345678" />
    <//>
    ${err ? html`<span class="small muted">${err}</span>` : null}
    ${list ? html`<button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${load}>Refresh the folder list</button>` : null}
  </div>`;
}

function NewProject({ admin, onClose }) {
  const { go, toast, reload } = useApp();
  const folders = useFolders(admin.d.vimeo.configured);
  const [f, setF] = useState({ clientId: "", clientName: "", title: "", type: "", folder: "", stage: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const body = { action: "projectCreate", title: f.title, type: f.type, folder: f.folder, stage: f.stage, ...(f.clientId === "__new" ? { clientName: f.clientName } : { clientId: f.clientId }) };
      const r = await api("/api/admin", { method: "POST", body });
      await admin.load(); reload();
      toast(`${f.title} created. Now choose what the client can do.`);
      onClose();
      go("/studio/projects/" + r.id);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return html`<${Modal} title="New project" onClose=${onClose} wide>
    <form class="stack" style=${{ gap: "18px" }} onSubmit=${submit}>
      <${ClientPicker} clients=${admin.d.clients} value=${f} onChange=${(v) => setF({ ...f, ...v })} />
      <div class="formgrid">
        <${Field} label="Project name"><input class="input" required value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} placeholder="For example: Launch Film" /><//>
        <${Field} label="Kind of project (optional)"><input class="input" value=${f.type} onInput=${(e) => setF({ ...f, type: e.target.value })} placeholder="Brand film · Commercial" /><//>
      </div>
      ${admin.d.vimeo.configured ? html`<${FolderPicker} value=${f.folder} onChange=${(v) => setF({ ...f, folder: v })} folders=${folders} projects=${admin.d.projects} />`
        : html`<div class="alert info small">Vimeo isn’t connected yet, so there’s no folder to link. You can link one later.</div>`}
      <${Field} label="Stage"><select class="select" value=${f.stage} onChange=${(e) => setF({ ...f, stage: Number(e.target.value) })}>${admin.d.stages.map((s, i) => html`<option key=${s} value=${i}>${i + 1}. ${s}</option>`)}</select><//>
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <div class="row"><button class="btn primary" disabled=${busy || !f.title.trim() || !(f.clientId && (f.clientId !== "__new" || f.clientName.trim()))}>${busy ? "Creating…" : "Create project"}</button><button type="button" class="btn ghost" onClick=${onClose}>Cancel</button></div>
    </form>
  <//>`;
}

function ProjectEdit({ id, admin }) {
  const { go, toast, reload } = useApp();
  const src = admin.d.projects.find((p) => p.id === id);
  const folders = useFolders(admin.d.vimeo.configured);
  const formOf = (s) => s && ({ title: s.title, type: s.type, summary: s.summary, clientId: s.clientId, clientName: "", stage: s.stage, pct: s.pct || 0,
    next: { ...s.next }, folder: s.folder || "", imageUrl: s.imageUrl || "", caps: { ...s.caps } });
  const init = () => formOf(src);
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [del, setDel] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  if (!src) return html`<${Empty} title="That project isn’t here." action=${html`<${Link} to="/studio/projects" cls="btn primary">All projects<//>`}>It may have been deleted.<//>`;
  const dirty = JSON.stringify(f) !== JSON.stringify(init());
  const caps = admin.d.capabilities;
  const setCap = (k, v) => setF({ ...f, caps: { ...f.caps, [k]: v } });

  const save = async (extra = {}) => {
    setBusy(true); setErr("");
    try {
      const body = { action: "projectUpdate", id, title: f.title, type: f.type, summary: f.summary, stage: f.stage, pct: f.pct, next: f.next, folder: f.folder, imageUrl: f.imageUrl, caps: f.caps,
        ...(f.clientId === "__new" ? { clientName: f.clientName } : { clientId: f.clientId }), ...extra };
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
    <${Head} eyebrow=${src.clientName} title=${src.title} actions=${html`<${Link} to=${"/projects/" + id} cls="btn ghost sm">See the project page<//>`}>
      ${src.archived ? "Archived: the client can’t see this project." : "Changes take effect for the client as soon as you save."}
    <//>

    <section class="card pad stack" style=${{ gap: "18px" }}>
      <div class="h3">Details</div>
      <div class="formgrid">
        <${Field} label="Project name"><input class="input" value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} /><//>
        <${Field} label="Kind of project"><input class="input" value=${f.type} onInput=${(e) => setF({ ...f, type: e.target.value })} placeholder="Brand film · Commercial" /><//>
      </div>
      <${Field} label="Summary (shown on the project page)"><textarea class="textarea" rows="3" value=${f.summary} onInput=${(e) => setF({ ...f, summary: e.target.value })} placeholder="One or two sentences about what you’re making."></textarea><//>
      <${ClientPicker} clients=${admin.d.clients} value=${f} onChange=${(v) => setF({ ...f, ...v })} />
    </section>

    <section class="card pad stack section" style=${{ gap: "18px", marginTop: "16px" }}>
      <div class="h3">Progress</div>
      <div class="seg" role="group" aria-label="Stage">${admin.d.stages.map((s, i) => html`<button type="button" key=${s} aria-pressed=${f.stage === i} onClick=${() => setF({ ...f, stage: i })}>${i + 1}. ${s}</button>`)}</div>
      <div class="formgrid">
        <${Field} label="Next milestone: label" hint="For example “Next filming day” or “Next”."><input class="input" value=${f.next.label} onInput=${(e) => setF({ ...f, next: { ...f.next, label: e.target.value } })} /><//>
        <${Field} label="When" hint="Plain words are fine: “October 9”, “early next week”."><input class="input" value=${f.next.date} onInput=${(e) => setF({ ...f, next: { ...f.next, date: e.target.value } })} /><//>
        <${Field} label="What happens"><input class="input" value=${f.next.what} onInput=${(e) => setF({ ...f, next: { ...f.next, what: e.target.value } })} placeholder="Version 2 ready to watch" /><//>
        <${Field} label="Progress shown (%)" hint="0 = set automatically from the stage."><input class="input" type="number" min="0" max="100" value=${f.pct} onInput=${(e) => setF({ ...f, pct: Number(e.target.value) || 0 })} /><//>
      </div>
    </section>

    <section class="card pad stack section" style=${{ gap: "18px", marginTop: "16px" }}>
      <div class="row" style=${{ justifyContent: "space-between" }}><div class="h3">Vimeo folder</div>${f.folder ? html`<a class="btn ghost sm" href=${"https://vimeo.com/manage/folders/" + f.folder} target="_blank" rel="noopener">Open in Vimeo ↗</a>` : null}</div>
      ${admin.d.vimeo.configured ? html`<${FolderPicker} value=${f.folder} onChange=${(v) => setF({ ...f, folder: v })} folders=${folders} projects=${admin.d.projects} selfId=${id} />`
        : html`<div class="alert info small">Vimeo isn’t connected yet (Studio → Vimeo & connections).</div>`}
      <p class="muted small" style=${{ margin: 0, lineHeight: 1.6 }}>In that folder, a video with a version number in its title (“Harbor Spot V2”) appears in Review as Version 2. Any other video appears in Films as a finished film. Videos the client sends are listed under Files and never shown as films.</p>
    </section>

    <section class="card pad stack section" style=${{ gap: "18px", marginTop: "16px" }}>
      <div class="stack" style=${{ gap: "6px" }}><div class="h3">What ${src.clientName} can do</div><span class="muted small">Switched off means hidden from the client and refused by the portal. You can always do everything.</span></div>
      <div class="capgrid">${caps.map((c) => {
        const blocked = c.needs && !f.caps[c.needs];
        return html`<div class="cap" key=${c.key}>
          <${Toggle} checked=${!!f.caps[c.key] && !blocked} disabled=${blocked} onChange=${(v) => setCap(c.key, v)} label=${c.label} />
          <div><b>${c.label}</b><span>${c.detail}</span></div>
        </div>`;
      })}</div>
    </section>

    <section class="card pad stack section" style=${{ gap: "14px", marginTop: "16px" }}>
      <div class="h3">Cover image</div>
      <${Field} label="Image link (optional)" hint="Leave empty to use the newest film’s thumbnail. Paste an https link to choose your own."><input class="input" value=${f.imageUrl} onInput=${(e) => setF({ ...f, imageUrl: e.target.value })} placeholder="https://…" /><//>
    </section>

    <section class="section stack" style=${{ gap: "12px", marginTop: "28px" }}>
      <div class="h3">Archive or delete</div>
      <div class="row">
        <button class="btn ghost" disabled=${busy} onClick=${() => save({ archived: !src.archived })}>${src.archived ? "Bring it back for the client" : "Archive (hide from the client)"}</button>
        <button class="btn danger" onClick=${() => setDel(true)}>Delete project…</button>
      </div>
      <span class="muted small">Archiving keeps everything and can be undone. Deleting removes its notes, decisions, messages, and files for good; videos stay in Vimeo.</span>
    </section>

    ${err ? html`<div class="alert" role="alert" style=${{ marginTop: "16px" }}>${err}</div>` : null}
    <div class=${"savebar" + (dirty ? " dirty" : "")}>
      <span class="muted small grow" style=${{ alignSelf: "center", paddingLeft: "10px" }}>${dirty ? "You have unsaved changes." : "Everything is saved."}</span>
      <button class="btn ghost" disabled=${!dirty || busy} onClick=${() => setF(init())}>Discard</button>
      <button class="btn primary" disabled=${!dirty || busy || !f.title.trim()} onClick=${() => save()}>${busy ? "Saving…" : "Save changes"}</button>
    </div>
    ${del ? html`<${Modal} title=${`Delete ${src.title}?`} onClose=${() => setDel(false)}>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>This permanently removes the project’s notes, decisions, messages, and files. Its videos stay in Vimeo. This can’t be undone.</p>
      <${Field} label=${`Type “${src.title}” to confirm`}><input class="input" value=${confirmText} onInput=${(e) => setConfirmText(e.target.value)} /><//>
      <div class="row"><button class="btn solid-red" disabled=${busy || confirmText.trim() !== src.title} onClick=${remove}>Delete for good</button><button class="btn ghost" onClick=${() => setDel(false)}>Keep it</button></div>
    <//>` : null}
  `;
}

// ---------- clients ----------
function Clients({ admin }) {
  const { toast, reload } = useApp();
  const { d } = admin;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [rename, setRename] = useState(null);
  const [del, setDel] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (body, msg) => {
    setBusy(true);
    try { await api("/api/admin", { method: "POST", body }); await admin.load(); reload(); toast(msg); return true; }
    catch (e) { toast(e.message, { err: true }); return false; }
    finally { setBusy(false); }
  };
  return html`
    <${Head} eyebrow="Studio" title="Clients" actions=${html`<button class="btn primary" onClick=${() => { setName(""); setAdding(true); }}>Add a client</button>`}>
      Each client is a company. Its people see only its own projects.
    <//>
    ${!d.clients.length ? html`<${Empty} icon="anchor" title="No clients yet.">Add one here, or create it while making its first project.<//>`
    : html`<table class="table"><thead><tr><th>Client</th><th>People</th><th>Projects</th><th>Added</th><th></th></tr></thead>
      <tbody>${d.clients.map((c) => html`<tr key=${c.id}>
        <td><b>${c.name}</b></td><td>${c.people}</td><td>${c.projects}</td><td class="muted small">${fmtDate(c.created)}</td>
        <td style=${{ textAlign: "right", whiteSpace: "nowrap" }}><button class="btn ghost sm" onClick=${() => setRename({ ...c })}>Rename</button> <button class="btn ghost sm" onClick=${() => { setConfirmText(""); setDel(c); }}>Delete…</button></td>
      </tr>`)}</tbody></table>`}
    ${adding ? html`<${Modal} title="Add a client" onClose=${() => setAdding(false)}>
      <${Field} label="Company name"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="For example: Meridian" /><//>
      <div class="row"><button class="btn primary" disabled=${busy || !name.trim()} onClick=${async () => { if (await run({ action: "clientCreate", name }, `${name} added. Next, add their people and a project.`)) setAdding(false); }}>Add client</button><button class="btn ghost" onClick=${() => setAdding(false)}>Cancel</button></div>
    <//>` : null}
    ${rename ? html`<${Modal} title=${"Rename " + rename.name} onClose=${() => setRename(null)}>
      <${Field} label="Company name"><input class="input" value=${rename.name} onInput=${(e) => setRename({ ...rename, name: e.target.value })} /><//>
      <div class="row"><button class="btn primary" disabled=${busy || !rename.name.trim()} onClick=${async () => { if (await run({ action: "clientRename", id: rename.id, name: rename.name }, "Renamed.")) setRename(null); }}>Save</button><button class="btn ghost" onClick=${() => setRename(null)}>Cancel</button></div>
    <//>` : null}
    ${del ? html`<${Modal} title=${`Delete ${del.name}?`} onClose=${() => setDel(null)}>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>This removes ${plural(del.people, "person", "people")} and ${plural(del.projects, "project")}, with every note, decision, message, and file in them. Videos stay in Vimeo. This can’t be undone.</p>
      <${Field} label=${`Type “${del.name}” to confirm`}><input class="input" value=${confirmText} onInput=${(e) => setConfirmText(e.target.value)} /><//>
      <div class="row"><button class="btn solid-red" disabled=${busy || confirmText.trim() !== del.name} onClick=${async () => { if (await run({ action: "clientDelete", id: del.id, confirm: confirmText }, `${del.name} deleted.`)) setDel(null); }}>Delete for good</button><button class="btn ghost" onClick=${() => setDel(null)}>Keep it</button></div>
    <//>` : null}
  `;
}

// ---------- people ----------
function Invite({ person, pass, onClose }) {
  const { toast } = useApp();
  const text = `Hi ${person.name.split(" ")[0]},\n\nYour Nobleman Productions client portal is ready: ${PORTAL}\n\nSign in with ${person.email} and this temporary password: ${pass}\nYou’ll choose your own password the first time you sign in.\n\nJean and Justin`;
  return html`<${Modal} title=${`Send ${person.name} their sign-in`} onClose=${onClose}>
    <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>This temporary password is shown only once. Send it to ${person.name} with the portal address. They’ll replace it with their own when they first sign in.</p>
    <div class="copybox"><code>${pass}</code><button class="btn ghost sm" onClick=${() => copy(pass, toast, "Password")}>Copy</button></div>
    <div class="row"><button class="btn primary" onClick=${() => copy(text, toast, "Invitation")}>Copy an invitation message</button><button class="btn ghost" onClick=${onClose}>Done</button></div>
    <span class="faint small">Send it the way you normally reach them; the portal doesn’t email it.</span>
  <//>`;
}

function PersonForm({ admin, person, onClose }) {
  const { toast, reload, user } = useApp();
  const editing = !!person;
  const [f, setF] = useState(person ? { name: person.name, email: person.email, title: person.title, role: person.role, clientId: person.clientId || "", clientName: "" } : { name: "", email: "", title: "", role: "client", clientId: "", clientName: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [invite, setInvite] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const client = f.role === "client" ? (f.clientId === "__new" ? { clientName: f.clientName } : { clientId: f.clientId }) : {};
      if (editing) {
        await api("/api/admin", { method: "POST", body: { action: "personUpdate", id: person.id, name: f.name, title: f.title, role: f.role, ...client } });
        await admin.load(); reload(); toast("Saved."); onClose();
      } else {
        const r = await api("/api/admin", { method: "POST", body: { action: "personCreate", name: f.name, email: f.email, title: f.title, role: f.role, ...client } });
        await admin.load(); reload();
        setInvite({ person: { name: f.name, email: f.email.trim().toLowerCase() }, pass: r.tempPassword });
      }
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  if (invite) return html`<${Invite} ...${invite} onClose=${onClose} />`;
  const self = editing && person.id === user.id;
  return html`<${Modal} title=${editing ? "Edit " + person.name : "Add a person"} onClose=${onClose} wide>
    <form class="stack" style=${{ gap: "18px" }} onSubmit=${submit}>
      <div class="formgrid">
        <${Field} label="Name"><input class="input" required value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /><//>
        <${Field} label="Email" hint=${editing ? "Emails can’t be changed; add a new person instead." : "They sign in with this."}><input class="input" type="email" required disabled=${editing} value=${f.email} onInput=${(e) => setF({ ...f, email: e.target.value })} /><//>
        <${Field} label="Job title (optional)"><input class="input" value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} /><//>
        <${Field} label="Kind of account" hint=${self ? "You can’t change your own." : ""}>
          <select class="select" value=${f.role} disabled=${self} onChange=${(e) => setF({ ...f, role: e.target.value })}>
            <option value="client">Client: sees only their company’s projects</option>
            <option value="admin">Staff: sees everything, and uses Studio</option>
          </select>
        <//>
      </div>
      ${f.role === "client" ? html`<${ClientPicker} clients=${admin.d.clients} value=${f} onChange=${(v) => setF({ ...f, ...v })} />` : null}
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <div class="row">
        <button class="btn primary" disabled=${busy || !f.name.trim() || !f.email.trim() || (f.role === "client" && !(f.clientId && (f.clientId !== "__new" || f.clientName.trim())))}>${busy ? "Saving…" : editing ? "Save" : "Add and get their password"}</button>
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
      </div>
    </form>
  <//>`;
}

function People({ admin }) {
  const { toast, reload, user } = useApp();
  const { d } = admin;
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState(null);
  const [reset, setReset] = useState(null);
  const [invite, setInvite] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = d.people.filter((p) => filter === "all" || (filter === "staff" ? p.role === "admin" : p.role === "client"));
  const doReset = async () => {
    setBusy(true);
    try {
      const r = await api("/api/admin", { method: "POST", body: { action: "personReset", id: reset.id } });
      await admin.load();
      setInvite({ person: reset, pass: r.tempPassword }); setReset(null);
    } catch (e) { toast(e.message, { err: true }); }
    setBusy(false);
  };
  const doDelete = async () => {
    setBusy(true);
    try { await api("/api/admin", { method: "POST", body: { action: "personDelete", id: del.id } }); await admin.load(); reload(); toast(`${del.name} removed. Their sign-in stops working at once.`); setDel(null); }
    catch (e) { toast(e.message, { err: true }); }
    setBusy(false);
  };
  return html`
    <${Head} eyebrow="Studio" title="People" actions=${html`<button class="btn primary" onClick=${() => setForm({})}>Add a person</button>`}>
      Staff see everything. Client people see only their own company’s projects. New people get a temporary password to replace on first sign-in.
    <//>
    <div class="tabs" style=${{ marginBottom: "18px" }}>${[["all", "Everyone"], ["client", "Clients"], ["staff", "Staff"]].map(([k, l]) => html`<button key=${k} class="tab-btn" aria-pressed=${filter === k} onClick=${() => setFilter(k)}>${l}</button>`)}</div>
    <table class="table"><thead><tr><th>Person</th><th>Account</th><th>Last signed in</th><th></th></tr></thead>
      <tbody>${list.map((p) => html`<tr key=${p.id}>
        <td><b>${p.name}</b>${p.id === user.id ? html` <span class="faint small">(you)</span>` : null}<div class="muted small">${p.email}${p.title ? " · " + p.title : ""}</div></td>
        <td>${p.role === "admin" ? html`<span class="pill">Staff</span>` : html`<span class="pill">Client</span> <span class="small">${p.clientName}</span>`}</td>
        <td class="small">${p.mustChangePassword ? html`<span class="pill amber">Hasn’t chosen a password yet</span>` : p.lastLogin ? fmtAgo(p.lastLogin) : html`<span class="muted">Never</span>`}</td>
        <td style=${{ textAlign: "right", whiteSpace: "nowrap" }}>
          <button class="btn ghost sm" onClick=${() => setForm({ person: p })}>Edit</button>
          ${p.id !== user.id ? html`<button class="btn ghost sm" onClick=${() => setReset(p)}>Reset password</button><button class="btn ghost sm" onClick=${() => setDel(p)}>Remove</button>`
            : html`<${Link} to="/account" cls="btn ghost sm">Change my password<//>`}
        </td>
      </tr>`)}</tbody></table>
    ${form ? html`<${PersonForm} admin=${admin} person=${form.person} onClose=${() => setForm(null)} />` : null}
    ${reset ? html`<${Confirm} title=${`Reset ${reset.name}’s password?`} yes="Yes, reset it" busy=${busy} onYes=${doReset} onNo=${() => setReset(null)}>
      Their current password stops working and they’re signed out everywhere. You’ll get a temporary password to send them.
    <//>` : null}
    ${invite ? html`<${Invite} ...${invite} onClose=${() => setInvite(null)} />` : null}
    ${del ? html`<${Confirm} title=${`Remove ${del.name}?`} yes="Yes, remove them" danger busy=${busy} onYes=${doDelete} onNo=${() => setDel(null)}>
      Their sign-in stops working at once. Their notes and messages stay, under their name.
    <//>` : null}
  `;
}

// ---------- connections ----------
const NEED = [
  ["public", "See the account"], ["private", "See private and hidden videos"], ["edit", "Name and file uploads"],
  ["upload", "Accept uploads from clients"], ["video_files", "Download links (Standard plan or above)"], ["stats", "Play counts"],
];

function Connections({ admin }) {
  const { toast } = useApp();
  const { d } = admin;
  const v = d.vimeo;
  const folders = useFolders(v.configured && !v.error);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try { await api("/api/admin", { method: "POST", body: { action: "vimeoRefresh" } }); await admin.load(); await folders.load(); toast("Refreshed from Vimeo."); }
    catch (e) { toast(e.message, { err: true }); }
    setBusy(false);
  };
  const plan = (v.plan || "").toLowerCase();
  const apiDownloads = /standard|advanced|pro|business|premium|enterprise|live/.test(plan) && !/plus/.test(plan);
  return html`
    <${Head} eyebrow="Studio" title="Vimeo & connections" actions=${v.configured ? html`<button class="btn ghost" disabled=${busy} onClick=${refresh}>${busy ? "Refreshing…" : "Refresh from Vimeo"}</button>` : null}>
      What the portal is connected to, and what each connection allows.
    <//>
    <div class="grid c2">
      <section class="card pad stack" style=${{ gap: "14px" }}>
        <div class="row"><${Icon} name="play" size=${26} /><div class="h3">Vimeo</div>${v.configured && !v.error ? html`<span class="pill green">Connected</span>` : html`<span class="pill amber">${v.configured ? "Problem" : "Not connected"}</span>`}</div>
        ${!v.configured ? html`<p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>Add a Vimeo access token from Jean’s account as <b>VIMEO_ACCESS_TOKEN</b> in Vercel (README, “Connecting Vimeo”), then redeploy. Until then, projects show no versions or films.</p>`
          : v.error ? html`<div class="alert">${v.error}</div>`
          : html`
            <span>Account: <b>${v.name}</b> · plan: <b>${v.plan || "unknown"}</b> · <a href=${v.link} target="_blank" rel="noopener">vimeo.com ↗</a></span>
            ${v.upload && v.upload.free != null ? html`<span class="muted small">Upload space left: ${fmtBytes(v.upload.free)}${v.upload.periodFree != null ? ` · this week: ${fmtBytes(v.upload.periodFree)}` : ""}</span>` : null}
            <div class="stack" style=${{ gap: "8px" }}>${NEED.map(([s, what]) => { const ok = (v.scopes || []).includes(s); return html`<span key=${s} class=${"check " + (ok ? "ok" : "no")}><i>${ok ? "✓" : "✕"}</i>${what} <span class="faint mono small">${s}</span></span>`; })}</div>
            <div class="alert info small" style=${{ lineHeight: 1.6 }}>${apiDownloads
              ? "This plan allows download links through the portal."
              : "Download links through the portal need Vimeo Standard or above. On this plan, a finished film can still be downloaded from Vimeo’s own page if you allow downloads on it and make it unlisted; the portal then offers “Download on Vimeo”."}</div>`}
      </section>
      <section class="card pad stack" style=${{ gap: "14px" }}>
        <div class="row"><${Icon} name="send" size=${26} /><div class="h3">File storage</div>${d.blob ? html`<span class="pill green">Connected</span>` : html`<span class="pill amber">Not connected</span>`}</div>
        <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>${d.blob ? "Documents and client files are kept in a private Vercel Blob store. Downloads use links that expire after ten minutes." : "Connect a private Vercel Blob store to the portal project (Vercel → Storage → Create → Blob, access: private). Until then, Files can’t accept uploads."}</p>
        <div class="row"><${Icon} name="bottle" size=${26} /><div class="h3">Email updates</div>${d.email ? html`<span class="pill green">On</span>` : html`<span class="pill">Off</span>`}</div>
        <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>${d.email ? "Staff get an email when clients leave notes, decide on versions, message, or upload; clients when you message them or add files." : "Off until RESEND_API_KEY and PORTAL_EMAIL_FROM are set (README, “Email updates”). Everything still shows up in the portal."}</p>
      </section>
    </div>
    ${v.configured && !v.error ? html`<section class="section">
      <div class="sh"><span class="eyebrow"><span>Vimeo folders</span></span></div>
      ${!folders.folders ? html`<p class="muted">Loading folders…</p>` : !folders.folders.length ? html`<p class="muted">No folders in this Vimeo account yet.</p>`
      : html`<table class="table"><thead><tr><th>Folder</th><th>Videos</th><th>Used by</th></tr></thead><tbody>${folders.folders.map((f) => {
          const used = d.projects.filter((p) => p.folder === f.id);
          return html`<tr key=${f.id}><td><b>${f.name}</b> <span class="faint mono small">#${f.id}</span></td><td>${f.videos}</td>
            <td>${used.length ? used.map((p) => html`<${Link} key=${p.id} to=${"/studio/projects/" + p.id} cls="link">${p.clientName} · ${p.title}<//>`) : html`<span class="muted small">Not linked</span>`}</td></tr>`;
        })}</tbody></table>`}
    </section>` : null}
  `;
}
