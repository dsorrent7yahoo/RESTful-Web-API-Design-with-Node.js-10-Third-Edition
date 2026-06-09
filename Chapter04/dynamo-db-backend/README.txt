DynamoDB backend scaffold for Chapter04.

Required environment variables:
- AWS_REGION
- DYNAMODB_TABLE
- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- AWS_SESSION_TOKEN (optional)
- DYNAMODB_ENDPOINT (optional)

Start server:
  npm start

Seed from CSV:
  npm run seed

Docker Desktop build and run:
  From Chapter04/ run:
    docker build -f dynamo-db-backend/Dockerfile -t chapter04-dynamo-db-backend .

  Run locally against AWS DynamoDB:
    docker run --rm -p 4001:4001 \
      -e AWS_REGION=us-east-1 \
      -e DYNAMODB_TABLE=medications \
      -e AWS_ACCESS_KEY_ID=... \
      -e AWS_SECRET_ACCESS_KEY=... \
      -e AWS_SESSION_TOKEN=... \
      chapter04-dynamo-db-backend

  Run locally against DynamoDB Local:
    docker run --rm -p 4001:4001 \
      -e AWS_REGION=us-east-1 \
      -e DYNAMODB_TABLE=medications \
      -e DYNAMODB_ENDPOINT=http://host.docker.internal:8000 \
      chapter04-dynamo-db-backend

ECS Fargate deployment:
  - Build the image with the Dockerfile above.
  - Create an ECR repository, then tag and push the image.
  - Use ecs-fargate-task-definition.json as the starting task definition.
  - Create an ECS cluster and service using launch type FARGATE.
  - Attach the service to an Application Load Balancer if you want public HTTP access.

IAM guidance:
  - Your ECS task execution role should include AmazonECSTaskExecutionRolePolicy so Fargate can pull from ECR and write CloudWatch logs.
  - Your application task role should include DynamoDB permissions such as dynamodb:DescribeTable, dynamodb:CreateTable, dynamodb:DeleteTable, dynamodb:ListTables, dynamodb:GetItem, dynamodb:PutItem, dynamodb:DeleteItem, dynamodb:Scan, and dynamodb:BatchWriteItem for the tables this app uses.
  - Your human IAM user/role that deploys the service needs ECS, ECR, CloudWatch Logs, and iam:PassRole permissions.
  - You do not add Fargate to the app role. Fargate is the launch type; the important roles are the ECS task execution role and the ECS task role.

Notes:
  - The container listens on port 4001 by default.
  - The Docker build context must be Chapter04/ because the backend depends on ../dynamodb-uploader and the default CSV folder under ../coherent-11-07-2022.
