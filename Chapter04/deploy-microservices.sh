#!/usr/bin/env bash
# deploy-microservices.sh — Deploy Django microservices to local Docker Desktop Kubernetes
set -e

K8S_DIR="$(cd "$(dirname "$0")/k8s" && pwd)"

echo "==> Applying manifests (namespace + configmap + deployments + services)..."
kubectl apply -f "$K8S_DIR/microservices.yaml"

echo ""
echo "==> Creating aws-credentials secret from ~/.aws ..."
CREDS_FILE="$HOME/.aws/credentials"
CONFIG_FILE="$HOME/.aws/config"

if [ ! -f "$CREDS_FILE" ]; then
  echo "WARNING: ~/.aws/credentials not found — pods will run without AWS creds"
  # Create an empty placeholder secret so pods start
  kubectl create secret generic aws-credentials \
    --namespace chapter04 \
    --from-literal=credentials="" \
    --from-literal=config="" \
    --dry-run=client -o yaml | kubectl apply -f -
else
  ARGS="--from-file=credentials=$CREDS_FILE"
  [ -f "$CONFIG_FILE" ] && ARGS="$ARGS --from-file=config=$CONFIG_FILE"
  kubectl create secret generic aws-credentials \
    --namespace chapter04 \
    $ARGS \
    --dry-run=client -o yaml | kubectl apply -f -
  echo "   aws-credentials secret applied."
fi

echo ""
echo "==> Waiting for pods to be ready..."
kubectl rollout status deployment/glue-catalog     -n chapter04 --timeout=120s
kubectl rollout status deployment/claims-generator -n chapter04 --timeout=120s
kubectl rollout status deployment/claims-cleaner   -n chapter04 --timeout=120s
kubectl rollout status deployment/sqs-monitor      -n chapter04 --timeout=120s
kubectl rollout status deployment/athena-client    -n chapter04 --timeout=120s

echo ""
echo "==> Pod status:"
kubectl get pods -n chapter04 -o wide

echo ""
echo "==> Services (NodePorts):"
kubectl get svc -n chapter04

echo ""
echo "Microservices running at:"
echo "  http://localhost:30000  — Glue Catalog"
echo "  http://localhost:30001  — Claims Generator"
echo "  http://localhost:30002  — Claims Cleaner"
echo "  http://localhost:30003  — SQS Monitor"
echo "  http://localhost:30004  — Athena Client"
