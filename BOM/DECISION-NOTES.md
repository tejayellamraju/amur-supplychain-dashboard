# BOM import — where we paused (resume in the morning)

Status: **nothing imported yet. Live data untouched.** Decide the open question below, then import.

## The core model we agreed on (this is the unlock)
- **One source of truth: the BOM.** One "Import BOM" button. No second importer.
- **Buy-list is a *derived view*, never imported** — it's "BOM parts where we're short," shown on the Place Orders tab. It computes itself.
- **Everything joins on the part number.** BOM, orders (line SKU = part number), and the buy-list all key on it. So "buy-list now, full BOM later" maps automatically — no manual reconciliation. (Tested: orders survive a BOM re-import and re-map by part number.)
- **Cost/spend lives on ORDERS, never the BOM.** Prior-build spend (~$243k) is already tracked in the Orders tab.

## What we have vs don't
- We only have ~291 purchasing-relevant parts (prep sheet + the 876-row file both resolve to the same ~291). The **full mBOM is much bigger and NOT in any file we have** — it lives in CAD/PLM/master sheet and needs a clean export (phase 2).
- Of the 291: **193 need ordering** (Difference < 0 → qty = |Difference|); 98 have enough (order 0).
- Import file ready: `BOM/amur002-bom-import.csv` = **193 parts**, real part numbers, all qty>0, no dupes, 624 units, 134 have a vendor.

## The one open question to decide in the morning
**What loads into the BOM tab now, and what do we call it?**
- Option A (leaning): import the **193 buy-list** now to unblock ordering. Tab is a *working buy-list* until the full mBOM lands. Maybe label it honestly ("BOM (buy-list)" / "Parts to Buy") until then.
- Option B: wait, export the **full mBOM** from the master source first, load that as the real BOM, derive the buy-list. Delays ordering.
- Deciding factor: can the full mBOM be exported cleanly/soon? If yes, B may be worth it. If not, do A now.

## Import mechanics (when we go)
- Do it on the **preview** (`amur-supplychain--preview-0o5os9ol.web.app`) — it has the new code; same live DB.
- **Replace all BOM** (193-only is self-consistent; wipes the 7 prior rows from BOM but their orders + $243k stay in Orders).
- Then verify count (should be 193) and push the code to live.

## Data-quality flag to eyeball (7 parts)
Difference disagrees with Installed−Available for: 120-00062, 120-00080, 120-00081, 120-00087, 140-00238, 140-00270, 140-00469. We used the Difference column; quantities may be low.

## Decided & done (don't relitigate)
- Dropped "In Build" column (this is purchasing, not MES).
- BOM columns: Req. · Ordered · Remaining · Status (reverted my "To Order" relabel — mixed data reads wrong otherwise).
- "In stock" status exists for qty-0 parts but won't show in a 193-only import (no zeros).
- Full mBOM + on-hand (inventory) + total project spend = deliberate **phase 2** (adds the MRP layer: to-order = required − on-hand − on-order).
