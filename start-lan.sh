#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$ROOT_DIR/simulator-api"
WEB_DIR="$ROOT_DIR/simulator-web"

if [[ ! -d "$API_DIR" || ! -d "$WEB_DIR" ]]; then
  echo "Expected simulator-api and simulator-web under: $ROOT_DIR"
  exit 1
fi

LAN_IP="$(ipconfig getifaddr en0 || true)"
if [[ -z "${LAN_IP}" ]]; then
  LAN_IP="$(ipconfig getifaddr en1 || true)"
fi

if [[ -z "${LAN_IP}" ]]; then
  echo "Could not detect LAN IP. Make sure Wi-Fi is connected."
  exit 1
fi

API_PORT="${API_PORT:-8787}"
WEB_PORT="${WEB_PORT:-5173}"
API_URL="http://${LAN_IP}:${API_PORT}"
WEB_URL="http://${LAN_IP}:${WEB_PORT}"

kill_listen_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "Port ${port} is busy. Stopping existing process(es): ${pids}"
    kill ${pids} >/dev/null 2>&1 || true
    sleep 1
  fi
}

echo "Starting LAN mode..."
echo "API URL: ${API_URL}"
echo "Web URL: ${WEB_URL}"
echo ""
echo "Open on iPad: ${WEB_URL}"
echo ""

kill_listen_port "$API_PORT"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

(
  cd "$API_DIR"
  PORT="$API_PORT" npm run dev
) &
API_PID=$!

cd "$WEB_DIR"
VITE_API_BASE_URL="$API_URL" npm run dev -- --host 0.0.0.0 --port "$WEB_PORT"
