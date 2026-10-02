# Nobleman Productions — Client Portal

`portal.noblemanproductions.gotit2work.com`. Clients sign in to watch versions of their films, leave notes pinned to a moment, approve or ask for changes, download finished films, swap files, and message Jean and Justin. Staff run everything from **Studio**: clients, people, projects, the Vimeo folder behind each project, and which of the ten capabilities each project's client gets.

The runbook for both Nobleman sites (Vercel, DNS at GoDaddy, validation, rollback) is `docs/DEPLOYMENT.md` in `Gotit2work/nobleman-website`. This README covers what is specific to the portal.

## How it's built

| Part | What | Where |
|---|---|---|
| Front end | React 18 + [htm](https://github.com/developit/htm), plain ES modules, no build step | `index.html`, `app/*.js`, `app/portal.css` |
| Look | The website's type and motion (`assets/np.css`, `assets/np.js`, copied; bump `?v=`), maritime icons in `media/icons/` | |
| API | Five Vercel functions (Hobby allows 12) | `api/session.js`, `portal.js`, `media.js`, `files.js`, `admin.js` |
| Data | Postgres (Neon now; any Postgres works). The schema applies itself | `api/_schema.js`, `api/_db.js` |
| Video | Jean's Vimeo account through its API. The token never reaches the browser | `api/_vimeo.js` |
| Files | A private Vercel Blob store. Browsers upload straight to it with a short-lived token | `api/files.js` |
| Email | Resend (optional) | `api/_notify.js` |
| Vendored | React 18.3.1, htm 3.1.1, `@vercel/blob` 2.8.0 browser client | `vendor/` (immutable cache) |

Pages are client-side routes served by one `index.html` (rewrite in `vercel.json`): `/` Home, `/review`, `/films`, `/files`, `/messages`, `/account`, `/studio/…` (staff), `/demo/…` (the public sample), `/signin`.

**Navigation.** On desktop (960 px and wider) a floating capsule on the left: Home, Review, Films, Files, Messages, Studio (staff), then Help and Account. A glow slides to the current page; hovering shows what each one is for; badges count what's waiting. On phones it becomes a bottom bar (a **More** tab holds the rest when there are more than five).

**Sign-in** is the "screening room": the reel plays behind a REC frame on desktop, with the sign-in door beside it. Forgotten passwords are reset by staff (Studio → People), and the page says so.

## Accounts and capabilities

- **Staff** (`admin`): Jean, Justin, Alexis. See every client and use Studio.
- **Client** people belong to one client company and see only that company's projects that aren't archived.

New people are added in Studio → People. The portal makes a temporary password, shows it once, and builds an invitation message to copy; the person must choose their own password the first time they sign in. **The portal doesn't email the invitation**; send it however you normally reach them. Changing a password, resetting one, or changing someone's account type or company signs them out everywhere at once.

Each project has ten switches (Studio → Projects → Edit → "What <client> can do"). The server enforces them on every request; the page only hides what's off. Staff can always do everything.

| Switch | Default | What the client gets |
|---|---|---|
| Review versions | on | Watch each version, leave notes pinned to a moment |
| Approve versions | on | Approve, or ask for changes (needs Review) |
| Download finished films | on | The sizes Vimeo has ready |
| Download original files | off | Also the original upload (needs Download) |
| Captions and chapters | on | Caption files (WebVTT) and chapter jumps |
| Share links | off | Copy a finished film's link (only if the film is shareable on Vimeo) |
| Play counts | off | Plays per finished film. The portal's player runs with Vimeo's do-not-track setting, so plays in the portal aren't counted |
| Files from Nobleman | on | Documents staff add: quotes, schedules, call sheets |
| Uploads | off | Send files, and send video to the project's Vimeo folder |
| Messages | on | A message thread with Nobleman for the project |

## Vimeo

Each project points at **one folder** in Jean's Vimeo account (Studio → Projects → Edit → Vimeo folder; pick it from the list or type the number at the end of the folder's address).

- A title with a version number becomes a version in **Review**: "Harbor Spot V2", "Harbor Spot v3", "Harbor Spot - Version 4", "Harbor Spot (V5)". Versions with the same name before the number are one cut. "V8 Engine Film" is not a version: the marker must follow a space, dash, or bracket.
- Any other video in the folder is a finished film in **Films**.
- Videos a client sends through the portal are listed under **Files** and never shown as films. They arrive in the folder as "From <client>: <file name>", private on Vimeo ("only me").
- Videos staff send through the portal keep their name, so "… V4" becomes Version 4. They arrive **unlisted** (not on vimeo.com search or profiles, playable through the portal) with downloads off.
- Videos still processing are skipped until Vimeo has them ready. The folder list is cached for two minutes per server; Studio → Vimeo & connections → **Refresh from Vimeo** clears it.

