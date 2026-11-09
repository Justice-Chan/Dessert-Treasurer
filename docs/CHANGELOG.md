# Changelog

All notable user-facing changes are recorded here.

## Unreleased

- Replaced the activity roster's visible payment-time field with editable transfer-account last five digits; payment times remain stored for automatic paid-participant ordering.
- Added configurable spreadsheet headers for transfer-account suffixes and included the values in full backups.
- Preserved existing account suffixes and payment timestamps when their columns are absent from an activity import.
- Matched imported names that include a department and grade label, such as "外文119 黃小明", and used the label to fill a missing department.
- Grouped the header data actions, activity roster import/export actions and spreadsheet-link actions into dropdown menus.
- Listed unpaid participants first in activity rosters; the roster returns to the top after a payment change and otherwise keeps its scroll position.
- Import header settings now keep only added and removed aliases, so new built-in aliases apply after an update unless they were removed in Settings.

## 0.2.1 (Unreleased)

- Added Windows x64 installer configuration and a manual CI build workflow for internal previews; Windows device acceptance testing is still required.
- Replaced macOS-specific spreadsheet downloads and external-link commands with shared cross-platform implementations.
- Moved spreadsheet link downloads off the UI thread and retained bounded HTTPS downloads.
- Spreadsheet import for people and activity attendance, including public spreadsheet links and optional startup synchronization.
- Editable import-header synonyms in Settings.
- Faster initial view rendering and improved activity roster management.
- Prevented import settings from removing all name or student ID header synonyms.

## 0.2.0 - 2026-09-20

- Tauri macOS App with local SQLite storage and attachment management.
- Income, expense, reimbursement, reconciliation, people and activity fee workflows.
- JSON full backup, readable CSV export, 30-day trash and attachment previews.
- Monthly reconciliation report with macOS PDF print support.
- Playwright coverage for key bookkeeping, reimbursement, trash and report workflows.
