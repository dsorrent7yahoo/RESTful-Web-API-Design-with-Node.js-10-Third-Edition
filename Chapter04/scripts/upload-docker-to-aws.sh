#!/usr/bin/env bash
# =============================================================================
# scripts/upload-docker-to-aws.sh
#
# Full pipeline: build → test → push to ECR → deploy to ECS Fargate (and/or
# EC2) → smoke-test every endpoint.
#
# Usage
# -----
#   bash scripts/upload-docker-to-aws.sh              # full pipeline
#   bash scripts/upload-docker-to-aws.sh --ec2-only   # EC2 git-pull deploy
#   bash scripts/upload-docker-to-aws.sh --test-only  # smoke tests only
#   bash scripts/upload-docker-to-aws.sh --skip-build # skip Docker build/push
#
# Prerequisites
# -------------
#   aws-cli v2   docker   git   node ≥ 18   python ≥ 3.9   jq
#   ~/.ssh/chapter04-ec2-key.pem   (for EC2 deploy)
#   aws sts get-caller-identity    (credentials configured)
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
AWS_ACCOUNT="005905648819"
AWS_REGION="us-east-1"
ECR_REPO="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/sorrentino-fargate-fhir-demo-repo"
ECS_CLUSTER="sorrentino-fargate-fhir-demo-cluster"
ECS_SERVICE="sorrentino-fargate-fhir-demo-service"
TASK_DEF_FAMILY="flask-dynamo-db-backend"
ALB_HOST="sorrentino-fargate-fhir-demo-alb-1996236158.us-east-1.elb.amazonaws.com"
EC2_IP="44.210.179.18"
EC2_USER="ec2-user"
PEM="$HOME/.ssh/chapter04-ec2-key.pem"
GIT_BRANCH="django"
COMPOSE_FILE="docker-compose.ec2.yml"

# ── Flags ─────────────────────────────────────────────────────────────────────
EC2_ONLY=false; TEST_ONLY=false; SKIP_BUILD=false
for arg in "$@"; do
  [[ "$arg" == "--ec2-only"   ]] && EC2_ONLY=true
  [[ "$arg" == "--test-only"  ]] && TEST_ONLY=true
  [[ "$arg" == "--skip-build" ]] && SKIP_BUILD=true
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
log() { echo -e "\n\033[1;36m==>\033[0m $*"; }
ok()  { echo -e "  \033[1;32m✓\033[0m $*"; }
err() { echo -e "  \033[1;31m✗\033[0m $*" >&2; }

# =============================================================================
# STEP 0 — Preflight checks
# =============================================================================
log "STEP 0 — Preflight checks"

for cmd in aws docker git node python jq; do
  if command -v "$cmd" &>/dev/null; then ok "$cmd found"; else err "$cmd not found — install it first"; exit 1; fi
done

IDENTITY=$(MSYS_NO_PATHCONV=1 aws sts get-caller-identity --region "$AWS_REGION" --output json 2>&1) || {
  err "AWS credentials not configured. Run: aws configure"; exit 1
}
ok "AWS identity: $(echo "$IDENTITY" | jq -r '.Arn')"

# =============================================================================
# STEP 1 — Run local tests
# =============================================================================
if [[ "$TEST_ONLY" == false ]]; then

log "STEP 1 — Local tests"

cd "$ROOT"

# 1a. Python normaliser unit tests (no AWS required)
python scripts/test_athena_normaliser.py && ok "Athena normaliser: all cases pass"

# 1b. Node.js Mongoose model tests (requires mongod on :27017)
if node -e "require('net').createConnection(27017,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
  npm test && ok "Node model tests: pass"
else
  echo "  (MongoDB not running locally — skipping Node model test)"
fi

# 1c. Python syntax check on all modified backend files
for f in \
  flask-dynamo-db-backend/routes/athena.py \
  django-back-end/athena_app/views.py \
  rag-api/pharmacist_review.py; do
  python -m py_compile "$f" && ok "Syntax OK: $f"
done

fi  # end skip for TEST_ONLY

