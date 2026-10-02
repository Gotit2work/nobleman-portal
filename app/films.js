// Films: finished films to watch, download, caption, and share, as far as each project allows.
import { html, useApp, useState, useEffect, useRef, api, Head, Empty, Link, Player, Icon, copy, fmtDate, plural } from "./ui.js";

const POSTER = "/media/screening-poster.jpg";

export function Films({ pid, vid }) {
  const { data, user } = useApp();
  const admin = user.role === "admin";
  const all = data.projects.flatMap((p) => p.films.map((f) => ({ f, p })));
  if (vid) {
    const hit = all.find((x) => x.f.id === vid && (!pid || x.p.id === pid));
    if (hit) return html`<${Film} p=${hit.p} f=${hit.f} key=${hit.f.id} />`;
  }
  const scope = pid ? data.projects.filter((p) => p.id === pid) : data.projects;
  const groups = scope.filter((p) => p.films.length);
  return html`<div class="page">
    <${Head} eyebrow="Films" title="Your finished films.">
      Watch them here${scope.some((p) => p.caps.download) ? ", download the sizes you need" : ""}${scope.some((p) => p.caps.share) ? ", or copy a link to share" : ""}.
    <//>
    ${pid && data.projects.length > 1 ? html`<p style=${{ marginTop: "-18px", marginBottom: "28px" }}><${Link} to="/films" cls="link">See films from every project<//></p>` : null}
    ${scope.some((p) => p.videosError) ? html`<div class="alert" style=${{ marginBottom: "20px" }}>${scope.find((p) => p.videosError).videosError}</div>` : null}
    ${!groups.length ? html`<${Empty} icon="growth" title="No finished films yet.">
        They appear here as soon as Nobleman delivers them. ${data.projects.some((p) => p.cuts.length && p.caps.review) ? "Versions still in progress are in Review." : ""}
        ${admin ? " Finished films are the videos in a project’s Vimeo folder without a version number in the title." : ""}
      <//>`
    : groups.map((p) => html`<section class=${groups.length > 1 ? "section" : ""} key=${p.id}>
        ${groups.length > 1 || admin ? html`<div class="sh"><span class="eyebrow"><span>${admin ? p.clientName + " · " : ""}${p.title}</span></span><span class="muted small">${plural(p.films.length, "film")}</span></div>` : null}
        <div class="grid c3">${p.films.map((f) => html`<div data-reveal="card" key=${f.id}><${Link} to=${`/films/${p.id}/${f.id}`} cls="fcard" label=${"Watch " + f.title}>
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
  ], onVimeo: null, reason: null },
  captions: [{ label: "English (CC)", language: "en", link: "#" }],
  chapters: [{ title: "Opening", at: 0 }, { title: "On the water", at: 48 }, { title: "The reveal", at: 132 }],
};

function Film({ p, f }) {
  const { demo, say, toast, user } = useApp();
  const player = useRef(null);
  const [x, setX] = useState(demo ? DEMO_EXTRAS : null);
  const [err, setErr] = useState("");
  const wants = p.caps.download || p.caps.captions;
  useEffect(() => {
    if (demo || !wants) return;
    api(`/api/media?project=${p.id}&video=${f.id}`).then(setX).catch((e) => setErr(e.message));
  }, [f.id]);

  const dl = x && x.downloads;
  const open = (url, what) => {
    if (demo) return say("", `in the real portal this downloads the ${what}.`);
    window.open(url, "_blank", "noopener");
  };
  return html`<div class="page wide">
    <p style=${{ margin: "0 0 18px" }}><${Link} to=${"/films/" + p.id} cls="link">← ${p.title} films<//></p>
    <div style=${{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: "28px", alignItems: "start" }} class="filmgrid">
      <div class="stack" style=${{ gap: "20px", minWidth: 0 }}>
        <${Player} video=${f} apiRef=${player} vertical=${f.vertical} />
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
          ${!x ? html`<span class="muted small">Getting the download links from Vimeo…</span>`
            : dl && dl.links.length ? html`<div class="list">${dl.links.map((l) => html`<div class="li" key=${l.label} style=${{ padding: "12px 2px" }}>
                <div class="grow"><div class="name">${l.label}</div><div class="meta">${[l.sizeLabel, l.source ? "Full quality, very large: for editing or broadcast" : l.width ? l.width + "×" + l.height : ""].filter(Boolean).join(" · ")}</div></div>
                <button class="btn ghost sm" onClick=${() => open(l.link, l.label)}>Download</button>
              </div>`)}</div>
              <span class="faint small">Links come straight from Vimeo and work for a few hours.</span>`
            : dl && dl.onVimeo ? html`<span class="muted small" style=${{ lineHeight: 1.55 }}>Download this film from its page on Vimeo.</span><a class="btn primary" href=${dl.onVimeo} target="_blank" rel="noopener">Download on Vimeo</a>`
            : html`<span class="muted small" style=${{ lineHeight: 1.55 }}>${(dl && dl.reason) || "Downloads aren’t available for this film."}</span>`}
        </div>` : null}
        ${p.caps.share ? html`<div class="card pad stack" style=${{ gap: "12px" }}>
          <b class="row" style=${{ gap: "10px" }}><${Icon} name="send" size=${22} />Share</b>
          ${f.link ? html`<span class="muted small" style=${{ lineHeight: 1.55 }}>Anyone with this link can watch the film on Vimeo. They can’t see anything else in your portal.</span>
            <button class="btn primary" onClick=${() => demo ? say("", "in the real portal this copies the film’s private link.") : copy(f.link, toast)}>Copy the link</button>`
          : html`<span class="muted small" style=${{ lineHeight: 1.55 }}>This film is private on Vimeo, so it has no link to share. Ask Nobleman for a shareable copy.</span>`}
        </div>` : null}
        ${p.caps.captions && x && x.chapters && x.chapters.length ? html`<div class="card pad stack" style=${{ gap: "8px" }}>
          <b>Chapters</b>
          <div class="list">${x.chapters.map((c) => html`<button key=${c.at} class="li" style=${{ background: "none", border: 0, borderBottom: "1px solid var(--line)", cursor: "pointer", textAlign: "left", padding: "12px 2px" }} onClick=${() => player.current && player.current.seek(c.at)}>
            <span class="tc" style=${{ display: "inline-flex", alignItems: "center" }}>${Math.floor(c.at / 60)}:${String(Math.floor(c.at % 60)).padStart(2, "0")}</span><span class="grow">${c.title}</span></button>`)}</div>
        </div>` : null}
        ${p.caps.captions && x && x.captions && x.captions.length ? html`<div class="card pad stack" style=${{ gap: "8px" }}>
          <b>Captions</b>
          <span class="muted small">Caption files (WebVTT) for uploading with the film to YouTube, LinkedIn, and most players.</span>
          <div class="list">${x.captions.map((c) => html`<div class="li" key=${c.link} style=${{ padding: "10px 2px" }}><span class="grow">${c.label}</span>
            <button class="btn ghost sm" onClick=${() => open(c.link, "caption file")}>Download</button></div>`)}</div>
        </div>` : null}
        ${user.role === "admin" ? html`<a class="btn ghost" href=${"https://vimeo.com/manage/videos/" + f.id} target="_blank" rel="noopener">Open in Vimeo ↗</a>` : null}
      </aside>
    </div>
  </div>`;
}
