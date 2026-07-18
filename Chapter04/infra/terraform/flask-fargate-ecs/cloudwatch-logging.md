# CloudWatch Logging — Flask Fargate ECS Bootup

All resources in this document are defined in `main.tf` and outputs in `outputs.tf`.

---

## Overview

Two complementary mechanisms capture every stage of container bootup:

| Mechanism | What it captures |
|-----------|-----------------|
| **awslogs log driver** | Flask container stdout/stderr — every log line the app writes |
| **EventBridge → CloudWatch Logs** | ECS control-plane lifecycle events — task state changes and deployment state changes |

Metric filters and CloudWatch alarms sit on top of both to surface failures immediately.

---

## Bootup Steps and Where They Are Logged

```
GitHub Actions triggers deploy
        │
        ▼
1. ECS Deployment created ────────────────────► /ecs/<name>-api/events
        │                                        (EventBridge: SERVICE_DEPLOYMENT_IN_PROGRESS)
        ▼
2. Task enters PROVISIONING ──────────────────► /ecs/<name>-api/events
        │                                        (EventBridge: ECS Task State Change)
        ▼
3. Fargate pulls image from ECR
        │
        ▼
4. Task enters PENDING ───────────────────────► /ecs/<name>-api/events
        │
        ▼
5. Container starts — Flask initialises ──────► /ecs/<name>-api
        │                                        (awslogs driver: stdout/stderr)
        ▼
6. Gunicorn / Flask binds to port 4001 ───────► /ecs/<name>-api
        │
        ▼
7. Task enters RUNNING ───────────────────────► /ecs/<name>-api/events
        │
        ▼
8. ALB health check passes (GET /health 200) ─► /ecs/<name>-api
        │                                        (metric filter: HealthCheckOK)
        ▼
9. ECS Deployment COMPLETED ──────────────────► /ecs/<name>-api/events
                                                 (EventBridge: SERVICE_DEPLOYMENT_COMPLETED)
```

---

## CloudWatch Log Groups

### `/ecs/<name_prefix>-api` — Container Logs

| Attribute | Value |
|-----------|-------|
| Terraform resource | `aws_cloudwatch_log_group.app` |
| Driver | `awslogs` (injected into task definition via `logConfiguration`) |
| Stream prefix | `ecs` |
| Retention | 30 days |
| Content | Flask/Gunicorn stdout and stderr — startup messages, request logs, Python errors |

**Example log stream name:**
```
ecs/<name_prefix>-api/<task-id>
```

**Console quick-link:**
```
https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups/log-group/$252Fecs$252F<name_prefix>-api
```

---

### `/ecs/<name_prefix>-api/events` — ECS Lifecycle Events

| Attribute | Value |
|-----------|-------|
| Terraform resource | `aws_cloudwatch_log_group.ecs_events` |
| Source | Amazon EventBridge → CloudWatch Logs |
| Retention | 30 days |
| Content | JSON-formatted ECS task state changes and deployment state changes |

**Captured event types:**

| `detail-type` | `detail.lastStatus` / `eventName` | Bootup step |
|---------------|-----------------------------------|-------------|
| `ECS Task State Change` | `PROVISIONING` | Fargate allocating resources |
| `ECS Task State Change` | `PENDING` | Image being pulled |
| `ECS Task State Change` | `RUNNING` | Container is up |
| `ECS Task State Change` | `DEPROVISIONING` | Task stopping |
| `ECS Task State Change` | `STOPPED` | Task ended (check `stoppedReason`) |
| `ECS Deployment State Change` | `SERVICE_DEPLOYMENT_IN_PROGRESS` | Deploy started |
| `ECS Deployment State Change` | `SERVICE_DEPLOYMENT_COMPLETED` | Deploy succeeded |
| `ECS Deployment State Change` | `SERVICE_DEPLOYMENT_FAILED` | Deploy failed |

