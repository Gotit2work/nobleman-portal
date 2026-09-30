# Nobleman client portal — project notes

Client portal for Nobleman Productions at `portal.noblemanproductions.gotit2work.com`. Operated by Alexis / GotIT2Work. The marketing site is `Gotit2work/nobleman-website`; its `docs/DEPLOYMENT.md` is the runbook for both.

## Ownership and infrastructure

- Vercel project `nobleman-portal` (`prj_3HnVWrxGKofXm6EUvEPF1Jg2xCR8`), created 2026-09-30 in team `gotit2-work`: framework Other, Node 22.x, Vercel Authentication on previews only (production is public), custom domain attached and ownership-verified. Env: `PORTAL_MODE=demo` (Production, Preview, Development). No database, `SESSION_SECRET`, or Vimeo token yet. Not yet linked to GitHub: the Vercel GitHub App was not installed on `Gotit2work`, so deploys from Git failed with `repo_not_found`. Once linked (Project → Settings → Git), deploy the fix branch or merged `main` to production.
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

## Verifying changes

No test suite yet. What worked: point `@neondatabase/serverless` at a shim backed by PGlite (real Postgres in WASM, `npm i @electric-sql/pglite`) that loads `schema.sql`, run the `api/*.js` handlers behind a small local server, and script the lifecycle with fetch: bootstrap, login, admin create and delete, revocation, cross-origin 403, throttle 429. For Vimeo, stub `api.vimeo.com` responses in the local server (folder id → video objects) and check per-viewer folder isolation. For the player, serve Vimeo's real `player.js` with a stand-in iframe speaking its postMessage protocol (`{event:"ready"}`, `{method:"addEventListener"}` → `{event:"playing"}`). Drive the UI with Playwright and the preinstalled Chromium (`/opt/pw-browsers`).
