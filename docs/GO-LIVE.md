# Going live: the real portal

**Purpose.** Give the portal at `portal.noblemanproductions.gotit2work.com` its database, storage, secrets, and email, let Jean claim it as its first owner, then connect everything it can use (videos, email, Notion, payments) so the studio can start loading clients and projects. No code changes and no AI are needed: every step is a setting in Vercel, Stripe, or the portal's own Studio.

**Scope.** The portal only. The marketing website already runs and isn't touched. DNS isn't touched either, except the optional email records in step 9, which add new names and never change the existing ones.

**Who does what.**

| Who | Does |
|---|---|
| Alexis (GotIT2Work) | Vercel steps 1–5 (including the email key), Notion, the checks |
| Jean | Creating the first owner account (step 6) with his own email, then inviting the team (step 7) |
| Jean | The Vimeo token (step 10), because the films are in Jean's Vimeo account |
| Jean or Justin | The Stripe account and its bank details (step 12), because the money goes to Nobleman |

**Time.** About 90 minutes for steps 1–11. Stripe takes longer the first time, because Stripe reviews a new account's business details before paying out.

**What you'll end with.** The portal's address shows only **Log in** and **Create an account** (no demo); Jean is its owner; the sample project is inside the portal for staff (**Client's view** at the top); and Studio → Settings → System check shows everything working.

---

## Before you start

- [ ] **Vercel Pro.** Vercel's Hobby plan is for non-commercial use, and a portal that bills clients is commercial. Vercel → Team **Gotit2Work** → Settings → Billing → **Upgrade to Pro**. Check Vercel's current pricing on that page.
- [ ] You can log in to Vercel as `amangual1` and see the project **nobleman-portal** in team Gotit2Work.
- [ ] A password manager is open: you'll create three secrets and an email key and save them there.
- [ ] A terminal on your own computer, for generating secrets: Terminal on a Mac, or PowerShell 7 on Windows.
- [ ] Moving to `noblemanproductions.com` is a separate job, before or after this one; the order doesn't matter (`docs/MOVE.md` in the website repo). If it's already done, read `portal.noblemanproductions.com` wherever this guide says `portal.noblemanproductions.gotit2work.com`. <!-- move-domain:keep -->
- [ ] Optional for later steps: Jean available for the Vimeo token; access to GoDaddy DNS for `gotit2work.com` (email, step 9); the Nobleman Stripe login (step 12).

**How to add an environment variable** (steps 3–5): Vercel → nobleman-portal → **Settings → Environment Variables → Add New**. Enter the **Key** and **Value**, tick **Production** and **Preview**, turn on **Sensitive**, then **Save**. Variables only apply to new deployments, so each part ends with a redeploy.

**How to redeploy:** Vercel → nobleman-portal → **Deployments** → the newest **Production** deployment → **⋯** → **Redeploy** → **Redeploy**. Wait for the status to show **Ready** (about a minute).

**How to check a stage:** open `https://portal.noblemanproductions.gotit2work.com/api/session` in a browser. It answers in plain text (JSON). The steps below say which words to look for.

> 📸 Take a screenshot of Settings → Environment Variables before step 1, so you know exactly what was there to begin with.

---

## Part A: the empty portal (Vercel)

### 1. Create the database

1. Vercel → nobleman-portal → **Storage** → **Create Database** → **Neon** (Serverless Postgres) → **Continue**.
2. Region: **Washington, D.C. (iad1)**, the same region as the portal's functions. Plan: the free one is enough to start.
3. Name: `nobleman-portal-db` → **Create**.
4. **Connect Project** → nobleman-portal → environments **Production** and **Preview** → **Connect**.

*What it changes:* Vercel adds `DATABASE_URL` (and some related `POSTGRES_*` variables) to the project. There's no SQL to run: the portal creates its tables the first time it's used.

*Expected:* Settings → Environment Variables lists `DATABASE_URL`.

### 2. Create file storage

1. Vercel → nobleman-portal → **Storage** → **Create** → **Blob**.
2. Access: **Private**. Nothing in the store ever gets a public address; downloads use signed links that expire after ten minutes.
3. Name: `nobleman-portal-files` → **Create** → **Connect** to nobleman-portal for **Production** and **Preview**.

*Expected:* `BLOB_READ_WRITE_TOKEN` appears in Environment Variables.

### 3. Generate and add the secrets

Generate each value on your own computer, one at a time, and save each one in your password manager under its name. Never paste them into chat, email, or a document.

- Mac or Linux: `openssl rand -base64 48`
- Windows (PowerShell 7): `[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))`

| Key | What it's for | After setup |
|---|---|---|
| `SESSION_SECRET` | Signs logins. Changing it later logs everyone out. | Keep |
| `PORTAL_ENCRYPTION_KEY` | Encrypts the keys you paste into Studio (Vimeo, Resend, Notion, Stripe). **Never change it** once connections exist, or they all need re-entering. | Keep |
| `CRON_SECRET` | Lets Vercel run the daily job: reminders, Notion catch-up, payment catch-up. | Keep |

Add all three as described above, marked **Sensitive**, for Production and Preview.

### 4. Add the email key

The first account is confirmed by email, so the portal needs to send email before anyone can claim it.

1. resend.com → **Domains**: `gotit2work.com` should show **Verified** (it already sends the website's contact form). If not, see step 9.1 first.
2. Resend → **API Keys → Create API Key**: name `Nobleman portal`, permission **Sending access**, domain `gotit2work.com`. Copy it once into the password manager.
3. Add two environment variables: `RESEND_API_KEY` = that key (**Sensitive**), and `PORTAL_EMAIL_FROM` = `Nobleman Productions <portal@gotit2work.com>` (not secret).

*If `PORTAL_MODE` is still listed* (value `demo`), delete it: the portal no longer uses it, and the front door never shows a demo.

### 5. Redeploy

Redeploy as described above and wait for **Ready**.

*Expected:* `/api/session` shows `"db":true`, `"email":true`, and `"firstRun":true`. The portal's address shows **Log in** and **Create an account**, with Create an account chosen, and nothing else.

### 6. Jean creates the first owner account

Tell Jean (by voice): open the portal, choose **Create an account**, and use **jeancgotay@gmail.com** (or **jean@noblemanproductions.com**; they're the same login).

1. Open `https://portal.noblemanproductions.gotit2work.com` → **Create an account**.
2. **Your name**, **Email** (one of the two above) → **Create my account**.
3. Open the email **Confirm your email** → press its button (it works for an hour).
4. **Choose your password** (at least 10 characters; a short phrase works well) → **Save and open the portal**.

*Expected:* Jean is in, as the owner, with **Studio** in the menu; the studio tutorial starts. Either address logs in from now on.

*Why it's safe:* until the portal has an owner, only those two addresses can create an account (anyone else sees "The portal isn't open for new accounts yet."), and the account only exists once the link in that inbox is pressed. The addresses live in `OWNER_EMAILS` (`api/_settings.js`).

### 7. Jean invites the team

Studio → People → **Invite a person**: Justin as **Owner** (two owners, so the studio is never locked out), and Alexis as **Owner** or **Producer**. They get an email to choose a password. **Client's view** at the top shows the sample project as a client sees it.

### 8. Turn on two-step verification

Portal → your initials (Account) → **Set up two-step verification** → scan the QR code with your authenticator app → type the code → save the recovery codes in your password manager.

> 📸 Screenshot Studio → Settings → System check now. It's the "before connections" picture.

---

## Part B: connections (Studio → Connections)

Every connection is added in the portal, tested with **Test it**, and stored encrypted. Keys are never shown again; to replace one, press **Change** and paste the new key.

### 9. Email (Resend)

Email sends invitations, login links, password resets, reminders, receipts, and updates. Without it, invitation links are shown in Studio to copy and send by hand.

If the email key from step 4 is set, email already works (Studio → Connections shows it "from Vercel settings"). Do this step only to manage it from Studio instead.

1. **The sending domain.** The website's contact form already sends through Resend from `gotit2work.com` (the website's `docs/DEPLOYMENT.md`, Phase 5). If resend.com → **Domains** shows `gotit2work.com` as **Verified**, skip to 2. If not, do Phase 5 first. It adds three records at GoDaddy (`send` MX and TXT, and `resend._domainkey` TXT) and **doesn't change** the root SPF, the Microsoft 365 MX, or the apex record.
2. Resend → **API Keys → Create API Key**: name `Nobleman portal`, permission **Sending access**, domain `gotit2work.com`. Copy it once. A separate key from the website's means either one can be replaced without touching the other.
3. Portal → Studio → Connections → **Connect email**: paste the key. **Send from:** `Nobleman Productions <portal@gotit2work.com>`. **Replies go to:** the address Jean and Justin read. **Save**.
4. Press **Send a test email**. *Expected:* it arrives in your inbox (check spam the first time).

### 10. Vimeo (Jean)

1. Jean, logged in to Vimeo: developer.vimeo.com → **Create an app** (any name, such as "Nobleman Portal"; private).
2. In the app → **Generate an access token** → **Authenticated (you)** → scopes **Public, Private, Edit, Upload, Video Files, Stats** → **Generate**. Copy it once.
3. Portal → Studio → Connections → **Add a connection → Vimeo** → paste the token → **Save** → **Test it**. *Expected:* each scope ticked, plus the plan and upload space.
4. In Vimeo, each project gets its own **folder**. Versions are named with a number ("Harbor Spot V2"), and every video that should play must allow embedding (privacy **Unlisted** or **Hide from Vimeo**; embed **Anywhere**, or specific domains including the portal's address).

*About downloads:* Vimeo gives download links to the portal only on its Standard plan and above. On Plus, clients get a **Download on Vimeo** button instead. Upgrading switches to the full list with no other change.

YouTube and Wistia work the same way when needed (README, "Video sources"). **Video links** need no account at all.

### 10b. Frame.io (Jean and Justin's main platform)

Frame.io signs in through Adobe. Once connected, versions come from Frame.io version stacks, and **notes go both ways**: what clients write in the portal appears in Frame.io, and what the studio writes in Frame.io appears in the portal.

1. Logged in to the Adobe account that owns the Frame.io team: developer.adobe.com/console → **Create new project** → **Add API** → **Frame.io API** → **OAuth Web App** credential.
2. **Redirect URI:** exactly `https://portal.noblemanproductions.gotit2work.com/api/connect` (Studio shows it with a **Copy** button). **Redirect URI pattern:** `https://portal\.noblemanproductions\.gotit2work\.com/api/connect`. Save, then copy the **Client ID** and **Client secret**.
3. Portal → Studio → Connections → **Add a connection → Frame.io** → **How it connects:** *Adobe sign-in* → paste both → **Save**.
4. On the Frame.io card, press **Sign in with Adobe** and approve. *Expected:* back in Studio with "Frame.io is connected." If the login sees several Frame.io accounts, choose the studio's.
5. Press **Test it**. *Expected:* **Working**, with the account's name.
6. Turn on **Live updates** (the switch under *Notes go both ways*). *Expected:* "Live updates are on." This adds one webhook per Frame.io workspace, so new comments and versions reach the portal straight away and clients are emailed about them. Without it, notes still go both ways, but Frame.io comments arrive when someone opens the notes.
7. In Frame.io, give each client project its own folder (or Frame.io project). In the portal, **New project** → **Videos come from:** Frame.io → choose that folder.

*Check:* upload a test video to the folder, open the project in the portal, leave a note at 0:05. *Expected:* within seconds, Frame.io shows a comment at 00:00:05 starting "<your name> via the portal:". Reply to it in Frame.io: the reply shows under the note in the portal.

> 📸 Screenshot the Frame.io card showing **Working** and **Live updates are on**.

*After the domain move:* switch **Live updates** off and on once, so Frame.io calls the new address. (The old address keeps answering either way.)

### 11. Notion (optional)

1. app.notion.com/developers/connections → **Create a new connection** (internal) → Configuration: turn on **Read, Update, and Insert content** → copy the token (`ntn_…`).
2. Portal → Studio → Connections → **Connect Notion** → paste it.
3. In Notion, open the page that should hold the projects → **•••** → **Connections** → add the one you made.
4. Back in Studio → **Create a new database in a page** (choose the page), or **Use a database I already have**.

*Expected:* the card shows "Projects sync to …". Each new project appears there within seconds.

### 12. Payments (Stripe)

Clients pay deposits and balances by card or bank on Stripe's own checkout page. The portal never sees card details. Start in **test mode**; switch to live once a test payment has gone all the way through.

**12a. The account (Jean or Justin).** dashboard.stripe.com → sign up as Nobleman Productions → **Activate payments**: business details, the bank account for payouts, and the statement name clients see on their card ("NOBLEMAN PROD"). Then:

- Settings → **Branding**: logo, plus brand color `#031e25` and accent `#e5322d`, so checkout looks like Nobleman.
- Settings → **Customer emails**: turn on **Successful payments**, so Stripe emails a receipt.
- Settings → **Payment methods**: cards are on (Apple Pay and Google Pay come with them). Turn on **ACH Direct Debit** if clients pay large balances by bank; it clears in about four business days, and the portal shows it as "on its way" until then.
- Check Stripe's pricing page for current fees.

**12b. Connect in test mode.**

1. Stripe → turn on **Test mode** (newer accounts call it a **sandbox**) → Developers → **API keys** → **Secret key** → reveal → copy (`sk_test_…`).
2. Portal → Studio → Connections → **Payments → Connect Stripe** → paste it → **Currency:** `usd` → **Save** → **Test it**. *Expected:* "Test mode", and the account's name.

**12c. The webhook.** It tells the portal the moment a payment succeeds, even if the client closes the page.

1. On the Stripe card in Studio, press **Copy** next to the webhook address: `https://portal.noblemanproductions.gotit2work.com/api/connect?webhook=stripe`.
2. Stripe (still in Test mode) → Developers → **Webhooks** → **Add endpoint** → paste the address → **Select events**: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded` → **Add endpoint**.
3. On the endpoint → **Signing secret → Reveal** → copy (`whsec_…`).
4. Studio → the Stripe card → **Change** → paste it into **Webhook signing secret** → **Save**. *Expected:* the card shows **Webhook: Connected**.

**12d. A full test.**

1. Make a test client and project (step 13), with **Payments** on under What they can do.
2. Studio → the project → **Payments → Ask for a payment**: "Test", `1`.
3. Log in as the test client (a private window) → Home shows **Please pay** → **Pay** → card `4242 4242 4242 4242`, any future date, any CVC, any ZIP → **Pay**.
4. *Expected:* back in the portal, "Thank you. $1.00 is paid."; Studio → the project → Payments shows **Paid**; Stripe → Payments shows it; the studio receives an email.

**12e. Go live.** In Stripe, turn **Test mode off** and repeat 12b (the live key, `sk_live_…`, pasted with **Change**) and 12c (live mode has its own webhook endpoint and its own signing secret; on the Stripe card the address is under **Show the setup** once a webhook is connected). Then pay a real $1 and refund it in Stripe → Payments → **Refund**. *Expected:* the portal shows it as **Refunded**.

---

## Part C: people and projects

### 13. Clients, projects, and people

- **Staff:** Studio → People → **Invite a person** (step 7 did Justin and Alexis). Make sure there are at least two owners, so the studio is never locked out. Once every staff member has two-step verification, turn on Settings → Logins and accounts → **Two-step verification for staff**.
- **Clients:** Studio → Clients → **Add a client** (the company). Add its email domain (such as `harborlabs.com`) if its people should be able to join by themselves.
- **Projects:** Studio → Projects → **New project** → the client, the video folder (Frame.io or Vimeo). The next screen shows the project's **link for the client**: **Copy link** or **Email it**. Then check **What they can do**: Payments on, and **Downloads after payment** if final files should wait for the balance.
- **The client's people:** send them the project's link. Whoever opens it creates their own login (name, email, password) and lands on that project, already let in; they can pass the link to their team, and you're emailed as each one joins. Studio → the project → **Client link** shows who joined and what they can do (Decision maker unless you change it). To give someone **every** project of their company instead, use Studio → People → **Invite a person**, or Edit → **Sees: Every … project**.

### 14. The login page and settings

Studio → Settings: check **Studio details** (help email, the line above Messages; leave **Website** and **Privacy page** empty so they follow the portal's address), **Login screen** (the photo), and **Review reminders**. The first time each person opens Home, a short tutorial shows them around (Tutorial at the top replays it).

---

## Check it worked

On a phone and a laptop, as a test client:

- [ ] The project's link (Studio → the project → **Copy link**), opened in a private window, creates a login and lands on that project only.
- [ ] The invitation email arrives and its link lets you choose a password.
- [ ] Home shows the next step; a version plays; a note pinned to a moment is saved.
- [ ] **Approve** with a small fix, and the studio receives the receipt.
- [ ] A message and a small file go both ways.
- [ ] A test payment goes through (12d), and **Downloads after payment** holds downloads until it's paid.
- [ ] Studio → **Activity** lists each of these.
- [ ] Studio → Settings → **System check** is all working (yellow means a suggestion you've decided to accept).

> 📸 Screenshot the System check and a paid test payment for your records.

**Done when:** the portal's address shows the login; the System check is all working; a test client could review, approve, message, upload, and pay; and the test client and project are deleted (Studio → Projects → the project → Details → **Delete project…**; Studio → Clients → **Delete…**).

---

## If something goes wrong

| What you see | Why | What to do |
|---|---|---|
| Log in says "The portal isn't open yet." | No database | Step 1, then redeploy |
| "The portal isn't open for new accounts yet" | Another address was used before the portal has an owner | Use jeancgotay@gmail.com or jean@noblemanproductions.com |
| "The portal can't send email yet…" | No email key | Step 4, then redeploy |
| Jean's confirmation email never arrives | Spam, or the domain isn't verified in Resend | Check spam; Resend → Domains shows Verified? The link works for an hour: **Create my account** again sends a new one |
| A connection says "Not working" | Wrong or expired key | **Change** → paste a fresh key → **Test it** |
| The test email never arrives | The domain isn't verified yet, or it went to spam | Resend → Domains shows Verified? Check spam |
| A payment stays "Due" after paying | The webhook isn't set up, or its secret is from the other mode | Step 12c, using the secret from the same mode (test or live) as the key. The client's return from Stripe and the daily job also mark it paid. |
| Stripe says "Invalid API Key" | A test key with live mode, a publishable key (`pk_…`), or a typo | Use the **secret** key (`sk_…`) from the mode you're in |
| Everyone was logged out | `SESSION_SECRET` changed | Expected. Don't change it again. |
| Every connection stopped working | `PORTAL_ENCRYPTION_KEY` changed | Put the old value back from the password manager, or re-enter each key |
| "This screen stopped working." | A fault in that screen's code (not the connection); the rest of the portal keeps working | Reload. If it comes back, note the address and what was clicked, and promote the previous deployment (below) until it's fixed |

## Rolling back

- **A bad deployment:** Vercel → Deployments → the previous good one → **⋯** → **Promote to Production**. The database only ever gains tables and columns, so an earlier version runs against it safely.
- **Payments:** Studio → Connections → the Stripe card → **Remove**. Clients stop seeing **Pay** at once; payment records stay. Removing it never refunds or cancels anything in Stripe.
