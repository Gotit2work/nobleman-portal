// The way in, for everyone: clients, staff, and owners log in at the same door, and what they see next depends
// on their role. Also: creating an account (three short steps), emailed login links, two-step codes, first-run
// setup, and choosing a password. The left side is a camera at work, framed like a viewfinder (REC light, running
// timecode; the photo is chosen in Studio → Settings → Login screen); the right side is the door.
import { html, useState, useEffect, useRef, api, Icon, Field } from "./ui.js";
import { TwoStepSetup } from "./twostep.js";

/** Where the login photo comes from: one of the portal's own, or the one staff uploaded (served by the API). */
export function loginPhoto(signin) {
  const i = (signin && signin.image) || "/media/login-camera.jpg";
  const m = /^upload:brand\/login-([0-9a-f-]{36})\.jpg$/.exec(i);
  return m ? "/api/session?loginImage=" + m[1] : i;
}
export const FOCUS = { left: ["12%", "0%"], center: ["50%", "50%"], right: ["96%", "100%"] };

function Screen({ signin }) {
  const tc = useRef(null);
  useEffect(() => {
    const t0 = Date.now();
    const p = (n) => String(n).padStart(2, "0");
    const iv = setInterval(() => {
      const f = Math.floor(((Date.now() - t0) / 1000) * 24);
      if (tc.current) tc.current.textContent = `${p(Math.floor(f / 86400) % 24)}:${p(Math.floor(f / 1440) % 60)}:${p(Math.floor(f / 24) % 60)}:${p(f % 24)}`;
    }, 1000 / 12);
    return () => clearInterval(iv);
  }, []);
  return html`<section class="screen" aria-label="Nobleman Productions">
    <div class="poster" aria-hidden="true" style=${{ backgroundImage: `url('${loginPhoto(signin)}')`, "--x": (FOCUS[signin && signin.focus] || FOCUS.right)[0], "--xm": (FOCUS[signin && signin.focus] || FOCUS.right)[1] }}></div>
    <div class="grain" aria-hidden="true"></div>
    <div class="frame" aria-hidden="true"></div>
    <div class="hud" aria-hidden="true"><span class="rec"><i></i>REC</span><span ref=${tc}>00:00:00:00</span></div>
    <h1>The <em>screening room.</em></h1>
  </section>`;
}

function Password({ value, onInput, label, auto, name }) {
  const [show, setShow] = useState(false);
  return html`<${Field} label=${label}>
    <div class="pw">
      <input class="input" type=${show ? "text" : "password"} name=${name} autoComplete=${auto} required value=${value} onInput=${(e) => onInput(e.target.value)} />
      <button type="button" onClick=${() => setShow(!show)} aria-label=${show ? "Hide password" : "Show password"}>${show ? "Hide" : "Show"}</button>
    </div>
  <//>`;
}

function Door({ children, brand }) {
  return html`<section class="door"><div class="in">
    <img class="logo" src="/assets/Nobleman_Logo_White.png" alt=${(brand && brand.studio) || "Nobleman Productions"} />
    ${children}
  </div></section>`;
}

const post = (body) => api("/api/session", { method: "POST", body });

/** The three steps of creating an account, with the current one lit. */
function Steps({ at, labels }) {
  return html`<ol class="stepline" aria-label=${`Step ${at + 1} of ${labels.length}`}>
    ${labels.map((l, i) => html`<li key=${l} class=${i < at ? "done" : i === at ? "now" : ""} aria-current=${i === at ? "step" : undefined}>
      <i aria-hidden="true">${i < at ? "✓" : i + 1}</i><span>${l}</span></li>`)}
  </ol>`;
}
const SIGNUP_STEPS = ["Your details", "Confirm your email", "You’re in"];

/** Creating an account: name, work email, company. Nothing exists until they confirm the email. The very first
 *  account (no owner yet, `first`) is the studio's owner: just a name and email, and only their address works. */
