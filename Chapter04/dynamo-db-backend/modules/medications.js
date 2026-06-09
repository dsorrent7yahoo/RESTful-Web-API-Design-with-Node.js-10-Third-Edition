const {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand
} = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { parse } = require('csv-parse');

const model = require('../model/medication');
const docClient = model.docClient;
const tableName = model.tableName;
const toMedication = model.toMedication;

const contentTypeJson = { 'Content-Type': 'application/json' };
const contentTypePlainText = { 'Content-Type': 'text/plain' };
const CSV_PATH = process.env.CSV_PATH || path.join(__dirname, '..', '..', 'coherent-11-07-2022', 'csv', 'medications.csv');
const BATCH_SIZE = 25;
const PATIENTS_TABLE_NAME = process.env.PATIENTS_TABLE_NAME || 'patients';

function firstPresentField(objectValue, fields) {
  if (!objectValue || typeof objectValue !== 'object') {
    return null;
  }

  for (let index = 0; index < fields.length; index += 1) {
    const value = objectValue[fields[index]];
    if (value !== undefined && value !== null) {
      const text = String(value).trim();
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function resolvePatientIdFromRow(row) {
  return firstPresentField(row, ['id', 'Id', 'ID', 'patient', 'patientId', 'PATIENT']);
}

function resolvePatientNameFromRow(row) {
  const fullName = firstPresentField(row, [
    'name',
    'NAME',
    'fullName',
    'full_name',
    'fullname'
  ]);

  if (fullName) {
    return fullName;
  }

  const firstName = firstPresentField(row, ['first', 'FIRST', 'firstName', 'first_name']);
  const lastName = firstPresentField(row, ['last', 'LAST', 'lastName', 'last_name']);

  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }

  return firstName || lastName || null;
}

async function scanPatientNamesByIds(patientIds) {
  const patientNameById = new Map();
  const wantedIds = new Set(Array.from(patientIds || []).map((value) => String(value)));

  if (wantedIds.size === 0) {
    return patientNameById;
  }

  const patientsTableExists = await model.tableExists(PATIENTS_TABLE_NAME);
  if (!patientsTableExists) {
    return patientNameById;
  }

  const scanInput = {
    TableName: PATIENTS_TABLE_NAME
  };

  let lastEvaluatedKey;

  do {
    if (lastEvaluatedKey) {
      scanInput.ExclusiveStartKey = lastEvaluatedKey;
    } else {
      delete scanInput.ExclusiveStartKey;
    }

    const page = await docClient.send(new ScanCommand(scanInput));
    const items = Array.isArray(page.Items) ? page.Items : [];

    items.forEach((item) => {
      const patientId = resolvePatientIdFromRow(item);
      if (!patientId || !wantedIds.has(patientId) || patientNameById.has(patientId)) {
        return;
      }

      const patientName = resolvePatientNameFromRow(item);
      if (patientName) {
        patientNameById.set(patientId, patientName);
      }
    });

    lastEvaluatedKey = page.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return patientNameById;
}

function toNullableNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  if (text === '') {
    return null;
  }

  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function looksLikeMedicationRow(row) {
  return Boolean(row && (row.PATIENT || row.ENCOUNTER || row.CODE || row.DESCRIPTION || row.BASE_COST));
}

function toGenericCsvItem(row, rowIndex) {
  const item = {};

  Object.keys(row || {}).forEach((key) => {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!normalizedKey) {
      return;
    }

    const rawValue = row[key];
    if (rawValue === undefined || rawValue === null) {
      item[normalizedKey] = null;
      return;
    }

    const text = String(rawValue).trim();
    if (text === '') {
      item[normalizedKey] = null;
      return;
    }

    if (/^-?\d+(\.\d+)?$/.test(text)) {
      const numeric = Number(text);
      item[normalizedKey] = Number.isFinite(numeric) ? numeric : text;
      return;
    }

    item[normalizedKey] = text;
  });

  if (!item.id) {
    const seed = Object.keys(item)
      .slice(0, 3)
      .map((key) => item[key])
      .filter((value) => value !== null && value !== undefined)
      .join('-');
    item.id = `${seed || 'row'}-${rowIndex}`;
  }

  return item;
}

function toCsvItem(row, rowIndex) {
  if (!looksLikeMedicationRow(row)) {
    return toGenericCsvItem(row, rowIndex);
  }

  const startPart = row.START ? String(row.START) : 'nostart';
  const stopPart = row.STOP ? String(row.STOP) : 'nostop';
  const rowPart = String(rowIndex);

  return {
    id: `${row.PATIENT || 'patient'}-${row.ENCOUNTER || 'encounter'}-${row.CODE || 'code'}-${startPart}-${stopPart}-${rowPart}`,
    start: row.START ? new Date(row.START).toISOString() : null,
    stop: row.STOP ? new Date(row.STOP).toISOString() : null,
    patient: row.PATIENT || null,
    payer: row.PAYER || null,
    encounter: row.ENCOUNTER || null,
    code: row.CODE || null,
    description: row.DESCRIPTION || null,
    baseCost: toNullableNumber(row.BASE_COST),
    payerCoverage: toNullableNumber(row.PAYER_COVERAGE),
    dispenses: toNullableNumber(row.DISPENSES),
    totalCost: toNullableNumber(row.TOTALCOST),
    reasonCode: row.REASONCODE || null,
    reasonDescription: row.REASONDESCRIPTION || null
  };
}

async function writeBatch(items, targetTableName) {
  const resolvedTableName = targetTableName || tableName;
  const requestItems = {};
  requestItems[resolvedTableName] = items.map((Item) => ({ PutRequest: { Item: Item } }));

  await docClient.send(new BatchWriteCommand({ RequestItems: requestItems }));
}

async function readCsvRows(csvPath) {
  const items = [];
  let rowIndex = 0;

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(csvPath);
    const parser = parse({ columns: true, trim: true, skip_empty_lines: true });

    stream.on('error', reject);
    parser.on('error', reject);
    parser.on('data', (row) => {
      items.push(toCsvItem(row, rowIndex));
      rowIndex += 1;
    });
    parser.on('end', resolve);

    stream.pipe(parser);
  });

  return items;
}

