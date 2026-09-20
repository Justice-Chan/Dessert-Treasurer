# Dessert Treasurer

甜點社總務的 macOS 桌面帳務工具。以 Tauri 2 封裝，提供收支記帳、報銷、對帳、人員與活動收費管理、附件、備份還原、垃圾桶與月結報表。

## 使用方式

1. 從 GitHub Releases 下載最新的 DMG。
2. 將 `Dessert Treasurer.app` 拖到「應用程式」。
3. 第一次開啟若遇到 Gatekeeper，請在 Finder 對 App 按右鍵後選「打開」。
4. 每次月結完成後，到「資料匯出」下載 JSON 完整備份。

資料只存於本機，不會上傳到雲端。詳見 [資料與備份說明](docs/DATA.md)。

## 專案結構

```text
assets/       圖示原檔
docs/         資料與發行文件
scripts/      網頁建置、簽章與測試伺服器
src-tauri/    Rust、SQLite 與 Tauri 原生設定
tests/        Playwright UI 測試
index.html    應用程式介面與互動邏輯
```

## 開發環境

- macOS 13 或以上
- Node.js 24（見 `.node-version`）
- Rust stable（見 `rust-toolchain.toml`）
- Xcode Command Line Tools

```sh
npm ci
npm run dev
```

## 驗證與建置

```sh
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:ui
npm run build:mac
npm run build:dmg
```

macOS App 輸出於：

```text
src-tauri/target/release/bundle/macos/Dessert Treasurer.app
```

DMG 輸出於 `src-tauri/target/release/bundle/dmg/`。未公證的 DMG 僅限內部測試。

UI 測試需要可監聽本機連接埠；若企業安全軟體封鎖 localhost，請允許 Node.js 監聽 `127.0.0.1:4173`。

## 發行

首次公開前請依 [發行流程](docs/RELEASE.md) 完成 Apple Developer ID 簽章與 notarization。未簽章版本適合自用與內部測試，但外部使用者可能會收到 Gatekeeper 提示。

## 授權

目前未授權公開重用。若要公開授權，請在首次 GitHub 發布前選定 LICENSE。
