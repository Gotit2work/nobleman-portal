# Nobleman Productions — Client Portal

Static front end plus serverless API routes, Neon Postgres for data. Vercel runs `npm install`; there is no build step.
The step-by-step runbook for both Nobleman sites (Vercel, DNS at GoDaddy, validation, rollback) is `docs/DEPLOYMENT.md` in `Gotit2work/nobleman-website`. This README covers what is specific to the portal.

Pages
- `/` → index.html. The layout is responsive; there is no separate mobile page.
- `/?signin` → the sign-in screen, even in demo mode.

## Demo mode

`PORTAL_MODE=demo` opens the portal to anyone as the sample client ("Jonathan Reyes, Meridian"), with no sign-in and no database needed. That's how the live portal runs today. It is an explicit server setting, not a fallback: remove the variable (and redeploy) and every visitor must sign in.

In demo mode a real session still wins. Staff can sign in at `/?signin` and see their own account, and signing out returns to the demo. The demo's own Sign out button just explains that it's a demo.

## Roles

Two kinds of account, enforced server-side:

- **admin** — Jean, Justin, Alexis. Not tied to any client. Can create and remove accounts and see every client.
- **client** — belongs to exactly one client organisation and sees only that organisation's work.

The database rejects an admin scoped to a client, and a client user with no client, so the shape can't drift.

## Setup, in order

**1. Create the database.** In the Vercel project: Storage → Create Database → Neon. Vercel sets `DATABASE_URL` for you. (Creating it directly at neon.tech works too — then paste the pooled connection string in as `DATABASE_URL` yourself.)

**2. Create the tables.** Neon console → SQL Editor → paste all of `schema.sql` → Run. Every statement is idempotent: after pulling an update, re-run the whole file to add anything new (for example the `login_attempts` table used for sign-in throttling).

**3. Set the environment variables.**

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Set automatically if you created Neon through Vercel |
| `SESSION_SECRET` | yes | 32+ random characters. `openssl rand -base64 48`. Changing it signs everyone out |
| `BOOTSTRAP_SECRET` | first run only | Any long random string. Guards the one-time admin setup |
| `PORTAL_MODE` | no | `demo` = public sample portal (see above). Unset = sign-in required |
| `VIMEO_ACCESS_TOKEN` | no | Enables real films (see "Connecting Vimeo"). Mark it **Sensitive** in Vercel |
| `VIMEO_DEMO_FOLDER_ID` | no | Vimeo folder the public demo plays from. Without it the demo keeps its sample films |
| `VIMEO_USER_ID` | no | Owner of the folders, if the token belongs to a different Vimeo user. Defaults to the token's account |

**4. Deploy.** Import `Gotit2work/nobleman-portal` into Vercel with Framework Preset **Other**, no build command, no output directory. Then Settings → Domains → `portal.noblemanproductions.gotit2work.com`, and add the CNAME Vercel shows at GoDaddy (Name: `portal.noblemanproductions`). Redeploy after setting environment variables; they only apply to new deployments.

**5. Create the first admin.** Once, from your terminal:

```bash
curl -X POST https://portal.noblemanproductions.gotit2work.com/api/bootstrap \
  -H 'content-type: application/json' \
  -d '{"secret":"<BOOTSTRAP_SECRET>","name":"Alexis","email":"alexis@gotit2work.com","password":"<at least 10 chars>"}'
```

It refuses to run a second time once an admin exists, so it is safe to leave deployed. Remove `BOOTSTRAP_SECRET` afterwards and redeploy anyway; a secret that no longer exists can't leak.

**6. Sign in** at `portal.noblemanproductions.gotit2work.com`.

## Adding Jean, Justin, and client accounts

The API is live but **the admin screens are not built yet** — that is the next increment. Until then, create accounts with a signed-in admin session:

```bash
# sign in and keep the cookie
curl -c jar.txt -X POST https://portal.noblemanproductions.gotit2work.com/api/login \
  -H 'content-type: application/json' \
  -d '{"email":"alexis@gotit2work.com","password":"..."}'

# another admin
curl -b jar.txt -X POST https://portal.noblemanproductions.gotit2work.com/api/admin/users \
  -H 'content-type: application/json' \
  -d '{"name":"Jean","email":"jean@noblemanproductions.com","role":"admin","password":"..."}'

# a client user, creating their organisation at the same time
curl -b jar.txt -X POST https://portal.noblemanproductions.gotit2work.com/api/admin/users \
  -H 'content-type: application/json' \
  -d '{"name":"Jonathan Reyes","email":"jonathan@meridian.com","title":"Marketing Director","role":"client","clientName":"Meridian","password":"..."}'

# list accounts (to find ids), then remove one; their session stops working immediately
curl -b jar.txt https://portal.noblemanproductions.gotit2work.com/api/admin/users
curl -b jar.txt -X DELETE https://portal.noblemanproductions.gotit2work.com/api/admin/users \
  -H 'content-type: application/json' -d '{"id":"<user id>"}'
```