**Example event payload (RUNNING):**
```json
{
  "detail-type": "ECS Task State Change",
  "source": "aws.ecs",
  "detail": {
    "clusterArn": "arn:aws:ecs:us-east-1:123456789012:cluster/<name_prefix>-cluster",
    "taskArn": "arn:aws:ecs:us-east-1:...",
    "lastStatus": "RUNNING",
    "desiredStatus": "RUNNING",
    "startedAt": "2026-07-18T10:00:00.000Z",
    "pullStartedAt": "2026-07-18T09:59:45.000Z",
    "pullStoppedAt": "2026-07-18T09:59:58.000Z"
  }
}
```

---

## EventBridge Rules

### `<name_prefix>-ecs-task-state`

```hcl
resource "aws_cloudwatch_event_rule" "ecs_task_state"
```

- **Pattern:** `source = aws.ecs`, `detail-type = ECS Task State Change`, scoped to the cluster ARN
- **Target:** `/ecs/<name_prefix>-api/events`
- **Captures:** Every task transition — PROVISIONING, PENDING, RUNNING, DEPROVISIONING, STOPPED

### `<name_prefix>-ecs-deployment`

```hcl
resource "aws_cloudwatch_event_rule" "ecs_deployment"
```

- **Pattern:** `source = aws.ecs`, `detail-type = ECS Deployment State Change`
- **Target:** `/ecs/<name_prefix>-api/events`
- **Captures:** SERVICE_DEPLOYMENT_IN_PROGRESS, SERVICE_DEPLOYMENT_COMPLETED, SERVICE_DEPLOYMENT_FAILED

---

## Metric Filters

Both filters run against the container log group (`/ecs/<name_prefix>-api`).

### `StartupErrorCount` — Startup errors

```hcl
resource "aws_cloudwatch_log_metric_filter" "startup_errors"
```

| Attribute | Value |
|-----------|-------|
| Pattern | `?ERROR ?Exception ?Traceback ?CRITICAL` |
| Namespace | `<name_prefix>/ECS` |
| Metric | `StartupErrorCount` |
| Value per match | `1` |

Triggers whenever Flask, Gunicorn, or any imported library prints an error line during startup or runtime.

### `HealthCheckOK` — Health check confirmation

```hcl
resource "aws_cloudwatch_log_metric_filter" "health_check_ok"
```

| Attribute | Value |
|-----------|-------|
| Pattern | `GET /health 200` |
| Namespace | `<name_prefix>/ECS` |
| Metric | `HealthCheckOK` |
| Value per match | `1` |

Increments each time the ALB health check receives an HTTP 200 — confirms the container passed boot and is serving traffic.

---

## CloudWatch Alarms

### `<name_prefix>-startup-errors`

```hcl
resource "aws_cloudwatch_metric_alarm" "startup_errors"
```

| Attribute | Value |
|-----------|-------|
| Metric | `StartupErrorCount` in `<name_prefix>/ECS` |
| Condition | Sum > 0 over 1 × 60-second period |
| Alarm description | ERROR / Exception / CRITICAL detected in container log |
| Missing data | `notBreaching` (no data = no alarm) |

**Fires when:** A Python exception, traceback, or ERROR line appears in the Flask container log. Most likely cause is a failed import, missing environment variable, or DynamoDB connection error at startup.

---

### `<name_prefix>-task-running-zero`

```hcl
resource "aws_cloudwatch_metric_alarm" "task_running_zero"
```

| Attribute | Value |
|-----------|-------|
| Metric | `RunningTaskCount` in `ECS/ContainerInsights` |
| Dimensions | `ClusterName`, `ServiceName` |
| Condition | Minimum ≤ 0 over 1 × 60-second period |
| Alarm description | Running task count is zero — container failed to boot or crashed |
| Missing data | `breaching` (no data = alarm) |

**Fires when:** No tasks are running — typically a crash loop, an OOM kill, or a fatal startup error that caused the container to exit immediately.

> Container Insights must be enabled on the cluster (`containerInsights = "enabled"` in `aws_ecs_cluster.app`) for the `RunningTaskCount` metric to be emitted. This is already set in `main.tf`.

---

## Terraform Outputs

