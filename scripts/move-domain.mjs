#!/usr/bin/env node
// Moves this repository's addresses from noblemanproductions.gotit2work.com to the studio's own domain.
// The same script is in both repositories (nobleman-website and nobleman-portal); run it in each.
//
//   node scripts/move-domain.mjs                     shows every line it would change (changes nothing)
//   node scripts/move-domain.mjs --apply             changes them, then checks nothing was missed
//   node scripts/move-domain.mjs other.com --apply   for a different domain than noblemanproductions.com
//
// Every address is "noblemanproductions.gotit2work.com" or "portal.noblemanproductions.gotit2work.com", so one
// replacement covers the website and the portal. Lines containing "move-domain:keep" are left alone (they describe
// the old setup on purpose), and so is the step-by-step guide, docs/MOVE.md. Run it after the new addresses work
// (docs/MOVE.md in nobleman-website, step 5), then commit and push: Vercel deploys the change.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OLD = "noblemanproductions.gotit2work.com";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const NEW = (args.find((a) => !a.startsWith("--")) || "noblemanproductions.com").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set([".git", "node_modules", ".vercel", ".work", "vendor", "media", "fonts", "img"]);
const SKIP_FILES = new Set([SELF, "docs/MOVE.md", "package-lock.json"]);
const TEXT = /\.(html?|js|mjs|cjs|json|xml|txt|md|css|sql|sh)$/i;

if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(NEW) || NEW === OLD) {
  console.error(`"${NEW}" isn't a domain to move to. Example: node scripts/move-domain.mjs noblemanproductions.com`);
  process.exit(1);
}

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name), rel = path.relative(ROOT, full);
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : files(full);
    return TEXT.test(e.name) && !SKIP_FILES.has(rel) ? [rel] : [];
  });
}

// Every line that names the old address, except the ones marked to keep.
const found = [];
for (const rel of files(ROOT)) {
  const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
  lines.forEach((line, i) => { if (line.includes(OLD) && !line.includes("move-domain:keep")) found.push({ rel, n: i + 1, line }); });
}

const repo = path.basename(ROOT);
if (!found.length) {
  console.log(`${repo}: nothing names ${OLD} any more. Nothing to do.`);
  process.exit(0);
}
const byFile = {};
for (const f of found) (byFile[f.rel] ||= []).push(f);
console.log(`${repo}: ${found.length} line${found.length === 1 ? "" : "s"} in ${Object.keys(byFile).length} file${Object.keys(byFile).length === 1 ? "" : "s"} name ${OLD}${apply ? "" : ` (changing nothing: add --apply to move them to ${NEW})`}.\n`);
for (const [rel, list] of Object.entries(byFile)) {
  console.log(rel);
  for (const f of list.slice(0, apply ? 0 : 6)) console.log(`  ${String(f.n).padStart(4)}  ${f.line.trim().replaceAll(OLD, `[${NEW}]`).slice(0, 150)}`);
  if (!apply && list.length > 6) console.log(`        …and ${list.length - 6} more`);
}
if (!apply) process.exit(0);

for (const rel of Object.keys(byFile)) {
  const file = path.join(ROOT, rel);
  const out = fs.readFileSync(file, "utf8").split("\n").map((l) => (l.includes("move-domain:keep") ? l : l.replaceAll(OLD, NEW))).join("\n");
  fs.writeFileSync(file, out);
}

// Check: nothing outside the kept lines still names the old address.
const left = files(ROOT).flatMap((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n")
  .map((l, i) => (l.includes(OLD) && !l.includes("move-domain:keep") ? `${rel}:${i + 1}` : null)).filter(Boolean));
if (left.length) {
  console.error(`\nNot finished: still names ${OLD} at ${left.join(", ")}`);
  process.exit(1);
}
console.log(`\nDone: ${found.length} line${found.length === 1 ? "" : "s"} now say ${NEW}. Next: look over "git diff", then commit and push (Vercel deploys it).`);
