# System Architecture — GHL Survey Mirror

```mermaid
sequenceDiagram
    participant Lead as 👤 Lead (Browser)
    participant Tracker as 📜 survey-tracker.js<br/>(injected in GHL survey)
    participant Mirror as 🖥️ Mirror Server<br/>mir.agentemp.com
    participant DB as 🗄️ DynamoDB<br/>survey_sessions
    participant Other as ⚙️ Other Server<br/>(automation bot)

    Note over Lead,Tracker: Lead fills slides 1..N

    Lead->>Tracker: Fills fields on slide 1<br/>(firstName, lastName, email, phone...)
    Lead->>Tracker: Moves to slide 2 (email now captured)
    Tracker->>Mirror: POST /api/session/init<br/>{ email, phone }
    Mirror->>DB: createSession(sessionId, email, phone)
    Mirror-->>Tracker: { sessionId }
    Mirror-)Other: POST /session-started<br/>{ sessionId, email, phone }<br/>(fire & forget — non-blocking)

    Note over Tracker,Mirror: Every 30 seconds while survey is open
    loop Heartbeat (keeps session alive)
        Tracker->>Mirror: POST /api/session/heartbeat { sessionId }
        Mirror->>DB: update lastHeartbeat timestamp
    end

    Note over Lead,Tracker: On every slide change (previous slide data saved)
    Lead->>Tracker: Moves to slide 3
    Tracker->>Mirror: POST /api/session/slide-data<br/>{ sessionId, slideName:"slide2", fields:{address,city,...} }
    Mirror->>DB: merge fields into session.slides.slide2

    Lead->>Tracker: Moves to slide 4
    Tracker->>Mirror: POST /api/session/slide-data<br/>{ sessionId, slideName:"slide3", fields:{dob,ssn,...} }
    Mirror->>DB: merge fields into session.slides.slide3

    Note over Other,DB: Other server polls continuously for field data
    loop Poll every few seconds
        Other->>Mirror: GET /api/session/:sessionId
        Mirror->>DB: getSession(sessionId)
        DB-->>Mirror: full session with all slide data so far
        Mirror-->>Other: session JSON (slides, status, otp, etc.)
    end

    Note over Lead,Other: OTP Flow — triggered by Other Server
    Other->>Mirror: POST /internal/otp-trigger { sessionId }
    Mirror->>DB: set otp.status = "pending"

    loop Client polls for OTP trigger
        Tracker->>Mirror: GET /api/session/:id/otp-status
        Mirror-->>Tracker: { otp: { status:"pending" } }
    end

    Tracker->>Lead: 🔒 Show OTP popup modal (blocks survey)

    Lead->>Tracker: Enters OTP code in #otp field
    Tracker->>Mirror: POST /api/session/otp-submit { sessionId, otp }
    Mirror->>DB: increment otp.attempts, set status = "pending"
    Mirror-)Other: POST /otp-verify { sessionId, otp }<br/>(fire & forget)

    Other->>Mirror: PUT /internal/otp-status<br/>{ sessionId, status:"valid"|"invalid" }
    Mirror->>DB: set otp.status = "valid" or "invalid"

    loop Client polls for OTP result
        Tracker->>Mirror: GET /api/session/:id/otp-status
        Mirror-->>Tracker: { otp: { status:"valid"|"invalid" } }
    end

    alt OTP valid
        Tracker->>Lead: ✅ Close modal — resume survey
    else OTP invalid (attempt < 3)
        Tracker->>Lead: ❌ Show error — clear field, allow retry
        Note over Tracker,DB: Reset otp.status = "pending" for next attempt
    else 3 invalid attempts
        Tracker->>Lead: ⚠️ Close modal — let lead continue anyway
    end

    Note over Lead,DB: Session end — 3 possible outcomes

    alt Lead reaches last slide OR plan_id saved in DB
        Mirror->>DB: status = "completed"
        Note over Other: Other server sees status=completed → stops polling
    else Lead explicitly closes tab / navigates away
        Tracker->>Mirror: POST /api/session/exit (beforeunload)
        Mirror->>DB: status = "exited"
    else No heartbeat for 20 minutes (stale)
        Note over Mirror,DB: Auto-detected on next GET /api/session/:id
        Mirror->>DB: status = "exited"
    end
```

---

## Key Points

| Component | Role |
|-----------|------|
| `survey-tracker.js` | Injected into GHL survey page. Watches slide changes, captures field values, fires all API calls |
| `Mirror Server` | Node/Express on `mir.agentemp.com:9000`. Stores data, coordinates between survey and Other Server |
| `DynamoDB survey_sessions` | Source of truth. Stores session, all slide field data, OTP state, heartbeat timestamp |
| `Other Server` | Automation bot. Polls Mirror Server to read field data and fill a parallel form in real time |

## Session States

```
pre-init  →  active  →  completed
                 ↓
               exited  (explicit or stale 20min)
```

## API Quick Reference

| Method | Endpoint | Called by |
|--------|----------|-----------|
| POST | `/api/session/init` | Tracker (on email capture) |
| POST | `/api/session/slide-data` | Tracker (on slide change) |
| POST | `/api/session/heartbeat` | Tracker (every 30s) |
| POST | `/api/session/exit` | Tracker (tab close) |
| POST | `/api/session/otp-submit` | Tracker (OTP field filled) |
| GET  | `/api/session/:id` | Other Server (polling) |
| GET  | `/api/session/:id/otp-status` | Tracker + Other Server |
| POST | `/internal/otp-trigger` | Other Server → Mirror |
| PUT  | `/internal/otp-status` | Other Server → Mirror |
