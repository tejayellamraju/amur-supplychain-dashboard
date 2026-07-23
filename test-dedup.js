// Run: node test-dedup.js — tests the robot's duplicate classifier (classifyDuplicate) from Code.gs.
const fs = require('fs'), assert = require('assert');
// pull just the helpers we need out of Code.gs (they're plain functions, no GAS globals)
const src = fs.readFileSync('apps-script/Code.gs', 'utf8');
for (const fn of ['function norm', 'function classifyDuplicate', 'function matchLabel']) {
  const start = src.indexOf(fn);
  // grab from the declaration to the next blank-line-preceded top-level function or end
  const rest = src.slice(start);
  const end = rest.indexOf('\n}\n');
  eval(rest.slice(0, end + 3));
}

const mkCard = (o) => ({ refNumber: o.refNumber || '', draft: {
  poNumber: o.poNumber || '', refNumber: o.refNumber || '', vendor: o.vendor || '',
  total: o.total || 0, lines: o.lines || [] } });

const orders = [
  { vendor: 'Valworx Inc', poNumber: '', refNumber: '25118', refLabel: 'Quote #25118', total: 3246.48, deleted: false, lines: [{ sku: '' }] },
  { vendor: 'M3 Partners', poNumber: 'PO-10089', refNumber: '', total: 17395, deleted: false, lines: [{ sku: '100-00225-01' }] },
  { vendor: 'Old Vendor', poNumber: 'PO-9000', refNumber: '', total: 500, deleted: true, lines: [] }, // soft-deleted, must be ignored
];

// 1. exact by PO number
assert.equal(classifyDuplicate(mkCard({ vendor: 'M3 Partners', poNumber: 'PO-10089', total: 17395 }), orders).level, 'exact');
// 2. exact by vendor + ref number (the no-PO Valworx case — the actual bug)
let r = classifyDuplicate(mkCard({ vendor: 'Valworx Inc', refNumber: '25118', total: 3246.48 }), orders);
assert.equal(r.level, 'exact'); assert.ok(r.why.includes('25118'));
// 3. fuzzy by vendor + matching total, no numbers shared
assert.equal(classifyDuplicate(mkCard({ vendor: 'Valworx Inc', total: 3246.48 }), orders).level, 'fuzzy');
// 4. fuzzy by vendor + overlapping SKU even if total differs
assert.equal(classifyDuplicate(mkCard({ vendor: 'M3 Partners', total: 99, lines: [{ sku: '100-00225-01' }] }), orders).level, 'fuzzy');
// 5. genuinely new — different vendor
assert.equal(classifyDuplicate(mkCard({ vendor: 'BrandNew Co', total: 999 }), orders).level, 'none');
// 6. same vendor, different total, no shared ref/sku -> NOT a dup (a real second order)
assert.equal(classifyDuplicate(mkCard({ vendor: 'Valworx Inc', refNumber: '99999', total: 8000 }), orders).level, 'none');
// 7. a match against a soft-deleted order must NOT count
assert.equal(classifyDuplicate(mkCard({ vendor: 'Old Vendor', poNumber: 'PO-9000', total: 500 }), orders).level, 'none');
// 8. PO match wins over everything (case-insensitive)
assert.equal(classifyDuplicate(mkCard({ vendor: 'm3 partners', poNumber: 'po-10089', total: 1 }), orders).level, 'exact');

console.log('ALL DEDUP TESTS PASS');
console.log('  ✓ exact: PO# and vendor+ref# (covers no-PO website orders like Valworx)');
console.log('  ✓ fuzzy: vendor+total and vendor+SKU-overlap flagged');
console.log('  ✓ safe: different order NOT flagged; soft-deleted orders ignored');
