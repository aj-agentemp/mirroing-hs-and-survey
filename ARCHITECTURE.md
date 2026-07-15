# System Architecture

```mermaid
flowchart LR
    subgraph Survey["GHL Survey  (browser)"]
        Lead["👤 Lead"]
        Tracker["📜 Tracker Script"]
    end

    subgraph Backend["Mirror Server  —  mir.agentemp.com"]
        Mirror["🖥️ Express API"]
        DB[("🗄️ DynamoDB")]
    end

    subgraph Automation["Other Server  (automation bot)"]
        Other["⚙️ Bot"]
    end

    Lead -- "fills fields &\nchanges slides" --> Tracker

    Tracker -- "session init\nslide data\nheartbeat\nexit\notp submit" --> Mirror

    Mirror -- "read / write\nsession data" --> DB

    Mirror -- "① session started\n② otp forward" --> Other

    Other -- "③ otp trigger\n④ otp result\n⑤ poll session data" --> Mirror

    style Survey fill:#fefce8,stroke:#ca8a04
    style Backend fill:#f0fdf4,stroke:#16a34a
    style Automation fill:#faf5ff,stroke:#7c3aed
```

### How it works

**Survey side**
1. Lead fills the survey — tracker script monitors field changes
2. When email is captured → `session/init` → session created in DB
3. On every slide change → `session/slide-data` → fields saved to DB
4. Every 30s → `session/heartbeat` → keeps session alive
5. On tab close → `session/exit` → marks session exited

**Mirror Server**
- Stores everything in DynamoDB (`survey_sessions` table)
- On session init → calls Other Server *(fire & forget)*
- On OTP submit → forwards OTP to Other Server *(fire & forget)*

**Other Server**
- Polls `GET /session/:id` to read the latest field data in real time
- Calls `POST /internal/otp-trigger` when it wants to show the OTP popup
- Calls `PUT /internal/otp-status` to set OTP result (valid / invalid)

**Session ends when:**
- Lead reaches last slide or plan is saved → `status: completed`
- Lead closes the tab → `status: exited`
- No heartbeat for 20 minutes → auto-marked `exited`
