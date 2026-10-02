# Nobleman Productions — Client Portal

`portal.noblemanproductions.gotit2work.com`. Clients log in to watch the newest version of their film, leave notes pinned to a moment, approve it (with small fixes if they like) or ask for changes, download and share finished films, swap files, and message the studio. Staff run everything from **Studio** without touching code: projects, clients, people and roles, video sources (Vimeo, Frame.io, YouTube, Wistia, or pasted links), Notion tracking, email, settings, and the activity log. Code changes are only needed to add or remove a capability (see "Changing what the portal can do").

The runbook for both Nobleman sites (Vercel, DNS at GoDaddy, validation, rollback) is `docs/DEPLOYMENT.md` in `Gotit2work/nobleman-website`. This README covers what is specific to the portal.

## How it's built

| Part | What | Where |
|---|---|---|
| Front end | React 18 + [htm](https://github.com/developit/htm), plain ES modules, no build step | `index.html`, `app/*.js`, `app/portal.css` |
| Look | The website's type (`assets/np.css`, copied; bump `?v=`), maritime icons in `media/icons/`. Not the website's scroll motion: the portal is an app, so screens just fade in | |
| API | Eight Vercel functions (Hobby allows 12) | `api/session.js`, `portal.js`, `media.js`, `files.js`, `admin.js`, `share.js`, `connect.js`, `cron.js` |
| Data | Postgres (Neon now; any Postgres works). The schema applies itself | `api/_schema.js`, `api/_db.js` |
| Video | One module per provider behind a common interface; keys stored encrypted | `api/_providers/`, `api/_sources.js`, `api/_video.js` |
| Tracking | Notion (optional): one row per project | `api/_notion.js` |
| Files | A private Vercel Blob store. Browsers upload straight to it with a short-lived token | `api/files.js` |
| Email | Resend (optional), set up in Studio or by environment variables | `api/_notify.js`, `api/_links.js` |
| Vendored | React 18.3.1, htm 3.1.1, `@vercel/blob` 2.8.0 browser client, qrcode-generator 1.4.4 (MIT) | `vendor/` (immutable cache) |

Pages are client-side routes served by one `index.html` (rewrite in `vercel.json`): `/` Home, `/review`, `/films`, `/files`, `/messages`, `/account`, `/studio/…` (staff), `/watch/<token>` (share pages, no login), `/link/<token>` (emailed invitations, login links, and sign-up confirmations), `/signin` or `/login` (the login), `/signup` (create an account), `/demo/…` (the public sample), `/signin`.

**Navigation.** On desktop (960 px and wider) a floating capsule on the left: Home, Review, Films, Files, Messages, Studio (staff), then Help and Account. On phones it's an app: a plain bar on top (logo, Help, Account) and a flat tab bar at the bottom (a **More** tab holds the rest when there are more than five), with underlined tabs, squarer corners, and shorter pages (Home's long lists show the newest few; Studio's page intros are left out). Every tab and button appears only when the project and the person's role allow it.

**One login for everyone.** Clients, staff, and owners log in at the same door; what they see next depends on who they are. Clients get their own company's projects; staff also get the studio's side (the staff board on Home, Studio, every version, the activity log), as far as their role allows. The door is the "screening room": a photo behind a REC frame (a camera at work at night, `media/login-camera.jpg`, unless staff choose another or upload their own in Studio → Settings → Login screen), the studio's Murphy's Law under the title ("The one frame nobody checked is the one everyone sees." Editable in Studio → Settings → Login screen; on phones it sits under the form), and a short login beside it. No video plays on the login, so it loads fast and asks nothing of Vimeo before anyone logs in. People log in with a password, or with an emailed login link when email is set up; "Forgot your password?" emails a reset link. A **Create an account** tab sits next to **Log in** (see "Creating an account").

## What clients see

The goal: a busy executive opens an email, presses one button, and approves a film without learning anything.

- **One next step.** Home leads with the single thing that needs them ("Version 3 of Harbor Spot is ready for you" → **Watch Version 3**). A first-visit welcome explains Watch → Note → Approve once.
- **Only the newest version.** When V2 arrives, V1 disappears for the client: Review shows one film, labelled "Version 2. The newest version. It replaces Version 1." There's never a choice to make. Staff can open every version, still one at a time: Review shows the newest, with the earlier ones in a version picker, and Studio's Videos list folds each film's earlier versions under its newest. A project can show earlier versions to the client (the same picker) with the **Earlier versions** switch.
- **Preview mark.** Versions under review carry a "Preview · Version N" mark on the player, so nobody mistakes a draft for the final.
- **Notes on the moment.** Pause anywhere, write a note, and it's pinned to that second. Players that can't report the time (Google Drive, Loom) take notes about the whole version instead, and say so.
- **Approve with small fixes.** The approve dialog has an optional "Any small fixes?" box, so "yes, but lift the logo" doesn't need another round. Approvers get a receipt by email.
- **Review-by dates and reminders.** A project can carry a "Review by" date; the client sees it, and their decision makers get one reminder before it.
- **Share links.** A finished film can be sent to people outside the portal as a page (`/watch/…`) with just that film and the studio's name. Links last 7, 30, or 90 days or until turned off, count views, and can be turned off at any time.
- **Their own team.** Decision makers invite colleagues (who get an emailed link), change their roles, and remove them. The studio is told each time.
- **Quiet email.** Emails link straight to the thing they're about, and nobody is emailed about activity while they're using the portal (active in the last 3 minutes).
- **Two-step verification** (optional for clients, can be required for staff), with recovery codes.
- **Milestone confirmation.** Staff can ask the client to confirm the next milestone (a filming day, a delivery); the client gets a **Confirm** button and staff are told.

## Creating an account

Three short steps, from the **Create an account** tab (or `/signup`):

1. **Your details:** name, work email, company, and an optional note for the studio.
2. **Confirm your email:** the portal emails a link that works once, for an hour. Nothing is created until it's used, so a typo or someone else's address goes nowhere.
3. **You're in:** if the email's domain is listed on a client (Studio → Clients → their email domain, for example `harborlabs.com`), they join that client straight away with the role set in Settings (Reviewer unless you change it), choose a password, and land in their company's projects; the studio and the client's decision makers are told. Otherwise they see "You're on the list", and the studio gets an email and a **Someone is asking to join** step on Home. In Studio → People → **Asking to join**, choose their company (a new one is suggested from what they typed) and role and press **Let them in**: they're emailed a link to choose a password. Or **Decline**, with an optional polite email.

Someone who already has an account and tries to sign up gets a way in by email instead; the screen gives the same answer either way, so nobody can learn which addresses have accounts. Free email services (Gmail, Outlook, iCloud…) can't be listed as a client's domain. Studio → Settings → Security chooses **who can create an account** (anyone, with the studio letting them in; or only people the studio invites), turns joining by domain on or off, and sets the role they join with. Sign-up needs email: without it the tab doesn't appear. Before go-live (no database yet) the tab shows the steps as a labelled preview, and nothing is sent or saved. Unconfirmed requests are deleted after a day, handled ones after 30 days.

## Roles

Every account is **staff** or **client**, with a role inside that. Owners adjust what the other roles may do in Studio → People → **What roles can do**. Owners always keep everything, and two permissions (manage staff; change settings and roles) are owner-only, so nobody can grant themselves more than an owner gave them.

| Role | Kind | By default |
|---|---|---|
| Owner | staff | Everything, including settings, connections, roles, and staff |
| Producer | staff | Clients, people, and projects day to day; not connections, settings, staff, or deleting clients |
| Editor | staff | Adds versions and files, answers notes and messages, updates progress |
| Decision maker | client | Reviews, approves versions, downloads, shares, uploads, messages, and manages their team |
| Reviewer | client | Watches and leaves notes; can't approve |
| Viewer | client | Watches and downloads; no notes or messages |

For clients, what they can do on a project is the project's switch **and** their role's permission: a decision maker can't download where Downloads is off.

## Project switches (capabilities)

Each project has its own switches (Studio → Projects → a project → "What <client> can do"). New projects start from Studio → Settings → **New projects start with**. The server enforces them on every request; the page only hides what's off. Staff can always do everything.

| Switch | Default | What the client gets |
|---|---|---|
| Review versions | on | Watch each version and leave notes pinned to a moment |
| Approve versions | on | Approve, or ask for changes (needs Review) |
| Earlier versions | off | See earlier versions next to the newest one (needs Review) |
| Download finished films | on | The sizes the video host has ready |
| Download original files | off | Also the original upload (needs Download) |
| Captions and chapters | on | Caption files and chapter jumps, where the host has them |
| Share links | off | Share pages for finished films |
| Play counts | off | Plays per finished film at the host and through share links. Plays inside the portal aren't counted |
| Files from the studio | on | Documents staff add: quotes, schedules, call sheets |
| Uploads | off | Send files, and send video to the project's Vimeo folder |
| Messages | on | A message thread with the studio for the project |

## Running the studio (Studio tabs)

| Tab | Who (by default) | What you do there |
|---|---|---|
| **Projects** | all staff | Create projects; set stage, progress, next milestone (and ask the client to confirm it), the review-by date, and send a reminder; choose the video source; see every video at the source and **hide**, **rename**, or **make it a finished film**; add videos by link; switch capabilities; archive or delete. Export all projects to a spreadsheet |
| **Clients** | owners, producers | Add and edit companies (name, logo shown in their portal, email domain for joining by sign-up, private notes); **Export data** (everything the portal holds about a client, as JSON, for access requests or offboarding); delete |
| **People** | owners, producers | **Asking to join**: let people who created an account in (company and role) or decline them. Invite people (an emailed one-time link to choose a password, also shown to copy); change role, company, or email; resend an invitation or send a reset link; log someone out everywhere; turn off two-step verification for a lost phone; remove. **What roles can do** is the roles table |
| **Connections** | owners | Add, test, change, and remove video accounts (Vimeo, Frame.io, YouTube, Wistia), Notion, and email. Keys are encrypted and never shown again |
| **Settings** | owners | A short list of sections, each with a one-line summary; one opens at a time. Studio name, help email, addresses, the line above Messages; the login screen's photo (one of the studio's, or an upload, resized in the browser to 2400 px and served by `GET /api/session?loginImage=<id>`; a replaced upload is deleted) and its Murphy's Law; the first-visit welcome; a notice for everyone; project stages (names, progress, order); defaults for new projects; security (require two-step verification for staff, emailed login links, how long logins last, client teams, who can create an account, joining by email domain); review reminders; **System check** |
| **Activity** | owners, producers | Who did what and when (logins, sign-ups, views, downloads, approvals, Studio changes), filtered by kind of person, client, project, or word; export to a spreadsheet. Kept about 13 months |

