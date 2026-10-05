// The portal app: decides what to show (login, first-run setup, new password, demo, or the portal), routes
// between screens without page reloads, and draws the navigation: a floating side capsule on desktop, a bottom
// bar on phones.
import { html, AppCtx, useState, useEffect, useMemo, useCallback, useRef, api, setDemoMode, Icon, Link, Modal, Avatar, plural, isStaff } from "./ui.js";
import { Gate } from "./gate.js";
import { Home, Project } from "./home.js";
import { Review } from "./review.js";
import { Films } from "./films.js";
import { Files } from "./files.js";
import { Messages } from "./messages.js";
import { Account } from "./account.js";
import { Studio } from "./studio.js";
import { Watch } from "./watch.js";
import { Payments } from "./payments.js";
import { Tour, TourButton } from "./tour.js";

const R = window.React;

/** When a screen breaks (a fault in the portal's code), say so plainly instead of leaving a blank page. In the shell
 *  it replaces just that screen, so the navigation still works, and going to another address clears it (`at`).
 *  It isn't keyed by the address: that would rebuild every screen on every click. Around the whole app it's the
 *  last resort. */
class Broke extends R.Component {
  constructor(props) { super(props); this.state = { err: null, at: props.at }; }
  static getDerivedStateFromError(err) { return { err }; }
  static getDerivedStateFromProps(props, state) { return props.at !== state.at ? { err: null, at: props.at } : null; }
  componentDidCatch(err, info) { console.error("Portal screen error:", err, info && info.componentStack); }
  render() {
    if (!this.state.err) return this.props.children;
    const { support = "alexis@gotit2work.com", atHome, whole } = this.props;
    const words = html`<p style=${{ margin: 0, lineHeight: 1.55, maxWidth: "440px" }}>That’s a fault in the portal, not your connection. Reload the page to try again${whole || atHome ? "" : ", or go to Home"}.</p>`;
    const mail = html`<p class="small" style=${{ margin: 0, opacity: 0.75 }}>If it happens again, email <a href=${"mailto:" + support} style=${{ color: "inherit" }}>${support}</a> and say what you clicked.</p>`;
    if (whole) return html`<div role="alert" style=${{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "18px", padding: "32px", textAlign: "center", color: "#f4f4f2", background: "#031e25" }}>
      <img src="/assets/Nobleman_Mark_White.png" alt="" style=${{ height: "44px" }} />
      <h1 class="h3" style=${{ margin: 0 }}>The portal stopped working.</h1>${words}
      <button class="btn primary" onClick=${() => location.reload()}>Reload the page</button>${mail}
    </div>`;
    return html`<div class="page"><div class="empty" role="alert">
      <h3>This screen stopped working.</h3>${words}
      <div class="row" style=${{ justifyContent: "center" }}>
        <button class="btn primary" onClick=${() => location.reload()}>Reload the page</button>
        ${atHome ? null : html`<${Link} to="/" cls="btn ghost">Go to Home<//>`}
      </div>${mail}
    </div></div>`;
  }
}

/** Splits /review/<project>/<cut>/<n> into ["review", project, cut, n] (relative to the base), decoded once here and
 *  nowhere else. A mistyped address (a stray "%") stays as typed instead of throwing. */
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
function routeOf(path, base) {
  const p = base && path.startsWith(base) ? path.slice(base.length) : path;
  return p.split("/").filter(Boolean).map(decode);
}

/** An old address sends people on to the portal's address (Studio → Settings → Studio details), the same page,
 *  but only once that address answers, so a half-finished domain move never strands anyone. API calls are never
 *  moved (Stripe and Adobe keep reaching the old address), and previews and local copies stay where they are. */
async function movedOn(s) {
  const to = s && s.brand && s.brand.portal;
  if (!to || /(^|\.)localhost$|^127\.|\.vercel\.app$/.test(location.hostname)) return false;
  let target;
  try { target = new URL(to); } catch { return false; }
  if (target.host === location.host) return false;
  try { await fetch(target.origin + "/api/session", { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(5000) }); } catch { return false; }
  location.replace(target.origin + location.pathname + location.search + location.hash);
  return true;
}

function App() {
  const [st, setSt] = useState({ phase: "boot" });
  const [path, setPath] = useState(location.pathname);
  const [toasts, setToasts] = useState([]);
  const [help, setHelp] = useState(false);
  const [more, setMore] = useState(false);
  const [tour, setTour] = useState(0);   // the tutorial that is running (a new number restarts it), or 0
  const toured = useRef(false);

  const toast = useCallback((text, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => t.concat([{ id, text, err: !!opts.err }]));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.err ? 7000 : 4500);
  }, []);

  const go = useCallback((to, { replace } = {}) => {
    const full = (st.base || "") + (to === "/" && st.base ? "" : to);
    if (replace) history.replaceState(null, "", full || "/"); else history.pushState(null, "", full || "/");
    setPath(location.pathname);
    window.scrollTo(0, 0);
    setMore(false);
  }, [st.base]);

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // The demo shows the client's view, or the studio's (?view=studio): same portal, different person logged in.
  // Both views load together, so the switch is instant.
  const demoCache = useRef({});
  const demoData = useCallback((view) => {
    const c = demoCache.current;
    if (!c[view]) c[view] = api("/api/portal?demo=" + (view === "studio" ? "studio" : "1")).catch((e) => { delete c[view]; throw e; });
    return c[view];
  }, []);
  const loadDemo = useCallback(async (base) => {
    const view = new URLSearchParams(location.search).get("view") === "studio" || /^(\/demo)?\/studio(\/|$)/.test(location.pathname) ? "studio" : "client";
    setDemoMode(true);
    const data = await demoData(view);
    demoData(view === "studio" ? "client" : "studio").catch(() => {});
    setSt({ phase: "app", demo: true, demoView: view, base, data, session: null });
  }, []);
  const switchDemo = useCallback(async (view) => {
    if (view === st.demoView) return;
    setTour(0);
    // The switch moves at once; the page follows as soon as that view's sample data is in (it usually already is).
    setSt((x) => ({ ...x, demoView: view }));
    try {
      const data = await demoData(view);
      const route = routeOf(location.pathname, st.base);
      const leave = view === "client" && route[0] === "studio";
      const to = leave ? (st.base || "") + "/" : location.pathname;
      history.replaceState(null, "", to + (view === "studio" ? "?view=studio" : ""));
      setSt((x) => (x.demoView === view ? { ...x, data } : x));
      if (leave) { setPath(location.pathname); window.scrollTo(0, 0); }
    } catch (e) {
      setSt((x) => ({ ...x, demoView: view === "studio" ? "client" : "studio" }));
      toast(e.message, { err: true });
    }
  }, [st.base, st.demoView]);

  const loadPortal = useCallback(async (session, next) => {
    setDemoMode(false);
    const data = await api("/api/portal");
    // Land on the page they wanted, or stay where they are; never on a used one-time link or /signin.
    const target = next && /^\/(?!\/)/.test(next) ? next : /^\/(link|join|signin|signup|login)(\/|$)/.test(location.pathname) ? "/" : location.pathname;
    if (target !== location.pathname) history.replaceState(null, "", target);
    setPath(target);
    setSt({ phase: "app", demo: false, base: "", data, session });
  }, []);

  const boot = useCallback(async () => {
    const p = location.pathname;
    if (p.startsWith("/watch/")) return setSt({ phase: "watch" });
    const wantsDemo = p === "/demo" || p.startsWith("/demo/");
    const wantsSignUp = p === "/signup";
    const wantsSignIn = wantsSignUp || p === "/signin" || p === "/login" || new URLSearchParams(location.search).has("signin");
    const start = wantsSignUp ? "signup" : undefined;
    let s;
    try { s = await api("/api/session"); } catch (e) { s = { error: e.message }; }
    if (await movedOn(s)) return;
    try {
      // A project's own link: the client's way in (gate.js, Join). The demo shows a sample one.
      if (p.startsWith("/join/") || p.startsWith("/demo/join")) return setSt({ phase: "gate", gate: "join", session: s, demoJoin: p.startsWith("/demo/") });
      if (wantsDemo) return await loadDemo("/demo");
      if (p.startsWith("/link/")) return setSt({ phase: "gate", gate: "link", session: s });
      if (s.user) {
        if (wantsSignIn) history.replaceState(null, "", "/");
        if (s.user.mustChangePassword) return setSt({ phase: "gate", gate: "password", session: s });
        if (s.needsTwoStep) return setSt({ phase: "gate", gate: "twostep", session: s });
        return await loadPortal(s);
      }
      if (s.demoAtRoot && !wantsSignIn) return await loadDemo("");
      if (s.error) return setSt({ phase: "gate", gate: "login", session: s, problem: s.error, start });
      if (s.db === false) return setSt({ phase: "gate", gate: "login", session: s, problem: "The portal is still being set up. Try again soon, or see the demo.", start });
      if (s.setup) return setSt({ phase: "gate", gate: "setup", session: s });
      return setSt({ phase: "gate", gate: "login", session: s, start });
    } catch (e) {
      setSt({ phase: "gate", gate: "login", session: s, problem: e.message });
    }
  }, []);

  useEffect(() => { boot(); }, []);

  /** Re-reads the portal after an action, so every screen shows what the server now holds. */
  const reload = useCallback(async () => {
    if (st.demo) return;
    try {
      const data = await api("/api/portal");
      setSt((x) => ({ ...x, data }));
    } catch (e) {
      if (e.status === 401) { toast("You were logged out. Log in again to continue.", { err: true }); setSt({ phase: "gate", gate: "login", session: {} }); }
      else toast(e.message, { err: true });
    }
  }, [st.demo]);

  const setData = useCallback((fn) => setSt((x) => ({ ...x, data: fn(x.data) })), []);

  /** In the demo nothing is saved or sent; the toast says so plainly. */
  const say = useCallback((real, demo) => toast(st.demo ? "Demo only: " + demo : real), [st.demo, toast]);

  /** After any way of signing in: a password to choose, two-step to set up, or straight to the page they wanted. */
  const signedIn = useCallback(async (user, next) => {
    const session = { ...(st.session || {}), user };
    if (user.mustChangePassword) return setSt({ phase: "gate", gate: "password", session, next });
    try {
      const fresh = await api("/api/session");
      if (fresh.needsTwoStep) return setSt({ phase: "gate", gate: "twostep", session: fresh, next });
      await loadPortal(fresh, next);
    } catch (e) { toast(e.message, { err: true }); }
  }, [st.session]);

  const signOut = useCallback(async () => {
    if (st.demo) { toast("This is the demo. There’s nothing to log out of. Log in at the top of the page."); return; }
    setTour(0);
    await api("/api/session", { method: "POST", body: { action: "logout" } }).catch(() => {});
    history.replaceState(null, "", "/");
    setPath("/");
    setSt({ phase: "gate", gate: "login", session: {} });
  }, [st.demo]);

  // The first time someone opens Home, the tutorial starts by itself, once.
  const top = st.phase === "app" ? routeOf(path, st.base)[0] || "" : null;
  useEffect(() => {
    if (st.phase === "app" && !st.demo && st.data.tour && !toured.current && top === "") { toured.current = true; setTour(Date.now()); }
  }, [st.phase, top]);

  if (st.phase === "boot") return html`<div class="boot" role="status" aria-label="Loading the portal"><img src="/assets/Nobleman_Mark_White.png" alt="" /><div class="bar"><i></i></div><div class="eyebrow">Private screening room</div></div>`;
  if (st.phase === "watch") return html`<${Watch} token=${location.pathname.split("/")[2] || ""} /><${Toasts} items=${toasts} />`;
  if (st.phase === "gate") {
    return html`<${Gate} mode=${st.gate} session=${st.session} problem=${st.problem} start=${st.start} demo=${st.demoJoin}
      onSignedIn=${signedIn} onSetupDone=${signedIn}
      onPasswordNeeded=${(user, next) => setSt({ phase: "gate", gate: "password", session: { ...(st.session || {}), user }, next })}
      onPasswordDone=${(user) => signedIn(user, st.next)}
      onTwoStepDone=${() => signedIn(st.session.user, st.next)}
      onSignOut=${signOut} toast=${toast} />
      <${Toasts} items=${toasts} />`;
  }

  const startTour = () => { setHelp(false); setMore(false); setTour(Date.now()); };
  const ctx = { ...st, user: st.data.user, go, toast, say, reload, setData, signOut, openHelp: () => setHelp(true), path, switchDemo, startTour };
  return html`<${AppCtx.Provider} value=${ctx}>
    <${Shell} route=${routeOf(path, st.base)} more=${more} setMore=${setMore} />
    ${help ? html`<${Help} onClose=${() => setHelp(false)} />` : null}
    ${tour ? html`<${Tour} key=${tour} onEnd=${() => setTour(0)} />` : null}
    <${Toasts} items=${toasts} />
  <//>`;
}

function Toasts({ items }) {
  return html`<div class="toasts" role="status" aria-live="polite">${items.map((t) => html`<div key=${t.id} class=${"toast" + (t.err ? " err" : "")}>${t.text}</div>`)}</div>`;
}

/** Which screens this person has, with their badges, from what their projects allow. */
function navFor(data) {
  const ps = data.projects || [];
  const admin = isStaff(data.user);
  const any = (k) => admin || ps.some((p) => p.caps[k]);
  const awaiting = ps.reduce((n, p) => n + (p.caps.review ? p.cuts.filter((c) => !c.versions[c.versions.length - 1].decision).length : 0), 0);
  const unread = ps.reduce((n, p) => n + (p.messages ? p.messages.unread : 0), 0);
  const items = [{ key: "", label: "Home", icon: "anchor", tip: "Your projects and your next step" }];
  if (any("review")) items.push({ key: "review", label: "Review", icon: "play", badge: admin ? 0 : awaiting, tip: "Watch versions and leave notes" });
  items.push({ key: "films", label: "Films", icon: "growth", tip: "Finished films to watch and download" });
  if (any("files") || any("upload")) items.push({ key: "files", label: "Files", icon: "send", tip: "Documents, and files you send us" });
  if (any("messages")) items.push({ key: "messages", label: "Messages", icon: "bottle", badge: unread, tip: "Talk to the studio" });
  if (admin) items.push({ key: "studio", label: "Studio", icon: "key", tip: "Projects, clients, people, connections, settings" });
  return items;
}

function Shell({ route, more, setMore }) {
  const app = R.useContext(AppCtx);
  const { data, demo, user } = app;
  const items = useMemo(() => navFor(data), [data]);
  const top = route[0] || "";
  const activeIdx = Math.max(0, items.findIndex((i) => i.key === (top === "projects" ? "" : top)));
  const isNavTop = items.some((i) => i.key === top) || top === "projects";

  let screen;
  switch (top) {
    case "": screen = html`<${Home} />`; break;
    case "projects": screen = html`<${Project} id=${route[1]} />`; break;
    case "review": screen = html`<${Review} pid=${route[1]} cut=${route[2]} n=${route[3]} />`; break;
    case "films": screen = html`<${Films} pid=${route[1]} vid=${route[2]} />`; break;
    case "files": screen = html`<${Files} pid=${route[1]} />`; break;
    case "messages": screen = html`<${Messages} pid=${route[1]} />`; break;
    case "account": screen = html`<${Account} />`; break;
    case "payments": screen = html`<${Payments} pid=${route[1]} />`; break;
    case "studio": screen = isStaff(user) ? html`<${Studio} tab=${route[1]} id=${route[2]} />` : html`<${NotFound} />`; break;
    default: screen = html`<${NotFound} />`;
  }

  const mobileItems = items.length > 5 ? items.slice(0, 4) : items;
  const overflow = items.length > 5 ? items.slice(4) : [];

  return html`<div class="shell">
    <nav class="rail" aria-label="Main">
      <${Link} to="/" cls="rail-logo" label="Portal home"><img src="/assets/Nobleman_Mark_White.png" alt="" /><//>
      <div class="rail-sep"></div>
      <div class="rail-items">
        <div class="rail-glow" aria-hidden="true" style=${{ transform: `translateY(calc(${activeIdx} * (var(--rh) + 4px)))`, opacity: isNavTop ? 1 : 0 }}></div>
        ${items.map((it, i) => html`<${Link} key=${it.key} to=${"/" + it.key} cls="rail-item" current=${isNavTop && i === activeIdx} tour=${"nav-" + (it.key || "home")}>
          <${Icon} name=${it.icon} size=${26} />
          <span class="lbl">${it.label}</span>
          ${it.badge ? html`<span class="badge" aria-label=${plural(it.badge, "new item")}>${it.badge}</span>` : null}
          <span class="rail-tip" aria-hidden="true">${it.tip}</span>
        <//>`)}
      </div>
      <div class="rail-sep"></div>
      <div class="rail-foot">
        <button class="rail-round" onClick=${app.openHelp} aria-label="Help: how this portal works">?<span class="rail-tip" aria-hidden="true">How this portal works</span></button>
        <${Link} to="/account" cls="rail-round" current=${top === "account"} label=${"Your account: " + user.name}>
          <${Avatar} name=${user.name} size=${40} />
          <span class="rail-tip" aria-hidden="true">${user.name} · Account</span>
        <//>
      </div>
    </nav>

    <header class="topbar">
      <${Link} to="/" cls="brand" label="Portal home"><img src="/assets/Nobleman_Logo_White.png" alt="Nobleman Productions" /><//>
      <${TourButton} />
      <button class="round" onClick=${app.openHelp} aria-label="Help: how this portal works">?</button>
      <${Link} to="/account" cls="round" label=${"Your account: " + user.name}><${Avatar} name=${user.name} size=${30} /><//>
    </header>

    ${demo ? html`<${DemoRibbon} />` : html`<div class="tour-corner rail-only-desktop"><${TourButton} /></div>`}

    ${data.announcement ? html`<div class=${"announce " + (data.announcement.tone === "warning" ? "warn" : "")} role="status">${data.announcement.text}</div>` : null}
    <main id="main"><${Broke} at=${route.join("/")} atHome=${!top} support=${data.brand && data.brand.support}>${screen}<//></main>

    <nav class="bottombar" aria-label="Main">
      ${mobileItems.map((it) => html`<${Link} key=${it.key} to=${"/" + it.key} cls="tab" current=${isNavTop && it.key === (items[activeIdx] || {}).key} tour=${"nav-" + (it.key || "home")}>
        <${Icon} name=${it.icon} size=${26} /><span class="lbl">${it.label}</span>
        ${it.badge ? html`<span class="badge">${it.badge}</span>` : null}
      <//>`)}
      ${overflow.length ? html`<button class="tab" aria-expanded=${more} onClick=${() => setMore(!more)} aria-current=${overflow.some((o) => o.key === top) ? "page" : undefined}>
        <${Icon} name="grid" size=${26} /><span class="lbl">More</span></button>` : null}
    </nav>
    ${more ? html`<${Modal} title="More" onClose=${() => setMore(false)}>
      <div class="list">${overflow.map((it) => html`<${Link} key=${it.key} to=${"/" + it.key} cls="li" onClick=${() => setMore(false)}>
        <${Icon} name=${it.icon} size=${28} /><div class="grow"><div class="name">${it.label}</div><div class="meta">${it.tip}</div></div><span aria-hidden="true">→</span><//>`)}
      </div>
    <//>` : null}
  </div>`;
}

/** Client's view / studio's view, in the demo. */
function DemoSwitch() {
  const app = R.useContext(AppCtx);
  const studio = app.demoView === "studio";
  return html`<div class="demo-switch" data-on=${studio ? "2" : "1"} role="group" aria-label="Whose view of the demo">
    <i class="thumb" aria-hidden="true"></i>
    <button aria-pressed=${!studio} onClick=${() => app.switchDemo("client")}>Client’s view</button>
    <button aria-pressed=${studio} onClick=${() => app.switchDemo("studio")}>Studio’s view</button>
  </div>`;
}

function DemoRibbon() {
  return html`<div style=${{ position: "fixed", top: "18px", right: "22px", zIndex: 55 }} class="rail-only-desktop">
    <div class="row" style=${{ gap: "8px" }}>
      <${DemoSwitch} />
      <${TourButton} />
      <a class="btn primary sm" href="/signin">Log in</a>
    </div>
  </div>`;
}

function NotFound() {
  return html`<div class="page"><div class="empty">
    <h3>That page isn’t here.</h3>
    <p>The link may be old or mistyped. Everything in the portal starts from Home.</p>
    <${Link} to="/" cls="btn primary">Go to Home<//>
  </div></div>`;
}

const HELP = [
  { icon: "anchor", t: "Home", d: "Your next step, then your projects." },
  { icon: "play", t: "Review", d: "Watch the newest version, leave notes, then approve it." },
  { icon: "growth", t: "Films", d: "Finished films to watch, download, or share." },
  { icon: "send", t: "Files", d: "Documents from the studio, and files you send." },
  { icon: "bottle", t: "Messages", d: "Write to the studio about a project." },
  { icon: "key", t: "Payments", d: "Pay by card or bank when the studio asks.", payments: true },
];
const STAFF_HELP = [
  { icon: "anchor", t: "Home", d: "What needs you, and what’s waiting on clients." },
  { icon: "key", t: "Studio", d: "Projects and their client links, clients, people, connections, and settings." },
  { icon: "play", t: "Review and Films", d: "Every version and its notes. Clients see only the newest." },
];

function Help({ onClose }) {
  const app = R.useContext(AppCtx);
  const brand = app.data.brand || {};
  const staff = isStaff(app.user);
  const support = brand.support || "alexis@gotit2work.com";
  return html`<${Modal} title=${staff ? "How the portal works" : "How your portal works"} onClose=${onClose} wide>
    ${app.demo ? html`<div class="alert"><b>This is a demo</b> with made-up projects. Click anything: nothing is saved or sent.</div>
      <div class="stack" style=${{ gap: "8px" }}><span class="muted small">See both sides:</span><${DemoSwitch} /></div>` : null}
    <div class="list">${(staff ? STAFF_HELP : HELP.filter((h) => !h.payments || app.data.projects.some((p) => p.caps.payments && (p.payments || []).length))).map((h) => html`<div class="li" key=${h.t}><${Icon} name=${h.icon} size=${30} /><div class="grow"><div class="name">${h.t}</div><div class="meta" style=${{ lineHeight: 1.55 }}>${h.d}</div></div></div>`)}</div>
    ${!staff && app.user.roleLabel ? html`<p class="muted small" style=${{ margin: 0, lineHeight: 1.6 }}>You’re a <b>${app.user.roleLabel}</b> for ${app.user.clientName || "your company"}.${app.user.access === "reviewer" ? " Your notes reach the studio and your company’s decision makers, who approve each version." : app.user.access === "viewer" ? " You can watch and download; your colleagues leave notes and approve." : ""}</p>` : null}
    <p class="muted small" style=${{ margin: 0, lineHeight: 1.6 }}>Stuck? ${staff ? "Email" : "Use Messages, or email"} <a href=${"mailto:" + support}>${support}</a>. <a href=${brand.privacy || "https://noblemanproductions.gotit2work.com/privacy#portal"}>Privacy</a></p>
    <div class="row"><button class="btn primary" onClick=${app.startTour}>Watch the tutorial</button><button class="btn ghost" onClick=${onClose}>Got it</button></div>
  <//>`;
}

window.ReactDOM.createRoot(document.getElementById("root")).render(html`<${Broke} whole><${App} /><//>`);
