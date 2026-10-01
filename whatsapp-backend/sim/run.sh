#!/usr/bin/env sh
# Starts the local WhatsApp simulator: a throwaway database, the real bot code, and a page
# at http://localhost:8765/sim with three phones (Guest, Anneli, Driver).
#
# Nothing reaches Meta or Paystack, and no template is created: every send is captured,
# payments open a local "Pay / Decline / Cancel" page, and the app refuses to start unless
# both databases are on this machine.
#
# Usage (Git Bash, from anywhere):  sh whatsapp-backend/sim/run.sh      Stop with Ctrl+C.
# First run installs the database package (npm) - needs Node.js.
set -eu
SIM=$(cd "$(dirname "$0")" && pwd)
SVC=$(cd "$SIM/.." && pwd)
ROOT=$(cd "$SVC/.." && pwd)
PY="$SVC/.venv/Scripts/python.exe"; [ -x "$PY" ] || PY="$SVC/.venv/bin/python"
URL=postgresql://postgres:sim@127.0.0.1:55432

[ -d "$SIM/node_modules" ] || (cd "$SIM" && npm install --silent)
rm -rf "$SIM/.pgdata"
(cd "$SIM" && node postgres.mjs) > "$SIM/postgres.log" 2>&1 &
PG=$!
trap 'kill $PG 2>/dev/null; sleep 2' EXIT INT TERM
i=0; until grep -q READY "$SIM/postgres.log" 2>/dev/null; do i=$((i+1)); [ $i -gt 90 ] && { cat "$SIM/postgres.log"; exit 1; }; sleep 1; done
echo "== database up"

(cd "$ROOT" && npx drizzle-kit push --force --config "$SIM/drizzle.sim.config.ts" >/dev/null) && echo "== dashboard schema loaded"

export KANAAN_HUB_DATABASE_URL="$URL/kanaan_hub" DATABASE_URL="$URL/notification_service"
# Blank every live credential from .env: the simulator must not be able to reach Meta,
# Paystack or Google even by mistake.
export SIMULATOR=true WHATSAPP_ACCESS_TOKEN="" WHATSAPP_APP_SECRET="" PAYSTACK_SECRET_KEY=sk_test_simulator \
       GOOGLE_MAPS_API_KEY="" BOT_SCHEDULER_ENABLED=false INTERNAL_MIRROR_SECRET=simulator \
       KANAAN_OPS_WHATSAPP=+27000000001 KANAAN_OPS_PHONE="063 794 3880" ROOT_PATH=""
(cd "$SVC" && "$PY" scripts/migrate.py >/dev/null) && echo "== service tables created"
"$PY" - <<'PYEOF'
import psycopg2, os
with psycopg2.connect(os.environ["KANAAN_HUB_DATABASE_URL"]) as c, c.cursor() as cur:
    cur.execute("insert into drivers (name, phone, plate, vehicle) values ('Test Driver', '+27000000002', 'MP 1166', 'white Toyota Quantum')")
print("== test driver added")
PYEOF

echo "== simulator: http://localhost:8765/sim   (Ctrl+C or close this window to stop)"
cd "$SVC" && "$PY" -m uvicorn app.main:app --port 8765 --log-level warning &
UV=$!
trap 'kill $UV $PG 2>/dev/null; sleep 2' EXIT INT TERM
# The page must never outlive its database (it would answer every message with an error):
# if either stops, stop both and say so.
while kill -0 "$PG" 2>/dev/null && kill -0 "$UV" 2>/dev/null; do sleep 3; done
echo "== the simulator stopped (its database or server exited) - start it again to keep testing"
