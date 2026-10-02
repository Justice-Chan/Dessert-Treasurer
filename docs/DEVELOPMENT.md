# Development guide

This guide documents the supported development environments, test suites, platform packages and release process. Installation and data recovery are covered in the [User guide](USER_GUIDE.md); source responsibilities are described in [Architecture](ARCHITECTURE.md).

## Supported environments

The repository pins runtime and dependency versions while using shared Node.js and Rust installations. Native packages are built on their target operating system: macOS locally or in CI, and Windows locally or on a GitHub-hosted Windows runner. Windows SDKs are not required for macOS development.

| Item | Managed by | Location |
| --- | --- | --- |
| Node.js 24.21.0 | `.node-version`, fnm locally and setup-node in CI | Shared runtime installation |
| Rust 1.98.1 | `rust-toolchain.toml`, rustup and CI | Shared toolchain installation |
| JavaScript dependencies | `package-lock.json`, `npm ci` | Project `node_modules/` |
| Rust dependency versions | `src-tauri/Cargo.lock`, `--locked` builds | Shared Cargo download cache |
| Frontend output | `npm run build:web` | Project `dist/` |
| Native compilation output | Cargo | Project `src-tauri/target/` |
| Windows SDK / MSVC | Windows runner image or a Windows developer machine | Windows only |

Lockfiles select project dependencies; shared caches avoid duplicate downloads. This setup does not provide a security sandbox or a separate operating system. Runtime installations, caches and generated output are excluded from version control.

## macOS setup

Install Xcode Command Line Tools, fnm and rustup once. Then, inside the repository:

```sh
fnm install
fnm use
export PATH="$HOME/.cargo/bin:$PATH"
cargo --version
npm ci
```

fnm reads `.node-version`. Rustup reads `rust-toolchain.toml` and selects or installs the pinned toolchain and rustfmt/clippy components. Tauri requires `cargo` on the shell PATH, normally through `$HOME/.cargo/bin`.

Install the test browser only when running UI tests:

```sh
npx playwright install chromium
```

The matching Chromium is stored in Playwright's user-level cache, not in the repository. A browser left over from an older Playwright version may not be usable by the current version.

## Verify

```sh
npm run test:build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:ui
```

`test:build` first creates `dist/`, which the Rust application context requires. Tests must use synthetic data and temporary stores, never the installed app's real database or attachments.

## Run locally

```sh
npm run dev
```

## Platform builds

On macOS:

```sh
npm run build:mac
npm run build:dmg
```

On a Windows x64 development machine with MSVC C++ Build Tools, WebView2, Node and Rust installed:

```powershell
npm ci
npm run build:windows
```

`build:windows` checks the host operating system and runs only on Windows. Developers using macOS can submit a source revision to the manual GitHub Actions installer workflow.

| Platform | Package output |
| --- | --- |
| macOS | `src-tauri/target/release/bundle/macos/` and `src-tauri/target/release/bundle/dmg/` |
| Windows x64 | `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` |

For a local macOS installation, `npm run update:mac` builds the app, closes the running instance and replaces the Applications bundle after verification. It does not target the separate data folder. Save pending edits and export a backup before running it.

## GitHub workflows

- **Verify** runs checks on macOS and Windows for pushes and pull requests.
- **Build Windows Installer** is manually triggered. It runs checks, builds an unsigned x64 NSIS installer and uploads it with SHA-256 checksums as an artifact retained for 14 days.
- The installer workflow has read-only repository content permissions and does not create tags, publish Releases or modify source.
- Both workflows use the pinned Rust version and the Node version file. Windows SDK and OS servicing are provided by the runner image; this is not a bit-for-bit reproducible build guarantee.

## Updating versions

Runtime updates require checks on both platforms. Rust updates must change `rust-toolchain.toml` and the `toolchain` input in both workflows together; build tests detect mismatches. Dependency updates include the corresponding lockfile changes and are reviewed separately from unrelated feature changes.

## Windows installer

1. Commit and push changes to the default branch. The manual workflow must be present there for GitHub to display it.
2. Open **Actions > Build Windows Installer > Run workflow** and select the branch.
3. Wait for checks and packaging to finish successfully.
4. Download the `dessert-treasurer-windows-x64-...` artifact from the completed run.
5. Extract the ZIP; it contains a `-setup.exe` installer and an adjacent SHA-256 checksum file.

The workflow creates build artifacts, not Releases. Artifacts require GitHub sign-in and expire after 14 days. Release assets provide a durable download location and should be used for distributed packages. Download links in the README and User guide must be updated when a replacement artifact or release asset is published.

Windows builds without completed device acceptance remain previews. Installation and checksum verification are documented in the [User guide](USER_GUIDE.md#windows-preview).

### Windows acceptance checklist

Use a dedicated installation and synthetic records, never the production club database.

- Install and launch from the Start menu on Windows 11 x64.
- Check Chinese text, scrolling, date controls and resizing at 100% and 150% display scaling.
- Create and edit entries, claims, accounts, people and activities.
- Pay an approved claim, check its linked expense, then revoke the payment.
- Import local spreadsheets and public links; confirm startup synchronization can be cancelled.
- Open cloud receipts in the default browser; copy email addresses and account numbers.
- Attach and preview images; verify full backup and restore includes them.
- Check activity roster dragging and editable payment times.
- Export and restore a full JSON backup into an isolated store, including a synthetic macOS backup.
- Check Trash selection, confirmations, restore and permanent deletion.
- Save monthly PDFs with long tables, multi-line notes, page breaks and right borders. Inspect the saved PDF, not just its preview.
- Restart to verify persistence; install a newer build to verify data preservation.
- Confirm the resolved data location and absence of test records or personal data in the installer.

Acceptance records include Windows and WebView2 versions, display scaling, installer hash and any failures. Successful CI checks establish build and automated-test results; verified Windows support additionally requires this device checklist.

## Prepare a release

1. Update the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, keeping lockfiles consistent.
2. Record user-facing changes in [Changelog](CHANGELOG.md).
3. Install dependencies, run the checks above and build the relevant platform package.
4. Verify export, restore and the saved monthly PDF with synthetic data. Complete Windows acceptance testing for a Windows release.
5. Ensure commits, screenshots and packages contain no real databases, receipts, backups, account details, member information or private spreadsheet links.

Packages are currently provided for internal use. macOS builds are ad-hoc signed, not Developer ID signed or notarized; Windows installers are unsigned. GitHub hosting does not remove operating-system warnings. Signing and notarization requirements must be reviewed before broader distribution.

CI checks apply to the default branch and pull requests. External reuse requires permission under the repository's license policy; vulnerability handling is described in [Security](SECURITY.md).
