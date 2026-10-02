# Development guide

Tool setup, verification, packaging and releases for maintainers. For installation warnings, data locations and recovery, use the [User guide](USER_GUIDE.md); for module ownership, use [Architecture](ARCHITECTURE.md).

## Approach

Use a shared tool installation with project-specific versions and dependencies. Develop on macOS; build the Windows installer on a GitHub-hosted Windows runner. Do not install Windows SDKs or cross-compilation toolchains on the Mac.

| Item | Managed by | Location |
| --- | --- | --- |
| Node.js 24.21.0 | `.node-version`, fnm locally and setup-node in CI | Shared runtime installation |
| Rust 1.98.1 | `rust-toolchain.toml`, rustup and CI | Shared toolchain installation |
| JavaScript dependencies | `package-lock.json`, `npm ci` | Project `node_modules/` |
| Rust dependency versions | `src-tauri/Cargo.lock`, `--locked` builds | Shared Cargo download cache |
| Frontend output | `npm run build:web` | Project `dist/` |
| Native compilation output | Cargo | Project `src-tauri/target/` |
| Windows SDK / MSVC | Windows runner image or a Windows developer machine | Windows only |

This is version and dependency isolation, not a security sandbox or a complete per-project OS environment. Shared caches avoid duplicate downloads without changing the versions selected by a project's lockfile. Do not commit runtime installations, caches or generated output.

## macOS setup

Install Xcode Command Line Tools, fnm and rustup once. Then, inside the repository:

```sh
fnm install
fnm use
export PATH="$HOME/.cargo/bin:$PATH"
cargo --version
npm ci
```

fnm reads `.node-version`. Rustup reads `rust-toolchain.toml` and selects the pinned version; if missing, it downloads that version and the requested rustfmt/clippy components. There is no Python-style environment activation step for Rust. Keep the Cargo bin directory in the shell PATH so Tauri can find `cargo`.

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

The Windows command refuses to run on macOS. The recommended Mac workflow is to push the source and use GitHub Actions, not attempt cross-compilation.

macOS output is written to `src-tauri/target/release/bundle/macos/` and `src-tauri/target/release/bundle/dmg/`. To build and replace the local app in Applications, save pending edits and run `npm run update:mac`. This closes the app and installs the verified bundle without targeting the separate data folder. Export a backup before updating.

## GitHub workflows

- **Verify** runs checks on macOS and Windows for pushes and pull requests.
- **Build Windows Installer** is manually triggered. It runs checks, builds an unsigned x64 NSIS installer and uploads it with SHA-256 checksums as an artifact retained for 14 days.
- The installer workflow has read-only repository content permissions and does not create tags, publish Releases or modify source.
- Both workflows use the pinned Rust version and the Node version file. Windows SDK and OS servicing are provided by the runner image; this is not a bit-for-bit reproducible build guarantee.

## Updating versions

Change Node or Rust deliberately, then run checks on both platforms. When updating Rust, update `rust-toolchain.toml` and the `toolchain` input in both workflows together. Build tests detect mismatched Rust versions. Commit lockfile changes with the dependency change, and leave unrelated upgrades out of platform-support work.

## Windows installer

1. Commit and push changes to the default branch. The manual workflow must be present there for GitHub to display it.
2. Open **Actions > Build Windows Installer > Run workflow** and select the branch.
3. Wait for checks and packaging to finish successfully.
4. Download the `dessert-treasurer-windows-x64-...` artifact from the completed run.
5. Extract the ZIP; it contains a `-setup.exe` installer and an adjacent SHA-256 checksum file.

The workflow does not publish a Release. Keep unverified builds labeled as previews. For installation and checksum verification, see the [User guide](USER_GUIDE.md#windows-preview).

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

Record Windows and WebView2 versions, display scaling, installer hash and failures. Automated checks and compilation cannot replace this checklist; do not promote the preview to verified Windows support until it is completed.

## Prepare a release

1. Update the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, keeping lockfiles consistent.
2. Record user-facing changes in [Changelog](CHANGELOG.md).
3. Install dependencies, run the checks above and build the relevant platform package.
4. Verify export, restore and the saved monthly PDF with synthetic data. Complete Windows acceptance testing for a Windows release.
5. Ensure commits, screenshots and packages contain no real databases, receipts, backups, account details, member information or private spreadsheet links.

### Publish on GitHub

1. Create a `vX.Y.Z` tag for the tested commit and a matching draft Release.
2. Upload the DMG or Windows installer with its SHA-256 checksum, not build caches or runtime installations.
3. Copy the matching Changelog entry and disclose unsigned-app warnings and unverified functionality. Link to the [User guide](USER_GUIDE.md) for installation steps instead of duplicating them.
4. Test the downloaded package on a separate user account or test device before publishing. If real-device validation is unavailable, keep it clearly labeled as an unverified preview.

The current distribution policy is internal use. macOS builds are ad-hoc signed, not Developer ID signed or notarized; Windows installers are unsigned. Publishing a GitHub Release does not remove operating-system warnings. If distribution policy changes, reassess platform signing and notarization before promising a warning-free installation.

Keep CI enabled on the default branch. Review the repository's license policy before permitting external reuse, and provide a private reporting route through [Security](SECURITY.md).
