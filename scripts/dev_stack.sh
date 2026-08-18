#!/usr/bin/env bash
# PRAVAAH local stack — Homebrew services, no Docker.
#
# docs/03 §5 requires the demo to run with the network cable physically pulled.
# Everything here is local: Postgres (with TimescaleDB, PostGIS, pgvector),
# Redis, MinIO for S3-compatible object storage, and optionally Keycloak.
#
#   scripts/dev_stack.sh up | down | status | reset
set -uo pipefail

DB_NAME="${PRAVAAH_DB:-pravaah}"
# PG18 on 5433, because timescaledb builds against postgresql@18 and 5432 is
# already serving other projects on ${PG_SERVICE}. The two coexist untouched.
export PGPORT="${PRAVAAH_DB_PORT:-5433}"
PG_SERVICE="postgresql@18"
DB_USER="${PRAVAAH_DB_USER:-pravaah}"
DB_PASS="${PRAVAAH_DB_PASS:-pravaah}"
MINIO_DIR="${HOME}/.pravaah/minio"
MINIO_LOG="${HOME}/.pravaah/minio.log"

c_ok()   { printf "  \033[32m●\033[0m %s\n" "$1"; }
c_bad()  { printf "  \033[31m●\033[0m %s\n" "$1"; }
c_warn() { printf "  \033[33m●\033[0m %s\n" "$1"; }

svc_running() { brew services list 2>/dev/null | awk -v s="$1" '$1==s && $2=="started"{f=1} END{exit !f}'; }

start_brew_svc() {
  local name="$1"
  if svc_running "$name"; then c_ok "$name already running"
  else brew services start "$name" >/dev/null 2>&1 && c_ok "$name started" || c_bad "$name failed to start"; fi
}

start_minio() {
  if pgrep -f "minio server ${MINIO_DIR}" >/dev/null 2>&1; then
    c_ok "minio already running (:9000)"; return
  fi
  command -v minio >/dev/null 2>&1 || { c_warn "minio not installed — skipping (brew install minio)"; return; }
  mkdir -p "$MINIO_DIR" "$(dirname "$MINIO_LOG")"
  MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
    nohup minio server "$MINIO_DIR" --address :9000 --console-address :9001 \
    >"$MINIO_LOG" 2>&1 &
  sleep 1
  pgrep -f "minio server ${MINIO_DIR}" >/dev/null 2>&1 \
    && c_ok "minio started (:9000, console :9001)" || c_bad "minio failed — see $MINIO_LOG"
}

stop_minio() {
  pkill -f "minio server ${MINIO_DIR}" >/dev/null 2>&1 && c_ok "minio stopped" || c_warn "minio not running"
}

bootstrap_db() {
  # Idempotent. Creates the role, the database, the extensions and the
  # read-only role NEETI's text-to-SQL runs as (docs/07 §5).
  psql -d postgres -v ON_ERROR_STOP=1 -q <<EOSQL 2>/dev/null || { c_bad "postgres not reachable"; return 1; }
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}' CREATEDB;
  END IF;
END \$\$;
EOSQL
  psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
    || createdb -O "${DB_USER}" "${DB_NAME}"
  psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 -q -f infra/postgres/00-extensions.sql
  c_ok "database '${DB_NAME}' ready"
}

case "${1:-status}" in
  up)
    echo "── starting PRAVAAH local stack ──"
    start_brew_svc ${PG_SERVICE}
    start_brew_svc redis
    start_minio
    sleep 1
    bootstrap_db
    echo
    "$0" status
    ;;
  down)
    echo "── stopping PRAVAAH local stack ──"
    brew services stop ${PG_SERVICE} >/dev/null 2>&1 && c_ok "postgres stopped"
    brew services stop redis >/dev/null 2>&1 && c_ok "redis stopped"
    stop_minio
    ;;
  reset)
    echo "── dropping and recreating '${DB_NAME}' ──"
    read -rp "  This destroys all local data. Type the database name to confirm: " reply
    [ "$reply" = "${DB_NAME}" ] || { echo "  aborted"; exit 1; }
    dropdb --if-exists "${DB_NAME}" && bootstrap_db
    ;;
  status)
    echo "── PRAVAAH local stack ──"
    svc_running "${PG_SERVICE}" && c_ok "postgres  $(psql -d postgres -tAc 'select version()' 2>/dev/null | cut -d' ' -f1-2) on :${PGPORT}" || c_bad "postgres  not running"
    redis-cli ping >/dev/null 2>&1 && c_ok "redis     $(redis-cli --version 2>/dev/null | cut -d' ' -f2)" || c_bad "redis     not running"
    pgrep -f "minio server" >/dev/null 2>&1 && c_ok "minio     :9000" || c_warn "minio     not running"
    curl -sf http://localhost:11434/api/tags >/dev/null 2>&1 && c_ok "ollama    :11434 (on-prem LLM available)" || c_warn "ollama    not running"
    if psql -d "${DB_NAME}" -tAc "select 1" >/dev/null 2>&1; then
      echo "  ── extensions in '${DB_NAME}' ──"
      psql -d "${DB_NAME}" -tAc \
        "select '    '||extname||' '||extversion from pg_extension where extname in ('timescaledb','postgis','vector','pg_trgm','pgcrypto') order by extname" 2>/dev/null
    else
      c_warn "database '${DB_NAME}' not created yet — run: scripts/dev_stack.sh up"
    fi
    ;;
  *)
    echo "usage: $0 {up|down|status|reset}" >&2; exit 2 ;;
esac