function SignUp({ session, first }) {
  const [f, setF] = useState({ name: "", email: "", company: "", note: "" });
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const [again, setAgain] = useState(0);
  useEffect(() => { if (!again) return; const t = setTimeout(() => setAgain(again - 1), 1000); return () => clearTimeout(t); }, [again]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    if (e) e.preventDefault();
    setBusy(true); setErr("");
    try { await post({ action: "signup", ...f }); setSent(true); setAgain(30); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };
  if (sent) return html`<div class="stack signup" style=${{ gap: "18px" }}>
    <${Steps} at=${1} labels=${SIGNUP_STEPS} />
    <div class="bottle" aria-hidden="true"><${Icon} name="bottle" size=${44} /></div>
    <p style=${{ margin: 0, lineHeight: 1.6 }}>We sent a link to <b>${f.email}</b>. Open it on any device to confirm it’s you. It works for an hour.</p>
    <p class="muted small" style=${{ margin: 0, lineHeight: 1.6 }}>Not there? It can take a minute; check spam too.</p>
    <div class="row">
      <button type="button" class="btn ghost sm" disabled=${busy || again > 0} onClick=${() => submit()}>${again > 0 ? `Send it again (${again})` : "Send it again"}</button>
      <button type="button" class="link small" onClick=${() => { setSent(false); setErr(""); }}>Use a different email</button>
    </div>
    ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
  </div>`;
  return html`<form class="signup" onSubmit=${submit} noValidate>
    <${Steps} at=${0} labels=${SIGNUP_STEPS} />
    <${Field} label="Your name"><input class="input" name="name" autoComplete="name" required value=${f.name} onInput=${set("name")} /><//>
    ${first ? html`<${Field} label="Email"><input class="input" type="email" name="email" autoComplete="email" required value=${f.email} onInput=${set("email")} /><//>`
      : html`<${Field} label="Work email" hint="Use your company address: if your company already works with the studio, you’re in as soon as you confirm it.">
      <input class="input" type="email" name="email" autoComplete="email" required value=${f.email} onInput=${set("email")} />
    <//>
    <${Field} label="Company"><input class="input" name="company" autoComplete="organization" required value=${f.company} onInput=${set("company")} /><//>
    ${noteOpen ? html`<${Field} label="What are you working on? (optional)"><textarea class="textarea" rows="2" value=${f.note} onInput=${set("note")} placeholder="A launch film for March, for example."></textarea><//>`
      : html`<button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${() => setNoteOpen(true)}>Add a note for the studio</button>`}`}
    ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
    <button class="btn primary lg" type="submit" disabled=${busy || !f.name.trim() || !f.email.includes("@") || (!first && !f.company.trim())}>${busy ? "One moment…" : "Create my account"}</button>
  </form>`;
}

/** After confirming their email, when the studio still has to let them in. */
function Waiting({ name, studio }) {
  return html`<div class="stack signup" style=${{ gap: "18px" }}>
    <${Steps} at=${2} labels=${["Your details", "Email confirmed", "The studio lets you in"]} />
    <p style=${{ margin: 0, lineHeight: 1.6 }}>We’ve told ${studio || "the studio"}. When they set up your access, we’ll email you a link to choose your password, and you’re in.</p>
    <a class="link small" href="/" style=${{ alignSelf: "flex-start" }}>Back to login</a>
  </div>`;
}

/** "Email me a link": a login link, or a link to choose a new password. */
function LinkForm({ purpose, email, setEmail, next, onBack }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try { const d = await post({ action: "requestLink", email, purpose, next }); setSent(d.message); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };
  if (sent) return html`<div class="stack" style=${{ gap: "14px" }}>
    <div class="alert info" role="status"><b>Check your email.</b> ${sent}</div>
    <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${onBack}>Back to login</button>
  </div>`;
  return html`<form onSubmit=${submit} noValidate>
    <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>${purpose === "reset"
      ? "We’ll email you a link to choose a new password. It works once, within an hour."
      : "We’ll email you a link that signs you in. No password needed. It works once, within 15 minutes."}</p>
    <${Field} label="Email"><input class="input" type="email" name="email" autoComplete="username" required value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
    ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
    <button class="btn primary lg" type="submit" disabled=${busy || !email.includes("@")}>${busy ? "Sending…" : purpose === "reset" ? "Email me a reset link" : "Email me a login link"}</button>
    <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${onBack}>Use my password instead</button>
  </form>`;
}

