# Claims Pipeline (Step Functions + Lambda)

This pipeline runs 4 steps in order:

1. `synthetic_fhir_claims`
2. `claims_cleaner`
3. `claims_store_manifest`
4. `claims_forecast`

Forecast step produces per-provider monthly claim predictions through `2027-12-31`.

## Files added

- `flask-dynamo-db-backend/lambdas/claims_store_manifest.py`
- `flask-dynamo-db-backend/lambdas/claims_forecast.py`
- `flask-dynamo-db-backend/stepfunctions/claims_pipeline.asl.json`
- `infra/terraform/flask-fargate-ecs/claims_pipeline.asl.json`
- `infra/terraform/flask-fargate-ecs/claims_pipeline_stepfunctions.tf`
- `flask-dynamo-db-backend/routes/claims_pipeline.py`

## Backend API endpoints

All endpoints require JWT auth.

- `POST /claims/pipeline/start`
  - Starts a Step Functions execution using `CLAIMS_PIPELINE_STATE_MACHINE_ARN`.
- `GET /claims/pipeline/status?executionArn=...`
  - Returns execution status and output.
- `GET /claims/pipeline/history?executionArn=...`
  - Returns execution history events suitable for progress UI.
- `GET /claims/pipeline/executions`
  - Lists recent executions.
- `GET /claims/pipeline/cloudwatch?logGroup=...`
  - Reads CloudWatch log events (for progress/details).
- `POST /claims/pipeline/run-local`
  - Runs all 4 lambda modules in process for backend-side testing.
- `GET /claims/pipeline/forecast?key=...`
  - Returns forecast JSON payload from S3. If no key is provided, returns latest result.

## Terraform configuration

Set these in `terraform.tfvars`:

- `enable_claims_pipeline = true`
- `generate_lambda_arn`
- `clean_lambda_arn`
- `store_manifest_lambda_arn`
- `forecast_lambda_arn`

Then apply Terraform from `infra/terraform/flask-fargate-ecs`.

The ECS container gets `CLAIMS_PIPELINE_STATE_MACHINE_ARN` injected automatically when pipeline creation is enabled.

## Output artifact format

`claims_forecast` writes JSON to:

- `s3://<bucket>/claims-forecast/claims-forecast-<timestamp>.json`

Top-level fields include:

- `providers[]`
- `providers[].history[]` with monthly `claim_count`
- `providers[].forecast[]` with monthly `predicted_claims`
- `providers[].regression` with `slope`, `intercept`, and `r2`

This is the payload the frontend can use to draw one line chart per provider.
