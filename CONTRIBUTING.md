# Contributing

Thank you for helping improve Dessert Treasurer.

## Before opening a pull request

1. Keep each change focused on one user-visible problem.
2. Do not add real accounting data, databases, receipt images, exported backups, or personally identifiable member data to the repository.
3. Update CHANGELOG.md when the change affects users.
4. Run the relevant checks:

```sh
npm run build:web
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:ui
```

## Code conventions

- Keep the app usable without a network connection.
- Preserve the existing local-first data model.
- Prefer clear Traditional Chinese for user-facing text.
- Add or update UI tests when a change affects a key workflow.

## Reporting issues

Use the GitHub issue templates for reproducible bugs and feature requests. Do not include real account numbers, member details, backup files, receipt images, or private spreadsheet links.
