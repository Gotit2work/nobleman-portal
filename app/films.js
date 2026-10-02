// Films: finished films to watch, download, caption, and share, as far as each project allows.
import { html, useApp, useState, useEffect, useRef, api, Head, Empty, Link, Player, Icon, Field, Confirm, copy, fmtDate, fmtAgo, plural, saveText, isStaff } from "./ui.js";

const POSTER = "/media/screening-poster.jpg";

export function Films({ pid, vid }) {
  const { data, user } = useApp();
  const admin = isStaff(user);
  const all = data.projects.flatMap((p) => p.films.map((f) => ({ f, p })));
  if (vid) {
    const hit = all.find((x) => x.f.id === vid && (!pid || x.p.id === pid));
    if (hit) return html`<${Film} p=${hit.p} f=${hit.f} key=${hit.f.id} />`;
  }
  const scope = pid ? data.projects.filter((p) => p.id === pid) : data.projects;
  const groups = scope.filter((p) => p.films.length);
  return html`<div class="page">
    <${Head} eyebrow="Films" title="Your finished films.">
      Watch them here${scope.some((p) => p.caps.download) ? ", download the sizes you need" : ""}${scope.some((p) => p.caps.share) ? ", or send a link to someone outside your company" : ""}.
    <//>
    ${pid && data.projects.length > 1 ? html`<p style=${{ marginTop: "-18px", marginBottom: "28px" }}><${Link} to="/films" cls="link">See films from every project<//></p>` : null}
    ${scope.some((p) => p.videosError) ? html`<div class="alert" style=${{ marginBottom: "20px" }}>${scope.find((p) => p.videosError).videosError}</div>` : null}
    ${!groups.length ? html`<${Empty} icon="growth" title="No finished films yet.">
        They appear here as soon as the studio delivers them. ${data.projects.some((p) => p.cuts.length && p.caps.review) ? "Versions still in progress are in Review." : ""}
        ${admin ? " Finished films are the videos at a project’s source without a version number in the title (or marked “Finished film” in Studio)." : ""}
      <//>`
    : groups.map((p) => html`<section class=${groups.length > 1 ? "section" : ""} key=${p.id}>
        ${groups.length > 1 || admin ? html`<div class="sh"><span class="eyebrow"><span>${admin ? p.clientName + " · " : ""}${p.title}</span></span><span class="muted small">${plural(p.films.length, "film")}</span></div>` : null}
        <div class="grid c3">${p.films.map((f) => html`<div key=${f.id}><${Link} to=${`/films/${p.id}/${f.id}`} cls="fcard" label=${"Watch " + f.title}>
          <div class=${"img" + (f.vertical ? " v" : "")}><img src=${f.thumbnail || POSTER} alt="" loading="lazy" onError=${(e) => { e.target.onerror = null; e.target.src = POSTER; }} /><span class="play" aria-hidden="true"></span>${f.durationLabel ? html`<span class="tag">${f.durationLabel}</span>` : null}</div>
          <span class="t">${f.title}</span>
          <span class="muted small">${[f.resolution, f.created ? "Delivered " + fmtDate(f.created) : "", typeof f.plays === "number" ? plural(f.plays, "play") : ""].filter(Boolean).join(" · ")}</span>
        <//></div>`)}</div>
      </section>`)}
  </div>`;
}

const DEMO_EXTRAS = {
  downloads: { links: [
    { label: "Original file", sizeLabel: "38.2 GB", source: true, link: "#" },
    { label: "HD 1080p", sizeLabel: "2.1 GB", link: "#" },
    { label: "SD 540p", sizeLabel: "410 MB", link: "#" },
  ], onSite: null, reason: null },
  captions: [{ label: "English (CC)", language: "en", link: "#" }],
  chapters: [{ title: "Opening", at: 0 }, { title: "On the water", at: 48 }, { title: "The reveal", at: 132 }],
};

function Film({ p, f }) {
  const { demo, say, toast, user } = useApp();
  const staff = isStaff(user);
  const player = useRef(null);
  const [x, setX] = useState(demo ? DEMO_EXTRAS : null);
  const [err, setErr] = useState("");
  const wants = p.caps.download || p.caps.captions;
  useEffect(() => {
    if (demo || !wants) return;
    api(`/api/media?project=${p.id}&video=${f.id}`).then(setX).catch((e) => setErr(e.message));
  }, [f.id]);

  const dl = x && x.downloads;
  // Downloads are noted for the studio ("Dana downloaded HD 1080p"), so they know the delivery landed.
  const note = (what) => { if (!demo && !staff) api("/api/portal", { method: "POST", body: { action: "downloaded", projectId: p.id, what: `${f.title} (${what})` } }).catch(() => {}); };
  const open = (url, what) => {
    if (demo) return say("", `in the real portal this downloads the ${what}.`);
    note(what);
    window.open(url, "_blank", "noopener");
  };
  const caption = (c) => {
    if (demo) return say("", "in the real portal this downloads the caption file.");
    if (c.text) { note(c.label + " captions"); return saveText(c.text, c.filename || `${f.title}.srt`); }
    open(c.link, c.label + " captions");
  };
  const seen = () => { if (!demo && !staff) api("/api/portal", { method: "POST", body: { action: "seen", projectId: p.id, videoId: f.id } }).catch(() => {}); };
  return html`<div class="page wide">
    <p style=${{ margin: "0 0 18px" }}><${Link} to=${"/films/" + p.id} cls="link">← ${p.title} films<//></p>
    <div style=${{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: "28px", alignItems: "start" }} class="filmgrid">
      <div class="stack" style=${{ gap: "20px", minWidth: 0 }}>
        <${Player} video=${f} apiRef=${player} vertical=${f.vertical} source=${{ project: p.id }} onPlay=${seen} />
        <div class="stack" style=${{ gap: "10px" }}>
          <span class="eyebrow"><span>${p.title}</span></span>
          <h1 class="h1">${f.title}</h1>
          <span class="muted">${[f.durationLabel, f.resolution, f.created ? "Delivered " + fmtDate(f.created) : "", typeof f.plays === "number" ? plural(f.plays, "play") : ""].filter(Boolean).join(" · ")}</span>
          ${f.description ? html`<p style=${{ margin: "8px 0 0", lineHeight: 1.65, maxWidth: "760px", whiteSpace: "pre-wrap" }}>${f.description}</p>` : null}
        </div>
      </div>
      <aside class="stack" style=${{ gap: "14px" }}>
        ${err ? html`<div class="alert">${err}</div>` : null}
        ${p.caps.download ? html`<div class="card pad stack" style=${{ gap: "12px" }}>
          <b class="row" style=${{ gap: "10px" }}><${Icon} name="growth" size=${22} />Download</b>
          ${!x ? html`<span class="muted small">Getting the download links…</span>`
            : dl && dl.links.length ? html`<div class="list">${dl.links.map((l) => html`<div class="li" key=${l.label} style=${{ padding: "12px 2px" }}>
                <div class="grow"><div class="name">${l.label}</div><div class="meta">${[l.sizeLabel, l.source ? "Full quality, very large: for editing or broadcast" : l.width ? l.width + "×" + l.height : ""].filter(Boolean).join(" · ")}</div></div>
                <button class="btn ghost sm" onClick=${() => open(l.link, l.label)}>Download</button>
              </div>`)}</div>
              <span class="faint small">Links come straight from ${dl.siteName || "the video host"} and work for a limited time. Reopen this page for fresh ones.</span>`
            : dl && dl.onSite ? html`<span class="muted small" style=${{ lineHeight: 1.55 }}>Download this film from its page on ${dl.siteName || "the video host"}.</span><a class="btn primary" href=${dl.onSite} target="_blank" rel="noopener" onClick=${() => note("from " + (dl.siteName || "the host"))}>Download on ${dl.siteName || "the host"}</a>`
            : dl && dl.held ? html`<span class="muted small" style=${{ lineHeight: 1.55 }}>${dl.reason}</span><div><${Link} to=${dl.payTo} cls="btn primary sm">See what’s due<//></div>`
            : html`<span class="muted small" style=${{ lineHeight: 1.55 }}>${(dl && dl.reason) || "Downloads aren’t available for this film."}</span>`}
        </div>` : null}
        ${p.caps.share ? html`<${Share} p=${p} f=${f} />` : null}
        ${p.caps.captions && x && x.chapters && x.chapters.length ? html`<div class="card pad stack" style=${{ gap: "8px" }}>
          <b>Chapters</b>
          <div class="list">${x.chapters.map((c) => html`<button key=${c.at} class="li" style=${{ background: "none", border: 0, borderBottom: "1px solid var(--line)", cursor: "pointer", textAlign: "left", padding: "12px 2px" }} onClick=${() => player.current && player.current.seek(c.at)}>
            <span class="tc" style=${{ display: "inline-flex", alignItems: "center" }}>${Math.floor(c.at / 60)}:${String(Math.floor(c.at % 60)).padStart(2, "0")}</span><span class="grow">${c.title}</span></button>`)}</div>
        </div>` : null}
        ${p.caps.captions && x && x.captions && x.captions.length ? html`<div class="card pad stack" style=${{ gap: "8px" }}>
          <b>Captions</b>
          <span class="muted small">Caption files for uploading with the film to YouTube, LinkedIn, and most players.</span>
          <div class="list">${x.captions.map((c) => html`<div class="li" key=${c.label + c.language} style=${{ padding: "10px 2px" }}><span class="grow">${c.label}</span>
            <button class="btn ghost sm" onClick=${() => caption(c)}>Download</button></div>`)}</div>
        </div>` : null}
        ${staff && f.manage ? html`<a class="btn ghost" href=${f.manage} target="_blank" rel="noopener">Open at the source ↗</a>` : null}
      </aside>
    </div>
  </div>`;
}

const DEMO_LINKS = [{ id: "s1", title: "", by: "Dana Whitfield", mine: true, url: "#", created: new Date(Date.now() - 4 * 864e5).toISOString(), expires: new Date(Date.now() + 26 * 864e5).toISOString(), views: 12 }];

/** Share links: a page with just this film (/watch/…), for people outside the portal. They can be turned off. */
function Share({ p, f }) {
  const { demo, say, toast } = useApp();
  const [links, setLinks] = useState(demo ? DEMO_LINKS.map((l) => ({ ...l, videoId: f.id, title: f.title })) : null);
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState(null);
  const [showOld, setShowOld] = useState(false);
  const load = () => api(`/api/portal?shares=${p.id}`).then((d) => setLinks(d.links.filter((l) => l.videoId === f.id))).catch(() => setLinks([]));
  useEffect(() => { if (!demo) load(); }, [f.id]);
  const create = async () => {
    if (demo) return say("", "in the real portal this makes a new link and copies it.");
    setBusy(true);
    try {
      const d = await api("/api/portal", { method: "POST", body: { action: "shareCreate", projectId: p.id, videoId: f.id, days: days === "never" ? null : Number(days) } });
      await copy(d.url, toast, "Share link");
      await load();
    } catch (e) { toast(e.message, { err: true }); }
    setBusy(false);
  };
  const revoke = async () => {
    if (demo) { setOff(null); return say("", "in the real portal this turns the link off at once."); }
    setBusy(true);
    try { await api("/api/portal", { method: "POST", body: { action: "shareRevoke", id: off.id } }); toast("That link no longer works."); await load(); }
    catch (e) { toast(e.message, { err: true }); }
    setBusy(false); setOff(null);
  };
  const live = (links || []).filter((l) => l.url);
  const old = (links || []).filter((l) => !l.url);
  return html`<div class="card pad stack" style=${{ gap: "12px" }}>
    <b class="row" style=${{ gap: "10px" }}><${Icon} name="send" size=${22} />Share</b>
    <span class="muted small" style=${{ lineHeight: 1.55 }}>A link to a page with just this film. Whoever has it can watch; they can’t see anything else in your portal. You can turn a link off at any time.</span>
    <div class="row" style=${{ gap: "8px", flexWrap: "wrap" }}>
      <label class="sr" for="share-days">The link works for</label>
      <select id="share-days" class="select" style=${{ width: "auto", flex: "1 1 140px" }} value=${days} onChange=${(e) => setDays(e.target.value)}>
        <option value="7">Works for 7 days</option><option value="30">Works for 30 days</option><option value="90">Works for 90 days</option><option value="never">Works until turned off</option>
      </select>
      <button class="btn primary" disabled=${busy} onClick=${create}>${busy ? "One moment…" : "Create and copy a link"}</button>
    </div>
    ${links === null ? html`<span class="faint small">Loading links…</span>` : live.length ? html`<div class="list">${live.map((l) => html`<div class="li" key=${l.id} style=${{ padding: "10px 2px", flexWrap: "wrap" }}>
        <div class="grow" style=${{ minWidth: "150px" }}><div class="name small">${l.expires ? "Until " + fmtDate(l.expires) : "No end date"}</div>
          <div class="meta">${plural(l.views || 0, "view")}${l.mine ? "" : " · by " + l.by} · made ${fmtAgo(l.created)}</div></div>
        <button class="btn ghost sm" onClick=${() => demo ? say("", "in the real portal this copies the link.") : copy(l.url, toast, "Share link")}>Copy</button>
        <button class="btn ghost sm" onClick=${() => setOff(l)}>Turn off</button>
      </div>`)}</div>` : null}
    ${old.length ? html`<button class="link small" style=${{ alignSelf: "flex-start" }} onClick=${() => setShowOld(!showOld)}>${showOld ? "Hide" : "Show"} ${plural(old.length, "old link")}</button>` : null}
    ${showOld ? html`<div class="list">${old.map((l) => html`<div class="li" key=${l.id} style=${{ padding: "8px 2px" }}><div class="grow"><div class="meta">${l.revoked ? "Turned off " + fmtDate(l.revoked) : "Ended " + fmtDate(l.expires)} · ${plural(l.views || 0, "view")}</div></div></div>`)}</div>` : null}
    ${off ? html`<${Confirm} title="Turn this link off?" yes="Turn it off" busy=${busy} onYes=${revoke} onNo=${() => setOff(null)}>
      Anyone who opens it afterwards sees that it isn’t available. This can’t be undone, but you can always make a new link.
    <//>` : null}
  </div>`;
}
