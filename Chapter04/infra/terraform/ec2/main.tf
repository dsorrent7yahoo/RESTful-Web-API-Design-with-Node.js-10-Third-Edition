# ── Data sources ──────────────────────────────────────────────────────────────

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Latest Amazon Linux 2023 x86_64
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ── IAM role for the EC2 instance (allows IMDS credentials for all backends) ──

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "${var.name_prefix}-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
  tags               = local.tags
}

# DynamoDB — all three backends read/write medications
resource "aws_iam_role_policy_attachment" "dynamodb" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess"
}

# S3 — Flask S3 export feature
resource "aws_iam_role_policy_attachment" "s3" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
}

# Glue — Flask Glue catalog registration
resource "aws_iam_role_policy_attachment" "glue" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AWSGlueConsoleFullAccess"
}

# Athena — Flask Athena query feature
resource "aws_iam_role_policy_attachment" "athena" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonAthenaFullAccess"
}

# SQS — Django SQS monitor
resource "aws_iam_role_policy_attachment" "sqs" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSQSFullAccess"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.name_prefix}-profile"
  role = aws_iam_role.ec2.name
}

# ── Security group ────────────────────────────────────────────────────────────

resource "aws_security_group" "ec2" {
  name        = "${var.name_prefix}-sg"
  description = "Healthcare demo EC2 - web ports + SSH + API Gateway"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  # Landing page
  ingress {
    description = "Landing page (port 80)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Flask — full-stack (backend + React frontend bundled)
  ingress {
    description = "Flask full-stack (port 4001)"
    from_port   = 4001
    to_port     = 4001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Node.js React frontend
  ingress {
    description = "Node.js frontend (port 3002)"
    from_port   = 3002
    to_port     = 3002
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Node.js backend
  ingress {
    description = "Node.js backend API (port 4003)"
    from_port   = 4003
    to_port     = 4003
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Django React frontend
  ingress {
    description = "Django frontend (port 3003)"
    from_port   = 3003
    to_port     = 3003
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Django TypeScript frontend
  ingress {
    description = "Django TypeScript frontend (port 3005)"
    from_port   = 3005
    to_port     = 3005
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Django backend
  ingress {
    description = "Django backend API (port 4002)"
    from_port   = 4002
    to_port     = 4002
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # API Gateway — single authenticated entry point
  ingress {
    description = "API Gateway (port 8080)"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Microservices (ports 4010-4015)
  ingress {
    description = "Microservices glue/claims/cleaner/sqs/athena/patients (4010-4015)"
    from_port   = 4010
    to_port     = 4015
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${var.name_prefix}-sg" })
}

# ── Elastic IP — stable address that survives stop/start ─────────────────────

resource "aws_eip" "ec2" {
  domain = "vpc"
  tags   = merge(local.tags, { Name = "${var.name_prefix}-eip" })

  # Associate after instance is created
  depends_on = [aws_instance.ec2]
}

resource "aws_eip_association" "ec2" {
  instance_id   = aws_instance.ec2.id
  allocation_id = aws_eip.ec2.id
}

# ── EC2 instance ──────────────────────────────────────────────────────────────

locals {
  tags = {
    Project   = var.name_prefix
    ManagedBy = "terraform"
  }
}

resource "aws_instance" "ec2" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  key_name               = var.key_pair_name
  subnet_id              = data.aws_subnets.public.ids[0]
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  root_block_device {
    volume_size = 30   # GB — enough for Docker images
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = templatefile("${path.module}/userdata.sh.tpl", {
    github_repo_url = var.github_repo_url
    github_branch   = var.github_branch
    jwt_secret      = var.jwt_secret
    aws_region      = var.aws_region
  })

  tags = merge(local.tags, { Name = var.name_prefix })
}
