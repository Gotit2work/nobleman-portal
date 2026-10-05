// The tutorial: a few steps, each pointing at the real thing on the screen. Everything else dims and blurs; that
// one spot stays sharp, pulsing with its number. It starts by itself the first time someone opens Home (until they
// finish or skip it: users.welcomed_at), and any time from Tutorial at the top or in Help.
// Elements opt in with data-tour="<name>". A step whose element isn't there (a role that can't do it, nothing to
// review yet) is skipped, so nobody is pointed at something they don't have.
import { html, useApp, useState, useEffect, useRef, api, can, isStaff } from "./ui.js";

// path: where the step lives when its element isn't on this screen ("project" = the first project, in Studio).
// go: pressing the spot does what it always does (opens that screen) and moves on; otherwise it only moves on.
// when: whether this person has the thing at all, so nobody waits on a step that can't be shown.
const waiting = (d) => d.projects.some((p) => p.caps.review && p.caps.approve && p.cuts.some((c) => !c.versions[c.versions.length - 1].decision));
const notes = (d) => d.projects.some((p) => p.caps.review && p.caps.notes && p.cuts.length);
const CLIENT = [
  { t: "next", path: "/", go: true, title: "Start here", text: "What needs you is always at the top. Press it." },
  { t: "note", path: "/review", when: notes, title: "Leave a note", text: "Pause the film and type what you’d change." },
  // Nothing to leave notes on yet (or a viewer): show where versions will be instead.
  { t: "nav-review", when: (d) => !notes(d) && d.projects.some((p) => p.caps.review), title: "Review", text: "Each new version shows up here." },
  { t: "decide", path: "/review", when: waiting, title: "Approve", text: "Happy with it? Approve. If not, ask for changes." },
];
const any = (d) => d.projects.length > 0;
const STUDIO = [
  { t: "next", path: "/", go: true, title: "Start here", text: "What needs you is always at the top. Press it." },
  { t: "new-project", path: "/studio/projects", when: (d, u) => can(u, "projects.create"), title: "New project", text: "Pick the client and a name. Its link is ready." },
  { t: "link", path: "project", when: any, title: "Send the link", text: "Copy it to the client. Whoever opens it is in." },
  { t: "videos", path: "project", when: any, go: true, title: "Add videos", text: "Pick its Vimeo or Frame.io folder. Versions show up for the client." },
  { t: "as-client", path: "project", when: any, go: true, title: "Check their view", text: "See the project exactly as the client does." },
];

const PAD = 8;
const phone = () => innerWidth < 960;
// The first one showing (the side capsule and the phone's bottom bar both carry the nav ones).
const find = (t) => [...document.querySelectorAll(`[data-tour="${t}"]`)].find((el) => { const r = el.getBoundingClientRect(); return r.width && r.height; }) || null;
const waitFor = (t, ms) => new Promise((done) => {
  const until = Date.now() + ms;
  (function look() { const el = find(t); if (el || Date.now() > until) done(el); else setTimeout(look, 60); })();
});

/** The spot with some room around it, kept on screen, and the veil's outline: the screen minus that rounded hole. */
function hole(r, W, H) {
  const x = Math.max(4, r.left - PAD), y = Math.max(4, r.top - PAD);
  const w = Math.max(0, Math.min(W - 4, r.right + PAD) - x), h = Math.max(0, Math.min(H - 4, r.bottom + PAD) - y);
  const c = Math.min(16, w / 2, h / 2);
  return { x, y, w, h, d: `M0 0H${W}V${H}H0Z M${x + c} ${y}H${x + w - c}A${c} ${c} 0 0 1 ${x + w} ${y + c}V${y + h - c}A${c} ${c} 0 0 1 ${x + w - c} ${y + h}H${x + c}A${c} ${c} 0 0 1 ${x} ${y + h - c}V${y + c}A${c} ${c} 0 0 1 ${x + c} ${y}Z` };
}

/** Where the card goes. Desktop: under the spot, else above it. Phone: the bottom, unless the spot is down there. */
function place(o, card, W, H) {
  const ch = card ? card.offsetHeight : 200, cw = card ? card.offsetWidth : 360;
  if (W < 960) return o.y + o.h / 2 > H * 0.55 ? { top: "calc(64px + env(safe-area-inset-top))" } : { bottom: "calc(72px + env(safe-area-inset-bottom))" };
  const left = Math.min(Math.max(16, o.x), W - cw - 16);
  if (o.y + o.h + 18 + ch < H - 16) return { left, top: o.y + o.h + 18 };
  if (o.y - 18 - ch > 16) return { left, top: o.y - 18 - ch };
  return { right: 24, bottom: 24 };
}