/** The six-digit code after a correct password (or link), or a recovery code. */
function CodeForm({ ticket, next, onSignedIn, onRestart }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [recovery, setRecovery] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try { const d = await post({ action: "twoStep", ticket, code, next }); onSignedIn(d.user, d.next || next); }
    catch (x) { setErr(x.message); setBusy(false); if (x.data && x.data.restart) setTimeout(onRestart, 1600); }
  };
  return html`<form onSubmit=${submit} noValidate>
    <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>${recovery ? "Type one of the recovery codes you saved when you turned on two-step verification. Each works once." : "Open your authenticator app and type the six-digit code it shows for this portal."}</p>
    <${Field} label=${recovery ? "Recovery code" : "Six-digit code"}>
      <input class="input code" name="code" autoFocus inputMode=${recovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength=${recovery ? 9 : 7} required value=${code} onInput=${(e) => setCode(e.target.value)} />
    <//>
    ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
    <button class="btn primary lg" type="submit" disabled=${busy || code.trim().length < 6}>${busy ? "Checking…" : "Log in"}</button>
    <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${() => { setRecovery(!recovery); setCode(""); setErr(""); }}>${recovery ? "Use my authenticator app" : "Lost your phone? Use a recovery code"}</button>
  </form>`;
}

function Login({ session, onSignedIn, problem, start }) {
  const s = session || {};
  // An empty portal (no owner yet) opens on Create an account: the first account is the studio's owner.
  const signupOn = !!s.signup || !!s.firstRun;
  const next = new URLSearchParams(location.search).get("next") || (location.pathname !== "/" && location.pathname !== "/signin" ? location.pathname : "");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(problem || "");
  const [mode, setMode] = useState((start === "signup" || s.firstRun) && signupOn ? "signup" : "password"); // password | signup | signin-link | reset | code
  const [ticket, setTicket] = useState(null);
  const [forgot, setForgot] = useState(false);
  const linksOn = !!(s.email && s.signinLinks);
  const support = (s.brand && s.brand.support) || "alexis@gotit2work.com";
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const d = await post({ action: "login", email, password: pass });
      if (d.twoStep) { setTicket(d.ticket); setMode("code"); setBusy(false); return; }
      onSignedIn(d.user, next);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  const back = () => { setMode("password"); setErr(""); };
  const tab = (m) => { setMode(m); setErr(""); history.replaceState(null, "", m === "signup" ? "/signup" : location.pathname === "/signup" ? "/" : location.pathname + location.search); };
  const tabs = signupOn && (mode === "password" || mode === "signup");
  const title = mode === "code" ? "One more step" : mode === "reset" ? "Choose a new password" : mode === "signin-link" ? "Log in by email" : "Log in";
  return html`<${Door} brand=${s.brand}>
    ${tabs ? html`<div class="doortabs" data-on=${mode === "signup" ? "2" : "1"} role="tablist" aria-label="Log in or create an account">
      <i class="thumb" aria-hidden="true"></i>
      <button type="button" role="tab" aria-selected=${mode === "password"} onClick=${() => tab("password")}>Log in</button>
      <button type="button" role="tab" aria-selected=${mode === "signup"} onClick=${() => tab("signup")}>Create an account</button>
    </div>` : null}
    <h2 class=${"h2 door-title" + (tabs ? " sr-only" : "")}>${tabs && mode === "signup" ? "Create an account" : title}</h2>
    ${mode === "signup" ? html`<${SignUp} session=${s} first=${!!s.firstRun} />`
      : mode === "code" ? html`<${CodeForm} ticket=${ticket} next=${next} onSignedIn=${onSignedIn} onRestart=${back} />`
      : mode === "signin-link" || mode === "reset" ? html`<${LinkForm} purpose=${mode === "reset" ? "reset" : "signin"} email=${email} setEmail=${setEmail} next=${next} onBack=${back} />`
      : html`<form class="login" onSubmit=${submit} noValidate>
      <${Field} label="Email"><input class="input" type="email" name="email" autoComplete="username" required value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
      <${Password} label="Password" name="password" auto="current-password" value=${pass} onInput=${setPass} />
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <button class="btn primary lg" type="submit" disabled=${busy}>${busy ? "Logging in…" : "Log in"}</button>
      <div class="door-links">
        ${linksOn ? html`<button type="button" class="link small" onClick=${() => { setMode("signin-link"); setErr(""); }}>Email me a login link</button>` : null}
        <button type="button" class="link small" onClick=${() => (s.email ? setMode("reset") : setForgot(!forgot))} aria-expanded=${forgot}>Forgot your password?</button>
      </div>
      ${forgot ? html`<div class="alert info small">Email <a href=${"mailto:" + support + "?subject=Portal%20password"}>${support}</a> from the address you log in with, and the studio will send you a link to choose a new one.</div>` : null}
    </form>`}
    <div class="foot">
      ${!signupOn ? html`<span>No account yet? Ask the studio to invite you.</span>` : null}
      <span class="faint"><a href=${(s.brand && s.brand.privacy) || "https://noblemanproductions.gotit2work.com/privacy#portal"}>Privacy</a> · <a href=${(s.brand && s.brand.website) || "https://noblemanproductions.gotit2work.com"}>${String((s.brand && s.brand.website) || "noblemanproductions.gotit2work.com").replace(/^https:\/\//, "")}</a></span>
    </div>
  <//>`;
}

