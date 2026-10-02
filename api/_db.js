import { neon } from "@neondatabase/serverless";
import { STATEMENTS, SCHEMA_VERSION } from "./_schema.js";

// Vercel's Neon integration sets DATABASE_URL; older Vercel Postgres projects set POSTGRES_URL.
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

export const dbConfigured = () => !!url;

if (!url) {
  console.error("DATABASE_URL is not set: every API route that touches the database will fail.");
}

/**
 * Any Postgres works. Neon (and the local test shim, pglite://) go through Neon's HTTP driver, which needs no
 * connection pool and suits serverless functions. Anything else (Supabase, RDS, a local Postgres) goes through
 * postgres.js. Moving databases is: dump, restore, change DATABASE_URL. No code change.
 */
function isNeon(u) {
  if (u.startsWith("pglite:")) return true;
  try { return /(^|\.)neon\.(tech|build)$/.test(new URL(u).hostname); } catch { return false; }
}

let pg = null;
async function postgresJs() {
  if (!pg) {
    const { default: postgres } = await import("postgres");
    // prepare:false works behind transaction poolers (Supabase's port 6543, PgBouncer); one connection per instance.
    pg = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
  }
  return pg;
}

const neonSql = url && isNeon(url) ? neon(url) : null;

/** Tagged template: sql`select * from users where id = ${id}` resolves to an array of rows. */
export function sql(strings, ...values) {
  if (!url) return Promise.reject(new Error("DATABASE_URL is not set"));
  if (neonSql) return neonSql(strings, ...values);
  return postgresJs().then((p) => p(strings, ...values)).then((rows) => Array.from(rows));
}

/** Runs one plain statement with no parameters (schema setup only). */
async function exec(text) {
  if (neonSql) return neonSql(text, []);
  return (await postgresJs()).unsafe(text);
}

/**
 * Makes sure the tables exist and are current: one cheap query per server instance. The full schema (every
 * statement idempotent) only runs on a fresh database or after SCHEMA_VERSION goes up. Every route awaits it
 * before touching data.
 */
let readyP = null;
export function ready() {
  if (!url) return Promise.reject(new Error("DATABASE_URL is not set"));
  if (!readyP) {
    readyP = (async () => {
      let current = 0;
      try {
        const r = await sql`select value from settings where key = 'schema_version'`;
        current = r[0] ? Number(r[0].value) || 0 : 0;
      } catch { current = 0; }
      if (current >= SCHEMA_VERSION) return;
      for (const s of STATEMENTS) await exec(s);
      await sql`insert into settings (key, value) values ('schema_version', ${String(SCHEMA_VERSION)})
                on conflict (key) do update set value = excluded.value`;
    })().catch((err) => { readyP = null; throw err; });
  }
  return readyP;
}
