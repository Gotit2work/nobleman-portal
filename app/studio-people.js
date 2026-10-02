// Studio → Clients and Studio → People (with the roles table). See studio.js for the shell.
import { html, useApp, useState, api, Head, Empty, Link, Field, Toggle, Modal, Confirm, copy, fmtDate, fmtAgo, plural } from "./ui.js";
import { ClientPicker, useRun } from "./studio.js";

// ---------- clients ----------
export function Clients({ admin }) {
  const { d } = admin;
  const { run, busy } = useRun(admin);
  const [edit, setEdit] = useState(null);     // {id?, name, logo, notes}
  const [del, setDel] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const may = admin.can("clients.manage");
  const save = async () => {
    const ok = await run(edit.id ? { action: "clientUpdate", ...edit } : { action: "clientCreate", ...edit },
      edit.id ? "Saved." : `${edit.name} added. Next, add their people and a project.`);
    if (ok) setEdit(null);
  };
  return html`
    <${Head} eyebrow="Studio" title="Clients" actions=${may ? html`<button class="btn primary" onClick=${() => setEdit({ name: "", logo: "", notes: "", domains: "" })}>Add a client</button>` : null}>
      Each client is a company. Its people see only its own projects, with its logo at the top of their portal.
    <//>
    ${!d.clients.length ? html`<${Empty} icon="anchor" title="No clients yet.">Add one here, or create it while making its first project.<//>`
    : html`<table class="table"><thead><tr><th>Client</th><th>People</th><th>Projects</th><th>Added</th><th></th></tr></thead>
      <tbody>${d.clients.map((c) => html`<tr key=${c.id}>
        <td><div class="row" style=${{ gap: "12px", flexWrap: "nowrap" }}>
          ${c.logo ? html`<span class="client-logo sm" style=${{ backgroundImage: `url('${c.logo}')` }} aria-hidden="true"></span>` : null}
          <div><b>${c.name}</b>${c.domains && c.domains.length ? html`<div class="faint small">Joins by email: ${c.domains.map((x) => "@" + x).join(", ")}</div>` : null}${c.notes ? html`<div class="muted small clip">${c.notes}</div>` : null}</div></div></td>
        <td>${admin.can("people.manage") ? html`<${Link} to=${"/studio/people?client=" + c.id} cls="link">${c.people}<//>` : c.people}</td>
        <td>${c.projects}</td><td class="muted small">${fmtDate(c.created)}</td>
        <td style=${{ textAlign: "right", whiteSpace: "nowrap" }}>
          ${may ? html`<button class="btn ghost sm" onClick=${() => setEdit({ id: c.id, name: c.name, logo: c.logo, notes: c.notes, domains: (c.domains || []).join(", ") })}>Edit</button>` : null}
          ${admin.can("data.export") && !d.demo ? html`<a class="btn ghost sm" href=${"/api/admin?export=client&id=" + c.id} download title="Everything the portal holds about this client, as a file">Export data</a>` : null}
          ${admin.can("clients.delete") ? html`<button class="btn ghost sm" onClick=${() => { setConfirmText(""); setDel(c); }}>Delete…</button>` : null}
        </td>
      </tr>`)}</tbody></table>`}
    ${edit ? html`<${Modal} title=${edit.id ? "Edit " + edit.name : "Add a client"} onClose=${() => setEdit(null)}>
      <${Field} label="Company name"><input class="input" value=${edit.name} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} placeholder="For example: Meridian" /><//>
      <${Field} label="Logo link (optional)" hint="An https link to their logo, ideally light on a transparent background. Shown at the top of their portal.">
        <input class="input" type="url" value=${edit.logo} onInput=${(e) => setEdit({ ...edit, logo: e.target.value })} placeholder="https://…" />
      <//>
      ${edit.logo && /^https:\/\//.test(edit.logo) ? html`<div class="client-logo lg" style=${{ backgroundImage: `url('${edit.logo}')` }} aria-label="Logo preview" role="img"></div>` : null}
      <${Field} label="Their email domain (optional)" hint=${`For example harborlabs.com. Anyone who creates an account with an address there joins ${edit.name || "this client"} as soon as they confirm their email${d.settings.security ? `, as a ${roleName(d, d.settings.security.domainRole)}` : ""}. Free email services can’t be used.`}>
        <input class="input" value=${edit.domains} onInput=${(e) => setEdit({ ...edit, domains: e.target.value })} placeholder="harborlabs.com" autoCapitalize="none" spellCheck="false" />
      <//>
      <${Field} label="Notes for the studio (optional)" hint="Only staff see these: billing contact, brand rules, anything worth remembering.">
        <textarea class="textarea" rows="3" value=${edit.notes} onInput=${(e) => setEdit({ ...edit, notes: e.target.value })}></textarea>
      <//>
      <div class="row"><button class="btn primary" disabled=${busy || !edit.name.trim()} onClick=${save}>${edit.id ? "Save" : "Add client"}</button><button class="btn ghost" onClick=${() => setEdit(null)}>Cancel</button></div>
    <//>` : null}
    ${del ? html`<${Modal} title=${`Delete ${del.name}?`} onClose=${() => setDel(null)}>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>This removes ${plural(del.people, "person", "people")} and every project they have, with every note, decision, message, and file. Videos stay at their source. This can’t be undone.${admin.can("data.export") ? " Export their data first if you might need it." : ""}</p>
      <${Field} label=${`Type “${del.name}” to confirm`}><input class="input" value=${confirmText} onInput=${(e) => setConfirmText(e.target.value)} /><//>
      <div class="row"><button class="btn solid-red" disabled=${busy || confirmText.trim() !== del.name} onClick=${async () => { if (await run({ action: "clientDelete", id: del.id, confirm: confirmText }, `${del.name} deleted.`)) setDel(null); }}>Delete for good</button><button class="btn ghost" onClick=${() => setDel(null)}>Keep it</button></div>
    <//>` : null}
  `;
}

// ---------- people ----------
const roleList = (d, kind) => (kind === "admin" ? d.roles.staff : d.roles.client);
const roleName = (d, key) => ((d.roles.client.find((r) => r.key === key) || {}).label || "reviewer").toLowerCase();

/** People who created an account and are waiting: approve them into a client with a role, or decline. */
function Requests({ admin, onLink }) {
  const { d } = admin;
  const { run, busy } = useRun(admin);
  const [approving, setApproving] = useState(null);
  const [declining, setDeclining] = useState(null);
  const [tell, setTell] = useState(true);
  if (!d.signups || !d.signups.length) return null;
  const open = (r) => setApproving({ r, clientId: r.match ? r.match.id : "__new", clientName: r.match ? "" : r.company, access: r.match ? "reviewer" : "approver" });
  const approve = async () => {
    const a = approving;
    const body = { action: "signupApprove", id: a.r.id, access: a.access, ...(a.clientId === "__new" ? { clientName: a.clientName } : { clientId: a.clientId }) };
    const res = await run(body, null);
    if (res) { setApproving(null); onLink({ person: { name: a.r.name, email: a.r.email }, link: res.inviteLink, purpose: "invite", emailed: res.emailed }); }
  };
  return html`<section class="card pad stack requests" style=${{ gap: "12px", marginBottom: "24px" }}>
    <div class="row" style=${{ justifyContent: "space-between" }}><div class="h3">Asking to join</div><span class="pill amber">${d.signups.length} waiting</span></div>
    <span class="muted small" style=${{ lineHeight: 1.55 }}>They created an account and confirmed their email. Choose their company and role to let them in; they’re emailed a link to choose a password.</span>
    <div class="list">${d.signups.map((r) => html`<div class="li" key=${r.id} style=${{ flexWrap: "wrap" }}>
      <div class="grow" style=${{ minWidth: "220px" }}><div class="name">${r.name} <span class="faint small">· ${r.company || "no company given"}</span></div>
        <div class="meta">${r.email} · asked ${fmtAgo(r.created)}${r.match ? ` · looks like ${r.match.name}` : ""}</div>
        ${r.note ? html`<div class="muted small" style=${{ marginTop: "4px", whiteSpace: "pre-wrap" }}>“${r.note}”</div>` : null}</div>
      <div class="row" style=${{ gap: "6px" }}>
        <button class="btn primary sm" onClick=${() => open(r)}>Let them in…</button>
        <button class="btn ghost sm" onClick=${() => { setTell(true); setDeclining(r); }}>Decline</button>
      </div>
    </div>`)}</div>
    ${approving ? html`<${Modal} title=${`Let ${approving.r.name} in`} onClose=${() => setApproving(null)} wide>
      <p class="muted small" style=${{ margin: 0, lineHeight: 1.6 }}>${approving.r.email} said they’re from <b style=${{ color: "var(--ink)" }}>${approving.r.company || "no company"}</b>.</p>
      <${ClientPicker} clients=${d.clients} value=${approving} onChange=${(v) => setApproving({ ...approving, ...v })} />
      <div class="stack" style=${{ gap: "8px" }}>
        <span class="small" style=${{ fontWeight: 600 }}>Role</span>
        <div class="roles" role="radiogroup" aria-label="Role">${d.roles.client.map((x) => html`<label key=${x.key} class=${"rolecard" + (approving.access === x.key ? " on" : "")}>
          <input type="radio" name="req-access" value=${x.key} checked=${approving.access === x.key} onChange=${() => setApproving({ ...approving, access: x.key })} />
          <b>${x.label}</b><span>${x.detail}</span></label>`)}</div>
      </div>
      <div class="row"><button class="btn primary" disabled=${busy || !(approving.clientId && (approving.clientId !== "__new" || String(approving.clientName || "").trim()))} onClick=${approve}>${busy ? "One moment…" : "Let them in and send the invitation"}</button>
        <button class="btn ghost" onClick=${() => setApproving(null)}>Cancel</button></div>
    <//>` : null}
    ${declining ? html`<${Modal} title=${`Decline ${declining.name}?`} onClose=${() => setDeclining(null)}>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>No account is made. They can ask again later.</p>
      <div class="cap"><${Toggle} checked=${tell} onChange=${setTell} label="Tell them by email" />
        <div><b>Tell them by email</b><span>A short, polite note that the studio couldn’t give them access, with your help email.</span></div></div>
      <div class="row"><button class="btn solid-red" disabled=${busy} onClick=${async () => { if (await run({ action: "signupDecline", id: declining.id, tell }, `${declining.name} was declined${tell ? " and told" : ""}.`)) setDeclining(null); }}>Decline</button>
        <button class="btn ghost" onClick=${() => setDeclining(null)}>Keep the request</button></div>
    <//>` : null}
  </section>`;
}

/** A one-time link to set a password (invite) or choose a new one (reset), to send however you reach them. */
function LinkSent({ person, link, purpose, emailed, onClose }) {
  const { toast, data } = useApp();
  const studio = (data.brand && data.brand.studio) || "the studio";
  const first = person.name.split(" ")[0];
  const msg = purpose === "invite"
    ? `Hi ${first},\n\nYour ${studio} client portal is ready. Open this link to choose your password (it works once, for 14 days):\n${link}\n\nAfter that, log in any time with ${person.email}.`
    : `Hi ${first},\n\nHere’s a link to choose a new password for the ${studio} portal. It works once, for the next hour:\n${link}`;
  return html`<${Modal} title=${purpose === "invite" ? `${person.name} is invited` : `A new login link for ${person.name}`} onClose=${onClose}>
    ${emailed ? html`<div class="alert info">We emailed it to ${person.email}. You can also copy it below.</div>`
      : html`<p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>Send this link to ${person.name} the way you normally reach them. ${purpose === "invite" ? "It works once, for 14 days." : "It works once, for an hour."} Anyone with it can set the password, so send it only to them.</p>`}
    <div class="copybox"><code class="clip">${link}</code><button class="btn ghost sm" onClick=${() => copy(link, toast, "Link")}>Copy</button></div>
    <div class="row"><button class="btn ${emailed ? "ghost" : "primary"}" onClick=${() => copy(msg, toast, "Message")}>Copy a ready-to-send message</button><button class="btn ghost" onClick=${onClose}>Done</button></div>
  <//>`;
}

