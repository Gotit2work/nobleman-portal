import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — every API route will fail.");
}

export const sql = neon(process.env.DATABASE_URL);
