# Going live: from the demo to the real portal

**Purpose.** Turn the portal at `portal.noblemanproductions.gotit2work.com` from the public sample into the real, empty portal, then connect everything it can use (videos, email, Notion, payments) so the studio can start loading clients and projects. No code changes and no AI are needed: every step is a setting in Vercel, Stripe, or the portal's own Studio.

**Scope.** The portal only. The marketing website already runs and isn't touched. DNS isn't touched either, except the optional email records in step 9, which add new names and never change the existing ones.

**Who does what.**

| Who | Does |
|---|---|
| Alexis (GotIT2Work) | Vercel steps 1–7, the first owner, Resend, Notion, the checks |
| Jean | The Vimeo token (step 10), because the films are in Jean's Vimeo account |
| Jean or Justin | The Stripe account and its bank details (step 12), because the money goes to Nobleman |

**Time.** About 90 minutes for steps 1–11. Stripe takes longer the first time, because Stripe reviews a new account's business details before paying out.

**What you'll end with.** The login page at the portal's address instead of the sample; the sample still at `/demo` for the website's "See a sample project" link; an empty database; and Studio → Settings → System check showing everything working.

---

## Before you start

- [ ] **Vercel Pro.** Vercel's Hobby plan is for non-commercial use, and a portal that bills clients is commercial. Vercel → Team **Gotit2Work** → Settings → Billing → **Upgrade to Pro**. Check Vercel's current pricing on that page.
- [ ] You can log in to Vercel as `amangual1` and see the project **nobleman-portal** in team Gotit2Work.
- [ ] A password manager is open: you'll create five secrets and save them there.
- [ ] A terminal on your own computer, for generating secrets: Terminal on a Mac, or PowerShell 7 on Windows.
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
| `BOOTSTRAP_SECRET` | The one-time setup code for the first owner (step 6). | **Delete** (step 7) |

Add all four as described above, marked **Sensitive**, for Production and Preview.

### 4. Turn off the public sample at the front door

In Environment Variables, find `PORTAL_MODE` (value `demo`) → **⋯** → **Delete**.

*What it changes:* visitors to the portal's address get the login instead of the sample. The sample stays at `/demo`, unchanged.

### 5. Redeploy

Redeploy as described above and wait for **Ready**.

*Expected:* `/api/session` shows `"demoAtRoot":false`, `"db":true`, `"setup":true` and `"setupReady":true`. The portal's address shows **Set up the portal**.

### 6. Create the first owner

1. Open `https://portal.noblemanproductions.gotit2work.com`.
2. **Setup code:** the `BOOTSTRAP_SECRET` value from your password manager. Then your name, email, and a password of at least 10 characters (a short phrase works well).
3. **Create the owner account.** You're logged in as the owner, and Home shows **Getting started**: the checklist for the rest of this runbook.

Setup only works while no staff account exists, so nobody can run it again later.

### 7. Remove the setup code

Environment Variables → `BOOTSTRAP_SECRET` → **Delete** → redeploy.

*Expected:* Studio → Settings → System check → **Setup code** shows "Removed after setup".

### 8. Turn on two-step verification for yourself

Portal → your initials (Account) → **Set up two-step verification** → scan the QR code with your authenticator app → type the code → save the recovery codes in your password manager.

> 📸 Screenshot Studio → Settings → System check now. It's the "before connections" picture.

---

## Part B: connections (Studio → Connections)

Every connection is added in the portal, tested with **Test it**, and stored encrypted. Keys are never shown again; to replace one, press **Change** and paste the new key.

### 9. Email (Resend)

Email sends invitations, login links, password resets, reminders, receipts, and updates. Without it, invitation links are shown in Studio to copy and send by hand.

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

Frame.io, YouTube, and Wistia work the same way when needed (README, "Video sources"). **Video links** need no account at all.

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

- **Staff:** Studio → People → **Invite a person**. Jean and Justin as **Owner** or **Producer**. Make sure there are at least two owners, so the studio is never locked out. Once every staff member has two-step verification, turn on Settings → Logins and accounts → **Two-step verification for staff**.
- **Clients:** Studio → Clients → **Add a client** (the company). Add its email domain (such as `harborlabs.com`) if its people should be able to join by themselves.
- **Projects:** Studio → Projects → **New project** → the client, the Vimeo folder, then check **What they can do**: Payments on, and **Downloads after payment** if final files should wait for the balance.
- **The client's people:** Studio → People → **Invite a person** → role **Decision maker** for whoever approves and pays. They can add their own colleagues.

### 14. The login page and settings

Studio → Settings: check **Studio details** (help email, the line above Messages), **Login screen** (the photo and the Murphy's Law), **Welcome message**, and **Review reminders**.

---

## Check it worked

On a phone and a laptop, as a test client:

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
| The address still shows the sample | `PORTAL_MODE` is still set, or there was no redeploy | Delete `PORTAL_MODE`, then redeploy |
| "The portal is still being set up" | No database | Step 1, then redeploy |
| "Setup is switched off" | `BOOTSTRAP_SECRET` is missing | Add it (step 3), redeploy, reload |
| "That setup code isn't right" | Typo or extra spaces | Copy it from the password manager again |
| A connection says "Not working" | Wrong or expired key | **Change** → paste a fresh key → **Test it** |
| The test email never arrives | The domain isn't verified yet, or it went to spam | Resend → Domains shows Verified? Check spam |
| A payment stays "Due" after paying | The webhook isn't set up, or its secret is from the other mode | Step 12c, using the secret from the same mode (test or live) as the key. The client's return from Stripe and the daily job also mark it paid. |
| Stripe says "Invalid API Key" | A test key with live mode, a publishable key (`pk_…`), or a typo | Use the **secret** key (`sk_…`) from the mode you're in |
| Everyone was logged out | `SESSION_SECRET` changed | Expected. Don't change it again. |
| Every connection stopped working | `PORTAL_ENCRYPTION_KEY` changed | Put the old value back from the password manager, or re-enter each key |

## Rolling back

- **Back to the sample at the front door:** add `PORTAL_MODE` = `demo` and redeploy. Visitors see the sample again. The database, people, and projects aren't touched, and deleting `PORTAL_MODE` again brings them back.
- **A bad deployment:** Vercel → Deployments → the previous good one → **⋯** → **Promote to Production**. The database only ever gains tables and columns, so an earlier version runs against it safely.
- **Payments:** Studio → Connections → the Stripe card → **Remove**. Clients stop seeing **Pay** at once; payment records stay. Removing it never refunds or cancels anything in Stripe.
