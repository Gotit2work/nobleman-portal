// Home (your next step, your projects, the latest activity) and a single project's page.
import { html, useApp, useState, api, Icon, Head, Empty, Link, Stages, Avatar, greeting, firstName, fmtAgo, fmtDay, plural, isStaff } from "./ui.js";

const POSTER = "/media/screening-poster.jpg";

const newest = (c) => c.versions[c.versions.length - 1];
const dueText = (p) => (p.reviewDue ? ` Please review by ${fmtDay(p.reviewDue)}.` : "");

/** The one thing that needs this person now. Clients: review → confirm → messages → new film → milestone. Staff: client actions. */
export function nextStep(data) {
  const admin = isStaff(data.user);
  const ps = data.projects;
  // People waiting to be let in come first: they're standing at the door.
  if (admin && data.signups) return { title: `${data.signups === 1 ? "Someone is" : data.signups + " people are"} asking to join.`, text: "They created an account and confirmed their email. Choose their company and role, or decline.", btn: data.signups === 1 ? "Review the request" : "Review the requests", to: "/studio/people" };
  if (!ps.length) {
    return admin
      ? { title: "Add your first project.", text: "Create a client, choose where its videos come from, and set what they can do. They see it the moment they log in.", btn: "Open Studio", to: "/studio/projects" }
      : { title: "Your project is being set up.", text: "The studio is getting it ready. It appears here as soon as it’s set up; you don’t need to do anything yet." };
  }
  if (admin) {
    for (const p of ps) for (const c of p.cuts) {
      const v = newest(c);
      if (v.decision && v.decision.decision === "changes") return { title: `${p.clientName} asked for changes to ${c.title}.`, text: `On Version ${v.n}: “${v.decision.note}”`, btn: "Open the notes", to: `/review/${p.id}/${encodeURIComponent(c.key)}/${v.n}` };
    }
    const unread = ps.find((p) => p.messages && p.messages.unread);
    if (unread) return { title: `New message from ${unread.clientName}.`, text: `About ${unread.title}.`, btn: "Read it", to: `/messages/${unread.id}` };
    const notes = ps.find((p) => p.cuts.some((c) => newest(c).comments.open));
    if (notes) return { title: `${notes.clientName} left notes on ${notes.title}.`, text: "Open the version to see each note at its moment in the film.", btn: "See the notes", to: `/review/${notes.id}` };
    return { title: "Nothing needs you right now.", text: "Clients’ notes, decisions, and messages show up here first.", btn: "Open Studio", to: "/studio/projects" };
  }
  for (const p of ps) if (p.caps.review) for (const c of p.cuts) {
    const v = newest(c);
    if (!v.decision) return {
      title: `${c.total > 1 ? `Version ${v.n}` : "The first version"} of ${c.title} is ready for you.`,
      text: (p.caps.approve ? "Watch it, leave a note on anything you’d change, then approve it or ask for changes." : p.caps.notes ? "Watch it and leave a note on anything you’d change. Your company’s decision maker approves it." : "Watch it here.") + (p.caps.approve ? dueText(p) : ""),
      btn: `Watch Version ${v.n}`, to: `/review/${p.id}/${encodeURIComponent(c.key)}/${v.n}`,
    };
  }
  const confirm = ps.find((p) => p.next.confirm && !p.next.confirmedAt && p.caps.approve);
  if (confirm) return { title: `Please confirm: ${confirm.next.label || "next step"}${confirm.next.date ? ", " + confirm.next.date : ""}.`, text: confirm.next.what || confirm.title, confirm: confirm.id };
  const unread = ps.find((p) => p.messages && p.messages.unread);
  if (unread) return { title: `New message about ${unread.title}.`, text: "The studio wrote to you.", btn: "Read the message", to: `/messages/${unread.id}` };
  for (const p of ps) {
    const f = p.films[0];
    if (f && Date.now() - Date.parse(f.created) < 21 * 86400e3) return { title: `${f.title} is ready.`, text: "Your finished film is in Films.", btn: "Watch it", to: `/films/${p.id}/${f.id}` };
  }
  const p = ps[0];
  if (p.next.what || p.next.date) return { title: `Next: ${p.next.what || p.stageName}`, text: p.next.date ? `${p.next.label || "Expected"}: ${p.next.date}.` : "", btn: "See the project", to: `/projects/${p.id}` };
  return { title: "Nothing needs you right now.", text: "The next thing that needs you will show up here.", btn: p.caps.messages ? "Message the studio" : null, to: `/messages/${p.id}` };
}