function PersonForm({ admin, person, defaults, onClose, onLink }) {
  const { user } = useApp();
  const { d } = admin;
  const { run, busy } = useRun(admin);
  const editing = !!person;
  const mayStaff = admin.can("staff.manage"), mayClients = admin.can("people.manage");
  const [f, setF] = useState(person
    ? { name: person.name, email: person.email, title: person.title, role: person.role, access: person.access, clientId: person.clientId || "", clientName: "" }
    : { name: "", email: "", title: "", role: mayClients ? "client" : "admin", access: mayClients ? "approver" : "editor", clientId: (defaults && defaults.clientId) || "", clientName: "", send: d.email });
  const [err, setErr] = useState("");
  const self = editing && person.id === user.id;
  const roles = roleList(d, f.role);
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    const client = f.role === "client" ? (f.clientId === "__new" ? { clientName: f.clientName } : { clientId: f.clientId }) : {};
    const body = editing
      ? { action: "personUpdate", id: person.id, name: f.name, title: f.title, email: f.email, role: f.role, access: f.access, ...client }
      : { action: "personCreate", name: f.name, email: f.email, title: f.title, role: f.role, access: f.access, send: f.send, ...client };
    const r = await run(body, editing ? "Saved." : null);
    if (!r) return;
    if (editing) onClose();
    else onLink({ person: { name: f.name, email: f.email.trim().toLowerCase() }, link: r.inviteLink, purpose: "invite", emailed: r.emailed });
  };
  return html`<${Modal} title=${editing ? "Edit " + person.name : "Invite a person"} onClose=${onClose} wide>
    <form class="stack" style=${{ gap: "18px" }} onSubmit=${submit}>
      <div class="formgrid">
        <${Field} label="Name"><input class="input" required value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /><//>
        <${Field} label="Email" hint=${editing ? "Changing it logs them out; they then log in with the new one." : "They log in with this."}><input class="input" type="email" required value=${f.email} onInput=${(e) => setF({ ...f, email: e.target.value })} /><//>
        <${Field} label="Job title (optional)"><input class="input" value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} /><//>
        <${Field} label="Kind of account" hint=${self ? "You can’t change your own." : ""}>
          <select class="select" value=${f.role} disabled=${self || !(mayStaff && mayClients)} onChange=${(e) => setF({ ...f, role: e.target.value, access: e.target.value === "admin" ? "editor" : "approver" })}>
            <option value="client">Client: sees only their company’s projects</option>
            <option value="admin">Staff: works in the studio</option>
          </select>
        <//>
      </div>
      <div class="stack" style=${{ gap: "8px" }}>
        <span class="small" style=${{ fontWeight: 600 }}>Role</span>
        <div class="roles" role="radiogroup" aria-label="Role">${roles.map((r) => html`<label key=${r.key} class=${"rolecard" + (f.access === r.key ? " on" : "")}>
          <input type="radio" name="access" value=${r.key} checked=${f.access === r.key} disabled=${self} onChange=${() => setF({ ...f, access: r.key })} />
          <b>${r.label}</b><span>${r.detail}</span></label>`)}</div>
      </div>
      ${f.role === "client" ? html`<${ClientPicker} clients=${d.clients} value=${f} onChange=${(v) => setF({ ...f, ...v })} />` : null}
      ${!editing && d.email ? html`<div class="cap"><${Toggle} checked=${f.send} onChange=${(v) => setF({ ...f, send: v })} label="Email the invitation" />
        <div><b>Email them the invitation</b><span>They get a link to choose a password. Either way you can copy the link next.</span></div></div>` : null}
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <div class="row">
        <button class="btn primary" disabled=${busy || !f.name.trim() || !f.email.trim() || (f.role === "client" && !(f.clientId && (f.clientId !== "__new" || f.clientName.trim())))}>${busy ? "Saving…" : editing ? "Save" : "Invite"}</button>
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
      </div>
    </form>
  <//>`;
}

