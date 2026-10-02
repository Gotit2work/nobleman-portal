// Studio → Connections: video sources (Vimeo, Frame.io, YouTube, Wistia), Notion, email, and file storage.
// Credentials go to the server once and are stored encrypted; the page never gets them back.
import { html, useApp, useState, useEffect, api, Head, Field, Modal, Confirm, Icon, copy, fmtAgo, fmtBytes, plural } from "./ui.js";
import { useRun, providerOf } from "./studio.js";

const ICON = { video: "play", tracking: "grid", email: "bottle" };

export function Connections({ admin }) {
  const { toast } = useApp();
  const { d } = admin;
  const { run, busy } = useRun(admin);
  const [adding, setAdding] = useState(null);       // provider key, or "" for the chooser
  const [editing, setEditing] = useState(null);
  const [tests, setTests] = useState({});
  const [del, setDel] = useState(null);

  // Back from "Sign in with Adobe" (api/connect.js): say how it went, then tidy the address bar.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const msg = q.get("message");
    if (msg) toast(msg, { err: !q.get("connected") });
    if (q.get("connected")) test(q.get("connected"));
    if (msg || q.get("connected")) history.replaceState(null, "", location.pathname);
  }, []);

  const test = async (id) => {
    const r = await run({ action: "connectionTest", id }, null);
    if (r) { setTests((t) => ({ ...t, [id]: r.test })); toast(r.test.ok ? "It works." : r.test.error || "It isn’t working yet.", { err: !r.test.ok && !r.test.needsSignIn }); }
  };
  const remove = async (force) => {
    try {
      await api("/api/admin", { method: "POST", body: { action: "connectionDelete", id: del.c.id, force } });
      await admin.load(); toast(`${del.c.name} removed.`); setDel(null);
    } catch (e) {
      if (/play from this connection/.test(e.message)) setDel({ ...del, inUse: e.message });
      else { toast(e.message, { err: true }); setDel(null); }
    }
  };

  const conns = d.connections;
  const of = (kind) => conns.filter((c) => (providerOf(d, c.provider) || {}).kind === kind);
  const notionConn = of("tracking")[0];
  const emailConn = of("email")[0];
  return html`
    <${Head} eyebrow="Studio" title="Connections" actions=${html`<button class="btn primary" onClick=${() => setAdding("")}>Add a connection</button>`}>
      Where videos come from, where projects are tracked, and how email goes out. Keys are stored encrypted and never shown again.
    <//>

    <section>
      <div class="sh"><span class="eyebrow"><span>Video sources</span></span></div>
      <div class="grid c2">
        ${of("video").map((c) => html`<${ConnCard} key=${c.id} c=${c} d=${d} test=${tests[c.id]} busy=${busy}
          onTest=${() => test(c.id)} onEdit=${() => setEditing(c)} onRemove=${() => setDel({ c })} admin=${admin} />`)}
        <div class="card pad stack" style=${{ gap: "10px" }}>
          <div class="row"><${Icon} name="send" size=${24} /><b>Video links</b><span class="pill green">Built in</span></div>
          <span class="muted small" style=${{ lineHeight: 1.6 }}>${(providerOf(d, "links") || {}).blurb} Choose “Video links” as a project’s source, then add each video on the project.</span>
        </div>
        ${!of("video").length ? html`<div class="card pad stack" style=${{ gap: "10px" }}>
          <b>Connect a video account</b>
          <span class="muted small" style=${{ lineHeight: 1.6 }}>Vimeo, Frame.io, YouTube, or Wistia. Projects then pick a folder, project, or playlist from it.</span>
          <div><button class="btn ghost sm" onClick=${() => setAdding("")}>Add one</button></div>
        </div>` : null}
      </div>
    </section>

    <section class="section">
      <div class="sh"><span class="eyebrow"><span>Project tracking</span></span></div>
      <${Notion} admin=${admin} conn=${notionConn} test=${notionConn && tests[notionConn.id]} onAdd=${() => setAdding("notion")}
        onTest=${() => test(notionConn.id)} onEdit=${() => setEditing(notionConn)} onRemove=${() => setDel({ c: notionConn })} />
    </section>

    <section class="section">
      <div class="sh"><span class="eyebrow"><span>Email and files</span></span></div>
      <div class="grid c2">
        ${emailConn ? html`<${ConnCard} c=${emailConn} d=${d} test=${tests[emailConn.id]} busy=${busy} admin=${admin}
            onTest=${() => test(emailConn.id)} onEdit=${() => setEditing(emailConn)} onRemove=${() => setDel({ c: emailConn })}
            extra=${html`<button class="btn ghost sm" disabled=${busy} onClick=${() => run({ action: "emailTest" }, (r) => `Test email sent to ${r.to}.`, { refresh: false })}>Send a test email</button>`} />`
          : html`<div class="card pad stack" style=${{ gap: "10px" }}>
            <div class="row"><${Icon} name="bottle" size=${24} /><b>Email</b><span class="pill amber">Off</span></div>
            <span class="muted small" style=${{ lineHeight: 1.6 }}>Without email, invitations are copied by hand and nobody hears about new versions, notes, or reminders. Connect Resend (free for small volumes) with a verified sending domain.</span>
            <div><button class="btn primary sm" onClick=${() => setAdding("resend")}>Connect email</button></div>
          </div>`}
        <div class="card pad stack" style=${{ gap: "10px" }}>
          <div class="row"><${Icon} name="send" size=${24} /><b>File storage</b>${d.blob ? html`<span class="pill green">Connected</span>` : html`<span class="pill amber">Not connected</span>`}</div>
          <span class="muted small" style=${{ lineHeight: 1.6 }}>${d.blob ? "Documents and client files are kept in a private Vercel Blob store. Downloads use links that expire after ten minutes." : "Files needs a private Vercel Blob store: Vercel → the portal project → Storage → Create → Blob (private) → connect, then redeploy. This one can’t be done from here."}</span>
        </div>
      </div>
    </section>

    ${adding !== null ? html`<${ConnForm} admin=${admin} d=${d} provider=${adding} onClose=${() => setAdding(null)}
      onDone=${(id, t) => { setAdding(null); setTests((x) => ({ ...x, [id]: t })); }} />` : null}
    ${editing ? html`<${ConnForm} admin=${admin} d=${d} conn=${editing} provider=${editing.provider} onClose=${() => setEditing(null)}
      onDone=${(id, t) => { setEditing(null); setTests((x) => ({ ...x, [id]: t })); }} />` : null}
    ${del ? html`<${Confirm} title=${`Remove ${del.c.name}?`} yes=${del.inUse ? "Remove it anyway" : "Remove it"} danger onYes=${() => remove(!!del.inUse)} onNo=${() => setDel(null)}>
      ${del.inUse || "The stored key is deleted. Nothing changes in the other service."}
    <//>` : null}
  `;
}

function Status({ c }) {
  if (c.provider === "frameio" && !c.signedIn) return html`<span class="pill amber">Needs sign-in</span>`;
  return c.status === "ok" ? html`<span class="pill green">Working</span>` : html`<span class="pill red">Not working</span>`;
}

function ConnCard({ c, d, test, busy, onTest, onEdit, onRemove, extra, admin }) {
  const prov = providerOf(d, c.provider) || {};
  const cfg = c.config || {};
  return html`<div class="card pad stack" style=${{ gap: "12px" }}>
    <div class="row"><${Icon} name=${ICON[prov.kind] || "play"} size=${24} /><b>${prov.name}</b>${c.name !== prov.name ? html`<span class="muted small">${c.name}</span>` : null}<${Status} c=${c} /></div>
    ${cfg.account ? html`<span class="small">Account: <b>${cfg.account}</b></span>` : null}
    ${c.env ? html`<span class="faint small">Set in Vercel’s environment variables, so it’s changed there, not here.</span>` : null}
    ${c.lastError && c.status !== "ok" ? html`<div class="alert small">${c.lastError}</div>` : null}
    ${c.provider === "frameio" ? html`<${FrameioSteps} c=${c} d=${d} test=${test} admin=${admin} />` : null}
    ${test ? html`<${TestResult} t=${test} />` : c.checked ? html`<span class="faint small">Checked ${fmtAgo(c.checked)}.</span>` : null}
    <div class="row" style=${{ gap: "6px" }}>
      <button class="btn ghost sm" disabled=${busy} onClick=${onTest}>Test it</button>
      ${!c.env ? html`<button class="btn ghost sm" onClick=${onEdit}>Change</button><button class="btn ghost sm" onClick=${onRemove}>Remove</button>` : null}
      ${extra || null}
    </div>
  </div>`;
}

function TestResult({ t }) {
  return html`<div class="stack" style=${{ gap: "6px" }}>
    ${t.ok ? html`<span class="check ok"><i>✓</i>Working${t.account && t.account.name ? ` · ${t.account.name}` : ""}${t.account && t.account.plan ? ` · plan: ${t.account.plan}` : ""}</span>` : t.error ? html`<span class="check no"><i>✕</i>${t.error}</span>` : null}
    ${t.scopes ? t.scopes.map((s) => html`<span key=${s.key} class=${"check small " + (s.ok ? "ok" : "no")}><i>${s.ok ? "✓" : "✕"}</i>${s.label}</span>`) : null}
    ${t.upload && t.upload.free != null ? html`<span class="muted small">Upload space left: ${fmtBytes(t.upload.free)}</span>` : null}
    ${(t.notes || []).map((n) => html`<span key=${n} class="muted small" style=${{ lineHeight: 1.55 }}>${n}</span>`)}
  </div>`;
}

/** Frame.io with Adobe sign-in: the redirect address to register, the login button, and the account choice. */
function FrameioSteps({ c, d, test, admin }) {
  const { toast } = useApp();
  const { run, busy } = useRun(admin);
  const accounts = test && test.accounts;
  return html`<div class="stack" style=${{ gap: "10px" }}>
    ${c.auth === "oauth" ? html`
      <span class="muted small" style=${{ lineHeight: 1.6 }}>In the Adobe Developer Console, the credential’s redirect URI must be exactly:</span>
      <div class="copybox"><code class="clip">${d.redirectUri}</code><button class="btn ghost sm" onClick=${() => copy(d.redirectUri, toast, "Address")}>Copy</button></div>
      <div><a class="btn ${c.signedIn ? "ghost" : "primary"} sm" href=${"/api/connect?start=" + encodeURIComponent(c.id)}>${c.signedIn ? "Sign in with Adobe again" : "Sign in with Adobe"}</a></div>` : null}
    ${accounts && accounts.length > 1 ? html`<${Field} label="Which Frame.io account">
      <select class="select" disabled=${busy} value=${(c.config && c.config.accountId) || ""} onChange=${(e) => e.target.value && run({ action: "connectionAccount", id: c.id, accountId: e.target.value }, "Account chosen.")}>
        <option value="">Choose…</option>${accounts.map((a) => html`<option key=${a.id} value=${a.id}>${a.name}</option>`)}
      </select>
    <//>` : null}
  </div>`;
}

/** Add or change a connection. Secret fields are never filled in; leaving one empty keeps the stored value. */
function ConnForm({ admin, d, conn, provider, onClose, onDone }) {
  const { toast } = useApp();
  const [key, setKey] = useState(provider || "");
  const prov = key ? providerOf(d, key) : null;
  const [name, setName] = useState(conn ? conn.name : "");
  const [vals, setVals] = useState(() => {
    const v = {};
    if (conn) { for (const [k, x] of Object.entries(conn.config || {})) v[k] = x; if (conn.auth) v.auth = conn.auth; }
    return v;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const addable = d.providers.filter((p) => !p.builtin && !(["notion", "resend"].includes(p.key) && d.connections.some((c) => c.provider === p.key && !c.env)));
  const fields = prov ? prov.fields.filter((f) => !f.when || f.when.includes(vals.auth || (prov.fields.find((x) => x.key === "auth") || {}).options?.[0]?.value)) : [];
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const values = { ...vals };
    const authField = prov.fields.find((x) => x.key === "auth");
    if (authField && !values.auth) values.auth = authField.options[0].value;
    try {
      const r = await api("/api/admin", { method: "POST", body: conn ? { action: "connectionUpdate", id: conn.id, name, values } : { action: "connectionCreate", provider: key, name, values } });
      await admin.load();
      const t = r.test || {};
      toast(t.ok ? `${prov.name} is connected.` : t.needsSignIn ? "Saved. Next: sign in with Adobe." : `Saved, but it isn’t working yet: ${t.error || "check the details."}`, { err: !t.ok && !t.needsSignIn });
      onDone(conn ? conn.id : r.id, t);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  if (!prov) return html`<${Modal} title="Add a connection" onClose=${onClose} wide>
    <div class="grid c2">${addable.map((p) => html`<button key=${p.key} class="card pad stack pick" style=${{ gap: "8px", textAlign: "left" }} onClick=${() => { setKey(p.key); setName(""); }}>
      <div class="row"><${Icon} name=${ICON[p.kind] || "play"} size=${22} /><b>${p.name}</b></div>
      <span class="muted small" style=${{ lineHeight: 1.55 }}>${p.blurb}</span>
    </button>`)}</div>
  <//>`;
  return html`<${Modal} title=${conn ? `Change ${conn.name}` : `Connect ${prov.name}`} onClose=${onClose} wide>
    <form class="stack" style=${{ gap: "16px" }} onSubmit=${submit}>
      <p class="muted small" style=${{ margin: 0, lineHeight: 1.6 }}>${prov.blurb}</p>
      ${prov.kind === "video" ? html`<${Field} label="Name in the portal (optional)" hint="Only staff see it. Useful with two accounts, like “Vimeo (Jean)”.">
        <input class="input" value=${name} placeholder=${prov.name} onInput=${(e) => setName(e.target.value)} /><//>` : null}
      ${fields.map((f) => html`<${Field} key=${f.key} label=${f.label} hint=${f.help}>
        ${f.type === "select" ? html`<select class="select" value=${vals[f.key] || f.options[0].value} onChange=${(e) => setVals({ ...vals, [f.key]: e.target.value })}>
            ${f.options.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}</select>`
          : html`<input class=${"input" + (f.secret ? " mono" : "")} type=${f.secret ? "password" : "text"} autoComplete="off" spellCheck="false"
              placeholder=${f.secret && conn ? "Saved. Leave empty to keep it." : f.placeholder || ""} value=${vals[f.key] || ""}
              onInput=${(e) => setVals({ ...vals, [f.key]: e.target.value })} />`}
      <//>`)}
      ${key === "frameio" && (vals.auth || "oauth") === "oauth" ? html`<div class="alert info small" style=${{ lineHeight: 1.6 }}>After saving, press “Sign in with Adobe” on the Frame.io card. Register this redirect URI on the credential first: <span class="mono">${d.redirectUri}</span></div>` : null}
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <div class="row">
        <button class="btn primary" disabled=${busy}>${busy ? "Checking…" : conn ? "Save and test" : "Connect and test"}</button>
        ${!conn && !provider ? html`<button type="button" class="btn ghost" onClick=${() => setKey("")}>Back</button>` : null}
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
      </div>
    </form>
  <//>`;
}