**Privacy each video needs.** To play in the portal a video must allow embedding: Vimeo → the video → Settings → Privacy → *Who can watch* **Unlisted** or **Hide from Vimeo**, and *Where can this be embedded* **Anywhere** or **Specific domains** including `portal.noblemanproductions.gotit2work.com`. "Only me" videos don't play in the portal.

**Downloads and Jean's plan.** Vimeo only gives download links through its API on **Standard and above**. Jean's account is on **Plus**, so the portal can't list download sizes. Instead, when a film allows downloads on Vimeo (Settings → Privacy → *Allow downloads*) and is shareable (Unlisted or Public), clients get a **Download on Vimeo** button that opens the film's Vimeo page. Otherwise clients see "Downloads aren't available for this film", and staff see the reason. Upgrading to Standard turns on the full list (Original, 4K, 1080p…) with no code change.

**The token.** Vimeo → developer.vimeo.com → **Create an app** (signed in as Jean) → the app → **Generate an access token** → *Authenticated (you)* with these scopes:

| Scope | Used for |
|---|---|
| Public, Private | Read the account, folders, and private or hidden videos |
| Edit | Name uploads and set their privacy |
| Upload | Accept videos sent through the portal |
| Video Files | Download links (Standard plan and above) |
| Stats | Play counts |

Studio → **Vimeo & connections** checks the token and shows a tick or cross for each scope, the plan, and the upload space left.

## Files

Documents and client files live in a **private** Vercel Blob store: nothing in it has a public address. Uploads go straight from the browser to Blob with a token that allows one file at one path; the API only records it once the file has landed. Downloads use a signed link that works for ten minutes. Limit: 500 MB per file. Videos go to the project's Vimeo folder instead when it has one (up to 50 GB each). Deleting a client or project deletes its stored files.

## Email updates (optional)

With `RESEND_API_KEY` and `PORTAL_EMAIL_FROM` set, staff get an email when a client leaves a note, approves or asks for changes, sends a message, or uploads; clients get one when staff message them, add a file, or add a video. Each person can switch these off under Account. Without the variables, nothing is emailed and the Account page doesn't offer the switch.

## Demo mode

`PORTAL_MODE=demo` opens the portal at `/` to anyone as a sample client ("Jonathan Reyes, Meridian"), with nothing saved: every action says "Demo only: …". It's a server setting, never a fallback: if the API fails, the sign-in screen shows the problem. The sample is always at `/demo` too, so the website can link to it after go-live. In demo mode, `/signin` still reaches the real sign-in.

## Environment variables

| Variable | Needed | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Set by Vercel when you create Neon under Storage. `POSTGRES_URL` also works |
| `SESSION_SECRET` | yes | 32+ random characters (`openssl rand -base64 48`). Changing it signs everyone out. Mark **Sensitive** |
| `BOOTSTRAP_SECRET` | first run | Any long random text. The setup code for the first staff account. Remove after setup |
| `VIMEO_ACCESS_TOKEN` | for video | Scopes above. Mark **Sensitive** |
| `VIMEO_USER_ID` | rarely | Only if the token belongs to a different Vimeo user than the folders' owner |
| `BLOB_READ_WRITE_TOKEN` | for files | Set by Vercel when you connect a Blob store |
| `RESEND_API_KEY` | no | Turns on email updates |
| `PORTAL_EMAIL_FROM` | with Resend | For example `Nobleman Productions <portal@gotit2work.com>`. Must be on a domain verified in Resend |
| `PORTAL_MODE` | no | `demo` = public sample at `/`. Remove it to go live |

Environment variables only apply to new deployments: **redeploy after every change**.

## Going live

Today the portal runs with `PORTAL_MODE=demo` and nothing else. In order:

