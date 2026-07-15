/**
 * Session Service
 * ───────────────
 * All DynamoDB read/write operations for survey mirror sessions.
 *
 * Session shape stored in DynamoDB:
 * {
 *   sessionId:      string  (PK — uuid v4)
 *   email:          string  (GSI hash key — set when session initiates)
 *   phone:          string
 *   status:         'active' | 'exited' | 'completed'
 *   currentSlide:   string  (e.g. 'slide3')
 *   slides: {
 *     slide1: { fieldName: value, … },
 *     slide2: { … },
 *     …
 *   }
 *   otp: {
 *     status:       'none' | 'pending' | 'valid' | 'invalid'
 *     attempts:     number
 *   }
 *   planId:         string | null
 *   createdAt:      number  (epoch ms)
 *   updatedAt:      number  (epoch ms)
 *   lastHeartbeat:  number  (epoch ms)
 *   ttl:            number  (epoch seconds — for DynamoDB TTL, 7 days)
 * }
 */

const {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');

const { db, TABLE } = require('./db');
const { LAST_SLIDE } = require('../config/slides');

// ─── helpers ────────────────────────────────────────────────────────────────

function now() { return Date.now(); }
function ttlInSeconds(days = 7) {
  return Math.floor(Date.now() / 1000) + days * 86400;
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Create a brand-new session (called once email is captured).
 */
async function createSession({ sessionId, email, phone = '' }) {
  const ts = now();
  const item = {
    sessionId,
    email,
    phone,
    status:       'active',
    currentSlide: 'slide1',
    slides:       {},
    otp: {
      status:   'none',
      attempts: 0,
    },
    planId:        null,
    createdAt:     ts,
    updatedAt:     ts,
    lastHeartbeat: ts,
    ttl:           ttlInSeconds(7),
  };

  await db.send(new PutCommand({ TableName: TABLE(), Item: item }));
  return item;
}

/**
 * Retrieve a session by sessionId.
 */
async function getSession(sessionId) {
  const { Item } = await db.send(
    new GetCommand({ TableName: TABLE(), Key: { sessionId } }),
  );
  return Item || null;
}

/**
 * Retrieve sessions by email (GSI lookup).
 */
async function getSessionsByEmail(email) {
  const { Items } = await db.send(
    new QueryCommand({
      TableName:                TABLE(),
      IndexName:                'email-index',
      KeyConditionExpression:   'email = :email',
      ExpressionAttributeValues: { ':email': email },
    }),
  );
  return Items || [];
}

/**
 * Save all field values for a specific slide (called on slide change).
 * Also updates currentSlide, updatedAt.
 * If slideName === LAST_SLIDE the session is marked completed.
 */
async function saveSlideData({ sessionId, slideName, fields }) {
  const ts    = now();
  const isLast = slideName === LAST_SLIDE;

  // Build update expression for all fields under slides.<slideName>
  const setExpressions = [
    `slides.#slide = :fields`,
    `currentSlide = :slide`,
    `updatedAt = :ts`,
    `lastHeartbeat = :ts`,
  ];
  const expAttrNames  = { '#slide': slideName };
  const expAttrValues = {
    ':fields': fields,
    ':slide':  slideName,
    ':ts':     ts,
  };

  if (isLast) {
    setExpressions.push('status = :completed');
    expAttrValues[':completed'] = 'completed';
  }

  await db.send(
    new UpdateCommand({
      TableName:                 TABLE(),
      Key:                       { sessionId },
      UpdateExpression:          `SET ${setExpressions.join(', ')}`,
      ExpressionAttributeNames:  expAttrNames,
      ExpressionAttributeValues: expAttrValues,
    }),
  );
}

/**
 * Record a heartbeat — keeps the session alive.
 */
async function heartbeat(sessionId) {
  const ts = now();
  await db.send(
    new UpdateCommand({
      TableName:                 TABLE(),
      Key:                       { sessionId },
      UpdateExpression:          'SET lastHeartbeat = :ts, updatedAt = :ts',
      ExpressionAttributeValues: { ':ts': ts },
    }),
  );
}

/**
 * Mark a session as exited (called explicitly or after stale detection).
 */
async function markExited(sessionId) {
  const ts = now();
  await db.send(
    new UpdateCommand({
      TableName:                 TABLE(),
      Key:                       { sessionId },
      UpdateExpression:          'SET #s = :exited, updatedAt = :ts',
      ExpressionAttributeNames:  { '#s': 'status' },
      ExpressionAttributeValues: { ':exited': 'exited', ':ts': ts },
    }),
  );
}

/**
 * Mark a session as completed and store plan_id.
 */
async function markCompleted(sessionId, planId) {
  const ts = now();
  await db.send(
    new UpdateCommand({
      TableName:                 TABLE(),
      Key:                       { sessionId },
      UpdateExpression:          'SET #s = :completed, planId = :planId, updatedAt = :ts',
      ExpressionAttributeNames:  { '#s': 'status' },
      ExpressionAttributeValues: { ':completed': 'completed', ':planId': planId, ':ts': ts },
    }),
  );
}

/**
 * Update OTP status (called by the other server via internal API).
 * status: 'pending' | 'valid' | 'invalid'
 */
async function updateOtpStatus(sessionId, status) {
  const ts = now();
  await db.send(
    new UpdateCommand({
      TableName:                 TABLE(),
      Key:                       { sessionId },
      UpdateExpression:          'SET otp.#s = :status, updatedAt = :ts',
      ExpressionAttributeNames:  { '#s': 'status' },
      ExpressionAttributeValues: { ':status': status, ':ts': ts },
    }),
  );
}

/**
 * Increment OTP attempt counter.
 */
async function incrementOtpAttempts(sessionId) {
  const ts = now();
  await db.send(
    new UpdateCommand({
      TableName:                 TABLE(),
      Key:                       { sessionId },
      UpdateExpression:          'SET otp.attempts = otp.attempts + :one, updatedAt = :ts',
      ExpressionAttributeValues: { ':one': 1, ':ts': ts },
    }),
  );
}

/**
 * Reset OTP status back to pending (lead re-entering OTP after invalid attempt).
 */
async function resetOtpToPending(sessionId) {
  const ts = now();
  await db.send(
    new UpdateCommand({
      TableName:                 TABLE(),
      Key:                       { sessionId },
      UpdateExpression:          'SET otp.#s = :pending, updatedAt = :ts',
      ExpressionAttributeNames:  { '#s': 'status' },
      ExpressionAttributeValues: { ':pending': 'pending', ':ts': ts },
    }),
  );
}

/**
 * Check whether a session is stale (no heartbeat for STALE_SESSION_MINUTES).
 * Returns true if stale.
 */
function isStale(session) {
  const thresholdMs =
    parseInt(process.env.STALE_SESSION_MINUTES || '20', 10) * 60 * 1000;
  return Date.now() - (session.lastHeartbeat || session.updatedAt || 0) > thresholdMs;
}

module.exports = {
  createSession,
  getSession,
  getSessionsByEmail,
  saveSlideData,
  heartbeat,
  markExited,
  markCompleted,
  updateOtpStatus,
  incrementOtpAttempts,
  resetOtpToPending,
  isStale,
};
