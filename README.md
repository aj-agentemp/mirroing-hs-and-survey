# GHL Survey Mirror Server

Real-time session tracking for GHL (GoHighLevel) surveys with DynamoDB persistence, heartbeat monitoring, OTP popup, and a polling API for your mirror/automation server.

---

## Architecture Overview

```
GHL Survey (browser)
      │  survey-tracker.js (injected)
      │
      ▼
Mirror Server (this app)          ←─── Other Server polls/calls
  ├── /api/session/*                        ├── GET /api/internal/session/:id
  ├── /api/internal/*                       ├── POST /api/internal/session/:id/otp-trigger
  └── DynamoDB: Survey-MirrorSessions       └── POST /api/internal/session/:id/plan
```

### Flow

1. Lead opens GHL survey → `survey-tracker.js` is injected
2. Tracker fetches `GET /tracker-config` → gets slide selectors
3. Email field blur / slide advance → `POST /api/session/init` with `{email, phone}`
4. Server creates DynamoDB record + calls Other Server `session/start`
5. On every slide change → `POST /api/session/slide-data` with previous slide fields
6. Every 30 s → `POST /api/session/heartbeat`
7. On tab/window close → `POST /api/session/exit` (via `sendBeacon`)
8. Other server sends OTP → calls `POST /api/internal/session/:id/otp-trigger`
9. Tracker polls `GET /api/session/:id/otp-status` — when `pending`, shows OTP modal
10. Lead submits OTP → `POST /api/session/otp-submit` → forwarded to Other Server
11. Other server verifies OTP → calls `POST /api/internal/session/:id/otp-status` `{status: 'valid'|'invalid'}`
12. Tracker sees result from poll → closes modal (valid) or allows retry (invalid, max 3 attempts)
13. Session marked `completed` when lead reaches last slide OR Other Server calls `POST /api/internal/session/:id/plan`

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy .env.example and fill in your values
cp .env.example .env

# 3. Create DynamoDB table (run once)
npm run setup-table

# 4. Start server
npm start          # production
npm run dev        # development (nodemon)
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default `4000`) |
| `AWS_REGION` | AWS region for DynamoDB |
| `AWS_ACCESS_KEY_ID` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `DYNAMODB_SESSIONS_TABLE` | Table name (`Survey-MirrorSessions`) |
| `HEARTBEAT_INTERVAL_MS` | Heartbeat interval in ms (default `30000`) |
| `STALE_SESSION_MINUTES` | Minutes with no heartbeat = exited (default `20`) |
| `OTHER_SERVER_BASE_URL` | Base URL of your automation server |
| `OTHER_SERVER_SESSION_INIT_PATH` | Path called on session start |
| `OTHER_SERVER_OTP_SUBMIT_PATH` | Path called with OTP value |
| `OTHER_SERVER_API_KEY` | API key sent to other server |
| `OTHER_SERVER_API_KEY_HEADER` | Header name for the API key |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins |
| `INTERNAL_API_SECRET` | Secret for other server → us calls |
| `SERVER_PUBLIC_URL` | Public URL injected into `tracker.js` |

---

## API Reference

### Survey Client APIs (called by `survey-tracker.js`)

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/session/init` | `{email, phone}` | Create session (call after email captured) |
| `POST` | `/api/session/slide-data` | `{sessionId, slideName, fields}` | Save previous slide fields |
| `POST` | `/api/session/heartbeat` | `{sessionId}` | Keep session alive |
| `POST` | `/api/session/exit` | `{sessionId}` | Mark session exited |
| `POST` | `/api/session/otp-submit` | `{sessionId, otp}` | Submit OTP (forwarded to other server) |
| `GET` | `/api/session/:sessionId` | — | Full session read |
| `GET` | `/api/session/:sessionId/otp-status` | — | Poll OTP status |

### Internal APIs (called by Other Server)

All require header: `x-internal-secret: <INTERNAL_API_SECRET>`

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/internal/session/:id/otp-trigger` | `{}` | Tell survey client to show OTP modal |
| `POST` | `/api/internal/session/:id/otp-status` | `{status: 'valid'\|'invalid'}` | Set OTP verification result |
| `POST` | `/api/internal/session/:id/plan` | `{planId}` | Save plan, mark session completed |
| `GET` | `/api/internal/session/:id` | — | Read full session (with stale check) |
| `GET` | `/api/internal/session/by-email/:email` | — | Find sessions by email |

### Tracker Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/tracker-config` | Slide+field selector map (JSON) |
| `GET` | `/tracker.js` | Client script with `SERVER_URL` injected |
| `GET` | `/health` | Health check |

---

## Injecting the Tracker into GHL Survey

In GHL, add a custom code injection (head or body):

```html
<script src="https://YOUR_MIRROR_SERVER/tracker.js" defer></script>
```

The script auto-initializes, fetches config, and tracks everything.

---

## Session Data Shape (DynamoDB)

```json
{
  "sessionId":      "uuid-v4",
  "email":          "lead@example.com",
  "phone":          "+15551234567",
  "status":         "active | exited | completed",
  "currentSlide":   "slide3",
  "slides": {
    "slide1": { "firstName": "John", "email": "...", "phone": "..." },
    "slide2": { "address": "...", "city": "..." }
  },
  "otp": {
    "status":   "none | pending | valid | invalid",
    "attempts": 0
  },
  "planId":         null,
  "createdAt":      1721000000000,
  "updatedAt":      1721000000000,
  "lastHeartbeat":  1721000000000,
  "ttl":            1721604800
}
```

---

## Editing Slide Fields

All selectors live in **`config/slides.js`** only.

- Add a field → add it to the slide map in `config/slides.js`
- Remove a field → delete it from `config/slides.js`
- Move a field to another slide → cut/paste between slide objects

No other file needs to change.

---

## Session Lifecycle

| Status | Meaning |
|---|---|
| `active` | Session running, heartbeats being received |
| `exited` | Lead closed tab / no heartbeat for 20+ min |
| `completed` | Lead reached last slide OR `plan` was saved |

Stale detection fires:
- per-request on `GET /api/session/:id` and `GET /api/internal/session/:id`
- passively via the 5-minute sweeper interval in `server.js`

---

## OTP Modal Behaviour

1. Other server sends OTP to lead and calls → `POST /api/internal/session/:id/otp-trigger`
2. Survey tracker polls every 2 s; sees `otp.status === 'pending'` → shows full-screen blur modal
3. Lead enters OTP → `POST /api/session/otp-submit` → forwarded to other server
4. Tracker polls until `otp.status` changes to `valid` or `invalid`
5. **Valid** → modal closes, survey continues
6. **Invalid** + attempts < 3 → shows error with email/phone, clears field, allows retry, resets status to `pending`
7. **Invalid** + attempts ≥ 3 → shows final error, modal auto-closes after 3 s, survey resumes