/** The client confirms the next milestone. */
function ConfirmButton({ projectId, label = "Confirm" }) {
  const { reload, say, toast, demo } = useApp();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (demo) return say("", "in the real portal this tells the studio you confirmed.");
    setBusy(true);
    try { await api("/api/portal", { method: "POST", body: { action: "confirmNext", projectId } }); toast("Confirmed. The studio has been told."); reload(); }
    catch (e) { toast(e.message, { err: true }); setBusy(false); }
  };
  return html`<button class="btn primary lg" disabled=${busy} onClick=${go}>${busy ? "One moment…" : label}</button>`;
}

function NextCard({ step }) {
  return html`<section class="next" aria-label="Your next step" data-reveal="">
    <div>
      <span class="eyebrow"><span>Your next step</span><span class="dot"></span></span>
      <div class="title">${step.title}</div>
      ${step.text ? html`<p>${step.text}</p>` : null}
    </div>
    ${step.confirm ? html`<${ConfirmButton} projectId=${step.confirm} label="Confirm it" />` : step.btn ? html`<${Link} to=${step.to} cls="btn primary lg">${step.btn} →<//>` : null}
  </section>`;
}

/** Shown once, the first time a client opens the portal. */
function Welcome({ w }) {
  const { setData, demo } = useApp();
  const close = () => {
    setData((d) => ({ ...d, welcome: null }));
    if (!demo) api("/api/session", { method: "POST", body: { action: "profile", welcomed: true } }).catch(() => {});
  };
  return html`<section class="welcome" data-reveal="">
    <div class="stack" style=${{ gap: "8px" }}>
      <span class="eyebrow"><span>Welcome</span><span class="dot"></span></span>
      <div class="title">${w.title}</div>
      <p>${w.text}</p>
    </div>
    <ol class="how">
      <li><b>Watch</b><span>The newest version is always the one on screen.</span></li>
      <li><b>Note</b><span>Pause anywhere and write what you’d change. It’s pinned to that moment.</span></li>
      <li><b>Approve</b><span>When it’s right, approve it. Or ask for changes in one go.</span></li>
    </ol>
    <button class="btn ghost sm" onClick=${close}>Got it</button>
  </section>`;
}

const awaiting = (p) => p.caps.review ? p.cuts.filter((c) => !newest(c).decision).length : 0;

export function ProjectCard({ p, admin }) {
  const { data } = useApp();
  const wait = awaiting(p);
  return html`<${Link} to=${"/projects/" + p.id} cls="pcard" label=${p.title}>
    <div class="img">
      <img src=${p.cover || POSTER} alt="" loading="lazy" onError=${(e) => { e.target.onerror = null; e.target.src = POSTER; }} />
      <div class="over">
        <div class="stack" style=${{ gap: "6px" }}>
          <span class="eyebrow" style=${{ color: "rgba(244,244,242,.78)" }}>${admin ? p.clientName + " · " : ""}${p.type || "Project"}</span>
          <span class="h2">${p.title}</span>
        </div>
        <span class="pct">${p.pct}<small>%</small></span>
      </div>
    </div>
    <div class="body">
      <${Stages} stage=${p.stage} names=${data.stages} short />
      <div class="row small muted" style=${{ gap: "8px 18px" }}>
        ${p.next.what || p.next.date ? html`<span><b style=${{ color: "var(--ink)" }}>${p.next.label || "Next"}:</b> ${[p.next.what, p.next.date].filter(Boolean).join(" · ")}</span>` : html`<span>Now: ${p.stageName}</span>`}
        ${wait ? html`<span class="pill red">${admin ? `${plural(wait, "version")} waiting on ${p.clientName}` : `${plural(wait, "version")} to review`}</span>` : null}
        ${!admin && wait && p.reviewDue ? html`<span class="pill">Review by ${fmtDay(p.reviewDue)}</span>` : null}
        ${admin && p.status.key === "changes" ? html`<span class="pill amber">Changes requested</span>` : null}
        ${p.messages && p.messages.unread ? html`<span class="pill red">${plural(p.messages.unread, "new message")}</span>` : null}
      </div>
    </div>
  <//>`;
}