## API

| Route | Method | Who |
|---|---|---|
| `/api/login` | POST | anyone |
| `/api/logout` | POST | anyone |
| `/api/me` | GET | signed in (or anyone, in demo mode) |
| `/api/videos` | GET | signed in (or anyone, in demo mode: demo folder only) |
| `/api/bootstrap` | POST | secret, once |
| `/api/admin/users` | GET, POST, DELETE | admin |
| `/api/admin/clients` | GET, POST | admin |

## Security model

- **Sessions** are a signed JWT (HS256, `SESSION_SECRET`) in an httpOnly, Secure, SameSite=Lax cookie, good for 7 days. Every protected request re-reads the account from the database, so removing someone or changing their role takes effect immediately rather than when the cookie expires.
- **Passwords** are bcrypt hashed (cost 10). Unknown emails are checked against a real dummy hash, so sign-in takes the same ~90 ms whether or not the account exists and timing can't be used to discover accounts.
- **Throttling.** After 8 failed sign-ins for one email, or 30 from one IP, within 15 minutes, sign-in answers 429 until the window passes. A successful sign-in clears that email's failures. To unlock someone early: `delete from login_attempts where email = '...';` in the Neon SQL editor.
- **Cross-origin requests.** Every POST/DELETE sent by a browser from another origin is refused (403). SameSite=Lax alone doesn't stop this, because every `*.gotit2work.com` host counts as the same site. Requests without an `Origin` header (curl) are allowed.
- **Bootstrap secret** is compared in constant time.
- **Headers:** `X-Frame-Options: DENY` (no clickjacking), `X-Robots-Tag: noindex`, `nosniff`, and `Cache-Control: no-store` on the API.

## Connecting Vimeo

The portal is wired for Vimeo already; it only needs a token and folder ids. Until then it shows its sample films.

**How it works.** Each project maps to one Vimeo folder. `GET /api/videos` calls Vimeo's API from the server (the token never reaches the browser), and the page replaces the sample films with what it finds:

- Titles containing a version number ("Harbor Spot V2", "v3", "Version 4") become **review cuts**. The highest number is the current cut, and the version picker switches between them.
- Everything else in the folder becomes a **Library** deliverable. The newest one is featured.
- If the folder has no cuts, or no deliverables, that half keeps the sample content.
- Videos still transcoding are skipped. Results are cached for two minutes per server instance.

Who sees which folder:

| Viewer | Folders |
|---|---|
| Client | Their own client's active projects with a `vimeo_folder_id` (up to 5) |
| Admin | `?project=<project uuid>` on `/api/videos`; otherwise the demo folder in demo mode |
| Anyone, demo mode | `VIMEO_DEMO_FOLDER_ID` only |
| Anyone, otherwise | Nothing (401) |

**Setup**

1. developer.vimeo.com → **Create an app** (Jean's Vimeo account, since it owns the videos) → **Authentication → Generate an access token** → *Authenticated (you)*, scopes **Public** and **Private**. Copy the token.
2. Vercel → portal project → Environment Variables → `VIMEO_ACCESS_TOKEN` (type **Sensitive**, Production and Preview).
3. For the public demo: make a Vimeo folder (for example "Portal demo") with a few finished films plus a couple of cuts named "… V1", "… V2". Its id is the number at the end of the folder's URL. Set `VIMEO_DEMO_FOLDER_ID` to it.
4. Redeploy.
5. For real clients (once the database is set up): re-run `schema.sql` (it adds `projects.vimeo_folder_id`), then `update projects set vimeo_folder_id = '<folder id>' where id = '<project uuid>';` in the Neon SQL editor.

Each video's Vimeo privacy must allow embedding on `portal.noblemanproductions.gotit2work.com` (Settings → Privacy → Embed: *Anywhere* or *Specific domains*). "Hide from Vimeo" / unlisted works; the private hash is handled automatically.

**Not wired yet:** downloads (Vimeo's download links need the `video_files` scope and a paid plan tier), comments, approvals, and notifications. Those still come from the sample data.

## What is real and what is not

Login, roles, and account management are real and backed by the database. The greeting and the Account page show the signed-in person, and the films come from Vimeo once it is connected (see above).

**Everything else the portal displays is still hardcoded**: projects, stages, review comments, approvals, messages, files, documents (all the sample "Meridian" campaign). It looks live and it is not: nothing saves, uploads go nowhere, and a refresh resets it. Treat the portal as a real login in front of a prototype until increments 2 and 3 land, and **don't give clients logins before then**, because every client would see the same sample project.

On `localhost` or a `file://` preview with no backend, the page falls back to a demo identity so the design still opens. On any other host, the demo only appears when the server says so (`PORTAL_MODE=demo`); a missing or failing API keeps the sign-in screen up with an error rather than failing open.

## Writing

All client-facing copy follows [docs/WRITING.md](docs/WRITING.md): plain words, honest promises, and a demo that says it's a demo. Check new copy against its checklist before shipping.
