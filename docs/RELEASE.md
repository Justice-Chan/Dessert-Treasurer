# Release guide

## Before every release

1. Update the version in `package.json` and `src-tauri/tauri.conf.json`.
2. Add user-facing changes to [CHANGELOG.md](../CHANGELOG.md).
3. Run tests and builds:

```sh
npm ci
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:ui
npm run build:mac
```

4. Manually verify export, restore, and a monthly PDF report using real data.

## GitHub Release

1. Create a `vX.Y.Z` Git tag.
2. Create a matching GitHub Release.
3. Upload the signed and notarized DMG.
4. Copy the matching CHANGELOG section into the release notes.

## Public distribution

`scripts/sign-macos.mjs` currently uses ad-hoc signing, which is suitable only for local and internal testing. Before distributing a DMG publicly, you need:

1. An Apple Developer Program membership.
2. A Developer ID Application certificate.
3. To re-sign the `.app` with the Developer ID.
4. To notarize the DMG through Apple's notarization service.
5. To staple the notarization ticket to the DMG.

After this process, users can install from GitHub Releases without Gatekeeper blocking the app as an unidentified developer.
