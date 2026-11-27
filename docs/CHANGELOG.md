# Changelog

All notable user-facing changes are recorded here.

## Unreleased

- 報銷's list takes the whole page: claims are added and edited in a dialog from ＋ 新增報銷. Rows show the date as 11/22, drop the 用途 column (it repeated the subcategory), put the receipt (收據) under the category and the payment date and account under the status, and keep 付款 / 操作 in a column of their own.
- 對帳 shows accounts (記帳帳戶) as cards with the current balance large and payees (收款帳戶) as a short table, both edited in dialogs, with account numbers in full. 月結對帳 fills every account of a month in one row each (月底應有 − 實際餘額 = 差額, ✓ at zero), switches months with ‹ ›, explains its terms behind ?, saves with one main button and allows 鎖定月份 only once every account is saved and matches. Its history has one row per month with the result (帳戶皆相符 or what is off), 已鎖定 / 已儲存 and a print button, and a row loads that month.
- 清空資料 moved to the trash page; 載入範例 is gone; the top-right 資料管理 menu became a single 同步雲端帳本 button; a claim's 撤銷 and 刪除 sit in an 操作 menu. Account numbers copy on a click, and messages show above sticky table headers.
- 人員 has one ＋ 新增人員 menu (by hand, sheet file or sheet link), and a linked sheet's 立即同步 / 取消連線 replace the import choices in that menu and in 名單操作, with the last sync shown under the heading. 取消選取 is a red outlined button beside 標記為.
- 人員 leads with the lists: people and activities are added and edited in dialogs from ＋ 新增人員 / ＋ 新增活動. People show the department under the name, student ids in even-width digits, 活動費 status, a count of 80 人 (12 / 80 while searching), and copy an email by clicking it. Activities show 21 / 24 已繳 with a bar and open their roster with ›; deleting moved into the edit dialog.
- The activity roster uses a switch for attending and one tag for paid, hides payment for people not attending, marks someone paid once five transfer digits are in, filters by clicking its status figures (未繳 coloured only above zero), takes batch 已繳 / 未繳 / 參加 for ticked people from a 標記為 menu, shows the sheet link's last sync beside the filters, and drops manual drag ordering. 名單操作 is a secondary button and the sticky header has a bottom line.
- The backup page is titled 資料管理, in two columns that end on one line. 自動備份 shows when it last ran beside its title and the folder as a breadcrumb (the full path, which holds the Gmail address, only on hover); 變更 opens a dialog with Google Drive or a system folder picker. 立即備份 is gone: quitting already backs up. 匯出 has two evenly spaced rows, 完整備份 JSON and 報表備份 CSV (a dropdown), with same-size buttons, and writes straight into a chosen folder, the Downloads folder by default. 還原 sits open under 自動備份, shows what a file holds before restoring, and saves the current books first.
- The trash heading no longer repeats the page's note, and 刪除 sits left of 還原.
- The web's 記帳 figures (balances, income, expense, locked date) come from the backend, so the accounting rules live in one place on the web side.
- The web dashboard has browser tests against a stand-in backend, run with the app's tests in CI.
- The app uploads its changes record by record: only records the web also changed keep the web's version, instead of the whole upload being refused.
- The web overview is cached for five minutes and cleared by any change; saving entries skips re-reading the claims, and withdrawn claims leave the ledger at once, so 操作紀錄 is no longer read on each request.
- The monthly backups go to 備份 in the ledger folder (LEDGER_FOLDER_ID) rather than the receipts folder.
- Opening the app redraws as soon as the cloud ledger arrives instead of after a second sync, and the top bar says 同步中… meanwhile (未同步 if it failed).
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
