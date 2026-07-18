#!/usr/bin/env bash
# pf-microservices.sh — Port-forward all 5 Kubernetes microservices to localhost
# Usage:  bash pf-microservices.sh          (start)
#         bash pf-microservices.sh stop      (stop)

NS=healthcare
PIDFILE=/tmp/k8s-pf-microservices.pids

stop() {
  if [ -f "$PIDFILE" ]; then
    echo "==> Stopping port-forwards..."
    while IFS= read -r pid; do
      kill "$pid" 2>/dev/null && echo "   killed PID $pid"
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  else
    echo "No PID file found — killing all kubectl port-forward processes..."
    pkill -f "kubectl port-forward.*$NS" 2>/dev/null || true
  fi
  echo "Done."
  exit 0
}

[ "${1}" = "stop" ] && stop

# Kill any stale port-forwards first
pkill -f "kubectl port-forward.*$NS" 2>/dev/null || true
rm -f "$PIDFILE"

echo "==> Starting port-forwards for $NS microservices..."

fwd() {
  local name=$1 local_port=$2 svc_port=$3
  kubectl port-forward -n "$NS" "svc/$name" "${local_port}:${svc_port}" \
    --address 127.0.0.1 >/tmp/pf-${name}.log 2>&1 &
  local pid=$!
  echo "$pid" >> "$PIDFILE"
  echo "   $name  localhost:$local_port  →  svc/$name:$svc_port  (PID $pid)"
}

fwd glue-catalog         30000 4010
fwd claims-generator     30001 4011
fwd claims-cleaner       30002 4012
fwd sqs-monitor          30003 4013
fwd athena-client        30004 4014
fwd patients-encounters  30005 4015

sleep 2

echo ""
echo "==> Verifying connections..."
for port in 30000 30001 30002 30003 30004 30005; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:${port}/" 2>/dev/null)
  echo "   localhost:$port → HTTP $code"
done

echo ""
echo "Microservices ready:"
echo "  http://localhost:30000  Glue Catalog"
echo "  http://localhost:30001  Claims Generator"
echo "  http://localhost:30002  Claims Cleaner"
echo "  http://localhost:30003  SQS Monitor"
echo "  http://localhost:30004  Athena Client"
echo "  http://localhost:30005  Patients & Encounters"
echo ""
echo "Stop with:  bash pf-microservices.sh stop"
