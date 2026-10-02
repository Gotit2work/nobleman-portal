// The portal's tables. The API applies these itself (see ready() in _db.js), so a new database needs no manual
// step. Every statement is idempotent. When you change the schema, add statements at the end (never edit old
// ones in place) and bump SCHEMA_VERSION so running servers apply them on their next cold start.
//
// To read it as one SQL file: node -e "import('./api/_schema.js').then(m => console.log(m.STATEMENTS.join(';\n\n') + ';'))"

export const SCHEMA_VERSION = 3;

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
];
