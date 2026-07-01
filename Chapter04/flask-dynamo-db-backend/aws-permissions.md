# AWS IAM Permissions — ECS Task Role

**Role:** `sorrentino-fargate-fhir-demo-ecs-task-role`  
**Account:** `005905648819`  
**Region:** `us-east-1`

All policies below are **inline policies** attached directly to the ECS task role.  
IAM inline policies take effect immediately — no ECS redeployment required (except where noted).

---

## Baseline Policy (pre-existing)

### `sorrentino-fargate-fhir-demo-ecs-task-policy`

Set when the ECS service was first provisioned.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:CreateTable",
        "dynamodb:DeleteItem",
        "dynamodb:DescribeTable",
        "dynamodb:GetItem",
        "dynamodb:ListTables",
        "dynamodb:PutItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:UpdateItem"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SecretsAccess",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "secretsmanager:GetSecretValue",
        "kms:Decrypt"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## Added Policies

### `dgs-glue-staging-s3-access`

**Why:** Flask backend reads/writes CSV and Parquet files in the `dgs-glue-staging` S3 bucket
(claims pipeline staging area).

**Error that triggered this:**  
`AccessDeniedException: not authorized to perform: s3:PutObject on resource: arn:aws:s3:::dgs-glue-staging`

**AWS CLI command used:**

```bash
MSYS_NO_PATHCONV=1 aws iam put-role-policy \
  --role-name sorrentino-fargate-fhir-demo-ecs-task-role \
  --policy-name dgs-glue-staging-s3-access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::dgs-glue-staging",
        "arn:aws:s3:::dgs-glue-staging/*"
      ]
    }]
  }' \
  --region us-east-1
```

---

### `dgs-glue-catalog-access`

**Why:** The `claims_clean_&_glue_catalog_lambda` pipeline registers cleaned Parquet files
as a table in the AWS Glue Data Catalog (`fhir-table-db.claims_clean`).

**Error that triggered this:**  
`AccessDeniedException: not authorized to perform: glue:CreateTable on resource: arn:aws:glue:us-east-1:005905648819:catalog`

**Note:** A force-new-deployment was required to refresh the cached ECS task credentials
after attaching this policy.

**AWS CLI command used:**

```bash
MSYS_NO_PATHCONV=1 aws iam put-role-policy \
  --role-name sorrentino-fargate-fhir-demo-ecs-task-role \
  --policy-name dgs-glue-catalog-access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": [
        "glue:CreateTable",
        "glue:UpdateTable",
        "glue:GetTable",
        "glue:GetDatabase",
        "glue:CreateDatabase",
        "glue:GetDatabases",
        "glue:GetTables"
      ],
      "Resource": [
        "arn:aws:glue:us-east-1:005905648819:catalog",
        "arn:aws:glue:us-east-1:005905648819:database/fhir-table-db",
        "arn:aws:glue:us-east-1:005905648819:table/fhir-table-db/*"
      ]
    }]
  }' \
  --region us-east-1
```

---

### `dgs-athena-access`

**Why:** The Athena Client modal runs SQL queries via Amazon Athena against the Glue catalog,
writing results to `s3://dgs-glue-staging/athena-results/`.

**Error that triggered this:**  
`AccessDeniedException: not authorized to perform: athena:StartQueryExecution`

**AWS CLI command used:**

```bash
MSYS_NO_PATHCONV=1 aws iam put-role-policy \
  --role-name sorrentino-fargate-fhir-demo-ecs-task-role \
  --policy-name dgs-athena-access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:StopQueryExecution",
          "athena:GetWorkGroup",
          "athena:ListWorkGroups",
          "athena:ListDatabases",
          "athena:ListTableMetadata",
          "athena:GetTableMetadata",
          "athena:GetDatabase"
        ],
        "Resource": "*"
      },
      {
        "Effect": "Allow",
        "Action": [
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:PutObject"
        ],
        "Resource": [
          "arn:aws:s3:::dgs-glue-staging",
          "arn:aws:s3:::dgs-glue-staging/*"
        ]
      }
    ]
  }' \
  --region us-east-1
```

---

### `dgs-bedrock-access`

**Why:** The Athena Client "✦ Bedrock" Natural Language row calls `bedrock:InvokeModel`
to generate SQL from plain-English prompts using `amazon.nova-lite-v1:0`.

**Error that triggered this:**  
`AccessDeniedException: not authorized to perform: bedrock:InvokeModel on resource: arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0`

**AWS CLI command used:**

```bash
MSYS_NO_PATHCONV=1 aws iam put-role-policy \
  --role-name sorrentino-fargate-fhir-demo-ecs-task-role \
  --policy-name dgs-bedrock-access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/*"
    }]
  }' \
  --region us-east-1
```

---

## Verify All Policies Are Attached

```bash
MSYS_NO_PATHCONV=1 aws iam list-role-policies \
  --role-name sorrentino-fargate-fhir-demo-ecs-task-role \
  --region us-east-1
```

Expected output:

```json
{
  "PolicyNames": [
    "dgs-athena-access",
    "dgs-bedrock-access",
    "dgs-glue-catalog-access",
    "dgs-glue-staging-s3-access",
    "sorrentino-fargate-fhir-demo-ecs-task-policy"
  ]
}
```
