# Flask DynamoDB Backend

Python/Flask port of the existing `dynamo-db-backend` in Chapter04.

It reuses:
- `../dynamo-db-backend/openapi.json`
- `../coherent-11-07-2022/csv/*.csv`

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

The server listens on port `4001` by default.

## Startup override options

The app can be configured at startup with CLI args or an encrypted JSON file.

Supported startup args:

- `--port`
- `--approver-email`
- `--jwt-secret`
- `--jwt-exp-minutes`
- `--approval-token-ttl-hours`
- `--smtp-host`
- `--smtp-port`
- `--smtp-user`
- `--smtp-password`
- `--smtp-use-tls`
- `--smtp-from-email`
- `--secrets-file`
- `--secrets-passphrase`

Example:

```bash
python app.py \
	--approver-email dsorrent7@gmail.com \
	--smtp-host smtp.gmail.com \
	--smtp-port 587 \
	--smtp-user your-user \
	--smtp-password your-password \
	--smtp-use-tls true \
	--smtp-from-email no-reply@example.com \
	--jwt-secret your-jwt-secret
```

Encrypted startup config helper:

```bash
python tools/encrypt_startup_env.py \
	--output startup-secrets.enc.json \
	--passphrase "your-passphrase" \
	--json '{"JWT_SECRET":"your-jwt-secret","SMTP_PASSWORD":"your-password"}'
```

Then run:

```bash
python app.py --secrets-file startup-secrets.enc.json --secrets-passphrase "your-passphrase"
```

## Docker

Build from Chapter04 root:

```bash
docker build -t chapter04-flask-api -f flask-dynamo-db-backend/Dockerfile .
```

Run:

```bash
docker run --rm -p 4001:4001 \
	-e AWS_REGION=us-east-1 \
	-e DYNAMODB_TABLE=medications \
	-e JWT_SECRET=change-me \
	chapter04-flask-api
```

## Environment variables

- `PORT`
- `AWS_REGION`
- `DYNAMODB_TABLE`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN`
- `DYNAMODB_ENDPOINT`
- `AUTO_CREATE_CSV_TABLES`
- `CSV_PATH`
- `PATIENTS_TABLE_NAME`
- `JWT_SECRET`
- `JWT_EXP_MINUTES`
- `APPROVER_EMAIL`
- `APPROVAL_TOKEN_TTL_HOURS`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_USE_TLS`
- `SMTP_FROM_EMAIL`

## Terraform Pipeline (Docker -> ECR -> ECS/Fargate)

Terraform stack path:

- `../infra/terraform/flask-fargate-pipeline`

This provisions:

- ECR repository
- ECS Fargate service + ALB
- CodeBuild Docker build/push
- CodePipeline source/build/deploy flow

See `../infra/terraform/flask-fargate-pipeline/README.md` for required variables and deployment steps.

## Seed

```bash
python seed/import_medications.py
```
