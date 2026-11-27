use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::Mutex,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use calamine::{Reader, open_workbook_auto_from_rs};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, State, WebviewWindow};

mod platform;

// Saves the webview has sent or queued need a moment to reach storage before the window closes.
// Quitting from the menu or Dock ends the app without a close request, so it is not covered.
const CLOSE_SAVE_GRACE: std::time::Duration = std::time::Duration::from_millis(250);
const MAX_ATTACHMENT_BYTES: usize = 12 * 1024 * 1024;
const MAX_MEMBER_IMPORT_BYTES: usize = 5 * 1024 * 1024;
const MAX_MEMBER_IMPORT_ROWS: usize = 10_000;
const MAX_MEMBER_IMPORT_COLUMNS: usize = 32;
const MAX_MEMBER_IMPORT_URL_LENGTH: usize = 2_048;
// The automatic backup keeps one file in the chosen folder, named for the day it was written
// (a slash cannot appear in a file name, so the date reads MM-DD).
const AUTO_BACKUP_PREFIX: &str = "甜點社帳務自動備份_";
const AUTO_BACKUP_FOLDER: &str = "甜點社總務備份";
const RESTORE_POINT_PREFIX: &str = "甜點社還原前備份_";
// A copy of the books as they stood before the move to one row per record, kept beside the database.
const PRE_RECORDS_COPY: &str = "state-before-records.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpreadsheetRows {
    rows: Vec<Vec<String>>,
}

