-- Nobleman client portal — schema
-- Run once against your Neon database (Neon console -> SQL Editor).

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
