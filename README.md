# Tap-to-Attend (v1.0.0 Production Release)

> **Local-first NFC student attendance system built for Joe (Class Representative) at Addis Ababa Science and Technology University (AASTU).**

---

## 📌 Architecture Overview

```
                 [Samsung Galaxy A25 Phone]
    ┌──────────────────────────────────────────────────┐
    │  Web NFC (Chrome on Android)                     │
    │  ├─ Tap MIFARE Classic 1K Cards (UID read)       │
    │  ├─ Service Worker (Offline Cache-First Shell)   │
    │  ├─ Indexed / LocalStorage Event Queue (FIFO)    │
    │  └─ Web Audio Synthesizer (880Hz / 440Hz / 220Hz)│
    └────────────────────────┬─────────────────────────┘
                             │  HTTPS JSON Sync (25/chunk)
                             ▼
    ┌──────────────────────────────────────────────────┐
    │  Google Apps Script Web App Backend              │
    │  ├─ Mutex Lock (LockService 30s)                 │
    │  ├─ Server-side Late-Resolution                  │
    │  ├─ Timezone: Africa/Addis_Ababa                 │
    │  └─ Idempotent Sync & Duplicate Protection       │
    └──────────────┬───────────────────┬───────────────┘
                   │                   │
                   ▼                   ▼
    ┌─────────────────────────┐  ┌─────────────────────────┐
    │ Attendance Private      │  │ Attendance View (Public)│
    │ ├─ Registry (Students)  │  │ ├─ Course Tabs           │
    │ ├─ Courses (Offerings)  │  │ ├─ Student Names Only    │
    │ ├─ Sessions (Metadata)  │  │ ├─ Date Columns (P / A)  │
    │ ├─ Log (Audit Trail)    │  │ └─ COUNTIF Total Formu- │
    │ └─ Audit (Replacements) │  │    las (Zero UID Leak)   │
    └─────────────────────────┘  └─────────────────────────┘
```

---

## 🚀 Key Features

* **⚡ Ultra-Fast Local First Scanning:** 0ms UI latency. Instant audio feedback (880Hz high beep for present, 440Hz double beep for duplicates, 220Hz low buzz for unknown cards) and haptic vibration.
* **📴 100% Offline Capable:** Runs entirely in airplane mode with full roster searching, local session state, offline PIN hashing (salted SHA-256), and PWA Service Worker caching.
* **🔄 Robust Idempotent Sync:** Auto-syncs in 25-event chunks with exponential backoff (5s–60s) on reconnect or window focus. Re-sending identical taps never causes duplicate entries.
* **🪪 Live Card Registration & Late-Resolve:** Register student cards in real-time or late-resolve past unknown taps into verified attendance records automatically upon registration.
* **✍️ Manual Attendance Override:** Searchable picker with quick-reason chips (`Card forgotten`, `Broken card`, `Phone / NFC issue`, `No card yet`) enforcing $\ge 3$ characters justification.
* **🔒 Privacy & Security:** Public view sheet displays ONLY student names and `P`/`A` markers with conditional formatting. Student IDs and card UIDs are never published.

---

## 🛠️ Project Structure

```
├── index.html                  # Main tap PWA interface (v1.0.0)
├── nfc-test.html               # Diagnostic reader to verify card hardware UIDs
├── sw.js                       # Service Worker for offline app shell caching
├── manifest.webmanifest        # Progressive Web App manifest
├── apps-script/
│   ├── Code.gs                 # Complete Google Apps Script backend router & logic
│   └── appsscript.json         # Apps Script configuration (Africa/Addis_Ababa timezone)
├── test/
│   ├── endpoint-test.mjs       # 15-assertion backend integration test suite
│   └── load-simulation.mjs     # 50-event batch load & stress simulation test
└── README.md
```

---

## 📖 Daily Operating Guide for Class Rep (Joe)

### 1. Before Class (Setup & Verification)
1. Open Chrome on your Samsung Galaxy A25 and open the PWA.
2. Enter your Admin PIN (`1234` or configured PIN) to unlock.
3. If connected to campus Wi-Fi or mobile data, tap **🔄 Sync Now** or **Refresh Roster** to ensure the latest student registry is cached locally.

### 2. During Class (Taking Attendance)
1. Select the Course (e.g. `Applied Mathematics III`) and tap **▶️ Start Session**.
2. Hold your phone near students as they enter or pass it down rows.
3. Students tap their ID cards against the upper back of the phone:
   * **Green Screen + 880Hz Chime:** Student marked present. Counter increments.
   * **Yellow Screen + Double Beep:** Student already tapped. No duplicate created.
   * **Red Screen + 220Hz Buzz:** Unregistered card. Logged as `unknown_uid`.
4. **Student Forgot / Damaged Card?**
   * Tap **✍️ Manual Override (No Card)**.
   * Search student name or ID.
   * Tap a quick chip (e.g. `Card forgotten`) and tap **Mark Present**.

### 3. After Class (Ending Session & Sync)
1. Tap **End Session**.
2. Check the sync badge:
   * **`Synced` (Green):** All records safely pushed to Google Sheets.
   * **`X unsynced` (Yellow):** Turn on Wi-Fi / mobile data and tap **🔄 Sync Now**.
3. **Emergency Backup:** Tap **📋 Copy Backup** to copy JSON data to clipboard if network is unavailable.

---

## 🧪 Running Automated Tests

Ensure Node.js 18+ is installed. In PowerShell, run:

```powershell
$env:SCRIPT_URL="https://script.google.com/macros/s/YOUR_EXEC_URL/exec"
$env:PIN="1234"

# 1. Run Core Integration Test Suite (15 assertions)
node test/endpoint-test.mjs

# 2. Run 50-Event Batch Load Simulation Suite
node test/load-simulation.mjs
```

---

## 🛡️ Data Privacy Policy

* **No Secrets Committed:** Passwords, private tokens, and sheet IDs are never stored in client code or Git.
* **Public Attendance View:** Only contains student names and session dates. Formulas (`=COUNTIF(...)`) compute totals automatically.
* **Audit Trail:** Every registration change and manual override is permanently logged in the private `Audit` and `Log` tabs with timestamp and reason.
