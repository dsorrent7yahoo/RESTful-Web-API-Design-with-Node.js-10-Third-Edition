# Flask Healthcare API — AWS Fargate / DynamoDB

A production-quality REST API for healthcare medication data, deployed on AWS ECS Fargate behind an Application Load Balancer. The stack demonstrates Flask 3, AWS DynamoDB, JWT authentication, S3 data-lake export, AWS Glue cataloging, a React single-page UI, Terraform infrastructure-as-code, and GitHub Actions CI/CD with keyless OIDC authentication.

**Live endpoint:** `http://chapter04-flask-alb-2093616647.us-east-1.elb.amazonaws.com`  
**Swagger UI:** `http://chapter04-flask-alb-2093616647.us-east-1.elb.amazonaws.com/api-docs`

---

## Architecture

```
  Browser / React UI (Vite)
       │
       ▼
  ALB  :80  (chapter04-flask-alb)
       │
       ▼
  ECS Fargate  (chapter04-flask-cluster / chapter04-flask-service)
  ┌─────────────────────────────────────────────────────┐
  │  Python 3.12 / Flask 3.0.3 / Gunicorn               │
  │  Port 4001                                           │
  │                                                      │
  │  Blueprints:                                         │
  │    /auth        – JWT login, registration, approval  │
  │    /medications – CRUD, patient/code filters         │
  │    /upload      – CSV / JSON file import             │
  │    /export      – DynamoDB → S3, Glue cataloging     │
  │    /source      – Source-browser API (portfolio)     │
  │    /            – Health check, Swagger              │
  └────────────────┬────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
  AWS DynamoDB          AWS S3 / Glue
  • medications         • healthcare-exports-*
  • health-care-users   • Glue database: healthcare_data_lake
  • pending-users
```

**Infrastructure managed by Terraform** (`infra/terraform/flask-fargate-ecs/`):
- ECR repository, ECS cluster + service + task definition
- Application Load Balancer + target group + security groups
- IAM roles: ECS task execution, ECS task, GitHub Actions OIDC
- CloudWatch log group (`/ecs/chapter04-flask-api`, 30-day retention)
- GitHub Actions OIDC provider (keyless deploy — no static AWS keys)

---

## React UI — Quick Start & Button Reference

The React single-page app (`flask-dynamo-db-frontend/`) drives every API endpoint, displays results, and lets you browse all project source files without leaving the browser.

### Starting the UI

**Option A — Local development (Vite hot-reload)**
```bash
cd flask-dynamo-db-frontend
npm install          # first time only
npm run dev          # → http://localhost:5173
```

**Option B — Served by Docker (production build bundled into Flask)**
```bash
# From the project root — starts Flask + DynamoDB Local + Admin UI
docker compose -f docker-compose.flask.yml up --build -d
# Then open http://localhost:4001
```

**Option C — Live on AWS Fargate**
```
http://chapter04-flask-alb-2093616647.us-east-1.elb.amazonaws.com
```

---

### Hero Section — Backend Selector

At the top of the page, three buttons choose which backend the UI talks to:

| Button | URL | Use when |
|--------|-----|----------|
| **Command Line** | `http://localhost:4001` | Running `python app.py` directly |
| **Docker** | `http://localhost:4001` | Running via `docker compose` |
| **AWS Fargate** | ALB DNS name | Testing against the live Fargate deployment |

> Click **AWS Fargate** to point at the live cloud environment with real DynamoDB data.

---

### Hero Links & Buttons

| Control | What it does |
|---------|-------------|
| **Login / Register** | Opens the Flask auth page (`/`) in a new tab — register an account or log in to get a JWT |
| **Swagger UI** | Opens the interactive OpenAPI spec (`/api-docs`) in a new tab |
| **📖 Docs & Source** | Opens the **Docs & Source modal** (see below) |

---

### 📖 Docs & Source Modal

Click **📖 Docs & Source** from the hero section to open a full-screen popup with five tabs:

