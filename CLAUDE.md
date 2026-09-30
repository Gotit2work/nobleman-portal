# Nobleman client portal — project notes

Client portal for Nobleman Productions at `portal.noblemanproductions.gotit2work.com`. Operated by Alexis / GotIT2Work. The marketing site is `Gotit2work/nobleman-website`; its `docs/DEPLOYMENT.md` is the runbook for both.

## Ownership and infrastructure

- **Alexis owns `gotit2work.com`.** DNS is at GoDaddy (`ns17/ns18.domaincontrol.com`). The apex points at Lovable (`185.158.133.1`) and email is Microsoft 365. Touch neither; this project only needs a CNAME for `portal.noblemanproductions`.
- Vercel: account `amangual1`, team slug `gotit2-work`. Hobby as of 2026-09-30; commercial use requires Pro.
- Database: Neon Postgres through Vercel Storage (`DATABASE_URL`; `POSTGRES_URL` also accepted). The schema is `schema.sql` and is idempotent; re-run the whole file after changes.

## State of the product

- Real: sign-in, sessions, roles (admin/client), account management API, sign-in throttling.
- Prototype: every project, version, comment, file, and message is hardcoded sample data ("Meridian"). No admin screens; accounts are created via curl (README).
- Next increments: projects stored per client (read path first), then version review with Vimeo embeds, comments and approvals, file storage (Vercel Blob), and messages and notifications.

## Security invariants — keep these when extending the API

- Every route that needs a user calls `requireUser` / `requireAdmin` from `api/_auth.js`. They re-read the account from the database on every request (revocation is immediate) and refuse cross-origin POST/DELETE. Don't trust JWT claims on their own.
- Scope client data by the `cid` returned from `requireUser`, never by an id sent from the browser.
- Parse bodies with `readBody`, validate ids with `isUuid`, and keep multi-row writes in a single SQL statement (CTE) so a failure leaves nothing half-written.
- Login compares unknown emails against a real 60-character bcrypt hash; a malformed hash returns instantly and leaks which emails exist.
- The front end's demo fallback must stay limited to localhost and `file://`.
- `support.js` is a generated runtime shared with the website; don't edit it. Never put a stylesheet link or synchronous script inside `<helmet>` (it blocks `DOMContentLoaded`, which is when the page boots).

## Verifying changes

No test suite yet. What worked: point `@neondatabase/serverless` at a shim backed by PGlite (real Postgres in WASM, `npm i @electric-sql/pglite`) that loads `schema.sql`, run the `api/*.js` handlers behind a small local server, and script the lifecycle with fetch: bootstrap, login, admin create and delete, revocation, cross-origin 403, throttle 429. Drive the UI with Playwright and the preinstalled Chromium (`/opt/pw-browsers`).
