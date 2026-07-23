# Security Hardening Handoff — Fourier Earth Supply Chain Dashboard

Give this file to Claude Code inside `my-firebase-app/`. Goal: apply the security fixes from the July 22 audit **without touching or losing any live data**.

## Context
- App = single file `public/index.html` (no build step). Live at https://amur-supplychain.web.app
- All live data lives in ONE Firestore document: `dashboard/main` (project `amur-supplychain`). Nothing below should write to it.
- Deploys happen automatically on `git push` to `main` (GitHub Action).

## STEP 0 — BACKUP FIRST (do not skip)
Before any code change, snapshot the live data two ways:
1. In the running dashboard (signed in), click **Export JSON** — save the file as `backups/dashboard-backup-YYYY-MM-DD.json` in this repo folder (create `backups/` and add it to `.gitignore` — it contains sensitive data and must NOT be committed).
2. From terminal, verify gcloud access and take a Firestore export if available:
   `gcloud firestore export gs://amur-supplychain.firebasestorage.app/firestore-backups/$(date +%F) --project=amur-supplychain`
   If this fails due to permissions, the JSON export from step 1 is sufficient — proceed.

## STEP 1 — Strip seed data from public/index.html (CRITICAL)
The `seedData()` function contains real vendor emails, PO pricing, and part specs, all visible to ANY visitor via view-source without login.
- Replace the entire body of `seedData()` so it returns: `{ bom: [], orders: [], vendors: [], pendingOrders: [] }`
- Delete all hardcoded bom/orders/vendors/pendingOrders array literals inside it.
- DO NOT change anything else in the file. This is safe because seed data only writes when `dashboard/main` doesn't exist — it already exists, so live data is unaffected.
- Verify: search the file afterward for `m3pn.com`, `aliyun.com`, `sinohykey.com`, `73125`, `144935` — zero matches expected.

## STEP 2 — Firestore security rules
Create `firestore.rules` in repo root:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /dashboard/{doc} {
      allow read, write: if request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email.matches('.*@fourier[.]earth$');
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
- Wire it into `firebase.json` (add `"firestore": { "rules": "firestore.rules" }`).
- IMPORTANT: before deploying rules, confirm the user's own sign-in email ends with `@fourier.earth` — if the team actually signs in with a different domain, adjust the regex or you will lock everyone out. Ask the user to confirm the domain first.
- Deploy: `firebase deploy --only firestore:rules --project amur-supplychain`
- Test immediately after: reload the live dashboard, confirm data still loads while signed in.

## STEP 3 — Self-host xlsx.js (remove CDN supply-chain risk)
- `mkdir -p public/vendor && curl -o public/vendor/xlsx.full.min.js https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js`
- In `public/index.html`, change the script src from the jsdelivr URL to `./vendor/xlsx.full.min.js`
- Verify the file is non-empty and the Import BOM modal still parses a test CSV locally.

## STEP 4 — Review, commit, deploy
- Show the user a full `git diff` before committing.
- Then: `git add . && git commit -m "security: strip seed data, add firestore rules, self-host xlsx" && git push`
- After the GitHub Action deploys (~1-2 min), verify:
  1. `curl -s https://amur-supplychain.web.app | grep -c m3pn` → must be 0
  2. Signed-in dashboard still shows all live data (nothing lost)
  3. An incognito window / non-company Google account cannot read data

## Console-only steps (walk the user through, not scriptable)
- Firebase console → Firestore → Disaster recovery → enable Point-in-Time Recovery
- Optionally: `gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=7d --project=amur-supplychain`
- Firebase console → App Check → enable (reCAPTCHA Enterprise) — do this LAST and in "monitor" mode first so it can't lock out the app.

## Data-safety rules for this whole task
- Never call any script/command that writes to `dashboard/main`.
- Never run `firebase deploy` for hosting manually (git push handles it).
- If anything looks wrong after deploy, the JSON backup from Step 0 restores everything via the dashboard's **Import JSON** button.
