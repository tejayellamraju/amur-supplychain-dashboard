# MIGRATION — plan + full context (readable by ANY AI tool, not just Claude)

> **UPDATE 2026-07-25: the rewrite described below is BUILT.** It lives at
> `~/amur-dashboard-v1` (github.com/tejayellamraju/amur-dashboard-v1, private) — read its
> `HANDOFF.md` for current status and next steps (Phase B: enabling writes). This repo
> remains the LIVE production app and fallback; the plan below is kept as original context.

If you're an AI tool (Gemini, etc.) or a developer picking this up: read this + `CLAUDE.md` + `MAINTENANCE.md` + `ARCHITECTURE.md` first. Everything you need is in this repo — nothing is locked to Claude.

## Why migrate
`public/index.html` is a **compiled/bundled artifact** — the real app is a JSON-escaped string on line ~389, edited via fragile "string surgery" (see `CLAUDE.md`). It works and is live, but it's expensive and error-prone for *any* tool to edit. The migration rebuilds it as **normal Vite + React source** so edits become easy for anyone.

## Non-negotiable approach (safe / non-destructive)
- **New, separate project directory + repo.** Do NOT modify `my-firebase-app` — it stays **live as the fallback** the whole time.
- **Point the new app at the SAME live Firestore** (Firebase project `amur-supplychain`, document `dashboard/main`). No data migration, no sync — both apps share the same data in real time. This is what makes it safe.
- **Parity spec:** keep the existing `test-*.js` suites green (they encode the real business logic); use the current `public/index.html` as the UI target.
- **Rollout:** build in parallel → deploy to a canary URL → test against real data → flip the domain when confident → keep the old `.web.app` as instant fallback → retire the old app once proven.
- Port `apps-script/Code.gs` (email robot) and `firestore.rules` **as-is** (already source).

## Data model (mirror this exactly — full detail in the test-*.js suites)
- **One Firestore doc `dashboard/main`**: `{ bom[], orders[], vendors[], pendingOrders[], actionLog[] }`. Stats computed at render, never stored. Soft-deletes (`deleted:true`, restorable). `actionLog` capped at 200.
- **Order lifecycle — 5 stages:** `Contacted → Quoted → Ordered → Shipped → Delivered`. `Contacted` is human-set (Place Orders "Mark contacted"); the robot's earliest stage is `Quoted`. Legacy `Draft` normalizes to `Quoted` on load. COMMITTED = Ordered/Shipped/Delivered (count as coverage); INFLIGHT = Contacted/Quoted (reduce "to source" but not coverage).
- **Merge-on-approve:** an incoming PO merges into a matching **inflight** order (same vendor + same SKU set) — advances it, stamps PO/prices — instead of duplicating; never merges into a committed order; also merges by exact PO# match.
- **BOM triage from the signed `deficit` field:** `deficit<0` → **To order** (qtyRequired=|deficit|, appears in Place Orders); `deficit==0` → **Check MES**; `deficit>0` → **In stock**. Parts without a `deficit` (the 7 cell-stack) use classic coverage. Everything joins on **part number**; cost lives on ORDERS, never the BOM.
- **Overview = procurement snapshot** against the buy-list (deficit<0): Not started / Contacted / Quoted / Ordered / Shipped / Delivered, by furthest stage. Coverage % reads the buy-list only (in-stock parts don't inflate it). Spend/on-time read from orders.
- **Vendors** join to BOM/orders **by name** (not id). "+ Vendors from BOM" bulk-creates vendor records from supplier names (case-insensitive dedupe). Deleting a vendor doesn't remove it from Place Orders (BOM-driven).

## Smart BOM import (BUILD THIS — the current UI can't do it)
Clicking "Import BOM" should auto-handle the prep-sheet format (today it needs a manual Python transform):
- **Column aliases:** `Part (modified)`→partNumber, `Description`→description, `Deficit`→deficit, `supplier_name`→preferredVendor, `supplier_part_number`→vendorPartNumber, `supplier_2_name`→alternateVendor, `supplier_2_part_number`→altVendorPartNumber, `link_1`→link (skip the blank leading index column).
- **Apply the Deficit rule** (negative→to-order qty, 0→Check MES, positive→In stock) and store the signed `deficit`.
- **Canonicalize vendor names** on import (case/typo dedupe — e.g. IFM/ifm, Suzhou Fenggang/Fennagang).
- **Preserve parts that have orders** even if absent from the new sheet (so the cell-stack + its ~$243k never orphan on a Replace).
- Reference files: `BOM/amur002-bom-import.csv` (app-format example) and the source `BOM/Amur 1.1 prep - condensed view for teja_ordering.csv`.

## Robot notes
- Robot only ever writes `pendingOrders` (via `?updateMask.fieldPaths=pendingOrders`). AI output is untrusted → always lands in the Review Inbox for human approval. Claude API key lives only in Apps Script Script Properties.
- PDF attachments are parsed; images/xlsx are flagged "unparsed" (tell vendors to send POs as PDFs).

## Deferred / later
- Custom domain (e.g. `supplychain.fourier.earth`) — optional, once confident; `.web.app` is fine indefinitely.
- Gemini API + a natural-language Q&A agent — a *feature of the new app*, build after core parity.
- Per-entity Firestore docs (one doc per order) for true multi-editor concurrency.
- Firestore emulator + Playwright E2E as the automated test harness (build during migration — it's cheap against real source).

## Key facts
- Live: https://amur-supplychain.web.app · Firebase project: `amur-supplychain` · Repo: `tejayellamraju/amur-supplychain-dashboard`
- Auth: Google, domain-locked to `@fourier.earth` / `@fourierearth.com`, `email_verified` required. Import-JSON admin-only (`teja@fourier.earth`).
