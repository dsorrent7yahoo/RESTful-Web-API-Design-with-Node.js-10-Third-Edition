# GitHub Actions — Flask Fargate ECS Deployment

Automated CI/CD pipeline to test, build, and deploy the Flask healthcare API to AWS ECS Fargate via GitHub Actions.

---

## Quick Start

1. **Terraform infrastructure ready** — Run `terraform apply` in `infra/terraform/flask-fargate-ecs/` (creates ECR, ECS, ALB, IAM, CloudWatch)
2. **Store AWS role ARN** — Save the Terraform output `github_actions_role_arn` as a GitHub Actions secret named `AWS_ROLE_ARN`
3. **Push or PR to trigger** — Any push to `master`, `main`, or `appmod/java-upgrade-20260716004919` with changes in `flask-dynamo-db-backend/` or `infra/terraform/flask-fargate-ecs/`
4. **Monitor** — Watch the Actions tab; check CloudWatch logs when deploy completes

---

## Workflow Overview

```
push to trigger branch
        │
        ▼
┌─────────────────┐
│  Test Job       │  Runs pytest on flask-dynamo-db-backend
│  (always)       │  ✗ fails → workflow stops
└─────────────────┘  ✓ passes → proceed to build
        │
        ▼
┌─────────────────┐
│  Build & Push   │  Build Docker image, push to ECR
│  (push only)    │  ✗ fails → deploy skipped
└─────────────────┘  ✓ pushed → proceed to deploy
        │
        ▼
┌─────────────────┐
│  Deploy         │  Update ECS task definition, deploy new image
│  (push only)    │  ✗ fails → manual rollback needed
└─────────────────┘  ✓ succeeds → new container running
```

---

## Prerequisites

### 1. Terraform Infrastructure

The GitHub Actions workflow assumes the following resources exist in AWS:

```bash
# Apply the Terraform stack
cd infra/terraform/flask-fargate-ecs
terraform init
terraform apply
```

**Required outputs:**
- `ecr_repository_url` — ECR repo (parsed to extract repo name)
- `ecs_cluster_name` — ECS cluster name
- `ecs_service_name` — ECS service name
- `ecs_task_family` — Task definition family
- `container_name` — Container name in the task definition
- `github_actions_role_arn` — IAM role ARN for OIDC

### 2. GitHub Actions Secret: `AWS_ROLE_ARN`

After `terraform apply`, copy the output `github_actions_role_arn` and save it in your repository's GitHub Actions secrets:

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `AWS_ROLE_ARN`
4. Value: Paste the `github_actions_role_arn` from Terraform output
5. Click **Add secret**

```bash
# Or via GitHub CLI
gh secret set AWS_ROLE_ARN --body "$(terraform output -raw github_actions_role_arn)"
```

### 3. Update Workflow Environment Variables

If your Terraform `name_prefix` differs from the default (`sorrentino-fargate-fhir-demo`), update the `env` section in `.github/workflows/flask-fargate-ecs.yml`:

```yaml
env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: <your-name-prefix>-repo
  ECS_CLUSTER: <your-name-prefix>-cluster
  ECS_SERVICE: <your-name-prefix>-service
  ECS_TASK_FAMILY: <your-name-prefix>-task
  CONTAINER_NAME: <your-name-prefix>-api
```

---

## Workflow Jobs

### Job 1: Test

```yaml
test:
  runs-on: ubuntu-latest
  working-directory: flask-dynamo-db-backend
```

**What it does:**
1. Checks out the repository
2. Sets up Python 3.12 and caches pip dependencies
3. Installs Flask, pytest, moto (for DynamoDB mocking)
4. Runs `pytest tests/` with coverage reporting
5. Uses dummy credentials and moto to mock AWS services — no real AWS calls

**Environment variables:**
- `AWS_DEFAULT_REGION: us-east-1`
- `DYNAMODB_TABLE: medications-test` (mocked by moto)
- `JWT_SECRET: ci-only-test-secret-not-used-in-prod`
- `PORT: 4001`
- `AUTO_CREATE_CSV_TABLES: false`

**Triggers deployment?** No — test always runs but does not trigger build or deploy.

**Failure behavior:** If tests fail, the workflow stops and build/deploy are skipped.

---

### Job 2: Build & Push

```yaml
build-and-push:
  needs: test
  if: github.event_name == 'push'
  runs-on: ubuntu-latest
  permissions:
    id-token: write   # OIDC token
    contents: read
```