| Tab | What it shows |
|-----|--------------|
| **📖 README** | This file — project overview, Docker & AWS deploy guide (auto-loads on open) |
| **🏗️ Terraform** | Left panel lists all `.tf` files; click any file to view it in the code pane |
| **🐳 Docker / Fargate** | `Dockerfile` and `docker-compose.flask.yml` |
| **⚙️ GitHub Actions** | The CI/CD workflow YAML (`flask-dynamo-db-backend.yml`) |
| **📂 Browse Files** | Full recursive tree of the backend source; click any file to view it |

> All file content is fetched live from the running Flask container via `GET /source/file?path=<file>`.  
> The **Browse Files** tree is built by `GET /source/tree` which walks the app directory.

---

### Login Panel

Before making authenticated API calls you must log in:

1. Enter email and password (default test user: `react-dgs@yahoo.com` / `python`)
2. Click **Login** — the JWT is stored in `localStorage.healthCareToken`
3. The panel shows **✅ Authenticated — JWT token active** when ready
4. Click **Log Out** to clear the token

---

### API Explorer Panel

| Control | What it does |
|---------|-------------|
| **Base URL** | Read-only display of the currently selected backend URL |
| **API Call** dropdown | Choose any of the 20 available API endpoints |
| **topN** | Limit the number of results returned (default 10) |
| **Filter by ID / Patient / Medication** | Optional query parameters for filtered lookups |
| **URL preview** | Shows the exact URL that will be called |
| **Invoke API** | Sends the request; result appears in the Response panel |
| **Reset** | Clears all filter fields |
| **Refresh Tables** | Calls `GET /tables` and refreshes the Loaded Tables list |

**Available API endpoints (dropdown):**

| Endpoint | Description |
|----------|-------------|
| `GET /medications/` | List all medications (topN limit) |
| `GET /medications/id/:id` | Fetch single medication by DynamoDB ID |
| `GET /medications/patient/:patient` | All medications for a patient |
| `GET /medications/code/:code` | Filter by medication code |
| `GET /medications/medication/:medicationId` | Filter by medication ID |
| `GET /medications/patients/multiple-medications` | Patients on multiple medications |
| `POST /medications/` | Create a new medication record |
| `PUT /medications/:id` | Update an existing record |
| `DELETE /medications/:id` | Delete a record |
| `POST /medications/upload` | Bulk import via JSON `csvContent` field |
| `GET /tables` | List all DynamoDB tables |
| `POST /upload/file` | Upload a CSV file (multipart form) |
| `POST /upload` | Import CSV by server-side file path |
| `GET /export/s3/buckets` | List accessible S3 buckets |
| `POST /export/s3` | Export DynamoDB table → S3 as CSV |
| `GET /export/glue/databases` | List Glue databases |
| `GET /export/glue/databases/{db}/tables` | List tables in a Glue database |
| `POST /export/glue` | Register an S3 path as a Glue table |
| `🚀 POST /export/pipeline/all` | Full pipeline: DynamoDB → S3 → Glue (one click) |
| `📂 POST /export/pipeline/from-csv` | Upload a CSV → S3 → Glue |

---

### Response Panel

Displays the HTTP status code and full JSON response from the last API call.  
Large payloads are scrollable. Errors are highlighted in red.

---

### Loaded Tables Panel

Shows all DynamoDB tables visible on the selected backend. Click **Refresh Table List** to update after creating tables or switching backends.

---

### Glue Data Lake Tables Panel

Enter a Glue database name (default: `healthcare_data_lake`) and click **Refresh** to list all tables catalogued in AWS Glue for that database.

---

### Source Browser Panel

