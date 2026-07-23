# Handoff: Fourier Earth B7 Supply Chain Dashboard

## Overview
This is a **working, deployed production app**, not a design mockup — Claude Code's job is to keep extending this exact codebase, not recreate it elsewhere.

- **Live site**: https://amur-supplychain.web.app
- **Repo**: `tejayellamraju/amur-supplychain-dashboard` on GitHub (personal account — plan to move to a company org later)
- **Local project folder**: `my-firebase-app/` — contains `firebase.json`, `.firebaserc`, and `public/index.html` (the entire app, single self-contained HTML file with inline JS, no build step)
- **Hosting**: Firebase Hosting, auto-deploys via GitHub Actions on every push to `main`
- **Backend**: Firebase Auth (Google sign-in, restricted to the company email domain via Firestore rules) + Firestore (single document `dashboard/main` holds all data: `bom[]`, `orders[]`, `vendors[]`, `pendingOrders[]`, `actionLog[]`)
- **Firebase project**: `amur-supplychain` (owned by the company's Google account, not personal)

## How to make changes with Claude Code
1. `cd` into `my-firebase-app/`
2. Run `claude` in the terminal
3. Describe what you want changed in plain English (same as this conversation) — Claude Code edits `public/index.html` directly
4. To see changes: since there's no build step, just open `public/index.html` in a browser, or run a local server (`npx serve public`) and refresh
5. To deploy: `git add . && git commit -m "..." && git push` — the GitHub Action auto-deploys to the live URL. No manual `firebase deploy` needed.

## Data model (all inside the one Firestore document `dashboard/main`)
- `bom[]` — `{ id, partNumber, description, category, unit, qtyRequired, targetUnitCost, preferredVendor, notes, deleted, deletedAt, deletedBy }`
- `orders[]` — `{ id, poNumber, orderType ('Purchase Order'|'Credit Card'), vendor, vendorEmail, category, stage ('Draft'|'Ordered'|'Shipped'|'Delivered'), createdDate, eta, deliveredDate, terms, tracking, total, lines: [{sku, desc, qty, unit, total, receivedQty}], lastEditedBy, lastEditedAt, deleted, deletedAt, deletedBy }`
- `vendors[]` — `{ id, name, email, terms, notes, deleted, deletedAt, deletedBy }`
- `pendingOrders[]` — parsed-but-unapproved orders awaiting review in the Review Inbox tab
- `actionLog[]` — audit trail: `{ id, action, entityType, entityId, description, by, at }`, capped at 200 entries, newest first

**Important quirk**: BOM/order/vendor computed stats (qty ordered, coverage %, vendor spend) are all derived at render time by matching order line SKUs against BOM part numbers — never stored. Seed data (in `seedData()` function near the top of the script) only applies when the Firestore document doesn't exist yet; once real data is saved, seed data in code has no effect unless the document is deleted.

## What's built
- Overview tab: budget bar, orders-by-stage donut, BOM coverage %, vendor spend
- BOM tab: searchable/filterable table, add/edit/delete (soft-delete), CSV/Excel import with column mapping
- Orders tab: PO#/Credit Card tracking, stage dropdown, line items, timeliness badges, short-shipment flags
- Vendors tab: computed spend/PO count/on-time %
- Review Inbox tab: placeholder UI for approving/editing/discarding AI-parsed orders (not yet wired to real automation)
- Activity log (small link near sign-out): audit trail with restore for soft-deleted items
- Google sign-in gate, domain-restricted via Firestore rules

## What's next (in priority order)
1. **Email-to-dashboard pipeline**: Google Apps Script, timer-triggered (~every 10 min), scans a dedicated Gmail label/inbox (`orders@fourierearth.com`, a Collaborative Inbox Google Group — no extra Workspace seat), sends email text + attachments to the Claude API for extraction (PO#, vendor, line items, dates, tracking), classifies new-order vs. update-to-existing, upserts into `pendingOrders` **keyed by Gmail thread ID** (never duplicate per-message). Claude API key must live in Apps Script's Script Properties, never client-side.
2. **PO PDF attachment + auto-fill**: since Brex-generated PO PDFs have a consistent layout, parse them deterministically (no AI needed) when dropped onto the Add Order modal — reuse the same `pdf-parse` approach already proven against the 3 real POs in this project's history.
3. **Quote PDF/attachment drop with AI auto-fill**: same drop-to-fill UX as #2, but needs Claude (vendor quote formats vary) since it's not our own fixed layout.
4. **Check-in agent**: every 2 weeks, drafts (not sends) a status-check email per stale/overdue order, reusing the Apps Script infrastructure from #1. Start draft-only; move to auto-send only once trusted.
5. **Flexport shipment tracking** (for the international/freight-forwarded orders only — NOT domestic parcel vendors like McMaster): pull shipment status via Flexport's Platform API keyed by PO#/reference, auto-update order stage. Requires confirming Flexport API access on the account first.

## Design principles established (keep these when extending)
- Firestore/dashboard data is the single reconciled view; Brex remains the system of record for actual money committed — nothing should auto-write to Brex.
- AI-parsed data (email/quote extraction) is an **untrusted signal** — it always lands in a staging/review area first, never directly overwrites `orders`/`bom`/`vendors`.
- Any new automated write should be idempotent (upsert keyed by a stable identity — thread ID, PO#), never append-and-dedupe-later.
- Every edit stamps `lastEditedBy`/`lastEditedAt`; every delete is soft (never hard-delete) and logged to `actionLog`.
- No autonomous "AI agent" — every AI touchpoint is a single extraction call, human approves before anything commits (except the two explicitly-scoped monitoring agents in the roadmap above, which only read/flag, never act unprompted).

## Security hardening TODO (from audit, July 22 2026) — do these FIRST
1. **Strip seed data from `public/index.html`** (CRITICAL — real vendor emails, PO pricing, and part specs are visible to anyone via view-source, no login needed). Find the `seedData()` function and replace its body so it returns empty arrays: `return { bom: [], orders: [], vendors: [], pendingOrders: [] };` — delete all the hardcoded bom/orders/vendors/pendingOrders literals. Safe because the live Firestore doc `dashboard/main` already exists; seed only runs if the doc is missing.
2. **Review/write `firestore.rules`**: require `request.auth != null && request.auth.token.email.matches('.*@fourier[.]earth$') && request.auth.token.email_verified == true` for BOTH read and write on `dashboard/{doc}`. Deny everything else. Deploy with `firebase deploy --only firestore:rules`.
3. **Enable Point-in-Time Recovery + backups**: Firebase console → Firestore → Disaster recovery → enable PITR; also set up scheduled backups (`gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=7d`).
4. **Self-host xlsx.js**: download `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js` into `public/vendor/xlsx.full.min.js`, change the script src in index.html to `./vendor/xlsx.full.min.js`.
5. **Enable Firebase App Check** (reCAPTCHA Enterprise) before wider rollout.
6. **Repo hygiene**: confirm repo private, 2FA on GitHub account, migrate to company org.
7. **Audit log hardening (later)**: mirror actionLog entries to a separate append-only collection (rules: allow create, deny update/delete).

## Brand / styling reference
- Font: Victor Mono (Google Fonts)
- Colors: `#F5FD01` (sun yellow), `#020202` (off-black), `#F9F8F3` (off-white), `#B49A75`/`#8A7A5C` (tan/muted brown), `#F9C733` (amber)
- Flat, square-cornered, no rounded corners, no shadows — industrial/utilitarian aesthetic
- Logo asset: `assets/fourier-logo.png` (already in the repo)
