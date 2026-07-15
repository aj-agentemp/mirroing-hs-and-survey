# System Architecture

```mermaid
flowchart TD
    Survey["👤 GHL Survey\n(tracker script in browser)"]
    Mirror["🖥️ Mirror Server\nmir.agentemp.com"]
    DB[("🗄️ DynamoDB\nsurvey_sessions")]
    Other["⚙️ Other Server\nautomation bot"]

    Survey -->|"POST /session/init\nPOST /session/slide-data\nPOST /session/heartbeat\nPOST /session/exit\nPOST /session/otp-submit"| Mirror

    Mirror -->|"write — session, slide fields,\nOTP value + status, heartbeat"| DB
    DB -->|"read — session by sessionId"| Mirror

    Mirror -->|"POST /session-started\n(on session init — fire & forget)\n{ sessionId, email, phone }"| Other

    Other -->|"POST /internal/otp-trigger  ➜  show OTP popup\nPUT  /internal/otp-status   ➜  set valid/invalid"| Mirror

    Other -->|"poll field data + OTP value\nGET /session/:id"| DB

    style Survey fill:#fef9c3,stroke:#ca8a04,color:#000
    style Mirror fill:#dcfce7,stroke:#16a34a,color:#000
    style DB     fill:#fee2e2,stroke:#dc2626,color:#000
    style Other  fill:#ede9fe,stroke:#7c3aed,color:#000
```

## OTP Flow (simplified)

```mermaid
sequenceDiagram
    participant Lead as 👤 Lead
    participant Survey as 📜 Tracker
    participant Mirror as 🖥️ Mirror
    participant DB as 🗄️ DB
    participant Other as ⚙️ Other Server

    Other->>Mirror: POST /internal/otp-trigger
    Mirror->>DB: otp.status = "pending" (trigger=true)
    Survey->>Mirror: poll GET /session/:id/otp-status
    Mirror-->>Survey: otp.status = "pending" → show modal

    Lead->>Survey: enters OTP
    Survey->>Mirror: POST /session/otp-submit { otp }
    Mirror->>DB: save otp.value, status=pending, attempts++

    Other->>DB: poll GET /session/:id → reads otp.value
    Other->>Mirror: PUT /internal/otp-status { status: valid|invalid }
    Mirror->>DB: otp.status = valid | invalid

    Survey->>Mirror: poll GET /session/:id/otp-status
    Mirror-->>Survey: otp.status = valid → close modal ✅
    Note over Survey: if invalid: clear field, reset to pending, retry<br/>after 3 failures: close modal anyway
```

## What Other Server needs to implement (just 1 endpoint)

| Endpoint | Called by | When | Payload |
|----------|-----------|------|---------|
| `POST /api/mirror/session/start` | Mirror Server | On session init | `{ sessionId, email, phone }` |

That's it. Everything else goes through our APIs.

## Other Server calls back on our server (2 endpoints)

| Endpoint | When |
|----------|------|
| `POST /internal/otp-trigger` | When they want to show OTP popup to lead |
| `PUT /internal/otp-status` | After validating OTP — sets `valid` or `invalid` |