async function readCsvRowsFromContent(csvContent) {
  const items = [];
  let rowIndex = 0;

  await new Promise((resolve, reject) => {
    const parser = parse({ columns: true, trim: true, skip_empty_lines: true });
    const stream = Readable.from([csvContent]);

    stream.on('error', reject);
    parser.on('error', reject);
    parser.on('data', (row) => {
      items.push(toCsvItem(row, rowIndex));
      rowIndex += 1;
    });
    parser.on('end', resolve);

    stream.pipe(parser);
  });

  return items;
}

async function importRowsToDynamo(items, sourceLabel, targetTableName) {
  const resolvedTableName = targetTableName || tableName;
  await model.ensureTableExists(resolvedTableName);

  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    const batch = items.slice(index, index + BATCH_SIZE);
    await writeBatch(batch, resolvedTableName);
  }

  return { imported: items.length, source: sourceLabel, tableName: resolvedTableName };
}

async function importCsvToDynamo(csvPath, targetTableName) {
  const items = await readCsvRows(csvPath);
  return importRowsToDynamo(items, csvPath, targetTableName);
}

async function importCsvContentToDynamo(csvContent, sourceLabel, targetTableName) {
  const items = await readCsvRowsFromContent(csvContent);
  return importRowsToDynamo(items, sourceLabel || 'uploaded-content', targetTableName);
}

