// The way in: sign-in (the "screening room"), emailed sign-in links, two-step codes, first-run setup, and
// choosing a password. The left side is the reel playing behind a frame with a REC light and running timecode;
// the right side is the door, with the studio's Murphy's Law under it (Studio → Settings → Sign-in screen).
import { html, useState, useEffect, useRef, api, Icon, Field } from "./ui.js";
import { TwoStepSetup } from "./twostep.js";

const REEL = "https://player.vimeo.com/video/1197058424?h=796798a19d&background=1&autoplay=1&loop=1&muted=1&dnt=1&title=0&byline=0&portrait=0";

function Screen({ title, sub }) {
  const film = useRef(null);
  const [on, setOn] = useState(false);
  const [time, setTime] = useState("00:00:00:00");
  useEffect(() => {
    const t0 = Date.now();
    const p = (n) => String(n).padStart(2, "0");
    const iv = setInterval(() => {
      const f = Math.floor(((Date.now() - t0) / 1000) * 24);
      setTime(`${p(Math.floor(f / 86400) % 24)}:${p(Math.floor(f / 1440) % 60)}:${p(Math.floor(f / 24) % 60)}:${p(f % 24)}`);
    }, 1000 / 12);
    // The reel plays behind the poster on larger screens, and only fades in once it is really playing.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.innerWidth < 960;
    let alive = true;
    if (!still && film.current) {
      const f = document.createElement("iframe");
      f.src = REEL; f.title = "Nobleman Productions reel"; f.allow = "autoplay; fullscreen"; f.tabIndex = -1;
      film.current.appendChild(f);
      const wait = setInterval(() => {
        if (!window.Vimeo || !window.Vimeo.Player) return;
        clearInterval(wait);
        try {
          const pl = new window.Vimeo.Player(f);
          let errored = false;
          pl.on("error", () => { errored = true; if (alive) setOn(false); });
          pl.on("timeupdate", () => { if (alive && !errored) setOn(true); });
        } catch {}
      }, 120);
      setTimeout(() => clearInterval(wait), 15000);
    }
    return () => { alive = false; clearInterval(iv); };
  }, []);
  return html`<section class="screen" aria-label="Nobleman Productions">
    <div class="poster" aria-hidden="true"></div>
    <div class=${"film" + (on ? " on" : "")} ref=${film} aria-hidden="true"></div>
    <div class="grain" aria-hidden="true"></div>
    <div class="frame" aria-hidden="true"></div>
    <div class="hud" aria-hidden="true"><span class="rec"><i></i>REC</span><span>${time}</span></div>
    <h1>${title}</h1>
    ${sub ? html`<p class="sub">${sub}</p>` : null}
    <div class="feats" aria-label="What you can do here">
      <span><${Icon} name="play" size=${18} />Review every version</span>
      <span><${Icon} name="growth" size=${18} />Download finished films</span>
      <span><${Icon} name="send" size=${18} />Share files</span>
      <span><${Icon} name="bottle" size=${18} />Message the crew</span>
    </div>
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

function Door({ children, law, brand }) {
  return html`<section class="door"><div class="in">
    <img class="logo" src="/assets/Nobleman_Logo_White.png" alt=${(brand && brand.studio) || "Nobleman Productions"} style=${{ alignSelf: "flex-start" }} />
    ${children}
    ${law && law.quote ? html`<figure class="law">
      ${law.kicker ? html`<figcaption>${law.kicker}</figcaption>` : null}
      <blockquote>“${law.quote}”</blockquote>
      ${law.answer ? html`<p>${law.answer}</p>` : null}
    </figure>` : null}
  </div></section>`;
}

const post = (body) => api("/api/session", { method: "POST", body });

/** "Email me a link": a sign-in link, or a link to choose a new password. */
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
    <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${onBack}>Back to sign-in</button>
  </div>`;
  return html`<form onSubmit=${submit} noValidate>
    <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>${purpose === "reset"
      ? "We’ll email you a link to choose a new password. It works once, within an hour."
      : "We’ll email you a link that signs you in. No password needed. It works once, within 15 minutes."}</p>
    <${Field} label="Email"><input class="input" type="email" name="email" autoComplete="username" required value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
    ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
    <button class="btn primary lg" type="submit" disabled=${busy || !email.includes("@")}>${busy ? "Sending…" : purpose === "reset" ? "Email me a reset link" : "Email me a sign-in link"}</button>
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
    <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>${recovery ? "Type one of the recovery codes you saved when you turned on two-step sign-in. Each works once." : "Open your authenticator app and type the six-digit code it shows for this portal."}</p>
    <${Field} label=${recovery ? "Recovery code" : "Six-digit code"}>
      <input class="input code" name="code" autoFocus inputMode=${recovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength=${recovery ? 9 : 7} required value=${code} onInput=${(e) => setCode(e.target.value)} />
    <//>
    ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
    <button class="btn primary lg" type="submit" disabled=${busy || code.trim().length < 6}>${busy ? "Checking…" : "Sign in"}</button>
    <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${() => { setRecovery(!recovery); setCode(""); setErr(""); }}>${recovery ? "Use my authenticator app" : "Lost your phone? Use a recovery code"}</button>
  </form>`;
}