export function People({ admin, view }) {
  const { user } = useApp();
  const { d } = admin;
  const { run, busy } = useRun(admin);
  const query = new URLSearchParams(location.search);
  const [filter, setFilter] = useState(view === "roles" ? "roles" : query.get("client") ? "client" : "all");
  const [clientId, setClientId] = useState(query.get("client") || "");
  const [q, setQ] = useState("");
  const [form, setForm] = useState(null);
  const [linkOut, setLinkOut] = useState(null);
  const [ask, setAsk] = useState(null);   // {kind, p}
  const mayFor = (p) => admin.can(p.role === "admin" ? "staff.manage" : "people.manage");
  const find = q.trim().toLowerCase();
  const list = d.people.filter((p) => (filter === "all" || (filter === "staff" ? p.role === "admin" : p.role === "client"))
    && (!clientId || p.clientId === clientId) && (!find || (p.name + " " + p.email + " " + (p.clientName || "")).toLowerCase().includes(find)));
  const act = async () => {
    const { kind, p } = ask;
    if (kind === "link") {
      const r = await run({ action: "personInvite", id: p.id }, null);
      if (r) setLinkOut({ person: p, link: r.link, purpose: r.purpose, emailed: r.emailed });
    } else if (kind === "signout") await run({ action: "personSignOut", id: p.id }, `${p.name} is logged out everywhere.`);
    else if (kind === "twostep") await run({ action: "personTwoStepReset", id: p.id }, `Two-step verification is off for ${p.name}. They can turn it on again from their account.`);
    else if (kind === "delete") await run({ action: "personDelete", id: p.id }, `${p.name} removed. Their login stops working at once.`);
    setAsk(null);
  };
  const ASK = {
    link: (p) => [p.lastLogin ? `Send ${p.name} a password reset link?` : `Send ${p.name} a new invitation?`, p.lastLogin ? "Send the link" : "Send the invitation",
      p.lastLogin ? `They get a link to choose a new password${d.email ? " by email" : ""}, working for an hour. Their current password keeps working until they use it.` : `Any earlier invitation stops working. The new link works for 14 days${d.email ? " and is emailed to them" : ""}.`],
    signout: (p) => [`Log ${p.name} out everywhere?`, "Log them out", "Every device they’re logged in on goes back to the login screen. Their password doesn’t change."],
    twostep: (p) => [`Turn off two-step verification for ${p.name}?`, "Turn it off", "For a lost phone. They log in with just their password and can set two-step up again. Do this only after confirming it’s really them."],
    delete: (p) => [`Remove ${p.name}?`, "Remove them", "Their login stops working at once. Their notes and messages stay, under their name."],
  };
  return html`
    <${Head} eyebrow="Studio" title="People" actions=${admin.can("people.manage") || admin.can("staff.manage") ? html`<button class="btn primary" onClick=${() => setForm({ defaults: { clientId } })}>Invite a person</button>` : null}>
      Everyone with a login. New people get a link to choose their own password; nobody ever handles a password for them.
    <//>
    ${filter !== "roles" && admin.can("people.manage") ? html`<${Requests} admin=${admin} onLink=${setLinkOut} />` : null}
    <div class="row" style=${{ marginBottom: "18px", justifyContent: "space-between" }}>
      <div class="tabs">${[["all", "Everyone"], ["client", "Clients"], ["staff", "Staff"], ["roles", "What roles can do"]].map(([k, l]) => html`<button key=${k} class="tab-btn" aria-pressed=${filter === k} onClick=${() => setFilter(k)}>${l}</button>`)}</div>
      ${filter !== "roles" ? html`<div class="row">
        ${filter !== "staff" ? html`<select class="select" style=${{ width: "auto" }} aria-label="Client" value=${clientId} onChange=${(e) => setClientId(e.target.value)}><option value="">Every client</option>${d.clients.map((c) => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}</select>` : null}
        <input class="input" style=${{ width: "220px" }} type="search" placeholder="Find a person" aria-label="Find a person" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>` : null}
    </div>
    ${filter === "roles" ? html`<${Roles} admin=${admin} />` : html`
    <table class="table"><thead><tr><th>Person</th><th>Role</th><th>Login</th><th></th></tr></thead>
      <tbody>${list.map((p) => html`<tr key=${p.id}>
        <td><b>${p.name}</b>${p.id === user.id ? html` <span class="faint small">(you)</span>` : null}<div class="muted small">${p.email}${p.title ? " · " + p.title : ""}</div></td>
        <td><span class="pill">${p.roleLabel}</span>${p.clientName ? html` <span class="small">${p.clientName}</span>` : null}</td>
        <td class="small">${p.invited ? html`<span class="pill amber">Invited, not logged in yet</span>` : p.lastLogin ? fmtAgo(p.lastLogin) : html`<span class="muted">Never</span>`}${p.twoStep ? html` <span class="pill green" title="Two-step verification is on">2-step</span>` : null}</td>
        <td style=${{ textAlign: "right", whiteSpace: "nowrap" }}>
          ${p.id === user.id ? html`<${Link} to="/account" cls="btn ghost sm">My account<//>`
          : mayFor(p) ? html`
            <button class="btn ghost sm" onClick=${() => setForm({ person: p })}>Edit</button>
            <button class="btn ghost sm" onClick=${() => setAsk({ kind: "link", p })}>${p.lastLogin ? "Reset password" : "Resend invite"}</button>
            <${More} items=${[["Log out everywhere", () => setAsk({ kind: "signout", p })], p.twoStep && ["Turn off two-step (lost phone)", () => setAsk({ kind: "twostep", p })], ["Remove", () => setAsk({ kind: "delete", p })]].filter(Boolean)} />` : null}
        </td>
      </tr>`)}</tbody></table>
    ${!list.length ? html`<p class="muted">Nobody matches.</p>` : null}`}
    ${form ? html`<${PersonForm} admin=${admin} person=${form.person} defaults=${form.defaults} onClose=${() => setForm(null)} onLink=${(x) => { setForm(null); setLinkOut(x); }} />` : null}
    ${linkOut ? html`<${LinkSent} ...${linkOut} onClose=${() => setLinkOut(null)} />` : null}
    ${ask ? html`<${Confirm} title=${ASK[ask.kind](ask.p)[0]} yes=${ASK[ask.kind](ask.p)[1]} danger=${ask.kind === "delete"} busy=${busy} onYes=${act} onNo=${() => setAsk(null)}>${ASK[ask.kind](ask.p)[2]}<//>` : null}
  `;
}

/** A small "More" menu for row actions that are rarely needed. */
function More({ items }) {
  const [open, setOpen] = useState(false);
  return html`<span class="more">
    <button class="btn ghost sm" aria-haspopup="true" aria-expanded=${open} onClick=${() => setOpen(!open)} onBlur=${() => setTimeout(() => setOpen(false), 150)}>More ▾</button>
    ${open ? html`<span class="more-menu" role="menu">${items.map(([label, fn]) => html`<button key=${label} role="menuitem" onMouseDown=${(e) => e.preventDefault()} onClick=${() => { setOpen(false); fn(); }}>${label}</button>`)}</span>` : null}
  </span>`;
}

/** What each role may do. Owners always have everything; owner-only rows can't be granted to anyone else. */
function Roles({ admin }) {
  const { d } = admin;
  const { run, busy } = useRun(admin);
  const may = admin.can("settings.manage");
  const [perms, setPerms] = useState(() => JSON.parse(JSON.stringify(d.roles.permissions)));
  const dirty = JSON.stringify(perms) !== JSON.stringify(d.roles.permissions);
  const flip = (role, key) => setPerms({ ...perms, [role]: { ...perms[role], [key]: !perms[role][key] } });
  const groups = [...new Set(d.roles.staffPerms.map((p) => p.group))];
  const cell = (role, p) => {
    const locked = !may || role === "owner" || p.owner;
    const on = role === "owner" || (!p.owner && !!perms[role][p.key]);
    return html`<td key=${role} style=${{ textAlign: "center" }}><input type="checkbox" class="check-box" checked=${on} disabled=${locked}
      aria-label=${`${p.label}: ${role}`} onChange=${() => flip(role, p.key)} /></td>`;
  };
  return html`<div class="stack" style=${{ gap: "22px" }}>
    <p class="muted" style=${{ margin: 0, lineHeight: 1.6, maxWidth: "760px" }}>${may ? "Tick what each role may do. Owners can always do everything, so nobody can lock the studio out." : "Only owners can change these."} For clients, a project’s own switches come first: a decision maker can’t download where Downloads is off.</p>
    <div class="table-wrap"><table class="table roles-table">
      <thead><tr><th>Staff</th>${d.roles.staff.map((r) => html`<th key=${r.key} style=${{ textAlign: "center" }} title=${r.detail}>${r.label}</th>`)}</tr></thead>
      <tbody>${groups.map((g) => html`
        <tr key=${g} class="group"><td colSpan=${d.roles.staff.length + 1}>${g}</td></tr>
        ${d.roles.staffPerms.filter((p) => p.group === g).map((p) => html`<tr key=${p.key}><td><b>${p.label}</b>${p.owner ? html` <span class="faint small">· owners only</span>` : null}${p.detail ? html`<div class="muted small">${p.detail}</div>` : null}</td>${d.roles.staff.map((r) => cell(r.key, p))}</tr>`)}`)}
      </tbody>
    </table></div>
    <div class="table-wrap"><table class="table roles-table">
      <thead><tr><th>Client people</th>${d.roles.client.map((r) => html`<th key=${r.key} style=${{ textAlign: "center" }} title=${r.detail}>${r.label}</th>`)}</tr></thead>
      <tbody>${d.roles.clientPerms.map((p) => html`<tr key=${p.key}><td><b>${p.label}</b></td>${d.roles.client.map((r) => cell(r.key, p))}</tr>`)}</tbody>
    </table></div>
    ${may ? html`<div class="row">
      <button class="btn primary" disabled=${!dirty || busy} onClick=${() => run({ action: "rolesSave", roles: perms }, "Saved. It applies the next time each person loads a page.")}>Save roles</button>
      <button class="btn ghost" disabled=${!dirty || busy} onClick=${() => setPerms(JSON.parse(JSON.stringify(d.roles.permissions)))}>Discard</button>
      <button class="btn ghost" disabled=${busy} onClick=${async () => { if (await run({ action: "settingsReset", section: "roles" }, "Back to the standard roles.")) location.reload(); }}>Back to the standard roles</button>
    </div>` : null}
  </div>`;
}
