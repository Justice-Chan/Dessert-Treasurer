# Architecture

Dessert Treasurer is a Tauri desktop application with macOS packaging and a Windows x64 preview. The books (entries, claims, accounts, reconciliations, locked months, trash) are shared with the web dashboard through a cloud ledger behind the Apps Script backend, described in [Web dashboard](WEB_DASHBOARD.md); people, activities and settings stay on the computer. The frontend manages the interface and accounting workflows; the Rust backend provides SQLite storage, attachments, automatic backups, exports, spreadsheet parsing, external links and native printing.

## Repository layout

```text
frontend/
  index.html             Application markup and dialogs
  styles/app.css         Layout, components, responsive and print styles
  scripts.json           Ordered JavaScript source manifest
  js/
    bootstrap.js         Startup and initialization
    core/
      state.js           Defaults, normalization, shared state, native bridge
      receipts.js        Browser/native attachment operations
      accounting.js      Balances, locks, persistence, expired-trash cleanup
    features/
      imports.js         People/activity spreadsheets, links, synonyms, sync
      people.js          People and activity editing, attendance, payments
      ledger.js          Ledger entries, claims (in a dialog), payments and revocation
      accounts.js        Accounts and payees (in dialogs), QR images, month-end reconciliation
      reports.js         Monthly report markup, A4 pagination and printing
      backups.js         Backup page, exports to a chosen folder, restore with a pre-restore copy
      sync.js            Cloud ledger sync: record-by-record uploads, cloud copy on conflict
      trash.js           Soft deletion, restoration and purging
    ui/
      calendar.js        Date/time formatting and date controls
      render.js          Shared form helpers and section rendering
      dialogs.js         Confirmation dialogs
      events.js          Form submissions and delegated UI event handlers
web/                     Web dashboard, see WEB_DASHBOARD.md
backend/                 Apps Script backend: claims, cloud ledger, reports, backups
src-tauri/
  src/main.rs            Desktop executable entry point
  src/lib.rs             Native commands, storage and native tests
  src/platform/mod.rs    Cross-platform URL opening and bounded HTTPS downloads
  capabilities/          Tauri permissions
  icons/                 Generated application icons
  Cargo.toml             Rust dependencies
  Cargo.lock             Locked Rust dependency versions
  tauri.conf.json        App identity, window and packaging configuration
  tauri.macos.conf.json  macOS packaging overrides
  tauri.windows.conf.json Windows packaging overrides
assets/                  Editable icon source
scripts/                 Build, signing, installation and test server
tests/                   Build checks and browser workflow tests
docs/                    User, development, architecture and project policies
.github/                 CI, dependency updates and contribution templates
```

## Build flow

```text
frontend/index.html + frontend/styles/
                            -> dist/index.html + dist/styles/
frontend/scripts.json + frontend/js/
                            -> dist/app.js
dist/ + src-tauri/           -> macOS .app / .dmg or Windows installer
```

`npm run build:web` copies the markup and styles and concatenates JavaScript in manifest order. It checks the combined script's syntax before replacing the build output. The Tauri build runs this command automatically.

The source files share one classic-script scope rather than ES module imports. Function declarations and state are shared across source files in the combined output. Independent script tags are not interchangeable with this build: early state initialization relies on declarations in later files being available. `bootstrap.js` is last in the manifest and starts the app once.

Native storage and command registration live in `lib.rs`. SQLite keeps each list whose items carry a distinct id (entries, claims, people…) one record per row with the list's order beside it, and any other value as one row; the frontend sends only the records and values that changed since the last save. Cross-platform URL opening and bounded HTTPS downloads live in `platform/mod.rs`; platform libraries handle operating-system differences. The shared data model and app identifier are independent of platform packaging overrides.

## Finding a change

| Change | Start here |
| --- | --- |
| Field labels, controls or dialog markup | `frontend/index.html` |
| Spacing, responsive layout, print appearance | `frontend/styles/app.css` |
| Spreadsheet headers, payment synonyms, recurring imports | `frontend/js/features/imports.js` |
| Person, activity or payment editing | `frontend/js/features/people.js` |
| Report pagination or PDF content | `frontend/js/features/reports.js` |
| Backup formats and validation | `frontend/js/features/backups.js` |
| SQLite, attachments, automatic backup, exports, native commands | `src-tauri/src/lib.rs` |
| Cloud ledger sync | `frontend/js/features/sync.js`, `backend/Ledger.js` |
| Web dashboard pages | `web/` |
| Workflow regression coverage | `tests/app.spec.mjs`, `tests/web.spec.mjs`, `tests/backend.mjs` |
| Packaging and local installation | `scripts/`, `docs/DEVELOPMENT.md` |

Section rendering lives in `ui/render.js`, event wiring in `ui/events.js`, and backup-restore application in the event handler. Feature files are organizational boundaries within a shared scope, not independently loaded modules.

## Verification

Build tests verify the source manifest, script syntax and generated asset integrity. Playwright builds and serves `dist/`, the same frontend packaged in the app, and `web/` at `/dashboard/` with a stand-in backend, using synthetic records. Backend tests run `backend/*.js` in Node with stand-ins for Google services. Rust tests use temporary stores. No test suite accesses production data. Commands and platform acceptance checks are documented in [Development](DEVELOPMENT.md#verify).

## Source, generated output and personal data

- Commit `frontend/`, `src-tauri/` source/configuration, `assets/`, scripts, tests, documentation and dependency lockfiles.
- Do not commit `dist/`, `node_modules/`, `src-tauri/target/` or test results. They are generated and ignored.
- Keep installed toolchains and shared package caches outside the repository.
- Keep real databases, member spreadsheets, receipt images and backups outside the repository. Production App data stays in the separate data directory documented in the [User guide](USER_GUIDE.md#local-data-and-attachments).
- Keep the Tauri identifier and storage keys unchanged when reorganizing source files; changing them can make the installed app appear to have a different or empty data store.
