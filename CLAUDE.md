# CLAUDE.md — Amur 002 Supply-Chain Dashboard

Auto-loaded every session. Keep it short and current. Deep detail lives in the docs linked below — this file is the map + the things a fresh session must know before touching anything.

## What this is
Internal purchasing/supply-chain dashboard for Fourier Earth's hardware project **Amur 002**. Live, in daily use.
- **Live:** https://amur-supplychain.web.app
- **Firebase project:** `amur-supplychain` (company Google account, not personal)
- **Repo:** `tejayellamraju/amur-supplychain-dashboard` (private; move to company org later)
- **Local:** `my-firebase-app/` — `firebase.json`, `.firebaserc`, `public/index.html` (the whole app), `firestore.rules`, `apps-script/` (the email robot), `test-*.js`, `smoke-test.sh`.
- **Deploy:** push to `main` → GitHub Action auto-deploys hosting. No manual `firebase deploy` for hosting. Rules deploy with `firebase deploy --only firestore:rules`.

## ⚠️ The one thing that will bite you: `public/index.html` is a bundled artifact
It is NOT hand-written HTML. It's a compiled claude.ai artifact. The real React app lives as a **JSON-escaped template string on line 389** (0-indexed 388). Line 377 is a base64 image manifest — don't touch. Edit via Python string surgery, never by hand:
```python
import json
lines = open('public/index.html').read().split('\n')
tpl = json.loads('"' + ... )   # the string literal on line 389
# ... simpler: the line is  <script ...>...</script> holding a JSON string; decode, edit, re-encode:
# decode:  s = json.loads(lines[388][lines[388].index('"'):lines[388].rindex('"')+1])   (adjust to the actual quotes)
# re-encode: json.dumps(s).replace('</', '<\\u002F')   # </ MUST stay escaped as </
```
Practical method that's been used: extract the line, `json.loads` it, do string replaces on the decoded template, `json.dumps` it back, `.replace('</','<\\u002F')`, write the line back, then **round-trip assert** the file still parses and re-read to confirm the edit landed. Custom template syntax inside: `{{ }}`, `<sc-if>`, `<sc-for>`. **The weekend source-migration plan exists specifically to escape this pain** — see deferred-checklist memory.

## Data model — one Firestore doc `dashboard/main`
`{ bom[], orders[], vendors[], pendingOrders[], actionLog[] }`. Stats (coverage %, spend, on-time) are computed at render by matching order line SKUs → BOM part numbers, never stored. `seedData()` is empty and only runs if the doc is missing. Soft-deletes (`deleted:true`, restorable). `actionLog` capped at 200. Full field lists: HANDOFF.md + ARCHITECTURE.md.

