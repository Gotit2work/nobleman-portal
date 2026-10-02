#!/bin/bash
# Starts three local copies of the portal, each with a fresh in-memory database and fake Vimeo, Blob, and email:
#   4400  seeded: staff in every role (Alexis owner, Pat producer, Eddie editor), Harbor Labs people in every
#         client role (Dana decision maker, Rae reviewer, Vic viewer), Rob (Desert Moto), two projects
#   4401  the same, with PORTAL_MODE=demo
#   4402  empty, for first-run setup
# Every account's password is "portal-test-pass". Run it again before each test run: the tests change data.
# Needs: npm ci in the repo root and in tests/. Stop the servers with: ./run.sh stop
set -e
T="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$T/.." && pwd)"
W="$T/.work"
for port in 4400 4401 4402; do pkill -f "lib/dev[.]mjs $W/app $port" 2>/dev/null || true; done
[ "$1" = "stop" ] && exit 0
[ -d "$ROOT/node_modules/@vercel/blob" ] || { echo "Run npm ci in the repo root first."; exit 1; }
[ -d "$T/node_modules/@electric-sql/pglite" ] || { echo "Run npm ci in tests/ first."; exit 1; }

# A scratch copy of the portal whose Neon driver is the PGlite stand-in.
rm -rf "$W/app" "$W/blob" && mkdir -p "$W/app" "$W/blob"
(cd "$ROOT" && tar --exclude=.git --exclude=node_modules --exclude=tests -cf - .) | tar -xf - -C "$W/app"
cp -r "$ROOT/node_modules" "$W/app/"
N="$W/app/node_modules/@neondatabase/serverless"
rm -rf "$N" && mkdir -p "$N"
cp "$T/lib/neon-shim.mjs" "$N/shim.mjs"
echo '{ "name": "@neondatabase/serverless", "version": "0.0.0-test-shim", "type": "module", "exports": "./shim.mjs" }' > "$N/package.json"
echo '{}' > "$W/blob/blobs.json"

COMMON=(SESSION_SECRET=test-session-secret-0123456789abcdef0123456789 PORTAL_ROOT="$W/app"
  PGLITE_MODULE="$T/node_modules/@electric-sql/pglite/dist/index.js" FAKE_VIMEO="$T/fixtures/vimeo.json"
  VIMEO_ACCESS_TOKEN=test-token BLOB_READ_WRITE_TOKEN=vercel_blob_rw_teststore_abcdefghijklmnopqrstuv FAKE_BLOB_DIR="$W/blob"
  BOOTSTRAP_SECRET=setup-code-123 RESEND_API_KEY=re_test "PORTAL_EMAIL_FROM=Portal <portal@test.example>" CRON_SECRET=cron-secret-test)
cd "$T"
env "${COMMON[@]}" DATABASE_URL=pglite://a SEED_SQL="$T/fixtures/seed.sql" VERCEL_BLOB_API_URL=http://localhost:4400/__blob nohup node lib/dev.mjs "$W/app" 4400 > "$W/4400.log" 2>&1 &
env "${COMMON[@]}" DATABASE_URL=pglite://b SEED_SQL="$T/fixtures/seed.sql" VERCEL_BLOB_API_URL=http://localhost:4401/__blob PORTAL_MODE=demo nohup node lib/dev.mjs "$W/app" 4401 > "$W/4401.log" 2>&1 &
env "${COMMON[@]}" DATABASE_URL=pglite://c VERCEL_BLOB_API_URL=http://localhost:4402/__blob nohup node lib/dev.mjs "$W/app" 4402 > "$W/4402.log" 2>&1 &
for port in 4400 4401 4402; do
  for i in $(seq 1 40); do curl -s --noproxy localhost -o /dev/null -m 2 "http://localhost:$port/" && break; sleep 0.25; done
  printf "%s: " $port; curl -s --noproxy localhost -m 20 "http://localhost:$port/api/session"; echo
done