**System check** (first in Settings) lists anything that needs attention: missing secrets, the setup code still set, the demo still on, file storage, email, the daily job, each connection, Notion, fewer than two owners, staff without two-step verification.

## Video sources

A project's videos come from **one** place: a folder (or playlist, or project) in a connected account, or **Video links** pasted one by one. Choose it in Studio → Projects → a project → Video source. In every source, a title with a version number becomes a version in Review: "Harbor Spot V2", "Harbor Spot v3", "Harbor Spot - Version 4", "Harbor Spot (V5)". Versions with the same name before the number are one cut. "V8 Engine Film" is not a version: the marker must follow a space, dash, or bracket. Anything else is a finished film. Staff can override either way per video (**Make it a finished film**), rename what the client sees, or hide a video, without changing anything at the source.

| Source | Plays in | Versions | Downloads | Captions | Uploads from the portal | Play counts |
|---|---|---|---|---|---|---|
| Vimeo | Vimeo's player | by name | Standard plan and above (else "Download on Vimeo") | yes, and chapters | yes, to the folder | yes |
| Frame.io | the portal's player (signed links fetched at play time) | **version stacks**, then by name | original and smaller copies | no | no | no |
| YouTube | YouTube's privacy-enhanced player | by name | no | no | no | yes |
| Wistia | the portal's player | by name | yes | yes | no | no |
| Video links | the link's own player | by name | no | no | no | no |

