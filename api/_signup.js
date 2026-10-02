// Sign-up rules shared by the session and admin routes: which email domains a client can claim, and which
// client (if any) an email address belongs to.
import { sql } from "./_db.js";

// Addresses anyone can get. A client can't claim these, or anyone with a free account could join them.
export const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net",
  "mail.com", "zoho.com", "yandex.com", "hey.com", "fastmail.com", "comcast.net", "att.net", "verizon.net",
  "sbcglobal.net", "cox.net", "qq.com", "163.com", "duck.com", "tutanota.com",
]);

export const domainOf = (email) => String(email || "").split("@").pop().trim().toLowerCase();

/**
 * Cleans the domains typed for a client ("harborlabs.com, @harbor.co") into a list, or throws a plain-words
 * error: not a domain, a free email provider, or already listed on another client.
 */
export async function cleanDomains(input, clientId) {
  const raw = Array.isArray(input) ? input : String(input || "").split(/[\s,;]+/);
  const out = [];
  for (const r of raw) {
    const d = String(r || "").trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!d) continue;
    if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) throw bad(`“${d}” isn’t an email domain. Use the part after the @, like harborlabs.com.`);
    if (FREE_MAIL.has(d)) throw bad(`${d} is a free email service, so anyone could join with it. Use the company’s own domain.`);
    if (!out.includes(d)) out.push(d);
  }
  if (out.length > 10) throw bad("Keep it to ten domains or fewer.");
  for (const d of out) {
    const taken = (await sql`select name from clients where domains @> ${JSON.stringify([d])}::jsonb and id is distinct from ${clientId || null}::uuid limit 1`)[0];
    if (taken) throw bad(`${d} already belongs to ${taken.name}.`);
  }
  return out;
}

/** The client whose email domain this address is on, or null. */
export async function clientForEmail(email) {
  const d = domainOf(email);
  if (!d || FREE_MAIL.has(d)) return null;
  return (await sql`select id, name from clients where domains @> ${JSON.stringify([d])}::jsonb limit 1`)[0] || null;
}

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
