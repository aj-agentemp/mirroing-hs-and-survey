/**
 * DynamoDB Table Setup Script
 * Run once: node scripts/setup-dynamodb.js
 *
 * Creates the Survey-MirrorSessions table if it does not already exist.
 * Does NOT touch any existing tables.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const TABLE_NAME = process.env.DYNAMODB_SESSIONS_TABLE || 'Survey-MirrorSessions';

async function tableExists(name) {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') return false;
    throw err;
  }
}

async function createTable() {
  const exists = await tableExists(TABLE_NAME);
  if (exists) {
    console.log(`✅  Table "${TABLE_NAME}" already exists — nothing to do.`);
    return;
  }

  console.log(`⏳  Creating table "${TABLE_NAME}" …`);

  await client.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: 'PAY_PER_REQUEST',

      AttributeDefinitions: [
        { AttributeName: 'sessionId', AttributeType: 'S' },
        { AttributeName: 'email',     AttributeType: 'S' },
      ],

      KeySchema: [
        { AttributeName: 'sessionId', KeyType: 'HASH' },
      ],

      GlobalSecondaryIndexes: [
        {
          IndexName: 'email-index',
          KeySchema: [
            { AttributeName: 'email', KeyType: 'HASH' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],

      // Auto-delete stale items after TTL expires (DynamoDB TTL attribute)
      // We set `ttl` field on each item = createdAt + 7 days (cleanup)
      // Enable TTL separately in the AWS Console or uncomment line below once table exists.
      // TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    }),
  );

  console.log(`✅  Table "${TABLE_NAME}" created successfully.`);
  console.log('');
  console.log('⚠️   OPTIONAL: Enable TTL on the table for automatic cleanup:');
  console.log(`     aws dynamodb update-time-to-live \\`);
  console.log(`       --table-name ${TABLE_NAME} \\`);
  console.log(`       --time-to-live-specification "Enabled=true,AttributeName=ttl"`);
}

createTable().catch((err) => {
  console.error('❌  Failed to create table:', err.message);
  process.exit(1);
});
