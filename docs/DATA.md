# Data and backups

## macOS storage location

App data is stored at:

```text
~/Library/Application Support/com.justicechan.dessert-treasurer/
├── treasurer.sqlite3
└── attachments/
```

The SQLite database stores entries, reimbursements, accounts, monthly reconciliations, people, activities, and trash records. The attachments directory stores receipt and QR Code images.

For the Windows preview's expected data location and acceptance checks, see [Windows testing and installation](WINDOWS.md). Each computer has its own local store; no automatic cross-platform synchronization is provided.

Do not modify the database or attachment files directly while the app is running. Use the app's full JSON backup and restore functions when moving, recovering, or preserving data.

## Recommended practice

1. Download a full JSON backup after every monthly close.
2. Keep a separate copy in iCloud Drive, on an external drive, or in trusted cloud storage.
3. Download a full backup before changing computers or making major edits.
4. Export the current data before restoring; restore replaces the current contents.

## Trash

Deleted records first move to Trash and are automatically purged after 30 days. Permanently deleted records and attachments cannot be recovered, so confirm that a backup exists first.
