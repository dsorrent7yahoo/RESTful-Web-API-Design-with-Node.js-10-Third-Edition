'use strict';

const crypto = require('crypto');
const { CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const jwt = require('jsonwebtoken');
const { dynamoClient, docClient } = require('../model/medication');

const USERS_TABLE_NAME  = 'health-care-users';
const DEFAULT_EMAIL     = 'react-dgs@yahoo.com';
const DEFAULT_USERNAME  = 'react';
const DEFAULT_PASSWORD  = 'python';
const PBKDF2_ITERATIONS = 120000;

function getJwtSecret()     { return process.env.JWT_SECRET      || 'health-care-dev-secret'; }
function getJwtExpMinutes() { return parseInt(process.env.JWT_EXP_MINUTES || '60', 10); }

// ── Password hashing — PBKDF2-SHA256, compatible with Flask's stored format ──
function hashPassword(password) {
  const salt   = crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, 32, 'sha256');
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${digest.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  try {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 4) return false;
    const [algorithm, iterations, saltHex, digestHex] = parts;
    if (algorithm !== 'pbkdf2_sha256') return false;
    const salt   = Buffer.from(saltHex, 'hex');
    const digest = crypto.pbkdf2Sync(String(password), salt, parseInt(iterations, 10), 32, 'sha256');
    return crypto.timingSafeEqual(digest, Buffer.from(digestHex, 'hex'));
  } catch {
    return false;
  }
}

// ── DynamoDB users table ──────────────────────────────────────────────────────
async function ensureUsersTableExists() {
  try {
    await dynamoClient.send(new DescribeTableCommand({ TableName: USERS_TABLE_NAME }));
  } catch (err) {
    if (err && err.name === 'ResourceNotFoundException') {
      await dynamoClient.send(new CreateTableCommand({
        TableName: USERS_TABLE_NAME,
        AttributeDefinitions: [{ AttributeName: 'email', AttributeType: 'S' }],
        KeySchema:            [{ AttributeName: 'email', KeyType: 'HASH'  }],
        BillingMode: 'PAY_PER_REQUEST',
      }));
      // Give the table a moment to become ACTIVE
      await new Promise(r => setTimeout(r, 3000));
    } else {
      throw err;
    }
  }
}

async function getUser(email) {
  const result = await docClient.send(new GetCommand({
    TableName: USERS_TABLE_NAME,
    Key: { email: String(email || '').trim().toLowerCase() },
  }));
  return result.Item || null;
}

async function ensureDefaultUserExists() {
  await ensureUsersTableExists();
  const existing = await getUser(DEFAULT_EMAIL);
  if (existing) return;
  await docClient.send(new PutCommand({
    TableName: USERS_TABLE_NAME,
    Item: {
      email:        DEFAULT_EMAIL,
      username:     DEFAULT_USERNAME,
      passwordHash: hashPassword(DEFAULT_PASSWORD),
      createdAt:    new Date().toISOString(),
    },
  }));
}

// ── JWT ───────────────────────────────────────────────────────────────────────
function createAccessToken(userItem) {
  const nowSec     = Math.floor(Date.now() / 1000);
  const expSeconds = getJwtExpMinutes() * 60;
  const payload    = {
    sub:      userItem.email,
    email:    userItem.email,
    username: userItem.username || '',
    iat:      nowSec,
    exp:      nowSec + expSeconds,
  };
  const token     = jwt.sign(payload, getJwtSecret());
  const expiresAt = new Date((nowSec + expSeconds) * 1000).toISOString();
  return { token, tokenType: 'Bearer', expiresAt };
}

function verifyToken(authorizationHeader) {
  if (!authorizationHeader) {
    throw { status: 401, message: 'Authorization header is required' };
  }
  const value = String(authorizationHeader).trim();
  if (!value.toLowerCase().startsWith('bearer ')) {
    throw { status: 401, message: 'Authorization must use Bearer token' };
  }
  const token = value.slice(7).trim();
  if (!token) {
    throw { status: 401, message: 'Bearer token is missing' };
  }
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw { status: 401, message: 'Token has expired' };
    throw { status: 401, message: 'Invalid token' };
  }
}

// ── Auth actions ──────────────────────────────────────────────────────────────
async function loginUser(payload) {
  await ensureUsersTableExists();
  await ensureDefaultUserExists();

  const email    = String(payload.email    || '').trim().toLowerCase();
  const password = String(payload.password || '');

  if (!email || !password) {
    throw { status: 400, message: 'email and password are required' };
  }

  const userItem = await getUser(email);
  if (!userItem || !verifyPassword(password, userItem.passwordHash)) {
    throw { status: 401, message: 'Invalid email or password' };
  }

  const tokenData = createAccessToken(userItem);
  return {
    status:      'ok',
    user:        { email: userItem.email, username: userItem.username },
    accessToken: tokenData.token,
    tokenType:   tokenData.tokenType,
    expiresAt:   tokenData.expiresAt,
  };
}

module.exports = { loginUser, verifyToken, ensureDefaultUserExists };
