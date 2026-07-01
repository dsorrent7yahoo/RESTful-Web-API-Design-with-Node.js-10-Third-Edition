variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Prefix applied to every named resource"
  type        = string
  default     = "chapter04-ec2"
}

variable "instance_type" {
  description = "EC2 instance type (t3.medium = 2 vCPU / 4 GB, sufficient for 6 Docker containers)"
  type        = string
  default     = "t3.medium"
}

variable "key_pair_name" {
  description = "Name of an existing EC2 key pair in your account (for SSH access)"
  type        = string
}

variable "allowed_ssh_cidr" {
  description = "CIDR block permitted to SSH into the instance — restrict to your IP in production"
  type        = string
  default     = "0.0.0.0/0"
}

variable "dynamodb_table_name" {
  description = "DynamoDB table the backends will read/write"
  type        = string
  default     = "medications"
}

variable "github_repo_url" {
  description = "Git repo to clone during EC2 bootstrap"
  type        = string
  default     = "https://github.com/PacktPublishing/RESTful-Web-API-Design-with-Node.js-10-Third-Edition.git"
}

variable "github_branch" {
  description = "Branch to check out"
  type        = string
  default     = "django"
}

variable "jwt_secret" {
  description = "JWT secret injected into all three backends via .env"
  type        = string
  sensitive   = true
  default     = "healthcare-ec2-dev-secret"
}
