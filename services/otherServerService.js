/**
 * Other Server (Mirror Automation) Communication Service
 * ───────────────────────────────────────────────────────
 * Outbound HTTP calls to the external mirror/automation server.
 *
 * We keep this intentionally minimal — the other server is expected
 * to poll our GET /session/:id for field data and OTP values.
 * We only push ONE event to them:
 *
 *   ① Session started — so they can kick off their automation.
 *
 * URL controlled via .env:
 *   OTHER_SERVER_BASE_URL
 *   OTHER_SERVER_SESSION_INIT_PATH
 */

const axios = require('axios');

function buildClient() {
  const baseURL = process.env.OTHER_SERVER_BASE_URL;

  if (!baseURL) {
    throw new Error('OTHER_SERVER_BASE_URL is not configured in .env');
  }

  return axios.create({
    baseURL,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Notify the other server that a new session has begun.
 * Called once — immediately after session is created in DynamoDB.
 *
 * POST {OTHER_SERVER_BASE_URL}{OTHER_SERVER_SESSION_INIT_PATH}
 * Body: { sessionId, email, phone }
 */
async function notifySessionStarted({ sessionId, email, phone }) {
  const client = buildClient();
  const path   = process.env.OTHER_SERVER_SESSION_INIT_PATH || '/api/mirror/session/start';

  console.log(`[OtherServer] → notifySessionStarted  sessionId=${sessionId}`);
  const response = await client.post(path, { sessionId, email, phone });
  console.log(`[OtherServer] ← session start OK  status=${response.status}`);
  return response.data;
}

// NOTE: OTP is NOT forwarded to other server via API call.
// When lead submits OTP we save it to DynamoDB (otp.value + status=pending).
// Other server reads it from GET /session/:id, validates it on their side,
// then calls our PUT /internal/otp-status to write back valid/invalid.

module.exports = { notifySessionStarted };
