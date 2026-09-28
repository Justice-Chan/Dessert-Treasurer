<img width="1353" height="823" alt="image" src="https://github.com/user-attachments/assets/515445da-527a-473a-a2c7-1798c428e08b" />

# Dessert Treasurer

Dessert Treasurer is a macOS desktop finance tool for the Dessert Club. Built with Tauri 2, it supports income and expense tracking, reimbursements, reconciliation, people and activity fee management, attachments, backup and restore, trash, and monthly reports.

People and activity attendance can be imported from local Excel, OpenDocument, CSV, or TSV files. Public Google Sheets and direct spreadsheet-download links can also be connected and synchronized on app launch. The import flow identifies supported headers in any column order, lets administrators edit recognition synonyms, avoids duplicate people, and fills missing person details when new source data is available.

## Getting started

1. Download the internal DMG from GitHub Releases.
2. Follow the [internal installation guide](docs/INTERNAL_INSTALL.md).
3. Download a full JSON backup after every monthly close.

All data stays on the local machine and is never uploaded to a cloud service. See [Data and backups](docs/DATA.md).

## Project structure

```text
assets/       Reusable icon source files
docs/         Data and release documentation
scripts/      Web build, signing, and test-server helpers
src-tauri/    Rust, SQLite, and Tauri native configuration
tests/        Playwright UI tests
index.html    Application UI and interaction logic
```

## Development requirements

- macOS 13 or later
- Node.js 24 (see `.node-version`)
- Rust stable (see `rust-toolchain.toml`)
- Xcode Command Line Tools

```sh
npm ci
npm run dev
```

## Verify and build

```sh
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:ui
npm run build:mac
npm run build:dmg
```

The macOS app is written to:

```text
src-tauri/target/release/bundle/macos/Dessert Treasurer.app
```

The DMG is written to `src-tauri/target/release/bundle/dmg/`. An unsigned or unnotarized DMG is for internal testing only.

UI tests require a local listening port. If endpoint security blocks localhost, allow Node.js to listen on `127.0.0.1:4173`.

## Release

Read [Contributing](CONTRIBUTING.md) before opening a pull request. For vulnerabilities or data-safety issues, use the private reporting route in [Security](SECURITY.md) rather than a public issue.

Before a public release, follow the [release guide](docs/RELEASE.md) to complete Apple Developer ID signing and notarization. Unsigned builds are appropriate for personal or internal use, but external users may see a Gatekeeper warning.

## License

This project is currently not licensed for public reuse. Choose a license before the first public GitHub release.
