#!/usr/bin/env bash
# ecr-build-push.sh — Build all 6 microservice images and push to ECR.
#
# Usage:
#   ./scripts/ecr-build-push.sh [TAG]
#
# TAG defaults to "latest". Pass a git SHA or version string for immutable tags:
#   ./scripts/ecr-build-push.sh $(git rev-parse --short HEAD)
#
# Prerequisites:
#   aws cli v2 authenticated (aws sts get-caller-identity should succeed)
#   docker daemon running and buildx available

set -euo pipefail

TAG="${1:-latest}"
ACCOUNT="005905648819"
REGION="us-east-1"
PREFIX="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/healthcare-fhir"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Login to ECR ──────────────────────────────────────────────────────────────
echo ">>> Logging in to ECR..."
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

# ── Build & push each service ─────────────────────────────────────────────────
build_push() {
  local SERVICE="$1"
  local CONTEXT="$2"
  local IMAGE="${PREFIX}-${SERVICE}:${TAG}"

  echo ""
  echo ">>> Building ${SERVICE}  (${IMAGE})"
  docker build \
    --platform linux/amd64 \
    --tag "${IMAGE}" \
    "${REPO_ROOT}/${CONTEXT}"

  echo ">>> Pushing ${IMAGE}"
  docker push "${IMAGE}"

  # Also tag as :latest when a specific tag was given
  if [[ "${TAG}" != "latest" ]]; then
    docker tag "${IMAGE}" "${PREFIX}-${SERVICE}:latest"
    docker push "${PREFIX}-${SERVICE}:latest"
  fi
}

build_push "glue-catalog"        "microservices/glue_catalog"
build_push "claims-generator"    "microservices/claims_generator"
build_push "claims-cleaner"      "microservices/claims_cleaner"
build_push "sqs-monitor"         "microservices/sqs_monitor"
build_push "athena-client"       "microservices/athena_client"
build_push "patients-encounters" "microservices/patients_encounters"
build_push "flask-backend"       "flask-dynamo-db-backend"

echo ""
echo "✅  All images pushed with tag: ${TAG}"
echo ""
echo "Next: update k8s/overlays/eks/kustomization.yaml newTag values, then:"
echo "  kubectl apply -k k8s/overlays/eks/"
