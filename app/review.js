// Review: watch the newest version, pin notes to moments, then approve or ask for changes. Clients see only the
// newest version of each film (unless the project shows earlier versions); staff see them all.
import { html, useApp, useState, useEffect, useRef, api, Head, Empty, Link, Player, Avatar, Confirm, Modal, Field, tc, fmtAgo, fmtDate, fmtDay, plural, isStaff } from "./ui.js";

const decisionLabel = (d) => (d.decision === "approved" ? (d.note ? "Approved with small fixes" : "Approved") : "Changes asked");

export function Review({ pid, cut, n }) {
  const app = useApp();
  const { data, user, demo, go } = app;
  const admin = isStaff(user);
  const ps = data.projects.filter((p) => p.caps.review && p.cuts.length);
  if (!data.projects.some((p) => p.caps.review)) {
    return html`<div class="page"><${Empty} icon="play" title="Review isn’t switched on.">Ask the studio if you’d like to review versions here.<//></div>`;
  }
  if (!ps.length) {
    return html`<div class="page">
      <${Head} eyebrow="Review" title="Nothing to review yet.">When the studio shares a version of your film, it appears here. You’ll be able to pause on any moment and leave a note right there.<//>
      ${admin ? html`<p class="muted">Versions come from each project’s video source: a video titled with a version number (“Harbor Spot V2”), or a Frame.io version stack, shows up here.</p>` : null}
    </div>`;
  }
  const waiting = (p) => p.cuts.some((c) => !c.versions[c.versions.length - 1].decision);
  const p = ps.find((x) => x.id === pid) || ps.find(waiting) || ps[0];
  const key = cut ? decodeURIComponent(cut) : null;
  const c = p.cuts.find((x) => x.key === key) || p.cuts.find((x) => !x.versions[x.versions.length - 1].decision) || p.cuts[0];
  const latest = c.versions[c.versions.length - 1];
  const v = c.versions.find((x) => String(x.n) === String(n)) || latest;
  const to = (pp, cc, nn) => `/review/${pp.id}/${encodeURIComponent(cc.key)}/${nn}`;

  return html`<div class="page wide">
    <${Head} eyebrow=${p.title} title=${html`Review <span class="np-it">${c.title}</span>`}>
      ${!p.caps.notes ? "Watch the newest version here." : html`Watch it, pause anywhere, and leave a note on that exact moment.${p.caps.approve && !admin ? " When it’s right, approve it." : ""}`}
    <//>
    ${ps.length > 1 ? html`<div class="tabs" style=${{ marginBottom: "14px" }} aria-label="Projects">${ps.map((x) => html`<${Link} key=${x.id} to=${"/review/" + x.id} cls="tab-btn" current=${x.id === p.id}>${x.title}${waiting(x) ? html`<span class="d" aria-label="waiting for you"></span>` : null}<//>`)}</div>` : null}
    ${p.cuts.length > 1 ? html`<div class="tabs" style=${{ marginBottom: "18px" }} aria-label="Films in review">${p.cuts.map((x) => {
      const last = x.versions[x.versions.length - 1];
      return html`<${Link} key=${x.key} to=${to(p, x, last.n)} cls="tab-btn" current=${x.key === c.key}>${x.title}${!last.decision ? html`<span class="d" aria-label="waiting for you"></span>` : null}<//>`;
    })}</div>` : null}
    <${Stage} p=${p} c=${c} v=${v} latest=${latest} key=${v.video.id} />
  </div>`;
}