## Non-negotiable design decisions (don't regress these)
- **Robot only ever writes `pendingOrders`** — never orders/bom/vendors. It uses IAM (Cloud Datastore User) which *bypasses* security rules, so containment is code-level: it PATCHes with `?updateMask.fieldPaths=pendingOrders`.
- **AI output is untrusted** → always lands in the Review Inbox for human approval; never auto-commits to orders/bom/vendors.
- **Claude API key lives ONLY in Apps Script Script Properties** (server-side). The client page cannot and must not call Claude directly. Never commit the key; `backups/` is gitignored and never committed.
- **Auth:** Google sign-in, domain-locked to `@fourier.earth` / `@fourierearth.com`, `email_verified` required (firestore.rules). Import-JSON is admin-only (`teja@fourier.earth`).
- **Idempotent writes** keyed by stable identity (Gmail thread id, PO#). New approved orders get a fresh `uid()` (the cascade-delete bug — see below).
- User drives all cloud-console/billing/IAM changes themselves — don't run gcloud/CLI against the live project unprompted.

## How to change things safely
1. Edit `public/index.html` (Python surgery above) or `apps-script/Code.gs`.
2. `node test-app-logic.js && node test-dedup.js && node test-robot.js && node test-bom-pipeline.js && node test-brex-po.js` — all must pass. Add a regression test for every bug.
3. Preview before prod: `npx -y firebase-tools@latest hosting:channel:deploy preview --project amur-supplychain`, then `sh smoke-test.sh <preview-url>`.
4. Only then commit + push. See TESTING.md for the full 4-layer strategy.
- Recovery net if data is touched: PITR (7-day rewind) + Activity-log restore + Export JSON. Enabled: Blaze + PITR.

## Known-bug landmines (regression-tested; don't reintroduce)
- **Cascade delete:** approved orders reusing a card's thread-id as `id` → `deleteOrder(id)` wiped all same-id orders. Fixed: `uid()` on new orders in `approvePending`/`editPending`/`openAddOrder`.
- **Coverage counted deleted orders** → `bomWithStats`/`vendorsWithStats` filter `!o.deleted`.
- **Concurrency guard on `save()` was built then reverted** (display glitch). `save()` is plain synchronous `docRef.set`. Real fix is per-entity docs, not a save() guard — deferred.

## Current open work (what we were mid-flight on)
**BOM import + Order-by-Vendor view** — the "main thing for this whole project." Not yet built. Plan (locked):
- Import source: `BOM/Amur 1.1 prep - all unique parts.csv` (~295 rows, header at row index 2).
- Qty logic: `Difference < 0` → Qty Required = `|Difference|`; `Difference >= 0` → Qty Required = 1 placeholder, flagged Category = `REVIEW-no-shortage`.
- New BOM fields to add to the bundle: **Vendor Part #** (`supplier_part_number`, VISIBLE column — user overrode hiding it in Notes), **Alternate Vendor** (`supplier_2_name`), **Alt Vendor Part #** (`supplier_2_part_number`), **link** (importable, left empty; team adds later). Vendor + Alternate Vendor become dropdowns sourced from vendors ∪ BOM suppliers.
- **Order-by-Vendor view:** group parts by vendor where qty remaining > 0; per-vendor list (Part# · Desc · Vendor PN · Qty · link); buttons: Copy list, Compose email (`mailto:` to vendor), Mark selected as ordered (creates tracked orders → robot then auto-updates them from vendor emails).
- Deterministic grouping + `mailto:` compose is the build-now path; **AI-drafted PO emails saved as Gmail drafts is phase 2** (needs bot `gmail.compose` scope).
- Process: generate import-ready CSV, show worked examples + counts, backup → import (Replace mode) → verify. Don't touch live until examples are reviewed.

## If this terminal closes — recovery (you are NOT in soup)
Everything needed to resume lives on disk and persists across sessions:
1. **This file (CLAUDE.md)** — auto-loaded, the map.
2. **`~/.claude/projects/-Users-tejayellamraju-my-firebase-app/memory/`** — persistent memory across ALL sessions. `MEMORY.md` is the index; key files: `index-html-is-bundled-artifact.md`, `be-decisive-act-as-expert.md`, `deferred-checklist.md`.
3. **ARCHITECTURE.md** — full technical deep-dive (system diagram, robot pipeline, data/trust model, trade-offs).
4. **TESTING.md** — release/test strategy. **HANDOFF.md** / **SECURITY-HANDOFF.md** — original onboarding (partly stale: security TODOs there are DONE, email is `purchasing@fourier.earth` not the old `orders@`).
5. **deferred-checklist memory** — the full backlog (bot OU lockdown, App Check, repo→org, source migration, presentations, scaling triggers).
To resume: open a terminal in `my-firebase-app/`, run `claude`, say "read CLAUDE.md and continue." Git history is the other source of truth (`git log`).

## Brand
Victor Mono font. Colors `#F5FD01` yellow, `#020202` black, `#F9F8F3` off-white, `#B49A75`/`#8A7A5C` tan, `#F9C733` amber. Flat, square corners, no shadows. Logo `assets/fourier-logo.png`.
