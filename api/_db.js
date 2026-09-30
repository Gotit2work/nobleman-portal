import { neon } from "@neondatabase/serverless";

// Vercel's Neon integration sets DATABASE_URL; older Vercel Postgres projects set POSTGRES_URL.
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!url) {
  console.error("DATABASE_URL is not set — every API route that touches the database will fail.");
}

// Without a connection string, neon() throws at import time, which crashes the function before the route
// can answer. Fail per query instead so each route returns its normal JSON error.
export const sql = url
  ? neon(url)
  : async () => {
      throw new Error("DATABASE_URL is not set");
    };