/** Player, version chips, decision, and the notes panel for one version. Keyed by video, so it resets per version. */
function Stage({ p, c, v, latest }) {
  const app = useApp();
  const { user, demo, go, toast, say, reload, setData, data } = app;
  const admin = isStaff(user);
  const player = useRef(null);
  const [fixes, setFixes] = useState("");
  const [time, setTime] = useState(0);
  const [notes, setNotes] = useState(demo ? (p.notes && p.notes[v.video.id]) || [] : null);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState("");
  const [at, setAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState("all");
  const [confirming, setConfirming] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askNote, setAskNote] = useState("");

  const load = async () => {
    if (demo) return;
    try { setNotes((await api(`/api/portal?notes=${p.id}&video=${v.video.id}`)).notes); setErr(""); }
    catch (e) { setErr(e.message); setNotes([]); }
  };
  useEffect(() => { load(); }, [v.video.id]);

  // Some players (Google Drive, Loom) can't say where they are: those notes are about the whole version.
  const timed = !player.current || player.current.timed !== false;
  const stamp = timed ? (at == null ? time : at) : null;
  const post = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      if (demo) {
        setNotes((ns) => ns.concat([{ id: "d" + Date.now(), at: stamp, body, author: user.name, role: user.role, mine: true, canRemove: true, resolved: false, when: new Date().toISOString(), replies: [] }]).sort((a, b) => (a.at ?? 1e9) - (b.at ?? 1e9)));
        say("", `your note${stamp != null ? " at " + tc(stamp) : ""} was added here, but not sent to the studio.`);
      } else {
        await api("/api/portal", { method: "POST", body: { action: "note", projectId: p.id, videoId: v.video.id, at: stamp, body } });
        await load(); reload();
        toast(admin ? `Note added${stamp != null ? " at " + tc(stamp) : ""}.` : `Note added${stamp != null ? " at " + tc(stamp) : ""}. The studio will see it.`);
      }
      setDraft(""); setAt(null);
      if (player.current) player.current.play();
    } catch (e) { toast(e.message, { err: true }); }
    setBusy(false);
  };

  const decide = async (decision, note) => {
    setBusy(true);
    try {
      const dec = demo
        ? { decision, note: note || "", by: user.name, at: new Date().toISOString() }
        : (await api("/api/portal", { method: "POST", body: { action: "decide", projectId: p.id, videoId: v.video.id, decision, note } })).decision;
      if (demo) {
        setData((d) => ({ ...d, projects: d.projects.map((x) => x.id !== p.id ? x : { ...x, cuts: x.cuts.map((cc) => cc.key !== c.key ? cc : { ...cc, versions: cc.versions.map((vv) => vv.n === v.n ? { ...vv, decision: dec } : vv) }) }) }));
        say("", decision === "approved" ? `in the real portal, the studio would be told you approved Version ${v.n}, and you’d get a receipt by email.` : "in the real portal, the studio would get your list of changes.");
      } else {
        await reload();
        toast(decision === "approved" ? `You approved Version ${v.n}. The studio has been told${data.emailEnabled ? ", and a receipt is on its way to your email" : ""}.` : "Your changes were sent to the studio.");
      }
      setConfirming(false); setAsking(false); setAskNote(""); setFixes("");
    } catch (e) { toast(e.message, { err: true }); }
    setBusy(false);
  };

  const act = async (fn, demoFn) => {
    try { if (demo) demoFn(); else { await fn(); await load(); reload(); } }
    catch (e) { toast(e.message, { err: true }); }
  };

  const list = (notes || []).filter((x) => show === "all" || !x.resolved);
  const open = (notes || []).filter((x) => !x.resolved).length;
  const isLatest = v.n === latest.n;
  const seen = () => { if (!admin && !demo) api("/api/portal", { method: "POST", body: { action: "seen", projectId: p.id, videoId: v.video.id } }).catch(() => {}); };
  const many = c.versions.length > 1;

  return html`
    <div class="review">
      <div class="stack" style=${{ gap: "18px", minWidth: 0 }}>
        <${Player} video=${v.video} apiRef=${player} onTime=${setTime} vertical=${v.video.vertical} source=${{ project: p.id }} onPlay=${seen} mark=${"Preview · Version " + v.n} />
        <div class="row" style=${{ justifyContent: "space-between" }}>
          ${many ? html`<div class="versions" role="group" aria-label="Versions">
            ${c.versions.map((x) => html`<button key=${x.n} class="vchip" aria-pressed=${x.n === v.n} onClick=${() => go(`/review/${p.id}/${encodeURIComponent(c.key)}/${x.n}`)}
              title=${x.decision ? decisionLabel(x.decision) : x.n === latest.n ? "Waiting for a decision" : "Older version"}>
              <span class="st" style=${{ background: x.decision ? (x.decision.decision === "approved" ? "var(--green)" : "var(--amber)") : x.n === latest.n ? "var(--red)" : "var(--line-2)" }}></span>
              Version ${x.n}</button>`)}
          </div>` : html`<div class="stack" style=${{ gap: "2px" }}><b>Version ${v.n}</b>${c.total > 1 ? html`<span class="faint small">The newest version. It replaces Version ${v.n - 1}${c.total > 2 ? " and earlier" : ""}.</span>` : null}</div>`}
          <span class="muted small">${v.video.durationLabel}${v.video.created ? " · shared " + fmtDate(v.video.created) : ""}</span>
        </div>
        ${v.video.description ? html`<p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>${v.video.description}</p>` : null}
        ${v.decision ? html`<div class="decision" role="status">
            <div class="stack" style=${{ gap: "4px" }}>
              <span class=${"pill " + (v.decision.decision === "approved" ? "green" : "amber")} style=${{ alignSelf: "flex-start" }}>${decisionLabel(v.decision)}</span>
              <span>${v.decision.decision === "approved" ? `${v.decision.by} approved Version ${v.n} on ${fmtDate(v.decision.at)}${v.decision.note ? ", with these small fixes:" : "."}` : `${v.decision.by} asked for changes on ${fmtDate(v.decision.at)}:`}</span>
              ${v.decision.note ? html`<span class="muted" style=${{ whiteSpace: "pre-wrap" }}>“${v.decision.note}”</span>` : null}
            </div>
          </div>`
        : !isLatest ? html`<div class="decision"><span class="muted">This is an older version. The newest is <${Link} to=${`/review/${p.id}/${encodeURIComponent(c.key)}/${latest.n}`} cls="link">Version ${latest.n}<//>.</span></div>`
        : admin ? html`<div class="decision"><span class="muted">Waiting for ${p.clientName} to approve Version ${v.n} or ask for changes${p.reviewDue ? `, planned by ${fmtDay(p.reviewDue)}` : ""}.</span></div>`
        : p.caps.approve ? html`<div class="decision">
            <div class="stack" style=${{ gap: "4px" }}><b>Is Version ${v.n} right?</b><span class="muted small">${open ? `You have ${plural(open, "open note")}. Asking for changes sends them along with your message.` : "Approve it, or tell the studio what to change."}${p.reviewDue ? ` Planned by ${fmtDay(p.reviewDue)}.` : ""}</span></div>
            <div class="row">
              <button class="btn primary" onClick=${() => setConfirming(true)}>Approve Version ${v.n}</button>
              <button class="btn ghost" onClick=${() => setAsking(true)}>Ask for changes</button>
            </div>
          </div>`
        : p.caps.notes ? html`<div class="decision"><span class="muted">Your company’s decision makers approve each version. Leave a note on anything you’d change: they and the studio will see it.</span></div>`
        : null}
      </div>

      <aside class="notes" aria-label="Notes on this version">
        <div class="nh">
          <div class="row" style=${{ justifyContent: "space-between" }}>
            <b>Notes on Version ${v.n}</b>
            <div class="tabs">
              <button class="tab-btn" aria-pressed=${show === "all"} onClick=${() => setShow("all")}>All ${notes ? notes.length : ""}</button>
              <button class="tab-btn" aria-pressed=${show === "open"} onClick=${() => setShow("open")}>Open ${notes ? open : ""}</button>
            </div>
          </div>
          ${p.caps.notes ? html`<label class="field">
            <span>${stamp != null ? html`Add a note at <span class="mono" style=${{ color: "var(--ink)" }}>${tc(stamp)}</span>` : "Add a note about this version"}</span>
            <textarea class="textarea" rows="3" placeholder="What would you change at this moment?" value=${draft}
              onFocus=${() => { if (at == null) { setAt(time); if (player.current) player.current.pause(); } }}
              onInput=${(e) => setDraft(e.target.value)}
              onKeyDown=${(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(); }}></textarea>
          </label>
          <div class="row">
            <button class="btn primary sm" disabled=${busy || !draft.trim()} onClick=${post}>Add note</button>
            ${at != null ? html`<button class="btn ghost sm" onClick=${() => { setAt(null); setDraft(""); if (player.current) player.current.play(); }}>Cancel</button>` : null}
            <span class="faint small">${timed ? "The film pauses while you write." : "This player can’t mark the moment; say it in your note (“at 1:20…”)."}</span>
          </div>` : html`<p class="muted small" style=${{ margin: 0, lineHeight: 1.55 }}>You can watch and read the notes. Your colleagues and the studio leave them.</p>`}
        </div>
        <div class="nl">
          ${err ? html`<div class="alert" style=${{ margin: "12px 20px" }}>${err}</div>` : null}
          ${notes == null ? html`<p class="muted" style=${{ padding: "16px 20px" }}>Loading notes…</p>`
            : !list.length ? html`<p class="muted" style=${{ padding: "16px 20px", lineHeight: 1.6 }}>${notes.length ? "No open notes. Everything is marked done." : "No notes yet. Pause on any moment and add one above."}</p>`
            : list.map((x) => html`<${Note} key=${x.id} note=${x} p=${p} admin=${admin} demo=${demo} canAct=${p.caps.notes}
                onSeek=${() => player.current && player.current.seek(x.at || 0)}
                onToggle=${() => act(() => api("/api/portal", { method: "POST", body: { action: "resolve", id: x.id, resolved: !x.resolved } }),
                  () => setNotes((ns) => ns.map((y) => y.id === x.id ? { ...y, resolved: !y.resolved } : y)))}
                onDelete=${() => act(() => api("/api/portal", { method: "POST", body: { action: "deleteNote", id: x.id } }),
                  () => setNotes((ns) => ns.filter((y) => y.id !== x.id)))}
                onReply=${(body) => act(() => api("/api/portal", { method: "POST", body: { action: "note", parentId: x.id, body } }),
                  () => { setNotes((ns) => ns.map((y) => y.id === x.id ? { ...y, replies: y.replies.concat([{ id: "r" + Date.now(), body, author: user.name, role: user.role, mine: true, when: new Date().toISOString() }]) } : y)); say("", "your reply was added here, but not sent."); })} />`)}
        </div>
      </aside>
    </div>
    ${confirming ? html`<${Modal} title=${`Approve Version ${v.n} of ${c.title}?`} onClose=${() => setConfirming(false)}>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>This tells the studio this version is right and they can finish it${open ? `. Your ${plural(open, "open note")} will still be there for them to see` : ""}.${data.emailEnabled && !demo ? " You’ll get a receipt by email." : ""}</p>
      <${Field} label="Any small fixes before it’s final? (optional)" hint="For example: lift the logo a touch. Big changes? Ask for changes instead.">
        <textarea class="textarea" rows="3" value=${fixes} onInput=${(e) => setFixes(e.target.value)}></textarea>
      <//>
      <div class="row">
        <button class="btn primary" disabled=${busy} onClick=${() => decide("approved", fixes.trim() || undefined)}>${busy ? "One moment…" : fixes.trim() ? `Approve Version ${v.n} with these fixes` : `Yes, approve Version ${v.n}`}</button>
        <button class="btn ghost" onClick=${() => setConfirming(false)}>Not yet</button>
      </div>
    <//>` : null}
    ${asking ? html`<${Modal} title=${`What should change in Version ${v.n}?`} onClose=${() => setAsking(false)}>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>Sum up what you’d like changed. Your notes on specific moments go along with it.</p>
      <${Field} label="Your changes"><textarea class="textarea" rows="5" value=${askNote} onInput=${(e) => setAskNote(e.target.value)} placeholder="For example: shorten the middle section, and try warmer music."></textarea><//>
      <div class="row">
        <button class="btn primary" disabled=${busy || !askNote.trim()} onClick=${() => decide("changes", askNote.trim())}>${busy ? "Sending…" : "Send my changes"}</button>
        <button class="btn ghost" onClick=${() => setAsking(false)}>Not yet</button>
      </div>
    <//>` : null}
  `;
}

function Note({ note, admin, canAct, onSeek, onToggle, onDelete, onReply }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [del, setDel] = useState(false);
  const canDelete = note.canRemove || note.mine;
  return html`<div class=${"note" + (note.resolved ? " done" : "")}>
    <div class="top">
      ${note.at != null ? html`<button class="tc" onClick=${onSeek} aria-label=${"Play from " + tc(note.at)}>${tc(note.at)}</button>` : null}
      <${Avatar} name=${note.author} staff=${note.role === "admin"} size=${26} />
      <span class="small"><b>${note.author}</b>${note.role === "admin" ? html` <span class="faint">· studio</span>` : null}</span>
      <span class="faint small" style=${{ marginLeft: "auto" }}>${fmtAgo(note.when)}</span>
    </div>
    <div class="body">${note.body}</div>
    ${note.replies.map((r) => html`<div class="reply" key=${r.id}><span class="small"><b>${r.author}</b>${r.role === "admin" ? html` <span class="faint">· studio</span>` : null} <span class="faint">· ${fmtAgo(r.when)}</span></span><span style=${{ whiteSpace: "pre-wrap" }}>${r.body}</span></div>`)}
    ${replying ? html`<div class="stack" style=${{ gap: "8px" }}>
      <textarea class="textarea" rows="2" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Write a reply" aria-label="Reply"></textarea>
      <div class="row"><button class="btn primary sm" disabled=${!text.trim()} onClick=${() => { onReply(text.trim()); setText(""); setReplying(false); }}>Reply</button><button class="btn ghost sm" onClick=${() => setReplying(false)}>Cancel</button></div>
    </div>` : canAct ? html`<div class="acts">
      <button onClick=${() => setReplying(true)}>Reply</button>
      <button onClick=${onToggle}>${note.resolved ? "Reopen" : "Mark done"}</button>
      ${canDelete ? html`<button onClick=${() => setDel(true)}>Delete</button>` : null}
    </div>` : null}
    ${del ? html`<${Confirm} title="Delete this note?" yes="Yes, delete it" danger onYes=${() => { setDel(false); onDelete(); }} onNo=${() => setDel(false)}>
      “${note.body.slice(0, 140)}${note.body.length > 140 ? "…" : ""}” and its replies will be gone for everyone.
    <//>` : null}
  </div>`;
}