export function Tour({ onEnd }) {
  const app = useApp();
  const { data, user, demo, go } = app;
  const [steps] = useState(() => (isStaff(user) ? STUDIO : CLIENT).filter((s) => !s.when || s.when(data, user)));
  const [i, setI] = useState(0);
  const [el, setEl] = useState(null);
  const [box, setBox] = useState(null);
  const [lost, setLost] = useState(0);
  const card = useRef(null);
  const next = useRef(null);
  const step = steps[i];

  const end = (finished) => {
    onEnd();
    if (!demo && data.tour) {
      app.setData((d) => ({ ...d, tour: false }));
      api("/api/session", { method: "POST", body: { action: "profile", welcomed: true } }).catch(() => {});
    }
    app.toast(finished ? "That’s it. Watch it again any time: Tutorial, at the top." : "Tutorial skipped. It’s at the top whenever you want it.");
  };
  const move = (to) => { setEl(null); setBox(null); if (to >= steps.length) end(true); else setI(to); };

  // Find the step's spot: on this screen (give a screen that's just opening a moment), else on the step's own
  // screen. A spot that never appears is skipped.
  useEffect(() => {
    let live = true;
    (async () => {
      let found = await waitFor(step.t, 700);
      if (!found && live) {
        const first = data.projects && data.projects[0];
        const to = step.path === "project" ? first && "/studio/projects/" + first.id : step.path;
        if (to) { go(to); found = await waitFor(step.t, 3000); }
      }
      if (!live) return;
      if (!found) return move(i + 1);
      found.scrollIntoView({ block: phone() || found.offsetHeight > innerHeight * 0.6 ? "start" : "center" });
      setEl(found);
    })();
    return () => { live = false; };
  }, [i, lost]);

  // Follow the spot as the page scrolls, resizes, or redraws it.
  useEffect(() => {
    if (!el) return;
    let raf, last = "", gone = 0;
    const tick = () => {
      const cur = el.isConnected ? el : find(step.t);
      if (!cur) { if (++gone > 30) { setEl(null); setBox(null); setLost((n) => n + 1); return; } }
      else {
        gone = 0;
        const r = cur.getBoundingClientRect(), W = innerWidth, H = innerHeight;
        const key = [r.left, r.top, r.width, r.height, W, H].map(Math.round).join();
        if (key !== last) { last = key; const o = hole(r, W, H); setBox({ ...o, at: place(o, card.current, W, H) }); }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [el]);

  useEffect(() => { if (box && next.current && document.activeElement !== next.current) next.current.focus({ preventScroll: true }); }, [i, !!box]);

  // Pressing the spot moves on (and, for the steps that open a screen, opens it). Escape skips.
  useEffect(() => {
    if (!el) return;
    const onClick = (e) => {
      const cur = find(step.t);
      if (!cur || !cur.contains(e.target)) return;
      if (!step.go) { e.preventDefault(); e.stopPropagation(); }
      setTimeout(() => move(i + 1), 0);
    };
    const onKey = (e) => { if (e.key === "Escape") end(false); };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onClick, true); document.removeEventListener("keydown", onKey); };
  }, [el, i]);

  if (!box) return html`<div class="tour-veil" aria-hidden="true"></div>`;
  const clip = `path(evenodd, "${box.d}")`;
  return html`<div class="tour">
    <div class="tour-veil" aria-hidden="true" style=${{ clipPath: clip, WebkitClipPath: clip }}></div>
    <div class="tour-ring" aria-hidden="true" style=${{ left: box.x, top: box.y, width: box.w, height: box.h }}></div>
    <span class="tour-num" aria-hidden="true" style=${{ left: Math.max(18, box.x), top: Math.max(18, box.y) }}>${i + 1}</span>
    <section class="tour-card" key=${i} ref=${card} role="dialog" aria-modal="false" aria-labelledby="tour-t" aria-describedby="tour-d" style=${box.at}>
      <div class="tour-top"><span class="tour-count">${i + 1} of ${steps.length}</span><button type="button" class="link small" onClick=${() => end(false)}>Skip tutorial</button></div>
      <h2 class="tour-title" id="tour-t">${step.title}</h2>
      <p id="tour-d">${step.text}</p>
      <div class="tour-foot">
        <span class="tour-dots" aria-hidden="true">${steps.map((_, k) => html`<i key=${k} class=${k === i ? "on" : k < i ? "done" : ""}></i>`)}</span>
        <button type="button" class="btn primary sm" ref=${next} onClick=${() => move(i + 1)}>${i === steps.length - 1 ? "Done" : "Next"}</button>
      </div>
    </section>
  </div>`;
}

/** Tutorial, at the top of every screen. */
export function TourButton({ cls = "tour-btn" }) {
  const app = useApp();
  return html`<button type="button" class=${cls} onClick=${app.startTour} aria-label="Watch the tutorial">
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>Tutorial</button>`;
}
