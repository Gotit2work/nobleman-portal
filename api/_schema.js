// The portal's tables. The API applies these itself (see ready() in _db.js), so a new database needs no manual
// step. Every statement is idempotent. When you change the schema, add statements at the end (never edit old
// ones in place) and bump SCHEMA_VERSION so running servers apply them on their next cold start.
//
// To read it as one SQL file: node -e "import('./api/_schema.js').then(m => console.log(m.STATEMENTS.join(';\n\n') + ';'))"

export const SCHEMA_VERSION = 6;

export const STATEMENTS = [
  `create table if not exists settings (
    key   text primary key,
    value text not null
  )`,

  // A client organisation. Admins belong to no client; client users belong to one.
  `create table if not exists clients (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    created_at  timestamptz not null default now()
  )`,

  `create table if not exists users (
    id             uuid primary key default gen_random_uuid(),
    email          text not null unique,
    name           text not null,
    title          text,
    role           text not null check (role in ('admin','client')),
    client_id      uuid references clients(id) on delete cascade,
    password_hash  text not null,
    created_at     timestamptz not null default now(),
    last_login_at  timestamptz,
    constraint role_client_shape check (
      (role = 'admin'  and client_id is null) or
      (role = 'client' and client_id is not null)
    )
  )`,
  `create index if not exists users_client_idx on users(client_id)`,
  // Set when an admin creates the account or resets its password: the person must choose their own on sign-in.
  `alter table users add column if not exists must_change_password boolean not null default false`,
  // Bumped on every password change or reset; sessions carry it, so older sessions stop working at once.
  `alter table users add column if not exists session_version int not null default 1`,
  `alter table users add column if not exists notify_email boolean not null default true`,

  // Failed sign-ins, used to throttle password guessing. Rows older than a day are pruned on the way.
  `create table if not exists login_attempts (
    id     bigserial primary key,
    email  text not null,
    ip     text not null,
    at     timestamptz not null default now()
  )`,
  `create index if not exists login_attempts_email_idx on login_attempts(email, at)`,
  `create index if not exists login_attempts_ip_idx on login_attempts(ip, at)`,

  `create table if not exists projects (
    id            uuid primary key default gen_random_uuid(),
    client_id     uuid not null references clients(id) on delete cascade,
    title         text not null,
    type          text,
    stage_idx     int  not null default 0,
    pct           int  not null default 0,
    next_label    text,
    next_date     text,
    next_what     text,
    image_url     text,
    archived      boolean not null default false,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
  )`,
  `create index if not exists projects_client_idx on projects(client_id) where archived = false`,
  // The Vimeo folder holding this project's versions and finished films (the number at the end of its URL).
  `alter table projects add column if not exists vimeo_folder_id text`,
  `alter table projects add column if not exists summary text`,
  // What the client may do on this project: { review: true, download: false, ... } (see _caps.js). Missing
  // keys fall back to the defaults there.
  `alter table projects add column if not exists capabilities jsonb not null default '{}'::jsonb`,

  // Review notes, pinned to a moment in one version of a film. author_name is kept so notes survive the
  // author's account being removed.
  `create table if not exists comments (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references projects(id) on delete cascade,
    video_id    text not null,
    version     int,
    at_seconds  numeric(10,2),
    body        text not null,
    parent_id   uuid references comments(id) on delete cascade,
    author_id   uuid references users(id) on delete set null,
    author_name text not null,
    author_role text not null,
    resolved    boolean not null default false,
    created_at  timestamptz not null default now()
  )`,
  `create index if not exists comments_video_idx on comments(project_id, video_id, created_at)`,

  // A client's decision on one version: approved, or changes requested (with a note).
  `create table if not exists approvals (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references projects(id) on delete cascade,
    video_id    text not null,
    version     int,
    decision    text not null check (decision in ('approved','changes')),
    note        text,
    user_id     uuid references users(id) on delete set null,
    user_name   text not null,
    created_at  timestamptz not null default now()
  )`,
  `create index if not exists approvals_project_idx on approvals(project_id, created_at)`,

  `create table if not exists messages (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references projects(id) on delete cascade,
    author_id   uuid references users(id) on delete set null,
    author_name text not null,
    author_role text not null,
    body        text not null,
    created_at  timestamptz not null default now()
  )`,
  `create index if not exists messages_project_idx on messages(project_id, created_at)`,
  `create table if not exists message_reads (
    user_id     uuid not null references users(id) on delete cascade,
    project_id  uuid not null references projects(id) on delete cascade,
    seen_at     timestamptz not null default now(),
    primary key (user_id, project_id)
  )`,

  // Documents and uploads kept in Vercel Blob (private). kind: 'document' = from Nobleman, 'upload' = from
  // the client.
  `create table if not exists files (
    id            uuid primary key default gen_random_uuid(),
    project_id    uuid not null references projects(id) on delete cascade,
    name          text not null,
    size          bigint not null default 0,
    content_type  text,
    pathname      text not null unique,
    kind          text not null check (kind in ('document','upload')),
    -- 'pending' from the moment the server hands out an upload token until the upload is confirmed.
    status        text not null default 'pending' check (status in ('pending','ready')),
    uploaded_by   uuid references users(id) on delete set null,
    uploader_name text not null,
    uploader_role text not null,
    created_at    timestamptz not null default now()
  )`,
  `create index if not exists files_project_idx on files(project_id, created_at)`,

  // Videos a client sent through the portal. They live in the project's Vimeo folder but are footage for
  // Nobleman, not finished films, so the portal lists them under Files and keeps them out of Films.
  `create table if not exists video_uploads (
    id            uuid primary key default gen_random_uuid(),
    project_id    uuid not null references projects(id) on delete cascade,
    vimeo_id      text not null unique,
    name          text not null,
    size          bigint not null default 0,
    status        text not null default 'uploading' check (status in ('uploading','done')),
    uploaded_by   uuid references users(id) on delete set null,
    uploader_name text not null,
    uploader_role text not null,
    created_at    timestamptz not null default now()
  )`,
  `create index if not exists video_uploads_project_idx on video_uploads(project_id, created_at)`,

  // ---------- v4: roles, settings, connections, activity log, email links, share links, two-step sign-in ----------

  // What someone may do within their kind of account (role stays 'admin' for staff, 'client' for clients).
  // Staff: owner | manager | editor. Clients: approver | reviewer | viewer. _roles.js says what each allows.
  `alter table users add column if not exists access text`,
  `update users set access = case when role = 'admin' then 'owner' else 'approver' end where access is null`,
  // Two-step sign-in (an authenticator app code). The secret is encrypted (_crypto.js); recovery codes are
  // stored as SHA-256 hashes; totp_last_step stops a code being used twice.
  `alter table users add column if not exists totp_secret text`,
  `alter table users add column if not exists totp_enabled boolean not null default false`,
  `alter table users add column if not exists totp_last_step bigint not null default 0`,
  `alter table users add column if not exists recovery_codes jsonb not null default '[]'::jsonb`,
  // When a client closed the welcome card, so it shows once.
  `alter table users add column if not exists welcomed_at timestamptz`,

  `alter table clients add column if not exists logo_url text`,
  `alter table clients add column if not exists notes text`,

  // Where a project's videos come from: a connection (connections.id, or 'env-vimeo' for the token in Vercel's
  // settings) and the folder, project, or playlist inside it. Replaces vimeo_folder_id.
  `alter table projects add column if not exists source_conn text`,
  `alter table projects add column if not exists source_ref text`,
  `update projects set source_conn = 'env-vimeo', source_ref = vimeo_folder_id where vimeo_folder_id is not null and source_ref is null`,
  `alter table projects add column if not exists review_due date`,
  `alter table projects add column if not exists reminded_at timestamptz`,
  `alter table projects add column if not exists notion_page_id text`,

  // Accounts the portal talks to: video sources (Vimeo, Frame.io, YouTube, Wistia), Notion, email. `secret`
  // holds the credentials, encrypted; `config` holds what isn't secret (account name, chosen database).
  `create table if not exists connections (
    id          uuid primary key default gen_random_uuid(),
    provider    text not null,
    name        text not null,
    secret      text,
    config      jsonb not null default '{}'::jsonb,
    status      text not null default 'ok',
    last_error  text,
    checked_at  timestamptz,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
  )`,

  // Staff choices about one video in a project's source: hide it from the client, rename it, or say whether
  // it's a version or a finished film when its title doesn't.
  `create table if not exists video_settings (
    project_id  uuid not null references projects(id) on delete cascade,
    video_id    text not null,
    hidden      boolean not null default false,
    title       text,
    kind        text not null default 'auto',
    primary key (project_id, video_id)
  )`,

  // Videos added by link (the "Video links" source): a YouTube, Vimeo, or direct MP4 address.
  `create table if not exists link_videos (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references projects(id) on delete cascade,
    title       text not null,
    url         text not null,
    description text,
    thumbnail   text,
    duration    int,
    created_at  timestamptz not null default now()
  )`,
  `create index if not exists link_videos_project_idx on link_videos(project_id, created_at)`,

  // Who did what, for Studio → Activity log. Kept about 13 months (pruned by api/cron.js).
  `create table if not exists audit_log (
    id          bigserial primary key,
    at          timestamptz not null default now(),
    actor_id    uuid,
    actor_name  text,
    actor_kind  text,
    action      text not null,
    summary     text not null,
    project_id  uuid,
    client_id   uuid,
    ip          text
  )`,
  `create index if not exists audit_at_idx on audit_log(at desc)`,
  `create index if not exists audit_project_idx on audit_log(project_id, at desc)`,

  // One-time links sent by email or copied by staff: invite (choose a password), reset, sign-in. Only a
  // SHA-256 hash of the token is stored.
  `create table if not exists link_tokens (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references users(id) on delete cascade,
    purpose     text not null,
    token_hash  text not null unique,
    expires_at  timestamptz not null,
    used_at     timestamptz,
    created_at  timestamptz not null default now()
  )`,
  `create index if not exists link_tokens_user_idx on link_tokens(user_id, purpose)`,

  // Branded links to one finished film (/watch/<token>), revocable, optionally expiring. The token is stored
  // hashed for lookup and encrypted so its owner can copy the link again.
  `create table if not exists share_links (
    id              uuid primary key default gen_random_uuid(),
    token_hash      text not null unique,
    token_enc       text not null,
    project_id      uuid not null references projects(id) on delete cascade,
    video_id        text not null,
    title           text not null,
    created_by      uuid references users(id) on delete set null,
    created_by_name text not null,
    expires_at      timestamptz,
    revoked_at      timestamptz,
    views           int not null default 0,
    last_viewed_at  timestamptz,
    created_at      timestamptz not null default now()
  )`,
  `create index if not exists share_links_project_idx on share_links(project_id, created_at)`,

  // Throttling now also covers emailed links and two-step codes, not only passwords.
  `alter table login_attempts add column if not exists kind text not null default 'password'`,
  // When someone last loaded the portal: emails wait while they're using it (they see it there anyway).
  `alter table users add column if not exists last_seen_at timestamptz`,
  // The next milestone can ask the client to confirm it (a filming day, a delivery date).
  `alter table projects add column if not exists next_confirm boolean not null default false`,
  `alter table projects add column if not exists next_confirmed_at timestamptz`,
  `alter table projects add column if not exists next_confirmed_by text`,

  // Sign-up: people create an account themselves. They confirm their email first (token_hash, one hour), then
  // either join their company straight away (its email domain is listed on the client) or wait for the studio
  // to approve them. status: new (email not confirmed) | waiting | approved | declined | joined.
  `alter table clients add column if not exists domains jsonb not null default '[]'::jsonb`,
  `create table if not exists signup_requests (
    id               uuid primary key default gen_random_uuid(),
    email            text not null,
    name             text not null,
    company          text,
    note             text,
    token_hash       text unique,
    token_expires_at timestamptz,
    verified_at      timestamptz,
    status           text not null default 'new',
    client_id        uuid references clients(id) on delete set null,
    user_id          uuid references users(id) on delete set null,
    decided_by       text,
    decided_at       timestamptz,
    ip               text,
    created_at       timestamptz not null default now()
  )`,
  `create index if not exists signup_requests_email_idx on signup_requests(email, status)`,

  // Payments the studio asks a client for on a project (a deposit, the balance), paid on Stripe's checkout
  // (_payments.js). amount is in the currency's smallest unit (cents). status: open | processing (a bank
  // payment on its way) | paid | canceled | refunded. method: stripe | outside (recorded by staff).
  `create table if not exists payments (
    id              uuid primary key default gen_random_uuid(),
    project_id      uuid not null references projects(id) on delete cascade,
    title           text not null,
    amount          integer not null check (amount > 0),
    currency        text not null default 'usd',
    due             date,
    note            text,
    status          text not null default 'open',
    method          text,
    stripe_session  text,
    stripe_intent   text,
    paid_at         timestamptz,
    paid_by         uuid references users(id) on delete set null,
    paid_by_name    text,
    created_by      uuid references users(id) on delete set null,
    created_by_name text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
  )`,
  `create index if not exists payments_project_idx on payments(project_id, created_at)`,
  `create index if not exists payments_session_idx on payments(stripe_session)`,
];