function Login({ session, onSignedIn, problem }) {
  const s = session || {};
  const next = new URLSearchParams(location.search).get("next") || (location.pathname !== "/" && location.pathname !== "/signin" ? location.pathname : "");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(problem || "");
  const [mode, setMode] = useState("password"); // password | signin-link | reset | code
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
  return html`<${Door} law=${s.signin} brand=${s.brand}>
    <div class="stack" style=${{ gap: "10px" }}>
      <span class="eyebrow"><span>Client portal</span><span class="dot"></span></span>
      <h2 class="h2">${mode === "code" ? "One more step" : mode === "reset" ? "Choose a new password" : "Sign in"}</h2>
    </div>
    ${mode === "code" ? html`<${CodeForm} ticket=${ticket} next=${next} onSignedIn=${onSignedIn} onRestart=${back} />`
      : mode === "signin-link" || mode === "reset" ? html`<${LinkForm} purpose=${mode === "reset" ? "reset" : "signin"} email=${email} setEmail=${setEmail} next=${next} onBack=${back} />`
      : html`<form onSubmit=${submit} noValidate>
      <${Field} label="Email"><input class="input" type="email" name="email" autoComplete="username" required value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
      <${Password} label="Password" name="password" auto="current-password" value=${pass} onInput=${setPass} />
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <button class="btn primary lg" type="submit" disabled=${busy}>${busy ? "Signing in…" : "Sign in"}</button>
      ${linksOn ? html`<button type="button" class="btn ghost" onClick=${() => { setMode("signin-link"); setErr(""); }}>Email me a sign-in link instead</button>` : null}
      <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${() => (s.email ? setMode("reset") : setForgot(!forgot))} aria-expanded=${forgot}>Forgot your password?</button>
      ${forgot ? html`<div class="alert info small">Email <a href=${"mailto:" + support + "?subject=Portal%20password"}>${support}</a> from the address you sign in with, and the studio will send you a link to choose a new one.</div>` : null}
    </form>`}
    ${mode === "password" ? html`<a class="demo-entry" href="/demo">
      <span><b>Just looking?</b><br /><span class="muted small">See a sample project. Nothing you do there is saved.</span></span>
      <span aria-hidden="true">→</span>
    </a>` : null}
    <div class="foot">
      <span>New client? The studio creates your account when your project starts.</span>
      <span><a href=${(s.brand && s.brand.privacy) || "https://noblemanproductions.gotit2work.com/privacy#portal"}>Privacy</a> · <a href=${(s.brand && s.brand.website) || "https://noblemanproductions.gotit2work.com"}>${String((s.brand && s.brand.website) || "noblemanproductions.gotit2work.com").replace(/^https:\/\//, "")}</a></span>
    </div>
  <//>`;
}

/** Opens a link from an email (/link/<token>): invitation, password reset, or sign-in. */
function Redeem({ session, onSignedIn, onPassword }) {
  const s = session || {};
  const token = location.pathname.split("/")[2] || "";
  const next = new URLSearchParams(location.search).get("next") || "";
  const [st, setSt] = useState({ phase: "busy" });
  const [email, setEmail] = useState("");
  useEffect(() => {
    post({ action: "redeem", token, next }).then((d) => {
      history.replaceState(null, "", next || "/");
      if (d.twoStep) return setSt({ phase: "code", ticket: d.ticket });
      if (d.user.mustChangePassword) return onPassword(d.user, d.next || next);
      onSignedIn(d.user, d.next || next);
    }).catch((e) => setSt({ phase: "error", error: e.message }));
  }, []);
  return html`<${Door} law=${s.signin} brand=${s.brand}>
    <div class="stack" style=${{ gap: "10px" }}>
      <span class="eyebrow"><span>Client portal</span><span class="dot"></span></span>
      <h2 class="h2">${st.phase === "error" ? "That link didn’t work" : st.phase === "code" ? "One more step" : "Opening your portal…"}</h2>
    </div>
    ${st.phase === "busy" ? html`<div class="boot-line"><i></i></div>` : null}
    ${st.phase === "code" ? html`<${CodeForm} ticket=${st.ticket} next=${next} onSignedIn=${(u, n) => (u.mustChangePassword ? onPassword(u, n) : onSignedIn(u, n))} onRestart=${() => location.assign("/")} />` : null}
    ${st.phase === "error" ? html`<div class="stack" style=${{ gap: "14px" }}>
      <div class="alert" role="alert">${st.error}</div>
      ${s.email ? html`<${LinkForm} purpose="signin" email=${email} setEmail=${setEmail} next=${next} onBack=${() => location.assign("/")} />`
        : html`<a class="btn primary" href="/">Go to sign-in</a>`}
    </div>` : null}
  <//>`;
}

