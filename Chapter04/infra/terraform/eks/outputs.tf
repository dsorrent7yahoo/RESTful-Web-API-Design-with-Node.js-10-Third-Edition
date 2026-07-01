output "cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "EKS API server endpoint"
  value       = module.eks.cluster_endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64-encoded CA cert for the cluster"
  value       = module.eks.cluster_certificate_authority_data
  sensitive   = true
}

output "oidc_provider_arn" {
  description = "OIDC provider ARN (needed to add more IRSA roles later)"
  value       = module.eks.oidc_provider_arn
}

output "microservices_irsa_role_arn" {
  description = "ARN of the IRSA role — paste into k8s/overlays/eks/serviceaccount.yaml"
  value       = aws_iam_role.microservices.arn
}

output "ecr_repository_urls" {
  description = "ECR image URIs — paste into k8s/overlays/eks/kustomization.yaml images section"
  value       = { for k, v in aws_ecr_repository.services : k => v.repository_url }
}

output "kubectl_config_command" {
  description = "Run this to update your local kubeconfig"
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks.cluster_name}"
}

output "caller_identity_arn" {
  description = "ARN of the IAM entity that ran Terraform (automatically granted cluster-admin)"
  value       = data.aws_caller_identity.current.arn
}

output "eks_admin_policy_arn" {
  description = "ARN of the EKS admin IAM policy created for the current user"
  value       = aws_iam_policy.eks_admin.arn
}

output "eks_admin_policy_attached_to_user" {
  description = "Whether the EKS admin policy was attached to an IAM user (false = running as assumed-role/SSO, attach manually)"
  value       = local.is_iam_user
}
