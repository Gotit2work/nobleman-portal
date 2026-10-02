// Studio → Settings (owners) and Studio → Activity (the log). See studio.js for the shell.
import { html, useApp, useState, useEffect, api, Head, Field, Toggle, Confirm, fmtDate, fmtAgo } from "./ui.js";
import { useRun } from "./studio.js";

// ---------- settings ----------
export function Settings({ admin }) {
  const { d } = admin;
  const s = d.settings;
  return html`
    <${Head} eyebrow="Studio" title="Settings">Everything here applies across the portal as soon as you save each section.<//>
    <${Health} />
    <div class="stack" style=${{ gap: "16px" }}>
      <${Section} admin=${admin} section="brand" title="Studio details" value=${s.brand} render=${(v, set) => html`
        <div class="formgrid">
          <${Field} label="Studio name" hint="In emails, the sign-in screen, and share pages."><input class="input" value=${v.studio} onInput=${(e) => set({ studio: e.target.value })} /><//>
          <${Field} label="Help email" hint="Shown to clients who get stuck."><input class="input" type="email" value=${v.support} onInput=${(e) => set({ support: e.target.value })} /><//>
          <${Field} label="Website"><input class="input" value=${v.website} onInput=${(e) => set({ website: e.target.value })} placeholder="https://" /><//>
          <${Field} label="Privacy page"><input class="input" value=${v.privacy} onInput=${(e) => set({ privacy: e.target.value })} placeholder="https://" /><//>
          <${Field} label="Portal address" hint="Used in links the daily job emails, and in Notion."><input class="input" value=${v.portal} onInput=${(e) => set({ portal: e.target.value })} placeholder="https://" /><//>
        </div>
        <${Field} label="Above Messages, for clients" hint="Who they’re writing to and when to expect a reply. Promise only what’s always true.">
          <input class="input" value=${v.replies || ""} onInput=${(e) => set({ replies: e.target.value })} />
        <//>`} />

      <${Section} admin=${admin} section="signin" title="Sign-in screen" value=${s.signin} hint="A Murphy’s Law line beside the sign-in form: the risk, then how the portal handles it." render=${(v, set) => html`
        <${Field} label="Small heading"><input class="input" style=${{ maxWidth: "420px" }} value=${v.kicker} onInput=${(e) => set({ kicker: e.target.value })} /><//>
        <${Field} label="The law"><input class="input" value=${v.quote} onInput=${(e) => set({ quote: e.target.value })} /><//>
        <${Field} label="The answer"><input class="input" value=${v.answer} onInput=${(e) => set({ answer: e.target.value })} /><//>
        <figure class="law preview" aria-label="Preview">
          ${v.kicker ? html`<figcaption>${v.kicker}</figcaption>` : null}
          <blockquote>${v.quote ? `“${v.quote}”` : ""}</blockquote>
          ${v.answer ? html`<p>${v.answer}</p>` : null}
        </figure>`} />

      <${Section} admin=${admin} section="welcome" title="Welcome for new clients" value=${s.welcome} hint="Shown once on a client’s home page, the first time they sign in." render=${(v, set) => html`
        <${Field} label="Heading"><input class="input" value=${v.title} onInput=${(e) => set({ title: e.target.value })} /><//>
        <${Field} label="Text"><textarea class="textarea" rows="3" value=${v.text} onInput=${(e) => set({ text: e.target.value })}></textarea><//>`} />

      <${Section} admin=${admin} section="announcement" title="Notice for everyone" value=${s.announcement} hint="A line at the top of every page, for everyone signed in. Leave it empty for none." render=${(v, set) => html`
        <${Field} label="Notice"><input class="input" value=${v.text} onInput=${(e) => set({ text: e.target.value })} placeholder="For example: We’re filming offshore until Friday; replies may be slower." /><//>
        <div class="seg" role="group" aria-label="Tone">${[["info", "Information"], ["warning", "Important"]].map(([k, l]) => html`<button type="button" key=${k} aria-pressed=${v.tone === k} onClick=${() => set({ tone: k })}>${l}</button>`)}</div>`} />

      <${Section} admin=${admin} section="stages" title="Project stages" value=${s.stages} array hint="The steps every project moves through, with the progress each one shows. Renaming keeps projects where they are; removing a stage moves projects past the end back to the last one." render=${(v, setAll) => html`
        <div class="stack" style=${{ gap: "8px" }}>${v.map((st, i) => html`<div class="row stage-row" key=${i}>
          <span class="faint mono" style=${{ width: "22px" }}>${i + 1}</span>
          <input class="input" style=${{ flex: "1 1 200px" }} aria-label=${"Stage " + (i + 1) + " name"} value=${st.name} onInput=${(e) => setAll(v.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
          <input class="input" style=${{ width: "92px" }} type="number" min="0" max="100" aria-label=${"Stage " + (i + 1) + " progress %"} value=${st.pct} onInput=${(e) => setAll(v.map((x, j) => j === i ? { ...x, pct: Number(e.target.value) || 0 } : x))} />
          <span class="faint small">%</span>
          <button type="button" class="btn ghost sm" disabled=${i === 0} aria-label="Move up" onClick=${() => { const c = v.slice(); [c[i - 1], c[i]] = [c[i], c[i - 1]]; setAll(c); }}>↑</button>
          <button type="button" class="btn ghost sm" disabled=${i === v.length - 1} aria-label="Move down" onClick=${() => { const c = v.slice(); [c[i + 1], c[i]] = [c[i], c[i + 1]]; setAll(c); }}>↓</button>
          <button type="button" class="btn ghost sm" disabled=${v.length <= 2} onClick=${() => setAll(v.filter((_, j) => j !== i))}>Remove</button>
        </div>`)}</div>
        <div><button type="button" class="btn ghost sm" disabled=${v.length >= 10} onClick=${() => setAll(v.concat([{ name: "", pct: 100 }]))}>Add a stage</button></div>`} />

      <${Section} admin=${admin} section="caps" title="New projects start with" value=${s.caps} hint="What the client can do on a project you create from now on. Existing projects keep their own switches." render=${(v, set) => html`
        <div class="capgrid">${d.capabilities.map((c) => html`<div class="cap" key=${c.key}>
          <${Toggle} checked=${!!v[c.key] && !(c.needs && !v[c.needs])} disabled=${c.needs && !v[c.needs]} onChange=${(x) => set({ [c.key]: x })} label=${c.label} />
          <div><b>${c.label}</b><span>${c.detail}</span></div></div>`)}</div>`} />

      <${Section} admin=${admin} section="security" title="Security" value=${s.security} render=${(v, set) => html`
        <div class="capgrid">
          <div class="cap"><${Toggle} checked=${v.staffTwoStep} onChange=${(x) => set({ staffTwoStep: x })} label="Require two-step sign-in for staff" />
            <div><b>Staff must use two-step sign-in</b><span>Staff without it are asked to set it up before they can do anything. Turn it on for yourself first (your account page).</span></div></div>
          <div class="cap"><${Toggle} checked=${v.signinLinks} onChange=${(x) => set({ signinLinks: x })} label="Emailed sign-in links" />
            <div><b>“Email me a sign-in link”</b><span>Lets people sign in from a link in their inbox instead of typing a password. Needs email. Two-step sign-in still applies.</span></div></div>
          <div class="cap"><${Toggle} checked=${v.clientTeams} onChange=${(x) => set({ clientTeams: x })} label="Clients manage their own team" />
            <div><b>Decision makers manage their team</b><span>They can invite colleagues, change their roles, and remove them. You’re told each time.</span></div></div>
        </div>
        <${Field} label="Stay signed in for (days)" hint="1 to 30. After that, everyone signs in again."><input class="input" style=${{ maxWidth: "140px" }} type="number" min="1" max="30" value=${v.sessionDays} onInput=${(e) => set({ sessionDays: Number(e.target.value) || 1 })} /><//>`} />

      <${Section} admin=${admin} section="reminders" title="Review reminders" value=${s.reminders} hint="For projects with a “Review by” date and a version still waiting. Sent to the client’s decision makers by the daily job." render=${(v, set) => html`
        <div class="cap" style=${{ maxWidth: "720px" }}><${Toggle} checked=${v.enabled} onChange=${(x) => set({ enabled: x })} label="Send automatic reminders" />
          <div><b>Send automatic reminders</b><span>One email per version, not a stream of them. You can always send one by hand from the project.</span></div></div>
        <${Field} label="Days before the date" hint="0 sends it on the day."><input class="input" style=${{ maxWidth: "140px" }} type="number" min="0" max="14" value=${v.daysBefore} onInput=${(e) => set({ daysBefore: Number(e.target.value) || 0 })} /><//>`} />
    </div>
  `;
}

/** One settings section with its own Save, Discard, and Reset. */
function Section({ admin, section, title, hint, value, render, array }) {
  const { run, busy } = useRun(admin);
  const [v, setV] = useState(value);
  const [reset, setReset] = useState(false);
  useEffect(() => { setV(value); }, [JSON.stringify(value)]);
  const dirty = JSON.stringify(v) !== JSON.stringify(value);
  const set = array ? setV : (patch) => setV({ ...v, ...patch });
  return html`<section class="card pad stack" style=${{ gap: "16px" }}>
    <div class="stack" style=${{ gap: "4px" }}><div class="h3">${title}</div>${hint ? html`<span class="muted small" style=${{ lineHeight: 1.55 }}>${hint}</span>` : null}</div>
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
function Health() {
  const [h, setH] = useState(null);
  const [open, setOpen] = useState(false);
  const load = () => api("/api/admin?health=1").then(setH).catch((e) => setH({ checks: [{ label: "System check", ok: false, detail: e.message }] }));
  useEffect(() => { load(); }, []);
  if (!h) return null;
  const bad = h.checks.filter((c) => c.ok === false), warn = h.checks.filter((c) => c.ok === "warn");
  return html`<section class=${"card pad stack health " + (bad.length ? "bad" : warn.length ? "warn" : "ok")} style=${{ gap: "12px", marginBottom: "18px" }}>
    <div class="row" style=${{ justifyContent: "space-between" }}>
      <div class="stack" style=${{ gap: "4px" }}><div class="h3">System check</div>
        <span class="muted small">${bad.length ? `${bad.length} thing${bad.length === 1 ? " needs" : "s need"} fixing.` : warn.length ? `All working. ${warn.length} suggestion${warn.length === 1 ? "" : "s"}.` : "Everything is set up."}</span></div>
      <button class="btn ghost sm" aria-expanded=${open} onClick=${() => setOpen(!open)}>${open ? "Hide details" : "Show details"}</button>
    </div>
    ${open || bad.length ? html`<div class="stack" style=${{ gap: "10px" }}>${h.checks.filter((c) => open || c.ok === false).map((c) => html`<div key=${c.label} class=${"check " + (c.ok === true ? "ok" : c.ok === "warn" ? "warn" : "no")}>
      <i>${c.ok === true ? "✓" : c.ok === "warn" ? "!" : "✕"}</i><span><b>${c.label}.</b> ${c.detail}</span></div>`)}</div>` : null}
  </section>`;
}

// ---------- activity ----------
const KINDS = [["", "Everyone"], ["client", "Clients"], ["staff", "Staff"], ["system", "The portal"]];

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
    <${Head} eyebrow="Studio" title="Activity" actions=${html`<a class="btn ghost" href=${"/api/admin?audit=csv&" + qs()} download>Export to a spreadsheet</a>`}>
      Who did what, and when: sign-ins, views, downloads, approvals, changes in Studio. Kept for about 13 months.
    <//>
    <div class="row filters" style=${{ marginBottom: "16px" }}>
      <div class="tabs">${KINDS.map(([k, l]) => html`<button key=${k} class="tab-btn" aria-pressed=${f.kind === k} onClick=${() => setF({ ...f, kind: k })}>${l}</button>`)}</div>
      <select class="select" style=${{ width: "auto" }} aria-label="Client" value=${f.client} onChange=${(e) => setF({ ...f, client: e.target.value, project: "" })}>
        <option value="">Every client</option>${d.clients.map((c) => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}</select>
      <select class="select" style=${{ width: "auto" }} aria-label="Project" value=${f.project} onChange=${(e) => setF({ ...f, project: e.target.value })}>
        <option value="">Every project</option>${d.projects.filter((p) => !f.client || p.clientId === f.client).map((p) => html`<option key=${p.id} value=${p.id}>${p.title}</option>`)}</select>
      <input class="input" style=${{ width: "220px" }} type="search" placeholder="Find a name or word" aria-label="Find in the activity" value=${f.q} onInput=${(e) => setF({ ...f, q: e.target.value })} />
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
