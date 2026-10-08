# Tap-to-Attend

Local-first student attendance system using Web NFC in Chrome on Android with a Google Apps Script backend and Google Sheets interface for AASTU.

## Architecture

- **Frontend:** Pure HTML5, CSS, and Vanilla JavaScript with Service Worker caching (`localStorage` + offline-first). Zero build tools, zero external CDNs or npm dependencies.
- **Hardware:** MIFARE Classic 1K student ID cards read via Web NFC (`NDEFReader.scan()`).
- **Backend:** Google Apps Script web app handling idempotent batch synchronization, registration, and logging.
- **Storage:** 
  - *Private Spreadsheet:* Registry, Courses, Sessions, Log, and Audit tabs.
  - *Public Spreadsheet:* View-only student attendance grid (Names and P/A only, no UIDs or IDs).

## Project Structure

```
├── index.html                  # Main tap application interface
├── nfc-test.html               # Standalone diagnostic tool for reading card UIDs
├── sw.js                       # Offline caching service worker
├── manifest.webmanifest        # Progressive Web App manifest
├── apps-script/
│   ├── Code.gs                 # Google Apps Script backend source
│   └── appsscript.json         # Apps Script configuration (Africa/Addis_Ababa timezone)
├── test/
│   └── endpoint-test.mjs       # Node.js backend integration test suite
└── README.md
```

## Security & Data Privacy

- **No Secrets in Repo:** PIN and spreadsheet IDs are stored exclusively in Google Apps Script Script Properties.
- **Public Sheet Privacy:** The public spreadsheet contains only student names and attendance markers (`P`/`A`). No student IDs or card UIDs are ever exposed.
- **Sample Data:** Only fake sample data (e.g. `TEST001`, `04:a1:b2:c3`) is used in test suites and examples.
