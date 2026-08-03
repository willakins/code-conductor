#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_DIR="$ROOT_DIR/.local"
RUNTIME_DIR="$LOCAL_DIR/runtime-long"
PG_DATA_DIR="$LOCAL_DIR/calypso-pg-long"
APP_PID_FILE="$RUNTIME_DIR/app.pid"
NGROK_PID_FILE="$RUNTIME_DIR/ngrok.pid"

stop_process_by_pid() {
  local pid="$1"

  if [[ -z "$pid" ]] || ! kill -0 "$pid" >/dev/null 2>&1; then
    return
  fi

  kill "$pid" >/dev/null 2>&1 || true

  for _ in $(seq 1 10); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return
    fi
    sleep 0.2
  done

  kill -9 "$pid" >/dev/null 2>&1 || true
}

stop_process_from_pid_file() {
  local process_name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    echo "$process_name not running (no pid file)"
    return
  fi

  local pid
  pid="$(cat "$pid_file")"

  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "Stopping $process_name (pid $pid)"
    stop_process_by_pid "$pid"
  else
    echo "$process_name pid file is stale"
  fi

  rm -f "$pid_file"
}

find_calypso_node_process_ids() {
  if ! command -v ps >/dev/null 2>&1; then
    return
  fi

  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue

    local cwd_path
    cwd_path="$(lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p' | head -n1)"
    if [[ "$cwd_path" == "$ROOT_DIR" ]] || [[ "$cwd_path" == "$ROOT_DIR/"* ]]; then
      echo "$pid"
    fi
  done < <(ps -axo pid=,comm= 2>/dev/null | awk '$2=="node" {print $1}' || true)
}

stop_remaining_calypso_node_processes() {
  local found_node_process
  found_node_process="false"

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    found_node_process="true"
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "Stopping additional Code Conductor node process (pid $pid)"
      stop_process_by_pid "$pid"
    fi
  done < <(find_calypso_node_process_ids | sort -u)

  if [[ "$found_node_process" == "false" ]]; then
    echo "No additional Code Conductor node processes found"
  fi
}

stop_remaining_ngrok_processes() {
  if ! command -v pgrep >/dev/null 2>&1 || ! command -v pkill >/dev/null 2>&1; then
    return
  fi

  if pgrep -f "[n]grok" >/dev/null 2>&1; then
    echo "Stopping additional ngrok process(es)"
    pkill -f "[n]grok" >/dev/null 2>&1 || true
    return
  fi

  echo "No additional ngrok processes found"
}

cleanup_runtime_state() {
  rm -f "$APP_PID_FILE" "$NGROK_PID_FILE"
  rmdir "$RUNTIME_DIR" >/dev/null 2>&1 || true
}

main() {
  stop_process_from_pid_file "calypso app" "$APP_PID_FILE"
  stop_process_from_pid_file "ngrok" "$NGROK_PID_FILE"
  stop_remaining_ngrok_processes
  stop_remaining_calypso_node_processes
  cleanup_runtime_state

  echo
  echo "Code Conductor long-term app/ngrok stopped."
  echo "Persistent Postgres is still running and data remains at .local/calypso-pg-long"
}

main "$@"
