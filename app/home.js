// Home (your next step, your projects, the latest activity) and a single project's page.
import { html, useApp, Icon, Head, Empty, Link, Stages, Avatar, greeting, firstName, fmtAgo, plural } from "./ui.js";

const POSTER = "/media/screening-poster.jpg";

/** The one thing that needs this person now. Clients: review → messages → new film → milestone. Staff: client actions. */
export function nextStep(data) {
  const admin = data.user.role === "admin";
  const ps = data.projects;
  if (!ps.length) {
    return admin
      ? { title: "Add your first project.", text: "Create a client, link their Vimeo folder, and choose what they can do. They see it the moment they sign in.", btn: "Open Studio", to: "/studio/projects" }
      : { title: "Your project is being set up.", text: "Nobleman is getting it ready. It appears here as soon as it’s set up; you don’t need to do anything yet." };
  }
  if (admin) {
    for (const p of ps) for (const c of p.cuts) {
      const v = c.versions[c.versions.length - 1];
      if (v.decision && v.decision.decision === "changes") return { title: `${p.clientName} asked for changes to ${c.title}.`, text: `On Version ${v.n}: “${v.decision.note}”`, btn: "Open the notes", to: `/review/${p.id}/${encodeURIComponent(c.key)}/${v.n}` };
    }
    const unread = ps.find((p) => p.messages && p.messages.unread);
    if (unread) return { title: `New message from ${unread.clientName}.`, text: `About ${unread.title}.`, btn: "Read it", to: `/messages/${unread.id}` };
    const notes = ps.find((p) => p.cuts.some((c) => c.versions.some((v) => v.comments.open)));
    if (notes) return { title: `${notes.clientName} left notes on ${notes.title}.`, text: "Open the version to see each note at its moment in the film.", btn: "See the notes", to: `/review/${notes.id}` };
    return { title: "Nothing needs you right now.", text: "Clients’ notes, decisions, and messages show up here first.", btn: "Open Studio", to: "/studio/projects" };
  }
  for (const p of ps) if (p.caps.review) for (const c of p.cuts) {
    const v = c.versions[c.versions.length - 1];
    if (!v.decision) return {
      title: `Version ${v.n} of ${c.title} is ready for you.`,
      text: p.caps.approve ? "Watch it, leave a note on anything you’d change, then approve it or ask for changes." : "Watch it and leave a note on anything you’d change.",
      btn: `Review Version ${v.n}`, to: `/review/${p.id}/${encodeURIComponent(c.key)}/${v.n}`,
    };
  }
  const unread = ps.find((p) => p.messages && p.messages.unread);
  if (unread) return { title: `New message about ${unread.title}.`, text: "Nobleman wrote to you.", btn: "Read the message", to: `/messages/${unread.id}` };
  for (const p of ps) {
    const f = p.films[0];
    if (f && Date.now() - Date.parse(f.created) < 21 * 86400e3) return { title: `${f.title} is ready.`, text: "Your finished film is in Films.", btn: "Watch it", to: `/films/${p.id}/${f.id}` };
  }
  const p = ps[0];
  if (p.next.what || p.next.date) return { title: `Next: ${p.next.what || p.stageName}`, text: p.next.date ? `${p.next.label || "Expected"}: ${p.next.date}.` : "", btn: "See the project", to: `/projects/${p.id}` };
  return { title: "Nothing needs you right now.", text: "The next thing that needs you will show up here.", btn: p.caps.messages ? "Message Nobleman" : null, to: `/messages/${p.id}` };
}

function NextCard({ step }) {
  return html`<section class="next" aria-label="Your next step" data-reveal="">
    <div>
      <span class="eyebrow"><span>Your next step</span><span class="dot"></span></span>
      <div class="title">${step.title}</div>
      ${step.text ? html`<p>${step.text}</p>` : null}
    </div>
    ${step.btn ? html`<${Link} to=${step.to} cls="btn primary lg">${step.btn} →<//>` : null}
  </section>`;
}

const awaiting = (p) => p.caps.review ? p.cuts.filter((c) => !c.versions[c.versions.length - 1].decision).length : 0;

export function ProjectCard({ p, admin }) {
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
      <${Stages} stage=${p.stage} names=${["Planning", "Filming", "Editing", "Your review", "Final polish", "Delivered"]} short />
      <div class="row small muted" style=${{ gap: "8px 18px" }}>
        ${p.next.what || p.next.date ? html`<span><b style=${{ color: "var(--ink)" }}>${p.next.label || "Next"}:</b> ${[p.next.what, p.next.date].filter(Boolean).join(" · ")}</span>` : html`<span>Now: ${p.stageName}</span>`}
        ${wait ? html`<span class="pill red">${plural(wait, "version")} to review</span>` : null}
        ${p.messages && p.messages.unread ? html`<span class="pill red">${plural(p.messages.unread, "new message")}</span>` : null}
      </div>
    </div>
  <//>`;
}

