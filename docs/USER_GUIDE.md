# User guide

Installation, everyday setup, local data and backups for Dessert Treasurer. The interface is in Traditional Chinese. This app is intended for internal use; Windows is an unverified preview.

## Install on macOS

Requires macOS 13 or later on Apple Silicon.

1. Download the DMG from the repository's [latest release](https://github.com/Justice-Chan/Dessert-Treasurer/releases/latest).
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

The initial target is Windows 11 x64 (Intel/AMD), not ARM64. Installation, native interactions and PDF printing still require real-device testing. A successful build alone does not establish Windows support.

Maintainers produce the installer using [the development guide](DEVELOPMENT.md#windows-installer). Use an installer supplied through a trusted internal channel or explicitly labeled preview release.

### Verify and install

1. Extract the installer ZIP, if supplied. Locate the `-setup.exe` file and adjacent `.sha256` checksum.
2. In PowerShell, check the actual installer filename:

```powershell
Get-FileHash ".\Dessert Treasurer_0.2.0_x64-setup.exe" -Algorithm SHA256
```

3. Compare the hash with the checksum supplied through the trusted channel. Matching hashes establish file integrity, not publisher identity or code signing.
4. Run the installer and open the app from the Start menu.

The installer is unsigned, so Windows may show an unknown-publisher or reputation warning. Follow your organization's policies; do not disable antivirus or system security protections.

Installation is per-user and offers Traditional Chinese and English installer text. WebView2 is required; if missing, the installer downloads Microsoft's bootstrapper, so first-time installation may need Internet access. Local bookkeeping works offline; spreadsheet and cloud receipt links need a connection.

Before updating, export a full JSON backup and close the app. Use the new installer under the same Windows user account. Do not delete the data folder during an update or uninstall. Data preservation across installer updates remains part of preview acceptance testing.

## First-time setup

1. Add cash and bank accounts with opening balances in **Reconciliation**.
2. Record income and expenses in **Ledger**.
3. Use **Claims** for reimbursements and mark approved claims as paid.
4. Register members in **People**, then create activities to track attendance and fees.
5. Reconcile balances, save the monthly report and export a full backup at month-end.

## Local data and attachments

Each computer has its own local data store. There is no automatic synchronization between Macs and Windows computers or automatic cloud backup. Public spreadsheet connections import roster information; they do not synchronize the entire database.

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

The app resolves this through Tauri's `app_data_dir()` with identifier `com.justicechan.dessert-treasurer`. Confirm the actual Windows location during preview testing.

SQLite stores entries, claims, accounts, reconciliations, people, activities and trash records. The attachments folder stores receipt and account QR images. Cloud receipt links open externally rather than storing the linked image locally.

Do not edit these files directly while the app is running. Installing a new app bundle is separate from managing the stored data.

## Backups and moving computers

1. Export a **full JSON backup** after each monthly close, before major edits and before changing computers. Use a full backup to preserve records and local attachments, not a CSV export.
2. Keep another copy in trusted cloud storage or on an external drive. Backups contain private financial and member information; never attach them to public GitHub issues.
3. To move data, export on the source computer and restore through the app on the destination computer. Do not copy a live SQLite database between platforms.
4. Export the destination's current data first: restoring replaces its existing contents.

Cross-platform restore must be verified with synthetic data before using the Windows preview with production records.

## Trash and recovery

Deleted records first move to Trash and are automatically purged after 30 days. Selected records can be restored after confirmation. Permanently deleted records and attachments cannot be recovered from Trash; check that a suitable backup exists before permanent deletion.

For bugs, report reproducible steps using sample data. Report private data exposure or possible data loss through [Security](SECURITY.md), not a public issue.
