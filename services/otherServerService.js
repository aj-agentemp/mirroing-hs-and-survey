/**
 * Other Server (Mirror Automation) Communication Service
 * ───────────────────────────────────────────────────────
 * All outbound HTTP calls to the external mirror/automation server.
 *
 * URLs are fully controlled via .env:
 *   OTHER_SERVER_BASE_URL
 *   OTHER_SERVER_SESSION_INIT_PATH
 *   OTHER_SERVER_OTP_SUBMIT_PATH
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
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Notify the other server that a new session has begun.
 * Called once, immediately after session is created in DynamoDB.
 *
 * POST {OTHER_SERVER_BASE_URL}{OTHER_SERVER_SESSION_INIT_PATH}
 * Body: { sessionId, email, phone }
 *
 * Returns the response data from the other server (or throws on failure).
 */
async function notifySessionStarted({ sessionId, email, phone }) {
  const client = buildClient();
  const path   = process.env.OTHER_SERVER_SESSION_INIT_PATH || '/api/mirror/session/start';

  console.log(`[OtherServer] → notifySessionStarted  sessionId=${sessionId}`);

  const response = await client.post(path, { sessionId, email, phone });
  console.log(`[OtherServer] ← session start OK  status=${response.status}`);
  return response.data;
}

/**
 * Submit OTP to the other server for verification.
 * Called when the lead fills the OTP field.
 *
 * POST {OTHER_SERVER_BASE_URL}{OTHER_SERVER_OTP_SUBMIT_PATH}
 * Body: { sessionId, otp }
 *
 * Returns the response data. The caller should NOT trust this response
 * alone; instead it polls our own DB for otp.status (other server writes
 * back via the internal API).
 */
async function submitOtp({ sessionId, otp }) {
  const client = buildClient();
  const path   = process.env.OTHER_SERVER_OTP_SUBMIT_PATH || '/api/mirror/otp/verify';

  console.log(`[OtherServer] → submitOtp  sessionId=${sessionId}`);

  const response = await client.post(path, { sessionId, otp });
  console.log(`[OtherServer] ← OTP submit OK  status=${response.status}`);
  return response.data;
}

module.exports = { notifySessionStarted, submitOtp };
