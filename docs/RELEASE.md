# 發行流程

## 每次發行前

1. 更新 `package.json` 與 `src-tauri/tauri.conf.json` 的版本號。
2. 在 [CHANGELOG.md](../CHANGELOG.md) 補上使用者看得懂的變更。
3. 執行測試與建置：

```sh
npm ci
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:ui
npm run build:mac
```

4. 以正式資料匯出、還原與月結 PDF 各手動測試一次。

## GitHub Release

1. 建立 `vX.Y.Z` Git tag。
2. 在 GitHub 建立同版本 Release。
3. 上傳已簽章並公證的 DMG。
4. 將 CHANGELOG 的該版本內容貼入 Release notes。

## 對外散布

目前 `scripts/sign-macos.mjs` 使用 ad-hoc 簽章，只適合本機與內部測試。對外提供 DMG 前需要：

1. Apple Developer Program 帳號。
2. Developer ID Application 憑證。
3. 使用 Developer ID 重新簽署 `.app`。
4. 透過 Apple notarization service 公證 DMG。
5. 將 notarization ticket stapler 到 DMG。

完成上述流程後，使用者可正常從 GitHub Releases 安裝，且 Gatekeeper 不會以未知開發者阻擋。