function Setup({ ready, onDone, session }) {
  const [f, setF] = useState({ code: "", name: "", email: "", password: "", again: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target ? e.target.value : e });
  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.again) return setErr("The two passwords don’t match.");
    setBusy(true); setErr("");
    try {
      const d = await api("/api/session", { method: "POST", body: { action: "setup", code: f.code, name: f.name, email: f.email, password: f.password } });
      onDone(d.user);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return html`<${Door} brand=${session && session.brand}>
    <div class="stack" style=${{ gap: "10px" }}>
      <span class="eyebrow"><span>First-time setup</span><span class="dot"></span></span>
      <h2 class="h2">Set up the portal</h2>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>This creates the first owner account. You add the rest of the team and your clients from Studio afterwards.</p>
    </div>
    ${ready ? html`<form onSubmit=${submit}>
      <${Field} label="Setup code" hint="The BOOTSTRAP_SECRET value in Vercel → nobleman-portal → Settings → Environment Variables."><input class="input" name="code" autoComplete="off" required value=${f.code} onInput=${set("code")} /><//>
      <${Field} label="Your name"><input class="input" name="name" autoComplete="name" required value=${f.name} onInput=${set("name")} /><//>
      <${Field} label="Email"><input class="input" type="email" name="email" autoComplete="username" required value=${f.email} onInput=${set("email")} /><//>
      <${Password} label="Password (at least 10 characters)" name="new-password" auto="new-password" value=${f.password} onInput=${set("password")} />
      <${Password} label="Password again" name="again" auto="new-password" value=${f.again} onInput=${set("again")} />
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <button class="btn primary lg" disabled=${busy}>${busy ? "Setting up…" : "Create the owner account"}</button>
    </form>` : html`<div class="alert info">Setup is switched off. Add <b>BOOTSTRAP_SECRET</b> (any long random text) in Vercel → nobleman-portal → Settings → Environment Variables, redeploy, then reload this page.</div>`}
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
  return html`<${Door} brand=${session && session.brand} law=${session && session.signin}>
    <div class="stack" style=${{ gap: "10px" }}>
      <span class="eyebrow"><span>Welcome${user && user.name ? ", " + user.name.split(" ")[0] : ""}</span><span class="dot"></span></span>
      <h2 class="h2">Choose your password</h2>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>One only you know, of at least 10 characters. A short phrase is easy to remember and hard to guess.</p>
    </div>
    <form onSubmit=${submit}>
      <${Password} label="New password" name="new-password" auto="new-password" value=${pass} onInput=${setPass} />
      <${Password} label="New password again" name="again" auto="new-password" value=${again} onInput=${setAgain} />
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <button class="btn primary lg" disabled=${busy}>${busy ? "Saving…" : "Save and open the portal"}</button>
      <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${onSignOut}>Sign out</button>
    </form>
  <//>`;
}

/** Staff must turn on two-step sign-in before anything else (Studio → Settings → Security). */
function TwoStepRequired({ session, onDone, onSignOut, toast }) {
  return html`<${Door} brand=${session && session.brand}>
    <div class="stack" style=${{ gap: "10px" }}>
      <span class="eyebrow"><span>Before you continue</span><span class="dot"></span></span>
      <h2 class="h2">Turn on two-step sign-in</h2>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>The studio requires it for every staff account. It takes about a minute.</p>
    </div>
    <${TwoStepSetup} toast=${toast} onDone=${onDone} />
    <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${onSignOut}>Sign out</button>
  <//>`;
}

export function Gate({ mode, session, problem, onSignedIn, onSetupDone, onPasswordDone, onPasswordNeeded, onTwoStepDone, onSignOut, toast }) {
  const s = session || {};
  return html`<div class="gate">
    <${Screen}
      title=${html`Your private <em>screening room.</em>`}
      sub="Watch every version, leave notes on the exact moment, approve the final cut, and download your finished films. All in one place." />
    ${mode === "setup" ? html`<${Setup} ready=${s.setupReady} onDone=${onSetupDone} session=${s} />`
      : mode === "password" ? html`<${NewPassword} user=${s.user} onDone=${onPasswordDone} onSignOut=${onSignOut} session=${s} />`
      : mode === "link" ? html`<${Redeem} session=${s} onSignedIn=${onSignedIn} onPassword=${onPasswordNeeded} />`
      : mode === "twostep" ? html`<${TwoStepRequired} session=${s} onDone=${onTwoStepDone} onSignOut=${onSignOut} toast=${toast} />`
      : html`<${Login} session=${s} onSignedIn=${onSignedIn} problem=${problem} />`}
  </div>`;
}
