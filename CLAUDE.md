# CLAUDE.md — Amur 002 Dashboard, OLD app (BENCHED — not production since 2026-07-25)

## ⚠️ STOP: the live dashboard no longer lives here
Production is the **rewrite**: `~/amur-dashboard-v1` (github.com/tejayellamraju/amur-dashboard-v1),
serving https://amur-supplychain.web.app. **All new work happens THERE** — read its
CLAUDE.md / README.md / HANDOFF.md. This repo is kept as the emergency fallback and as
the deployment home of the email robot's history.

What this repo still matters for:
1. **Rollback**: if the new app must be pulled, the old app here can be restored to the
   live URL — Firebase console → Hosting → Rollback (fastest), or
   `npx -y firebase-tools@latest deploy --only hosting --project amur-supplychain` from
   this folder. Its GitHub auto-deploy workflows were DISABLED on 2026-07-25 (re-enable
   under GitHub → Actions if this app is ever made primary again).
2. **History/context**: ARCHITECTURE.md (system + robot deep-dive), TESTING.md,
   MIGRATION.md (the plan the rewrite fulfilled), HANDOFF.md / SECURITY-HANDOFF.md (stale
   in places), BOM/ (import source sheets).
3. **The robot** (`apps-script/Code.gs`) is deployed in Apps Script (Google's servers),
   not from any repo. Both repos hold a copy of the source; treat the NEW repo's copy as
   canonical going forward.

## If you must edit THIS app (rollback scenario only)
`public/index.html` is a compiled claude.ai artifact — NOT hand-editable. The real app is a
JSON-escaped template string on line 389 (0-indexed 388); line 377 is a base64 image
manifest. Edit via Python string surgery: decode the JSON string literal, string-replace on
the decoded template, `json.dumps(...).replace('</', '<\\u002F')` back, round-trip assert.
Custom template syntax inside: `{{ }}`, `<sc-if>`, `<sc-for>`. This pain is WHY the rewrite
exists — prefer fixing forward in the new repo over editing this bundle.

## Shared facts (both apps)
- One Firestore doc `dashboard/main` in project `amur-supplychain`; the new app added
  `dashboard/roles`. Rules (managed from the NEW repo) enforce roles server-side.
- Robot only ever writes `pendingOrders` (IAM bypasses rules; containment is its
  `?updateMask.fieldPaths=pendingOrders` PATCH). AI output is untrusted → Review Inbox.
- Claude API key lives ONLY in Apps Script Script Properties. `backups/` stays gitignored.
- Auth: Google sign-in, domain-locked to @fourier.earth / @fourierearth.com, verified email.
- Recovery net: PITR (7-day rewind), JSON exports, this fallback app.

## Memory
Persistent notes for ALL sessions: `~/.claude/projects/-Users-tejayellamraju-my-firebase-app/memory/`
(`MEMORY.md` is the index; `source-migration-status.md` has the full migration story).
