// Run: node test-brex-po.js — verifies the Brex PO parser against real PO-10085/10086 text.
require('./public/js/brex-po.js');
const assert = require('assert');
const t10085 = `Send to
Acme Titanium Co
sales@acme.example
PO #
PO-10085
Created on
Jun 22, 2026
Open date
Jun 19, 2026
Close date
Jul 31, 2026
Product Qty Unit
price Total
WE-125-80x-OIC/RCL PEM ELY MEA - GEN 2A.1
Hardstop Design - PTL/GDL incl. - 010_00164_538um
Shim
35 $100.00 $3,500.00
Total $3,500.00 USD
Memo
PVC tooling incl. - Quote # 999000111
Submitting bills
fourier-earth@bills.brex.com`;
const t10086 = t10085.replace('PO-10085','PO-10086').replace(/WE-125[\s\S]*?Total \$3,500\.00 USD/,
  'WE-125-80x-OIC/RCL PEM ELY MEA - GEN 2A.1\nHardstop Design - PTL/GDL incl. 120 $93.00 $11,160.00\nTotal $11,160.00 USD');
const a = parseBrexPO(t10085), b = parseBrexPO(t10086);
assert.equal(a.poNumber, 'PO-10085');
assert.equal(a.vendor, 'Acme Titanium Co');
assert.equal(a.vendorEmail, 'sales@acme.example');
assert.equal(a.createdDate, '2026-06-22');
assert.equal(a.eta, '2026-07-31');
assert.equal(a.total, 3500);
assert.equal(a.lines.length, 1);
assert.deepEqual([a.lines[0].sku, a.lines[0].qty, a.lines[0].total], ['WE-125-80x-OIC/RCL', 35, 3500]);
assert.ok(a.terms.includes('999000111'));
assert.equal(b.lines[0].qty, 120);
assert.equal(b.total, 11160);
assert.equal(parseBrexPO('random text'), null);
console.log('ALL PARSER TESTS PASS');