struct AppStorage {
    connection: Mutex<Connection>,
    attachments_dir: PathBuf,
    // Kept on this computer: the hash and path of the last automatic backup written.
    backup_marker: PathBuf,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptInput {
    id: String,
    claim_id: String,
    name: String,
    #[serde(rename = "type")]
    mime_type: String,
    created_at: String,
    data_url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptOutput {
    id: String,
    claim_id: String,
    name: String,
    #[serde(rename = "type")]
    mime_type: String,
    size: u64,
    created_at: String,
    data_url: String,
}

// What changed since the last save. Lists whose items all carry a distinct string id are kept one
// record per row; everything else is one value per key. Payloads arrive as JSON text.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StateChanges {
    records: Vec<RecordChange>,
    order: HashMap<String, Vec<String>>,
    values: HashMap<String, String>,
    removed_values: Vec<String>,
    dropped: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordChange {
    collection: String,
    id: String,
    // None removes the record.
    payload: Option<String>,
}

struct ReceiptRow {
    id: String,
    claim_id: String,
    name: String,
    mime_type: String,
    size: u64,
    created_at: String,
    file_name: String,
}

impl AppStorage {
    fn open(root_dir: PathBuf) -> Result<Self, String> {
        let attachments_dir = root_dir.join("attachments");
        fs::create_dir_all(&attachments_dir).map_err(error_text)?;
        let mut connection =
            Connection::open(root_dir.join("treasurer.sqlite3")).map_err(error_text)?;
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA foreign_keys = ON;
                 CREATE TABLE IF NOT EXISTS app_state (
                   id INTEGER PRIMARY KEY CHECK (id = 1),
                   payload TEXT NOT NULL,
                   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT OR IGNORE INTO app_state (id, payload) VALUES (1, '{}');
                 CREATE TABLE IF NOT EXISTS attachments (
                   id TEXT PRIMARY KEY,
                   claim_id TEXT NOT NULL,
                   name TEXT NOT NULL,
                   mime_type TEXT NOT NULL,
                   size INTEGER NOT NULL,
                   created_at TEXT NOT NULL,
                   file_name TEXT NOT NULL UNIQUE
                 );
                 CREATE INDEX IF NOT EXISTS attachments_claim_id ON attachments (claim_id);
                 CREATE TABLE IF NOT EXISTS records (
                   collection TEXT NOT NULL,
                   id TEXT NOT NULL,
                   payload TEXT NOT NULL,
                   PRIMARY KEY (collection, id)
                 ) WITHOUT ROWID;
                 CREATE TABLE IF NOT EXISTS record_order (
                   collection TEXT PRIMARY KEY,
                   ids TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS state_values (
                   key TEXT PRIMARY KEY,
                   payload TEXT NOT NULL
                 );",
            )
            .map_err(error_text)?;
        move_to_records(&mut connection, &root_dir)?;
        Ok(Self {
            connection: Mutex::new(connection),
            attachments_dir,
            backup_marker: root_dir.join("last-auto-backup.txt"),
        })
    }

    fn load_state(&self) -> Result<Value, String> {
        let connection = self.connection.lock().map_err(error_text)?;
        read_state(&connection)
    }

    // Replaces everything: used for a first save, a restore and the move from the old layout.
    fn save_state(&self, state: &Value) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_text)?;
        let transaction = connection.transaction().map_err(error_text)?;
        write_state(&transaction, state)?;
        transaction.commit().map_err(error_text)
    }

    // Writes only the records and values that changed, in one transaction.
    fn save_state_changes(&self, changes: &StateChanges) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_text)?;
        let transaction = connection.transaction().map_err(error_text)?;
        apply_state_changes(&transaction, changes)?;
        transaction.commit().map_err(error_text)
    }

    fn store_receipts(&self, records: Vec<ReceiptInput>) -> Result<Vec<ReceiptOutput>, String> {
        // Validate the complete batch before writing any attachment file.
        for record in &records {
            validate_receipt_input(record)?;
        }
        let mut saved = Vec::with_capacity(records.len());
        for record in records {
            let (extension, bytes) = decode_attachment(&record.mime_type, &record.data_url)?;
            let size = u64::try_from(bytes.len()).map_err(|_| "附件檔案過大。".to_string())?;
            let sqlite_size = i64::try_from(size).map_err(|_| "附件檔案過大。".to_string())?;
            let file_name = format!("{}.{}", record.id, extension);
            let destination = self.attachments_dir.join(&file_name);
            write_atomic(&destination, &bytes)?;

            let previous_file = {
                let connection = self.connection.lock().map_err(error_text)?;
                let previous: Option<String> = connection
                    .query_row(
                        "SELECT file_name FROM attachments WHERE id = ?1",
                        [&record.id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(error_text)?;
                connection
                    .execute(
                        "INSERT INTO attachments (id, claim_id, name, mime_type, size, created_at, file_name)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                         ON CONFLICT(id) DO UPDATE SET
                           claim_id = excluded.claim_id,
                           name = excluded.name,
                           mime_type = excluded.mime_type,
                           size = excluded.size,
                           created_at = excluded.created_at,
                           file_name = excluded.file_name",
                        params![
                            record.id,
                            record.claim_id,
                            truncate(&record.name, 300),
                            record.mime_type,
                            sqlite_size,
                            record.created_at,
                            file_name,
                        ],
                    )
                    .map_err(error_text)?;
                previous
            };
            if let Some(previous) = previous_file
                && previous != file_name
            {
                remove_if_present(&self.attachments_dir.join(previous))?;
            }
            saved.push(ReceiptOutput {
                id: record.id,
                claim_id: record.claim_id,
                name: truncate(&record.name, 300),
                mime_type: record.mime_type,
                size,
                created_at: record.created_at,
                data_url: record.data_url,
            });
        }
        Ok(saved)
    }

    fn get_receipt(&self, id: &str) -> Result<Option<ReceiptOutput>, String> {
        validate_id(id)?;
        let row = {
            let connection = self.connection.lock().map_err(error_text)?;
            query_receipt(&connection, id)?
        };
        row.map(|value| self.read_receipt(value)).transpose()
    }

    fn get_all_receipts(&self) -> Result<Vec<ReceiptOutput>, String> {
        let rows = {
            let connection = self.connection.lock().map_err(error_text)?;
            let mut statement = connection
                .prepare(
                    "SELECT id, claim_id, name, mime_type, size, created_at, file_name
                     FROM attachments ORDER BY created_at, id",
                )
                .map_err(error_text)?;
            statement
                .query_map([], receipt_from_row)
                .map_err(error_text)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(error_text)?
        };
        rows.into_iter().map(|row| self.read_receipt(row)).collect()
    }

    fn delete_receipts(&self, ids: Vec<String>) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }
        for id in &ids {
            validate_id(id)?;
        }
        let mut connection = self.connection.lock().map_err(error_text)?;
        let transaction = connection.transaction().map_err(error_text)?;
        let mut files = Vec::new();
        for id in ids {
            if let Some(file_name) = transaction
                .query_row(
                    "SELECT file_name FROM attachments WHERE id = ?1",
                    [&id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(error_text)?
            {
                files.push(file_name);
            }
            transaction
                .execute("DELETE FROM attachments WHERE id = ?1", [&id])
                .map_err(error_text)?;
        }
        transaction.commit().map_err(error_text)?;
        drop(connection);
        for file in files {
            remove_if_present(&self.attachments_dir.join(file))?;
        }
        Ok(())
    }

    fn clear_receipts(&self) -> Result<(), String> {
        let ids = {
            let connection = self.connection.lock().map_err(error_text)?;
            let mut statement = connection
                .prepare("SELECT id FROM attachments")
                .map_err(error_text)?;
            statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(error_text)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(error_text)?
        };
        self.delete_receipts(ids)
    }

    fn delete_receipts_for_claims(&self, claim_ids: Vec<String>) -> Result<(), String> {
        if claim_ids.is_empty() {
            return Ok(());
        }
        for id in &claim_ids {
            validate_id(id)?;
        }
        let ids = {
            let connection = self.connection.lock().map_err(error_text)?;
            let mut ids = Vec::new();
            for claim_id in claim_ids {
                let mut statement = connection
                    .prepare("SELECT id FROM attachments WHERE claim_id = ?1")
                    .map_err(error_text)?;
                ids.extend(
                    statement
                        .query_map([claim_id], |row| row.get::<_, String>(0))
                        .map_err(error_text)?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(error_text)?,
                );
            }
            ids
        };
        self.delete_receipts(ids)
    }

    fn read_receipt(&self, row: ReceiptRow) -> Result<ReceiptOutput, String> {
        let bytes = fs::read(self.attachments_dir.join(&row.file_name)).map_err(error_text)?;
        Ok(ReceiptOutput {
            id: row.id,
            claim_id: row.claim_id,
            name: row.name,
            mime_type: row.mime_type.clone(),
            size: row.size,
            created_at: row.created_at,
            data_url: format!("data:{};base64,{}", row.mime_type, STANDARD.encode(bytes)),
        })
    }
}

fn query_receipt(connection: &Connection, id: &str) -> Result<Option<ReceiptRow>, String> {
    connection
        .query_row(
            "SELECT id, claim_id, name, mime_type, size, created_at, file_name
             FROM attachments WHERE id = ?1",
            [id],
            receipt_from_row,
        )
        .optional()
        .map_err(error_text)
}

fn receipt_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReceiptRow> {
    let sqlite_size: i64 = row.get(4)?;
    let size = u64::try_from(sqlite_size).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })?;
    Ok(ReceiptRow {
        id: row.get(0)?,
        claim_id: row.get(1)?,
        name: row.get(2)?,
        mime_type: row.get(3)?,
        size,
        created_at: row.get(5)?,
        file_name: row.get(6)?,
    })
}

fn validate_id(value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte));
    valid
        .then_some(())
        .ok_or_else(|| "附件識別碼格式無效".into())
}

fn decode_attachment(mime_type: &str, data_url: &str) -> Result<(&'static str, Vec<u8>), String> {
    let extension = match mime_type {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "application/pdf" => "pdf",
        _ => return Err("不支援的附件格式".into()),
    };
    let expected_prefix = format!("data:{mime_type};base64,");
    let encoded = data_url
        .strip_prefix(&expected_prefix)
        .ok_or_else(|| "附件內容格式無效".to_string())?;
    let bytes = STANDARD.decode(encoded).map_err(error_text)?;
    Ok((extension, bytes))
}

