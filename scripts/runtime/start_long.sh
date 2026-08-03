#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_DIR="$ROOT_DIR/.local"
RUNTIME_DIR="$LOCAL_DIR/runtime-long"
PG_DATA_DIR="$LOCAL_DIR/calypso-pg-long"
PG_LOG_FILE="$LOCAL_DIR/calypso-pg-long.log"
APP_LOG_FILE="$LOCAL_DIR/calypso-app-long.log"
NGROK_LOG_FILE="$LOCAL_DIR/ngrok-long.log"
APP_PID_FILE="$RUNTIME_DIR/app.pid"
NGROK_PID_FILE="$RUNTIME_DIR/ngrok.pid"
POSTGRES_MODE_FILE="$RUNTIME_DIR/postgres.mode"
LONG_DB_PORT="${LONG_DB_PORT:-5434}"

mkdir -p "$LOCAL_DIR" "$RUNTIME_DIR"

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name"
    exit 1
  fi
}

load_environment_file() {
  if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
  fi
}

ensure_postgres_cluster_exists() {
  if [[ -d "$PG_DATA_DIR" ]]; then
    return
  fi

  echo "Initializing persistent Postgres cluster at .local/calypso-pg-long"
  initdb -D "$PG_DATA_DIR" --auth-local=trust --auth-host=trust >/dev/null
}

is_port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1
    return
  fi

  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return
  fi

  return 1
}

ensure_postgres_running() {
  if pg_ctl -D "$PG_DATA_DIR" status >/dev/null 2>&1; then
    return
  fi

  if is_port_in_use "$LONG_DB_PORT"; then
    echo "Cannot start persistent Postgres on port $LONG_DB_PORT because the port is already in use."
    echo "Stop the conflicting service or set LONG_DB_PORT to a different value."
    exit 1
  fi

  echo "Starting persistent Postgres on port $LONG_DB_PORT"
  pg_ctl -D "$PG_DATA_DIR" -l "$PG_LOG_FILE" -o "-p $LONG_DB_PORT" start >/dev/null
}

is_postgres_reachable() {
  psql -h 127.0.0.1 -p "$LONG_DB_PORT" postgres -c "SELECT 1" >/dev/null 2>&1
}

ensure_calypso_user_role_exists() {
  local role_check
  role_check="$(
    psql -h 127.0.0.1 -p "$LONG_DB_PORT" postgres -tAc \
      "SELECT 1 FROM pg_roles WHERE rolname='calypso_user'"
  )"

  if [[ "$role_check" == "1" ]]; then
    return
  fi

  echo "Creating Postgres role: calypso_user"
  psql -h 127.0.0.1 -p "$LONG_DB_PORT" postgres -c "CREATE ROLE calypso_user WITH LOGIN SUPERUSER;" >/dev/null
}

ensure_database_url_is_reachable() {
  if psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
    return
  fi

  echo "Unable to connect to DATABASE_URL: $DATABASE_URL"
  echo "Check LONG_DB_PORT or verify persistent Postgres is running."
  exit 1
}

start_background_process() {
  local process_name="$1"
  local pid_file="$2"
  local log_file="$3"
  shift 3

  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid="$(cat "$pid_file")"
    if kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "$process_name already running (pid $existing_pid)"
      return
    fi
    rm -f "$pid_file"
  fi

  (
    cd "$ROOT_DIR"
    "$@"
  ) >>"$log_file" 2>&1 &

  local pid="$!"
  echo "$pid" > "$pid_file"
  echo "Started $process_name (pid $pid)"
}

read_ngrok_public_url() {
  if ! command -v curl >/dev/null 2>&1; then
    return
  fi

  local ngrok_web_address
  ngrok_web_address="$(read_ngrok_web_address)"
  if [[ -z "$ngrok_web_address" ]]; then
    ngrok_web_address="127.0.0.1:4040"
  fi

  local tunnels_json
  tunnels_json="$(curl -s --max-time 2 "http://$ngrok_web_address/api/tunnels" || true)"
  if [[ -z "$tunnels_json" ]]; then
    return
  fi

  node -e 'const payload = JSON.parse(process.argv[1] || "{}"); const tunnel = (payload.tunnels || []).find((candidate) => String(candidate.public_url || "").startsWith("https://")); if (tunnel) process.stdout.write(tunnel.public_url);' "$tunnels_json" 2>/dev/null || true
}

read_ngrok_web_address() {
  if [[ ! -f "$NGROK_LOG_FILE" ]]; then
    return
  fi

  node -e 'const fs = require("fs"); const logPath = process.argv[1]; const lines = fs.readFileSync(logPath, "utf8").trim().split(/\n+/).reverse(); for (const line of lines) { try { const entry = JSON.parse(line); if (entry.obj === "web" && entry.msg === "starting web service" && entry.addr) { process.stdout.write(entry.addr); break; } } catch {} }' "$NGROK_LOG_FILE" 2>/dev/null || true
}

main() {
  require_command initdb
  require_command pg_ctl
  require_command psql
  require_command ngrok
  require_command node

  load_environment_file

  export PORT="${PORT:-3001}"
  export DATABASE_URL="${LONG_DATABASE_URL:-postgresql://calypso_user@127.0.0.1:${LONG_DB_PORT}/postgres}"

  ensure_postgres_cluster_exists
  ensure_postgres_running
  ensure_calypso_user_role_exists
  echo "managed" > "$POSTGRES_MODE_FILE"

  if is_postgres_reachable; then
    echo "Persistent Postgres is reachable on port $LONG_DB_PORT"
  fi

  ensure_database_url_is_reachable

  local -a ngrok_command
  ngrok_command=(ngrok http "$PORT" --log=stdout --log-format=json)
  if [[ "${NGROK_POOLING_ENABLED:-true}" == "true" ]]; then
    ngrok_command+=(--pooling-enabled)
  fi

  start_background_process "ngrok" "$NGROK_PID_FILE" "$NGROK_LOG_FILE" "${ngrok_command[@]}"
  start_background_process "calypso app" "$APP_PID_FILE" "$APP_LOG_FILE" node src/app.js

  sleep 1

  local ngrok_public_url
  ngrok_public_url="$(read_ngrok_public_url)"

  echo
  echo "Code Conductor long-term stack started."
  echo "- App log:   $APP_LOG_FILE"
  echo "- ngrok log: $NGROK_LOG_FILE"
  echo "- PG log:    $PG_LOG_FILE"
  echo "- DATABASE_URL: $DATABASE_URL"
  if [[ -n "$ngrok_public_url" ]]; then
    echo "- ngrok URL: $ngrok_public_url"
    echo "  Code-host webhook URL: $ngrok_public_url/codehost/webhook"
  else
    echo "- ngrok URL: unavailable (check $NGROK_LOG_FILE)"
  fi
  echo
  echo "Use: npm run stop:long"
}

main "$@"