function describe(a) {
  const staff = a.role === "admin";
  if (a.log) {
    const to = a.projectId ? (/^(approved|changes|note|watched)/.test(a.type) ? `/review/${a.projectId}` : a.type === "downloaded" ? `/films/${a.projectId}` : a.type.startsWith("message") ? `/messages/${a.projectId}` : `/projects/${a.projectId}`)
      : /^signup/.test(a.type) ? "/studio/people" : "/studio/activity";
    // Things the portal did by itself (a sign-up arriving, a reminder) read as plain sentences.
    return { icon: "send", line: a.who && a.who !== "Portal" ? `${a.who}: ${a.text}` : a.text, text: "", to };
  }
  switch (a.type) {
    case "comment": return { icon: "play", line: `${a.who} left a note`, text: a.text, to: `/review/${a.projectId}` };
    case "approved": return { icon: "play", line: `${a.who} approved a version`, text: "", to: `/review/${a.projectId}` };
    case "changes": return { icon: "play", line: `${a.who} asked for changes`, text: a.text, to: `/review/${a.projectId}` };
    case "message": return { icon: "bottle", line: `${a.who}${staff ? " (studio)" : ""} sent a message`, text: a.text, to: `/messages/${a.projectId}` };
    case "document": return { icon: "send", line: `The studio added a file`, text: a.text, to: `/files/${a.projectId}` };
    case "video": return { icon: "send", line: `${a.who} sent a video`, text: a.text, to: `/files/${a.projectId}` };
    default: return { icon: "send", line: `${a.who} sent a file`, text: a.text, to: `/files/${a.projectId}` };
  }
}

export function Activity({ items, limit = 8 }) {
  if (!items.length) return html`<p class="muted">Nothing yet. Notes, approvals, messages, and files will show up here as they happen.</p>`;
  return html`<div class="list">${items.slice(0, limit).map((a, i) => {
    const d = describe(a);
    return html`<${Link} key=${i} to=${d.to} cls="li" label=${d.line}>
      <${Avatar} name=${a.who} staff=${a.role === "admin"} />
      <div class="grow">
        <div class="name" style=${{ fontWeight: 500 }}>${d.line}${a.projectTitle ? html` <span class="muted">· ${a.projectTitle}</span>` : null}</div>
        ${d.text ? html`<div class="meta" style=${{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${d.text}</div>` : null}
      </div>
      <span class="faint small" style=${{ whiteSpace: "nowrap" }}>${fmtAgo(a.at)}</span>
    <//>`;
  })}</div>`;
}

/** Staff: what's waiting on clients, and on the studio, across every project. */
function StaffBoard({ projects }) {
  const onClient = [], onUs = [];
  for (const p of projects) for (const c of p.cuts) {
    const v = newest(c);
    if (!v.decision) onClient.push({ p, c, v, since: v.video.created });
    else if (v.decision.decision === "changes") onUs.push({ p, c, v, since: v.decision.at, what: "Changes requested" });
    if (v.comments.open && !(v.decision && v.decision.decision === "changes")) onUs.push({ p, c, v, since: v.video.created, what: plural(v.comments.open, "open note") });
  }
  for (const p of projects) if (p.messages && p.messages.unread) onUs.push({ p, msg: true, what: plural(p.messages.unread, "unread message") });
  if (!onClient.length && !onUs.length) return null;
  const row = (x, i) => html`<${Link} key=${i} to=${x.msg ? `/messages/${x.p.id}` : `/review/${x.p.id}/${encodeURIComponent(x.c.key)}/${x.v.n}`} cls="li">
    <div class="grow"><div class="name">${x.msg ? x.p.title : `${x.c.title}, Version ${x.v.n}`} <span class="muted">· ${x.p.clientName}</span></div>
      <div class="meta">${x.what || (x.p.reviewDue ? `Review by ${fmtDay(x.p.reviewDue)}` : "Waiting for review")}${x.since ? " · " + fmtAgo(x.since) : ""}${!x.what && x.p.remindedAt ? " · reminded " + fmtAgo(x.p.remindedAt) : ""}</div></div>
    <span aria-hidden="true">→</span>
  <//>`;
  return html`<section class="section"><div class="grid c2 board">
    <div><div class="sh"><span class="eyebrow"><span>Needs the studio</span></span><span class="muted small">${onUs.length}</span></div>
      ${onUs.length ? html`<div class="list">${onUs.slice(0, 8).map(row)}</div>` : html`<p class="muted">Nothing. Nice.</p>`}</div>
    <div><div class="sh"><span class="eyebrow"><span>Waiting on clients</span></span><span class="muted small">${onClient.length}</span></div>
      ${onClient.length ? html`<div class="list">${onClient.slice(0, 8).map(row)}</div>` : html`<p class="muted">No versions waiting.</p>`}</div>
  </div></section>`;
}