fn validate_receipt_input(record: &ReceiptInput) -> Result<(), String> {
    validate_id(&record.id)?;
    validate_id(&record.claim_id)?;
    let (_, bytes) = decode_attachment(&record.mime_type, &record.data_url)?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(format!("附件 {} 超過 12 MB", record.name));
    }
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
    ));
    fs::write(&temporary, bytes).map_err(error_text)?;
    fs::rename(&temporary, path).map_err(error_text)
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

// ---- State, one record per row ----

// A list is kept as records when every item is an object with a distinct, non-empty string id.
fn record_list(value: &Value) -> Option<Vec<(&str, &Value)>> {
    let items = value.as_array()?;
    let mut seen = HashSet::new();
    items
        .iter()
        .map(|item| {
            let id = item.as_object()?.get("id")?.as_str()?;
            (!id.is_empty() && seen.insert(id)).then_some((id, item))
        })
        .collect()
}

fn read_state(connection: &Connection) -> Result<Value, String> {
    let mut object = serde_json::Map::new();
    let mut values = connection
        .prepare("SELECT key, payload FROM state_values")
        .map_err(error_text)?;
    let rows = values
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(error_text)?;
    for row in rows {
        let (key, payload) = row.map_err(error_text)?;
        object.insert(key, serde_json::from_str(&payload).map_err(error_text)?);
    }

    let mut grouped: BTreeMap<String, BTreeMap<String, Value>> = BTreeMap::new();
    let mut records = connection
        .prepare("SELECT collection, id, payload FROM records")
        .map_err(error_text)?;
    let rows = records
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(error_text)?;
    for row in rows {
        let (collection, id, payload) = row.map_err(error_text)?;
        grouped
            .entry(collection)
            .or_default()
            .insert(id, serde_json::from_str(&payload).map_err(error_text)?);
    }

    let mut order: HashMap<String, Vec<String>> = HashMap::new();
    let mut orders = connection
        .prepare("SELECT collection, ids FROM record_order")
        .map_err(error_text)?;
    let rows = orders
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(error_text)?;
    for row in rows {
        let (collection, ids) = row.map_err(error_text)?;
        order.insert(collection, serde_json::from_str(&ids).map_err(error_text)?);
    }

    // Each list in its saved order; a record missing from the order, which should not happen,
    // still comes back, after the others.
    let collections: HashSet<String> = grouped.keys().chain(order.keys()).cloned().collect();
    for collection in collections {
        let mut by_id = grouped.remove(&collection).unwrap_or_default();
        let mut list: Vec<Value> = order
            .get(&collection)
            .into_iter()
            .flatten()
            .filter_map(|id| by_id.remove(id))
            .collect();
        list.extend(by_id.into_values());
        object.insert(collection, Value::Array(list));
    }
    Ok(Value::Object(object))
}

fn write_state(connection: &Connection, state: &Value) -> Result<(), String> {
    let object = state.as_object().ok_or("帳本資料格式無效")?;
    connection
        .execute_batch("DELETE FROM records; DELETE FROM record_order; DELETE FROM state_values;")
        .map_err(error_text)?;
    for (key, value) in object {
        if let Some(items) = record_list(value) {
            for (id, item) in &items {
                connection
                    .execute(
                        "INSERT INTO records (collection, id, payload) VALUES (?1, ?2, ?3)",
                        params![key, id, serde_json::to_string(item).map_err(error_text)?],
                    )
                    .map_err(error_text)?;
            }
            let ids: Vec<&str> = items.iter().map(|(id, _)| *id).collect();
            connection
                .execute(
                    "INSERT INTO record_order (collection, ids) VALUES (?1, ?2)",
                    params![key, serde_json::to_string(&ids).map_err(error_text)?],
                )
                .map_err(error_text)?;
        } else {
            connection
                .execute(
                    "INSERT INTO state_values (key, payload) VALUES (?1, ?2)",
                    params![key, serde_json::to_string(value).map_err(error_text)?],
                )
                .map_err(error_text)?;
        }
    }
    Ok(())
}

fn apply_state_changes(connection: &Connection, changes: &StateChanges) -> Result<(), String> {
    for key in &changes.removed_values {
        connection
            .execute("DELETE FROM state_values WHERE key = ?1", [key])
            .map_err(error_text)?;
    }
    for collection in &changes.dropped {
        connection
            .execute("DELETE FROM records WHERE collection = ?1", [collection])
            .map_err(error_text)?;
        connection
            .execute(
                "DELETE FROM record_order WHERE collection = ?1",
                [collection],
            )
            .map_err(error_text)?;
    }
    for change in &changes.records {
        match &change.payload {
            Some(payload) => {
                // Only an object carrying the same id may be stored under it.
                let record: Value = serde_json::from_str(payload).map_err(error_text)?;
                if record.get("id").and_then(Value::as_str) != Some(change.id.as_str()) {
                    return Err("帳本資料格式無效".into());
                }
                connection
                    .execute(
                        "INSERT INTO records (collection, id, payload) VALUES (?1, ?2, ?3)
                         ON CONFLICT (collection, id) DO UPDATE SET payload = excluded.payload",
                        params![change.collection, change.id, payload],
                    )
                    .map_err(error_text)?;
            }
            None => {
                connection
                    .execute(
                        "DELETE FROM records WHERE collection = ?1 AND id = ?2",
                        params![change.collection, change.id],
                    )
                    .map_err(error_text)?;
            }
        }
    }
    for (collection, ids) in &changes.order {
        connection
            .execute(
                "INSERT INTO record_order (collection, ids) VALUES (?1, ?2)
                 ON CONFLICT (collection) DO UPDATE SET ids = excluded.ids",
                params![collection, serde_json::to_string(ids).map_err(error_text)?],
            )
            .map_err(error_text)?;
    }
    for (key, payload) in &changes.values {
        serde_json::from_str::<Value>(payload).map_err(error_text)?;
        connection
            .execute(
                "INSERT INTO state_values (key, payload) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET payload = excluded.payload",
                params![key, payload],
            )
            .map_err(error_text)?;
    }
    Ok(())
}

