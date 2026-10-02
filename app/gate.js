// The way in: sign-in (the "screening room"), first-run setup, and choosing a new password. The left side is the
// reel playing behind a frame with a REC light and running timecode; the right side is the door.
import { html, useState, useEffect, useRef, api, Icon, Field } from "./ui.js";

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

function Door({ children }) {
  return html`<section class="door"><div class="in">
    <img class="logo" src="/assets/Nobleman_Logo_White.png" alt="Nobleman Productions" style=${{ alignSelf: "flex-start" }} />
    ${children}
  </div></section>`;
}

function Login({ onSignedIn, problem }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(problem || "");
  const [forgot, setForgot] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const d = await api("/api/session", { method: "POST", body: { action: "login", email, password: pass } });
      onSignedIn(d.user);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return html`<${Door}>
    <div class="stack" style=${{ gap: "10px" }}>
      <span class="eyebrow"><span>Client portal</span><span class="dot"></span></span>
      <h2 class="h2">Sign in</h2>
    </div>
    <form onSubmit=${submit} noValidate>
      <${Field} label="Email"><input class="input" type="email" name="email" autoComplete="username" required value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
      <${Password} label="Password" name="password" auto="current-password" value=${pass} onInput=${setPass} />
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <button class="btn primary lg" type="submit" disabled=${busy}>${busy ? "Signing in…" : "Sign in"}</button>
      <button type="button" class="link small" style=${{ alignSelf: "flex-start" }} onClick=${() => setForgot(!forgot)} aria-expanded=${forgot}>Forgot your password?</button>
      ${forgot ? html`<div class="alert info small">Nobleman resets passwords by hand, so nobody can do it in your name. Email <a href="mailto:alexis@gotit2work.com?subject=Portal%20password">alexis@gotit2work.com</a> from the address you sign in with, and you’ll get a temporary password to replace with your own.</div>` : null}
    </form>
    <a class="demo-entry" href="/demo">
      <span><b>Just looking?</b><br /><span class="muted small">See a sample project. Nothing you do there is saved.</span></span>
      <span aria-hidden="true">→</span>
    </a>
    <div class="foot">
      <span>New client? Nobleman creates your account when your project starts.</span>
      <span><a href="https://noblemanproductions.gotit2work.com/privacy#portal">Privacy</a> · <a href="https://noblemanproductions.gotit2work.com">noblemanproductions.gotit2work.com</a></span>
    </div>
  <//>`;
}

function Setup({ ready, onDone }) {
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
  return html`<${Door}>
    <div class="stack" style=${{ gap: "10px" }}>
      <span class="eyebrow"><span>First-time setup</span><span class="dot"></span></span>
      <h2 class="h2">Set up the portal</h2>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>This creates the first staff account. You can add Jean, Justin, and your clients from Studio afterwards.</p>
    </div>
    ${ready ? html`<form onSubmit=${submit}>
      <${Field} label="Setup code" hint="The BOOTSTRAP_SECRET value in Vercel → nobleman-portal → Settings → Environment Variables."><input class="input" name="code" autoComplete="off" required value=${f.code} onInput=${set("code")} /><//>
      <${Field} label="Your name"><input class="input" name="name" autoComplete="name" required value=${f.name} onInput=${set("name")} /><//>
      <${Field} label="Email"><input class="input" type="email" name="email" autoComplete="username" required value=${f.email} onInput=${set("email")} /><//>
      <${Password} label="Password (at least 10 characters)" name="new-password" auto="new-password" value=${f.password} onInput=${set("password")} />
      <${Password} label="Password again" name="again" auto="new-password" value=${f.again} onInput=${set("again")} />
      ${err ? html`<div class="alert" role="alert">${err}</div>` : null}
      <button class="btn primary lg" disabled=${busy}>${busy ? "Setting up…" : "Create the first staff account"}</button>
    </form>` : html`<div class="alert info">Setup is switched off. Add <b>BOOTSTRAP_SECRET</b> (any long random text) in Vercel → nobleman-portal → Settings → Environment Variables, redeploy, then reload this page.</div>`}
  <//>`;
}

function NewPassword({ user, onDone, onSignOut }) {
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
  return html`<${Door}>
    <div class="stack" style=${{ gap: "10px" }}>
      <span class="eyebrow"><span>Welcome${user && user.name ? ", " + user.name.split(" ")[0] : ""}</span><span class="dot"></span></span>
      <h2 class="h2">Choose your own password</h2>
      <p class="muted" style=${{ margin: 0, lineHeight: 1.6 }}>You signed in with a temporary password. Replace it with one only you know. At least 10 characters; a short phrase is easy to remember.</p>
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

export function Gate({ mode, session, problem, onSignedIn, onSetupDone, onPasswordDone, onSignOut }) {
  const s = session || {};
  return html`<div class="gate">
    <${Screen}
      title=${html`Your private <em>screening room.</em>`}
      sub="Watch every version, leave notes on the exact moment, approve the final cut, and download your finished films. All in one place." />
    ${mode === "setup" ? html`<${Setup} ready=${s.setupReady} onDone=${onSetupDone} />`
      : mode === "password" ? html`<${NewPassword} user=${s.user} onDone=${onPasswordDone} onSignOut=${onSignOut} />`
      : html`<${Login} onSignedIn=${onSignedIn} problem=${problem} />`}
  </div>`;
}
