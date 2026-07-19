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

output "cloudwatch_log_group_app" {
  description = "CloudWatch log group for container stdout/stderr (Flask application logs)"
  value       = aws_cloudwatch_log_group.app.name
}

output "cloudwatch_log_group_events" {
  description = "CloudWatch log group for ECS lifecycle events (bootup steps, deployment state)"
  value       = aws_cloudwatch_log_group.ecs_events.name
}

output "cloudwatch_alarm_startup_errors" {
  description = "CloudWatch alarm name — triggers on ERROR/Exception/CRITICAL in container logs"
  value       = aws_cloudwatch_metric_alarm.startup_errors.alarm_name
}

output "cloudwatch_alarm_task_running_zero" {
  description = "CloudWatch alarm name — triggers when running task count drops to zero"
  value       = aws_cloudwatch_metric_alarm.task_running_zero.alarm_name
}

output "claims_pipeline_state_machine_arn" {
  description = "Step Functions state machine ARN for claims pipeline (null when disabled)"
  value       = try(aws_sfn_state_machine.claims_pipeline[0].arn, null)
}

output "claims_pipeline_log_group" {
  description = "CloudWatch log group for claims pipeline Step Functions execution logs (null when disabled)"
  value       = try(aws_cloudwatch_log_group.claims_pipeline_sfn[0].name, null)
}