exports.findAllMedications = async function(request, response) {
  try {
    await model.ensureTableExists();
    const topN = parseInt(request.query.topN, 10);
    const limitParam = parseInt(request.query.limit, 10);
    const limit = Number.isFinite(topN) && topN > 0
      ? topN
      : (Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50);
    const startKey = request.query.startKey ? JSON.parse(request.query.startKey) : undefined;
    const id = request.query.id;
    const patientId = request.query.patientId;
    const medicationId = request.query.medicationId;

    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    const filters = [];

    if (id) {
      expressionAttributeNames['#id'] = 'id';
      expressionAttributeValues[':id'] = id;
      filters.push('#id = :id');
    }

    if (patientId) {
      expressionAttributeNames['#patient'] = 'patient';
      expressionAttributeValues[':patient'] = patientId;
      filters.push('#patient = :patient');
    }

    if (medicationId) {
      expressionAttributeNames['#code'] = 'code';
      expressionAttributeValues[':code'] = medicationId;
      filters.push('#code = :code');
    }

    const scanInput = {
      TableName: tableName,
      Limit: limit,
      ExclusiveStartKey: startKey
    };

    if (filters.length > 0) {
      scanInput.FilterExpression = filters.join(' AND ');
      scanInput.ExpressionAttributeNames = expressionAttributeNames;
      scanInput.ExpressionAttributeValues = expressionAttributeValues;
    }

    const result = await docClient.send(new ScanCommand(scanInput));

    response.json({
      items: result.Items || [],
      lastEvaluatedKey: result.LastEvaluatedKey || null
    });
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

exports.findMedicationById = async function(id, response) {
  try {
    await model.ensureTableExists();
    const result = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: { id: id }
    }));

    if (!result.Item) {
      response.writeHead(404, contentTypePlainText);
      response.end('Not Found');
      return;
    }

    response.setHeader('Content-Type', 'application/json');
    response.send(result.Item);
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

exports.findMedicationsByPatient = async function(patient, response) {
  try {
    await model.ensureTableExists();
    const result = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: '#patient = :patient',
      ExpressionAttributeNames: {
        '#patient': 'patient'
      },
      ExpressionAttributeValues: {
        ':patient': patient
      }
    }));

    response.json(result.Items || []);
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

exports.findMedicationsByCode = async function(code, response) {
  try {
    await model.ensureTableExists();
    const result = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: '#code = :code',
      ExpressionAttributeNames: {
        '#code': 'code'
      },
      ExpressionAttributeValues: {
        ':code': code
      }
    }));

    response.json(result.Items || []);
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

exports.findMedicationsByMedicationId = async function(medicationId, response) {
  try {
    await model.ensureTableExists();
    const result = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: '#code = :code',
      ExpressionAttributeNames: {
        '#code': 'code'
      },
      ExpressionAttributeValues: {
        ':code': medicationId
      }
    }));

    response.json(result.Items || []);
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

exports.findPatientsWithMultipleMedications = async function(request, response) {
  try {
    await model.ensureTableExists();

    const topN = parseInt(request.query.topN, 10);
    const scanInput = {
      TableName: tableName,
      ProjectionExpression: '#patient, #code, #description',
      ExpressionAttributeNames: {
        '#patient': 'patient',
        '#code': 'code',
        '#description': 'description'
      }
    };

    const allItems = [];
    let lastEvaluatedKey;

    do {
      if (lastEvaluatedKey) {
        scanInput.ExclusiveStartKey = lastEvaluatedKey;
      } else {
        delete scanInput.ExclusiveStartKey;
      }

      const page = await docClient.send(new ScanCommand(scanInput));
      if (Array.isArray(page.Items)) {
        allItems.push.apply(allItems, page.Items);
      }
      lastEvaluatedKey = page.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    const patientsMap = new Map();

    allItems.forEach((item) => {
      if (!item || !item.patient) {
        return;
      }

      if (!patientsMap.has(item.patient)) {
        patientsMap.set(item.patient, new Map());
      }

      if (item.code) {
        const patientMedications = patientsMap.get(item.patient);
        const medicationId = String(item.code);
        if (!patientMedications.has(medicationId)) {
          patientMedications.set(medicationId, {
            medicationId: medicationId,
            medicationName: item.description || null,
            count: 0
          });
        }

        const medicationEntry = patientMedications.get(medicationId);
        medicationEntry.count += 1;

        if (!medicationEntry.medicationName && item.description) {
          medicationEntry.medicationName = item.description;
        }
      }
    });

    const patientNameById = await scanPatientNamesByIds(patientsMap.keys());

    let results = Array.from(patientsMap.entries())
      .map(([patientId, medicationsMap]) => ({
        patientId: patientId,
        patientName: patientNameById.get(String(patientId)) || null,
        medicationCount: medicationsMap.size,
        medications: Array.from(medicationsMap.values()).sort((a, b) => b.count - a.count)
      }))
      .filter((row) => row.medicationCount > 1)
      .sort((a, b) => b.medicationCount - a.medicationCount);

    if (Number.isFinite(topN) && topN > 0) {
      results = results.slice(0, topN);
    }

    response.json({
      totalPatients: results.length,
      items: results
    });
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

exports.saveMedication = async function(request, response) {
  try {
    await model.ensureTableExists();
    const medication = toMedication(request.body);
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: medication
    }));
    response.writeHead(201, contentTypeJson);
    response.end(JSON.stringify(medication));
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

exports.updateMedication = async function(request, response) {
  try {
    await model.ensureTableExists();
    const existing = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: { id: request.params.id }
    }));

    if (!existing.Item) {
      response.writeHead(404, contentTypePlainText);
      response.end('Not Found');
      return;
    }

    const medication = Object.assign({}, existing.Item, toMedication(request.body), {
      id: request.params.id
    });

    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: medication
    }));

    response.json(medication);
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