1. **Database.** Vercel → `nobleman-portal` → Storage → **Create Database** → Neon → region `iad1` (Washington, D.C., next to the functions) → connect it to Production and Preview. *Result:* `DATABASE_URL` appears under Settings → Environment Variables. No SQL to run: the first request creates the tables.
2. **File storage.** Storage → **Create** → Blob → access **Private** → connect to the project. *Result:* `BLOB_READ_WRITE_TOKEN` appears.
3. **Secrets.** Add `SESSION_SECRET` and `BOOTSTRAP_SECRET` (Sensitive, Production and Preview).
4. **Vimeo.** Jean creates the token (scopes above) and adds it as `VIMEO_ACCESS_TOKEN` (Sensitive).
5. **Email (optional).** Needs a Resend account with `gotit2work.com` verified (website runbook, Phase 5; the same key can serve the website's contact form). Then add `RESEND_API_KEY` (Sensitive) and `PORTAL_EMAIL_FROM`.
6. **Go live.** Delete `PORTAL_MODE`, then Deployments → latest → **Redeploy**.
7. **First staff account.** Open the portal. It shows **Set up the portal**: enter the `BOOTSTRAP_SECRET` value as the setup code, your name, email, and a password. You're signed in. It only works while no staff account exists. Then delete `BOOTSTRAP_SECRET` and redeploy.
8. **Set up.** Studio → Vimeo & connections: every scope ticked. Studio → People: add Jean and Justin as Staff. Studio → Projects → **New project** for each client (create the client in the same step), pick its Vimeo folder, set the switches.
9. **Invite clients.** Studio → People → Add a person → copy the invitation → send it.

**Check it worked.** Sign in on a phone and on a laptop; open a project as a test client account; play a version, leave a note, approve it in a test project, send a message, upload a small file, download it. Studio → Vimeo & connections shows nothing red.

**Roll back.** Set `PORTAL_MODE=demo` again and redeploy: the public sample returns and nothing in the database is touched. Or Vercel → Deployments → an earlier one → **Promote to Production**.

## Security model

- **Sessions:** a signed JWT (HS256, `SESSION_SECRET`) in the `np_session` cookie (httpOnly, Secure, SameSite=Lax, 7 days). Every request re-reads the person from the database and checks the session version, so removal, a reset, or a role change takes effect at once.
- **Passwords:** bcrypt (cost 10), at least 10 characters, can't be reused when changed. Unknown emails are checked against a real dummy hash so timing doesn't reveal accounts.
- **Throttling:** 8 failed sign-ins per email or 30 per IP in 15 minutes, then 429 until the window passes. To unlock someone early: Studio → People → Reset password.
- **Scoping:** clients only ever reach their own company's non-archived projects (`projectFor` in `api/_auth.js`); every capability is checked server-side.
- **Cross-origin:** POSTs a browser sends from another origin are refused (403). SameSite alone isn't enough because every `*.gotit2work.com` host counts as the same site.
- **Headers:** `X-Frame-Options: DENY`, `noindex`, `nosniff`, a strict referrer policy, camera/microphone/location off, and `no-store` on the API.

## Moving to Supabase later

The data layer is plain Postgres. To move: create the Supabase project; copy the data (`pg_dump --data-only` from Neon, `psql` into Supabase, or Supabase's import tool); set `DATABASE_URL` to Supabase's **pooled** connection string (port 6543); redeploy. `api/_db.js` uses Neon's HTTP driver for Neon addresses and `postgres.js` for everything else, with prepared statements off for the pooler. The schema applies itself on the first request. To read it as SQL: `node -e "import('./api/_schema.js').then(m => console.log(m.STATEMENTS.join(';\n\n') + ';'))"`.

## API

| Route | Who | |
|---|---|---|
| `GET /api/session` | anyone | Who's signed in; whether setup is needed |
| `POST /api/session` | anyone / signed in | `login`, `logout`, `setup`, `password`, `profile` |
| `GET /api/portal` | signed in | Everything this person can see; `?demo=1` (anyone), `?thread=`, `?notes=&video=` |
| `POST /api/portal` | signed in | `note`, `resolve`, `deleteNote`, `decide`, `message` |
| `GET /api/media` | signed in | Downloads, captions, chapters for one video |
| `POST /api/media` | signed in | `uploadStart`, `uploadDone`, `uploadCancel` (Vimeo) |
| `GET/POST /api/files` | signed in | Signed download link; `start`, `done`, `cancel`, `delete` (Blob) |
| `GET/POST /api/admin` | staff | Overview, `?folders=1`; client, person, and project actions, `vimeoRefresh` |

## Testing

`tests/` runs the whole portal offline: three local servers with an in-memory Postgres (PGlite) and fake Vimeo, Blob, and Resend. Not deployed.

```bash
npm ci && (cd tests && npm ci)
cd tests && npm test        # 102 API checks, then 43 browser checks (desktop and phone)
npm run shots               # screenshots of every screen in tests/.work/shots
```

Chromium: set `CHROMIUM_PATH`, or run `npx playwright install chromium` once (Claude Code's cloud containers already have it). Seeded accounts: `alexis@gotit2work.com` (staff), `dana@harbor.test`, `rob@moto.test`, all with the password `portal-test-pass`.

## Writing

Every word a client sees follows [docs/WRITING.md](docs/WRITING.md): plain words, buttons named for what they do, no promise that isn't always true, a demo that says it's a demo, and a confirmation before anything hard to undo.