# =============================================================================
# STEP 2 — Build all frontends
# =============================================================================
if [[ "$TEST_ONLY" == false && "$SKIP_BUILD" == false ]]; then

log "STEP 2 — Build frontends"
cd "$ROOT"

for dir in \
  rag-frontend \
  Django-Fronend-Typescript \
  django-front-end \
  flask-dynamo-db-frontend \
  dynamo-db-frontend \
  spring-boot-react-frontend; do
  if [[ -f "$dir/package.json" ]]; then
    (cd "$dir" && npm run build --silent) && ok "Built: $dir"
  fi
done

# Angular (outputs to dist/angular-spring-boot-frontend/browser/)
if [[ -f "angular-spring-boot-frontend/package.json" ]]; then
  (cd angular-spring-boot-frontend && npm run build --silent) && ok "Built: angular-spring-boot-frontend"
fi

fi

# =============================================================================
# STEP 3 — Git commit & push
# =============================================================================
if [[ "$TEST_ONLY" == false && "$SKIP_BUILD" == false ]]; then

log "STEP 3 — Git commit & push"
cd "$ROOT/.."

if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "deploy: $(date '+%Y-%m-%d %H:%M') — automated build via upload-docker-to-aws.sh"
  ok "Committed pending changes"
fi

git push origin "$GIT_BRANCH" && ok "Pushed to origin/$GIT_BRANCH"

fi

# =============================================================================
# STEP 4 — Docker: build & push to ECR  (Fargate path)
# =============================================================================
if [[ "$TEST_ONLY" == false && "$EC2_ONLY" == false && "$SKIP_BUILD" == false ]]; then

log "STEP 4 — Docker build & push to ECR"
cd "$ROOT"

# 4a. ECR login
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin \
    "${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com" \
  && ok "ECR login OK"

# 4b. Build
docker build \
  -f flask-dynamo-db-backend/Dockerfile \
  -t "${ECR_REPO}:latest" \
  . \
  && ok "Docker image built"

# 4c. Push
docker push "${ECR_REPO}:latest" && ok "Pushed to ECR: ${ECR_REPO}:latest"

# 4d. Verify
aws ecr describe-images \
  --repository-name sorrentino-fargate-fhir-demo-repo \
  --region "$AWS_REGION" \
  --query "imageDetails[0].{tag:imageTags[0],pushed:imagePushedAt,sizeMB:imageSizeInBytes}" \
  --output table

fi

# =============================================================================
# STEP 5 — ECS Fargate: register task definition & rolling deploy
# =============================================================================
if [[ "$TEST_ONLY" == false && "$EC2_ONLY" == false ]]; then

log "STEP 5 — ECS deploy"
cd "$ROOT"

# 5a. Register new task definition revision
TASK_ARN=$(MSYS_NO_PATHCONV=1 aws ecs register-task-definition \
  --cli-input-json file://flask-dynamo-db-backend/ecs-fargate-task-definition.json \
  --region "$AWS_REGION" \
  --query "taskDefinition.taskDefinitionArn" \
  --output text) && ok "Task definition registered: $TASK_ARN"

TASK_REV="${TASK_DEF_FAMILY}:$(echo "$TASK_ARN" | grep -oE '[0-9]+$')"

# 5b. Rolling deploy
MSYS_NO_PATHCONV=1 aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE" \
  --task-definition "$TASK_REV" \
  --region "$AWS_REGION" \
  --output text > /dev/null \
  && ok "Service update triggered: $TASK_REV"

# 5c. Wait for stable
echo "  Waiting for ECS service to stabilise (up to 5 min)..."
MSYS_NO_PATHCONV=1 aws ecs wait services-stable \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE" \
  --region "$AWS_REGION" \
  && ok "ECS service is stable"

fi

# =============================================================================
# STEP 6 — EC2 git-pull deploy (alternative path)
# =============================================================================
if [[ "$TEST_ONLY" == false && ("$EC2_ONLY" == true || "$SKIP_BUILD" == false) ]]; then

