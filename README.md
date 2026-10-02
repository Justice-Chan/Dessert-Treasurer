<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="96" height="96" alt="Dessert Treasurer app icon" />
</p>

<h1 align="center">Dessert Treasurer</h1>

<p align="center">
  Club finances, from the first receipt to the monthly close.<br />
  A local-first desktop app for bookkeeping, reimbursements, and activity fees.
</p>

<p align="center">
  <a href="https://github.com/Justice-Chan/Dessert-Treasurer/releases/latest"><img src="https://img.shields.io/badge/Download-macOS-355E4B?style=for-the-badge&amp;logo=apple&amp;logoColor=white" alt="Download the latest macOS release" /></a>
  <a href="docs/USER_GUIDE.md#windows-preview"><img src="https://img.shields.io/badge/Windows-Preview-806529?style=for-the-badge" alt="Windows preview information, not a verified release" /></a>
  <a href="docs/USER_GUIDE.md"><img src="https://img.shields.io/badge/Guide-Installation-45515A?style=for-the-badge" alt="Read the user guide" /></a>
</p>

<p align="center">
  macOS 13+ &middot; Apple Silicon &middot; Traditional Chinese interface<br />
  <a href="#features">Features</a> &middot;
  <a href="#getting-started">Getting started</a> &middot;
  <a href="#data-and-backups">Data and backups</a> &middot;
  <a href="#development">Development</a>
</p>

