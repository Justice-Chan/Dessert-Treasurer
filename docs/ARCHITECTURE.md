# Architecture

Dessert Treasurer is a local-first Tauri desktop application with macOS packaging and a Windows x64 preview. The frontend manages the interface and accounting workflows; the Rust backend provides SQLite storage, attachments, spreadsheet parsing, external links and native printing.

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
      ledger.js          Ledger entries, claims, claim payments and revocation
      accounts.js        Accounts, payees, QR images and reconciliation
      reports.js         Monthly report markup, A4 pagination and printing
      backups.js         JSON/CSV exports, parsing and backup validation
      trash.js           Sample data, soft deletion, restoration and purging
    ui/
      calendar.js        Date/time formatting and date controls
      render.js          Shared form helpers and section rendering
      dialogs.js         Confirmation dialogs
      events.js          Form submissions and delegated UI event handlers
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

Native storage and command registration live in `lib.rs`. Cross-platform URL opening and bounded HTTPS downloads live in `platform/mod.rs`; platform libraries handle operating-system differences. The shared data model and app identifier are independent of platform packaging overrides.

## Finding a change

| Change | Start here |
| --- | --- |
| Field labels, controls or dialog markup | `frontend/index.html` |
| Spacing, responsive layout, print appearance | `frontend/styles/app.css` |
| Spreadsheet headers, payment synonyms, recurring imports | `frontend/js/features/imports.js` |
| Person, activity or payment editing | `frontend/js/features/people.js` |
| Report pagination or PDF content | `frontend/js/features/reports.js` |
| Backup formats and validation | `frontend/js/features/backups.js` |
| SQLite, file attachments, native commands | `src-tauri/src/lib.rs` |
| Workflow regression coverage | `tests/app.spec.mjs` |
| Packaging and local installation | `scripts/`, `docs/DEVELOPMENT.md` |

Section rendering lives in `ui/render.js`, event wiring in `ui/events.js`, and backup-restore application in the event handler. Feature files are organizational boundaries within a shared scope, not independently loaded modules.

## Verification

Build tests verify the source manifest, script syntax and generated asset integrity. Playwright builds and serves `dist/`, the same frontend packaged in the app, using synthetic browser-only records. Rust tests use temporary stores. Neither test suite accesses production app data. Commands and platform acceptance checks are documented in [Development](DEVELOPMENT.md#verify).

## Source, generated output and personal data

- Commit `frontend/`, `src-tauri/` source/configuration, `assets/`, scripts, tests, documentation and dependency lockfiles.
- Do not commit `dist/`, `node_modules/`, `src-tauri/target/` or test results. They are generated and ignored.
- Keep installed toolchains and shared package caches outside the repository.
- Keep real databases, member spreadsheets, receipt images and backups outside the repository. Production App data stays in the separate data directory documented in the [User guide](USER_GUIDE.md#local-data-and-attachments).
- Keep the Tauri identifier and storage keys unchanged when reorganizing source files; changing them can make the installed app appear to have a different or empty data store.
