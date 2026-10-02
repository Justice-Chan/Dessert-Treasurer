<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="96" height="96" alt="Dessert Treasurer app icon" />
</p>

<h1 align="center">Dessert Treasurer</h1>

<p align="center">
  Club finances, from the first receipt to the monthly close.<br />
  A local-first desktop app for bookkeeping, reimbursements, and activity fees.
</p>

<p align="center">
  <a href="https://github.com/Justice-Chan/Dessert-Treasurer/releases/download/v0.2.0/Dessert.Treasurer_0.2.0_aarch64.dmg"><img src="https://img.shields.io/badge/Download-macOS-355E4B?style=for-the-badge&amp;logo=apple&amp;logoColor=white" alt="Download Dessert Treasurer 0.2.0 for macOS" /></a>
  <a href="https://github.com/Justice-Chan/Dessert-Treasurer/actions/runs/37010901467/artifacts/11227664404"><img src="https://img.shields.io/badge/Download-Windows%20x64-806529?style=for-the-badge" alt="Download the Windows x64 preview installer ZIP; GitHub sign-in required" /></a>
  <a href="docs/USER_GUIDE.md"><img src="https://img.shields.io/badge/Guide-Installation-45515A?style=for-the-badge" alt="Read the user guide" /></a>
</p>

<p align="center">
  macOS 13+ / Apple Silicon &middot; Windows 11 x64 preview &middot; Traditional Chinese interface<br />
  <a href="#features">Features</a> &middot;
  <a href="#getting-started">Getting started</a> &middot;
  <a href="#data-and-backups">Data and backups</a> &middot;
  <a href="#development">Development</a>
</p>

> **[! IMPORTANT !]**
> **Unsigned builds for internal use.** macOS downloads may be blocked or reported as damaged; Windows may show an unknown-publisher warning. See the [User guide](docs/USER_GUIDE.md) for installation instructions. The Windows installer has been built successfully in CI but has not completed real-device acceptance testing.

**Windows download:** the button downloads an Actions artifact ZIP containing the installer and checksum. GitHub sign-in is required. This artifact expires on **October 16, 2026 (UTC)**; see the [build run](https://github.com/Justice-Chan/Dessert-Treasurer/actions/runs/37010901467) for its status.

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

1. Download the DMG using the macOS button above. Version notes are available on [Releases](https://github.com/Justice-Chan/Dessert-Treasurer/releases).
2. Open the DMG and drag `Dessert Treasurer.app` to **Applications**.
3. Open the app from Applications.

If macOS blocks the app, follow the [User guide](docs/USER_GUIDE.md#if-macos-blocks-the-app). Only apply its workaround to a download you trust.

### Windows preview

1. Sign in to GitHub and download the Windows ZIP using the button above.
2. Extract the ZIP and verify the installer against the included SHA-256 checksum.
3. Run the `-setup.exe` installer and open the app from the Start menu.

The preview targets Windows 11 x64 (Intel/AMD). It shares the macOS app's source code and full-backup format. Installation, native interactions, cross-platform restore and PDF output have not completed real-device acceptance testing. Read the [Windows installation guidance](docs/USER_GUIDE.md#windows-preview) before using the preview.

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

Built with **Tauri 2, Rust, SQLite, and HTML/CSS/JavaScript**. The shared frontend and native backend are packaged with platform-specific Tauri configuration. CI runs checks on macOS and Windows; a manual workflow produces Windows installers.

Start with the [development environment guide](docs/DEVELOPMENT.md) for tool setup and the [architecture guide](docs/ARCHITECTURE.md) for the source map.

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

No open-source license has been granted for this repository. Public source access does not grant permission to reuse or redistribute the code. Contact the maintainer for permission.
