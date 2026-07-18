#!/usr/bin/env bash
# local-build.sh — Build all service images for Docker Desktop / local Kubernetes.
#
# Images are built, tagged as localhost:5000/<name>:latest, and pushed to a
# local registry so Docker Desktop's Kubernetes containerd can pull them.
#
# Usage (from repo root):
#   ./scripts/local-build.sh            # build all services
#   ./scripts/local-build.sh flask      # build only flask-backend
#
# After building, apply to the local cluster:
#   kubectl apply -k k8s/
#
# Prerequisites:
#   local registry running: docker run -d -p 5000:5000 --name local-registry --restart always registry:2
#   docker daemon running (Docker Desktop)
#   kubectl context pointing at docker-desktop

set -euo pipefail

REGISTRY="localhost:5000"
FILTER="${1:-all}"          # "all" or a service name substring to match
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

build() {
  local NAME="$1"
  local CONTEXT="$2"
  local DOCKERFILE="${3:-${CONTEXT}/Dockerfile}"

  # Skip if a filter was given and it doesn't match
  if [[ "${FILTER}" != "all" && "${NAME}" != *"${FILTER}"* ]]; then
    return
  fi

  echo ""
  echo ">>> Building ${NAME}:latest"
  docker build \
    --tag "${REGISTRY}/${NAME}:latest" \
    --file "${DOCKERFILE}" \
    "${CONTEXT}"

  echo ">>> Pushing ${REGISTRY}/${NAME}:latest"
  docker push "${REGISTRY}/${NAME}:latest"
}

# ── FastAPI microservices (each has a self-contained build context) ───────────
build "glue-catalog"        "${REPO_ROOT}/microservices/glue_catalog"
build "claims-generator"    "${REPO_ROOT}/microservices/claims_generator"
build "claims-cleaner"      "${REPO_ROOT}/microservices/claims_cleaner"
build "sqs-monitor"         "${REPO_ROOT}/microservices/sqs_monitor"
build "athena-client"       "${REPO_ROOT}/microservices/athena_client"
build "patients-encounters" "${REPO_ROOT}/microservices/patients_encounters"

# ── Flask backend (build context is repo root — Dockerfile copies multiple dirs)
build "flask-backend"       "${REPO_ROOT}" "${REPO_ROOT}/flask-dynamo-db-backend/Dockerfile"

echo ""
echo "✅  Local images built and pushed to ${REGISTRY}. NodePort map:"
echo "    glue-catalog        → localhost:30000"
echo "    claims-generator    → localhost:30001"
echo "    claims-cleaner      → localhost:30002"
echo "    sqs-monitor         → localhost:30003"
echo "    athena-client       → localhost:30004"
echo "    patients-encounters → localhost:30005"
echo "    flask-backend       → localhost:30006"
echo ""
echo "Apply to cluster:  kubectl apply -k k8s/"
echo "Remove from cluster: kubectl delete -k k8s/"