A persistent scrollable panel at the bottom of the page (same file-browsing capability as the modal's **📂 Browse Files** tab). Use **Browse All Files** to load the recursive source tree, or use the **Quick View** dropdown to jump directly to a key file.

---


| Tool | Min version | Install |
|------|-------------|---------|
| Docker Desktop | 4.x | https://www.docker.com/products/docker-desktop |
| AWS CLI v2 | 2.x | https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html |
| Terraform | 1.6+ | https://developer.hashicorp.com/terraform/install |
| Python | 3.12 | https://www.python.org/downloads/ |
| Node.js | 18+ | https://nodejs.org/ |

---

## Running Locally with Docker Desktop

### 1 — Clone the repository

```bash
git clone https://github.com/dsorrent7yahoo/RESTful-Web-API-Design-with-Node.js-10-Third-Edition.git
cd RESTful-Web-API-Design-with-Node.js-10-Third-Edition
```

### 2 — Start the full local stack (Flask + DynamoDB Local + Admin UI)

The compose file at `../docker-compose.flask.yml` starts three services:

```bash
# From the project root
docker compose -f docker-compose.flask.yml up --build -d
```

| Service | URL | Notes |
|---------|-----|-------|
| Flask API | http://localhost:4001 | REST API + Swagger |
| DynamoDB Local | http://localhost:8000 | AWS-compatible in-memory DB |
| DynamoDB Admin UI | http://localhost:8001 | Table browser |

### 3 — Build the Docker image manually

```bash
# Build context must be the project root so the Dockerfile can reach infra/, .github/, etc.
docker build \
  -f flask-dynamo-db-backend/Dockerfile \
  -t chapter04-flask:latest \
  .
```

### 4 — Run the image standalone (points at AWS DynamoDB)

```bash
docker run -d \
  --name chapter04-flask \
  -p 4001:4001 \
  -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=<your-key> \
  -e AWS_SECRET_ACCESS_KEY=<your-secret> \
  -e DYNAMODB_TABLE=medications \
  -e JWT_SECRET=change-me-in-production \
  chapter04-flask:latest
```

### 5 — Run the React frontend (development)

```bash
cd flask-dynamo-db-frontend
npm install
npm run dev        # Vite dev server on http://localhost:5173
```

### 6 — Useful Docker commands

```bash
# View logs
docker logs -f chapter04-flask

# Stop and remove all compose services
docker compose -f docker-compose.flask.yml down

# Remove the image
docker rmi chapter04-flask:latest

# Shell into a running container
docker exec -it chapter04-flask /bin/bash

# Inspect image layers and sizes
docker image inspect chapter04-flask:latest
```

---

## Deploying to AWS Fargate

### Step 1 — Configure AWS CLI

```bash
aws configure
# AWS Access Key ID:     <your-access-key>
# AWS Secret Access Key: <your-secret-key>
# Default region:        us-east-1
# Default output format: json

# Verify identity
aws sts get-caller-identity
```

### Step 2 — Provision infrastructure with Terraform

```bash
cd infra/terraform/flask-fargate-ecs

terraform init
terraform plan -out=tfplan
terraform apply tfplan

# Capture outputs for later steps
terraform output
```

Key outputs:

| Output | Description |
|--------|-------------|
| `alb_dns_name` | Public ALB URL — share this with users |
| `ecr_repository_url` | Full ECR URL for docker push |
| `github_actions_role_arn` | ARN to store as `AWS_ROLE_ARN` GitHub secret |
| `ecs_cluster_name` | `chapter04-flask-cluster` |
| `ecs_service_name` | `chapter04-flask-service` |

### Step 3 — Authenticate Docker to ECR

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS \
    --password-stdin ${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com
```

### Step 4 — Build and push the Docker image

```bash
ECR_URL=$(terraform -chdir=infra/terraform/flask-fargate-ecs output -raw ecr_repository_url)

# Build (run from project root)
docker build \
  -f flask-dynamo-db-backend/Dockerfile \
  -t ${ECR_URL}:latest \
  .

# Push
docker push ${ECR_URL}:latest
```

### Step 5 — Deploy to ECS Fargate

```bash
# Force ECS to pull the new :latest image
aws ecs update-service \
  --cluster chapter04-flask-cluster \
  --service chapter04-flask-service \
  --desired-count 1 \
  --force-new-deployment \
  --region us-east-1

# Watch the rollout
aws ecs wait services-stable \
  --cluster chapter04-flask-cluster \
  --services chapter04-flask-service \
  --region us-east-1
echo "Deployment complete"
```

### Step 6 — Verify the deployment

```bash
ALB=$(terraform -chdir=infra/terraform/flask-fargate-ecs output -raw alb_dns_name)

# Health check
curl http://${ALB}/health

# Login
curl -s -X POST http://${ALB}/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"react-dgs@yahoo.com","password":"python"}' | python3 -m json.tool
```

### Step 7 — View logs

```bash
# Stream live CloudWatch logs
aws logs tail /ecs/chapter04-flask-api --follow --region us-east-1

# Last 50 lines
aws logs tail /ecs/chapter04-flask-api --since 1h --region us-east-1
```

### Tear down (avoid ongoing AWS charges)

```bash
# Scale service to zero first
aws ecs update-service \
  --cluster chapter04-flask-cluster \
  --service chapter04-flask-service \
  --desired-count 0 \
  --region us-east-1

# Destroy all Terraform-managed resources
cd infra/terraform/flask-fargate-ecs
terraform destroy
```

---

## GitHub Actions CI/CD (Automatic Deployment)

Every push to `dynamodb-react` that touches `flask-dynamo-db-backend/**` triggers:

1. **Test** — `pytest tests/ -v --cov` with moto DynamoDB mocks (31 tests)
2. **Build & Push** — Docker image tagged with git SHA pushed to ECR
3. **Deploy** — ECS task definition updated and service rolled out

### Setup (one time)

1. Run Terraform to create the OIDC provider and GitHub Actions role.
2. Add **one** GitHub repository secret:

```
Name:  AWS_ROLE_ARN
Value: arn:aws:iam::<ACCOUNT_ID>:role/chapter04-flask-github-actions-role
       (from terraform output github_actions_role_arn)
```

No static AWS keys are stored in GitHub — authentication uses OIDC token exchange.

---

## AWS IAM Permissions & Policies

### A — Your deploying IAM user/role (Terraform + manual CLI)

The user running `terraform apply` and manual `aws` commands needs these managed policies or equivalent inline rights:

```
AmazonECS_FullAccess
AmazonEC2ContainerRegistryFullAccess
AmazonVPCFullAccess
ElasticLoadBalancingFullAccess
IAMFullAccess
CloudWatchLogsFullAccess
AmazonDynamoDBFullAccess
AmazonS3FullAccess
AWSGlueConsoleFullAccess
```

Minimum IAM inline policy for Terraform (least-privilege):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ECR",     "Effect": "Allow", "Action": "ecr:*",            "Resource": "*" },
    { "Sid": "ECS",     "Effect": "Allow", "Action": "ecs:*",            "Resource": "*" },
    { "Sid": "IAM",     "Effect": "Allow", "Action": ["iam:*Role*","iam:*Policy*","iam:*InstanceProfile*","iam:PassRole","iam:CreateOpenIDConnectProvider","iam:DeleteOpenIDConnectProvider","iam:GetOpenIDConnectProvider","iam:TagOpenIDConnectProvider"], "Resource": "*" },
    { "Sid": "ALB",     "Effect": "Allow", "Action": ["elasticloadbalancing:*","ec2:DescribeVpcs","ec2:DescribeSubnets","ec2:DescribeSecurityGroups","ec2:CreateSecurityGroup","ec2:AuthorizeSecurityGroupIngress","ec2:AuthorizeSecurityGroupEgress","ec2:DeleteSecurityGroup","ec2:RevokeSecurityGroupEgress","ec2:CreateTags"], "Resource": "*" },
    { "Sid": "Logs",    "Effect": "Allow", "Action": "logs:*",           "Resource": "*" },
    { "Sid": "DynamoDB","Effect": "Allow", "Action": "dynamodb:*",       "Resource": "*" },
    { "Sid": "STS",     "Effect": "Allow", "Action": "sts:GetCallerIdentity", "Resource": "*" }
  ]
}
```

### B — ECS Task Execution Role (`chapter04-flask-ecs-exec-role`)

**Attached managed policy:**
```
arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```
This allows ECS to pull the container image from ECR and write logs to CloudWatch.

**Trust policy** — allows ECS tasks to assume this role:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ecs-tasks.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

### C — ECS Task Role (`chapter04-flask-ecs-task-role`)

The inline policy granted to the running Flask container:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem",
        "dynamodb:CreateTable",  "dynamodb:DeleteItem",
        "dynamodb:DescribeTable","dynamodb:GetItem",
        "dynamodb:ListTables",   "dynamodb:PutItem",
        "dynamodb:Query",        "dynamodb:Scan",
        "dynamodb:UpdateItem"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SecretsAccess",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "secretsmanager:GetSecretValue",
        "kms:Decrypt"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3Export",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket","s3:ListBucket","s3:GetBucketLocation",
        "s3:PutObject","s3:GetObject","s3:DeleteObject","s3:ListAllMyBuckets"
      ],
      "Resource": "*"
    },
    {
      "Sid": "GlueCatalog",
      "Effect": "Allow",
      "Action": [
        "glue:CreateDatabase","glue:GetDatabase","glue:GetDatabases",
        "glue:CreateTable","glue:UpdateTable","glue:GetTable","glue:GetTables",
        "glue:DeleteTable","glue:BatchDeleteTable"
      ],
      "Resource": "*"
    }
  ]
}
```

### D — GitHub Actions OIDC Role (`chapter04-flask-github-actions-role`)

**Trust policy** — allows GitHub Actions workflows from the correct repo/branch to assume this role without storing AWS credentials:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub":
          "repo:dsorrent7yahoo/RESTful-Web-API-Design-with-Node.js-10-Third-Edition:ref:refs/heads/dynamodb-react"
      }
    }
  }]
}
```

**Inline policy** — least-privilege for CI/CD (ECR push + ECS deploy only):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuth",
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken"],
      "Resource": "*"
    },
    {
      "Sid": "ECRPush",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability","ecr:CompleteLayerUpload",
        "ecr:GetDownloadUrlForLayer","ecr:InitiateLayerUpload",
        "ecr:PutImage","ecr:UploadLayerPart","ecr:BatchGetImage"
      ],
      "Resource": "arn:aws:ecr:us-east-1:<ACCOUNT_ID>:repository/chapter04-flask-repo"
    },
    {
      "Sid": "ECSDescribe",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices","ecs:DescribeTaskDefinition",
        "ecs:DescribeTasks","ecs:ListTasks",
        "ecs:RegisterTaskDefinition","ecs:UpdateService"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PassTaskRoles",
      "Effect": "Allow",
      "Action": ["iam:PassRole"],
      "Resource": [
        "arn:aws:iam::<ACCOUNT_ID>:role/chapter04-flask-ecs-exec-role",
        "arn:aws:iam::<ACCOUNT_ID>:role/chapter04-flask-ecs-task-role"
      ]
    }
  ]
}
```

### E — AWS Console setup checklist

| Step | Console location | Action |
|------|-----------------|--------|
| OIDC provider | IAM → Identity providers | Terraform creates this automatically |
| GitHub secret | GitHub → Settings → Secrets → Actions | Add `AWS_ROLE_ARN` = Terraform output `github_actions_role_arn` |
| DynamoDB tables | DynamoDB → Tables | Auto-created by Flask on first request if `AUTO_CREATE_CSV_TABLES=true` |
| CloudWatch logs | CloudWatch → Log groups | `/ecs/chapter04-flask-api` created by Terraform |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4001` | Flask/Gunicorn listening port |
| `AWS_REGION` | `us-east-1` | AWS region for DynamoDB and other services |
| `DYNAMODB_TABLE` | `medications` | Primary DynamoDB table name |
| `AUTO_CREATE_CSV_TABLES` | `true` | Create DynamoDB tables from CSV headers on startup |
| `JWT_SECRET` | `health-care-dev-secret` | HS256 signing secret — **change in production** |
| `JWT_EXP_MINUTES` | `60` | Token lifetime in minutes |
| `DYNAMODB_ENDPOINT` | _(unset)_ | Override endpoint for local DynamoDB (e.g. `http://dynamodb-local:8000`) |
| `SOURCE_ROOT` | `/source` | Root path served by the source-browser API |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server for email notifications |
| `SMTP_PORT` | `587` | SMTP port |

---

## Project Structure

```

├── flask-dynamo-db-backend/    # Flask REST API (Python 3.12)
│   ├── app.py                  # Application factory, blueprint registration
│   ├── Dockerfile              # Multi-stage build; copies source to /source/
│   ├── requirements.txt        # Flask, boto3, PyJWT, gunicorn, python-dotenv
│   ├── routes/                 # Blueprint modules
│   │   ├── auth.py             # JWT login, register, approve
│   │   ├── medications.py      # CRUD + patient/code filters
│   │   ├── upload.py           # CSV/JSON file import
│   │   ├── export.py           # DynamoDB → S3; Glue catalog
│   │   ├── dynamodb.py         # Generic table operations
│   │   └── source.py           # Source-browser API (/source/tree, /source/file)
│   ├── modules/                # Business logic (auth, medications)
│   ├── model/                  # DynamoDB resource + table helpers
│   └── tests/                  # pytest suite (31 tests, moto mocks)
├── flask-dynamo-db-frontend/   # React 18 + Vite SPA
│   └── src/App.jsx             # Single-component UI: API explorer, source browser
├── infra/terraform/flask-fargate-ecs/
│   ├── main.tf                 # All AWS resources
│   ├── variables.tf            # Input variables with defaults
│   ├── outputs.tf              # ALB URL, ECR URL, role ARNs
│   └── terraform.tfvars        # Project-specific values
├── .github/workflows/
│   └── flask-dynamo-db-backend.yml  # CI/CD: test → ECR push → ECS deploy
├── docker-compose.flask.yml    # Local stack (Flask + DynamoDB Local + Admin UI)
├── coherent-11-07-2022/csv/    # Synthetic healthcare dataset (Coherent, 2022)
├── healthcare_datalake_databricks.ipynb  # Databricks / Spark analytics notebook
└── README.md                   # This file
```

---

## API Quick Reference

```
GET    /health                          Health check (no auth)
GET    /api-docs                        Swagger UI

POST   /auth/login                      { email, password } → { accessToken }
POST   /auth/register                   Register new user (pending approval)
POST   /auth/approve                    Admin: approve pending user

GET    /medications/                    List all (auth required)
GET    /medications/id/:id              Get by DynamoDB id
GET    /medications/patient/:patient    Filter by patient UUID
GET    /medications/code/:code          Filter by medication code
POST   /medications/                    Create new record
PUT    /medications/:id                 Update existing record
DELETE /medications/:id                 Delete record

POST   /upload/file                     Multipart CSV upload → DynamoDB
POST   /upload                          JSON { tableName, csvPath } import

GET    /export/s3/buckets               List S3 buckets
POST   /export/s3                       DynamoDB table → S3 CSV
POST   /export/glue                     Register S3 path in Glue catalog
POST   /export/pipeline/all             All DynamoDB tables → S3 + Glue
POST   /export/pipeline/from-csv        Local CSV files → S3 + Glue

GET    /source/tree                     JSON file tree of /source/
GET    /source/file?path=<rel>          Raw content of any source file
```

---

## Running Tests

```bash
cd flask-dynamo-db-backend
pip install -r requirements.txt pytest pytest-cov moto[dynamodb]

pytest tests/ -v --tb=short --cov=. --cov-report=term-missing
# 31 passed in ~3s (moto mocks all DynamoDB calls — no AWS credentials needed)
```
