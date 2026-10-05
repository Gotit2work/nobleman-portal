// Files: documents from the studio, and what the client sends. Videos go straight to the project's video source
// when it takes uploads (Vimeo, resumable tus upload); everything else goes to private Vercel Blob storage. Nothing passes through the
// portal's own servers.
import { html, useApp, useState, useRef, api, Head, Empty, Link, Icon, Confirm, fmtBytes, fmtDate, ext, plural, can, isStaff } from "./ui.js";

const CHUNK = 32 * 1024 * 1024;
const MAX_FILE = 500 * 1024 ** 2;

/** Sends one file to Vimeo's tus link in chunks, resuming from Vimeo's offset after a dropped chunk. */
async function tusUpload(link, file, onProgress) {
  let offset = 0, tries = 0;
  while (offset < file.size) {
    try {
      offset = await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open("PATCH", link);
        x.setRequestHeader("Tus-Resumable", "1.0.0");
        x.setRequestHeader("Upload-Offset", String(offset));
        x.setRequestHeader("Content-Type", "application/offset+octet-stream");
        x.upload.onprogress = (e) => onProgress((offset + e.loaded) / file.size);
        x.onload = () => (x.status === 204 || x.status === 200 ? resolve(Number(x.getResponseHeader("Upload-Offset")) || offset + Math.min(CHUNK, file.size - offset)) : reject(new Error("status " + x.status)));
        x.onerror = () => reject(new Error("network"));
        x.send(file.slice(offset, offset + CHUNK));
      });
      tries = 0;
    } catch (e) {
      if (++tries > 4) throw new Error("The upload kept dropping. Check your connection and try again.");
      await new Promise((r) => setTimeout(r, 1500 * tries));
      const h = await fetch(link, { method: "HEAD", headers: { "Tus-Resumable": "1.0.0" } }).catch(() => null);
      if (h && h.ok) offset = Number(h.headers.get("Upload-Offset")) || offset;
    }
    onProgress(offset / file.size);
  }
}

