variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Prefix for named resources"
  type        = string
  default     = "chapter04-flask"
}

variable "github_connection_arn" {
  description = "CodeStar connection ARN for GitHub source"
  type        = string
}

variable "github_full_repository_id" {
  description = "GitHub owner/repository"
  type        = string
}

variable "github_branch" {
  description = "GitHub branch for pipeline source"
  type        = string
  default     = "master"
}

variable "vpc_id" {
  description = "VPC id for ALB and ECS service"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets for ALB"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnets for ECS tasks"
  type        = list(string)
}

variable "alb_ingress_cidr_blocks" {
  description = "CIDRs allowed to reach ALB"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "container_port" {
  description = "Container listening port"
  type        = number
  default     = 4001
}

variable "ecs_task_cpu" {
  description = "Fargate task CPU units"
  type        = number
  default     = 512
}

variable "ecs_task_memory" {
  description = "Fargate task memory in MiB"
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Desired ECS service task count"
  type        = number
  default     = 1
}

variable "health_check_path" {
  description = "ALB target group health check path"
  type        = string
  default     = "/health"
}

variable "buildspec_path" {
  description = "Path to buildspec in repository"
  type        = string
  default     = "flask-dynamo-db-backend/buildspec.yml"
}

variable "container_environment" {
  description = "Non-sensitive env vars for task container"
  type        = map(string)
  default = {
    PORT                   = "4001"
    AWS_REGION             = "us-east-1"
    DYNAMODB_TABLE         = "medications"
    AUTO_CREATE_CSV_TABLES = "true"
  }
}

variable "container_secrets" {
  description = "Map of env var name -> Secrets Manager or SSM parameter ARN"
  type        = map(string)
  default     = {}
}

variable "ecr_image_tag_mutability" {
  description = "ECR tag mutability"
  type        = string
  default     = "MUTABLE"
}
