# Development environment

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

## GitHub workflows

- **Verify** runs checks on macOS and Windows for pushes and pull requests.
- **Build Windows Installer** is manually triggered. It runs checks, builds an unsigned x64 NSIS installer and uploads it with SHA-256 checksums as an artifact retained for 14 days.
- The installer workflow has read-only repository content permissions and does not create tags, publish Releases or modify source.
- Both workflows use the pinned Rust version and the Node version file. Windows SDK and OS servicing are provided by the runner image; this is not a bit-for-bit reproducible build guarantee.

## Updating versions

Change Node or Rust deliberately, then run checks on both platforms. When updating Rust, update `rust-toolchain.toml` and the `toolchain` input in both workflows together. Build tests detect mismatched Rust versions. Commit lockfile changes with the dependency change, and leave unrelated upgrades out of platform-support work.

For Windows artifact download and acceptance testing, see [Windows testing and installation](WINDOWS.md).