/** Opens a link from an email (/link/<token>): invitation, password reset, or login. */
function Redeem({ session, onSignedIn, onPassword }) {
  const s = session || {};
  const token = location.pathname.split("/")[2] || "";
  const next = new URLSearchParams(location.search).get("next") || "";
  const [st, setSt] = useState({ phase: "busy" });
  const [email, setEmail] = useState("");
  useEffect(() => {
    post({ action: "redeem", token, next }).then((d) => {
      history.replaceState(null, "", next || "/");
      if (d.signup === "waiting") return setSt({ phase: "waiting", name: d.name, studio: d.studio });
      if (d.twoStep) return setSt({ phase: "code", ticket: d.ticket });
      if (d.user.mustChangePassword) return onPassword(d.user, d.next || next);
      onSignedIn(d.user, d.next || next);
    }).catch((e) => setSt({ phase: "error", error: e.message }));
  }, []);
  return html`<${Door} brand=${s.brand}>
    <div class="stack" style=${{ gap: "10px" }}>
      <h2 class="h2 door-title">${st.phase === "error" ? "That link didn’t work" : st.phase === "code" ? "One more step" : st.phase === "waiting" ? `You’re on the list, ${String(st.name || "").split(" ")[0]}.` : "Opening your portal…"}</h2>
    </div>
    ${st.phase === "waiting" ? html`<${Waiting} name=${st.name} studio=${st.studio} />` : null}
    ${st.phase === "busy" ? html`<div class="boot-line"><i></i></div>` : null}
    ${st.phase === "code" ? html`<${CodeForm} ticket=${st.ticket} next=${next} onSignedIn=${(u, n) => (u.mustChangePassword ? onPassword(u, n) : onSignedIn(u, n))} onRestart=${() => location.assign("/")} />` : null}
    ${st.phase === "error" ? html`<div class="stack" style=${{ gap: "14px" }}>
      <div class="alert" role="alert">${st.error}</div>
      ${s.email ? html`<${LinkForm} purpose="signin" email=${email} setEmail=${setEmail} next=${next} onBack=${() => location.assign("/")} />`
        : html`<a class="btn primary" href="/">Go to login</a>`}
    </div>` : null}
  <//>`;
}

// ---------- a project's own link (/join/<token>) ----------
// The client's whole way in: which project this is, three short steps, and a short form. Their login is let in
// straight away and sees this project. Someone who already has a login logs in here and the project is added.
const DEMO_JOIN = {
  project: { title: "Meridian Campaign", client: "Meridian", type: "Brand campaign" }, studio: "Nobleman Productions", role: "approver", roleLabel: "Decision maker",
  can: ["Watch each new version", "Leave notes on any moment", "Approve a version, or ask for changes", "Download the finished films"], minPassword: 10, user: null, member: false,
};

