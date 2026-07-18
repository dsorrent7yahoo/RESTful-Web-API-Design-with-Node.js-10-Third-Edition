# ─────────────────────────────────────────────────────────────────────────────
# Current caller identity — used to grant the operator EKS access
# ─────────────────────────────────────────────────────────────────────────────
data "aws_caller_identity" "current" {}

locals {
  cluster_name = "${var.name_prefix}-eks"
  namespace    = "healthcare"

  # Determine whether the caller is an IAM user (vs. an assumed role / SSO).
  # ARN formats:
  #   IAM user  → arn:aws:iam::ACCOUNT:user/USERNAME
  #   Assumed   → arn:aws:sts::ACCOUNT:assumed-role/ROLE/SESSION
  caller_arn  = data.aws_caller_identity.current.arn
  is_iam_user = can(regex(":user/", local.caller_arn))
  iam_username = local.is_iam_user ? element(split("/", local.caller_arn), length(split("/", local.caller_arn)) - 1) : ""

  # One ECR repo per service — names match the Docker image names
  services = [
    "glue-catalog",
    "claims-generator",
    "claims-cleaner",
    "sqs-monitor",
    "athena-client",
    "patients-encounters",
    "flask-backend",   # Flask DynamoDB app (migrated from ECS Fargate)
  ]
}

# ─────────────────────────────────────────────────────────────────────────────
# EKS Cluster — Fargate serverless (no EC2 nodes to manage or pay for at idle)
# ─────────────────────────────────────────────────────────────────────────────
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = local.cluster_name
  cluster_version = var.cluster_version

  # Allow kubectl from wherever Terraform is running (tighten in prod)
  cluster_endpoint_public_access = true

  # Automatically grant the IAM entity running Terraform full admin access
  # to the cluster — no manual aws-auth ConfigMap editing required.
  enable_cluster_creator_admin_permissions = true

  vpc_id     = var.vpc_id
  subnet_ids = var.private_subnet_ids

  # Add-ons — drop aws-ebs-csi-driver (EBS volumes are not supported on Fargate)
  cluster_addons = {
    coredns    = { most_recent = true }
    kube-proxy = { most_recent = true }
    vpc-cni    = { most_recent = true }
  }

  # ── Fargate profiles ──────────────────────────────────────────────────────
  # Each Fargate profile selects pods by namespace (and optional labels).
  # The module creates a pod execution role automatically; we add ECR read
  # access so nodes can pull images from our private ECR repositories.
  fargate_profile_defaults = {
    iam_role_additional_policies = {
      ecr_readonly = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
    }
  }

  fargate_profiles = {
    # kube-system — CoreDNS and AWS Load Balancer Controller run here
    kube_system = {
      name = "kube-system"
      selectors = [
        { namespace = "kube-system" }
      ]
    }
    # healthcare — all 6 microservices
    healthcare = {
      name = "healthcare"
      selectors = [
        { namespace = "healthcare" }
      ]
    }
  }

  tags = var.tags
}

# CoreDNS ships with an annotation that forces it onto EC2 nodes.
# Patch it to run on Fargate after the cluster is ready.
resource "kubernetes_annotations" "coredns_fargate" {
  api_version = "apps/v1"
  kind        = "Deployment"
  metadata {
    name      = "coredns"
    namespace = "kube-system"
  }
  template_annotations = {
    "eks.amazonaws.com/compute-type" = "fargate"
  }
  force      = true
  depends_on = [module.eks]
}