function describe(a) {
  const staff = a.role === "admin";
  switch (a.type) {
    case "comment": return { icon: "play", line: `${a.who} left a note`, text: a.text, to: `/review/${a.projectId}` };
    case "approved": return { icon: "play", line: `${a.who} approved a version`, text: "", to: `/review/${a.projectId}` };
    case "changes": return { icon: "play", line: `${a.who} asked for changes`, text: a.text, to: `/review/${a.projectId}` };
    case "message": return { icon: "bottle", line: `${a.who}${staff ? " (Nobleman)" : ""} sent a message`, text: a.text, to: `/messages/${a.projectId}` };
    case "document": return { icon: "send", line: `Nobleman added a file`, text: a.text, to: `/files/${a.projectId}` };
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
        <div class="name" style=${{ fontWeight: 500 }}>${d.line} <span class="muted">· ${a.projectTitle}</span></div>
        ${d.text ? html`<div class="meta" style=${{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${d.text}</div>` : null}
      </div>
      <span class="faint small" style=${{ whiteSpace: "nowrap" }}>${fmtAgo(a.at)}</span>
    <//>`;
  })}</div>`;
}

export function Home() {
  const { data, user, demo } = useApp();
  const admin = user.role === "admin";
  const step = nextStep(data);
  return html`<div class="page">
    <${Head} eyebrow=${admin ? "Studio · Nobleman Productions" : (user.clientName || "Client portal")} title=${`${greeting()}, ${firstName(user.name)}.`}>
      ${admin ? "Here’s what’s happening across your clients." : demo ? "Here’s where your production stands. (A sample project: click anything.)" : "Here’s where your production stands."}
    <//>
    <${NextCard} step=${step} />
    ${data.projects.length ? html`<section class="section">
      <div class="sh"><span class="eyebrow"><span>${admin ? "Active projects" : data.projects.length > 1 ? "Your projects" : "Your project"}</span></span>
        ${admin ? html`<${Link} to="/studio/projects" cls="btn ghost sm">Manage in Studio<//>` : null}</div>
      <div class=${data.projects.length > 1 ? "grid c2" : "solo"}>${data.projects.map((p) => html`<div data-reveal="card" key=${p.id}><${ProjectCard} p=${p} admin=${admin} /></div>`)}</div>
    </section>` : null}
    <section class="section">
      <div class="sh"><span class="eyebrow"><span>Latest</span></span></div>
      <${Activity} items=${data.activity} />
    </section>
  </div>`;
}

export function Project({ id }) {
  const { data, user } = useApp();
  const admin = user.role === "admin";
  const p = data.projects.find((x) => x.id === id);
  if (!p) return html`<div class="page"><${Empty} title="That project isn’t here." action=${html`<${Link} to="/" cls="btn primary">Go to Home<//>`}>It may have been archived, or the link is old.<//></div>`;
  const versions = p.cuts.reduce((n, c) => n + c.versions.length, 0);
  const wait = awaiting(p);
  const tiles = [];
  if (p.caps.review) tiles.push({ to: `/review/${p.id}`, icon: "play", t: "Review", d: versions ? `${plural(versions, "version")}${wait ? `, ${wait} waiting for you` : ""}` : "No versions yet" });
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
          <span class="muted">${p.next.what || p.next.date ? html`<b style=${{ color: "var(--ink)" }}>${p.next.label || "Next"}:</b> ${[p.next.what, p.next.date].filter(Boolean).join(" · ")}` : html`Now: <b style=${{ color: "var(--ink)" }}>${p.stageName}</b>`}</span>
          ${admin ? html`<${Link} to=${"/studio/projects/" + p.id} cls="btn ghost sm">Edit in Studio<//>` : null}
        </div>
      </div>
    </div>
    ${p.summary ? html`<p class="lead" style=${{ marginBottom: "28px", maxWidth: "820px" }}>${p.summary}</p>` : null}
    ${p.videosError ? html`<div class="alert" style=${{ marginBottom: "20px" }}>${p.videosError}</div>` : null}
    ${admin && !p.vimeoLinked ? html`<div class="alert info" style=${{ marginBottom: "20px" }}>No Vimeo folder is linked yet, so this project has no versions or films. <${Link} to=${"/studio/projects/" + p.id} cls="link">Link one in Studio<//>.</div>` : null}
    <div class="grid c4">${tiles.map((t) => html`<div data-reveal="card" key=${t.t}><${Link} to=${t.to} cls="tile"><${Icon} name=${t.icon} size=${30} /><b>${t.t}</b><span>${t.d}</span><//></div>`)}</div>
    <section class="section">
      <div class="sh"><span class="eyebrow"><span>Latest on this project</span></span></div>
      <${Activity} items=${data.activity.filter((a) => a.projectId === p.id)} />
    </section>
  </div>`;
}