| Output | Description |
|--------|-------------|
| `cloudwatch_log_group_app` | Name of the container log group |
| `cloudwatch_log_group_events` | Name of the lifecycle events log group |
| `cloudwatch_alarm_startup_errors` | Name of the startup-errors alarm |
| `cloudwatch_alarm_task_running_zero` | Name of the zero-running-tasks alarm |

Retrieve after `terraform apply`:
```bash
terraform output cloudwatch_log_group_app
terraform output cloudwatch_log_group_events
terraform output cloudwatch_alarm_startup_errors
terraform output cloudwatch_alarm_task_running_zero
```

---

## Viewing Logs

### Tail container logs (AWS CLI)
```bash
aws logs tail /ecs/<name_prefix>-api \
  --follow \
  --format short \
  --region us-east-1
```

### Tail lifecycle events
```bash
aws logs tail /ecs/<name_prefix>-api/events \
  --follow \
  --format short \
  --region us-east-1
```

### Filter for STOPPED tasks with a reason
```bash
aws logs filter-log-events \
  --log-group-name /ecs/<name_prefix>-api/events \
  --filter-pattern "STOPPED" \
  --region us-east-1 \
  --query 'events[*].message' \
  --output text | python3 -m json.tool
```

### Filter startup errors in container log
```bash
aws logs filter-log-events \
  --log-group-name /ecs/<name_prefix>-api \
  --filter-pattern "?ERROR ?Exception ?Traceback ?CRITICAL" \
  --region us-east-1 \
  --query 'events[*].[timestamp,message]' \
  --output table
```

### Check alarm state
```bash
aws cloudwatch describe-alarms \
  --alarm-names "<name_prefix>-startup-errors" "<name_prefix>-task-running-zero" \
  --region us-east-1 \
  --query 'MetricAlarms[*].[AlarmName,StateValue,StateReason]' \
  --output table
```

---

## Common Bootup Failure Signals

| Symptom | Where to look | Likely cause |
|---------|--------------|--------------|
| Task keeps cycling PENDING → STOPPED | `/events` log group, `stoppedReason` field | Image pull failure, port conflict, OOM |
| `StartupErrorCount` alarm fires | Container log group, ERROR lines | Missing env var, bad DB config, import error |
| `task-running-zero` alarm fires | `/events` log group | Fatal crash at startup, health check never passing |
| Deployment stays IN_PROGRESS | `/events` log group, deployment events | Health check path returning non-2xx/3xx |
| `HealthCheckOK` metric stays at 0 | Container log group | Flask not binding to `0.0.0.0:$PORT`, wrong `health_check_path` |

---

## Resource Summary

| Terraform Resource | AWS Resource | Purpose |
|--------------------|-------------|---------|
| `aws_cloudwatch_log_group.app` | `/ecs/<name>-api` | Container stdout/stderr |
| `aws_cloudwatch_log_group.ecs_events` | `/ecs/<name>-api/events` | ECS task & deployment events |
| `aws_cloudwatch_log_resource_policy.eventbridge_ecs` | Log resource policy | Authorises EventBridge to write to events log group |
| `aws_cloudwatch_event_rule.ecs_task_state` | EventBridge rule | Forwards task state changes to events log group |
| `aws_cloudwatch_event_target.ecs_task_state_to_cw` | EventBridge target | Wires the task-state rule to the log group |
| `aws_cloudwatch_event_rule.ecs_deployment` | EventBridge rule | Forwards deployment state changes to events log group |
| `aws_cloudwatch_event_target.ecs_deployment_to_cw` | EventBridge target | Wires the deployment rule to the log group |
| `aws_cloudwatch_log_metric_filter.startup_errors` | Metric filter | Counts ERROR/Exception/CRITICAL lines |
| `aws_cloudwatch_log_metric_filter.health_check_ok` | Metric filter | Counts successful health check responses |
| `aws_cloudwatch_metric_alarm.startup_errors` | CloudWatch alarm | Alerts on any startup error |
| `aws_cloudwatch_metric_alarm.task_running_zero` | CloudWatch alarm | Alerts when no tasks are running |
