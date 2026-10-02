// Shared building blocks for the portal: templating (htm on React, no build step), app context, the API client,
// formatting, and small components. Screens import from here.
import htm from "/vendor/htm-3.1.1.module.js";

const R = window.React;
export const { useState, useEffect, useRef, useMemo, useCallback, useContext, createContext, Fragment } = R;
export const html = htm.bind(R.createElement);

/** App-wide state and actions (see main.js): data, user, demo, base, go(), toast(), reload(), setData(). */
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

/** JSON API call. Throws an Error whose message is the server's plain-words explanation. */
export async function api(path, { method = "GET", body } = {}) {
  let r;
  try {
    r = await fetch(path, {
      method, credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error("We couldn’t reach the portal. Check your connection and try again."), { status: 0 });
  }
  let d = null;
  try { d = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error((d && d.error) || "Something went wrong. Try again in a moment."), { status: r.status, data: d });
  return d || {};
}

// ---------- formatting ----------
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
export function fmtDate(iso, withTime) {
  if (!iso) return "";
  const d = new Date(iso);
  const o = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
  if (withTime) Object.assign(o, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleString("en-US", o);
}
export function fmtAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return plural(Math.floor(s / 60), "minute") + " ago";
  if (s < 86400) return plural(Math.floor(s / 3600), "hour") + " ago";
  if (s < 7 * 86400) return plural(Math.floor(s / 86400), "day") + " ago";
  return fmtDate(iso);
}
export function fmtBytes(n) {
  if (!n) return "";
  const u = ["bytes", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + " " + u[i];
}
export function tc(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (x) => String(x).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
export const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
export const firstName = (name) => String(name || "").split(/\s+/)[0] || "";
export const ext = (name) => (String(name).match(/\.([a-z0-9]{1,5})$/i) || [, "file"])[1].toUpperCase();

// ---------- components ----------
export function Icon({ name, size = 24, cls = "" }) {
  const url = `url(/media/icons/${name}.png)`;
  return html`<span class=${"ic " + cls} aria-hidden="true" style=${{ width: size + "px", height: size + "px", WebkitMaskImage: url, maskImage: url }}></span>`;
}

export function Eyebrow({ children, dot }) {
  return html`<span class="eyebrow"><span>${children}</span>${dot ? html`<span class="dot"></span>` : null}</span>`;
}

/** Page header: eyebrow, title, one-line purpose, and actions on the right. */
export function Head({ eyebrow, title, children, actions }) {
  return html`<header class="head">
    <div class="t">
      ${eyebrow ? html`<${Eyebrow} dot>${eyebrow}<//>` : null}
      <h1 class="h1">${title}</h1>
      ${children ? html`<p>${children}</p>` : null}
    </div>
    ${actions ? html`<div class="row">${actions}</div>` : null}
  </header>`;
}

export function Empty({ icon = "anchor", title, children, action }) {
  return html`<div class="empty" data-reveal="">
    <${Icon} name=${icon} size=${40} />
    <h3>${title}</h3>
    <p>${children}</p>
    ${action || null}
  </div>`;
}

export function Avatar({ name, staff, size = 34 }) {
  const st = { width: size + "px", height: size + "px", fontSize: Math.round(size * 0.37) + "px" };
  return staff
    ? html`<span class="avatar staff" style=${st} title=${name}><img src="/assets/Nobleman_Mark_White.png" alt="" /></span>`
    : html`<span class="avatar" style=${st} title=${name}>${initials(name)}</span>`;
}

export function Toggle({ checked, onChange, label, disabled }) {
  return html`<button type="button" class="toggle" role="switch" aria-checked=${checked ? "true" : "false"} aria-label=${label}
    disabled=${disabled} onClick=${() => onChange(!checked)}></button>`;
}

export function Field({ label, hint, children }) {
  return html`<label class="field"><span>${label}</span>${children}${hint ? html`<small>${hint}</small>` : null}</label>`;
}

/** The six stages as a bar. */
const SHORT_STAGE = { "Your review": "Review", "Final polish": "Polish" };

/** The six-step progress strip. `short` uses one-word labels so it fits in a card. */
export function Stages({ stage, names, short }) {
  return html`<div class="stages" role="img" aria-label=${"Stage " + (stage + 1) + " of " + names.length + ": " + names[stage]} style=${{ gridTemplateColumns: `repeat(${names.length}, 1fr)` }}>
    ${names.map((n, i) => html`<div key=${n + i} class=${"s" + (i < stage ? " done" : i === stage ? " now" : "")}><i></i><span>${short ? SHORT_STAGE[n] || n : n}</span></div>`)}
    <p class="stages-now" aria-hidden="true">Step ${stage + 1} of ${names.length} · <b>${names[stage]}</b></p>
  </div>`;
}

/** "Fri, Oct 9" from "2026-10-09". */
export function fmtDay(d) {
  if (!d) return "";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** A dialog. Escape and the × close it; focus moves into it and back out. */
export function Modal({ title, onClose, wide, children, label }) {
  const box = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const first = box.current && box.current.querySelector("input, textarea, select, button:not(.x)");
    if (first) first.focus();
    document.documentElement.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.documentElement.style.overflow = ""; if (prev && prev.focus) prev.focus(); };
  }, []);
  return html`<div class="scrim" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${"dialog" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label=${label || title} ref=${box}>
      <button class="x" aria-label="Close" onClick=${onClose}>×</button>
      ${title ? html`<h2 class="h2" style=${{ paddingRight: "40px" }}>${title}</h2>` : null}
      ${children}
    </div>
  </div>`;
}

/** Asks before anything hard to undo. `yes` names the action ("Yes, approve Version 3"). */
export function Confirm({ title, children, yes, no = "Not yet", danger, busy, onYes, onNo }) {
  return html`<${Modal} title=${title} onClose=${onNo}>
    <div class="muted" style=${{ lineHeight: 1.6, fontSize: "15.5px" }}>${children}</div>
    <div class="row">
      <button class=${"btn " + (danger ? "solid-red" : "primary")} disabled=${busy} onClick=${onYes}>${busy ? "One moment…" : yes}</button>
      <button class="btn ghost" onClick=${onNo}>${no}</button>
    </div>
  <//>`;
}

/** A link inside the app: changes the page without reloading it. */
export function Link({ to, children, cls, current, label, onClick }) {
  const { go, base } = useApp();
  const href = base + to;
  return html`<a href=${href} class=${cls} aria-current=${current ? "page" : undefined} aria-label=${label}
    onClick=${(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); if (onClick) onClick(); go(to); }}>${children}</a>`;
}

/** Copies text and says so. */
export async function copy(text, toast, what = "Link") {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied.`); }
  catch { window.prompt("Copy this:", text); }
}

/** May this staff member do `perm` (their role's permissions, from the server)? Clients never can. */
export const can = (user, perm) => !!(user && user.role === "admin" && user.perms && user.perms[perm]);
export const isStaff = (user) => !!(user && user.role === "admin");

/** Starts a file download in the browser from text (caption files some sources hand over as text). */
export function saveText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- the player ----------
// One player for every source (see api/_video.js, "playback"):
//   vimeo    Vimeo's embed with its Player API          youtube  YouTube's privacy-enhanced embed with its API
//   file     an ordinary <video> (Frame.io, Wistia,     iframe   another site's player (Google Drive, Loom):
//            direct links); signed addresses are                 plays, but notes can't know the moment
//            fetched fresh when the player opens
// apiRef.current gets { time(), seek(t), pause(), play(), timed } so Review can pin notes to the moment.

const scripts = {};
function loadScript(src, ready) {
  if (ready()) return Promise.resolve(true);
  if (!scripts[src]) {
    scripts[src] = new Promise((resolve) => {
      if (!document.querySelector(`script[src="${src}"]`)) { // index.html already loads Vimeo's
        const s = document.createElement("script");
        s.src = src; s.async = true;
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      }
      let n = 0;
      const t = setInterval(() => { if (ready() || ++n > 150) { clearInterval(t); resolve(ready()); } }, 100);
    });
  }
  return scripts[src];
}
const vimeoReady = () => loadScript("https://player.vimeo.com/api/player.js", () => !!(window.Vimeo && window.Vimeo.Player));
const ytReady = () => loadScript("https://www.youtube.com/iframe_api", () => !!(window.YT && window.YT.Player));

/**
 * Plays one video. `source` says where a signed file address comes from: { project, video } (portal) or
 * { share } (a public share link). `onPlay` fires once, the first time it plays. `mark` is a corner label
 * ("Preview · Version 3") shown over versions under review.
 */
export function Player({ video, onTime, apiRef, vertical, start = 0, source, onPlay, mark }) {
  const box = useRef(null);
  const pb = (video && video.playback) || {};
  const key = video ? `${video.id}:${pb.kind}:${pb.id || pb.url || ""}` : "";
  useEffect(() => {
    if (!video || !box.current) return;
    box.current.textContent = "";
    let alive = true, played = false, last = 0;
    const local = { t: 0 };
    const tick = (t) => { local.t = t; if (onTime && Math.abs(t - last) >= 0.25) { last = t; onTime(t); } };
    const playedOnce = () => { if (!played) { played = true; if (onPlay) onPlay(); } };
    const handle = { time: () => local.t, seek() {}, pause() {}, play() {}, timed: pb.kind !== "iframe" };
    if (apiRef) apiRef.current = handle;
    const frame = (src) => {
      const f = document.createElement("iframe");
      f.src = src; f.title = video.title || "Film";
      f.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
      f.setAttribute("allowfullscreen", ""); f.referrerPolicy = "strict-origin-when-cross-origin";
      box.current.appendChild(f);
      return f;
    };

    if (pb.kind === "vimeo") {
      const q = new URLSearchParams({ ...(pb.hash ? { h: pb.hash } : {}), title: 0, byline: 0, portrait: 0, dnt: 1, playsinline: 1, pip: 1 });
      const f = frame(`https://player.vimeo.com/video/${encodeURIComponent(pb.id)}?${q}${start ? "#t=" + Math.floor(start) + "s" : ""}`);
      vimeoReady().then((ok) => {
        if (!ok || !alive) return;
        try {
          const pl = new window.Vimeo.Player(f);
          handle.seek = (t) => pl.setCurrentTime(t).then(() => pl.play()).catch(() => {});
          handle.pause = () => pl.pause().catch(() => {});
          handle.play = () => pl.play().catch(() => {});
          pl.on("timeupdate", (e) => tick(e.seconds));
          pl.on("seeked", (e) => { local.t = e.seconds; if (onTime) onTime(e.seconds); });
          pl.on("play", playedOnce);
        } catch { /* the film still plays; notes just start at 0:00 */ }
      });
    } else if (pb.kind === "youtube") {
      const holder = document.createElement("div");
      box.current.appendChild(holder);
      let poll = null;
      ytReady().then((ok) => {
        if (!ok || !alive) { if (alive) frame(`https://www.youtube-nocookie.com/embed/${pb.id}?rel=0&playsinline=1`); return; }
        const pl = new window.YT.Player(holder, {
          host: "https://www.youtube-nocookie.com", videoId: pb.id,
          playerVars: { rel: 0, playsinline: 1, modestbranding: 1, start: Math.floor(start) || 0 },
          events: {
            onStateChange: (e) => {
              clearInterval(poll);
              if (e.data === 1) { playedOnce(); poll = setInterval(() => tick(pl.getCurrentTime()), 250); }
            },
          },
        });
        handle.seek = (t) => { try { pl.seekTo(t, true); pl.playVideo(); } catch {} };
        handle.pause = () => { try { pl.pauseVideo(); } catch {} };
        handle.play = () => { try { pl.playVideo(); } catch {} };
      });
      handle.stop = () => clearInterval(poll);
    } else if (pb.kind === "file") {
      const v = document.createElement("video");
      v.controls = true; v.playsInline = true; v.preload = "metadata";
      if (video.thumbnail) v.poster = video.thumbnail;
      v.addEventListener("timeupdate", () => tick(v.currentTime));
      v.addEventListener("seeked", () => { local.t = v.currentTime; if (onTime) onTime(v.currentTime); });
      v.addEventListener("play", playedOnce);
      box.current.appendChild(v);
      handle.seek = (t) => { v.currentTime = t; v.play().catch(() => {}); };
      handle.pause = () => v.pause();
      handle.play = () => v.play().catch(() => {});
      // Signed addresses expire: fetch a fresh one now, and once more if it has expired by the time it plays.
      let tries = 0;
      const fresh = () => {
        if (pb.url) return Promise.resolve(pb.url);
        const q = source && source.share ? `/api/share?token=${encodeURIComponent(source.share)}&play=1`
          : `/api/media?project=${encodeURIComponent(source.project)}&video=${encodeURIComponent(video.id)}&play=1`;
        return api(q).then((d) => d.url);
      };
      const load = () => fresh().then((url) => { if (alive) { v.src = url; if (start) v.currentTime = start; } }).catch((e) => {
        if (alive && box.current) { const p = document.createElement("p"); p.className = "player-msg"; p.textContent = e.message; box.current.appendChild(p); }
      });
      v.addEventListener("error", () => { if (!pb.url && tries++ < 1) load(); });
      load();
    } else {
      frame(pb.url || "about:blank");
    }
    if (mark) {
      const m = document.createElement("span");
      m.className = "player-mark"; m.setAttribute("aria-hidden", "true"); m.textContent = mark;
      box.current.appendChild(m);
    }
    return () => { alive = false; if (handle.stop) handle.stop(); if (apiRef && apiRef.current === handle) apiRef.current = null; };
  }, [key]);
  return html`<div class=${"player" + (vertical ? " v" : "")} ref=${box}></div>`;
}
