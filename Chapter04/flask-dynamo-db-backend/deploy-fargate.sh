#!/usr/bin/env bash
# deploy-fargate.sh
# Builds the Flask backend Docker image, pushes it to ECR,
# registers the Fargate task definition, and updates (or creates)
# the ECS service.
#
# Usage (run from Chapter04/):
#   bash flask-dynamo-db-backend/deploy-fargate.sh
#
# Prerequisites:
#   - AWS CLI configured (aws configure) with access to account 005905648819
#   - Docker running
#   - The ECS cluster already exists (default: chapter04-cluster)

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
AWS_ACCOUNT=005905648819
AWS_REGION=us-east-1
ECR_REPO=chapter04-flask-dynamo-db-backend
IMAGE_TAG=latest
ECS_CLUSTER=chapter04-cluster
ECS_SERVICE=flask-dynamo-db-backend
TASK_FAMILY=chapter04-flask-dynamo-db-backend
TASK_DEF_FILE=flask-dynamo-db-backend/ecs-fargate-task-definition.json

# ── 1. ECR login ─────────────────────────────────────────────────────────────
echo "==> Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin \
    "${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# ── 2. Create ECR repo if it doesn't exist ───────────────────────────────────
echo "==> Ensuring ECR repository exists..."
aws ecr describe-repositories --repository-names "$ECR_REPO" \
    --region "$AWS_REGION" > /dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$ECR_REPO" \
       --region "$AWS_REGION" \
       --image-scanning-configuration scanOnPush=true \
       --encryption-configuration encryptionType=AES256

# ── 3. Build image (build context = Chapter04/) ──────────────────────────────
IMAGE_URI="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}"
echo "==> Building Docker image: $IMAGE_URI"
docker build \
  -f flask-dynamo-db-backend/Dockerfile \
  -t "$IMAGE_URI" \
  .

# ── 4. Push to ECR ───────────────────────────────────────────────────────────
echo "==> Pushing image to ECR..."
docker push "$IMAGE_URI"

# ── 5. Register task definition ──────────────────────────────────────────────
echo "==> Registering ECS task definition..."
TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json "file://${TASK_DEF_FILE}" \
  --region "$AWS_REGION" \
  --query "taskDefinition.taskDefinitionArn" \
  --output text)
echo "    Task definition: $TASK_DEF_ARN"

# ── 6. Ensure CloudWatch log group exists ────────────────────────────────────
echo "==> Ensuring CloudWatch log group exists..."
aws logs create-log-group \
  --log-group-name "/ecs/${TASK_FAMILY}" \
  --region "$AWS_REGION" 2>/dev/null || true

# ── 7. Create or update ECS service ─────────────────────────────────────────
SERVICE_EXISTS=$(aws ecs describe-services \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE" \
  --region "$AWS_REGION" \
  --query "services[?status=='ACTIVE'] | length(@)" \
  --output text 2>/dev/null || echo "0")

if [ "$SERVICE_EXISTS" = "0" ]; then
  echo "==> Creating ECS service $ECS_SERVICE (requires a VPC subnet + SG)..."
  echo "    Edit the subnet/security-group values below before running create."
  echo ""
  echo "    aws ecs create-service \\"
  echo "      --cluster $ECS_CLUSTER \\"
  echo "      --service-name $ECS_SERVICE \\"
  echo "      --task-definition $TASK_DEF_ARN \\"
  echo "      --desired-count 1 \\"
  echo "      --launch-type FARGATE \\"
  echo "      --network-configuration 'awsvpcConfiguration={subnets=[subnet-XXXXXXXX],securityGroups=[sg-YYYYYYYY],assignPublicIp=ENABLED}'"
else
  echo "==> Updating ECS service $ECS_SERVICE..."
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$ECS_SERVICE" \
    --task-definition "$TASK_DEF_ARN" \
    --region "$AWS_REGION" \
    --query "service.serviceArn" \
    --output text
  echo "==> Waiting for service to become stable..."
  aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$ECS_SERVICE" \
    --region "$AWS_REGION"
fi

echo ""
echo "✅ Deploy complete."
echo "   Image : $IMAGE_URI"
echo "   Task  : $TASK_DEF_ARN"