> **[! IMPORTANT !]**
> **Internal-use release.** The macOS app is not signed with an Apple Developer ID or notarized by Apple. A GitHub download may be blocked or reported as damaged. Read the [installation guide](docs/USER_GUIDE.md#install-on-macos) before opening it. Windows packaging is in preview, not yet a verified release.

## At a Glance

Designed for student club treasurers: record a purchase, follow up on activity fees, check account balances, and prepare the monthly report without juggling separate spreadsheets. Daily bookkeeping works locally; spreadsheet connections are optional.

<p align="center">
  <img width="1000" alt="Dessert Treasurer bookkeeping screen" src="https://github.com/user-attachments/assets/515445da-527a-473a-a2c7-1798c428e08b" />
</p>

## Features

| Area | What you can do |
| --- | --- |
| **Bookkeeping** | Record income and expenses with dates, categories, accounts, and notes. Find records with search and date filters. |
| **Reimbursements** | Review, approve, and pay claims. Keep receipt images or clickable cloud-storage links alongside each request. |
| **Accounts and reports** | Manage cash and bank accounts, compare recorded and actual balances, and prepare monthly PDF reports. |
| **People and activities** | Maintain member details, track attendance and fees, arrange participants by dragging rows or sorting by payment time, and export unpaid lists. |
| **Spreadsheet imports** | Import Excel, OpenDocument, CSV, or TSV files, or connect a public spreadsheet link with optional startup synchronization. |
| **Import matching** | Recognize columns in any order with editable synonyms. Match registered people by name or student ID, skip duplicates, and fill missing details. |
| **Backups and recovery** | Export a full JSON backup, restore records, and recover recently deleted items from Trash. |

## Getting Started

### Install on macOS

1. Download the latest DMG from [Releases](https://github.com/Justice-Chan/Dessert-Treasurer/releases/latest).
2. Open the DMG and drag `Dessert Treasurer.app` to **Applications**.
3. Open the app from Applications.

If macOS blocks the app, follow the [User guide](docs/USER_GUIDE.md#if-macos-blocks-the-app). Only apply its workaround to a download you trust.

### Windows preview

Windows x64 packaging is being prepared for internal testing. It uses the same source code and backup format as the macOS app. Windows installation, native interactions and PDF output still require real-device acceptance testing; it is not yet a verified Windows release.

Maintainers can build an unsigned installer through the manual **Build Windows Installer** GitHub Actions workflow. See the [Windows build instructions](docs/DEVELOPMENT.md#windows-installer) and [installation guidance](docs/USER_GUIDE.md#windows-preview). No Windows SDK or cross-compilation tools are needed on the development Mac.

### Set up your club

1. Open **Reconciliation** and add the club's cash and bank accounts with their opening balances.
2. Add income and expenses in **Ledger** as they occur.
3. Use **Claims** for purchases that need reimbursement, then mark approved claims as paid.
4. Add members in **People**, then create an activity before recording participation and payments.
5. At the end of each month, reconcile account balances and export a full backup.

### Find the right workspace

| When you need to... | Use this area |
| --- | --- |
| Record a club payment or expense | **Ledger** |
| Track a receipt and reimbursement | **Claims** |
| Check a cash or bank balance | **Reconciliation** |
| Add members and import a roster | **People** |
| Track attendance and activity fees | **People > Activities** |
| Recover a recently deleted record | **Trash** |
| Protect or move your records | **Data export** and **Restore backup** |

## Data and Backups

Your financial records, people, activities, and local attachments are stored on the computer running the app. There is no hosted account or automatic cloud backup. A connected spreadsheet is read from its provider; cloud receipt links open externally.

- Create a **full JSON backup** after each monthly close and before restoring any backup.
- Keep an extra copy in iCloud Drive, trusted cloud storage, or an external drive.
- Restoring a backup replaces current app data, so export the current data first.
- Deleted records stay in the app's Trash for 30 days before automatic removal. Permanently deleted records and attachments cannot be recovered.

For storage locations, recovery and moving computers, read the [User guide](docs/USER_GUIDE.md#local-data-and-attachments).

## Development

Built with **Tauri 2, Rust, SQLite, and HTML/CSS/JavaScript**. Both platforms share the same source code; Windows installers are built on a Windows GitHub Actions runner, not through a Windows SDK on the development Mac.

Start with the [development environment guide](docs/DEVELOPMENT.md) for tool setup and the [architecture guide](docs/ARCHITECTURE.md) for the source map.

<details>
<summary><strong>Local development, tests, and macOS builds</strong></summary>


### Requirements

- macOS 13 or later
- Node.js 24 (see `.node-version`)
- Rust 1.98.1 (see `rust-toolchain.toml`)
- Xcode Command Line Tools

### Run locally

```sh
npm ci
npm run dev
```

### Verify and build

```sh
npm run test:build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:ui
npm run build:mac
npm run build:dmg
```

The built app is written to `src-tauri/target/release/bundle/macos/`; the DMG is written to `src-tauri/target/release/bundle/dmg/`.

To build and replace the local app in Applications in one step, save any pending edits in the app, then run:

```sh
npm run update:mac
```

This closes the running app and installs the verified new bundle. Reopen it from the Dock after the command finishes. The app's stored data is kept in its separate Application Support folder.

For version pinning, shared tools, project-local dependencies and Windows CI builds, read [Development environment](docs/DEVELOPMENT.md).

</details>

<details>
<summary><strong>Repository layout</strong></summary>

```text
frontend/     Interface, styles, and JavaScript organized by feature
assets/       Reusable app icon source files
src-tauri/    Rust, SQLite, and Tauri native code
tests/        Build checks and Playwright UI tests
scripts/      Build, signing, installation, and local test-server helpers
docs/         Architecture, installation, data, and release documentation
dist/         Generated frontend output (not committed)
```

See [Architecture](docs/ARCHITECTURE.md) for the source map and build flow. Edit files in `frontend/`, not the generated files in `dist/`.

</details>

## Documentation

| Guide | Purpose |
| --- | --- |
| [User guide](docs/USER_GUIDE.md) | Install on macOS or Windows, find stored data, and manage backups and recovery. |
| [Development](docs/DEVELOPMENT.md) | Set up tools, run tests, build installers, and prepare releases. |
| [Architecture](docs/ARCHITECTURE.md) | Navigate the frontend, native code, and build flow. |
| [Changelog](docs/CHANGELOG.md) | Review changes between versions. |

For bugs and suggestions, [open an issue](https://github.com/Justice-Chan/Dessert-Treasurer/issues). Do not include real financial records, member details, or backups. Read [Contributing](docs/CONTRIBUTING.md) before opening a pull request; report security or data-safety concerns privately through [Security](docs/SECURITY.md).

## License

This project is currently not licensed for public reuse. Choose a license before allowing outside reuse or contributions.
