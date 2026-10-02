// A share link (/watch/<token>): one finished film on a page with the studio's name, for whoever has the
// link. No sign-in, no portal around it, nothing about the client or project beyond the film.
import { html, useState, useEffect, api, Player, fmtDate } from "./ui.js";

export function Watch({ token }) {
  const [st, setSt] = useState({ phase: "busy" });
  useEffect(() => {
    api(`/api/share?token=${encodeURIComponent(token)}`).then((d) => setSt({ phase: "ok", ...d })).catch((e) => setSt({ phase: "error", error: e.message }));
  }, [token]);
  const studio = st.studio || "Nobleman Productions";
  return html`<div class="watch">
    <header class="watch-top">
      <img src="/assets/Nobleman_Logo_White.png" alt=${studio} />
      ${st.website ? html`<a class="btn ghost sm" href=${st.website}>${st.website.replace(/^https:\/\//, "").replace(/\/$/, "")}</a>` : null}
    </header>
    <main class="watch-main">
      ${st.phase === "busy" ? html`<div class="boot-line"><i></i></div>` : null}
      ${st.phase === "error" ? html`<div class="empty"><h3>This link isn’t available.</h3><p>${st.error}</p></div>` : null}
      ${st.phase === "ok" ? html`
        <${Player} video=${st.film} vertical=${st.film.vertical} source=${{ share: token }} />
        <div class="stack" style=${{ gap: "10px", marginTop: "26px" }}>
          <span class="eyebrow"><span>${studio}</span><span class="dot"></span></span>
          <h1 class="h1">${st.film.title}</h1>
          <span class="muted">${[st.film.durationLabel, st.film.resolution].filter(Boolean).join(" · ")}</span>
          ${st.film.description ? html`<p style=${{ margin: "8px 0 0", lineHeight: 1.65, maxWidth: "760px", whiteSpace: "pre-wrap" }}>${st.film.description}</p>` : null}
          <p class="faint small" style=${{ marginTop: "18px" }}>Shared with you by ${studio}.${st.expires ? ` This link works until ${fmtDate(st.expires)}.` : ""}</p>
        </div>` : null}
    </main>
  </div>`;
}