function Join({ session, demo, onJoined }) {
  const s = session || {};
  const token = demo ? "" : location.pathname.split("/")[2] || "";
  const [info, setInfo] = useState(demo ? DEMO_JOIN : null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState("new"); // new | login | code | demo-done
  const [f, setF] = useState({ name: "", email: "", password: "", agree: false });
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState(null);
  useEffect(() => {
    if (demo) return;
    api("/api/session?join=" + encodeURIComponent(token)).then(setInfo).catch((e) => setErr(e.message || "This link isn’t working."));
  }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  // In the project: a new login, or one that's logged in (it's added to it).
  const enter = async (body) => {
    const d = await post({ action: "join", token, ...body });
    // A new login starts on Home (where the tutorial starts); one that already existed opens the project.
    onJoined(d.user, d.created ? "/" : "/projects/" + d.projectId);
  };
  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    if (demo) { setMode("demo-done"); setBusy(false); return; }
    try { await enter({ name: f.name, email: f.email, password: f.password, agree: f.agree }); }
    catch (x) {
      setErr(x.message); setBusy(false);
      if (x.data && x.data.exists) setMode("login");
    }
  };
  const login = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const d = await post({ action: "login", email: f.email, password: f.password });
      if (d.twoStep) { setTicket(d.ticket); setMode("code"); setBusy(false); return; }
      await enter({});
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  const logout = async () => { await post({ action: "logout" }).catch(() => {}); location.reload(); };
  const support = (s.brand && s.brand.support) || "alexis@gotit2work.com";
  const privacy = (info && info.privacy) || (s.brand && s.brand.privacy) || "https://noblemanproductions.gotit2work.com/privacy#portal";

  if (!info) return html`<${Door} brand=${s.brand}>
    ${err ? html`<div class="stack" style=${{ gap: "14px" }}>
      <h2 class="h2 door-title">That link didn’t work</h2>
      <div class="alert" role="alert">${err}</div>
      <a class="btn primary" href="/">Go to login</a>
    </div>` : html`<div class="boot-line"><i></i></div>`}
  <//>`;

  const p = info.project;
  const me = info.user;
  return html`<${Door} brand=${s.brand}>
    <div class="stack joinhead" style=${{ gap: "6px" }}>
      <span class="eyebrow">${info.studio} · Your project link</span>
      <h2 class="h2 door-title">${p.title}</h2>
      <span class="muted small">${p.client}${p.type ? " · " + p.type : ""}</span>
    </div>
    ${demo ? html`<div class="alert info small">A sample: here’s what a client sees when they open a project’s link. Nothing you type is saved.</div>` : null}

    ${mode === "demo-done" ? html`<div class="stack" style=${{ gap: "14px" }}>
      <div class="alert info" role="status"><b>Demo only:</b> in the real portal this creates ${f.name.trim() ? `a login for ${f.name.trim().split(" ")[0]}` : "their login"}, and they’re in ${p.title} straight away.</div>
      <a class="btn primary lg" href="/demo/projects/demo-meridian">See what they see</a>
    </div>`

    : me ? html`<div class="stack" style=${{ gap: "14px" }}>
      <p style=${{ margin: 0, lineHeight: 1.6 }}>You’re logged in as <b>${me.name}</b> (${me.email}).${info.member ? ` ${p.title} is already in your portal.` : ""}</p>
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <button class="btn primary lg" disabled=${busy} onClick=${async () => { setBusy(true); setErr(""); try { await enter({}); } catch (x) { setErr(x.message); setBusy(false); } }}>
        ${busy ? "One moment…" : info.member || me.staff ? `Open ${p.title}` : `Add ${p.title} to my portal`}</button>
      <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${logout}>Not you? Log out</button>
    </div>`

    : mode === "code" ? html`<${CodeForm} ticket=${ticket} next="" onSignedIn=${async () => { try { await enter({}); } catch (x) { setErr(x.message); setMode("login"); } }} onRestart=${() => setMode("login")} />`

    : mode === "login" ? html`<form onSubmit=${login} noValidate>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>Log in, and ${p.title} is added to your portal.</p>
      <${Field} label="Email"><input class="input" type="email" name="email" autoComplete="username" required value=${f.email} onInput=${set("email")} /><//>
      <${Password} label="Password" name="password" auto="current-password" value=${f.password} onInput=${(v) => setF({ ...f, password: v })} />
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <button class="btn primary lg" type="submit" disabled=${busy || !f.email.includes("@") || !f.password}>${busy ? "Logging in…" : `Log in and open ${p.title}`}</button>
      <div class="door-links">
        <button type="button" class="link small" onClick=${() => { setMode("new"); setErr(""); }}>I’m new: create my login</button>
        <a class="link small" href=${"/signin?next=" + encodeURIComponent(location.pathname)}>Forgot your password?</a>
      </div>
    </form>`

    : html`<ol class="joinsteps">
        <li><b>Create your login</b><span>Your name, email, and a password you choose.</span></li>
        <li><b>You’re in straight away</b><span>Next time, log in with the same email and password.</span></li>
        <li><b>Then you can</b><span>${info.can.join(" · ")}</span></li>
      </ol>
      <form onSubmit=${create} noValidate>
        <${Field} label="Your name"><input class="input" name="name" autoComplete="name" required value=${f.name} onInput=${set("name")} /><//>
        <${Field} label="Email"><input class="input" type="email" name="email" autoComplete="email" required value=${f.email} onInput=${set("email")} /><//>
        <${Password} label=${`Choose a password (at least ${info.minPassword || 10} characters)`} name="new-password" auto="new-password" value=${f.password} onInput=${(v) => setF({ ...f, password: v })} />
        <label class="ack"><input type="checkbox" class="check-box" checked=${f.agree} onChange=${set("agree")} />
          <span>I’m working on <b>${p.title}</b> with ${p.client}, and I’ll share this link only with people on the project.</span></label>
        ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
        <button class="btn primary lg" type="submit" disabled=${busy || !f.name.trim() || !f.email.includes("@") || f.password.length < (info.minPassword || 10) || !f.agree}>${busy ? "One moment…" : "Create my login"}</button>
        <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${() => { setMode("login"); setErr(""); }}>Already have a login? Log in instead</button>
      </form>`}

    <div class="foot">
      <span>Questions? Email <a href=${"mailto:" + support}>${support}</a>.</span>
      <span class="faint"><a href=${privacy}>How we handle your information</a></span>
    </div>
  <//>`;
}

function NewPassword({ user, onDone, onSignOut, session }) {
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (pass !== again) return setErr("The two passwords don’t match.");
    setBusy(true); setErr("");
    try {
      const d = await api("/api/session", { method: "POST", body: { action: "password", next: pass } });
      onDone(d.user);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return html`<${Door} brand=${session && session.brand}>
    <div class="stack" style=${{ gap: "10px" }}>
      <span class="eyebrow">Welcome${user && user.name ? ", " + user.name.split(" ")[0] : ""}</span>
      <h2 class="h2">Choose your password</h2>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>${user && user.clientName ? html`You’re joining <b style=${{ color: "var(--ink)" }}>${user.clientName}</b>. ` : null}One only you know, of at least 10 characters. A short phrase is easy to remember and hard to guess.</p>
    </div>
    <form onSubmit=${submit}>
      <${Password} label="New password" name="new-password" auto="new-password" value=${pass} onInput=${setPass} />
      <${Password} label="New password again" name="again" auto="new-password" value=${again} onInput=${setAgain} />
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <button class="btn primary lg" disabled=${busy}>${busy ? "Saving…" : "Save and open the portal"}</button>
      <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${onSignOut}>Log out</button>
    </form>
  <//>`;
}

/** Staff must turn on two-step verification before anything else (Studio → Settings → Security). */
function TwoStepRequired({ session, onDone, onSignOut, toast }) {
  return html`<${Door} brand=${session && session.brand}>
    <div class="stack" style=${{ gap: "10px" }}>
      <span class="eyebrow">Before you continue</span>
      <h2 class="h2">Turn on two-step verification</h2>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>The studio requires it for every staff account. It takes about a minute.</p>
    </div>
    <${TwoStepSetup} toast=${toast} onDone=${onDone} />
    <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${onSignOut}>Log out</button>
  <//>`;
}

export function Gate({ mode, session, problem, start, demo, onSignedIn, onPasswordDone, onPasswordNeeded, onTwoStepDone, onSignOut, toast }) {
  const s = session || {};
  return html`<div class="gate">
    <${Screen} signin=${s.signin} />
    ${mode === "password" ? html`<${NewPassword} user=${s.user} onDone=${onPasswordDone} onSignOut=${onSignOut} session=${s} />`
      : mode === "link" ? html`<${Redeem} session=${s} onSignedIn=${onSignedIn} onPassword=${onPasswordNeeded} />`
      : mode === "join" ? html`<${Join} session=${s} demo=${demo} onJoined=${onSignedIn} />`
      : mode === "twostep" ? html`<${TwoStepRequired} session=${s} onDone=${onTwoStepDone} onSignOut=${onSignOut} toast=${toast} />`
      : html`<${Login} session=${s} onSignedIn=${onSignedIn} problem=${problem} start=${start} />`}
  </div>`;
}
