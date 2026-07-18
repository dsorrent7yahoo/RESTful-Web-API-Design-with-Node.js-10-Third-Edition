package com.healthcare.api.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "healthcare")
public class AppProperties {

    private Jwt jwt = new Jwt();
    private Aws aws = new Aws();
    private Approval approval = new Approval();
    private Lambda lambda = new Lambda();
    private Bedrock bedrock = new Bedrock();

    @Data
    public static class Jwt {
        private String secret = "health-care-dev-secret";
        private int expirationMinutes = 60;
    }

    @Data
    public static class Aws {
        private String region = "us-east-1";
        private DynamoDb dynamodb = new DynamoDb();
        private S3 s3 = new S3();
        private Sqs sqs = new Sqs();
        private Athena athena = new Athena();
        private Glue glue = new Glue();
    }

    @Data
    public static class DynamoDb {
        private Tables tables = new Tables();

        @Data
        public static class Tables {
            private String medications = "medications";
            private String users = "health-care-users";
            private String pendingUsers = "pending-users";
            private String emailLog = "dgs-sqs-email-log";
            private String patients = "patients";
        }
    }

    @Data
    public static class S3 {
        private String stagingBucket = "dgs-glue-staging";
        private String claimsPrefix = "claims/";
        private String cleanPrefix = "claims-parquet/";
        private String athenaOutputPrefix = "athena-results/";
        private String patientsPrefix = "patients/";
        private String encountersPrefix = "encounters/";
    }

    @Data
    public static class Sqs {
        private String queueUrl;
        private String dlqQueueUrl;
    }

    @Data
    public static class Athena {
        private String database = "fhir-table-db";
        private String workgroup = "primary";
        private int maxPollSeconds = 45;
    }

    @Data
    public static class Glue {
        private String database = "fhir-table-db";
    }

    @Data
    public static class Approval {
        private String email = "dsorrent7@gmail.com";
    }

    @Data
    public static class Lambda {
        private String claimsGeneratorFunction = "synthetic_fhir_claims";
        private String claimsCleanerFunction = "claims_cleaner";
    }

    @Data
    public static class Bedrock {
        private String sqlModelId = "amazon.nova-lite-v1:0";
    }
}
