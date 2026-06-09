var DynamoDBClient = require('@aws-sdk/client-dynamodb').DynamoDBClient;
var DynamoDBDocumentClient = require('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient;

/*
Required placeholders (set these before running):
- AWS_REGION=YOUR_AWS_REGION
- AWS_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_ACCESS_KEY
- DYNAMODB_TABLE=YOUR_DYNAMODB_TABLE_NAME

Optional:
- AWS_SESSION_TOKEN=YOUR_AWS_SESSION_TOKEN
- DYNAMODB_ENDPOINT=YOUR_DYNAMODB_ENDPOINT
*/

var tableName = process.env.DYNAMODB_TABLE || 'YOUR_DYNAMODB_TABLE_NAME';

var clientConfig = {
    region: process.env.AWS_REGION || 'YOUR_AWS_REGION'
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

var dynamoClient = new DynamoDBClient(clientConfig);
var docClient = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: {
        removeUndefinedValues: true
    }
});

var itemSchema = {
    itemId: 'string (partition key)',
    itemName: 'string',
    price: 'number',
    currency: 'string',
    categories: 'array[string]'
};

function toCatalogItem(body) {
    return {
        itemId: body.itemId,
        itemName: body.itemName,
        price: body.price,
        currency: body.currency,
        categories: body.categories
    };
}

module.exports = {
    tableName: tableName,
    itemSchema: itemSchema,
    dynamoClient: dynamoClient,
    docClient: docClient,
    toCatalogItem: toCatalogItem
};
