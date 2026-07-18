const {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
  waitUntilTableNotExists
} = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const tableName = process.env.DYNAMODB_TABLE || 'medications';

const clientConfig = {
  region: process.env.AWS_REGION || 'us-east-1'
};

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN
  };
}

if (process.env.DYNAMODB_ENDPOINT) {
  clientConfig.endpoint = process.env.DYNAMODB_ENDPOINT;
}

const dynamoClient = new DynamoDBClient(clientConfig);
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

const ensureTablePromises = new Map();

async function ensureTableExists(targetTableName) {
  const resolvedTableName = targetTableName || tableName;

  if (!ensureTablePromises.has(resolvedTableName)) {
    const promise = (async function() {
      try {
        await dynamoClient.send(new DescribeTableCommand({ TableName: resolvedTableName }));
      } catch (error) {
        if (error && error.name === 'ResourceNotFoundException') {
          await dynamoClient.send(new CreateTableCommand({
            TableName: resolvedTableName,
            AttributeDefinitions: [
              { AttributeName: 'id', AttributeType: 'S' }
            ],
            KeySchema: [
              { AttributeName: 'id', KeyType: 'HASH' }
            ],
            BillingMode: 'PAY_PER_REQUEST'
          }));
        } else {
          throw error;
        }
      }

      await waitUntilTableExists(
        { client: dynamoClient, maxWaitTime: 60 },
        { TableName: resolvedTableName }
      );
    })().catch((error) => {
      ensureTablePromises.delete(resolvedTableName);
      throw error;
    });

    ensureTablePromises.set(resolvedTableName, promise);
  }

  await ensureTablePromises.get(resolvedTableName);
}

async function tableExists(targetTableName) {
  const resolvedTableName = targetTableName || tableName;
  try {
    await dynamoClient.send(new DescribeTableCommand({ TableName: resolvedTableName }));
    return true;
  } catch (error) {
    if (error && error.name === 'ResourceNotFoundException') {
      return false;
    }
    throw error;
  }
}

async function recreateTable(targetTableName) {
  const resolvedTableName = targetTableName || tableName;

  if (await tableExists(resolvedTableName)) {
    await dynamoClient.send(new DeleteTableCommand({ TableName: resolvedTableName }));
    await waitUntilTableNotExists(
      { client: dynamoClient, maxWaitTime: 60 },
      { TableName: resolvedTableName }
    );
  }

  ensureTablePromises.delete(resolvedTableName);
  await ensureTableExists(resolvedTableName);
}

function toMedication(body) {
  return {
    id: body.id || body.medicationId || `${body.patient || 'patient'}-${body.encounter || 'encounter'}-${body.code || 'code'}`,
    start: body.start ? new Date(body.start).toISOString() : null,
    stop: body.stop ? new Date(body.stop).toISOString() : null,
    patient: body.patient || null,
    payer: body.payer || null,
    encounter: body.encounter || null,
    code: body.code || null,
    description: body.description || null,
    baseCost: body.baseCost != null ? Number(body.baseCost) : null,
    payerCoverage: body.payerCoverage != null ? Number(body.payerCoverage) : null,
    dispenses: body.dispenses != null ? Number(body.dispenses) : null,
    totalCost: body.totalCost != null ? Number(body.totalCost) : null,
    reasonCode: body.reasonCode || null,
    reasonDescription: body.reasonDescription || null
  };
}

async function listTables() {
  const { ListTablesCommand } = require('@aws-sdk/client-dynamodb');
  const tables = [];
  let lastEvaluatedTableName;

  do {
    const input = { Limit: 100 };
    if (lastEvaluatedTableName) {
      input.ExclusiveStartTableName = lastEvaluatedTableName;
    }
    const result = await dynamoClient.send(new ListTablesCommand(input));
    if (Array.isArray(result.TableNames)) {
      tables.push.apply(tables, result.TableNames);
    }
    lastEvaluatedTableName = result.LastEvaluatedTableName;
  } while (lastEvaluatedTableName);

  return tables;
}

module.exports = {
  tableName,
  dynamoClient,
  docClient,
  ensureTableExists,
  tableExists,
  recreateTable,
  listTables,
  toMedication
};