// Books saved by earlier versions sit in app_state as one JSON text. They move to one row per
// record once: a copy of the text is written beside the database first, the move is checked to
// read back exactly the same, and only then is app_state emptied. Anything else leaves it as it was.
fn move_to_records(connection: &mut Connection, root_dir: &Path) -> Result<(), String> {
    let legacy: String = connection
        .query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| {
            row.get(0)
        })
        .map_err(error_text)?;
    let state: Value = serde_json::from_str(&legacy).map_err(error_text)?;
    if state.as_object().is_none_or(|object| object.is_empty()) {
        return Ok(());
    }
    let copy = root_dir.join(PRE_RECORDS_COPY);
    if !copy.exists() {
        write_atomic(&copy, legacy.as_bytes())?;
    }
    let transaction = connection.transaction().map_err(error_text)?;
    write_state(&transaction, &state)?;
    if read_state(&transaction)? != state {
        return Err("帳本搬移後內容不一致，已保留原資料。".into());
    }
    transaction
        .execute("UPDATE app_state SET payload = '{}' WHERE id = 1", [])
        .map_err(error_text)?;
    transaction.commit().map_err(error_text)
}

fn error_text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn is_external_http_url(value: &str) -> bool {
    platform::is_external_http_url(value)
}

fn truncate_spreadsheet_cell(value: impl ToString) -> String {
    value.to_string().trim().chars().take(300).collect()
}

fn parse_delimited_rows(contents: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = contents.trim_start_matches('\u{feff}').chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '"' if quoted && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            value if value == delimiter && !quoted => {
                row.push(truncate_spreadsheet_cell(&field));
                field.clear();
            }
            '\n' if !quoted => {
                row.push(truncate_spreadsheet_cell(&field));
                field.clear();
                if row.iter().any(|value| !value.is_empty()) {
                    rows.push(row);
                }
                row = Vec::new();
                if rows.len() >= MAX_MEMBER_IMPORT_ROWS {
                    break;
                }
            }
            '\r' if !quoted => {}
            value => field.push(value),
        }
    }
    if rows.len() < MAX_MEMBER_IMPORT_ROWS && (!field.is_empty() || !row.is_empty()) {
        row.push(truncate_spreadsheet_cell(&field));
        if row.iter().any(|value| !value.is_empty()) {
            rows.push(row);
        }
    }
    rows
}

fn parse_member_spreadsheet_rows(
    file_name: &str,
    file_data: Vec<u8>,
) -> Result<SpreadsheetRows, String> {
    if file_data.is_empty() || file_data.len() > MAX_MEMBER_IMPORT_BYTES {
        return Err("試算表必須介於 1 Byte 至 5 MB。".into());
    }
    let extension = file_name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension == "csv" || extension == "tsv" {
        let contents = String::from_utf8(file_data).map_err(|_| "CSV 請使用 UTF-8 編碼。")?;
        return Ok(SpreadsheetRows {
            rows: parse_delimited_rows(&contents, if extension == "tsv" { '\t' } else { ',' }),
        });
    }
    if !["xlsx", "xls", "xlsb", "ods"].contains(&extension.as_str()) {
        return Err("請選擇 Excel、OpenDocument、CSV 或 TSV 試算表。".into());
    }
    let mut workbook =
        open_workbook_auto_from_rs(Cursor::new(file_data)).map_err(|_| "無法讀取試算表。")?;
    let range = workbook
        .worksheet_range_at(0)
        .ok_or("試算表沒有可讀取的工作表。")?
        .map_err(|_| "無法讀取第一個工作表。")?;
    let rows = range
        .rows()
        .take(MAX_MEMBER_IMPORT_ROWS)
        .filter_map(|row| {
            let values = row
                .iter()
                .take(MAX_MEMBER_IMPORT_COLUMNS)
                .map(truncate_spreadsheet_cell)
                .collect::<Vec<_>>();
            values
                .iter()
                .any(|value| !value.is_empty())
                .then_some(values)
        })
        .collect();
    Ok(SpreadsheetRows { rows })
}

fn spreadsheet_extension(value: &str) -> Option<&'static str> {
    let lowercase = value.to_ascii_lowercase();
    ["xlsx", "xls", "xlsb", "ods", "csv", "tsv"]
        .into_iter()
        .find(|extension| lowercase.ends_with(&format!(".{extension}")))
}

