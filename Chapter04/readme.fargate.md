# Flask DynamoDB Backend — Fargate Deployment Guide

## Architecture

```
Developer machine
  │
  ├─ python app.py            ← local dev (port 4001)
  ├─ docker compose up        ← local Docker Desktop (port 4001, gunicorn)
  └─ deploy-fargate.sh        ── build & push ──►  ECR (Docker registry)
                                                     │
                                                     ▼
                                              ECS Fargate Task
                                         (flask-backend-cluster)
                                              port 4001, public IP
                                                     │
                                                     ▼
                                              AWS DynamoDB (us-east-1)
                                              AWS S3  (export)
                                              AWS Glue (catalog)
```

### Components

| Component | Name / Value |
|---|---|
| ECR repository | `005905648819.dkr.ecr.us-east-1.amazonaws.com/chapter04-flask-dynamo-db-backend` |
| ECS cluster | `flask-backend-cluster` |
| ECS service | `flask-dynamo-db-backend-service` |
| Task definition | `flask-dynamo-db-backend:1` |
| Task IAM role | `ecs-fargate-cluster-task-role` (DynamoDB + S3 + Glue + SSM) |
| Execution IAM role | `ecsTaskExecutionRole` |
| CloudWatch logs | `/ecs/flask-dynamo-db-backend` |
| Subnets | `subnet-00d613e568e2b9e26`, `subnet-020fe31bfb8540a5d` |
| Security group | `sg-0a08c0ed040c59371` |
| Current public IP | `3.87.216.20` (changes on task restart — use `get-fargate-ip.sh`) |

### Frontends

| Frontend | Port | Command | Backend |
|---|---|---|---|
| `flask-dynamo-db-frontend` | 5175 | `npm run dev` | Flask (4001) |
| `dynamo-db-frontend` | 5174 | `npm run dev` | Node.js (4002) |

---

## Prerequisites

- AWS CLI configured (`aws configure`)
- Docker Desktop running
- Node.js 20+ for the React frontends
- Python 3.12+ for local dev
- Run all commands from the `Chapter04/` directory

---

## Running Locally

### Option A — Python directly (fastest for development)

```bash
cd flask-dynamo-db-backend
python app.py
# Flask runs on http://localhost:4001
```

### Option B — Docker Desktop (matches Fargate exactly)

```bash
# First time — build and start
docker compose -f docker-compose.flask.yml up --build

# Subsequent starts (image already built)
docker compose -f docker-compose.flask.yml up

# Stop
docker compose -f docker-compose.flask.yml down
```

The container mounts `~/.aws` read-only so it uses your local AWS credentials
to reach DynamoDB.

### Start the React frontend

```bash
cd flask-dynamo-db-frontend
npm install        # first time only
npm run dev
# Open http://localhost:5175
```

Log in with the default dev credentials:
- Email: `react-dgs@yahoo.com`
- Password: `python`

### Verify the backend is up

```bash
curl http://localhost:4001/health
# {"status":"ok"}

curl http://localhost:4001/tables \
  -H "Authorization: Bearer <your-jwt-token>"
```

---

## Deploying to AWS Fargate

### Step 1 — Authenticate Docker to ECR

```bash
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin \
    005905648819.dkr.ecr.us-east-1.amazonaws.com
```

### Step 2 — Build and push the image (run from Chapter04/)

```bash
# Build
docker build \
  -f flask-dynamo-db-backend/Dockerfile \
  -t 005905648819.dkr.ecr.us-east-1.amazonaws.com/chapter04-flask-dynamo-db-backend:latest \
  .

# Push
docker push \
  005905648819.dkr.ecr.us-east-1.amazonaws.com/chapter04-flask-dynamo-db-backend:latest
```

### Step 3 — Register a new task definition revision

```bash
MSYS_NO_PATHCONV=1 aws ecs register-task-definition \
  --cli-input-json file://flask-dynamo-db-backend/ecs-fargate-task-definition.json \
  --region us-east-1 \
  --query "taskDefinition.taskDefinitionArn" \
  --output text
```

### Step 4 — Update the running service to the new revision

```bash
# Replace flask-dynamo-db-backend:N with the revision number from Step 3
MSYS_NO_PATHCONV=1 aws ecs update-service \
  --cluster flask-backend-cluster \
  --service flask-dynamo-db-backend-service \
  --task-definition flask-dynamo-db-backend:1 \
  --region us-east-1

# Wait until the new task is stable
MSYS_NO_PATHCONV=1 aws ecs wait services-stable \
  --cluster flask-backend-cluster \
  --services flask-dynamo-db-backend-service \
  --region us-east-1
```

### (One-command) Deploy using the deploy script

