variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile used for EKS, ECR, and general resources"
  type        = string
  default     = "default"
}

variable "iam_admin_profile" {
  description = <<-EOT
    AWS CLI profile that has IAM admin (or root) privileges.
    Required to create IAM policies and attach them to users/roles.
    If your default profile already has IAM admin rights, set this to
    the same value as aws_profile.
  EOT
  type    = string
  default = "default"
}

variable "name_prefix" {
  description = "Prefix applied to every named resource"
  type        = string
  default     = "healthcare-fhir"
}

variable "cluster_version" {
  description = "Kubernetes version for the EKS cluster"
  type        = string
  default     = "1.31"
}

# ── Networking ────────────────────────────────────────────────────────────────
variable "vpc_id" {
  description = "VPC where the EKS cluster and ALB will be created"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for EKS nodes and pods"
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Public subnets for the ALB (must have tag kubernetes.io/role/elb=1)"
  type        = list(string)
}

# ── Nodes ─────────────────────────────────────────────────────────────────────
# Fargate is serverless — no EC2 instance types or node counts to manage.
# Pod CPU/memory limits are set in k8s/overlays/eks/patch-resources.yaml.
# Fargate bills per vCPU-second and GB-second actually consumed by each pod.

# ── Application ───────────────────────────────────────────────────────────────
variable "aws_account_id" {
  description = "AWS account ID — used to build ECR repo URIs"
  type        = string
  default     = "005905648819"
}

variable "jwt_secret" {
  description = "JWT secret injected into microservice pods via Kubernetes Secret"
  type        = string
  sensitive   = true
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default = {
    Project   = "healthcare-fhir"
    ManagedBy = "terraform"
  }
}
