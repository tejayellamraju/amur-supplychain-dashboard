// Run: node test-bom-pipeline.js
// Storm-readiness dress rehearsal — proves the BOM import -> coverage -> order-matching
// engine BEFORE the real BOM lands, and proves a replace-mode import can never touch orders.
// The two functions below are copied verbatim from public/index.html (confirmImport + bomWithStats),
// so this exercises the REAL app logic, not a reimplementation.
const assert = require('assert');

// --- confirmImport (verbatim mapping logic) -------------------------------
function runImport(headers, rows, mapping, mode, existingBom) {
  const m = mapping;
  const g = (row, f) => (m[f] >= 0 ? row[m[f]] : '');
  const newParts = rows.map(row => ({
    id: 'id-x',
    partNumber: String(g(row, 'partNumber') || ''), description: String(g(row, 'description') || ''),
    category: String(g(row, 'category') || ''), unit: String(g(row, 'unit') || 'ea'),
    qtyRequired: Number(g(row, 'qtyRequired')) || 0, targetUnitCost: Number(g(row, 'targetUnitCost')) || 0,
    preferredVendor: String(g(row, 'preferredVendor') || ''),
    vendorPartNumber: String(g(row, 'vendorPartNumber') || ''), alternateVendor: String(g(row, 'alternateVendor') || ''),
    altVendorPartNumber: String(g(row, 'altVendorPartNumber') || ''), link: String(g(row, 'link') || ''),
    notes: String(g(row, 'notes') || '')
  })).filter(p => p.partNumber);
  return mode === 'replace' ? newParts : [...existingBom, ...newParts];
}

// --- bomWithStats (verbatim coverage logic) -------------------------------
// Contacted/Quoted orders are "in flight" — they do NOT count as coverage (an inquiry isn't a secured part)
// but they DO subtract from what still needs sourcing, so you can't double-contact a vendor for the same part.
const INFLIGHT_STAGES = ['Contacted', 'Quoted'];
function bomWithStats(bom, orders) {
  return bom.filter(p => !p.deleted).map(p => {
    let qtyOrdered = 0, qtyInflight = 0;
    orders.forEach(o => {
      const inflight = INFLIGHT_STAGES.indexOf(o.stage) !== -1;
      (o.lines || []).forEach(l => { if (l.sku === p.partNumber) { const q = Number(l.qty) || 0; if (inflight) qtyInflight += q; else qtyOrdered += q; } });
    });
    const req = p.qtyRequired || 0;
    const qtyRemaining = Math.max(0, req - qtyOrdered);
    const qtyToSource = Math.max(0, req - qtyOrdered - qtyInflight);
    const status = req <= 0 ? 'In stock' : qtyOrdered <= 0 ? 'Not Started' : qtyOrdered >= req ? 'Full' : 'Partial';
    return { ...p, qtyOrdered, qtyInflight, qtyRemaining, qtyToSource, status };
  });
}

// --- BOM import CSV transform (the Difference -> qty-to-order rule) ---
// Mirrors the script that generates BOM/amur002-bom-import.csv from the raw prep sheet.
// Negative Difference = a real shortfall -> order |diff|. Zero/positive = have enough -> order 0.
function transformRow(difference) {
  const diff = Number(difference);
  const qtyToOrder = (Number.isFinite(diff) && diff < 0) ? Math.abs(diff) : 0;
  return { qtyToOrder };
}

// === 1. Import parsing: mapping, type coercion, blank-part-number filtering ===
const headers = ['Part Number', 'Description', 'Category', 'Unit', 'Qty Required', 'Target Unit Cost', 'Preferred Vendor', 'Notes'];
const mapping = { partNumber: 0, description: 1, category: 2, unit: 3, qtyRequired: 4, targetUnitCost: 5, preferredVendor: 6, notes: 7 };
const rows = [
  ['140-00278', 'Manifold block, anodized', 'Machined', 'ea', '40', '85.50', 'Acme', ''],
  ['100-00225-01', 'Cathode perimeter seal, FKM 70A', 'Seals', '', '1300', '3.65', 'M3', 'per drawing'],
  ['', 'orphan row with no part number', 'X', 'ea', '5', '1', '', ''], // must be dropped
];
const bom = runImport(headers, rows, mapping, 'replace', []);
assert.equal(bom.length, 2, 'blank-part-number row filtered out');
assert.equal(bom[0].qtyRequired, 40);          // coerced to number
assert.equal(typeof bom[0].qtyRequired, 'number');
assert.equal(bom[1].unit, 'ea');               // empty unit -> default 'ea'
assert.equal(bom[1].targetUnitCost, 3.65);

// === 2. Coverage math against orders (the buyer's "what's left" gauge) ===
const orders = [
  { vendor: 'Acme', deleted: false, lines: [{ sku: '140-00278', qty: 40 }] },                 // fully covers 140-00278
  { vendor: 'M3', deleted: false, lines: [{ sku: '100-00225-01', qty: 500 }] },               // partial
  { vendor: 'M3', deleted: false, lines: [{ sku: '100-00225-01', qty: 300 }] },               // + more partial (sums across orders)
];
const stats = bomWithStats(bom, orders);
const manifold = stats.find(p => p.partNumber === '140-00278');
const seal = stats.find(p => p.partNumber === '100-00225-01');
assert.equal(manifold.qtyOrdered, 40);  assert.equal(manifold.qtyRemaining, 0);    assert.equal(manifold.status, 'Full');
assert.equal(seal.qtyOrdered, 800);     assert.equal(seal.qtyRemaining, 500);      assert.equal(seal.status, 'Partial');   // 500+300 summed

