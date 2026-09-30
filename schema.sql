-- Nobleman client portal — schema
-- Run against your Neon database (Neon console -> SQL Editor). Every statement is idempotent,
-- so re-running the whole file after an update is safe and only adds what is missing.

create extension if not exists pgcrypto;

-- A client organisation. Admins belong to no client; client users belong to one.
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  name           text not null,
  title          text,
  role           text not null check (role in ('admin','client')),
  client_id      uuid references clients(id) on delete cascade,
  password_hash  text not null,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz,
  -- admins must not be scoped to a client; client users must be
  constraint role_client_shape check (
    (role = 'admin'  and client_id is null) or
    (role = 'client' and client_id is not null)
  )
);

create index if not exists users_client_idx on users(client_id);

-- Failed sign-ins, used to throttle password guessing (see api/login.js).
-- The API prunes rows older than a day, so this stays small.
create table if not exists login_attempts (
  id     bigserial primary key,
  email  text not null,
  ip     text not null,
  at     timestamptz not null default now()
);

create index if not exists login_attempts_email_idx on login_attempts(email, at);
create index if not exists login_attempts_ip_idx on login_attempts(ip, at);
create index if not exists login_attempts_at_idx on login_attempts(at);

create table if not exists projects (
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
);

create index if not exists projects_client_idx on projects(client_id) where archived = false;