### Vimeo

Connect in Studio → Connections → Add a connection → Vimeo, or keep the token in Vercel as `VIMEO_ACCESS_TOKEN` (it then shows as "Set in Vercel"). Token: developer.vimeo.com → **Create an app** (signed in as Jean) → **Generate an access token** → *Authenticated (you)* with the scopes **Public, Private, Edit, Upload, Video Files, Stats**. **Test it** ticks each scope and shows the plan and upload space.

- Each project points at one Vimeo **folder** (pick it from the list, or paste the number at the end of the folder's address).
- Videos a client sends through the portal arrive as "From <client>: <file name>", private on Vimeo ("only me"), and are listed under Files, never as films. Videos staff send keep their name (so "… V4" becomes Version 4) and arrive **unlisted** with downloads off.
- To play in the portal a video must allow embedding: *Who can watch* **Unlisted** or **Hide from Vimeo**, and *Where can this be embedded* **Anywhere** or **Specific domains** including the portal's address. "Only me" videos don't play.
- **Downloads and Jean's plan.** Vimeo gives download links through its API only on **Standard and above**. Jean's account is on **Plus**, so when a film allows downloads on Vimeo and is shareable, clients get a **Download on Vimeo** button instead. Upgrading turns on the full list with no code change.

### Frame.io

Frame.io V4 signs in through Adobe. Studio → Connections → Add a connection → Frame.io, then choose how it connects:

1. **Adobe sign-in (most accounts).** Adobe Developer Console → your project → **Add API** → Frame.io → **OAuth Web App** credential. Set its redirect URI to exactly `https://portal.noblemanproductions.gotit2work.com/api/connect` (Studio shows it with a Copy button). Paste the Client ID and Client secret into the portal, save, then press **Sign in with Adobe** on the Frame.io card. If the sign-in can see several Frame.io accounts, choose one. Adobe's refresh token lasts about 14 days unused; the daily job keeps it fresh.
2. **Server-to-server**, for accounts managed in the Adobe Admin Console: Client ID and secret only, no sign-in step.
3. **Legacy developer token**, for accounts not yet on Adobe sign-in.

Each project uses one Frame.io **folder** (pick a project from the list to use its top folder, or paste a folder ID). **Version stacks are versions**: drag the new cut onto the old one in Frame.io and the client sees only the newest. Frame.io's media links can expire within minutes, so the portal fetches them when someone presses play or download and never stores them.

### YouTube

Google Cloud console → APIs & Services → enable **YouTube Data API v3** → Credentials → **API key** (restrict it to that API). Add it in Studio; the optional channel ID lets you pick playlists from a list. Each project uses one **playlist**. Videos must be public or unlisted; private ones are skipped. No downloads or captions.

### Wistia

Wistia → Account settings → API access → **Generate a new token** (read access is enough). Each project uses one Wistia **project**. Downloads and caption files work.

### Video links (built in)

No account needed. Set a project's source to **Video links**, then on the project press **Add a video by link** and paste a YouTube, Vimeo, Google Drive (shared with anyone with the link), Loom, Wistia, Dropbox, or direct `.mp4` link. The portal looks up the title and thumbnail where it can. Add "V2" to the title for a second version.

## Notion

Keeps a Notion database with one row per project, updated as things happen: Name, Client, Stage, Progress, Review, Latest version, Open notes, Next, Review by, Last activity, a link back to the portal, and a Portal ID it matches rows by.

1. app.notion.com/developers/connections → Internal connections → **Create a new connection**. Under Configuration, turn on **Read, Update, and Insert content**. Copy its API token (it starts with `ntn_`).
2. Studio → Connections → **Connect Notion** → paste the token.
3. In Notion, open the page that should hold the projects → ••• → **Connections** → add yours.
4. Back in Studio: **Create a new database in a page** (pick the page), or **Use a database I already have** (the portal adds the columns it needs and leaves yours alone; a column with the same name but a different type stops it, so rename yours first).

Every project is added at once. After that, changes go across within seconds, and the daily job catches up on anything that changed at the video sources. A deleted project's row moves to Notion's trash. **Stop syncing** leaves the database in Notion as it is. Notion allows about 3 requests a second per connection; the portal waits and retries when it's busy.

## Email

Set up in Studio → Connections → **Connect email** (Resend: an API key with sending access, and a "Send from" address on a domain verified in Resend), or with `RESEND_API_KEY` + `PORTAL_EMAIL_FROM` in Vercel. **Send a test email** checks it end to end. With email on, the portal sends:

- invitations, account confirmations, login links, and password resets (one-time links: invitations 14 days, confirmations and resets 1 hour, login links 15 minutes);
- updates: staff hear about client notes, decisions, messages, uploads, team changes, and confirmations; clients hear about new versions, films, files, and messages (each person can switch updates off under Account);
- approval receipts and review reminders.

Without email, invitation and reset links are shown in Studio to copy and send by hand, and everything still shows up in the portal.

## Files

Documents and client files live in a **private** Vercel Blob store: nothing in it has a public address. Uploads go straight from the browser to Blob with a token that allows one file at one path; the API only records it once the file has landed. Downloads use a signed link that works for ten minutes. Limit: 500 MB per file. Videos go to the project's Vimeo folder instead when the source takes uploads (up to 50 GB each). Deleting a client or project deletes its stored files.

## The daily job

`vercel.json` → `crons` calls `/api/cron` once a day (14:17 UTC, early morning in San Diego and Las Vegas; on Hobby it runs within that hour). Vercel sends `Authorization: Bearer <CRON_SECRET>`; without `CRON_SECRET` set the job refuses to run. It sends due review reminders, refreshes Frame.io's Adobe sign-in, catches Notion up, and prunes old records (activity after about 13 months, used or expired links after a week).

## Demo mode

`PORTAL_MODE=demo` opens the portal at `/` to anyone as a sample client ("Jonathan Reyes, Meridian"), with nothing saved: every action says "Demo only: …". A **Client's view / Studio's view** switch (top right on desktop; in the Demo help on phones) shows the same sample as the studio sees it, on the same page (both views load together, so the switch is instant): the staff board, every version, someone asking to join, and all of Studio with sample clients, people, connections, settings, and activity. Studio's changes are refused with "Demo only". Link to it with `?view=studio`. It's a server setting, never a fallback: if the API fails, the login screen shows the problem. The sample is always at `/demo` too, so the website can link to it after go-live. In demo mode, `/signin` still reaches the real sign-in.

## Environment variables

| Variable | Needed | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Set by Vercel when you create Neon under Storage. `POSTGRES_URL` also works |
| `SESSION_SECRET` | yes | 32+ random characters (`openssl rand -base64 48`). Changing it signs everyone out. Mark **Sensitive** |
| `PORTAL_ENCRYPTION_KEY` | recommended | 32+ random characters. Encrypts stored connection keys. If unset, a key is derived from `SESSION_SECRET`, so changing that would mean re-entering every connection. Mark **Sensitive**, and don't change it once set |
| `BOOTSTRAP_SECRET` | first run | Any long random text. The setup code for the first owner. Remove after setup |
| `CRON_SECRET` | for the daily job | 16+ random characters. Vercel sends it to `/api/cron` automatically. Mark **Sensitive** |
| `BLOB_READ_WRITE_TOKEN` | for files | Set by Vercel when you connect a Blob store |
| `VIMEO_ACCESS_TOKEN` | optional | Or connect Vimeo in Studio instead. Scopes above. Mark **Sensitive** |
| `VIMEO_USER_ID` | rarely | Only if the token belongs to a different Vimeo user than the folders' owner |
| `RESEND_API_KEY` + `PORTAL_EMAIL_FROM` | optional | Or connect email in Studio instead. The sender must be on a domain verified in Resend |
| `PORTAL_MODE` | no | `demo` = public sample at `/`. Remove it to go live |

Environment variables only apply to new deployments: **redeploy after every change**.

## Going live

Today the portal runs with `PORTAL_MODE=demo` and nothing else. In order:

1. **Database.** Vercel → `nobleman-portal` → Storage → **Create Database** → Neon → region `iad1` (Washington, D.C., next to the functions) → connect it to Production and Preview. *Result:* `DATABASE_URL` appears under Settings → Environment Variables. No SQL to run: the first request creates the tables.
2. **File storage.** Storage → **Create** → Blob → access **Private** → connect to the project. *Result:* `BLOB_READ_WRITE_TOKEN` appears.
3. **Secrets.** Add `SESSION_SECRET`, `PORTAL_ENCRYPTION_KEY`, `CRON_SECRET`, and `BOOTSTRAP_SECRET` (Sensitive, Production and Preview). Generate each with `openssl rand -base64 48` on your own computer; never paste them into chat or email.
4. **Go live.** Delete `PORTAL_MODE`, then Deployments → latest → **Redeploy**.
5. **First owner.** Open the portal. It shows **Set up the portal**: enter the `BOOTSTRAP_SECRET` value as the setup code, your name, email, and a password. You're logged in as the owner. It only works while no staff account exists. Then delete `BOOTSTRAP_SECRET` and redeploy.
6. **Two-step for yourself.** Account → **Set up two-step verification**. Save the recovery codes in your password manager.
7. **Connections.** Studio → Connections: connect email (Resend), Vimeo (Jean's token, or have Jean do it), and Frame.io, YouTube, or Wistia if used. **Test it** on each. Connect Notion if you want tracking there.
8. **People.** Studio → People → **Invite a person**: Jean and Justin as Owner or Producer. Make a second **Owner**, so the studio is never locked out. Once everyone on staff has two-step sign-in, Settings → Security → require it.
9. **Projects and clients.** Studio → Projects → **New project** for each client (create the client in the same step), choose the video source, check the switches. Then invite the client's decision maker; they can add their own colleagues.
10. **Settings → System check** shows everything green, or only suggestions you've chosen to accept.

**Check it worked.** On a phone and a laptop: open an invitation link as a test client, choose a password, play a version, leave a note, approve it with a small fix in a test project, create and open a share link, send a message, upload a small file, download it. Studio → Activity shows each step.

**Roll back.** Set `PORTAL_MODE=demo` again and redeploy: the public sample returns and nothing in the database is touched. Or Vercel → Deployments → an earlier one → **Promote to Production**. Schema changes only ever add, so an earlier deployment runs against the newer database.

## Security model

- **Sessions:** a signed JWT (HS256, `SESSION_SECRET`) in the `np_session` cookie (httpOnly, Secure, SameSite=Lax; 7 days by default, 1 to 30 in Settings). Every request re-reads the person and checks the session version, so removal, a reset, a role or email change, or "Sign out everywhere" takes effect at once.
- **Passwords:** bcrypt (cost 10), at least 10 characters. Unknown emails are checked against a real dummy hash so timing doesn't reveal accounts. Nobody else ever sets or sees a person's password: invitations and resets are one-time links, stored only as SHA-256 hashes, and a newer link replaces older ones.
- **Two-step verification:** TOTP (RFC 6238, 30-second codes, one step either side), a code can't be used twice, and ten single-use recovery codes stored hashed. The step between password and code is a 5-minute signed ticket. Owners can require it for staff.
- **Throttling** per email and per IP: passwords 8 / 30 per 15 minutes, codes 6 / 30 per 15 minutes, emailed links 5 / 20 per hour.
- **Roles and scoping:** every Studio action checks the role's permission on the server (`api/_roles.js`). Clients only ever reach their own company's non-archived projects (`projectFor`), and every capability is checked server-side as the project's switch and the role's permission together.
- **Stored keys:** connection credentials are encrypted with AES-256-GCM (`api/_crypto.js`); the page never receives them, and secret fields are never pre-filled.
- **Share links:** 24-byte random tokens, looked up by hash, revocable, optional expiry. The page shows one finished film and the studio's name, nothing about the client or project.
- **Cross-origin:** POSTs a browser sends from another origin are refused (403). SameSite alone isn't enough because every `*.gotit2work.com` host counts as the same site.
- **Headers:** `X-Frame-Options: DENY`, `noindex`, `nosniff`, a strict referrer policy, camera/microphone/location off, and `no-store` on the API.
- **Sign-up:** nothing is created until the address is confirmed by a one-hour link (stored hashed); the answer is the same whether or not an account exists; requests share the emailed-link throttle; joining by domain only works for domains staff listed, never free email services.
- **Audit:** logins, sign-ups, Studio changes, decisions, downloads, views (once a day per person and video), share links, and team changes go to the activity log with the time and IP.

## Changing what the portal can do

Everything above is run from Studio. Code changes (and an AI assistant, if you use one) are only for adding or removing capabilities:

- **A project switch:** add it to `CAPABILITIES` in `api/_caps.js` (key, label, detail, default, `needs`), check `p.caps.<key>` on the server where it applies, show or hide it in the page, and add a test. Studio and Settings pick it up automatically.
- **A role permission:** add it to `STAFF_PERMS` or `CLIENT_PERMS` and `ROLE_DEFAULTS` in `api/_roles.js`, then check it with `can(u, "<key>", s)` or `effectiveCaps`. The roles table picks it up automatically.
- **A video source:** write `api/_providers/<name>.js` with `meta` (fields, source label, features), `test`, `sources`, `checkRef`, `videos`, `forget`, `details`, and `play` if its links expire; list it in `api/_providers/index.js`; add a fake in `tests/lib/fakes.mjs` and tests. Connections, the source picker, and the system check pick it up automatically.
- **A setting:** add a default to `DEFAULTS` in `api/_settings.js` and a validator to `CLEAN` in `api/_admin_more.js`, then a field in `app/studio-settings.js`.

## Moving to Supabase later

The data layer is plain Postgres. To move: create the Supabase project; copy the data (`pg_dump --data-only` from Neon, `psql` into Supabase, or Supabase's import tool); set `DATABASE_URL` to Supabase's **pooled** connection string (port 6543); redeploy. `api/_db.js` uses Neon's HTTP driver for Neon addresses and `postgres.js` for everything else, with prepared statements off for the pooler. The schema applies itself on the first request. To read it as SQL: `node -e "import('./api/_schema.js').then(m => console.log(m.STATEMENTS.join(';\n\n') + ';'))"`.

## API

| Route | Who | |
|---|---|---|
| `GET /api/session` | anyone | Who's logged in; the login screen's settings (including whether sign-up is on); whether setup or two-step setup is needed |
| `POST /api/session` | anyone / logged in | `login`, `twoStep`, `requestLink`, `signup`, `redeem` (also confirms sign-ups), `logout`, `setup`, `password`, `profile`, `twoStepBegin`, `twoStepEnable`, `twoStepDisable`, `recoveryCodes` |
| `GET /api/portal` | logged in | Everything this person can see; `?demo=1` or `?demo=studio` (anyone), `?thread=`, `?notes=&video=`, `?shares=`, `?team=1` |
| `POST /api/portal` | logged in | `note`, `resolve`, `deleteNote`, `decide`, `message`, `deleteMessage`, `seen`, `downloaded`, `confirmNext`, `shareCreate`, `shareRevoke`, `teamAdd`, `teamUpdate`, `teamRemove` |
| `GET /api/media` | logged in | Downloads, captions, chapters for one video; `&play=1` for a fresh playback address |
| `POST /api/media` | logged in | `uploadStart`, `uploadDone`, `uploadCancel` (Vimeo) |
| `GET/POST /api/files` | logged in | Signed download link; `start`, `done`, `cancel`, `delete` (Blob) |
| `GET /api/share` | anyone with a link | One shared film; `&play=1` for a fresh playback address |
| `GET /api/connect` | owners | Frame.io's Adobe sign-in (start and return) |
| `GET /api/cron` | Vercel | The daily job (needs `CRON_SECRET`) |
| `GET/POST /api/admin` | staff, by role | Overview, `?demo=1` (sample data, anyone), `?sources=`, `?videos=`, `?audit=`, `?export=`, `?notion=`, `?health=1`; client, person, account request (`signupApprove`, `signupDecline`), project, video, connection, Notion, settings, and roles actions (`api/admin.js`, `api/_admin_more.js`) |

## Testing

`tests/` runs the whole portal offline: three local servers with an in-memory Postgres (PGlite) and fakes for Vimeo, Blob, Resend, Frame.io and Adobe sign-in, YouTube, Wistia, Notion, and oEmbed. Not deployed.

```bash
npm ci && (cd tests && npm ci)
cd tests && npm test        # 265 API checks, then 124 browser checks (desktop and phone)
npm run shots               # screenshots of every screen in tests/.work/shots
```

Chromium: set `CHROMIUM_PATH`, or run `npx playwright install chromium` once (Claude Code's cloud containers already have it). Seeded accounts, all with the password `portal-test-pass`: staff `alexis@gotit2work.com` (owner), `pat@studio.test` (producer), `eddie@studio.test` (editor); Harbor Labs `dana@harbor.test` (decision maker), `rae@harbor.test` (reviewer), `vic@harbor.test` (viewer); Desert Moto `rob@moto.test` (decision maker).

## Writing

Every word a client sees follows [docs/WRITING.md](docs/WRITING.md): plain words, buttons named for what they do, no promise that isn't always true, a demo that says it's a demo, and a confirmation before anything hard to undo.