exports.removeMedication = async function(request, response) {
  try {
    await model.ensureTableExists();
    const result = await docClient.send(new DeleteCommand({
      TableName: tableName,
      Key: { id: request.params.id },
      ReturnValues: 'ALL_OLD'
    }));

    if (!result.Attributes) {
      response.writeHead(404, contentTypePlainText);
      response.end('Not Found');
      return;
    }

    response.json({ Status: 'Successfully deleted' });
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal server error');
  }
};

// API helper to upload/import the CSV into DynamoDB
exports.uploadToDynamo = async function(request, response) {
  try {
    const requestedTableName = request.body && typeof request.body.tableName === 'string'
      ? request.body.tableName.trim()
      : '';
    const targetTableName = requestedTableName || tableName;
    const rawReplaceExistingTable = request.body && request.body.replaceExistingTable;
    const replaceExistingTable = rawReplaceExistingTable === true
      || rawReplaceExistingTable === 'true'
      || rawReplaceExistingTable === 1
      || rawReplaceExistingTable === '1';
    const csvContent = request.body && typeof request.body.csvContent === 'string'
      ? request.body.csvContent
      : '';
    const providedCsvPath = request.body && request.body.csvPath;

    if (providedCsvPath && !path.isAbsolute(providedCsvPath)) {
      response.status(400).json({
        status: 'error',
        message: 'csvPath must be an absolute path',
        csvPath: providedCsvPath
      });
      return;
    }

    const targetExists = await model.tableExists(targetTableName);

    if (targetExists && !replaceExistingTable) {
      response.status(409).json({
        status: 'confirm_required',
        message: `Table ${targetTableName} already exists. Confirm replacement to delete and re-upload.`,
        tableName: targetTableName,
        requiresConfirmation: true
      });
      return;
    }

    if (targetExists && replaceExistingTable) {
      await model.recreateTable(targetTableName);
    }

    let result;

    if (csvContent) {
      const sourceLabel = request.body && request.body.fileName
        ? String(request.body.fileName)
        : 'uploaded-content';
      result = await importCsvContentToDynamo(csvContent, sourceLabel, targetTableName);
    } else {
      const csvPath = providedCsvPath
        ? path.resolve(providedCsvPath)
        : path.resolve(CSV_PATH);

      if (!fs.existsSync(csvPath)) {
        response.status(400).json({
          status: 'error',
          message: 'CSV file not found',
          csvPath: csvPath
        });
        return;
      }

      result = await importCsvToDynamo(csvPath, targetTableName);
    }

    response.json({
      status: 'success',
      message: 'CSV imported into DynamoDB',
      imported: result.imported,
      source: result.source,
      tableName: result.tableName
    });
  } catch (error) {
    console.error(error);
    if (error && error.code === 'ENOENT') {
      response.status(400).json({
        status: 'error',
        message: 'CSV file not found',
        csvPath: error.path || null
      });
      return;
    }
    if (error && (error.name === 'AccessDeniedException' || error.name === 'UnrecognizedClientException' || error.name === 'CredentialsProviderError')) {
      response.status(403).json({
        status: 'error',
        message: 'AWS authentication/authorization failed for DynamoDB',
        awsError: error.name
      });
      return;
    }
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

// export the importer so the seed script can reuse it
exports.importCsvToDynamo = importCsvToDynamo;