fn prepare_member_import_url(value: &str) -> Result<(String, String), String> {
    if value.len() > MAX_MEMBER_IMPORT_URL_LENGTH {
        return Err("連結不可超過 2,048 個字元。".into());
    }
    let source = value.trim();
    let remainder = source
        .strip_prefix("https://")
        .ok_or("只支援 HTTPS 公開連結。")?;
    if source.chars().any(char::is_whitespace) {
        return Err("請輸入有效的公開 HTTPS 連結。".into());
    }
    let authority_end = remainder.find(['/', '?', '#']).unwrap_or(remainder.len());
    let authority = &remainder[..authority_end];
    if authority.is_empty() || authority.contains(['@', ':', '[', ']']) {
        return Err("請輸入有效的公開 HTTPS 連結。".into());
    }
    let host = authority.to_ascii_lowercase();
    if !host.contains('.')
        || !host.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '.' || character == '-'
        })
    {
        return Err("請輸入有效的公開 HTTPS 連結。".into());
    }
    if host == "localhost" || host.ends_with(".local") || host.parse::<std::net::IpAddr>().is_ok() {
        return Err("不支援本機或 IP 位址連結。".into());
    }
    let path_and_query = &remainder[authority_end..];
    let path = path_and_query.split(['?', '#']).next().unwrap_or("");
    if host == "docs.google.com" && path.contains("/spreadsheets/") {
        let segments = path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>();
        if let Some(id) = segments
            .windows(2)
            .find_map(|parts| (parts[0] == "d").then_some(parts[1]))
            && !id.is_empty()
            && id.chars().all(|character| {
                character.is_ascii_alphanumeric() || character == '-' || character == '_'
            })
        {
            return Ok((
                format!("https://docs.google.com/spreadsheets/d/{id}/export?format=xlsx"),
                "members.xlsx".into(),
            ));
        }
        return Err("無法辨識 Google Sheet 連結。".into());
    }
    let extension = spreadsheet_extension(path).or_else(|| {
        path_and_query
            .split('?')
            .nth(1)
            .and_then(|query| query.split('#').next())
            .and_then(|query| {
                query.split('&').find_map(|pair| {
                    let (_, value) = pair.split_once('=')?;
                    spreadsheet_extension(value).or_else(|| {
                        ["xlsx", "xls", "xlsb", "ods", "csv", "tsv"]
                            .into_iter()
                            .find(|extension| value.eq_ignore_ascii_case(extension))
                    })
                })
            })
    });
    let extension = extension.ok_or("連結必須指向 CSV、TSV、Excel 或 OpenDocument 試算表。")?;
    Ok((source.into(), format!("members.{extension}")))
}

fn fetch_member_spreadsheet_url(url: &str) -> Result<SpreadsheetRows, String> {
    let (download_url, file_name) = prepare_member_import_url(url)?;
    let bytes = platform::download_spreadsheet(&download_url, MAX_MEMBER_IMPORT_BYTES)?;
    let content = String::from_utf8_lossy(&bytes);
    if content.trim_start().starts_with("<html")
        || content.trim_start().starts_with("<!DOCTYPE html")
    {
        return Err("連結回傳登入頁面，請將試算表設為知道連結者可檢視。".into());
    }
    parse_member_spreadsheet_rows(&file_name, bytes)
}

#[tauri::command]
fn load_state(storage: State<'_, AppStorage>) -> Result<Value, String> {
    storage.load_state()
}

#[tauri::command]
fn save_state(state: Value, storage: State<'_, AppStorage>) -> Result<(), String> {
    storage.save_state(&state)
}

#[tauri::command]
fn save_state_changes(changes: StateChanges, storage: State<'_, AppStorage>) -> Result<(), String> {
    storage.save_state_changes(&changes)
}

#[tauri::command]
fn store_receipts(
    records: Vec<ReceiptInput>,
    storage: State<'_, AppStorage>,
) -> Result<Vec<ReceiptOutput>, String> {
    storage.store_receipts(records)
}

#[tauri::command]
fn get_receipt(
    id: String,
    storage: State<'_, AppStorage>,
) -> Result<Option<ReceiptOutput>, String> {
    storage.get_receipt(&id)
}

#[tauri::command]
fn get_all_receipts(storage: State<'_, AppStorage>) -> Result<Vec<ReceiptOutput>, String> {
    storage.get_all_receipts()
}

#[tauri::command]
fn delete_receipts(ids: Vec<String>, storage: State<'_, AppStorage>) -> Result<(), String> {
    storage.delete_receipts(ids)
}

#[tauri::command]
fn clear_receipts(storage: State<'_, AppStorage>) -> Result<(), String> {
    storage.clear_receipts()
}

#[tauri::command]
fn import_receipts(
    receipts: Vec<ReceiptInput>,
    replaced_claim_ids: Option<Vec<String>>,
    storage: State<'_, AppStorage>,
) -> Result<(), String> {
    for receipt in &receipts {
        validate_receipt_input(receipt)?;
    }
    match replaced_claim_ids {
        Some(ids) => storage.delete_receipts_for_claims(ids)?,
        None => storage.clear_receipts()?,
    }
    storage.store_receipts(receipts)?;
    Ok(())
}

#[tauri::command]
fn print_monthly_report(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(error_text)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !is_external_http_url(&url) {
        return Err("只支援 http 或 https 雲端連結".into());
    }
    platform::open_external_url(&url)
}

#[tauri::command]
fn parse_member_spreadsheet(
    file_name: String,
    file_data: Vec<u8>,
) -> Result<SpreadsheetRows, String> {
    parse_member_spreadsheet_rows(&file_name, file_data)
}

#[tauri::command]
async fn import_member_spreadsheet_url(url: String) -> Result<SpreadsheetRows, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_member_spreadsheet_url(&url))
        .await
        .map_err(error_text)?
}

#[derive(Debug, PartialEq)]
enum BackupOutcome {
    NoFolder,
    Written(PathBuf),
    Unchanged(PathBuf),
}

// The same content as the full JSON backup the app downloads: state, receipts, no sync secret, and
// none of the timestamps that change without the books changing.
fn auto_backup_content(storage: &AppStorage) -> Result<Option<(PathBuf, Vec<u8>)>, String> {
    let mut state = storage.load_state()?;
    let folder = state
        .pointer("/autoBackup/folder")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if folder.is_empty() {
        return Ok(None);
    }
    let receipts = storage.get_all_receipts()?;
    let object = state.as_object_mut().ok_or("帳本資料格式無效")?;
    if let Some(sync) = object.get_mut("webSync").and_then(Value::as_object_mut) {
        sync.insert("secret".into(), Value::String(String::new()));
        sync.insert("lastSyncedAt".into(), Value::String(String::new()));
    }
    object.insert("lastBackupAt".into(), Value::String(String::new()));
    object.insert("backupVersion".into(), Value::from(3));
    object.insert(
        "attachments".into(),
        serde_json::to_value(receipts).map_err(error_text)?,
    );
    let bytes = serde_json::to_vec_pretty(&state).map_err(error_text)?;
    Ok(Some((PathBuf::from(folder), bytes)))
}

