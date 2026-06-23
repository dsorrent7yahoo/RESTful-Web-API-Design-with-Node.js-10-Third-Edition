output "alb_dns_name" {
  description = "Public DNS name of the Application Load Balancer"
  value       = aws_lb.app.dns_name
}

output "ecr_repository_url" {
  description = "ECR repository URL — set ECR_REPOSITORY in GitHub Actions to this value"
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name — set ECS_CLUSTER in the GitHub Actions workflow"
  value       = aws_ecs_cluster.app.name
}

output "ecs_service_name" {
  description = "ECS service name — set ECS_SERVICE in the GitHub Actions workflow"
  value       = aws_ecs_service.app.name
}

output "ecs_task_family" {
  description = "ECS task definition family name"
  value       = aws_ecs_task_definition.app.family
}

output "container_name" {
  description = "Container name inside the task definition — set CONTAINER_NAME in the GitHub Actions workflow"
  value       = local.app_name
}

output "github_actions_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC — store as AWS_ROLE_ARN repository secret"
  value       = aws_iam_role.github_actions.arn
}
