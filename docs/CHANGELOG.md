# Changelog

All notable user-facing changes are recorded here.

## Unreleased

- Spreadsheet import for people and activity rosters is a dropdown (file or link) instead of a separate choice dialog.
- Quitting the app writes a full JSON backup to a chosen folder, overwriting the last one; on first run it picks the Google Drive for desktop folder when there is one. Set or change it in 設定 → 自動備份.
- The app syncs web claims once each time it opens, quietly unless something changed or the sync failed.
- Web sync takes claim edits made on the web; a paid claim keeps its amount, and its ledger expense follows a category change. The 水果與餡料 subcategory is now 餡料與醬.
- 報銷 has a 同步網頁報帳 button: it pulls web claims (receipts as Drive links), drops withdrawn ones, follows web review decisions, and writes back the overview totals; payments stay in the app. The backend URL and secret are set in 設定 and never enter backups.
- macOS packages, including the DMG, are ad-hoc signed during bundling.
- The window uses the app's background colour while loading instead of flashing dark.

## 0.2.2

- Replaced the activity roster's visible payment-time field with editable transfer-account last five digits; payment times remain stored for automatic paid-participant ordering.
- Added configurable spreadsheet headers for transfer-account suffixes and included the values in full backups.
- Preserved existing account suffixes and payment timestamps when their columns are absent from an activity import.
- Imports match names that carry a department and grade label, such as "外文119 黃小明".
- Import previews list each skipped row and the reason; a name shared by several people is no longer matched by guesswork.
- Activity rosters list unpaid participants first and return to the top after a payment change.
- Grouped actions into dropdown menus: 資料管理 (sample data, clear data), 名單操作 (import, unpaid list) and 連線管理 (sync, disconnect).
- Tables keep focus and scroll position when an unrelated change is saved.
- Imports split grades written without digits, such as "資工二 黃小明", into department and name.
- Closing the window waits briefly so the last change is saved.
- New built-in import header aliases apply after an update unless removed in Settings.

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