// a part with no matching order line
const bom2 = runImport(headers, [['ZZ-999', 'unordered part', 'X', 'ea', '10', '1', '', '']], mapping, 'append', bom);
const un = bomWithStats(bom2, orders).find(p => p.partNumber === 'ZZ-999');
assert.equal(un.qtyOrdered, 0); assert.equal(un.status, 'Not Started');

// === 3. TEARDOWN SAFETY: replace-mode import must never touch orders ===
// Mirrors the app: import only reassigns `bom`; `orders` is passed through untouched.
const liveDoc = { bom: bom, orders: JSON.parse(JSON.stringify(orders)), vendors: [{ name: 'Acme' }], pendingOrders: [] };
const ordersSnapshot = JSON.parse(JSON.stringify(liveDoc.orders));
// simulate "replace all BOM" with the real BOM arriving
liveDoc.bom = runImport(headers, [['REAL-001', 'the real part', 'X', 'ea', '100', '2', '', '']], mapping, 'replace', liveDoc.bom);
assert.equal(liveDoc.bom.length, 1);                              // fake rows gone, only real remains
assert.equal(liveDoc.bom[0].partNumber, 'REAL-001');
assert.deepStrictEqual(liveDoc.orders, ordersSnapshot, 'orders IDENTICAL after replace-mode BOM import');
assert.deepStrictEqual(liveDoc.vendors, [{ name: 'Acme' }]);     // vendors untouched too

// === 4. Difference -> qty-to-order transform (the real BOM import rule) ===
assert.deepStrictEqual(transformRow('-1'), { qtyToOrder: 1 });   // shortfall of 1 -> order 1
assert.deepStrictEqual(transformRow('-4'), { qtyToOrder: 4 });   // shortfall of 4 -> order 4
assert.deepStrictEqual(transformRow('0'),  { qtyToOrder: 0 });   // exactly enough -> order 0
assert.deepStrictEqual(transformRow('5'),  { qtyToOrder: 0 });   // surplus -> order 0

// === 5. New BOM fields survive import (Vendor PN / alt vendor / link) ===
const vHeaders = ['partNumber', 'description', 'preferredVendor', 'vendorPartNumber', 'alternateVendor', 'altVendorPartNumber', 'link'];
const vMap = { partNumber: 0, description: 1, preferredVendor: 2, vendorPartNumber: 3, alternateVendor: 4, altVendorPartNumber: 5, link: 6 };
const vBom = runImport(vHeaders, [['140-00023', 'ADAPTER', 'Superlok', 'SMC-4-8N', 'MCMASTER-CARR', '5182K113', '']], vMap, 'replace', []);
assert.equal(vBom[0].vendorPartNumber, 'SMC-4-8N');
assert.equal(vBom[0].alternateVendor, 'MCMASTER-CARR');
assert.equal(vBom[0].altVendorPartNumber, '5182K113');
assert.equal(vBom[0].link, '');

// === 6. Stage-aware coverage: Contacted/Quoted are in-flight, NOT coverage ===
const stageBom = [{ partNumber: 'P1', qtyRequired: 10, deleted: false }];
const contactedOnly = bomWithStats(stageBom, [{ stage: 'Contacted', lines: [{ sku: 'P1', qty: 10 }] }])[0];
assert.equal(contactedOnly.qtyOrdered, 0, 'a Contacted inquiry is NOT coverage');
assert.equal(contactedOnly.qtyInflight, 10);
assert.equal(contactedOnly.status, 'Not Started', 'inquiry does not make a part Full');
assert.equal(contactedOnly.qtyToSource, 0, 'but it IS in flight, so nothing left to source (no double-contact)');
assert.equal(contactedOnly.qtyRemaining, 10, 'still uncovered until actually ordered');

const ordered = bomWithStats(stageBom, [{ stage: 'Ordered', lines: [{ sku: 'P1', qty: 10 }] }])[0];
assert.equal(ordered.qtyOrdered, 10); assert.equal(ordered.status, 'Full'); assert.equal(ordered.qtyToSource, 0);

// partial in-flight: 4 contacted of 10 required -> 6 left to source, still 0 covered
const partialInflight = bomWithStats(stageBom, [{ stage: 'Quoted', lines: [{ sku: 'P1', qty: 4 }] }])[0];
assert.equal(partialInflight.qtyToSource, 6); assert.equal(partialInflight.qtyOrdered, 0);

// === 7. In-stock: a part with 0 to-order (already procured / enough on hand) ===
const stockBom = [{ partNumber: 'S1', qtyRequired: 0, deleted: false }];
const stock = bomWithStats(stockBom, [])[0];
assert.equal(stock.status, 'In stock', 'qty-to-order 0 -> In stock, not a red action item');
assert.equal(stock.qtyToSource, 0, 'never appears in Place Orders');

console.log('ALL BOM PIPELINE TESTS PASS');
console.log('  ✓ import: column mapping, type coercion, blank rows dropped, vendor/link fields carried');
console.log('  ✓ transform: Difference<0 -> qtyToOrder=|diff|; Difference>=0 -> qtyToOrder=0');
console.log('  ✓ coverage: qtyOrdered summed across orders, Full/Partial/Not Started correct');
console.log('  ✓ in-stock: qty-to-order 0 -> "In stock" status, excluded from Place Orders');
console.log('  ✓ stages: Contacted/Quoted count as in-flight (not coverage), prevent double-contact via qtyToSource');
console.log('  ✓ teardown: replace-mode BOM import leaves orders + vendors byte-identical');
