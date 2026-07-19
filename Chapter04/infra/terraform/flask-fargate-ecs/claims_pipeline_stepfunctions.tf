resource "aws_iam_role" "claims_pipeline_sfn" {
  count = var.enable_claims_pipeline ? 1 : 0

  name = "${var.name_prefix}-claims-pipeline-sfn-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "states.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "claims_pipeline_sfn" {
  count = var.enable_claims_pipeline ? 1 : 0

  name              = "/aws/vendedlogs/states/${var.name_prefix}-claims-pipeline"
  retention_in_days = 30
}

resource "aws_iam_role_policy" "claims_pipeline_sfn" {
  count = var.enable_claims_pipeline ? 1 : 0

  name = "${var.name_prefix}-claims-pipeline-sfn-policy"
  role = aws_iam_role.claims_pipeline_sfn[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "InvokeClaimsLambdas"
        Effect = "Allow"
        Action = ["lambda:InvokeFunction"]
        Resource = [
          var.generate_lambda_arn,
          var.clean_lambda_arn,
          var.store_manifest_lambda_arn,
          var.forecast_lambda_arn
        ]
      },
      {
        Sid    = "WriteStepFunctionLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_sfn_state_machine" "claims_pipeline" {
  count = var.enable_claims_pipeline ? 1 : 0

  name     = "${var.name_prefix}-claims-pipeline"
  role_arn = aws_iam_role.claims_pipeline_sfn[0].arn

  definition = templatefile("${path.module}/claims_pipeline.asl.json", {
    generate_lambda_arn       = var.generate_lambda_arn
    clean_lambda_arn          = var.clean_lambda_arn
    store_manifest_lambda_arn = var.store_manifest_lambda_arn
    forecast_lambda_arn       = var.forecast_lambda_arn
  })

  logging_configuration {
    include_execution_data = true
    level                  = "ALL"

    log_destination = "${aws_cloudwatch_log_group.claims_pipeline_sfn[0].arn}:*"
  }
}