fn content_hash(bytes: &[u8]) -> String {
    use std::hash::{DefaultHasher, Hasher};
    let mut hasher = DefaultHasher::new();
    hasher.write(bytes);
    format!("{:016x}", hasher.finish())
}

// On quit the backup is skipped when the books match the last one written and that file is still
// there; only the local marker is read, never the file in Drive, which may live only online.
// `force` writes regardless, for the 立即備份 button.
fn write_auto_backup(storage: &AppStorage, force: bool) -> Result<BackupOutcome, String> {
    let Some((folder, bytes)) = auto_backup_content(storage)? else {
        return Ok(BackupOutcome::NoFolder);
    };
    let hash = content_hash(&bytes);
    let marker = fs::read_to_string(&storage.backup_marker).unwrap_or_default();
    if let Some((last_hash, last_path)) = marker.split_once('\n') {
        let last_path = PathBuf::from(last_path);
        if !force && last_hash == hash && last_path.starts_with(&folder) && last_path.exists() {
            return Ok(BackupOutcome::Unchanged(last_path));
        }
    }
    fs::create_dir_all(&folder).map_err(error_text)?;
    let path = folder.join(format!(
        "{AUTO_BACKUP_PREFIX}{}.json",
        chrono::Local::now().format("%m-%d")
    ));
    write_atomic(&path, &bytes)?;
    // The new file replaces every earlier one, so the folder holds only the latest backup.
    for entry in fs::read_dir(&folder).map_err(error_text)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path() != path && name.starts_with(AUTO_BACKUP_PREFIX) && name.ends_with(".json") {
            remove_if_present(&entry.path())?;
        }
    }
    write_atomic(
        &storage.backup_marker,
        format!("{hash}\n{}", path.to_string_lossy()).as_bytes(),
    )?;
    Ok(BackupOutcome::Written(path))
}

// Google Drive for desktop mounts My Drive under ~/Library/CloudStorage on macOS and as a drive
// letter on Windows; the backup goes into a folder of its own there.
fn find_drive_backup_folder() -> Option<PathBuf> {
    let names = ["我的雲端硬碟", "My Drive"];
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("HOME")
        && let Ok(entries) = fs::read_dir(PathBuf::from(home).join("Library/CloudStorage"))
    {
        roots.extend(entries.flatten().map(|entry| entry.path()).filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("GoogleDrive-"))
        }));
    }
    if cfg!(windows) {
        roots.extend(('D'..='Z').map(|letter| PathBuf::from(format!("{letter}:\\"))));
    }
    roots
        .iter()
        .flat_map(|root| names.iter().map(move |name| root.join(name)))
        .find(|path| path.is_dir())
        .map(|path| path.join(AUTO_BACKUP_FOLDER))
}

#[tauri::command]
fn default_backup_folder() -> String {
    find_drive_backup_folder()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoBackupInfo {
    path: String,
    modified_at: String,
}

// The newest automatic backup in a folder, so the backup page can say when it last ran.
#[tauri::command]
fn auto_backup_info(folder: String) -> Option<AutoBackupInfo> {
    fs::read_dir(folder.trim())
        .ok()?
        .flatten()
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            name.starts_with(AUTO_BACKUP_PREFIX) && name.ends_with(".json")
        })
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .max_by_key(|(modified, _)| *modified)
        .map(|(modified, path)| AutoBackupInfo {
            path: path.to_string_lossy().into_owned(),
            modified_at: chrono::DateTime::<chrono::Local>::from(modified).to_rfc3339(),
        })
}

// Exports (the full backup and the CSV reports) go to a folder of the user's choosing, by default
// the Downloads folder.
#[tauri::command]
fn default_export_folder() -> String {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|home| {
            PathBuf::from(home)
                .join("Downloads")
                .to_string_lossy()
                .into_owned()
        })
        .unwrap_or_default()
}

#[tauri::command]
fn write_export_file(folder: String, name: String, contents: String) -> Result<String, String> {
    let folder = PathBuf::from(folder.trim());
    if !folder.is_absolute() {
        return Err("請先設定匯出位置".into());
    }
    // A bare file name only, so an export never lands outside the chosen folder.
    if name.is_empty() || Path::new(&name).file_name() != Some(std::ffi::OsStr::new(&name)) {
        return Err("檔名無效".into());
    }
    fs::create_dir_all(&folder).map_err(error_text)?;
    let path = folder.join(&name);
    write_atomic(&path, contents.as_bytes())?;
    Ok(path.to_string_lossy().into_owned())
}

