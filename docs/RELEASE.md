# Release guide

## Before every release

1. Update the version in `package.json` and `src-tauri/tauri.conf.json`.
2. Add user-facing changes to [CHANGELOG.md](../CHANGELOG.md).
3. Run tests and builds:

```sh
npm ci
npm run build:web
npm run test:build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:ui
npm run build:mac
npm run build:dmg
```

4. Manually verify export, restore, and a monthly PDF report using an isolated synthetic test store, not the production database.

## Windows previews

Use the manual **Build Windows Installer** workflow, then download its x64 installer and checksum artifact. It does not create a Release. Complete the [Windows acceptance checklist](WINDOWS.md) before uploading a Windows asset to a Release, and label unsigned test builds and any unverified native functionality clearly. No Windows installer has been validated merely by adding this workflow.

## GitHub Release

1. Create a `vX.Y.Z` Git tag.
2. Create a matching GitHub Release.
3. Upload the signed and notarized DMG and its SHA-256 checksum.
4. Copy the matching CHANGELOG section into the release notes.
5. Mark the release as a draft until the downloaded DMG has been installed and opened on a second Mac user account.

## Public distribution

`scripts/sign-macos.mjs` currently uses ad-hoc signing, which is suitable only for local and internal testing. Before distributing a DMG publicly, you need:

1. An Apple Developer Program membership.
2. A Developer ID Application certificate.
3. To re-sign the `.app` with the Developer ID.
4. To notarize the DMG through Apple's notarization service.
5. To staple the notarization ticket to the DMG.

After this process, users can install from GitHub Releases without Gatekeeper blocking the app as an unidentified developer.

## Repository launch checklist

1. Choose a repository license before making the repository public.
2. Confirm that no database, attachments, backups, exports, private links, or real names appear in commits or screenshots.
3. Enable GitHub Actions and confirm the Verify workflow passes on the default branch.
4. Add a repository description, topic tags, and a contact method for private security reports.