export function Files({ pid }) {
  const app = useApp();
  const { data, user, demo, say, toast, reload, setData } = app;
  const admin = isStaff(user);
  const manage = can(user, "files.manage");
  const eligible = data.projects.filter((p) => p.caps.files || p.caps.upload);
  const [jobs, setJobs] = useState([]);
  const [over, setOver] = useState(false);
  const [del, setDel] = useState(null);
  const input = useRef(null);
  if (!eligible.length) return html`<div class="page"><${Empty} icon="send" title="Files aren’t switched on.">Ask the studio if you need to send or receive files here.<//></div>`;
  const p = eligible.find((x) => x.id === pid) || eligible[0];
  const docs = p.files.filter((f) => f.kind === "document");
  const mine = p.files.filter((f) => f.kind === "upload");
  const job = (id, patch) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const send = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (demo) {
      for (const f of files) {
        const id = Math.random().toString(36).slice(2);
        setJobs((js) => js.concat([{ id, name: f.name, size: f.size, pct: 0 }]));
        let pct = 0;
        const t = setInterval(() => { pct = Math.min(1, pct + 0.12); job(id, { pct }); if (pct >= 1) { clearInterval(t); setTimeout(() => setJobs((js) => js.filter((j) => j.id !== id)), 900); } }, 160);
      }
      return say("", "files you choose here stay on your computer.");
    }
    for (const f of files) {
      const id = Math.random().toString(36).slice(2);
      const toVimeo = /^video\//.test(f.type) && p.videoUploadsToSource;
      setJobs((js) => js.concat([{ id, name: f.name, size: f.size, pct: 0, where: toVimeo ? "the video folder" : "files" }]));
      try {
        if (!toVimeo && f.size > MAX_FILE) throw new Error(`${f.name} is larger than 500 MB.${/^video\//.test(f.type) ? " Ask the studio for a link to send large videos." : " Ask the studio for another way to send it."}`);
        if (toVimeo) {
          const s = await api("/api/media", { method: "POST", body: { action: "uploadStart", projectId: p.id, name: f.name, size: f.size, type: f.type } });
          try { await tusUpload(s.uploadLink, f, (x) => job(id, { pct: x })); }
          catch (e) { await api("/api/media", { method: "POST", body: { action: "uploadCancel", uploadId: s.uploadId } }).catch(() => {}); throw e; }
          await api("/api/media", { method: "POST", body: { action: "uploadDone", uploadId: s.uploadId } });
        } else {
          const s = await api("/api/files", { method: "POST", body: { action: "start", projectId: p.id, name: f.name, size: f.size, contentType: f.type || "application/octet-stream" } });
          try {
            const { put } = await import("/vendor/vercel-blob-client-2.8.0.js");
            await put(s.pathname, f, { access: "private", token: s.token, multipart: s.multipart, contentType: f.type || undefined, onUploadProgress: (e) => job(id, { pct: e.percentage / 100 }) });
          } catch (e) {
            await api("/api/files", { method: "POST", body: { action: "cancel", fileId: s.fileId } }).catch(() => {});
            throw new Error(`${f.name} didn’t upload. Check your connection and try again.`);
          }
          await api("/api/files", { method: "POST", body: { action: "done", fileId: s.fileId } });
        }
        job(id, { pct: 1, done: true });
        toast(admin ? `${f.name} added. ${p.clientName} can see it${p.caps.files ? "" : " once Files is switched on"}.` : `${f.name} sent to the studio.`);
        setTimeout(() => setJobs((js) => js.filter((j) => j.id !== id)), 1500);
        reload();
      } catch (e) {
        job(id, { error: e.message });
      }
    }
  };

  const download = async (f) => {
    if (demo) return say("", `in the real portal this downloads ${f.name}.`);
    try { const d = await api("/api/files?id=" + f.id); window.open(d.url, "_blank", "noopener"); }
    catch (e) { toast(e.message, { err: true }); }
  };
  const remove = async (f) => {
    setDel(null);
    if (demo) { setData((d) => ({ ...d, projects: d.projects.map((x) => x.id === p.id ? { ...x, files: x.files.filter((y) => y.id !== f.id) } : x) })); return say("", "the file was only removed from this page."); }
    try { await api("/api/files", { method: "POST", body: { action: "delete", id: f.id } }); toast(`${f.name} removed.`); reload(); }
    catch (e) { toast(e.message, { err: true }); }
  };

  const row = (f) => html`<div class="li" key=${f.id}>
    <span class="fileic">${ext(f.name)}</span>
    <div class="grow"><div class="name">${f.name}</div><div class="meta">${[fmtBytes(f.size), (f.byRole === "admin" ? "From " + f.by + " · studio" : "From " + f.by), fmtDate(f.at)].filter(Boolean).join(" · ")}</div></div>
    <div class="row" style=${{ gap: "8px" }}>
      <button class="btn ghost sm" onClick=${() => download(f)}>Download</button>
      ${f.mine || manage ? html`<button class="btn ghost sm" aria-label=${"Remove " + f.name} onClick=${() => setDel(f)}>Remove</button>` : null}
    </div>
  </div>`;

  return html`<div class="page">
    <${Head} eyebrow=${p.title} title="Files">
      ${admin ? `Documents you add here appear to ${p.clientName} under “From the studio”.` : p.caps.upload ? "Documents from the studio, and files you send." : "Documents from the studio."}
    <//>
    ${eligible.length > 1 ? html`<div class="tabs" style=${{ marginBottom: "24px" }}>${eligible.map((x) => html`<${Link} key=${x.id} to=${"/files/" + x.id} cls="tab-btn" current=${x.id === p.id}>${admin ? x.clientName + " · " : ""}${x.title}<//>`)}</div>` : null}

    ${p.caps.upload ? html`<div class="card pad"
        onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
        onDrop=${(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
        style=${{ borderStyle: "dashed", borderColor: over ? "var(--ink)" : "var(--line-2)", background: over ? "var(--card-2)" : "var(--card)", textAlign: "center", padding: "36px 24px", marginBottom: "12px" }}>
      <div class="stack" style=${{ alignItems: "center", gap: "12px" }}>
        <${Icon} name="send" size=${40} />
        <b style=${{ fontSize: "18px" }}>${admin ? "Add documents for " + p.clientName : "Send files to the studio"}</b>
        <span class="muted small" style=${{ maxWidth: "520px", lineHeight: 1.6 }}>Drag files here. ${p.videoUploadsToSource ? (admin ? "Videos go to the project’s video folder: “V2” in the name makes it a version, otherwise a finished film. Other files up to 500 MB." : "Videos up to 50 GB. Other files up to 500 MB.") : "Up to 500 MB each."}</span>
        <button class="btn primary" onClick=${() => input.current.click()}>Choose files</button>
        <input ref=${input} type="file" multiple hidden onChange=${(e) => { send(e.target.files); e.target.value = ""; }} />
      </div>
    </div>` : null}
    ${jobs.length ? html`<div class="list" style=${{ marginBottom: "12px" }}>${jobs.map((j) => html`<div class="li" key=${j.id}>
      <span class="fileic">${ext(j.name)}</span>
      <div class="grow"><div class="name">${j.name}</div>
        ${j.error ? html`<div class="meta" style=${{ color: "#ffb3ad" }}>${j.error}</div>`
          : html`<div class="meta">${j.done ? "Sent" : `Sending to ${j.where || "the studio"}… ${Math.round(j.pct * 100)}%`} · ${fmtBytes(j.size)}</div><div class="progress"><i style=${{ width: Math.round(j.pct * 100) + "%" }}></i></div>`}
      </div>
      ${j.error ? html`<button class="btn ghost sm" onClick=${() => setJobs((js) => js.filter((x) => x.id !== j.id))}>Dismiss</button>` : null}
    </div>`)}</div>` : null}

    ${p.caps.files ? html`<section class="section" style=${{ marginTop: "32px" }}>
      <div class="sh"><span class="eyebrow"><span>From the studio</span></span><span class="muted small">${plural(docs.length, "file")}</span></div>
      ${docs.length ? html`<div class="list">${docs.map(row)}</div>` : html`<p class="muted">${admin ? "Nothing added yet." : "Nothing yet."}</p>`}
    </section>` : null}
    ${p.caps.upload || admin ? html`<section class="section" style=${{ marginTop: "40px" }}>
      <div class="sh"><span class="eyebrow"><span>${admin ? "From " + p.clientName : "From you"}</span></span><span class="muted small">${plural(mine.length + p.videoUploads.length, "file")}</span></div>
      ${mine.length || p.videoUploads.length ? html`<div class="list">
        ${p.videoUploads.map((v) => html`<div class="li" key=${v.id}>
          <span class="fileic"><${Icon} name="play" size=${22} /></span>
          <div class="grow"><div class="name">${v.name}</div><div class="meta">${[fmtBytes(v.size), "Video · in the project’s video folder", "From " + v.by, fmtDate(v.at)].join(" · ")}</div></div>
          <span class=${"pill " + (v.status === "done" ? "green" : "amber")}>${v.status === "done" ? "Sent" : "Not finished"}</span>
        </div>`)}
        ${mine.map(row)}
      </div>` : html`<p class="muted">${admin ? "Nothing sent yet." : "Nothing sent yet."}</p>`}
    </section>` : null}
    ${del ? html`<${Confirm} title=${`Remove ${del.name}?`} yes="Yes, remove it" danger onYes=${() => remove(del)} onNo=${() => setDel(null)}>
      It will be deleted for everyone on this project and can’t be brought back.
    <//>` : null}
  </div>`;
}
