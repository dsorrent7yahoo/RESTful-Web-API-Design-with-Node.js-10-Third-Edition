terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

# ── Elevated provider for IAM operations ─────────────────────────────────────
# Creating IAM policies and attaching them to users requires admin or root
# credentials.  Configure a separate AWS CLI profile with those privileges
# (e.g., "admin" or "root") and set iam_admin_profile in terraform.tfvars.
#
# If you run Terraform as an IAM admin already, set both variables to the
# same profile and Terraform will use one provider for everything.
provider "aws" {
  alias   = "iam_admin"
  region  = var.aws_region
  profile = var.iam_admin_profile
}

# ── These providers are configured after the cluster exists ──────────────────
# Run `terraform apply -target=module.eks` first, then a second apply for helm.
data "aws_eks_cluster" "main" {
  name       = module.eks.cluster_name
  depends_on = [module.eks]
}

data "aws_eks_cluster_auth" "main" {
  name       = module.eks.cluster_name
  depends_on = [module.eks]
}

provider "kubernetes" {
  host                   = data.aws_eks_cluster.main.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.main.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.main.token
}

provider "helm" {
  kubernetes {
    host                   = data.aws_eks_cluster.main.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.main.certificate_authority[0].data)
    token                  = data.aws_eks_cluster_auth.main.token
  }
}
