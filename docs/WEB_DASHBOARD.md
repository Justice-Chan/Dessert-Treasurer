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

Script Properties on the Apps Script project: `OAUTH_CLIENT_ID`, `SHEET_ID`, `DRIVE_FOLDER_ID` (the parent folder; receipts go into `YYYY-MM` subfolders by submission date), `SYNC_SECRET` (at least 32 random characters; the desktop app sends it instead of a Google sign-in). Run `checkSetup` in the Apps Script editor to diagnose a wrong value.

## Run and deploy

Preview the dashboard at `http://localhost:8080/` and the desktop app's UI at `/app/`, both read from disk:

```bash
node scripts/dev-server.mjs
```

Google sign-in works locally only from an origin listed on the OAuth client.

Deploy the backend (needs `backend/.clasp.json`, copied from `.clasp.json.example`, and a `clasp login`):

```bash
cd backend && clasp push --force && clasp create-deployment -i <deployment id from web/config.js> -d "<what changed>"
```

Reusing the deployment id keeps the URL in `web/config.js` valid. Pushing to `main` deploys the dashboard.

Secrets never enter the repo: `.clasp.json`, `.clasprc.json` and `client_secret*.json` are git-ignored. `web/config.js` holds only the public OAuth client id and backend URL.

## Decisions

- Statuses match the app: 待審核, 已核准, 已付款, 退回. Categories mirror the app's expense categories; 其他 accepts custom text.
- Withdrawal: the applicant (own claims) or the treasurer (any claim) may withdraw while a claim is 待審核 or 退回. The row is deleted, receipts go to the Drive trash, and a row stays in 操作紀錄.
- The treasurer can move a claim to any status on the web, 已付款 included. That 已付款 is only a marker: on sync the app keeps the claim approved and flags it until the payment, with its date and account, is recorded in the app. The app never writes 已付款 back.
- 權限表 columns: email, position (職位), name, note. Position 總務 has the treasurer's rights; any other position (活動, 教學…) is an officer, shown in the drawer and used by the review filter. An empty position means no access. The note is for people only. Claims from people no longer listed are filed under 已離任.
- 財務彙總 holds aggregates only, written by the app on sync. Member data stays in the app; the Sheet holds name, Gmail and role.
- The app keeps a link to each receipt and does not download photos.
- No bank details are collected.
- Sign-in lasts for the tab: the Google ID token is kept in sessionStorage until it expires (one hour), then Google's auto sign-in renews it. Signing out clears it and turns auto sign-in off.
- Receipts are optional, for small purchases with no receipt or only a paper slip.
- Every claim names an activity. The form lists the activity folders in this month's `YYYY-MM` folder by name without their `01_` prefix, adding the session when a name repeats; 其他 creates a new folder, numbered as the next session if the name already exists. Receipts go into that folder.
- The overview shows when the app last synced (Script Property `SUMMARY_SYNCED_AT`, set by `syncPush`) and, for the treasurer, how many claims await review.
- Sync: the web decides 待審核, 已核准 and 退回; only a payment recorded in the app makes a claim 已付款 there. Synced claim ids must be UUIDs, and the app runs under a content security policy. A claim the app has paid ignores later web status changes. A web claim deleted in the app stays in its trash and is not pulled again. The secret is stored in the app's data file and stripped from backups.

## Status

| Phase | State |
| --- | --- |
| 0 Technical validation | Done |
| 1 Officer side: sign-in, submit, list, withdraw | Live, tested on a phone |
| 2 Treasurer side: review, approve, reject, view receipts | Live; tested with stubbed data only, not yet with real claims |
| Redesign: overview first, side navigation, light and dark themes, ASCII landing art | Live; phone performance of the landing animation not yet confirmed |
| 3 App sync | Built and tested with mocked responses; backend not yet deployed or tried against the real Sheet |
| 4 Handover guide, monthly backup, optional email | Not started |

## Remaining work

**Phase 3, finish.** Set `SYNC_SECRET`, deploy the backend, enter the URL and secret in the app's 設定, and run a sync against real claims. `syncPull` returns every claim with Drive links plus the withdrawn ids from 操作紀錄; `syncPush` only replaces 財務彙總 with the current month's overview figures: 帳面餘額, 本月收入, 本月支出, 待處理報銷 and one row per spending parent category.

**Phase 4.** A one-page, non-technical handover guide for the next treasurer; a monthly backup of the Sheet to Drive; optional email notifications.

## Open items

- The backend, Sheet and OAuth client belong to a personal Google account. Move them to a club account before real use: redeploy, then update `web/config.js` and the OAuth client's authorised origins.
- The shared Drive folder is owned by a former officer's personal account.
- The landing animation is drawn in the browser each frame; if it stutters on older phones, lower the phone detail in `cakeScene()` in `web/art.js`.
- The favicon is a stand-in cut from the club logo; replace it with a simpler drawing that reads at 32px.