**What it does:**
1. Checks out the repository
2. **Authenticates to AWS via OIDC** (keyless — no static credentials)
   - Exchanges a GitHub Actions OIDC token for a temporary AWS credential via the IAM role
   - Trust policy restricts the role to this specific repository and branch only
3. Logs into Amazon ECR using the temporary credentials
4. Builds Docker image from `flask-dynamo-db-backend/Dockerfile`
5. Tags the image with:
   - `$REGISTRY/$ECR_REPOSITORY:${{ github.sha }}` (short commit hash)
   - `$REGISTRY/$ECR_REPOSITORY:latest` (always the most recent)
6. Pushes both tags to ECR
7. Outputs the full image URI (`image`) for the deploy job

**Triggers on:** `push` events only (not PRs)

**Failure behavior:** If the build or push fails, the deploy job is skipped (and the workflow fails).

**Docker build context:** The Dockerfile path is `flask-dynamo-db-backend/Dockerfile`, but the build context is the repository root (`.`) so it can access shared files if needed.

---

### Job 3: Deploy

```yaml
deploy:
  needs: build-and-push
  runs-on: ubuntu-latest
  environment: production
  permissions:
    id-token: write
    contents: read
```

**What it does:**
1. Checks out the repository
2. Authenticates to AWS via OIDC (same keyless pattern as build job)
3. Fetches the **current task definition** from ECS using `aws ecs describe-task-definition`
4. Renders a new task definition by replacing the container image with the newly built one
   - Uses AWS action `amazon-ecs-render-task-definition`
   - Only the `image` field is updated; all other settings (CPU, memory, env vars, secrets, logging, etc.) remain unchanged
5. Deploys the new task definition to the ECS service
   - Terminates old tasks and launches new ones with the new image
   - Waits for the service to stabilize (`wait-for-service-stability: true`)
   - Performs a rolling deployment (controlled by `deployment_minimum_healthy_percent` and `deployment_maximum_percent` in Terraform)
6. Prints CloudWatch log group names so you can monitor the deployment

**Environment:** `environment: production`
   - GitHub can require additional approvals for production deployments
   - Configure under **Settings** → **Environments**

**Triggers on:** `push` events only, and only when the build succeeds

**Success criteria:**
- All tasks pass ECS health checks
- ALB target group reports `healthy`
- Service reports desired task count as running

**Failure behavior:**
- If the task definition fetch fails, deploy stops with an error
- If the new tasks fail health checks, the deploy waits (configurable via `wait-for-service-stability`)
- If health checks consistently fail, manual rollback is required (see rollback section below)

---

## Triggering Deployments

### Via push to monitored branches

```bash
# Commit changes to flask-dynamo-db-backend
git add flask-dynamo-db-backend/
git commit -m "fix: update medications API"
git push origin main

# OR update Terraform
git add infra/terraform/flask-fargate-ecs/
git commit -m "infra: increase task memory to 2048"
git push origin main
```

Deployment automatically starts if the pushed branch is `master`, `main`, or `appmod/java-upgrade-20260716004919`.

### Via pull request

```bash
git push origin feature/my-feature
# Create PR on GitHub
```

- **Only the test job runs** (no build or deploy)
- Useful for validating changes before merge
- When PR is merged to `main`, the full pipeline triggers

### Manual trigger (optional — not enabled by default)

To add manual dispatch, add to the workflow `on:` section:

```yaml
on:
  push:
    branches: [master, main]
  pull_request:
    branches: [master, main]
  workflow_dispatch:  # Enable manual trigger
```

Then use:
```bash
gh workflow run flask-fargate-ecs.yml --ref main
```

---

## Path Filters

The workflow only runs when changes are made to these paths:

```yaml
paths:
  - "flask-dynamo-db-backend/**"        # Flask app code
  - "infra/terraform/flask-fargate-ecs/**"  # Infrastructure
  - ".github/workflows/flask-fargate-ecs.yml"  # Workflow itself
```

**To force a run** when these paths haven't changed:
```bash
# Add a dummy comment to the workflow file
echo "# Run" >> .github/workflows/flask-fargate-ecs.yml
git add .github/workflows/flask-fargate-ecs.yml
git commit -m "ci: trigger pipeline"
git push origin main
```

---

## Monitoring Deployments

### 1. GitHub Actions UI

Go to **Actions** tab → **flask-fargate-ecs** → latest run

Shows:
- ✓/✗ for each job (Test, Build, Deploy)
- Duration and timestamp
- Full logs (click **Test**, **Build**, or **Deploy** to expand)

### 2. CloudWatch Logs — Container Logs

```bash
aws logs tail /ecs/sorrentino-fargate-fhir-demo-api \
  --follow \
  --format short \
  --region us-east-1
```