// Restoring replaces the books, so the current ones are saved first beside the automatic backup.
// These copies keep their own name, which the automatic backup never removes.
#[tauri::command]
fn save_restore_point(storage: State<'_, AppStorage>) -> Result<String, String> {
    let Some((folder, bytes)) = auto_backup_content(&storage)? else {
        return Err("尚未設定備份資料夾".into());
    };
    fs::create_dir_all(&folder).map_err(error_text)?;
    let path = folder.join(format!(
        "{RESTORE_POINT_PREFIX}{}.json",
        chrono::Local::now().format("%Y-%m-%d_%H%M%S")
    ));
    write_atomic(&path, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root_dir = app.path().app_data_dir()?;
            let storage = AppStorage::open(root_dir).map_err(std::io::Error::other)?;
            app.manage(storage);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            save_state_changes,
            store_receipts,
            get_receipt,
            get_all_receipts,
            delete_receipts,
            clear_receipts,
            import_receipts,
            print_monthly_report,
            open_external_url,
            parse_member_spreadsheet,
            import_member_spreadsheet_url,
            default_backup_folder,
            auto_backup_info,
            save_restore_point,
            default_export_folder,
            write_export_file
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let window = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(CLOSE_SAVE_GRACE);
                    let _ = window.destroy();
                });
            }
        })
        .build(tauri::generate_context!())
        .expect("無法啟動甜點社總務")
        // Exit covers the close button, the menu and the Dock, so every way out leaves a backup.
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event
                && let Some(storage) = app.try_state::<AppStorage>()
                && let Err(error) = write_auto_backup(&storage, false)
            {
                eprintln!("自動備份失敗：{error}");
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_STORE_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temporary_store() -> (AppStorage, PathBuf) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let sequence = TEST_STORE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("dessert-treasurer-test-{unique}-{sequence}"));
        (
            AppStorage::open(root.clone()).expect("open test store"),
            root,
        )
    }

    #[test]
    fn books_from_the_old_layout_move_to_one_row_per_record() {
        let root = std::env::temp_dir().join(format!(
            "dessert-treasurer-move-{}",
            TEST_STORE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("root");
        let state = serde_json::json!({
            "entries": [{ "id": "b", "amount": 2 }, { "id": "a", "amount": 1 }],
            "people": [],
            "lockedMonths": ["2026-09"],
            "reconciliations": [{ "month": "2026-09" }],
            "webSync": { "url": "" }
        });
        {
            let connection = Connection::open(root.join("treasurer.sqlite3")).expect("old store");
            connection
                .execute_batch("CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);")
                .expect("old table");
            connection
                .execute(
                    "INSERT INTO app_state (id, payload) VALUES (1, ?1)",
                    [state.to_string()],
                )
                .expect("old books");
        }
        let store = AppStorage::open(root.clone()).expect("open and move");
        assert_eq!(store.load_state().expect("load"), state);
        assert!(root.join(PRE_RECORDS_COPY).exists());
        let connection = store.connection.lock().expect("lock");
        let rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM records WHERE collection = 'entries'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(rows, 2);
        let legacy: String = connection
            .query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| {
                row.get(0)
            })
            .expect("legacy");
        assert_eq!(legacy, "{}");
        drop(connection);
        // Opening again finds nothing left to move.
        drop(store);
        let reopened = AppStorage::open(root).expect("reopen");
        assert_eq!(reopened.load_state().expect("load again"), state);
    }

    #[test]
    fn a_save_writes_only_the_changed_records_and_keeps_their_order() {
        let (store, _) = temporary_store();
        store
            .save_state(&serde_json::json!({
                "entries": [{ "id": "a", "amount": 1 }, { "id": "b", "amount": 2 }],
                "lockedMonths": [],
                "autoBackup": { "folder": "" }
            }))
            .expect("first save");
        let changes: StateChanges = serde_json::from_value(serde_json::json!({
            "records": [
                { "collection": "entries", "id": "b", "payload": "{\"id\":\"b\",\"amount\":5}" },
                { "collection": "entries", "id": "a", "payload": null },
                { "collection": "entries", "id": "c", "payload": "{\"id\":\"c\",\"amount\":3}" }
            ],
            "order": { "entries": ["c", "b"] },
            "values": { "lockedMonths": "[\"2026-09\"]" },
            "removedValues": [],
            "dropped": ["lockedMonths"]
        }))
        .expect("changes");
        store.save_state_changes(&changes).expect("save changes");
        assert_eq!(
            store.load_state().expect("load"),
            serde_json::json!({
                "entries": [{ "id": "c", "amount": 3 }, { "id": "b", "amount": 5 }],
                "lockedMonths": ["2026-09"],
                "autoBackup": { "folder": "" }
            })
        );
        // A record must carry the id it is stored under.
        let wrong: StateChanges = serde_json::from_value(serde_json::json!({
            "records": [{ "collection": "entries", "id": "x", "payload": "{\"id\":\"y\"}" }]
        }))
        .expect("wrong change");
        assert!(store.save_state_changes(&wrong).is_err());
        assert_eq!(
            store.load_state().expect("unchanged")["entries"]
                .as_array()
                .map(Vec::len),
            Some(2)
        );
    }

    #[test]
    fn auto_backup_keeps_one_file_and_skips_unchanged_books() {
        let (store, root) = temporary_store();
        assert_eq!(
            write_auto_backup(&store, false).expect("no folder set"),
            BackupOutcome::NoFolder
        );
        let folder = root.join("drive").join(AUTO_BACKUP_FOLDER);
        let state = serde_json::json!({
            "entries": [{ "id": "entry-1", "amount": 3000 }],
            "webSync": { "url": "https://example.com", "secret": "s".repeat(32) },
            "autoBackup": { "folder": folder.to_string_lossy() }
        });
        store.save_state(&state).expect("save state");
        fs::create_dir_all(&folder).expect("backup folder");
        fs::write(
            folder.join(format!("{AUTO_BACKUP_PREFIX}01-01.json")),
            b"{}",
        )
        .expect("older backup");
        let BackupOutcome::Written(path) = write_auto_backup(&store, false).expect("first backup")
        else {
            panic!("first backup should be written");
        };
        assert_eq!(fs::read_dir(&folder).expect("backup folder").count(), 1);
        let name = path
            .file_name()
            .expect("file name")
            .to_string_lossy()
            .into_owned();
        assert!(
            name.starts_with(AUTO_BACKUP_PREFIX)
                && name.ends_with(".json")
                && name.len() == AUTO_BACKUP_PREFIX.len() + "MM-DD.json".len()
        );
        let info = auto_backup_info(folder.to_string_lossy().into_owned()).expect("backup info");
        assert_eq!(PathBuf::from(&info.path), path);
        assert!(!info.modified_at.is_empty());
        let backup: Value =
            serde_json::from_slice(&fs::read(&path).expect("read backup")).expect("backup json");
        assert_eq!(backup["backupVersion"], 3);
        assert_eq!(backup["webSync"]["secret"], "");
        assert_eq!(backup["entries"][0]["amount"], 3000);
        assert!(backup["attachments"].is_array());

        // Unchanged books, or only a new sync time, leave the file alone.
        assert!(matches!(
            write_auto_backup(&store, false),
            Ok(BackupOutcome::Unchanged(_))
        ));
        let mut synced = state.clone();
        synced["webSync"]["lastSyncedAt"] = Value::from("2026-11-20T00:00:00Z");
        store.save_state(&synced).expect("save sync time");
        assert!(matches!(
            write_auto_backup(&store, false),
            Ok(BackupOutcome::Unchanged(_))
        ));
        // The button writes anyway; a real change or a missing file writes on quit.
        assert!(matches!(
            write_auto_backup(&store, true),
            Ok(BackupOutcome::Written(_))
        ));
        let mut changed = state.clone();
        changed["entries"][0]["amount"] = Value::from(3500);
        store.save_state(&changed).expect("save change");
        assert!(matches!(
            write_auto_backup(&store, false),
            Ok(BackupOutcome::Written(_))
        ));
        remove_if_present(&path).expect("remove backup");
        assert!(matches!(
            write_auto_backup(&store, false),
            Ok(BackupOutcome::Written(_))
        ));
        drop(store);
        fs::remove_dir_all(root).expect("remove test store");
    }

    #[test]
    fn state_survives_reopening_database() {
        let (store, root) = temporary_store();
        let state = serde_json::json!({ "entries": [{ "id": "entry-1", "amount": 3000 }] });
        store.save_state(&state).expect("save state");
        drop(store);

        let reopened = AppStorage::open(root.clone()).expect("reopen test store");
        assert_eq!(reopened.load_state().expect("load state"), state);
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test store");
    }

    #[test]
    fn receipt_round_trip_uses_attachment_file() {
        let (store, root) = temporary_store();
        let input = ReceiptInput {
            id: "receipt-1".into(),
            claim_id: "claim-1".into(),
            name: "receipt.png".into(),
            mime_type: "image/png".into(),
            created_at: "2026-09-18T00:00:00Z".into(),
            data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=".into(),
        };

        store.store_receipts(vec![input]).expect("store receipt");
        let loaded = store
            .get_receipt("receipt-1")
            .expect("read receipt")
            .expect("receipt exists");
        assert_eq!(loaded.claim_id, "claim-1");
        assert!(loaded.data_url.starts_with("data:image/png;base64,"));
        assert!(root.join("attachments/receipt-1.png").is_file());

        store
            .delete_receipts(vec!["receipt-1".into()])
            .expect("delete receipt");
        assert!(
            store
                .get_receipt("receipt-1")
                .expect("query receipt")
                .is_none()
        );
        assert!(!root.join("attachments/receipt-1.png").exists());
        drop(store);
        fs::remove_dir_all(root).expect("remove test store");
    }

    #[test]
    fn invalid_attachment_prevents_the_whole_batch_from_being_written() {
        let (store, root) = temporary_store();
        let valid = ReceiptInput {
            id: "receipt-valid".into(),
            claim_id: "claim-1".into(),
            name: "receipt.png".into(),
            mime_type: "image/png".into(),
            created_at: "2026-09-20T00:00:00Z".into(),
            data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=".into(),
        };
        let invalid = ReceiptInput {
            id: "receipt-invalid".into(),
            claim_id: "claim-1".into(),
            name: "broken.pdf".into(),
            mime_type: "application/pdf".into(),
            created_at: "2026-09-20T00:00:00Z".into(),
            data_url: "not-a-data-url".into(),
        };

        assert!(store.store_receipts(vec![valid, invalid]).is_err());
        assert!(store.get_all_receipts().expect("list receipts").is_empty());
        assert!(!root.join("attachments/receipt-valid.png").exists());
        drop(store);
        fs::remove_dir_all(root).expect("remove test store");
    }

    #[test]
    fn external_link_opener_only_allows_safe_web_urls() {
        assert!(is_external_http_url(
            "https://drive.google.com/file/d/example"
        ));
        assert!(is_external_http_url("http://localhost:4173"));
        assert!(!is_external_http_url("file:///etc/passwd"));
        assert!(!is_external_http_url("https://example.com/has a space"));
        assert!(!is_external_http_url("open -a Calculator"));
    }

    #[test]
    fn member_import_reads_csv_rows_without_writing_data() {
        let rows = parse_member_spreadsheet_rows(
            "members.csv",
            "學號,系別,姓名,年級\nB123,食品科學系,陳小美,大二\nB124,\"食品,科學系\",王小明,3\n"
                .as_bytes()
                .to_vec(),
        )
        .expect("read csv");
        assert_eq!(rows.rows.len(), 3);
        assert_eq!(rows.rows[0], vec!["學號", "系別", "姓名", "年級"]);
        assert_eq!(rows.rows[2], vec!["B124", "食品,科學系", "王小明", "3"]);
    }

    #[test]
    fn member_import_links_only_allow_public_spreadsheet_sources() {
        let (google_url, google_file) = prepare_member_import_url(
            "https://docs.google.com/spreadsheets/d/example-sheet_123/edit#gid=0",
        )
        .expect("google sheet link");
        assert_eq!(
            google_url,
            "https://docs.google.com/spreadsheets/d/example-sheet_123/export?format=xlsx"
        );
        assert_eq!(google_file, "members.xlsx");

        let (_, direct_file) =
            prepare_member_import_url("https://example.edu/members.csv?download=1")
                .expect("direct csv link");
        assert_eq!(direct_file, "members.csv");
        assert!(prepare_member_import_url("http://example.edu/members.csv").is_err());
        assert!(prepare_member_import_url("https://localhost/members.csv").is_err());
        assert!(prepare_member_import_url("https://127.0.0.1/members.csv").is_err());
        assert!(prepare_member_import_url("https://example.edu/members.pdf").is_err());
    }
}
