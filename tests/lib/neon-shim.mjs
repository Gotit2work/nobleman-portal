// Test stand-in for Neon's HTTP driver: same API (tagged template, or (text, params)), backed by PGlite.
// run.sh copies this over node_modules/@neondatabase/serverless in a scratch copy of the portal. PGLITE_MODULE
// is the absolute path of tests/node_modules/@electric-sql/pglite (the copy can't resolve tests/ on its own).
const { PGlite } = await import(process.env.PGLITE_MODULE);
import fs from "node:fs";
async function db() {
  if (!globalThis.__pg) {
    globalThis.__pg = (async () => {
      const pg = new PGlite();
      if (process.env.SEED_SQL) {
        const { STATEMENTS } = await import(process.env.PORTAL_ROOT + "/api/_schema.js");
        for (const s of STATEMENTS) await pg.exec(s);
        await pg.exec(fs.readFileSync(process.env.SEED_SQL, "utf8"));
      }
      return pg;
    })();
  }
  return globalThis.__pg;
}
export function neon() {
  return (strings, ...values) => (async () => {
    let text, params;
    if (typeof strings === "string") { text = strings; params = values[0] || []; }
    else { text = strings.reduce((acc, s, i) => acc + "$" + i + s); params = values; }
    const pg = await db();
    if (!params.length && /;\s*\S/.test(text)) { await pg.exec(text); return []; }
    const r = await pg.query(text, params);
    return r.rows;
  })();
}