export function Home() {
  const { data, user, demo } = useApp();
  const admin = isStaff(user);
  const step = nextStep(data);
  const brand = data.brand || {};
  return html`<div class="page">
    <${Head} eyebrow=${admin ? `Studio · ${brand.studio || "Nobleman Productions"}` : html`${user.clientLogo ? html`<img class="client-logo" src=${user.clientLogo} alt="" />` : null}${user.clientName || "Client portal"}`} title=${`${greeting()}, ${firstName(user.name)}.`}>
      ${admin ? "Here’s what’s happening across your clients." : demo ? "Here’s where your production stands. (A sample project: click anything.)" : "Here’s where your production stands."}
    <//>
    ${!admin && data.welcome ? html`<${Welcome} w=${data.welcome} />` : null}
    <${NextCard} step=${step} />
    ${admin ? html`<${StaffBoard} projects=${data.projects} />` : null}
    ${data.projects.length ? html`<section class="section">
      <div class="sh"><span class="eyebrow"><span>${admin ? "Active projects" : data.projects.length > 1 ? "Your projects" : "Your project"}</span></span>
        ${admin ? html`<${Link} to="/studio/projects" cls="btn ghost sm">Manage in Studio<//>` : null}</div>
      <div class=${data.projects.length > 1 ? "grid c2" : "solo"}>${data.projects.map((p) => html`<div data-reveal="card" key=${p.id}><${ProjectCard} p=${p} admin=${admin} /></div>`)}</div>
    </section>` : null}
    <section class="section">
      <div class="sh"><span class="eyebrow"><span>${admin ? "What clients and the team did lately" : "Latest"}</span></span>
        ${admin && user.perms && user.perms["audit.view"] ? html`<${Link} to="/studio/activity" cls="btn ghost sm">Full activity log<//>` : null}</div>
      <${Activity} items=${data.activity} limit=${admin ? 12 : 8} />
    </section>
  </div>`;
}

export function Project({ id }) {
  const { data, user } = useApp();
  const admin = isStaff(user);
  const p = data.projects.find((x) => x.id === id);
  if (!p) return html`<div class="page"><${Empty} title="That project isn’t here." action=${html`<${Link} to="/" cls="btn primary">Go to Home<//>`}>It may have been archived, or the link is old.<//></div>`;
  const wait = awaiting(p);
  const tiles = [];
  if (p.caps.review) tiles.push({ to: `/review/${p.id}`, icon: "play", t: "Review", d: p.cuts.length ? `${plural(p.cuts.length, "film")} in review${wait ? `, ${wait} waiting for ${admin ? "the client" : "you"}` : ""}` : "No versions yet" });
  tiles.push({ to: `/films/${p.id}`, icon: "growth", t: "Films", d: p.films.length ? plural(p.films.length, "finished film") : "None delivered yet" });
  if (p.caps.files || p.caps.upload) tiles.push({ to: `/files/${p.id}`, icon: "send", t: "Files", d: p.files.length + p.videoUploads.length ? plural(p.files.length + p.videoUploads.length, "file") : "No files yet" });
  if (p.caps.messages) tiles.push({ to: `/messages/${p.id}`, icon: "bottle", t: "Messages", d: p.messages.unread ? plural(p.messages.unread, "new message") : p.messages.total ? plural(p.messages.total, "message") : "Start a conversation" });
  return html`<div class="page">
    <div class="pcard" style=${{ cursor: "default", marginBottom: "28px" }}>
      <div class="img" style=${{ aspectRatio: "21 / 8" }}>
        <img src=${p.cover || POSTER} alt="" onError=${(e) => { e.target.onerror = null; e.target.src = POSTER; }} />
        <div class="over" style=${{ left: "clamp(20px,3vw,40px)", right: "clamp(20px,3vw,40px)", bottom: "clamp(18px,3vw,36px)" }}>
          <div class="stack" style=${{ gap: "10px" }}>
            <span class="eyebrow" style=${{ color: "rgba(244,244,242,.8)" }}>${p.clientName} · ${p.type || "Project"}</span>
            <h1 class="h1">${p.title}</h1>
          </div>
          <span class="pct" style=${{ fontSize: "56px" }}>${p.pct}<small>%</small></span>
        </div>
      </div>
      <div class="body" style=${{ padding: "22px clamp(20px,3vw,40px) 26px" }}>
        <${Stages} stage=${p.stage} names=${data.stages} />
        <div class="row" style=${{ justifyContent: "space-between" }}>
          <span class="muted">${p.next.what || p.next.date ? html`<b style=${{ color: "var(--ink)" }}>${p.next.label || "Next"}:</b> ${[p.next.what, p.next.date].filter(Boolean).join(" · ")}` : html`Now: <b style=${{ color: "var(--ink)" }}>${p.stageName}</b>`}
            ${p.next.confirm && p.next.confirmedAt ? html` <span class="pill green">Confirmed by ${p.next.confirmedBy}</span>` : null}</span>
          ${admin ? html`<${Link} to=${"/studio/projects/" + p.id} cls="btn ghost sm">Edit in Studio<//>`
            : p.next.confirm && !p.next.confirmedAt && p.caps.approve ? html`<${ConfirmButton} projectId=${p.id} />` : null}
        </div>
      </div>
    </div>
    ${p.summary ? html`<p class="lead" style=${{ marginBottom: "28px", maxWidth: "820px" }}>${p.summary}</p>` : null}
    ${p.videosError ? html`<div class="alert" style=${{ marginBottom: "20px" }}>${p.videosError}</div>` : null}
    ${admin && !p.source ? html`<div class="alert info" style=${{ marginBottom: "20px" }}>This project has no video source yet, so it has no versions or films. <${Link} to=${"/studio/projects/" + p.id} cls="link">Choose one in Studio<//>.</div>` : null}
    ${!admin && p.reviewDue && awaiting(p) ? html`<div class="alert info" style=${{ marginBottom: "20px" }}>The studio planned your review by <b>${fmtDay(p.reviewDue)}</b>, to keep the schedule on track.</div>` : null}
    <div class="grid c4">${tiles.map((t) => html`<div data-reveal="card" key=${t.t}><${Link} to=${t.to} cls="tile"><${Icon} name=${t.icon} size=${30} /><b>${t.t}</b><span>${t.d}</span><//></div>`)}</div>
    <section class="section">
      <div class="sh"><span class="eyebrow"><span>Latest on this project</span></span></div>
      <${Activity} items=${data.activity.filter((a) => a.projectId === p.id)} />
    </section>
  </div>`;
}
