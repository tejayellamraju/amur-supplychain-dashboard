// Run: node test-robot.js — tests the pure logic in apps-script/Code.gs (converters + card builder).
const fs = require('fs'), assert = require('assert');
eval(fs.readFileSync('apps-script/Code.gs', 'utf8')); // defines toFs/fromFs/buildCard/CONFIG

// Firestore converter round-trip on a realistic pendingOrders card
const card = buildCard('thread123', {
  kind: 'quote', vendor: 'Acme Titanium', vendorEmail: 'sales@acme.example',
  poNumber: '', summary: 'Quote for 50 plates, $12,500', refLabel: 'Quote #Q-991',
  orderType: 'Credit Card', stage: 'Draft', eta: '2026-08-15', tracking: '',
  total: 12500, lines: [{ sku: '010-00065', desc: 'Ti plate', qty: 50, unit: 'ea', total: 12500 }]
}, ['specs.xlsx'], new Date(1789000000000));

assert.equal(card.id, 'pend-thread123');
assert.equal(card.gmailThreadId, 'thread123');
assert.ok(card.summary.includes('unparsed attachments: specs.xlsx'));
assert.equal(card.kindLabel, 'QUOTE — parsed from email');
assert.equal(card.draft.lines[0].sku, '010-00065');
assert.equal(card.draft.total, 12500);

const roundTripped = fromFs(toFs([card]))[0];
assert.deepStrictEqual(roundTripped, JSON.parse(JSON.stringify(card)));

// scalar edge cases
assert.deepStrictEqual(fromFs(toFs({a: null, b: true, c: 1.5, d: 0, e: '', f: []})),
                       {a: null, b: true, c: 1.5, d: 0, e: '', f: []});

// amur tag regex
assert.ok(CONFIG.PROJECT_TAG.test('Memo: amur1.1 — Quote # 12345'));
assert.ok(CONFIG.PROJECT_TAG.test('AMUR 1.1 build'));
assert.ok(!CONFIG.PROJECT_TAG.test('project zeta 2.0'));

console.log('ALL ROBOT TESTS PASS');
