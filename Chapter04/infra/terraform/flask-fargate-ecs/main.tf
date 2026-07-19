# ─────────────────────────────────────────────────────────────────────────────
# Data sources
# ─────────────────────────────────────────────────────────────────────────────
data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ecs_task_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "github_oidc_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Locals
# ─────────────────────────────────────────────────────────────────────────────
locals {
  app_name         = "${var.name_prefix}-api"
  ecr_repo_name    = "${var.name_prefix}-repo"
  ecs_cluster_name = "${var.name_prefix}-cluster"
  ecs_service_name = "${var.name_prefix}-service"
  ecs_family_name  = "${var.name_prefix}-task"

  effective_container_environment = merge(
    var.container_environment,
    var.enable_claims_pipeline ? {
      CLAIMS_PIPELINE_STATE_MACHINE_ARN = aws_sfn_state_machine.claims_pipeline[0].arn
    } : {}
  )

  container_environment_list = [
    for k, v in local.effective_container_environment : { name = k, value = v }
  ]

  container_secrets_list = [
    for k, v in var.container_secrets : { name = k, valueFrom = v }
  ]
}

# ─────────────────────────────────────────────────────────────────────────────
# ECR
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_ecr_repository" "app" {
  name                 = local.ecr_repo_name
  image_tag_mutability = var.ecr_image_tag_mutability

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch Logs
# ─────────────────────────────────────────────────────────────────────────────

# Container stdout/stderr — every Flask log line lands here
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.app_name}"
  retention_in_days = 30
}

# ECS lifecycle events (PROVISIONING → PENDING → RUNNING → STOPPED)
# Written by EventBridge; captures each bootup step at the control-plane level
resource "aws_cloudwatch_log_group" "ecs_events" {
  name              = "/ecs/${local.app_name}/events"
  retention_in_days = 30
}

# Allow EventBridge to deliver events into the lifecycle log group
resource "aws_cloudwatch_log_resource_policy" "eventbridge_ecs" {
  policy_name = "${var.name_prefix}-eventbridge-ecs-log-policy"

  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EventBridgeToCloudWatchLogs"
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.ecs_events.arn}:*"
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# EventBridge — ECS bootup / lifecycle events → CloudWatch Logs
# ─────────────────────────────────────────────────────────────────────────────

# Step 1 – Task state changes: PROVISIONING → PENDING → RUNNING / STOPPED
resource "aws_cloudwatch_event_rule" "ecs_task_state" {
  name        = "${var.name_prefix}-ecs-task-state"
  description = "Log every ECS task lifecycle state change (bootup and shutdown)"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.app.arn]
    }
  })
}

resource "aws_cloudwatch_event_target" "ecs_task_state_to_cw" {
  rule      = aws_cloudwatch_event_rule.ecs_task_state.name
  target_id = "ECSTaskStateToCloudWatch"
  arn       = aws_cloudwatch_log_group.ecs_events.arn
}

# Step 2 – Deployment state changes: IN_PROGRESS → COMPLETED / FAILED
resource "aws_cloudwatch_event_rule" "ecs_deployment" {
  name        = "${var.name_prefix}-ecs-deployment"
  description = "Log ECS service deployment lifecycle (boot initiated, completed, failed)"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    "detail-type" = ["ECS Deployment State Change"]
  })
}

resource "aws_cloudwatch_event_target" "ecs_deployment_to_cw" {
  rule      = aws_cloudwatch_event_rule.ecs_deployment.name
  target_id = "ECSDeploymentToCloudWatch"
  arn       = aws_cloudwatch_log_group.ecs_events.arn
}

# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch — Metric filters on container log group
# ─────────────────────────────────────────────────────────────────────────────

# Detects Python errors / tracebacks emitted during Flask startup
resource "aws_cloudwatch_log_metric_filter" "startup_errors" {
  name           = "${var.name_prefix}-startup-errors"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "?ERROR ?Exception ?Traceback ?CRITICAL"

  metric_transformation {
    name          = "StartupErrorCount"
    namespace     = "${var.name_prefix}/ECS"
    value         = "1"
    default_value = "0"
  }
}

