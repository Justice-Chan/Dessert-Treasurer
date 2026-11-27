# User guide

This guide covers installation, first-time setup, local storage and recovery. Dessert Treasurer uses a Traditional Chinese interface. Both platform builds are intended for internal use; Windows is available as a preview without completed real-device acceptance testing.

## Install on macOS

Requires macOS 13 or later on Apple Silicon.

1. Download the [macOS 0.2.2 DMG](https://github.com/Justice-Chan/Dessert-Treasurer/releases/download/v0.2.2/Dessert.Treasurer_0.2.2_aarch64.dmg). Installation notes and the DMG checksum are listed on the [0.2.2 Pre-release](https://github.com/Justice-Chan/Dessert-Treasurer/releases/tag/v0.2.2).
2. Open the DMG and drag `Dessert Treasurer.app` to Applications.
3. Eject the DMG, then open the app from Applications.

### If macOS blocks the app

This internal build uses ad-hoc signing, not an Apple Developer ID, and is not notarized. macOS may report a GitHub download as damaged. Only after confirming that the download is from the trusted repository, open Terminal and run:

```sh
xattr -dr com.apple.quarantine "/Applications/Dessert Treasurer.app"
open "/Applications/Dessert Treasurer.app"
```

Do not use this workaround for an unknown download or disable system-wide security protections. Keep the app in the Dock through **Options > Keep in Dock**.

Before updating, save pending edits, export a full JSON backup and close the app. Replace the app in Applications, not its separate data folder.

## Windows preview

The preview targets Windows 11 x64 (Intel/AMD), not ARM64. CI has successfully produced an installer; installation, native interactions, cross-platform restore and PDF printing have not completed real-device acceptance testing.

[Download the Windows 0.2.2 installer](https://github.com/Justice-Chan/Dessert-Treasurer/releases/download/v0.2.2/Dessert.Treasurer_0.2.2_x64-setup.exe) and its [SHA-256 checksum file](https://github.com/Justice-Chan/Dessert-Treasurer/releases/download/v0.2.2/Dessert.Treasurer_0.2.2_x64-setup.exe.sha256) from the [0.2.2 Pre-release](https://github.com/Justice-Chan/Dessert-Treasurer/releases/tag/v0.2.2).

### Verify and install

1. Download the `-setup.exe` installer and matching `.sha256` checksum into the same folder.
2. Open PowerShell in that folder and check the installer:

```powershell
Get-FileHash ".\Dessert.Treasurer_0.2.2_x64-setup.exe" -Algorithm SHA256
```

3. Compare the hash with the checksum supplied through the trusted channel. Matching hashes establish file integrity, not publisher identity or code signing.
4. Run the installer and open the app from the Start menu.

The installer is unsigned, so Windows may show an unknown-publisher or reputation warning. Follow your organization's policies; do not disable antivirus or system security protections.

Installation is per-user and offers Traditional Chinese and English installer text. WebView2 is required; if missing, the installer downloads Microsoft's bootstrapper, so first-time installation may need Internet access. Local bookkeeping works offline; spreadsheet and cloud receipt links need a connection.

Before updating, export a full JSON backup and close the app. Use the new installer under the same Windows user account. Do not delete the data folder during an update or uninstall. Data preservation across installer updates remains part of preview acceptance testing.

## First-time setup

1. In **Settings**, enter the cloud ledger URL and sync key from the backend administrator. The first sync uploads the books on this computer, or brings down the existing cloud ledger.
2. In **Reconciliation**, add cash and bank accounts with **＋ 新增帳戶**; each shows as a card with its current balance.
3. Record income and expenses in **Ledger**, here or on the web dashboard; both edit the same books.
4. Claims arrive from the web dashboard in **Claims**. Pay approved ones with **付款**; **＋ 新增報銷** adds one by hand.
5. Register members in **People** with **＋ 新增人員** (by hand or from a spreadsheet), then create activities to track attendance and fees.
6. At month-end, fill every account's actual balance in **月結對帳**, save, and lock the month once all match. Each month in the history prints its report; the backend also saves it as a PDF on the 1st.

## Activity payments and spreadsheet imports

Activity rosters show a per-activity **Transfer account last five digits** field instead of a payment-time input. Values are stored as text so leading zeros are preserved. The field is available before a participant is marked paid and is included in full JSON backups.

Unpaid participants are listed first in import order; paid participants follow in payment-time order. Typing all five transfer digits marks a participant paid. Marking someone paid records the current local time for ordering only, not the actual transfer time. Payment times are stored but not shown.

**名單操作** imports a spreadsheet file or link, or, once a sheet is linked, synchronizes or disconnects it, and downloads the unpaid list. Tick people to mark them 已繳, 未繳 or 參加 together from **標記為**. **清空資料** is on the Trash page.

Imports match people by student ID, then by name. A name cell may carry a department and grade label, such as `外文119 黃小明`; the label fills an empty department. A name shared by several registered people is matched only when the department singles one out. The preview lists every skipped row and the reason.

Header aliases for each import column are editable in Settings. Imports without the last-five-digits or payment-date column keep the existing values; shorter numeric suffixes are left-padded with zeros.

Public spreadsheet connections are read-only. Updating payment status in the app does not write to Google Sheets. Write-back requires a separate authenticated Google Sheets integration with editing permission and an explicit mapping to the sheet's dropdown values.

## Local data and attachments

Each computer keeps a local data store. The books also sync to the cloud ledger, which the web dashboard shares; people, activities and settings stay on the computer. Public spreadsheet connections import roster information only.

### macOS location

```text
~/Library/Application Support/com.justicechan.dessert-treasurer/
  treasurer.sqlite3
  attachments/
```

### Expected Windows location

```text
%APPDATA%\com.justicechan.dessert-treasurer\
  treasurer.sqlite3
  attachments\
```

The app uses identifier `com.justicechan.dessert-treasurer` to resolve its data directory. The Windows path is expected but has not yet been confirmed through real-device acceptance testing.

SQLite stores entries, claims, accounts, reconciliations, people, activities and trash records one row per record, so a save writes only what changed. Data from versions before this layout moves over the first time the app opens, after a copy is kept as `state-before-records.json` in the same folder; an older build opened afterwards would show empty books. The attachments folder stores receipt and account QR images. Cloud receipt links open externally rather than storing the linked image locally.

If the app cannot read this data when it opens, it shows a red read-only notice and neither saves nor syncs, so an empty book never overwrites the real one; close and reopen it.

Do not edit these files directly while the app is running. Installing a new app bundle is separate from managing the stored data.

## Backups and moving computers

1. On quit, the app writes a full backup to the folder set on the Backup page, keeping only the latest; the backend also copies the cloud ledger monthly.
2. **匯出** writes a full JSON backup or CSV reports to a chosen folder (Downloads by default). Export a full backup before major edits and before changing computers; CSV exports cannot restore people or attachments.
3. Backups contain private financial and member information; never attach them to public GitHub issues.
4. To move data, export on the source computer and restore through **還原** on the destination. Restoring shows what the file holds first and saves the current data as 甜點社還原前備份_date.json. Do not copy a live SQLite database between platforms.

Cross-platform restore is not yet verified on a Windows device. Evaluate the preview with sample records and keep production data in the existing installation until validation is complete.

## Trash and recovery

Deleted records first move to Trash and are automatically purged after 30 days. Selected records can be restored after confirmation. Permanently deleted records and attachments cannot be recovered from Trash; check that a suitable backup exists before permanent deletion.

For bugs, report reproducible steps using sample data. Report private data exposure or possible data loss through [Security](SECURITY.md), not a public issue.
