# AWS EC2 Deployment Guide — Healthcare API Demo

A single-instance EC2 deployment that runs all backends, frontends, microservices, and the API Gateway
behind an Elastic IP using Docker Compose.

---

## Architecture Overview

```
Browser (any IP)
    │
    ▼  port 80
┌───────────────────────────────────────────────────────────────────────┐
│                        EC2 t3.medium  44.210.179.18                   │
│                                                                       │
│  :80   landing-page  (nginx — choose your demo)                       │
│  :8080 api-gateway   (Express JWT — /proxy/:svc/* → backend)          │
│                                                                       │
│  Frontends (nginx, served by React/Vite builds)                       │
│    :3002  dynamo-db-frontend  (Node.js React UI)                      │
│    :3003  django-frontend     (Django React UI)                       │
│                                                                       │
│  Backends                                                             │
│    :4001  flask-dynamo-db-backend  (Python · Flask · DynamoDB)        │
│    :4002  django-back-end          (Python · Django REST · DynamoDB)  │
│    :4003  dynamo-db-backend        (Node.js · Express · DynamoDB)     │
│    :4004  spring-boot-backend      (Java · Spring Boot 3 · DynamoDB)  │
│                                                                       │
│  Microservices                                                        │
│    :4010  glue-service    (S3 uploads + Glue Catalog)                 │
│    :4011  claims-service  (Synthetic FHIR claims)                     │
│    :4012  cleaner-service (CSV → Parquet cleaner)                     │
│    :4013  sqs-monitor     (SQS queue monitor)                         │
│    :4014  athena-client   (Athena SQL + AI)                           │
│    :4015  patients-service(FHIR patients/encounters)                  │
└───────────────────────────────────────────────────────────────────────┘
    │
    ▼  AWS services (via IAM role — no credentials on instance)
  DynamoDB  ·  S3  ·  Glue  ·  Athena  ·  SQS  ·  SES
```

All frontends detect when they are running on EC2 (`window.location.hostname ≠ localhost`)
and automatically route every request through the API Gateway:
```
http://44.210.179.18:8080/proxy/<service>/...
```

---

## Quick Access URLs

| Service | URL |
|---------|-----|
| Landing page | http://44.210.179.18 |
| **API Gateway** | **http://44.210.179.18:8080** |
| Node.js React UI | http://44.210.179.18:3002 |
| Django React UI | http://44.210.179.18:3003 |
| Flask + DynamoDB API | http://44.210.179.18:4001 |
| Django REST API | http://44.210.179.18:4002 |
| Node.js Express API | http://44.210.179.18:4003 |
| Spring Boot API | http://44.210.179.18:4004/swagger-ui.html |

---

## API Gateway Authentication

The gateway (`/api-gateway/`) requires a JWT token issued by its `/api/v1/auth/login` endpoint.

### Login

```bash
curl -s -X POST http://44.210.179.18:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | jq .
```

Response:
```json
{
  "success": true,
  "token": "<JWT>",
  "user": { "username": "admin", "roles": ["admin"] }
}
```

### Call a proxied backend

```bash
curl -H "Authorization: Bearer <JWT>" \
     http://44.210.179.18:8080/proxy/django/api/v1/medications/
```

### Service health dashboard

```
GET http://44.210.179.18:8080/api/v1/health
```

### Gateway endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/login` | Get JWT token |
| `GET  /api/health` | All service health |
| `GET  /registry` | Registered services list (no auth) |
| `GET  /proxy/:svc/*` | Reverse proxy → backend |

---

## SSH Access

**Key pair name:** `chapter04-ec2-key`  
**PEM file location:** `~/.ssh/chapter04-ec2-key.pem`

```bash
ssh -i ~/.ssh/chapter04-ec2-key.pem ec2-user@44.210.179.18
```

> The PEM file is stored locally — it is NOT committed to source control.
> SSH access is locked to a single CIDR (`50.108.161.158/32`).

### Useful SSH commands

```bash
# Watch Docker Compose build progress
ssh -i ~/.ssh/chapter04-ec2-key.pem ec2-user@44.210.179.18 \
  'tail -f /tmp/compose.log'

# Check running containers
ssh -i ~/.ssh/chapter04-ec2-key.pem ec2-user@44.210.179.18 \
  'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'

# Pull latest code and rebuild
ssh -i ~/.ssh/chapter04-ec2-key.pem ec2-user@44.210.179.18 \
  'cd ~/app/Chapter04 && git pull && \
   docker compose -f docker-compose.ec2.yml up -d --build'

# View logs for a specific service
ssh -i ~/.ssh/chapter04-ec2-key.pem ec2-user@44.210.179.18 \
  'cd ~/app/Chapter04 && docker compose -f docker-compose.ec2.yml logs api-gateway -f'
```

---

## Terraform Deployment

All infrastructure is defined in `infra/terraform/ec2/`.

### Prerequisites

