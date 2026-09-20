# 資料與備份

## 儲存位置

App 的資料位於：

```text
~/Library/Application Support/com.justicechan.dessert-treasurer/
├── treasurer.sqlite3
└── attachments/
```

SQLite 資料庫保存收支、報銷、帳戶、月結、人員、活動與垃圾桶紀錄。附件資料夾保存收據及 QR Code 圖片。

請不要在 App 執行期間直接修改資料庫或附件檔案。需要轉移、修復或保留副本時，請優先使用 App 的 JSON 完整備份與還原功能。

## 建議習慣

1. 每次月結完成後，下載一份 JSON 完整備份。
2. 將備份另存至 iCloud Drive、外接硬碟或可信任的雲端空間。
3. 在換電腦或大量修改前，先下載一份完整備份。
4. 還原前先匯出目前資料；還原會取代目前內容。

## 垃圾桶

刪除資料會先移至垃圾桶，保留 30 天後由 App 自動清理。垃圾桶中永久刪除的項目與附件無法復原；請先確認已備份。
