/**
 * Tracker Config Route
 * ─────────────────────
 * GET /tracker-config
 *   Returns the slide + field config as JSON so the injected survey
 *   client script can read the selectors without hard-coding them.
 *
 * GET /tracker.js
 *   Serves the survey-tracker.js client script with the server URL
 *   baked in (via template substitution).
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

const { SLIDES, EMAIL_FIELD, PHONE_FIELD, LAST_SLIDE } = require('../config/slides');

// ─── GET /tracker-config ──────────────────────────────────────────────────────

router.get('/tracker-config', (req, res) => {
  res.json({
    slides:      SLIDES,
    emailField:  EMAIL_FIELD,
    phoneField:  PHONE_FIELD,
    lastSlide:   LAST_SLIDE,
    heartbeatMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000', 10),
  });
});

// ─── GET /tracker.js ──────────────────────────────────────────────────────────
// Serves the client tracker script with __SERVER_URL__ replaced.

router.get('/tracker.js', (req, res) => {
  const filePath = path.join(__dirname, '../public/survey-tracker.js');

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('// survey-tracker.js not found');
  }

  // SERVER_PUBLIC_URL must be set — never fall back to localhost in production.
  const serverUrl = process.env.SERVER_PUBLIC_URL;

  if (!serverUrl) {
    const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (isProduction) {
      console.error(
        '[trackerConfig] ❌ SERVER_PUBLIC_URL is not set! ' +
        'tracker.js cannot be served without it. ' +
        'Set SERVER_PUBLIC_URL=https://your-domain.com in .env'
      );
      return res.status(500)
        .type('application/javascript')
        .send(
          '/* ERROR: SERVER_PUBLIC_URL is not configured on this server.\n' +
          ' * Set SERVER_PUBLIC_URL=https://your-domain.com in the .env file\n' +
          ' * and restart the server. Survey tracking is disabled. */'
        );
    }
    // Dev-only: allow localhost fallback but warn clearly
    const devUrl = `http://localhost:${process.env.PORT || 4000}`;
    console.warn(
      `[trackerConfig] ⚠️  SERVER_PUBLIC_URL not set — using dev fallback: ${devUrl}\n` +
      '             Set SERVER_PUBLIC_URL in .env for production!'
    );
    let script = fs.readFileSync(filePath, 'utf8');
    script = script.replace(/__SERVER_URL__/g, devUrl);
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(script);
  }

  let script = fs.readFileSync(filePath, 'utf8');
  script = script.replace(/__SERVER_URL__/g, serverUrl);

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(script);
});

module.exports = router;
