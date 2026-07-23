# BOM dress rehearsal — storm prep

Goal: prove the BOM import → coverage → order-matching flow **before** the real BOM arrives,
so the real import is a known 5-minute job under pressure, not a live debugging session.

## Engine already verified (offline, zero risk)
`node test-bom-pipeline.js` runs the app's real import + coverage logic and asserts:
- column mapping, numeric coercion, blank-part-number rows dropped
- coverage (qtyOrdered summed across orders, Full/Partial/Not Started) is correct
- **replace-mode BOM import leaves `orders` and `vendors` byte-identical** — the 4 live orders cannot be affected

## Optional live UI rehearsal (safe, fully reversible)
1. **Take a fresh backup first:** dashboard → Export JSON → save into `backups/`.
2. BOM tab → Import → upload `sample-bom.csv` → map columns (they line up 1:1) → **Append** → confirm.
3. Verify: BOM tab shows 5 `ZZ-TEST-` rows; Overview BOM-coverage tile renders; a test quote CC'd to
   purchasing@ with `FP# ZZ-TEST-002` produces a card whose SKU matches that row.
4. Your 4 orders are untouched throughout (import only ever writes `bom[]`).

## Teardown — no special command needed
When the **real BOM** arrives:
- BOM tab → Import → upload the real file → choose **"Replace all BOM"** → confirm.
- This overwrites `bom[]` with only the real rows — the `ZZ-TEST-` rows vanish in that one action.
- Orders/vendors are a separate field and are never touched by a BOM import.
- (Take a backup right before this real import too — standard practice for any bulk write.)

## The one caveat during a fake-BOM window
A real vendor quote arriving while the fake BOM is loaded could get auto-matched to a `ZZ-TEST-` row.
Mitigation: the rows are labeled "TEST — DO NOT USE" so any such match is obvious on the card, and every
card is human-reviewed before it commits — a bad match is a one-click Discard.
