# Nobleman Productions — Client Portal

Static front end plus serverless API routes, Neon Postgres for data. Vercel runs `npm install`; there is no build step.

Pages
- `/` → index.html (portal, with login gate). The layout is responsive; there is no separate mobile page.

## Roles

Two kinds of account, enforced server-side:

- **admin** — Jean, Justin, Alexis. Not tied to any client. Can create and remove accounts and see every client.
- **client** — belongs to exactly one client organisation and sees only that organisation's work.

The database rejects an admin scoped to a client, and a client user with no client, so the shape can't drift.

## Setup, in order

**1. Create the database.** In the Vercel project: Storage → Create Database → Neon. Vercel sets `DATABASE_URL` for you. (Creating it directly at neon.tech works too — then paste the pooled connection string in as `DATABASE_URL` yourself.)

**2. Create the tables.** Neon console → SQL Editor → paste all of `schema.sql` → Run.

**3. Set the environment variables.**

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Set automatically if you created Neon through Vercel |
| `SESSION_SECRET` | yes | 32+ random characters. `openssl rand -base64 32` |
| `BOOTSTRAP_SECRET` | first run only | Any long random string. Guards the one-time admin setup |

**4. Push and deploy.**

```bash
cd portal
git init
git add .
git commit -m "Nobleman client portal"
git branch -M main
git remote add origin git@github.com:Gotit2work/nobleman-portal.git
git push -u origin main
```

Import into Vercel with Framework Preset **Other**, no build command, no output directory. Then Settings → Domains → `portal.noblemanproductions.gotit2work.com`.

**5. Create the first admin.** Once, from your terminal:

```bash
curl -X POST https://portal.noblemanproductions.gotit2work.com/api/bootstrap \
  -H 'content-type: application/json' \
  -d '{"secret":"<BOOTSTRAP_SECRET>","name":"Alexis","email":"alexis@gotit2work.com","password":"<at least 10 chars>"}'
```

It refuses to run a second time once an admin exists, so it is safe to leave deployed. Remove `BOOTSTRAP_SECRET` afterwards if you prefer.

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
```

## API

| Route | Method | Who |
|---|---|---|
| `/api/login` | POST | anyone |
| `/api/logout` | POST | anyone |
| `/api/me` | GET | signed in |
| `/api/bootstrap` | POST | secret, once |
| `/api/admin/users` | GET, POST, DELETE | admin |
| `/api/admin/clients` | GET, POST | admin |

Sessions are a signed JWT in an httpOnly, Secure, SameSite=Lax cookie, good for 7 days. Passwords are bcrypt hashed. Sign-in compares against a dummy hash for unknown emails so response timing doesn't reveal whether an account exists.

## What is real and what is not

Login, roles, and account management are real and backed by the database.

**Everything the portal displays is still hardcoded** — projects, stages, versions, review comments, approvals, messages, files, documents. It looks live and it is not: nothing saves, uploads go nowhere, and a refresh resets it. Treat the portal as a real login in front of a prototype until increments 2 and 3 land.

When no backend is reachable the page falls back to a demo identity so the design file still opens locally. On the deployed site the API answers, so that path never runs.
