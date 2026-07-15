# System Architecture

```mermaid
flowchart TD
    Lead["👤 Lead\n(GHL Survey)"]
    Tracker["📜 survey-tracker.js\ninjected in survey page"]
    Mirror["🖥️ Mirror Server\nmir.agentemp.com"]
    DB[("🗄️ DynamoDB\nsurvey_sessions")]
    Other["⚙️ Other Server\nautomation bot"]

    %% Lead fills survey
    Lead -->|"fills fields,\nchanges slides"| Tracker

    %% Tracker → Mirror
    Tracker -->|"1  email captured →\nPOST /session/init"| Mirror
    Tracker -->|"2  slide changes →\nPOST /session/slide-data"| Mirror
    Tracker -->|"3  every 30s →\nPOST /session/heartbeat"| Mirror
    Tracker -->|"4  tab close →\nPOST /session/exit"| Mirror
    Tracker -->|"5  OTP entered →\nPOST /session/otp-submit"| Mirror

    %% Mirror ↔ DB
    Mirror <-->|"read / write\nsession + slide fields"| DB

    %% Mirror → Other Server (push events)
    Mirror -->|"A  on session init →\nnotify session started\n{ sessionId, email, phone }"| Other
    Mirror -->|"B  on OTP submit →\nforward OTP code\n{ sessionId, otp }"| Other

    %% Other Server → Mirror (push + poll)
    Other -->|"C  triggers OTP popup →\nPOST /internal/otp-trigger"| Mirror
    Other -->|"D  sets OTP result →\nPUT /internal/otp-status"| Mirror
    Other -->|"E  polls for field data →\nGET /session/:id"| Mirror

    %% Styling
    style Lead fill:#f0f4ff,stroke:#4a6fa5
    style Tracker fill:#fff3cd,stroke:#e6a817
    style Mirror fill:#d4edda,stroke:#28a745
    style DB fill:#f8d7da,stroke:#dc3545
    style Other fill:#e2d9f3,stroke:#6f42c1
```

---

## When each API is called

| # | Who calls | Endpoint | When |
|---|-----------|----------|------|
| 1 | Tracker → Mirror | `POST /session/init` | Lead's email is captured (session created) |
| 2 | Tracker → Mirror | `POST /session/slide-data` | Lead moves to next slide (saves previous slide fields) |
| 3 | Tracker → Mirror | `POST /session/heartbeat` | Every 30 seconds (keeps session alive) |
| 4 | Tracker → Mirror | `POST /session/exit` | Lead closes/leaves the tab |
| 5 | Tracker → Mirror | `POST /session/otp-submit` | Lead types OTP in the popup modal |
| A | Mirror → Other | `notify session started` | Immediately after session init |
| B | Mirror → Other | `forward OTP` | Immediately after OTP submit |
| C | Other → Mirror | `POST /internal/otp-trigger` | When Other Server wants to show OTP popup |
| D | Other → Mirror | `PUT /internal/otp-status` | After Other Server validates OTP |
| E | Other → Mirror | `GET /session/:id` | Continuously polling for latest field data |

## What's stored in DynamoDB per session

```
session {
  sessionId        ← unique UUID
  email            ← lead's email
  phone            ← lead's phone
  status           ← active | exited | completed
  lastHeartbeat    ← timestamp (stale if > 20 min ago)
  slides {
    slide1: { firstName, lastName, email, phone, ... }
    slide2: { address, city, state, zip, ... }
    slide3: { dob, ssn, gender, ... }
    ...
  }
  otp {
    status         ← pending | valid | invalid
    attempts       ← 0–3
  }
}
```
