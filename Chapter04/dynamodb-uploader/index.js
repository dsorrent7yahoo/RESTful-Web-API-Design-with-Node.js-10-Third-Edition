'use strict';

/**
 * dynamodb-uploader
 *
 * Reusable DynamoDB CSV uploader.
 *
 * Usage:
 *   const { DynamoUploader } = require('../dynamodb-uploader');
 *
 *   const uploader = new DynamoUploader({ region: 'us-east-1' });
 *
 *   const result = await uploader.upload({
 *     tableName: 'my-table',
 *     csvPath: '/absolute/path/to/data.csv',   // OR csvContent: '<csv string>'
 *     sourceLabel: 'my-data.csv',
 *
 *     // Transform each CSV row into a DynamoDB item.
 *     // Default: uses all columns as-is, adds a generated 'id' field.
 *     rowToItem: (row, rowIndex) => ({ id: `row-${rowIndex}`, ...row }),
 *
 *     // Called when the target table already exists.
 *     // Return true  → delete existing table and re-upload.
 *     // Return false → cancel upload (no changes made).
 *     // Default: throws UploadCancelledError (caller must supply this for interactive flows).
 *     onTableExists: async (tableName) => false,
 *
 *     batchSize: 25,           // items per BatchWrite call (max 25)
 *     keyAttributeName: 'id',  // HASH key attribute name
 *     keyAttributeType: 'S',   // HASH key type (S / N / B)
 *   });
 *
 *   // result: { imported, source, tableName }
 */