# Counts successful ALB health-check responses — confirms the app is up
resource "aws_cloudwatch_log_metric_filter" "health_check_ok" {
  name           = "${var.name_prefix}-healthcheck-ok"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "GET /health 200"

  metric_transformation {
    name          = "HealthCheckOK"
    namespace     = "${var.name_prefix}/ECS"
    value         = "1"
    default_value = "0"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch — Alarms for bootup failures
# ─────────────────────────────────────────────────────────────────────────────

# Fires when any ERROR / Exception / CRITICAL line appears in the container log
resource "aws_cloudwatch_metric_alarm" "startup_errors" {
  alarm_name          = "${var.name_prefix}-startup-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "StartupErrorCount"
  namespace           = "${var.name_prefix}/ECS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "ERROR / Exception / CRITICAL detected in container log — probable startup failure"
  treat_missing_data  = "notBreaching"
}

# Fires when the running task count drops to zero — crash loop or failed boot
resource "aws_cloudwatch_metric_alarm" "task_running_zero" {
  alarm_name          = "${var.name_prefix}-task-running-zero"
  comparison_operator = "LessThanOrEqualToThreshold"
  evaluation_periods  = 1
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"

  dimensions = {
    ClusterName = aws_ecs_cluster.app.name
    ServiceName = local.ecs_service_name
  }

  period             = 60
  statistic          = "Minimum"
  threshold          = 0
  alarm_description  = "Running task count is zero — the container failed to boot or crashed"
  treat_missing_data = "breaching"
}

# ─────────────────────────────────────────────────────────────────────────────
# ECS Cluster
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_ecs_cluster" "app" {
  name = local.ecs_cluster_name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# IAM — ECS Task Execution Role (pull image, write logs)
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "ecs_task_execution" {
  name               = "${var.name_prefix}-ecs-exec-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_default" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow execution role to read SSM / Secrets Manager values injected as secrets
resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  count = length(var.container_secrets) > 0 ? 1 : 0

  name = "${var.name_prefix}-ecs-exec-secrets"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameters", "secretsmanager:GetSecretValue", "kms:Decrypt"]
        Resource = "*"
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# IAM — ECS Task Role (application runtime permissions)
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "ecs_task" {
  name               = "${var.name_prefix}-ecs-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

resource "aws_iam_role_policy" "ecs_task_app" {
  name = "${var.name_prefix}-ecs-task-policy"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:CreateTable",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:ListTables",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:UpdateItem"
        ]
        Resource = "*"
      },
      {
        Sid    = "SecretsAccess"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "secretsmanager:GetSecretValue",
          "kms:Decrypt"
        ]
        Resource = "*"
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# Security Groups
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb-sg"
  description = "Allow inbound HTTP to the Application Load Balancer"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP from internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.alb_ingress_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs_service" {
  name        = "${var.name_prefix}-svc-sg"
  description = "Allow container port traffic from the ALB only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Container port from ALB"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Application Load Balancer
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_lb" "app" {
  name               = substr(replace("${var.name_prefix}-alb", "_", "-"), 0, 32)
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
}

resource "aws_lb_target_group" "app" {
  name        = substr(replace("${var.name_prefix}-tg", "_", "-"), 0, 32)
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    path                = var.health_check_path
    matcher             = "200-399"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# ECS Task Definition
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_ecs_task_definition" "app" {
  family                   = local.ecs_family_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.ecs_task_cpu)
  memory                   = tostring(var.ecs_task_memory)
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = local.app_name
      image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
        }
      ]

      environment = local.container_environment_list
      secrets     = local.container_secrets_list

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

# ─────────────────────────────────────────────────────────────────────────────
# ECS Service
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_ecs_service" "app" {
  name            = local.ecs_service_name
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs_service.id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = local.app_name
    container_port   = var.container_port
  }

  depends_on = [aws_lb_listener.http]

  lifecycle {
    # GitHub Actions updates task_definition; prevent Terraform drift on deploy
    ignore_changes = [task_definition]
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# GitHub Actions OIDC — keyless authentication for CI/CD
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  # GitHub's current OIDC thumbprint — verify at https://token.actions.githubusercontent.com/.well-known/openid-configuration
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name               = "${var.name_prefix}-github-actions-role"
  assume_role_policy = data.aws_iam_policy_document.github_oidc_assume.json
}

resource "aws_iam_role_policy" "github_actions" {
  name = "${var.name_prefix}-github-actions-policy"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRAuth"
        Effect = "Allow"
        Action = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "ECRPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:CompleteLayerUpload",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
          "ecr:BatchGetImage"
        ]
        Resource = aws_ecr_repository.app.arn
      },
      {
        Sid    = "ECSDescribe"
        Effect = "Allow"
        Action = [
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:RegisterTaskDefinition",
          "ecs:UpdateService"
        ]
        Resource = "*"
      },
      {
        Sid    = "PassTaskRoles"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          aws_iam_role.ecs_task_execution.arn,
          aws_iam_role.ecs_task.arn
        ]
      }
    ]
  })
}
