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

const R = window.React;

/** Splits /review/<project>/<cut>/<n> into ["review", project, cut, n] (relative to the base). */
function routeOf(path, base) {
  const p = base && path.startsWith(base) ? path.slice(base.length) : path;
  return p.split("/").filter(Boolean).map(decodeURIComponent);
}

function App() {
  const [st, setSt] = useState({ phase: "boot" });
  const [path, setPath] = useState(location.pathname);
  const [toasts, setToasts] = useState([]);
  const [help, setHelp] = useState(false);
  const [more, setMore] = useState(false);

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
    const target = next && /^\/(?!\/)/.test(next) ? next : /^\/(link|signin|signup|login)(\/|$)/.test(location.pathname) ? "/" : location.pathname;
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
    try {
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
    await api("/api/session", { method: "POST", body: { action: "logout" } }).catch(() => {});
    history.replaceState(null, "", "/");
    setPath("/");
    setSt({ phase: "gate", gate: "login", session: {} });
  }, [st.demo]);

  if (st.phase === "boot") return html`<div class="boot" role="status" aria-label="Loading the portal"><img src="/assets/Nobleman_Mark_White.png" alt="" /><div class="bar"><i></i></div><div class="eyebrow">Private screening room</div></div>`;
  if (st.phase === "watch") return html`<${Watch} token=${location.pathname.split("/")[2] || ""} /><${Toasts} items=${toasts} />`;
  if (st.phase === "gate") {
    return html`<${Gate} mode=${st.gate} session=${st.session} problem=${st.problem} start=${st.start}
      onSignedIn=${signedIn} onSetupDone=${signedIn}
      onPasswordNeeded=${(user, next) => setSt({ phase: "gate", gate: "password", session: { ...(st.session || {}), user }, next })}
      onPasswordDone=${(user) => signedIn(user, st.next)}
      onTwoStepDone=${() => signedIn(st.session.user, st.next)}
      onSignOut=${signOut} toast=${toast} />
      <${Toasts} items=${toasts} />`;
  }

  const ctx = { ...st, user: st.data.user, go, toast, say, reload, setData, signOut, openHelp: () => setHelp(true), path, switchDemo };
  return html`<${AppCtx.Provider} value=${ctx}>
    <${Shell} route=${routeOf(path, st.base)} more=${more} setMore=${setMore} />
    ${help ? html`<${Help} onClose=${() => setHelp(false)} />` : null}
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
        ${items.map((it, i) => html`<${Link} key=${it.key} to=${"/" + it.key} cls="rail-item" current=${isNavTop && i === activeIdx}>
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
      ${demo ? html`<button class="demo-chip" onClick=${app.openHelp}>Demo</button>` : null}
      <button class="round" onClick=${app.openHelp} aria-label="Help: how this portal works">?</button>
      <${Link} to="/account" cls="round" label=${"Your account: " + user.name}><${Avatar} name=${user.name} size=${30} /><//>
    </header>

    ${demo ? html`<${DemoRibbon} />` : null}

    ${data.announcement ? html`<div class=${"announce " + (data.announcement.tone === "warning" ? "warn" : "")} role="status">${data.announcement.text}</div>` : null}
    <main id="main">${screen}</main>

    <nav class="bottombar" aria-label="Main">
      ${mobileItems.map((it) => html`<${Link} key=${it.key} to=${"/" + it.key} cls="tab" current=${isNavTop && it.key === (items[activeIdx] || {}).key}>
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
  const app = R.useContext(AppCtx);
  return html`<div style=${{ position: "fixed", top: "18px", right: "22px", zIndex: 55 }} class="rail-only-desktop">
    <div class="row" style=${{ gap: "8px" }}>
      <${DemoSwitch} />
      <button class="demo-chip" onClick=${app.openHelp} title="Nothing here is saved or sent. Click for what that means.">Demo · sample project</button>
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
  { icon: "anchor", t: "Home", d: "Starts with your next step: the one thing that needs you now. Below it, each project and how far along it is." },
  { icon: "play", t: "Review", d: "Watch the newest version of each film. Pause anywhere and leave a note pinned to that moment. When it’s right, approve it; if not, ask for changes." },
  { icon: "growth", t: "Films", d: "Your finished films. Watch them here and, where it’s switched on, download them, get caption files, or create a link to share." },
  { icon: "send", t: "Files", d: "Documents from the studio, like quotes and schedules, and anything you send: logos, footage, references." },
  { icon: "bottle", t: "Messages", d: "Write to the studio about a project. Your conversation stays with the project." },
];
const STAFF_HELP = [
  { icon: "anchor", t: "Home", d: "What needs you: versions waiting on clients, change requests, unread messages, and what clients did lately." },
  { icon: "key", t: "Studio", d: "Projects and their video sources, clients, people and roles, connections (Vimeo, Frame.io, YouTube, Wistia, Notion, email), settings, and the activity log." },
  { icon: "play", t: "Review and Films", d: "See every version, reply to notes, and check what the client sees. Clients see only the newest version unless Earlier versions is on." },
];

function Help({ onClose }) {
  const app = R.useContext(AppCtx);
  const brand = app.data.brand || {};
  const staff = isStaff(app.user);
  const support = brand.support || "alexis@gotit2work.com";
  return html`<${Modal} title=${staff ? "How the portal works" : "How your portal works"} onClose=${onClose} wide>
    ${app.demo ? html`<div class="alert"><b>This is a demo.</b> The client, projects, and files are made up. Click anything you like: nothing here is saved or sent.</div>
      <div class="stack" style=${{ gap: "8px" }}><span class="muted small" style=${{ lineHeight: 1.55 }}>Everyone logs in at the same door; what they see depends on who they are. Switch to see both sides:</span><${DemoSwitch} /></div>` : null}
    <div class="list">${(staff ? STAFF_HELP : HELP).map((h) => html`<div class="li" key=${h.t}><${Icon} name=${h.icon} size=${30} /><div class="grow"><div class="name">${h.t}</div><div class="meta" style=${{ lineHeight: 1.55 }}>${h.d}</div></div></div>`)}</div>
    ${!staff && app.user.roleLabel ? html`<p class="muted small" style=${{ margin: 0, lineHeight: 1.6 }}>You’re a <b>${app.user.roleLabel}</b> for ${app.user.clientName || "your company"}.${app.user.access === "reviewer" ? " Your notes reach the studio and your company’s decision makers, who approve each version." : app.user.access === "viewer" ? " You can watch and download; your colleagues leave notes and approve." : ""}</p>` : null}
    <p class="muted small" style=${{ margin: 0, lineHeight: 1.6 }}>Some parts only appear when the studio switches them on for your project. Stuck? Use Messages, or email <a href=${"mailto:" + support}>${support}</a>. How we handle your information: <a href=${brand.privacy || "https://noblemanproductions.gotit2work.com/privacy#portal"}>Privacy</a>.</p>
    <div><button class="btn primary" onClick=${onClose}>Got it</button></div>
  <//>`;
}

window.ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);
