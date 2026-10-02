# Windows testing and installation

## Status

The initial target is Windows 11 x64 (Intel/AMD), for authorized internal testing. ARM64 is not included in this installer workflow. A successful CI build is not proof that installation, native interactions or monthly PDF printing work correctly on a user's computer. Complete the acceptance checklist below before announcing Windows support.

The Windows installer is unsigned. Security software may show an unknown-publisher or reputation warning. Verify the source and checksum, and follow your organization's policies; do not disable antivirus or system security protections to install it.

## Build using GitHub from a Mac

1. Commit and push the Windows-support changes to the repository's default branch. The manual workflow must be present there before GitHub displays it.
2. Open the repository's **Actions** tab.
3. Select **Build Windows Installer**, then **Run workflow** and the branch to build.
4. Wait for checks and packaging to finish successfully.
5. Open the completed run and download the `dessert-treasurer-windows-x64-...` artifact.
6. Extract the downloaded ZIP. The `-setup.exe` file is the installer; the adjacent `.sha256` file records its checksum.

This workflow does not publish a GitHub Release. Maintainers upload an accepted installer manually, together with its checksum and known limitations. Never package real databases, backups or receipt files with the app.

## Verify the installer

On Windows, use PowerShell:

```powershell
Get-FileHash ".\Dessert Treasurer_0.2.0_x64-setup.exe" -Algorithm SHA256
```

Use the actual filename from the artifact; the example version changes with releases. Compare the hash with the adjacent `.sha256` file. A matching checksum establishes file integrity, not publisher identity or Windows code signing.

## Install and update

The installer uses per-user installation rather than requiring an administrator install of the app. It offers Traditional Chinese and English installer text. The interface itself remains Traditional Chinese.

WebView2 is required. If it is absent, the installer downloads Microsoft's bootstrapper, so first-time installation may require Internet access. Once installed, bookkeeping and local file operations work offline; spreadsheet links and cloud receipt links still need network access.

Close the app before updating, and export a full JSON backup first. Update using the new installer, keeping the same user account. Do not delete the App data folder as part of an update or uninstall. Preservation across installer updates is part of acceptance testing, not assumed verified behavior.

## Local data and migration

The app resolves its data location through Tauri's `app_data_dir()` using the unchanged identifier `com.justicechan.dessert-treasurer`. On Windows, the expected location is:

```text
%APPDATA%\com.justicechan.dessert-treasurer\
  treasurer.sqlite3
  attachments\
```

Confirm the actual resolved location during Windows acceptance testing. Data is local to each computer, not synchronized between macOS and Windows.

To transfer data, export a complete JSON backup on the source computer and restore it through the app on the destination computer. Restore replaces current data; first export any existing destination data. Do not copy a live SQLite database between platforms.

## Acceptance checklist

Use a dedicated test installation with synthetic records. Do not experiment on the production club database.

- Install and launch from the Start menu on Windows 11 x64.
- Confirm all sections, Chinese text, scrolling, date controls and resizing work at 100% and 150% display scaling.
- Create and edit entries, reimbursements, accounts, people and activities.
- Pay an approved claim, verify its linked expense, then revoke the payment.
- Import local spreadsheets and public spreadsheet links; verify startup synchronization can be cancelled.
- Open cloud receipt links in the default browser; copy email addresses and account numbers.
- Attach and preview images, then verify backup/restore includes them.
- Verify activity roster dragging and editable payment times.
- Export a full JSON backup and restore it into an isolated test store.
- Confirm Trash selection, confirmation dialogs, restore and deletion.
- Save monthly reports as PDFs, including long tables, multi-line notes, page breaks and right borders. Verify the saved PDF, not only the preview.
- Restart the app and verify persistence, then install a newer build and verify data remains.
- Confirm the data folder and that no test records, personal data or backups are included in the installer.

Record the tested Windows version, display scaling, WebView2 version, installer hash and failures before promoting the preview to an internal release.