- [Terraform ≥ 1.6](https://developer.hashicorp.com/terraform/downloads)
- AWS CLI configured (`aws configure`) with a profile that can create EC2, IAM, and networking resources
- An existing EC2 key pair **or** create one and update `terraform.tfvars`

### Deploy from scratch

```bash
cd infra/terraform/ec2

# Copy the example vars and fill in your values
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars — see "Variables" section below

terraform init
terraform plan
terraform apply
```

After `apply` the outputs show every URL and the SSH command:

```
gateway_url      = "http://<IP>:8080"
django_api_url   = "http://<IP>:4002"
ssh_command      = "ssh -i ~/.ssh/chapter04-ec2-key.pem ec2-user@<IP>"
bootstrap_log    = "ssh ... 'tail -f /var/log/ec2-userdata.log'"
```

### Variables (`terraform.tfvars`)

| Variable | Example | Description |
|----------|---------|-------------|
| `aws_region` | `us-east-1` | AWS region |
| `name_prefix` | `chapter04-ec2` | Prefix for all resource names |
| `instance_type` | `t3.medium` | EC2 instance type |
| `key_pair_name` | `chapter04-ec2-key` | Existing AWS key pair name |
| `allowed_ssh_cidr` | `203.0.113.5/32` | Your IP for SSH access |
| `dynamodb_table_name` | `medications` | DynamoDB table name |
| `github_repo_url` | `https://github.com/…` | Repo to clone on boot |
| `github_branch` | `django` | Branch to clone |
| `jwt_secret` | `change-in-prod-…` | Gateway JWT signing secret |

> `terraform.tfvars` is excluded from source control (contains secrets).
> Use `terraform.tfvars.example` as a template.

### Destroy

```bash
terraform destroy
```

This removes the EC2 instance, Elastic IP, security group, IAM role/policy, and instance profile.

---

## IAM Permissions

The EC2 instance runs under an IAM instance profile that grants **least-privilege** access
to the AWS services used by the healthcare backends.

Full policy: [`infra/aws/iam-ec2-instance-policy.json`](infra/aws/iam-ec2-instance-policy.json)  
Trust policy: [`infra/aws/iam-ec2-trust-policy.json`](infra/aws/iam-ec2-trust-policy.json)

**Services covered:**

| Service | Actions | Resource Scope |
|---------|---------|----------------|
| DynamoDB | CRUD + describe | `medications` table only |
| S3 | `Get/Put/List/Delete` | `healthcare-fhir-*` buckets |
| Glue | `Get/Create` databases, tables, partitions | All (catalog-level) |
| Athena | Start/Get query execution | All |
| S3 (Athena results) | `Get/Put/List` | `aws-athena-query-results-*` bucket |
| SQS | Send/Receive/Delete/List | All queues |
| CloudWatch Logs | `CreateGroup/Stream/PutEvents` | All |
| ECR | `GetAuthToken` + `BatchGetImage` | All |

No `AdministratorAccess`. No `*` on any sensitive service.

---

## Security Group

Full rules: [`infra/aws/security-group-rules.json`](infra/aws/security-group-rules.json)

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | `50.108.161.158/32` | SSH (your IP only) |
| 80 | TCP | `0.0.0.0/0` | Landing page |
| 3002 | TCP | `0.0.0.0/0` | Node.js React UI |
| 3003 | TCP | `0.0.0.0/0` | Django React UI |
| 4001 | TCP | `0.0.0.0/0` | Flask API |
| 4002 | TCP | `0.0.0.0/0` | Django API |
| 4003 | TCP | `0.0.0.0/0` | Node.js API |
| 8080 | TCP | `0.0.0.0/0` | API Gateway |

All egress is open (required for Docker pulls, `apt` updates, AWS SDK calls).

---

## EC2 Instance Details

| Property | Value |
|----------|-------|
| Instance ID | `i-093dbaa9b6e94596e` |
| Instance type | `t3.medium` (2 vCPU, 4 GB RAM) |
| AMI | Amazon Linux 2023 (`ami-051bfa33df3949860`) |
| Elastic IP | `44.210.179.18` |
| Region / AZ | `us-east-1` |
| Security group | `sg-0ca74d7295f47bd96` |
| IAM role | `chapter04-ec2-role` |
| IAM profile | `chapter04-ec2-profile` |
| Key pair | `chapter04-ec2-key` |
| App directory | `/home/ec2-user/app/Chapter04/` |

---

## First-Boot Bootstrap

The EC2 user-data script (`infra/terraform/ec2/userdata.sh.tpl`) runs once on first boot:

1. Install Docker + Docker Compose plugin
2. Install buildx 0.23+
3. Clone the `django` branch of this repo into `/home/ec2-user/app/`
4. Write a `.env` file with the JWT secret
5. Run `docker compose -f docker-compose.ec2.yml up -d --build`

Monitor progress:
```bash
ssh -i ~/.ssh/chapter04-ec2-key.pem ec2-user@44.210.179.18 \
  'tail -f /var/log/ec2-userdata.log'
```

The first build takes ~5-10 minutes (downloading base images + installing npm/pip packages).

---

## Default Credentials

> Change all of these before any public demo.

| Service | Username / Key | Password |
|---------|---------------|----------|
| API Gateway admin | `admin` | `admin` |
| Django superuser | `react-dgs@yahoo.com` | `python` |
| Gateway JWT secret | — | `healthcare-ec2-dev-secret-2026` |

---

## Updating the Deployment

After pushing new code to GitHub:

```bash
ssh -i ~/.ssh/chapter04-ec2-key.pem ec2-user@44.210.179.18 \
  'cd ~/app/Chapter04 \
   && git pull \
   && docker compose -f docker-compose.ec2.yml up -d --build'
```

Containers that have changed will be rebuilt and restarted; unchanged containers are skipped.
