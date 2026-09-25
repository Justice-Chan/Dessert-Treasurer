use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use calamine::{Reader, open_workbook_auto_from_rs};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, State, WebviewWindow};

const MAX_ATTACHMENT_BYTES: usize = 12 * 1024 * 1024;
const MAX_MEMBER_IMPORT_BYTES: usize = 5 * 1024 * 1024;
const MAX_MEMBER_IMPORT_ROWS: usize = 10_000;
const MAX_MEMBER_IMPORT_COLUMNS: usize = 32;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpreadsheetRows {
    rows: Vec<Vec<String>>,
}

struct AppStorage {
    connection: Mutex<Connection>,
    attachments_dir: PathBuf,
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
        let connection =
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
                 CREATE INDEX IF NOT EXISTS attachments_claim_id ON attachments (claim_id);",
            )
            .map_err(error_text)?;
        Ok(Self {
            connection: Mutex::new(connection),
            attachments_dir,
        })
    }

    fn load_state(&self) -> Result<Value, String> {
        let connection = self.connection.lock().map_err(error_text)?;
        let payload: String = connection
            .query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| {
                row.get(0)
            })
            .map_err(error_text)?;
        serde_json::from_str(&payload).map_err(error_text)
    }

    fn save_state(&self, state: &Value) -> Result<(), String> {
        if !state.is_object() {
            return Err("帳本資料格式無效".into());
        }
        let payload = serde_json::to_string(state).map_err(error_text)?;
        let connection = self.connection.lock().map_err(error_text)?;
        connection
            .execute(
                "UPDATE app_state SET payload = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
                [payload],
            )
            .map_err(error_text)?;
        Ok(())
    }

    fn store_receipts(&self, records: Vec<ReceiptInput>) -> Result<Vec<ReceiptOutput>, String> {
        // Validate the complete batch before writing any attachment file.
        for record in &records {
            validate_receipt_input(record)?;
        }
        let mut saved = Vec::with_capacity(records.len());
        for record in records {
            let (extension, bytes) = decode_attachment(&record.mime_type, &record.data_url)?;
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
                            bytes.len() as u64,
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
                size: bytes.len() as u64,
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
    Ok(ReceiptRow {
        id: row.get(0)?,
        claim_id: row.get(1)?,
        name: row.get(2)?,
        mime_type: row.get(3)?,
        size: row.get(4)?,
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

fn error_text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn is_external_http_url(value: &str) -> bool {
    let remainder = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"));
    remainder.is_some_and(|rest| !rest.is_empty() && !value.chars().any(char::is_whitespace))
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

#[tauri::command]
fn load_state(storage: State<'_, AppStorage>) -> Result<Value, String> {
    storage.load_state()
}

#[tauri::command]
fn save_state(state: Value, storage: State<'_, AppStorage>) -> Result<(), String> {
    storage.save_state(&state)
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
    let status = Command::new("open")
        .arg(&url)
        .status()
        .map_err(error_text)?;
    if status.success() {
        Ok(())
    } else {
        Err("無法使用預設瀏覽器開啟連結".into())
    }
}

#[tauri::command]
fn parse_member_spreadsheet(
    file_name: String,
    file_data: Vec<u8>,
) -> Result<SpreadsheetRows, String> {
    parse_member_spreadsheet_rows(&file_name, file_data)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let root_dir = app.path().app_data_dir()?;
            let storage = AppStorage::open(root_dir).map_err(std::io::Error::other)?;
            app.manage(storage);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            store_receipts,
            get_receipt,
            get_all_receipts,
            delete_receipts,
            clear_receipts,
            import_receipts,
            print_monthly_report,
            open_external_url,
            parse_member_spreadsheet
        ])
        .run(tauri::generate_context!())
        .expect("無法啟動甜點社總務");
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
}