const {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
  waitUntilTableNotExists
} = require('@aws-sdk/client-dynamodb');
const { BatchWriteCommand, DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { parse } = require('csv-parse');

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

class UploadCancelledError extends Error {
  constructor(tableName) {
    super(`Upload cancelled — table "${tableName}" already exists and replacement was not confirmed.`);
    this.name = 'UploadCancelledError';
    this.tableName = tableName;
  }
}

class TableExistsError extends Error {
  constructor(tableName) {
    super(`Table "${tableName}" already exists.`);
    this.name = 'TableExistsError';
    this.tableName = tableName;
  }
}

// ---------------------------------------------------------------------------
// DynamoUploader class
// ---------------------------------------------------------------------------

class DynamoUploader {
  /**
   * @param {object} [options]
   * @param {string} [options.region='us-east-1']
   * @param {string} [options.accessKeyId]       — falls back to env / profile
   * @param {string} [options.secretAccessKey]   — falls back to env / profile
   * @param {string} [options.sessionToken]
   * @param {string} [options.endpoint]          — for local DynamoDB
   */
  constructor(options = {}) {
    const clientConfig = {
      region: options.region || process.env.AWS_REGION || 'us-east-1'
    };

    if (options.accessKeyId && options.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        sessionToken: options.sessionToken
      };
    } else if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      clientConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN
      };
    }

    if (options.endpoint || process.env.DYNAMODB_ENDPOINT) {
      clientConfig.endpoint = options.endpoint || process.env.DYNAMODB_ENDPOINT;
    }

    this._dynamoClient = new DynamoDBClient(clientConfig);
    this._docClient = DynamoDBDocumentClient.from(this._dynamoClient, {
      marshallOptions: { removeUndefinedValues: true }
    });
  }

  // -------------------------------------------------------------------------
  // Table management
  // -------------------------------------------------------------------------

  /**
   * Returns true if the table exists, false if not.
   * @param {string} tableName
   * @returns {Promise<boolean>}
   */
  async tableExists(tableName) {
    try {
      await this._dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
      return true;
    } catch (error) {
      if (error && error.name === 'ResourceNotFoundException') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Creates a table if it does not already exist, then waits until ACTIVE.
   * @param {string} tableName
   * @param {string} [keyAttributeName='id']
   * @param {string} [keyAttributeType='S']
   */
  async createTable(tableName, keyAttributeName = 'id', keyAttributeType = 'S') {
    const exists = await this.tableExists(tableName);
    if (!exists) {
      await this._dynamoClient.send(new CreateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [
          { AttributeName: keyAttributeName, AttributeType: keyAttributeType }
        ],
        KeySchema: [
          { AttributeName: keyAttributeName, KeyType: 'HASH' }
        ],
        BillingMode: 'PAY_PER_REQUEST'
      }));
      await waitUntilTableExists(
        { client: this._dynamoClient, maxWaitTime: 60 },
        { TableName: tableName }
      );
      console.log(`[dynamodb-uploader] Table "${tableName}" created.`);
    }
  }

  /**
   * Deletes and recreates a table, then waits until ACTIVE.
   * @param {string} tableName
   * @param {string} [keyAttributeName='id']
   * @param {string} [keyAttributeType='S']
   */
  async recreateTable(tableName, keyAttributeName = 'id', keyAttributeType = 'S') {
    if (await this.tableExists(tableName)) {
      console.log(`[dynamodb-uploader] Deleting existing table "${tableName}"...`);
      await this._dynamoClient.send(new DeleteTableCommand({ TableName: tableName }));
      await waitUntilTableNotExists(
        { client: this._dynamoClient, maxWaitTime: 60 },
        { TableName: tableName }
      );
      console.log(`[dynamodb-uploader] Table "${tableName}" deleted.`);
    }
    await this.createTable(tableName, keyAttributeName, keyAttributeType);
  }

  // -------------------------------------------------------------------------
  // CSV parsing
  // -------------------------------------------------------------------------

  /**
   * Parse CSV from a file path, return array of raw row objects.
   * @param {string} csvPath  absolute path
   * @returns {Promise<object[]>}
   */
  static parseCsvFile(csvPath) {
    return new Promise((resolve, reject) => {
      const rows = [];
      const stream = fs.createReadStream(csvPath);
      const parser = parse({ columns: true, trim: true, skip_empty_lines: true });
      stream.on('error', reject);
      parser.on('error', reject);
      parser.on('data', (row) => rows.push(row));
      parser.on('end', () => resolve(rows));
      stream.pipe(parser);
    });
  }

  /**
   * Parse CSV from a string, return array of raw row objects.
   * @param {string} csvContent
   * @returns {Promise<object[]>}
   */
  static parseCsvContent(csvContent) {
    return new Promise((resolve, reject) => {
      const rows = [];
      const parser = parse({ columns: true, trim: true, skip_empty_lines: true });
      const stream = Readable.from([csvContent]);
      stream.on('error', reject);
      parser.on('error', reject);
      parser.on('data', (row) => rows.push(row));
      parser.on('end', () => resolve(rows));
      stream.pipe(parser);
    });
  }

  // -------------------------------------------------------------------------
  // Batch write
  // -------------------------------------------------------------------------

  /**
   * Write an array of items to DynamoDB in batches.
   * @param {object[]} items
   * @param {string} tableName
   * @param {number} [batchSize=25]
   */
  async _batchWrite(items, tableName, batchSize = 25) {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const requestItems = {};
      requestItems[tableName] = batch.map((Item) => ({ PutRequest: { Item } }));
      await this._docClient.send(new BatchWriteCommand({ RequestItems: requestItems }));
    }
  }

  // -------------------------------------------------------------------------
  // Main upload entry point
  // -------------------------------------------------------------------------

  /**
   * Upload a CSV file (or content string) into a DynamoDB table.
   *
   * @param {object} options
   * @param {string}   options.tableName           — target DynamoDB table name
   * @param {string}   [options.csvPath]           — absolute path to CSV file
   * @param {string}   [options.csvContent]        — CSV as a string (alternative to csvPath)
   * @param {string}   [options.sourceLabel]       — label for logging/results
   * @param {function} [options.rowToItem]         — (row, index) => DynamoDB item object
   * @param {function} [options.onTableExists]     — async (tableName) => boolean
   *                                                  true  = replace table
   *                                                  false = cancel upload
   * @param {number}   [options.batchSize=25]
   * @param {string}   [options.keyAttributeName='id']
   * @param {string}   [options.keyAttributeType='S']
   *
   * @returns {Promise<{ imported: number, source: string, tableName: string }>}
   * @throws {UploadCancelledError} if onTableExists returns false or is not supplied
   * @throws {Error} on AWS or file system errors
   */
  async upload(options = {}) {
    const {
      tableName,
      csvPath,
      csvContent,
      sourceLabel,
      rowToItem,
      onTableExists,
      batchSize = 25,
      keyAttributeName = 'id',
      keyAttributeType = 'S'
    } = options;

    if (!tableName) {
      throw new Error('[dynamodb-uploader] options.tableName is required.');
    }
    if (!csvPath && !csvContent) {
      throw new Error('[dynamodb-uploader] Either options.csvPath or options.csvContent is required.');
    }
    if (csvPath && !path.isAbsolute(csvPath)) {
      throw new Error(`[dynamodb-uploader] options.csvPath must be an absolute path. Got: ${csvPath}`);
    }

    // ── table-exists check ────────────────────────────────────────────────
    const exists = await this.tableExists(tableName);
    if (exists) {
      let shouldReplace = false;

      if (typeof onTableExists === 'function') {
        shouldReplace = Boolean(await onTableExists(tableName));
      }

      if (!shouldReplace) {
        throw new UploadCancelledError(tableName);
      }

      await this.recreateTable(tableName, keyAttributeName, keyAttributeType);
    } else {
      await this.createTable(tableName, keyAttributeName, keyAttributeType);
    }

    // ── parse CSV ─────────────────────────────────────────────────────────
    let rawRows;
    let source = sourceLabel || csvPath || 'uploaded-content';

    if (csvContent) {
      rawRows = await DynamoUploader.parseCsvContent(csvContent);
    } else {
      if (!fs.existsSync(csvPath)) {
        throw Object.assign(new Error(`CSV file not found: ${csvPath}`), { code: 'ENOENT', path: csvPath });
      }
      rawRows = await DynamoUploader.parseCsvFile(csvPath);
    }

    // ── transform rows ────────────────────────────────────────────────────
    const defaultRowToItem = (row, index) => {
      // Build a deterministic id from the first few column values + index
      const values = Object.values(row);
      const idBase = values.slice(0, 3).join('-').replace(/[^a-zA-Z0-9_-]/g, '_');
      return Object.assign({ id: `${idBase}-${index}` }, row);
    };

    const transformer = typeof rowToItem === 'function' ? rowToItem : defaultRowToItem;
    const items = rawRows.map((row, index) => transformer(row, index));

    // ── batch write ───────────────────────────────────────────────────────
    console.log(`[dynamodb-uploader] Writing ${items.length} items to "${tableName}"...`);
    const start = Date.now();
    await this._batchWrite(items, tableName, batchSize);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[dynamodb-uploader] Done. ${items.length} items in ${elapsed}s.`);

    return { imported: items.length, source, tableName };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { DynamoUploader, UploadCancelledError, TableExistsError };
