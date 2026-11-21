# Changelog

All notable user-facing changes are recorded here.

## Unreleased

- The monthly backup also copies the shared ledger into 備份, keeping the newest twelve.
- At noon on the 1st, last month's 月結報表 is saved as a PDF beside the shared ledger, laid out like the app's printed report.
- The shared ledger lives in the folder named by the LEDGER_FOLDER_ID Script Property when set, and moves there on its next save.
- The 記帳 page groups a month's entries by day under headers that stay in view, with each day's net; filters for income or expense; shows the month's net beside income and expense; and keeps 新增收支 as a floating button. Row chevrons sit level with the amount, and the overview figures line up with the cards.
- 我的申請 rows open the claim for editing; 撤銷申請 moved to the edit form's title row, as 刪除 did on the entry form. A claim's 修改 button sits beside its last detail row.
- Edited claims whose receipt folder was deleted by hand in Drive put new receipts in the month's folder instead of the trash.
- The treasurer's drawer reads 總覽, 記帳, 新增報帳, 審核報帳. My claims is for officers only; the treasurer's own claims are marked 本人 in the review list and edited from their detail page, which saving or cancelling returns to.
- The books live in a shared cloud ledger: the app uploads each change and takes the web's changes when it opens, after edits and when its window regains focus. People and activities stay in the app. If the web changed the books first, the app's upload is refused and it takes the cloud copy. The first sync uploads the app's existing books.
- The web has a 記帳 page for the treasurer: a month's entries and month-end balances, and adding, editing or deleting entries. Choosing 已付款 on a claim records its payment with a date and account; leaving 已付款 removes it.
- The web overview's totals come straight from the ledger, so they no longer wait for the app; the 財務彙總 tab is no longer used.
- Quitting rewrites the automatic backup only when the books changed (sync times aside), so Google Drive keeps fewer identical versions. 立即備份 always writes.
- The 備份 page leads with the automatic backup: when it last ran, where, back up now, save a copy or change the folder. Reports export as CSV only, and restoring sits behind a link.
- Expense categories come from the web backend on each sync, so they are edited in one place.
- Spreadsheet import for people and activity rosters is a dropdown (file or link) instead of a separate choice dialog.
- Quitting the app writes a full JSON backup named 甜點社帳務自動備份_MM-DD.json to a chosen folder, replacing the last one; on first run it picks the Google Drive for desktop folder when there is one. The 備份 page shows when it last ran and where.
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
