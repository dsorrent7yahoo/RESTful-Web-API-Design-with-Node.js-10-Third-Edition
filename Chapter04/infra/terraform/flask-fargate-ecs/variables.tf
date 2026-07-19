variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Prefix applied to every named resource"
  type        = string
  default     = "sorrentino-fargate-fhir-demo"
}

# ── Networking ────────────────────────────────────────────────────────────────
variable "vpc_id" {
  description = "VPC id for the ALB and ECS service"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets for the Application Load Balancer"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnets for ECS Fargate tasks"
  type        = list(string)
}

variable "alb_ingress_cidr_blocks" {
  description = "CIDR blocks allowed to reach the ALB on port 80"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# ── Container ─────────────────────────────────────────────────────────────────
variable "container_port" {
  description = "Port the Flask application listens on inside the container"
  type        = number
  default     = 4001
}

variable "health_check_path" {
  description = "ALB target group health-check path"
  type        = string
  default     = "/health"
}

variable "container_environment" {
  description = "Plain-text environment variables injected into the container"
  type        = map(string)
  default = {
    PORT                   = "4001"
    AWS_REGION             = "us-east-1"
    DYNAMODB_TABLE         = "medications"
    AUTO_CREATE_CSV_TABLES = "true"
    JWT_EXP_MINUTES        = "60"
  }
}

variable "container_secrets" {
  description = "Secrets injected from SSM Parameter Store or Secrets Manager (map of name -> ARN)"
  type        = map(string)
  default     = {}
  sensitive   = true
}

# ── ECS / Fargate ─────────────────────────────────────────────────────────────
variable "ecs_task_cpu" {
  description = "Fargate task vCPU units (256 | 512 | 1024 | 2048 | 4096)"
  type        = number
  default     = 512
}

variable "ecs_task_memory" {
  description = "Fargate task memory in MiB"
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of ECS task replicas to maintain"
  type        = number
  default     = 1
}

# ── ECR ───────────────────────────────────────────────────────────────────────
variable "ecr_image_tag_mutability" {
  description = "ECR image tag mutability (MUTABLE or IMMUTABLE)"
  type        = string
  default     = "MUTABLE"

  validation {
    condition     = contains(["MUTABLE", "IMMUTABLE"], var.ecr_image_tag_mutability)
    error_message = "Must be MUTABLE or IMMUTABLE."
  }
}

variable "image_tag" {
  description = "Initial ECR image tag used in the Terraform-managed task definition"
  type        = string
  default     = "latest"
}

# ── GitHub Actions OIDC ───────────────────────────────────────────────────────
variable "github_repository" {
  description = "GitHub repository in owner/repo format (used to scope the OIDC trust policy)"
  type        = string
}

variable "github_branch" {
  description = "Branch that is allowed to assume the GitHub Actions IAM role"
  type        = string
  default     = "master"
}

variable "assign_public_ip" {
  description = "Assign a public IP to ECS tasks (required when using public subnets without a NAT gateway)"
  type        = bool
  default     = false
}

variable "enable_claims_pipeline" {
  description = "Create a Step Functions claims pipeline and wire its ARN into the ECS container environment"
  type        = bool
  default     = false
}

variable "generate_lambda_arn" {
  description = "Lambda ARN for synthetic claims generation step"
  type        = string
  default     = ""
}

variable "clean_lambda_arn" {
  description = "Lambda ARN for claims cleaning step"
  type        = string
  default     = ""
}

variable "store_manifest_lambda_arn" {
  description = "Lambda ARN for claims manifest storage step"
  type        = string
  default     = ""
}

variable "forecast_lambda_arn" {
  description = "Lambda ARN for provider claims forecasting step"
  type        = string
  default     = ""
}