```bash
# From Chapter04/
bash flask-dynamo-db-backend/deploy-fargate.sh
```

---

## First-time Infrastructure Setup (already done — reference only)

These commands were run once to create the cluster, log group, and service.
You do NOT need to run them again unless starting from scratch.

```bash
# 1. Create ECR repository
aws ecr create-repository \
  --repository-name chapter04-flask-dynamo-db-backend \
  --region us-east-1 \
  --image-scanning-configuration scanOnPush=true

# 2. Add DynamoDB + S3 + Glue permissions to the task role
aws iam put-role-policy \
  --role-name ecs-fargate-cluster-task-role \
  --policy-name flask-dynamo-access \
  --policy-document file://flask-dynamo-db-backend/iam-task-policy.json

# 3. Create the ECS cluster
aws ecs create-cluster \
  --cluster-name flask-backend-cluster \
  --region us-east-1

# 4. Create CloudWatch log group
MSYS_NO_PATHCONV=1 aws logs create-log-group \
  --log-group-name /ecs/flask-dynamo-db-backend \
  --region us-east-1

# 5. Register the task definition (see Step 3 above)

# 6. Create the service (first deploy only)
MSYS_NO_PATHCONV=1 aws ecs create-service \
  --cluster flask-backend-cluster \
  --service-name flask-dynamo-db-backend-service \
  --task-definition flask-dynamo-db-backend:1 \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-00d613e568e2b9e26,subnet-020fe31bfb8540a5d],securityGroups=[sg-0a08c0ed040c59371],assignPublicIp=ENABLED}" \
  --region us-east-1
```

---

## Finding the Live Public IP

Fargate tasks get a new public IP each time the task restarts. Use these commands
to find the current IP:

```bash
# Get the running task ARN
TASK_ARN=$(MSYS_NO_PATHCONV=1 aws ecs list-tasks \
  --cluster flask-backend-cluster \
  --service-name flask-dynamo-db-backend-service \
  --region us-east-1 \
  --query "taskArns[0]" --output text)

# Get the ENI attached to the task
ENI=$(MSYS_NO_PATHCONV=1 aws ecs describe-tasks \
  --cluster flask-backend-cluster \
  --tasks "$TASK_ARN" \
  --region us-east-1 \
  --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" \
  --output text)

# Get the public IP from the ENI
MSYS_NO_PATHCONV=1 aws ec2 describe-network-interfaces \
  --network-interface-ids "$ENI" \
  --region us-east-1 \
  --query "NetworkInterfaces[0].Association.PublicIp" \
  --output text
```

Then verify the backend is responding:

```bash
curl http://<public-ip>:4001/health
# {"status":"ok"}

curl http://<public-ip>:4001/tables \
  -H "Authorization: Bearer <your-jwt-token>"

curl -X POST http://<public-ip>:4001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"react-dgs@yahoo.com","password":"python"}'
```

---

## Viewing Logs

```bash
# Stream live logs from the running container
MSYS_NO_PATHCONV=1 aws logs tail /ecs/flask-dynamo-db-backend \
  --follow \
  --region us-east-1

# Last 100 lines
MSYS_NO_PATHCONV=1 aws logs tail /ecs/flask-dynamo-db-backend \
  --since 1h \
  --region us-east-1
```

---

## Stopping / Scaling

```bash
# Scale down to zero (stop but keep the service)
aws ecs update-service \
  --cluster flask-backend-cluster \
  --service flask-dynamo-db-backend-service \
  --desired-count 0 \
  --region us-east-1

# Scale back up
aws ecs update-service \
  --cluster flask-backend-cluster \
  --service flask-dynamo-db-backend-service \
  --desired-count 1 \
  --region us-east-1

# Delete the service entirely
aws ecs delete-service \
  --cluster flask-backend-cluster \
  --service flask-dynamo-db-backend-service \
  --force \
  --region us-east-1
```

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4001` | HTTP port gunicorn binds to |
| `AWS_REGION` | `us-east-1` | AWS region for DynamoDB/S3/Glue |
| `DYNAMODB_TABLE` | `medications` | Default table name |
| `AUTO_CREATE_CSV_TABLES` | `true` | Bootstrap CSV tables on startup |
| `JWT_SECRET` | `health-care-dev-secret` | Sign/verify JWT tokens |
| `SMTP_USER` | — | Gmail address for approval emails |
| `SMTP_PASSWORD` | — | Gmail App Password |
| `APPROVER_EMAIL` | — | Who receives registration approval emails |

In Fargate, secrets (`JWT_SECRET`, `SMTP_PASSWORD`) should be stored in
AWS SSM Parameter Store and referenced in the task definition `secrets` block
instead of plain `environment` entries.
