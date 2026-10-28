#!/usr/bin/env bash
# Prueba las migraciones, las reglas y la seguridad en un PostgreSQL local descartable.
# Uso: npm run test:db   (requiere PostgreSQL 15+ instalado: initdb, pg_ctl, psql)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
cleanup() { pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
if [ "$(id -u)" = "0" ]; then
  chown -R nobody "$TMP"; RUN=(runuser -u nobody --); else RUN=(); fi
"${RUN[@]}" initdb -D "$TMP/data" -U postgres -A trust >/dev/null
"${RUN[@]}" pg_ctl -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_local.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "· migración $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
echo "· carga inicial repetida (no debe duplicar)"
"${PSQL[@]}" -f "$(ls "$ROOT"/supabase/migrations/*carga_inicial*.sql)"
for f in "$ROOT"/supabase/tests/[1-9]*.sql; do
  echo "· pruebas $(basename "$f")"
  "${PSQL[@]}" -o /dev/null -f "$f"
done
echo "OK: todas las pruebas de base de datos pasaron."