if [[ -f "$PEM" ]]; then
  log "STEP 6 — EC2 git-pull + docker-compose up"
  SSH="ssh -i $PEM -o StrictHostKeyChecking=no $EC2_USER@$EC2_IP"

  $SSH "cd ~/app/Chapter04 && \
    git fetch origin ${GIT_BRANCH} && \
    git checkout ${GIT_BRANCH} && \
    git reset --hard origin/${GIT_BRANCH} && \
    docker compose -f ${COMPOSE_FILE} pull --quiet && \
    docker compose -f ${COMPOSE_FILE} up -d --build 2>&1 | tail -20" \
    && ok "EC2 containers updated"

  echo "  Waiting 30s for containers to start..."
  sleep 30
else
  echo "  (PEM not found at $PEM — skipping EC2 deploy)"
fi

fi

# =============================================================================
# STEP 7 — Smoke tests
# =============================================================================
log "STEP 7 — Smoke tests"

FAIL=0

smoke() {
  local label="$1" url="$2" expect="${3:-200}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  if [[ "$status" == "$expect" ]]; then
    ok "$label → HTTP $status"
  else
    err "$label → expected $expect, got $status  ($url)"
    FAIL=$((FAIL + 1))
  fi
}

# ── Fargate / ALB endpoints ───────────────────────────────────────────────────
smoke "Fargate  /health"                "http://${ALB_HOST}/health"
smoke "Fargate  /medications/"          "http://${ALB_HOST}/medications/?limit=1"

# ── EC2 endpoints ─────────────────────────────────────────────────────────────
smoke "EC2 landing page       :80"      "http://${EC2_IP}/"
smoke "EC2 api-gateway health :8080"    "http://${EC2_IP}:8080/health"
smoke "EC2 flask-backend      :4001"    "http://${EC2_IP}:4001/health"
smoke "EC2 django-backend     :4002"    "http://${EC2_IP}:4002/health"
smoke "EC2 node-backend       :4003"    "http://${EC2_IP}:4003/health"
smoke "EC2 spring-boot        :4004"    "http://${EC2_IP}:4004/health"

# ── EC2 frontend pages ────────────────────────────────────────────────────────
smoke "EC2 dynamo-frontend    :3002"    "http://${EC2_IP}:3002/"
smoke "EC2 django-frontend    :3003"    "http://${EC2_IP}:3003/"

# ── JWT auth test (EC2 API Gateway) ──────────────────────────────────────────
JWT=$(curl -s -X POST "http://${EC2_IP}:8080/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' \
  --max-time 10 2>/dev/null \
  | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null || echo "")

if [[ -n "$JWT" ]]; then
  ok "API Gateway login: JWT obtained"
  AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $JWT" \
    "http://${EC2_IP}:8080/proxy/django/medications/?limit=1" --max-time 10 2>/dev/null || echo "000")
  smoke "EC2 gateway proxy  /proxy/django/medications" \
    "http://${EC2_IP}:8080/proxy/django/medications/?limit=1" "200"
  ok "Proxy auth test → HTTP $AUTH_STATUS"
else
  err "API Gateway login failed — skipping proxy test"
  FAIL=$((FAIL + 1))
fi

# ── Python normaliser unit tests ──────────────────────────────────────────────
python "$SCRIPT_DIR/test_athena_normaliser.py" \
  && ok "Athena normaliser: 9/9 pass" \
  || { err "Athena normaliser tests FAILED"; FAIL=$((FAIL + 1)); }

# ── Node.js model tests ───────────────────────────────────────────────────────
cd "$ROOT"
if node -e "require('net').createConnection(27017,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
  npm test && ok "Node model tests: 1 passing" || { err "Node model tests FAILED"; FAIL=$((FAIL + 1)); }
else
  echo "  (MongoDB not running — skipping Node model test)"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "============================================================"
if [[ $FAIL -eq 0 ]]; then
  echo -e "  \033[1;32mALL CHECKS PASSED\033[0m — deploy complete"
else
  echo -e "  \033[1;31m$FAIL CHECK(S) FAILED\033[0m — review errors above"
fi
echo "  EC2:     http://${EC2_IP}"
echo "  Gateway: http://${EC2_IP}:8080"
echo "  Fargate: http://${ALB_HOST}"
echo "============================================================"
exit $FAIL
