# Nobleman client portal — project notes

Client portal for Nobleman Productions at `portal.noblemanproductions.gotit2work.com`. Operated by Alexis / GotIT2Work. The marketing site is `Gotit2work/nobleman-website`; its `docs/DEPLOYMENT.md` is the runbook for both. README.md explains the product, Vimeo, capabilities, env vars, and the go-live steps.

## Ownership and infrastructure

- Vercel project `nobleman-portal` (`prj_3HnVWrxGKofXm6EUvEPF1Jg2xCR8`), team `gotit2-work` (`team_b7Eucmxp9X2SzzAHXZPA92Qh`), framework Other, Node 22.x, Vercel Authentication on previews only. Linked to GitHub `Gotit2work/nobleman-portal` (public so Hobby can deploy it); pushes to `main` deploy to production. DNS: GoDaddy CNAME `portal.noblemanproductions` → `cname.vercel-dns.com`.
- **Alexis owns `gotit2work.com`** (DNS at GoDaddy). The apex points at Lovable (`185.158.133.1`) and email is Microsoft 365. Touch neither.
- On Hobby by the owner's choice; commercial use requires Pro before clients rely on it. Hobby allows 12 functions; the portal uses 5. Add actions to an existing route rather than a new file.
- Vimeo is Jean's account (`jeangotay`, **Plus**): no API download links (Standard+), so films fall back to "Download on Vimeo".
- Env today: only `PORTAL_MODE=demo`. Go-live adds `DATABASE_URL`, `SESSION_SECRET`, `BOOTSTRAP_SECRET`, `VIMEO_ACCESS_TOKEN`, `BLOB_READ_WRITE_TOKEN`, optionally `RESEND_API_KEY` + `PORTAL_EMAIL_FROM` (README, "Going live").

## Architecture

- No build step. `index.html` loads vendored React, then `app/main.js` as an ES module. Components are written with `htm` (`html\`<${Comp} prop=${x} />\``), not JSX. One file per area: `gate.js` (sign-in, setup, new password), `home.js`, `review.js`, `films.js`, `files.js`, `messages.js`, `account.js`, `studio.js`; shared pieces in `ui.js`.
- Routing is `history.pushState` through `go()` in `main.js`; use `<${Link} to=…>` for internal links. `vercel.json` rewrites every dot-less path outside `api/ app/ assets/ media/ vendor/` to `/index` (not `/index.html`: with `cleanUrls` the page is served at `/index`, and a rewrite to `/index.html` is a 404 on Vercel even though the local test server accepts it). Static files win over the rewrite. Check deep links such as `/review/x` on the preview.
- `app/` is served `max-age=0, must-revalidate`, so module changes reach people on their next load. `assets/` and `media/` cache 7 days: bump `?v=` in `index.html` for `np.css`/`np.js`, and give a changed image a new name.
- The API is five functions. Shared code lives in `api/_*.js` (underscore files aren't functions). `_build.js` assembles everything a person sees in one `GET /api/portal`; screens re-read it with `reload()` after an action.
- Schema: `api/_schema.js` holds idempotent statements and `SCHEMA_VERSION`. `ready()` in `_db.js` applies them when the stored version is behind. To change the schema, **append** statements and bump the version; never edit old ones.

## Security invariants — keep these

- Every route starts with `requireUser` / `requireAdmin` (`api/_auth.js`). They re-read the person and check the session version on every request. Never trust ids or roles from the browser.
- Reach projects only through `projectFor(user, id)`: it scopes clients to their own company's non-archived projects and attaches `caps`. Check the capability on the server for every action (`p.caps.x`); hiding it in the page is not enough.
- `must_change_password` blocks every route except the password action. Password change, reset, and role/company change bump `session_version`.
- POST handlers call `rejectCrossOrigin` (via `requireUser`) and `readBody`; validate ids with `isUuid`; keep multi-row writes in one statement.
- The Vimeo token and the Blob read-write token stay server-side. Browsers get a tus upload link for one video, or a client token for one Blob pathname. Blob downloads are signed links that expire in ten minutes.
- Only ask Vimeo for folders linked to the viewer's projects. Client uploads must stay `view: nobody`; staff uploads are `unlisted` so they embed (`createUpload`).
- Demo is explicit (`PORTAL_MODE=demo`, or the `/demo` path). Never fall back to it because an API call failed.

## Conventions — keep these when changing the UI

- Every word a client sees follows `docs/WRITING.md`: plain words, buttons named for the action, no promise that isn't always true, confirmation before anything hard to undo (`Confirm`; typed name for deletes).
- Demo actions go through `say(real, demo)`, which shows "Demo only: …". Never let the demo call the API's write actions.
- Home leads with **Your next step** (`nextStep` in `home.js`): one clear action.
- Desktop navigation is the `.rail` capsule (960 px and wider); phones get `.bottombar`. A new top-level screen needs an entry in `navFor` (main.js), an icon from `media/icons/`, a Help line (`HELP`), and a check in `tests/e2e.test.mjs`.
- Capabilities are defined once in `api/_caps.js` (key, label, detail, default, `needs`). Studio renders the switches from it. A new capability needs a server check and a test.
- Privacy: the notice is on the website (`/privacy#portal`). Adding a cookie, storage key, provider, or stored field means updating the website's `privacy.html` (and its date) in the same change. Today the portal sets one cookie (`np_session`) and no browser storage.
- Never bind `src` to something the browser could request before it's ready; thumbnails fall back to `/media/screening-poster.jpg` with `onError`.

## Verifying changes

`cd tests && npm test` (README, "Testing") starts three local servers with PGlite and fake Vimeo/Blob/Resend, then runs 102 API checks and 44 browser checks on desktop and phone. `npm run shots` captures every screen (desktop 1440, phone 390) into `tests/.work/shots`. Look at the screenshots after any visual change; fonts from Google may be missing in a sandbox. Before shipping, `npx vercel build` with a hand-written `.vercel/project.json` (`{"projectId":"x","orgId":"y","settings":{"framework":null}}`) and read `.vercel/output/config.json`.