Shows:
- Flask/Gunicorn startup messages
- Request/response logs
- Python errors or warnings during startup

### 3. CloudWatch Logs — ECS Lifecycle Events

```bash
aws logs tail /ecs/sorrentino-fargate-fhir-demo-api/events \
  --follow \
  --format short \
  --region us-east-1
```

Shows:
- Task state transitions: PROVISIONING → PENDING → RUNNING
- Deployment state: IN_PROGRESS → COMPLETED
- Failure reasons (if any)

### 4. CloudWatch Alarms

```bash
aws cloudwatch describe-alarms \
  --alarm-names \
    "sorrentino-fargate-fhir-demo-startup-errors" \
    "sorrentino-fargate-fhir-demo-task-running-zero" \
  --region us-east-1 \
  --query 'MetricAlarms[*].[AlarmName,StateValue,StateReason]' \
  --output table
```

Shows:
- Alarm state (OK, ALARM, INSUFFICIENT_DATA)
- Reason (e.g., "ERROR line detected in logs")

### 5. ECS Service Status

```bash
aws ecs describe-services \
  --cluster sorrentino-fargate-fhir-demo-cluster \
  --services sorrentino-fargate-fhir-demo-service \
  --region us-east-1 \
  --query 'services[0].[serviceName,status,runningCount,desiredCount,deployments[*].[status,runningCount]]' \
  --output table
```

Shows:
- Running vs desired task count
- Current and previous deployments

---

## Troubleshooting

### Build or Deploy Job Fails

**Step 1: Check GitHub Actions logs**
- Go to Actions tab → flask-fargate-ecs → latest run
- Click the failed job (Build or Deploy)
- Scroll to the failed step and read the error message

**Step 2: Common failures**

| Error | Cause | Fix |
|-------|-------|-----|
| `InvalidParameterException: Invalid length for parameter roleArn` | `AWS_ROLE_ARN` secret is empty or malformed | Verify the secret is set correctly and starts with `arn:aws:iam::` |
| `User: arn:aws:iam::XXX:role/XXX is not authorized to perform: ecr:...` | IAM role lacks ECR permissions | Re-run `terraform apply` to update the role policy |
| `NoCredentialProviders` | OIDC token exchange failed | Check the OIDC trust policy in Terraform; ensure `github_repository` and `github_branch` match your repo |
| `BuildError: failed to build: Dockerfile not found` | Dockerfile path is wrong | Verify `flask-dynamo-db-backend/Dockerfile` exists |
| `ImageNotFound` in deploy step | Task definition still references old image | Wait for deploy job to complete; check the rendered task definition |
| `Service did not stabilize in time` | Tasks failing health checks | Check `/ecs/sorrentino-fargate-fhir-demo-api` logs for startup errors |

### Tests Fail

```bash
# Run tests locally
cd flask-dynamo-db-backend
pip install -r requirements.txt pytest pytest-cov moto[dynamodb]
pytest tests/ -v --tb=short
```

**Common test failures:**
- Missing imports → check `requirements.txt`
- Mock DynamoDB errors → ensure `moto[dynamodb]` is installed
- JWT errors → check JWT_SECRET and JWT_EXP_MINUTES env vars

### Deploy Succeeds but Container Won't Start

1. **Check ECS lifecycle events:**
   ```bash
   aws logs filter-log-events \
     --log-group-name /ecs/sorrentino-fargate-fhir-demo-api/events \
     --filter-pattern "STOPPED" \
     --region us-east-1 \
     --query 'events[*].message' \
     --output text | python3 -m json.tool
   ```

2. **Look for `stoppedReason` in the output:**
   - `"Task failed to start"` → check container logs for Python errors
   - `"Out of memory"` → increase `ecs_task_memory` in Terraform
   - `"Essential container exited"` → app crashed; check Flask logs

3. **Check container logs for errors:**
   ```bash
   aws logs filter-log-events \
     --log-group-name /ecs/sorrentino-fargate-fhir-demo-api \
     --filter-pattern "?ERROR ?Exception ?Traceback ?CRITICAL" \
     --region us-east-1 \
     --query 'events[*].[timestamp,message]' \
     --output table
   ```

---

## Rollback

If the new deployment is broken, manually revert to the previous image:

### Option 1: Re-run the previous successful build

1. Go to Actions → flask-fargate-ecs
2. Find the last successful deployment
3. Click the **Run number** → **Deploy** job
4. Click **Re-run job**

This re-runs the deploy step with the same image, reverting to the previous container.

