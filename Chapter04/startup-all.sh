#!/usr/bin/env bash
# startup-all.sh — Start all RAG-API backends and frontends
# Usage: bash startup-all.sh
# Stop:  bash startup-all.sh stop   (kills processes by saved PIDs)

set -euo pipefail

PYTHON="/c/Users/Owner/anaconda3/python"
RAG_DIR="/c/Users/Owner/OneDrive/RESTful-Web-API-Design-with-Node.js-10-Third-Edition/Chapter04/rag-api"
FRONTEND_DIR="/c/Users/Owner/OneDrive/RESTful-Web-API-Design-with-Node.js-10-Third-Edition/Chapter04/rag-frontend"
LANDING_DIR="/c/Users/Owner/OneDrive/RESTful-Web-API-Design-with-Node.js-10-Third-Edition/Chapter04/landing-page"
LOG_DIR="/tmp/rag-logs"
PID_FILE="/tmp/rag-logs/pids.txt"

# ── Stop mode ─────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "stop" ]]; then
  if [[ -f "$PID_FILE" ]]; then
    echo "Stopping services..."
    while IFS= read -r line; do
      name="${line%%:*}"
      pid="${line##*:}"
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" && echo "  ✓ stopped $name (PID $pid)"
      else
        echo "  – $name (PID $pid) already stopped"
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  else
    echo "No PID file found at $PID_FILE"
  fi
  exit 0
fi

# ── Start mode ────────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
> "$PID_FILE"   # truncate

start_py() {
  local name="$1" script="$2" port="$3"
  echo "  Starting $name on :$port ..."
  PORT="$port" nohup "$PYTHON" "$RAG_DIR/$script" \
    > "$LOG_DIR/${name}.log" 2>&1 &
  echo "${name}:$!" >> "$PID_FILE"
}

start_npm() {
  local name="$1" dir="$2"
  echo "  Starting $name ..."
  ( cd "$dir" && nohup npm run dev > "$LOG_DIR/${name}.log" 2>&1 & echo "${name}:$!" >> "$PID_FILE" )
}

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║         Healthcare RAG — Starting All Services       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "── Python backends ──────────────────────────────────────"
start_py  "rag-api"           "main.py"              4005
start_py  "pharmacist"        "pharmacist_review.py" 4006
start_py  "ehr-query"         "ehr_query.py"         4007
start_py  "diagnosis"         "diagnosis_support.py" 4008
start_py  "config-api"        "config_api.py"        4009

echo ""
echo "── Node frontends ───────────────────────────────────────"
start_npm "rag-frontend"  "$FRONTEND_DIR"
start_npm "landing-page"  "$LANDING_DIR"

# Wait briefly for processes to bind
sleep 4

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                   Services are starting up                       ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║                                                                  ║"
echo "║  LANDING PAGE (portal)                                           ║"
echo "║    http://localhost:5176                                          ║"
echo "║                                                                  ║"
echo "║  CLINICAL DECISION SUPPORT (RAG UI)                              ║"
echo "║    http://localhost:5178                                          ║"
echo "║                                                                  ║"
echo "║  RAG API BACKENDS                                                ║"
echo "║    RAG Core     →  http://localhost:4005/docs                    ║"
echo "║    Pharmacist   →  http://localhost:4006/docs                    ║"
echo "║    EHR Query    →  http://localhost:4007/docs                    ║"
echo "║    Diagnosis    →  http://localhost:4008/docs                    ║"
echo "║    Config API   →  http://localhost:4009/docs                    ║"
echo "║                                                                  ║"
echo "║  LOGS  →  /tmp/rag-logs/                                         ║"
echo "║  PIDs  →  /tmp/rag-logs/pids.txt                                 ║"
echo "║                                                                  ║"
echo "║  To stop all:  bash startup-all.sh stop                          ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
