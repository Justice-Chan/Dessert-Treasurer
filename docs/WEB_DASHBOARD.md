# Web dashboard: status and handover

Officers sign in with Google, submit reimbursement claims with receipt photos and follow their review; the treasurer reviews on the web. This note records what is built, how to deploy it, the decisions behind it and what remains.

Live site: <https://justice-chan.github.io/Dessert-Treasurer/>

## Parts

| Part | Location | Hosted on |
| --- | --- | --- |
| Dashboard (plain HTML/CSS/JS, no build step) | `web/` | GitHub Pages, deployed by `.github/workflows/deploy-pages.yml` on pushes that touch `web/` |
| Backend | `backend/Code.js`, `backend/appsscript.json` | Google Apps Script web app, runs as the deploying account |
| Data | Google Sheet (tabs: 權限表, 報帳申請, 財務彙總, 操作紀錄) and a Drive folder for receipts | The deploying account's Google Drive |

The dashboard posts `{action, idToken, payload}` to the backend. The backend verifies the Google ID token and checks the role in 權限表 on every call; the page hides controls only for convenience.

Script Properties on the Apps Script project: `OAUTH_CLIENT_ID`, `SHEET_ID`, `DRIVE_FOLDER_ID` (the parent folder; receipts go into `YYYY-MM` subfolders by submission date). Run `checkSetup` in the Apps Script editor to diagnose a wrong value.

## Run and deploy

Preview the dashboard locally:

```bash
python3 -m http.server 8081 -d web
```

Deploy the backend (needs `backend/.clasp.json`, copied from `.clasp.json.example`, and a `clasp login`):

```bash
cd backend && clasp push --force && clasp create-deployment -i <deployment id from web/config.js> -d "<what changed>"
```

Reusing the deployment id keeps the URL in `web/config.js` valid. Pushing to `main` deploys the dashboard.

Secrets never enter the repo: `.clasp.json`, `.clasprc.json` and `client_secret*.json` are git-ignored. `web/config.js` holds only the public OAuth client id and backend URL.

## Decisions

- Statuses match the app: 待審核, 已核准, 已付款, 退回. Categories mirror the app's expense categories; 其他 accepts custom text.
- Withdrawal: the applicant (own claims) or the treasurer (any claim) may withdraw while a claim is 待審核 or 退回. The row is deleted, receipts go to the Drive trash, and a row stays in 操作紀錄.
- 已付款 is set only in the desktop app and written back on sync; the web locks paid claims.
- 財務彙總 holds aggregates only, written by the app on sync. Member data stays in the app; the Sheet holds name, Gmail and role.
- The app keeps a link to each receipt and does not download photos.
- No bank details are collected.

## Status

| Phase | State |
| --- | --- |
| 0 Technical validation | Done |
| 1 Officer side: sign-in, submit, list, withdraw | Live, tested on a phone |
| 2 Treasurer side: review, approve, reject, view receipts | Live; tested with stubbed data only, not yet with real claims |
| Redesign: overview first, side navigation, light and dark themes, ASCII landing art | Live; phone performance of the landing animation not yet confirmed |
| 3 App sync | Not started |
| 4 Handover guide, monthly backup, optional email | Not started |

## Remaining work

**Phase 3, app sync.** The Tauri app pulls claims from the backend using an API secret (a new `syncPull` action), deduplicates by claim id, and removes claims that 操作紀錄 shows as withdrawn. It stores the Drive link in the claim's receipt field. It writes back 已付款 and the 財務彙總 rows the overview reads: 帳面餘額, 本月收入, 本月支出, 待處理報銷, plus one row per parent category of spending. Until then the overview shows "—" and a sample cake.

**Phase 4.** A one-page, non-technical handover guide for the next treasurer; a monthly backup of the Sheet to Drive; optional email notifications.

## Open items

- The backend, Sheet and OAuth client belong to a personal Google account. Move them to a club account before real use: redeploy, then update `web/config.js` and the OAuth client's authorised origins.
- The shared Drive folder is owned by a former officer's personal account.
- The landing animation is drawn in the browser each frame; if it stutters on older phones, lower the phone detail in `cakeScene()` in `web/art.js`.
- No favicon yet.
