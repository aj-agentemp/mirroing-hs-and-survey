/**
 * Internal Routes — called by the OTHER SERVER (not the survey client)
 * ─────────────────────────────────────────────────────────────────────
 * All routes are protected by the INTERNAL_API_SECRET header check.
 *
 * POST /api/internal/session/:sessionId/otp-status
 *   Other server tells us the OTP result (pending → valid | invalid).
 *
 * POST /api/internal/session/:sessionId/plan
 *   Other server saved a plan — mark session completed.
 *
 * POST /api/internal/session/:sessionId/otp-trigger
 *   Other server tells us it has sent an OTP → UI should show popup.
 *
 * GET  /api/internal/session/:sessionId
 *   Other server reads full session data for mirroring.
 *
 * GET  /api/internal/session/by-email/:email
 *   Other server looks up sessions by lead email.
 */

const express    = require('express');
const router     = express.Router();
const sessionSvc = require('../services/sessionService');

// ─── Auth middleware ──────────────────────────────────────────────────────────

function internalAuth(req, res, next) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    // If no secret is configured, allow all internal requests (dev only)
    console.warn('[internal] INTERNAL_API_SECRET not set — skipping auth (NOT recommended in prod)');
    return next();
  }
  const provided = req.headers['x-internal-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  if (provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

router.use(internalAuth);

// ─── POST /api/internal/session/:sessionId/otp-status ────────────────────────
// Other server calls this after verifying OTP.
// Body: { status: 'valid' | 'invalid' }

router.post('/session/:sessionId/otp-status', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { status }    = req.body;

    if (!['valid', 'invalid', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'status must be valid | invalid | pending' });
    }

    const session = await sessionSvc.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await sessionSvc.updateOtpStatus(sessionId, status);
    console.log(`[internal] OTP status updated  sessionId=${sessionId}  status=${status}`);

    return res.json({ ok: true, sessionId, status });
  } catch (err) {
    console.error('[POST /api/internal/session/:id/otp-status]', err);
    return res.status(500).json({ error: 'Failed to update OTP status' });
  }
});

// ─── POST /api/internal/session/:sessionId/otp-trigger ───────────────────────
// Other server tells us it just sent an OTP — flip status to 'pending'
// so the survey client shows the popup.
// Body: {} (no body required — the presence of the call is enough)

router.post('/session/:sessionId/otp-trigger', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await sessionSvc.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Only trigger if current otp status is 'none' (don't re-trigger mid-verify)
    if (session.otp?.status === 'none') {
      await sessionSvc.updateOtpStatus(sessionId, 'pending');
    }

    console.log(`[internal] OTP triggered  sessionId=${sessionId}`);
    return res.json({ ok: true, sessionId, otpStatus: 'pending' });
  } catch (err) {
    console.error('[POST /api/internal/session/:id/otp-trigger]', err);
    return res.status(500).json({ error: 'Failed to trigger OTP' });
  }
});

// ─── POST /api/internal/session/:sessionId/plan ───────────────────────────────
// Other server saved a plan — mark session completed.
// Body: { planId: string }

router.post('/session/:sessionId/plan', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { planId }    = req.body;

    if (!planId) {
      return res.status(400).json({ error: 'planId is required' });
    }

    const session = await sessionSvc.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await sessionSvc.markCompleted(sessionId, planId);
    console.log(`[internal] Session completed with planId  sessionId=${sessionId}  planId=${planId}`);

    return res.json({ ok: true, sessionId, planId, status: 'completed' });
  } catch (err) {
    console.error('[POST /api/internal/session/:id/plan]', err);
    return res.status(500).json({ error: 'Failed to save plan' });
  }
});

// ─── GET /api/internal/session/:sessionId ────────────────────────────────────
// Other server reads full session for mirroring.

router.get('/session/:sessionId', async (req, res) => {
  try {
    const session = await sessionSvc.getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Auto-detect stale
    if (session.status === 'active' && sessionSvc.isStale(session)) {
      await sessionSvc.markExited(session.sessionId);
      session.status = 'exited';
    }

    return res.json(session);
  } catch (err) {
    console.error('[GET /api/internal/session/:id]', err);
    return res.status(500).json({ error: 'Failed to get session' });
  }
});

// ─── GET /api/internal/session/by-email/:email ────────────────────────────────

router.get('/session/by-email/:email', async (req, res) => {
  try {
    const emails = decodeURIComponent(req.params.email);
    const sessions = await sessionSvc.getSessionsByEmail(emails);

    // Sort newest first
    sessions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return res.json({ sessions, count: sessions.length });
  } catch (err) {
    console.error('[GET /api/internal/session/by-email/:email]', err);
    return res.status(500).json({ error: 'Failed to get sessions by email' });
  }
});

module.exports = router;