// ---------- Notion ----------
function Notion({ admin, conn, test, onAdd, onTest, onEdit, onRemove }) {
  const { d } = admin;
  const { run, busy } = useRun(admin);
  const n = d.settings.notion || {};
  const [pick, setPick] = useState(null);     // "page" | "database"
  const [stop, setStop] = useState(false);
  const synced = d.projects.filter((p) => p.notion).length;
  if (!conn) return html`<div class="card pad stack" style=${{ gap: "10px", maxWidth: "760px" }}>
    <div class="row"><${Icon} name="grid" size=${24} /><b>Notion</b><span class="pill">Off</span></div>
    <span class="muted" style=${{ lineHeight: 1.6 }}>Keep a Notion database with one row per project, updated as things happen: stage, progress, what’s waiting for review, open notes, the next milestone, and a link back here. Good for planning boards and for anyone who lives in Notion.</span>
    <ol class="steps small">
      <li>Go to app.notion.com/developers/connections → Internal connections → Create a new connection. Under Configuration, turn on Read, Update, and Insert content.</li>
      <li>Copy its API token (it starts with ntn_), then press “Connect Notion” here.</li>
      <li>In Notion, open the page that should hold the projects → ••• → Connections → add yours.</li>
    </ol>
    <div><button class="btn primary sm" onClick=${onAdd}>Connect Notion</button></div>
  </div>`;
  return html`<div class="card pad stack" style=${{ gap: "12px", maxWidth: "760px" }}>
    <div class="row"><${Icon} name="grid" size=${24} /><b>Notion</b>${conn.config && conn.config.account ? html`<span class="muted small">${conn.config.account}</span>` : null}<${Status} c=${conn} /></div>
    ${test ? html`<${TestResult} t=${test} />` : null}
    ${!n.dataSourceId ? html`
      <span style=${{ lineHeight: 1.6 }}>Where should the projects go?</span>
      <div class="row">
        <button class="btn primary sm" onClick=${() => setPick("page")}>Create a new database in a page</button>
        <button class="btn ghost sm" onClick=${() => setPick("database")}>Use a database I already have</button>
      </div>
      <span class="faint small" style=${{ lineHeight: 1.55 }}>Only pages and databases you’ve added the connection to show up (in Notion: ••• → Connections).</span>`
    : html`
      <span>Projects sync to <b>${n.title || "your database"}</b>${n.url ? html` · <a href=${n.url} target="_blank" rel="noopener">Open in Notion ↗</a>` : null}</span>
      <span class="muted small">${plural(synced, "project")} in Notion${n.lastSync ? ` · last update ${fmtAgo(n.lastSync)}` : ""}. Changes go across within seconds; the daily job catches up on anything else.</span>
      ${n.lastError ? html`<div class="alert small">Last sync failed: ${n.lastError}</div>` : null}
      <div class="row" style=${{ gap: "6px" }}>
        <button class="btn ghost sm" disabled=${busy} onClick=${() => run({ action: "notionSyncAll" }, (r) => `Syncing ${plural(r.projects, "project")} now.`)}>Sync every project now</button>
        <button class="btn ghost sm" onClick=${() => setStop(true)}>Stop syncing</button>
      </div>`}
    <div class="row" style=${{ gap: "6px" }}>
      <button class="btn ghost sm" disabled=${busy} onClick=${onTest}>Test it</button>
      <button class="btn ghost sm" onClick=${onEdit}>Change token</button>
      <button class="btn ghost sm" onClick=${onRemove}>Remove</button>
    </div>
    ${pick ? html`<${NotionPick} kind=${pick} admin=${admin} onClose=${() => setPick(null)} />` : null}
    ${stop ? html`<${Confirm} title="Stop syncing to Notion?" yes="Stop syncing" busy=${busy} onYes=${async () => { await run({ action: "notionDisconnect" }, "Stopped. The database stays in Notion as it is."); setStop(false); }} onNo=${() => setStop(false)}>
      The database and its rows stay in Notion; they just stop updating. You can choose a database again later.
    <//>` : null}
  </div>`;
}

function NotionPick({ kind, admin, onClose }) {
  const { d } = admin;
  const { run, busy } = useRun(admin);
  const [q, setQ] = useState("");
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState(`${(d.settings.brand && d.settings.brand.studio) || "Studio"} projects`);
  const search = async () => {
    setList(null); setErr("");
    try { setList((await api(`/api/admin?notion=${kind}&q=${encodeURIComponent(q)}`)).results); } catch (e) { setErr(e.message); setList([]); }
  };
  useEffect(() => { search(); }, []);
  const choose = async (r) => {
    const ok = kind === "page"
      ? await run({ action: "notionCreateDatabase", pageId: r.id, title }, "Database created. Every project is being added now.")
      : await run({ action: "notionUseDatabase", dataSourceId: r.id }, "Database chosen. Missing columns were added, and every project is being added now.");
    if (ok) onClose();
  };
  return html`<${Modal} title=${kind === "page" ? "Create the projects database in…" : "Use this database"} onClose=${onClose} wide>
    ${kind === "page" ? html`<${Field} label="Database name"><input class="input" value=${title} onInput=${(e) => setTitle(e.target.value)} /><//>` : html`<p class="muted small" style=${{ margin: 0, lineHeight: 1.6 }}>The portal adds any columns it needs (Client, Stage, Progress, Review…) and leaves your own columns alone. A column with the same name but a different type stops it; rename yours first.</p>`}
    <form class="row" onSubmit=${(e) => { e.preventDefault(); search(); }}>
      <input class="input" style=${{ flex: 1 }} type="search" placeholder=${kind === "page" ? "Find a page" : "Find a database"} value=${q} onInput=${(e) => setQ(e.target.value)} />
      <button class="btn ghost">Search</button>
    </form>
    ${err ? html`<div class="alert">${err}</div>` : null}
    ${list == null ? html`<span class="muted small">Asking Notion…</span>`
      : !list.length ? html`<p class="muted small" style=${{ lineHeight: 1.6 }}>Nothing found. In Notion, open the ${kind} → ••• → Connections → add this connection, then search again.</p>`
      : html`<div class="list">${list.map((r) => html`<div class="li" key=${r.id}><span class="grow">${r.title || "Untitled"}</span>
          <button class="btn primary sm" disabled=${busy} onClick=${() => choose(r)}>${kind === "page" ? "Create it here" : "Use this one"}</button></div>`)}</div>`}
  <//>`;
}
