# Nobleman client portal — project notes

Client portal for Nobleman Productions at `portal.noblemanproductions.gotit2work.com`. Operated by Alexis / GotIT2Work. The marketing site is `Gotit2work/nobleman-website`; its `docs/DEPLOYMENT.md` is the runbook for both. README.md explains the product, roles, capabilities, Studio, video sources, Notion, env vars, and the go-live steps.

**Staff run everything from Studio; code changes are only for adding or removing capabilities** (README, "Changing what the portal can do"). Anything an admin would want to change (wording on the sign-in screen, stages, defaults, roles, connections) belongs in Settings or Connections, not in code.

## Ownership and infrastructure

- Vercel project `nobleman-portal` (`prj_3HnVWrxGKofXm6EUvEPF1Jg2xCR8`), team `gotit2-work` (`team_b7Eucmxp9X2SzzAHXZPA92Qh`), framework Other, Node 22.x, Vercel Authentication on previews only. Linked to GitHub `Gotit2work/nobleman-portal` (public so Hobby can deploy it); pushes to `main` deploy to production. DNS: GoDaddy CNAME `portal.noblemanproductions` → `cname.vercel-dns.com`.
- **Alexis owns `gotit2work.com`** (DNS at GoDaddy). The apex points at Lovable (`185.158.133.1`) and email is Microsoft 365. Touch neither.
- On Hobby by the owner's choice; commercial use requires Pro before clients rely on it. Hobby allows 12 functions; the portal uses 8 (`session`, `portal`, `media`, `files`, `admin`, `share`, `connect`, `cron`). Add actions to an existing route rather than a new file. Hobby crons run once a day, within the hour.
- Vimeo is Jean's account (`jeangotay`, **Plus**): no API download links (Standard+), so films fall back to "Download on Vimeo".
- Env today: only `PORTAL_MODE=demo`. Go-live adds `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `SESSION_SECRET`, `PORTAL_ENCRYPTION_KEY`, `CRON_SECRET`, `BOOTSTRAP_SECRET` (README, "Going live"). Video, email, and Notion keys can be entered in Studio → Connections instead of env vars. Never generate, read, or relay secret values in a session; the owner sets them in Vercel.

## Architecture

- No build step. `index.html` loads vendored React, then `app/main.js` as an ES module. Components are written with `htm` (`html\`<${Comp} prop=${x} />\``), not JSX. One file per area: `gate.js` (sign-in, setup, links, two-step), `home.js`, `review.js`, `films.js`, `files.js`, `messages.js`, `account.js`, `watch.js` (share pages), `twostep.js`, and Studio in `studio.js` (shell, projects) + `studio-people.js` + `studio-connect.js` + `studio-settings.js`; shared pieces in `ui.js` (including the one `Player` for every video kind).
- Routing is `history.pushState` through `go()` in `main.js`; use `<${Link} to=…>` for internal links. `vercel.json` rewrites every dot-less path outside `api/ app/ assets/ media/ vendor/` to `/index` (not `/index.html`: with `cleanUrls` the page is served at `/index`, and a rewrite to `/index.html` is a 404 on Vercel even though the local test server accepts it). Check deep links such as `/review/x`, `/watch/x`, `/link/x` on the preview.
- `app/` is served `max-age=0, must-revalidate`. `assets/` and `media/` cache 7 days: bump `?v=` in `index.html` for `np.css`/`np.js`, and give a changed image a new name. `vendor/` is immutable: versioned file names only.
- Shared server code lives in `api/_*.js` and `api/_providers/` (underscore paths aren't functions; confirm with `vercel build`). `_build.js` assembles everything a person sees in one `GET /api/portal`; screens re-read it with `reload()` after an action. `GET /api/admin` is Studio's equivalent.
- Schema: `api/_schema.js` holds idempotent statements and `SCHEMA_VERSION`. `ready()` in `_db.js` applies them when the stored version is behind. To change the schema, **append** statements and bump the version; never edit old ones.
- Settings are one JSON value per section (`s:<section>` in `settings`), read through `getSettings()` with defaults from `DEFAULTS` (`_settings.js`), validated by `CLEAN` in `_admin_more.js`.
- Video providers share one interface (`api/_providers/index.js`) and one normalised video shape (`video()` in `_video.js`, with `playback` = `vimeo` | `youtube` | `file` | `iframe`). `_sources.js` splits a project's videos into cuts (versions) and films and applies staff overrides (`video_settings`). Links that expire (Frame.io, Wistia) are fetched at play time through `?play=1`, never stored.

## Security invariants — keep these

- Every route starts with `requireUser` / `requireStaff(req, res, perm)` (`api/_auth.js`). They re-read the person and check the session version on every request. Never trust ids or roles from the browser.
- Staff permissions: `can(u, perm, settings)`; client abilities: `effectiveCaps` (project switch AND role permission). Check on the server for every action; hiding it in the page is not enough. `staff.manage` and `settings.manage` are owner-only and can't be granted; keep the last-owner guard.
- Reach projects only through `projectFor(user, id)`: it scopes clients to their own company's non-archived projects and attaches `caps`.
- Clients see only the newest version of each cut unless the project's `history` switch is on (`cutsOut` in `_build.js`). Any new client-facing list of versions must respect that.
- `must_change_password` blocks every route except the password action; staff who must have two-step are held at setup. Password, role, company, or email changes, and "Sign out everywhere", bump `session_version`.
- One-time links and share links: only hashes are stored (`hashToken`); share tokens are also sealed so staff can copy them again. Connection credentials are sealed (AES-256-GCM, `_crypto.js`); `safeConfig` strips anything key-like before it reaches the page, and secret fields are never pre-filled.
- POST handlers call `rejectCrossOrigin` (via `requireUser`) and `readBody`; validate ids with `isUuid`; keep multi-row writes in one statement.
- Provider tokens and the Blob read-write token stay server-side. Browsers get a tus upload link for one video, or a client token for one Blob pathname. Blob downloads are signed links that expire in ten minutes.
- `/api/cron` refuses to run without `CRON_SECRET`.
- Demo is explicit (`PORTAL_MODE=demo`, or the `/demo` path). Never fall back to it because an API call failed.
- Audit what matters (`audit()` in `_audit.js`): sign-ins, Studio changes, decisions, views, downloads, shares, team changes.

## Conventions — keep these when changing the UI

- Every word a client sees follows `docs/WRITING.md`: plain words, buttons named for the action, no promise that isn't always true, confirmation before anything hard to undo (`Confirm`; typed name for deletes). Say "the studio", not a person's name; the name lives in settings (`brand`).
- Demo actions go through `say(real, demo)`, which shows "Demo only: …". Never let the demo call the API's write actions.
- Home leads with **Your next step** (`nextStep` in `home.js`): one clear action.
- Desktop navigation is the `.rail` capsule (960 px and wider); phones get `.bottombar`. A new top-level screen needs an entry in `navFor` (main.js), an icon from `media/icons/`, a Help line, and a check in `tests/e2e.test.mjs`. A new Studio tab goes in `TABS` (studio.js) with the permissions that reveal it.
- Capabilities are defined once in `api/_caps.js`; role permissions once in `api/_roles.js`. Studio renders the switches and the roles table from them.
- Privacy: the notice is on the website (`/privacy#portal`). Adding a cookie, storage key, provider, tracked event, or stored field means updating the website's `privacy.html` (and its date) in the same change. Today the portal sets one cookie (`np_session`) and no browser storage.
- Never bind `src` to something the browser could request before it's ready; thumbnails fall back to `/media/screening-poster.jpg` with `onError`.

## Verifying changes

`cd tests && npm test` (README, "Testing") starts three local servers with PGlite and fakes for every provider, then runs 227 API checks and 86 browser checks on desktop and phone. `npm run shots` captures every screen (desktop 1440, phone 390) into `tests/.work/shots`. Look at the screenshots after any visual change; fonts from Google may be missing in a sandbox. Before shipping, `npx vercel build` with a hand-written `.vercel/project.json` (`{"projectId":"x","orgId":"y","settings":{"framework":null}}`), confirm 8 functions and the cron in `.vercel/output/config.json`, then delete `.vercel/`.
