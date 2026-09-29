# Dessert Treasurer

<img width="1353" height="823" alt="Dessert Treasurer bookkeeping screen" src="https://github.com/user-attachments/assets/515445da-527a-473a-a2c7-1798c428e08b" />

**Dessert Treasurer** is a local-first macOS desktop app for managing a student club's money, reimbursements, accounts, people, and activity fees in one place.

It is designed for everyday club administration: enter a transaction, attach a receipt, check the account balance, track who has paid for an activity, and keep a backup before month-end. Your data stays on your Mac unless you choose to export a backup or connect a public spreadsheet.

## What It Helps You Manage

### Bookkeeping

- Record income and expenses with dates, categories, accounts, and notes.
- Review transactions through search and date filters.
- Keep an auditable record instead of relying on scattered spreadsheets.

### Reimbursements and receipts

- Create, review, approve, pay, cancel, or delete reimbursement requests.
- Attach a receipt image from your Mac or add a cloud-storage link.
- Open receipt images and cloud links directly from the reimbursement list.

### Accounts and reconciliation

- Maintain cash and bank accounts with opening balances.
- Record incoming payment accounts and QR codes.
- Compare the system balance with the actual account balance at month-end.
- Generate a printable monthly report and save it as a PDF from the macOS print window.

### People and activities

- Store a person's name, student ID, department, and email address.
- Create activities with a date and per-person fee.
- Track attendance, payment status, and payment time for each participant.
- Sort participants by payment status, payment time, or a manually arranged order.
- Download a list of unpaid participants when follow-up is needed.

### Spreadsheet imports

- Import people or activity participants from Excel, OpenDocument, CSV, or TSV files.
- Connect a public Google Sheet or direct spreadsheet-download link and optionally sync it each time the app opens.
- Recognize columns in any order, including configurable synonyms for names, IDs, email addresses, payment status, and payment date.
- Skip existing people while filling in missing details from newer imports.

## Install on macOS

1. Download the latest DMG from [Releases](../../releases).
2. Open the DMG and drag `Dessert Treasurer.app` to **Applications**.
3. Open the app from Applications.

The current internal build is not signed with an Apple Developer ID or notarized by Apple. macOS may block a download from GitHub. Follow the [internal installation guide](docs/INTERNAL_INSTALL.md) if macOS reports that the app is damaged.

## First-Time Setup

1. Open **Reconciliation** and add the club's cash and bank accounts with their opening balances.
2. Add income and expenses in **Ledger** as they occur.
3. Use **Claims** for purchases that need reimbursement, then mark approved claims as paid.
4. Add members in **People**, then create an activity before recording participation and payments.
5. At the end of each month, reconcile account balances and export a full backup.

## Everyday Workflow

| When you need to... | Use this area |
| --- | --- |
| Record a club payment or expense | **Ledger** |
| Track a receipt and reimbursement | **Claims** |
| Check a cash or bank balance | **Reconciliation** |
| Add members and import a roster | **People** |
| Track attendance and activity fees | **People > Activities** |
| Recover a recently deleted record | **Trash** |
| Protect or move your records | **Data export** and **Restore backup** |

## Data, Attachments, and Backups

All financial records, people, activities, and local attachments are stored only on the Mac running the app. The app does not use a hosted account or upload your data to a server.

- Create a **full JSON backup** after each monthly close and before restoring any backup.
- Keep an extra copy in iCloud Drive, trusted cloud storage, or an external drive.
- Restoring a backup replaces current app data, so export the current data first.
- Deleted records stay in the app's Trash for 30 days before automatic removal. Permanently deleted records and attachments cannot be recovered.

For the exact storage location and recovery guidance, read [Data and backups](docs/DATA.md).

## Development

This app uses Tauri 2, Rust, SQLite, and a lightweight HTML/CSS/JavaScript interface.

### Requirements

- macOS 13 or later
- Node.js 24 (see `.node-version`)
- Rust stable (see `rust-toolchain.toml`)
- Xcode Command Line Tools

### Run locally

```sh
npm ci
npm run dev
```

### Verify and build

```sh
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:ui
npm run build:mac
npm run build:dmg
```

The built app is written to `src-tauri/target/release/bundle/macos/`; the DMG is written to `src-tauri/target/release/bundle/dmg/`.

## Repository Guide

```text
assets/       Reusable app icon source files
docs/         Installation, data, and release documentation
scripts/      Build, signing, and local test-server helpers
src-tauri/    Rust, SQLite, and Tauri native code
tests/        Playwright UI tests
index.html    Application interface and interaction logic
```

Read [Contributing](CONTRIBUTING.md) before opening a pull request. Report security or data-safety concerns through the private route in [Security](SECURITY.md), rather than a public issue.

## License

This project is currently not licensed for public reuse. Choose a license before allowing outside reuse or contributions.
