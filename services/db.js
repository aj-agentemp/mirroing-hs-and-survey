/**
 * DynamoDB Document Client — shared singleton
 */

const { DynamoDBClient }    = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const rawClient = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const db = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions:   { removeUndefinedValues: true },
  unmarshallOptions: { wrapNumbers: false },
});

const TABLE = () => process.env.DYNAMODB_SESSIONS_TABLE || 'Survey-MirrorSessions';

module.exports = { db, TABLE };
