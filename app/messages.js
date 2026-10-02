// Messages: one conversation per project between the client and the studio.
import { html, useApp, useState, useEffect, useRef, api, Head, Empty, Link, Avatar, fmtDate, plural, Confirm, isStaff } from "./ui.js";

export function Messages({ pid }) {
  const app = useApp();
  const { data, user, demo, say, toast, reload } = app;
  const admin = isStaff(user);
  const support = (data.brand && data.brand.support) || "alexis@gotit2work.com";
  const ps = data.projects.filter((p) => p.caps.messages);
  const [thread, setThread] = useState(null);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const end = useRef(null);
  const p = ps.find((x) => x.id === pid) || ps.find((x) => x.messages && x.messages.unread) || ps[0];

  useEffect(() => {
    if (!p) return;
    if (demo) { setThread(p.thread || []); return; }
    setThread(null);
    api("/api/portal?thread=" + p.id).then((d) => { setThread(d.messages); setErr(""); if (p.messages && p.messages.unread) reload(); })
      .catch((e) => { setErr(e.message); setThread([]); });
  }, [p && p.id]);
  useEffect(() => { if (end.current && thread && thread.length) end.current.scrollIntoView({ block: "end" }); }, [thread && thread.length]);

  if (!ps.length) return html`<div class="page"><${Empty} icon="bottle" title="Messages aren’t switched on.">You can still reach the studio at <a href=${"mailto:" + support}>${support}</a>.<//></div>`;

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      if (demo) {
        setThread((t) => t.concat([{ id: "d" + Date.now(), author: user.name, role: user.role, mine: true, body, at: new Date().toISOString() }]));
        say("", "your message appears here, but isn’t sent to anyone.");
      } else {
        const d = await api("/api/portal", { method: "POST", body: { action: "message", projectId: p.id, body } });
        setThread((t) => t.concat([d.message]));
        reload();
      }
      setText("");
    } catch (e) { toast(e.message, { err: true }); }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api("/api/portal", { method: "POST", body: { action: "deleteMessage", id: del.id } });
      setThread((t) => t.filter((m) => m.id !== del.id));
      toast("Message deleted.");
    } catch (e) { toast(e.message, { err: true }); }
    setBusy(false); setDel(null);
  };
  const other = admin ? p.clientName : "the studio";
  return html`<div class="page">
    <${Head} eyebrow=${p.title} title=${admin ? `Messages with ${p.clientName}` : "Messages"}>
      ${admin ? `Everyone at ${p.clientName} on this project sees this conversation.` : (data.brand && data.brand.replies) || "Write to the studio about this project."}
    <//>
    ${ps.length > 1 ? html`<div class="tabs" style=${{ marginBottom: "22px" }}>${ps.map((x) => html`<${Link} key=${x.id} to=${"/messages/" + x.id} cls="tab-btn" current=${x.id === p.id}>
      ${admin ? x.clientName + " · " : ""}${x.title}${x.messages && x.messages.unread ? html`<span class="d" aria-label=${plural(x.messages.unread, "unread message")}></span>` : null}<//>`)}</div>` : null}
    ${err ? html`<div class="alert">${err}</div>` : null}
    <div class="thread" aria-live="polite">
      ${thread == null ? html`<p class="muted">Loading the conversation…</p>`
        : !thread.length ? html`<p class="muted">No messages yet. Say hello, or ask anything about the project.</p>`
        : thread.map((m) => {
            const mine = m.mine || (demo && m.author === user.name);
            return html`<div class=${"msg" + (mine ? " mine" : "")} key=${m.id}>
              <${Avatar} name=${m.author} staff=${m.role === "admin"} />
              <div style=${{ minWidth: 0 }}>
                <div class="who">${mine ? "You" : m.author + (m.role === "admin" ? " · studio" : "")} · ${fmtDate(m.at, true)}</div>
                <div class="bub">${m.body}</div>
                ${m.canRemove && !demo ? html`<button class="link small faint" style=${{ marginTop: "4px" }} onClick=${() => setDel(m)}>Delete</button>` : null}
              </div>
            </div>`;
          })}
      <div ref=${end}></div>
    </div>
    <div class="composer">
      <textarea class="textarea grow" rows="1" placeholder=${"Write to " + other + "…"} aria-label=${"Message to " + other} value=${text}
        onInput=${(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(220, e.target.scrollHeight) + "px"; }}
        onKeyDown=${(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
      <button class="btn primary" disabled=${busy || !text.trim()} onClick=${send}>Send</button>
    </div>
    <p class="faint small" style=${{ marginTop: "10px" }}>Enter sends. Shift + Enter starts a new line.</p>
    ${del ? html`<${Confirm} title="Delete this message?" yes="Delete it" busy=${busy} onYes=${remove} onNo=${() => setDel(null)}>
      It disappears for everyone. ${del.mine ? "Anyone already emailed about it keeps that email." : `It was written by ${del.author}.`}
    <//>` : null}
  </div>`;
}