# ─────────────────────────────────────────────────────────────────────────────
# IAM permissions for the current user to operate EKS
#
# Two layers are required:
#   1. AWS IAM  — allows the user to call EKS API endpoints (describe cluster,
#                 update kubeconfig, manage node groups, etc.)
#   2. K8s RBAC — handled above by enable_cluster_creator_admin_permissions,
#                 which grants the Terraform caller cluster-admin automatically.
# ─────────────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "eks_admin" {
  # Full EKS control-plane operations
  statement {
    sid    = "EKSFullAccess"
    effect = "Allow"
    actions = [
      "eks:*",
    ]
    resources = ["*"]
  }

  # EC2 / networking reads needed by eksctl and kubectl credential helpers
  statement {
    sid    = "EC2NetworkingReads"
    effect = "Allow"
    actions = [
      "ec2:DescribeInstances",
      "ec2:DescribeSubnets",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeVpcs",
      "ec2:DescribeAvailabilityZones",
    ]
    resources = ["*"]
  }

  # IAM reads — needed to inspect node-role / IRSA role bindings
  statement {
    sid    = "IAMReads"
    effect = "Allow"
    actions = [
      "iam:GetRole",
      "iam:ListRoles",
      "iam:ListAttachedRolePolicies",
    ]
    resources = ["*"]
  }

  # CloudFormation — used by eksctl under the hood
  statement {
    sid    = "CloudFormationReads"
    effect = "Allow"
    actions = [
      "cloudformation:DescribeStacks",
      "cloudformation:ListStacks",
    ]
    resources = ["*"]
  }

  # SSM — used by AWS CLI to fetch kubeconfig token
  statement {
    sid    = "SSMTokenAccess"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
    ]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter/aws/service/eks/*",
    ]
  }
}

resource "aws_iam_policy" "eks_admin" {
  provider    = aws.iam_admin
  name        = "${local.cluster_name}-eks-admin-policy"
  description = "Allows the operator IAM user to manage the ${local.cluster_name} EKS cluster"
  policy      = data.aws_iam_policy_document.eks_admin.json
  tags        = var.tags
}

# Attach to the current IAM user when running as a user (not a role).
# If you use an assumed role / SSO, attach eks_admin_policy to that role manually
# or add an access_entries block above in module "eks".
resource "aws_iam_user_policy_attachment" "eks_admin" {
  provider   = aws.iam_admin
  count      = local.is_iam_user ? 1 : 0
  user       = local.iam_username
  policy_arn = aws_iam_policy.eks_admin.arn
}

# ─────────────────────────────────────────────────────────────────────────────
# ECR Repositories — one per microservice
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_ecr_repository" "services" {
  for_each = toset(local.services)

  name                 = "${var.name_prefix}-${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "services" {
  for_each   = aws_ecr_repository.services
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# IRSA — IAM role for microservice pods
# All 6 services share one role (they need the same AWS permissions).
# The role is bound to the "microservices-sa" ServiceAccount in k8s.
# ─────────────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "microservices_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:${local.namespace}:microservices-sa"]
    }
  }
}

resource "aws_iam_role" "microservices" {
  provider           = aws.iam_admin
  name               = "${local.cluster_name}-microservices-irsa"
  assume_role_policy = data.aws_iam_policy_document.microservices_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "microservices_permissions" {
  # S3 — staging bucket
  statement {
    sid     = "S3StagingBucket"
    actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [
      "arn:aws:s3:::dgs-glue-staging",
      "arn:aws:s3:::dgs-glue-staging/*",
    ]
  }

  # Glue — catalog operations
  statement {
    sid = "GlueCatalog"
    actions = [
      "glue:GetDatabase", "glue:GetTable", "glue:GetTables",
      "glue:CreateTable", "glue:UpdateTable", "glue:DeleteTable",
      "glue:GetPartitions",
    ]
    resources = [
      "arn:aws:glue:${var.aws_region}:${var.aws_account_id}:catalog",
      "arn:aws:glue:${var.aws_region}:${var.aws_account_id}:database/fhir-table-db",
      "arn:aws:glue:${var.aws_region}:${var.aws_account_id}:table/fhir-table-db/*",
    ]
  }

  # Athena — query execution
  statement {
    sid = "AthenaQueryExecution"
    actions = [
      "athena:StartQueryExecution", "athena:StopQueryExecution",
      "athena:GetQueryExecution", "athena:GetQueryResults",
      "athena:GetWorkGroup", "athena:ListDatabases", "athena:ListTableMetadata",
      "athena:GetTableMetadata",
    ]
    resources = ["*"]
  }

  # SQS — FHIR results queue + DLQ
  statement {
    sid = "SQSQueues"
    actions = [
      "sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage",
      "sqs:GetQueueAttributes", "sqs:GetQueueUrl",
    ]
    resources = [
      "arn:aws:sqs:${var.aws_region}:${var.aws_account_id}:dgs-fhir-lambda-results",
      "arn:aws:sqs:${var.aws_region}:${var.aws_account_id}:dgs-fhir-lambda-results-dlq",
    ]
  }

  # DynamoDB — email log table
  statement {
    sid     = "DynamoDBEmailLog"
    actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:Scan"]
    resources = [
      "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/dgs-sqs-email-log",
    ]
  }

  # Bedrock — model inference (athena_client SQL generation)
  statement {
    sid       = "BedrockInference"
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:${var.aws_region}::foundation-model/*"]
  }
}

resource "aws_iam_policy" "microservices" {
  provider = aws.iam_admin
  name     = "${local.cluster_name}-microservices-policy"
  policy   = data.aws_iam_policy_document.microservices_permissions.json
  tags     = var.tags
}

resource "aws_iam_role_policy_attachment" "microservices" {
  provider   = aws.iam_admin
  role       = aws_iam_role.microservices.name
  policy_arn = aws_iam_policy.microservices.arn
}

# ─────────────────────────────────────────────────────────────────────────────
# AWS Load Balancer Controller — IAM role + Helm install
# ─────────────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "alb_controller_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:kube-system:aws-load-balancer-controller"]
    }
  }
}

resource "aws_iam_role" "alb_controller" {
  provider           = aws.iam_admin
  name               = "${local.cluster_name}-alb-controller"
  assume_role_policy = data.aws_iam_policy_document.alb_controller_assume.json
  tags               = var.tags
}

# The official AWS LBC IAM policy (fetched from AWS docs)
resource "aws_iam_policy" "alb_controller" {
  provider = aws.iam_admin
  name     = "${local.cluster_name}-alb-controller-policy"
  policy   = file("${path.module}/alb-controller-iam-policy.json")
  tags     = var.tags
}

resource "aws_iam_role_policy_attachment" "alb_controller" {
  provider   = aws.iam_admin
  role       = aws_iam_role.alb_controller.name
  policy_arn = aws_iam_policy.alb_controller.arn
}

resource "helm_release" "alb_controller" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  namespace  = "kube-system"
  version    = "1.8.1"

  set {
    name  = "clusterName"
    value = local.cluster_name
  }
  set {
    name  = "serviceAccount.create"
    value = "true"
  }
  set {
    name  = "serviceAccount.name"
    value = "aws-load-balancer-controller"
  }
  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = aws_iam_role.alb_controller.arn
  }
  set {
    name  = "vpcId"
    value = var.vpc_id
  }
  set {
    name  = "region"
    value = var.aws_region
  }

  depends_on = [module.eks, aws_iam_role_policy_attachment.alb_controller]
}
