# Nobleman client portal — project notes

Client portal for Nobleman Productions at `portal.noblemanproductions.gotit2work.com`. Operated by Alexis / GotIT2Work. The marketing site is `Gotit2work/nobleman-website`; its `docs/DEPLOYMENT.md` is the runbook for both.

## Ownership and infrastructure

- Vercel project `nobleman-portal` (`prj_3HnVWrxGKofXm6EUvEPF1Jg2xCR8`), created 2026-09-30 in team `gotit2-work`: framework Other, Node 22.x, Vercel Authentication on previews only (production is public), custom domain attached and ownership-verified. Env: `PORTAL_MODE=demo` (Production, Preview, Development). No database, `SESSION_SECRET`, or Vimeo token yet. Linked to GitHub (`Gotit2work/nobleman-portal`, made public so Hobby can deploy it); pushes to `main` deploy to production. DNS: GoDaddy CNAME `portal.noblemanproductions` → `cname.vercel-dns.com`, certificate issued.
- **Alexis owns `gotit2work.com`.** DNS is at GoDaddy (`ns17/ns18.domaincontrol.com`). The apex points at Lovable (`185.158.133.1`) and email is Microsoft 365. Touch neither; this project only needs a CNAME for `portal.noblemanproductions`.
- Vercel: account `amangual1`, team `Gotit2Work` (slug `gotit2-work`, id `team_b7Eucmxp9X2SzzAHXZPA92Qh`). On Hobby by the owner's choice while the portal is a demo; commercial use requires Pro.
- Database: Neon Postgres through Vercel Storage (`DATABASE_URL`; `POSTGRES_URL` also accepted). The schema is `schema.sql` and is idempotent; re-run the whole file after changes.

## State of the product

- Live today in **demo mode** (`PORTAL_MODE=demo`): public sample portal, no database attached yet.
- Real: sign-in, sessions, roles (admin/client), account management API, sign-in throttling, and the Vimeo layer (`api/_vimeo.js`, `api/videos.js`). Films are real once `VIMEO_ACCESS_TOKEN` plus a folder id are set; titles with "V<n>" are review cuts, the rest are Library deliverables.
- Prototype: projects, stages, comments, approvals, files, and messages are hardcoded sample data ("Meridian"). No admin screens; accounts are created via curl (README).
- Next increments: projects read from the database (the Vimeo folder is already a column), then comments and approvals, file storage (Vercel Blob), messages and notifications, and Vimeo download links.

## Security invariants — keep these when extending the API

- Every route that needs a user calls `requireUser` / `requireAdmin` from `api/_auth.js`. They re-read the account from the database on every request (revocation is immediate) and refuse cross-origin POST/DELETE. Don't trust JWT claims on their own.
- Scope client data by the `cid` returned from `requireUser`, never by an id sent from the browser.
- Parse bodies with `readBody`, validate ids with `isUuid`, and keep multi-row writes in a single SQL statement (CTE) so a failure leaves nothing half-written.
- Login compares unknown emails against a real 60-character bcrypt hash; a malformed hash returns instantly and leaks which emails exist.
- Demo is either explicit (`PORTAL_MODE=demo`, answered by the server in `/api/me`) or localhost/`file://`. Never fall back to it because an API call failed.
- `/api/videos` must only request folders tied to the viewer: their client's projects, an admin's chosen project, or `VIMEO_DEMO_FOLDER_ID` in demo mode. Keep the Vimeo token server-side.
- The render object in `index.html` is one big literal. A duplicated key silently wins (that is how Sign out was broken), so search for a name before adding one.
- `support.js` is a generated runtime shared with the website; don't edit it. Never put a stylesheet link or synchronous script inside `<helmet>` (it blocks `DOMContentLoaded`, which is when the page boots).
- The browser parses the raw template before the runtime renders it, so a bound `src="{{ x }}"` makes it request the literal `/{{ x }}` (a 404 on every load). Bind URLs as `sc-camel-src="{{ x }}"`: the runtime turns it into the React `src` prop and the browser ignores it. The same applies to `poster`, `srcset`, and iframe `src`.
- `animation:viewIn` ends on `transform:none` and overrides an inline `transform`. Don't centre an animated element with `translateX(-50%)`; use `left:0;right:0;margin:0 auto;width:max-content` (as the toast does).

## Clarity conventions — keep these when changing the UI

- Every word a client sees follows `docs/WRITING.md` (from the Murphy's Laws poster): plain words, buttons that name the action, no promise that isn't always true, no feature described that doesn't exist, confirmation before anything hard to undo.
- The privacy notice for the portal is on the website (`noblemanproductions.gotit2work.com/privacy#portal`, linked from sign-in, Help, and Account). It lists the `np_session` cookie, the `np-review-time` and `np-portal-seen` storage keys, and every field the database keeps. Adding a cookie, storage key, third-party service, or stored field means updating the website's `privacy.html` in step.
- Actions that would contact someone or move a file use `this.say(real, demo)`, never a bare `toast`: in demo mode (`state.preview`) it says plainly that nothing was sent ("Demo only: …").
- Home always leads with **Your next step** (`next` in `renderVals`); keep it to one clear action.
- Every screen has a one-line purpose sentence under its title and a way back. The **Help** panel (`helpSteps`) explains the four main screens; add a step if you add a screen.
- Approving a version asks first (`confirming`). Keep a confirmation on anything hard to undo.
- Look matches the website: `assets/np.css` + `assets/np.js` (copied from the website; bump `?v=`), headlines are Cormorant Garamond, and the mobile bar uses the website's maritime icons in `media/icons/` (anchor = Home, camera = Projects, porthole play = Review, pennant = Library, paper boat = Files; Account is the user's initials).
- A button that is `display:flex` with a `gap` spaces every text node apart, so give it one bound label (`{{ watchLatest }}`), not text plus a binding.

## Verifying changes

No test suite yet. What worked: point `@neondatabase/serverless` at a shim backed by PGlite (real Postgres in WASM, `npm i @electric-sql/pglite`) that loads `schema.sql`, run the `api/*.js` handlers behind a small local server, and script the lifecycle with fetch: bootstrap, login, admin create and delete, revocation, cross-origin 403, throttle 429. For Vimeo, stub `api.vimeo.com` responses in the local server (folder id → video objects) and check per-viewer folder isolation. For the player, serve Vimeo's real `player.js` with a stand-in iframe speaking its postMessage protocol (`{event:"ready"}`, `{method:"addEventListener"}` → `{event:"playing"}`). Drive the UI with Playwright and the preinstalled Chromium (`/opt/pw-browsers`).
