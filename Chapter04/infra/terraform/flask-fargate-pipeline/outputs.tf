output "alb_dns_name" {
  description = "Public DNS for the Flask API load balancer"
  value       = aws_lb.app.dns_name
}

output "pipeline_name" {
  description = "CodePipeline name"
  value       = aws_codepipeline.app.name
}

output "ecr_repository_url" {
  description = "ECR repository URL used by CodeBuild and ECS"
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.app.name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.app.name
}