### Option 2: Manual rollback via AWS CLI

```bash
# 1. Find the previous image tag in the container registry
aws ecr describe-images \
  --repository-name sorrentino-fargate-fhir-demo-repo \
  --region us-east-1 \
  --query 'imageDetails[*].[imageTags,imagePushedAt]' \
  --output table

# 2. Update the ECS service to use a previous image
# Fetch the current task definition
aws ecs describe-task-definition \
  --task-definition sorrentino-fargate-fhir-demo-task \
  --query taskDefinition > task-def.json

# 3. Edit task-def.json — change the image field to the previous image URI

# 4. Register the previous task definition
aws ecs register-task-definition \
  --cli-input-json file://task-def.json \
  --region us-east-1

# 5. Update the ECS service to use the new task definition revision
aws ecs update-service \
  --cluster sorrentino-fargate-fhir-demo-cluster \
  --service sorrentino-fargate-fhir-demo-service \
  --task-definition sorrentino-fargate-fhir-demo-task:<new-revision> \
  --region us-east-1
```

---

## Security

### OIDC (Keyless Authentication)

- **No static AWS access keys** are stored in GitHub
- GitHub Actions exchanges an OIDC token for a temporary credential
- Token is scoped to this repository and branch only
- Trust policy in Terraform restricts assumption to:
  ```hcl
  "repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"
  ```

### Least-Privilege IAM Role

The GitHub Actions IAM role (`github_actions`) is scoped to:
- `ecr:GetAuthorizationToken` — login
- `ecr:BatchCheckLayerAvailability`, `ecr:PutImage`, etc. — push image
- `ecs:DescribeTasks`, `ecs:UpdateService` — deploy
- `iam:PassRole` — attach task roles

No access to:
- DynamoDB, S3, or other business data
- Account resources outside ECS/ECR
- Cross-account or cross-region operations

---

## Customization

### Change Trigger Branches

Edit `.github/workflows/flask-fargate-ecs.yml`:

```yaml
on:
  push:
    branches: [master, main, staging]  # Add 'staging'
    paths:
      - "flask-dynamo-db-backend/**"
```

### Change Python Version

```yaml
- name: Set up Python 3.12
  uses: actions/setup-python@v5
  with:
    python-version: "3.13"  # Update to 3.13
```

### Add Manual Approval Step

1. Go to **Settings** → **Environments** → **New environment**
2. Create an environment named `production`
3. Check **Required reviewers** and add team members
4. Save

The workflow now requires approval before deploy proceeds.

### Add Slack Notifications

```yaml
- name: Notify Slack (success)
  if: success()
  run: |
    curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
      -d '{"text": "✓ Flask API deployed to ECS Fargate"}'

- name: Notify Slack (failure)
  if: failure()
  run: |
    curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
      -d '{"text": "✗ Flask API deployment failed — check Actions log"}'
```

Then add `SLACK_WEBHOOK` to GitHub Actions secrets.

---

## Workflow File

**Location:** `.github/workflows/flask-fargate-ecs.yml`

**Full workflow definition:** Defines all three jobs (test, build, deploy) with step-by-step actions, environment variables, and outputs.

---

## Links

| Resource | Link |
|----------|------|
| GitHub Actions runs | https://github.com/PacktPublishing/RESTful-Web-API-Design-with-Node.js-10-Third-Edition/actions |
| Terraform outputs | Run `terraform output` in `infra/terraform/flask-fargate-ecs/` |
| CloudWatch logs (container) | https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups/log-group/$252Fecs$252Fsorrentino-fargate-fhir-demo-api |
| CloudWatch logs (events) | https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups/log-group/$252Fecs$252Fsorrentino-fargate-fhir-demo-api$252Fevents |
| ECS cluster console | https://console.aws.amazon.com/ecs/v2/clusters/sorrentino-fargate-fhir-demo-cluster |
| ECR repository | https://console.aws.amazon.com/ecr/repositories/sorrentino-fargate-fhir-demo-repo |
| ALB | https://console.aws.amazon.com/ec2/v2/home#LoadBalancers |

---

## Summary

| Step | Trigger | Runs | Duration | Outcome |
|------|---------|------|----------|---------|
| Test | push or PR | always | 1–2 min | ✓ pass = build, ✗ fail = stop |
| Build | push only | if test passes | 3–5 min | ✓ success = image in ECR, ✗ fail = stop |
| Deploy | push only | if build succeeds | 2–5 min | ✓ success = new container running, ✗ fail = check logs |

Total pipeline time: **~6–12 minutes** from commit to production.
