#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  Local dev environment — localhost:12123
#
#  ใช้ Postgres แบบ portable ที่ ~/.local/share/plans-seo-localdb
#  แยกขาดจาก Supabase/production ทั้งหมด (ดู .env.development.local)
#
#  usage:  ./scripts/localdev.sh {start|stop|status|reset|dev}
# ─────────────────────────────────────────────────────────────
set -e

BASE="$HOME/.local/share/plans-seo-localdb"
BIN="$BASE/node_modules/@embedded-postgres/darwin-arm64/native/bin"
DATA="$BASE/pgdata"
PGPORT=15432
APP_PORT=12123

LOCAL_DB="postgresql://postgres:localdev@127.0.0.1:$PGPORT/plans_seo_local?schema=plans_seo_pipeline"

db_start() {
  if "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
    echo "✅ Postgres ทำงานอยู่แล้ว (port $PGPORT)"
  else
    "$BIN/pg_ctl" -D "$DATA" -l "$BASE/pg.log" \
      -o "-p $PGPORT -k $BASE -c listen_addresses=127.0.0.1" start
  fi
}

case "${1:-dev}" in
  start)  db_start ;;
  stop)   "$BIN/pg_ctl" -D "$DATA" stop ;;
  status) "$BIN/pg_ctl" -D "$DATA" status ;;
  reset)
    db_start
    # prisma CLI อ่านแค่ .env จึงต้องส่งค่า local เข้าไปเอง
    DATABASE_URL="$LOCAL_DB" DIRECT_URL="$LOCAL_DB" npx prisma db push --force-reset
    DATABASE_URL="$LOCAL_DB" DIRECT_URL="$LOCAL_DB" npx tsx prisma/seed.ts
    ;;
  dev)
    db_start
    echo "▶  http://localhost:$APP_PORT"
    npx next dev -p $APP_PORT
    ;;
  *)
    echo "usage: $0 {start|stop|status|reset|dev}" >&2
    exit 1
    ;;
esac
