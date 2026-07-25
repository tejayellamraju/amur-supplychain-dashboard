// Run: node test-app-logic.js
// Vigorous regression + edge-case tests for the dashboard's business logic.
// Reducers below are ported VERBATIM from public/index.html (the bundled app) so this
// exercises the real logic, not a paraphrase. Every past bug has a regression test here.
const assert = require('assert');

// ---- mocked `this` dependencies (deterministic) ----
let _id = 0;
const uid = () => 'id-' + (++_id);
const NOW = 1790000000000;
const EMAIL = 'test@fourier.earth';
const pushLog = (s, entry) => [{ id: uid(), at: NOW, by: EMAIL, ...entry }, ...(s.actionLog || [])].slice(0, 200);
const timeliness = (o) => {
  if (o.stage === 'Delivered') { if (o.deliveredDate && o.eta) return o.deliveredDate <= o.eta ? 'On time' : 'Late'; return 'On time'; }
  if (o.eta) { const today = '2026-07-23'; if (o.eta < today) return 'Overdue'; }
  return 'Pending';
};

// ---- reducers ported verbatim from the bundle ----
const deleteOrder = (s, id) => ({
  orders: s.orders.map(o => o.id === id ? { ...o, deleted: true, deletedAt: NOW, deletedBy: EMAIL } : o),
  actionLog: pushLog(s, { action: 'deleted', entityType: 'order', entityId: id, description: 'Deleted order' })
});
const restoreEntity = (s, entityType, id) => {
  const key = entityType === 'bom' ? 'bom' : entityType === 'order' ? 'orders' : 'vendors';
  const arr = s[key].map(item => item.id === id ? { ...item, deleted: false, deletedAt: null, deletedBy: null } : item);
  return { [key]: arr, actionLog: pushLog(s, { action: 'restored', entityType, entityId: id }) };
};
const LEGACY_STAGE = { Draft: 'Quoted' };
const normStage = st => LEGACY_STAGE[st] || st;
const nrm = x => String(x == null ? '' : x).trim().toLowerCase();
const skuKey = j => JSON.stringify((((j && j.lines) || []).map(l => l.sku).filter(Boolean)).sort());
const approvePending = (s, id) => {
  const pend = s.pendingOrders.find(p => p.id === id);
  if (!pend) return null;
  const _d = pend.draft;
  const _byPo = _d.poNumber ? s.orders.find(o => o.poNumber === _d.poNumber) : null;
  const _byInflight = _byPo ? null : s.orders.find(o => !o.deleted && INFLIGHT_STAGES.indexOf(o.stage) !== -1 && nrm(o.vendor) === nrm(_d.vendor) && skuKey(o) !== '[]' && skuKey(o) === skuKey(_d));
  const existing = _byPo || _byInflight;
  const orders = existing ? s.orders.map(o => o.id === existing.id ? { ...o, ..._d, id: o.id } : o) : [...s.orders, { ..._d, id: uid() }];
  const vendors = s.vendors.some(v => v.name === pend.draft.vendor) ? s.vendors : [...s.vendors, { id: uid(), name: pend.draft.vendor, email: '', terms: pend.draft.terms || '', notes: '' }];
  return { orders, vendors, pendingOrders: s.pendingOrders.filter(p => p.id !== id), actionLog: pushLog(s, { action: 'approved' }) };
};
const saveModalOrder = (s, draft, isNew, fromPendingId) => {
  const stampedDraft = { ...draft, lastEditedBy: EMAIL, lastEditedAt: NOW };
  const total = (stampedDraft.lines || []).reduce((a, l) => a + (Number(l.total) || 0), 0) || stampedDraft.total;
  const finalDraft = { ...stampedDraft, total };
  return {
    orders: isNew ? [...s.orders, finalDraft] : s.orders.map(o => o.id === finalDraft.id ? finalDraft : o),
    vendors: s.vendors.some(v => v.name === finalDraft.vendor) || !finalDraft.vendor ? s.vendors : [...s.vendors, { id: uid(), name: finalDraft.vendor, email: finalDraft.vendorEmail || '', terms: finalDraft.terms || '', notes: '' }],
    pendingOrders: fromPendingId ? s.pendingOrders.filter(p => p.id !== fromPendingId) : s.pendingOrders
  };
};
const INFLIGHT_STAGES = ['Contacted', 'Quoted'];
const bomWithStats = (state) => state.bom.filter(p => !p.deleted).map(p => {
  let qtyOrdered = 0, qtyInflight = 0;
  state.orders.filter(o => !o.deleted).forEach(o => {
    const inflight = INFLIGHT_STAGES.indexOf(o.stage) !== -1;
    (o.lines || []).forEach(l => { if (l.sku === p.partNumber) { const q = Number(l.qty) || 0; if (inflight) qtyInflight += q; else qtyOrdered += q; } });
  });
  const req = p.qtyRequired || 0;
  const qtyRemaining = Math.max(0, req - qtyOrdered);
  const qtyToSource = Math.max(0, req - qtyOrdered - qtyInflight);
  const _hasDef = p.deficit !== undefined && p.deficit !== null && p.deficit !== ''; const _def = Number(p.deficit);
  const status = _hasDef ? (_def > 0 ? 'In stock' : _def === 0 ? 'Check MES' : (qtyOrdered <= 0 ? 'Not Started' : qtyOrdered >= req ? 'Full' : 'Partial')) : (req <= 0 ? 'In stock' : qtyOrdered <= 0 ? 'Not Started' : qtyOrdered >= req ? 'Full' : 'Partial');
  return { ...p, qtyOrdered, qtyInflight, qtyRemaining, qtyToSource, status };
});
const vendorsWithStats = (state) => state.vendors.filter(v => !v.deleted).map(v => {
  const vOrders = state.orders.filter(o => o.vendor === v.name && !o.deleted);
  const spend = vOrders.reduce((a, o) => a + (o.total || 0), 0);
  const onTimeCount = vOrders.filter(o => timeliness(o) === 'On time').length;
  const decided = vOrders.filter(o => o.stage === 'Delivered').length;
  const onTimePct = decided > 0 ? Math.round((onTimeCount / decided) * 100) : 0;
  return { ...v, poCount: vOrders.length, spend, onTimePct };
});

const syncVendorsFromBom = (s) => {
  const existing = new Set((s.vendors || []).map(v => (v.name || '').trim().toLowerCase()));
  const names = new Set();
  (s.bom || []).filter(p => !p.deleted).forEach(p => { [p.preferredVendor, p.alternateVendor].forEach(n => { if (n && String(n).trim()) names.add(String(n).trim()); }); });
  const toAdd = [...names].filter(n => !existing.has(n.toLowerCase()));
  if (!toAdd.length) return null;
  const newVendors = toAdd.map(name => ({ id: uid(), name: name, email: '', terms: '', notes: '' }));
  return { vendors: [...s.vendors, ...newVendors], actionLog: pushLog(s, { action: 'created', entityType: 'vendor' }) };
};

let pass = 0;
const ok = (name, fn) => { fn(); console.log('  ✓ ' + name); pass++; };

// ============ REGRESSION: the bugs we already fixed ============

ok('approve gives each new order a UNIQUE id (even if cards share a draft id)', () => {
  // two dupe cards with the SAME draft.id (the exact situation that caused the cascade)
  const s = { orders: [], vendors: [{ name: 'Acme' }], pendingOrders: [
    { id: 'c1', vendor: 'Acme', draft: { id: 'id-THREAD', poNumber: '', vendor: 'Acme', total: 100 } },
    { id: 'c2', vendor: 'Acme', draft: { id: 'id-THREAD', poNumber: '', vendor: 'Acme', total: 100 } },
  ], actionLog: [] };
  const a1 = approvePending(s, 'c1'); const s2 = { ...s, orders: a1.orders, pendingOrders: a1.pendingOrders };
  const a2 = approvePending(s2, 'c2');
  const ids = a2.orders.map(o => o.id);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1], 'the two approved orders MUST have different ids');
});

ok('delete removes ONLY the target order (no cascade) when ids are unique', () => {
  const s = { orders: [{ id: 'a', vendor: 'X' }, { id: 'b', vendor: 'X' }, { id: 'c', vendor: 'X' }], actionLog: [] };
  const r = deleteOrder(s, 'b');
  assert.deepEqual(r.orders.map(o => !!o.deleted), [false, true, false], 'only b deleted');
});

ok('empty-PO approve does NOT merge into another empty-PO order (creates new)', () => {
  const s = { orders: [{ id: 'existing', poNumber: '', vendor: 'CC', total: 50 }], vendors: [{ name: 'CC' }],
    pendingOrders: [{ id: 'c1', vendor: 'CC', draft: { poNumber: '', vendor: 'CC', total: 900 } }], actionLog: [] };
  const r = approvePending(s, 'c1');
  assert.equal(r.orders.length, 2, 'new order created, existing not overwritten');
  assert.equal(r.orders[0].total, 50); assert.equal(r.orders[1].total, 900);
});

ok('vendor spend/PO count EXCLUDES soft-deleted orders', () => {
  const state = { vendors: [{ name: 'Valworx' }], orders: [
    { vendor: 'Valworx', total: 3246, deleted: false, stage: 'Ordered' },
    { vendor: 'Valworx', total: 3246, deleted: true },   // deleted dupe
    { vendor: 'Valworx', total: 3246, deleted: true },   // deleted dupe
  ] };
  const v = vendorsWithStats(state)[0];
  assert.equal(v.poCount, 1); assert.equal(v.spend, 3246);
});

ok('BOM coverage EXCLUDES soft-deleted orders (latent bug — deleted qty must not count)', () => {
  const state = { bom: [{ partNumber: 'P1', qtyRequired: 100 }], orders: [
    { deleted: false, lines: [{ sku: 'P1', qty: 40 }] },
    { deleted: true, lines: [{ sku: 'P1', qty: 60 }] },  // deleted — must NOT count
  ] };
  const b = bomWithStats(state)[0];
  assert.equal(b.qtyOrdered, 40, 'deleted order qty must not count toward coverage');
  assert.equal(b.status, 'Partial');
});

// ============ CORE LOGIC ============

ok('approve merges an UPDATE into the existing order by PO number (keeps its id)', () => {
  const s = { orders: [{ id: 'o1', poNumber: 'PO-1', vendor: 'V', stage: 'Ordered', total: 100 }], vendors: [{ name: 'V' }],
    pendingOrders: [{ id: 'c', vendor: 'V', draft: { poNumber: 'PO-1', vendor: 'V', stage: 'Shipped', tracking: 'Z9', total: 100 } }], actionLog: [] };
  const r = approvePending(s, 'c');
  assert.equal(r.orders.length, 1, 'merged, not duplicated');
  assert.equal(r.orders[0].id, 'o1'); assert.equal(r.orders[0].stage, 'Shipped'); assert.equal(r.orders[0].tracking, 'Z9');
});

ok('approve auto-creates the vendor if missing, reuses if present', () => {
  const s0 = { orders: [], vendors: [], pendingOrders: [{ id: 'c', vendor: 'NewCo', draft: { vendor: 'NewCo', poNumber: '' } }], actionLog: [] };
  assert.equal(approvePending(s0, 'c').vendors.length, 1);
  const s1 = { orders: [], vendors: [{ name: 'NewCo' }], pendingOrders: [{ id: 'c', vendor: 'NewCo', draft: { vendor: 'NewCo', poNumber: '' } }], actionLog: [] };
  assert.equal(approvePending(s1, 'c').vendors.length, 1, 'no duplicate vendor');
});

ok('approve removes the card from the review inbox', () => {
  const s = { orders: [], vendors: [{ name: 'V' }], pendingOrders: [{ id: 'c', vendor: 'V', draft: { vendor: 'V', poNumber: '' } }], actionLog: [] };
  assert.equal(approvePending(s, 'c').pendingOrders.length, 0);
});

ok('saveModal new order total is computed from line items', () => {
  const s = { orders: [], vendors: [{ name: 'V' }], pendingOrders: [] };
  const r = saveModalOrder(s, { id: 'x', vendor: 'V', total: 0, lines: [{ total: 100 }, { total: 250 }] }, true, null);
  assert.equal(r.orders[0].total, 350);
});

ok('saveModal edit updates the matching order in place (by id), leaves others', () => {
  const s = { orders: [{ id: 'a', vendor: 'V', total: 1 }, { id: 'b', vendor: 'V', total: 2 }], vendors: [{ name: 'V' }], pendingOrders: [] };
  const r = saveModalOrder(s, { id: 'b', vendor: 'V', total: 99, lines: [] }, false, null);
  assert.equal(r.orders.length, 2);
  assert.equal(r.orders.find(o => o.id === 'a').total, 1);
  assert.equal(r.orders.find(o => o.id === 'b').total, 99);
});

ok('coverage status: Not Started / Partial / Full', () => {
  const mk = (ordered) => bomWithStats({ bom: [{ partNumber: 'P', qtyRequired: 100 }],
    orders: ordered != null ? [{ deleted: false, lines: [{ sku: 'P', qty: ordered }] }] : [] })[0];
  assert.equal(mk(null).status, 'Not Started');
  assert.equal(mk(50).status, 'Partial');
  assert.equal(mk(100).status, 'Full');
  assert.equal(mk(150).status, 'Full');
  assert.equal(mk(150).qtyRemaining, 0, 'no negative remaining');
});

ok('timeliness: On time / Late / Overdue / Pending', () => {
  assert.equal(timeliness({ stage: 'Delivered', deliveredDate: '2026-07-01', eta: '2026-07-05' }), 'On time');
  assert.equal(timeliness({ stage: 'Delivered', deliveredDate: '2026-07-10', eta: '2026-07-05' }), 'Late');
  assert.equal(timeliness({ stage: 'Delivered' }), 'On time');
  assert.equal(timeliness({ stage: 'Ordered', eta: '2026-01-01' }), 'Overdue');
  assert.equal(timeliness({ stage: 'Ordered', eta: '2027-01-01' }), 'Pending');
  assert.equal(timeliness({ stage: 'Draft' }), 'Pending');
});

ok('vendor on-time % counts only Delivered orders', () => {
  const state = { vendors: [{ name: 'V' }], orders: [
    { vendor: 'V', deleted: false, stage: 'Delivered', deliveredDate: '2026-07-01', eta: '2026-07-05' }, // on time
    { vendor: 'V', deleted: false, stage: 'Delivered', deliveredDate: '2026-07-10', eta: '2026-07-05' }, // late
    { vendor: 'V', deleted: false, stage: 'Ordered', eta: '2027-01-01' },                                 // not decided
  ] };
  const v = vendorsWithStats(state)[0];
  assert.equal(v.onTimePct, 50, '1 of 2 delivered on time');
  assert.equal(v.poCount, 3);
});

ok('restore un-deletes only the target and clears delete metadata', () => {
  const s = { orders: [{ id: 'a', deleted: true, deletedBy: 'x' }, { id: 'b', deleted: true }], actionLog: [] };
  const r = restoreEntity(s, 'order', 'a');
  assert.equal(r.orders.find(o => o.id === 'a').deleted, false);
  assert.equal(r.orders.find(o => o.id === 'a').deletedBy, null);
  assert.equal(r.orders.find(o => o.id === 'b').deleted, true, 'b untouched');
});

ok('actionLog caps at 200, newest first', () => {
  let s = { actionLog: [] };
  for (let i = 0; i < 250; i++) s = { actionLog: pushLog(s, { action: 'x', n: i }) };
  assert.equal(s.actionLog.length, 200);
  assert.equal(s.actionLog[0].n, 249, 'newest first');
});

ok('empty-state safety: stats functions do not throw on empty data', () => {
  assert.deepEqual(bomWithStats({ bom: [], orders: [] }), []);
  assert.deepEqual(vendorsWithStats({ vendors: [], orders: [] }), []);
});

// ── Contacted → Ordered merge on approve (the real "PO arrives for a part we contacted" flow) ──
ok('approve merges an incoming PO into a matching Contacted order (no duplicate)', () => {
  const contacted = { id: 'ord-2', vendor: 'California Hydronics', stage: 'Contacted', poNumber: '', total: 0,
    lines: [{ sku: '140-00127', qty: 2, total: 0 }, { sku: '140-00402', qty: 1, total: 0 }, { sku: '140-00125', qty: 1, total: 0 }] };
  const s = { orders: [contacted], vendors: [{ name: 'California Hydronics' }], actionLog: [],
    pendingOrders: [{ id: 'p1', draft: { vendor: 'California Hydronics', stage: 'Ordered', poNumber: 'PO-10092', total: 26248.95,
      lines: [{ sku: '140-00127', qty: 2, total: 15031.8 }, { sku: '140-00402', qty: 1, total: 6707.25 }, { sku: '140-00125', qty: 1, total: 4509.9 }] } }] };
  const r = approvePending(s, 'p1');
  assert.equal(r.orders.length, 1, 'merged, not duplicated');
  assert.equal(r.orders[0].id, 'ord-2', 'kept the Contacted order id');
  assert.equal(r.orders[0].stage, 'Ordered', 'advanced Contacted -> Ordered');
  assert.equal(r.orders[0].poNumber, 'PO-10092', 'stamped the PO');
  assert.equal(r.orders[0].total, 26248.95, 'pulled the total');
});

ok('approve does NOT merge into an already-committed order (only inflight); creates new', () => {
  const committed = { id: 'ord-9', vendor: 'Acme', stage: 'Ordered', poNumber: 'PO-1', total: 100, lines: [{ sku: 'A', qty: 1 }] };
  const s = { orders: [committed], vendors: [{ name: 'Acme' }], actionLog: [],
    pendingOrders: [{ id: 'p2', draft: { vendor: 'Acme', stage: 'Ordered', poNumber: '', total: 50, lines: [{ sku: 'A', qty: 1 }] } }] };
  const r = approvePending(s, 'p2');
  assert.equal(r.orders.length, 2, 'a committed order is never silently overwritten by a match');
});

ok('approve still merges by exact PO# match (original behavior intact)', () => {
  const s = { orders: [{ id: 'o1', vendor: 'V', stage: 'Ordered', poNumber: 'PO-7', total: 0, lines: [] }], vendors: [{ name: 'V' }], actionLog: [],
    pendingOrders: [{ id: 'p3', draft: { vendor: 'V', stage: 'Shipped', poNumber: 'PO-7', total: 500, lines: [] } }] };
  const r = approvePending(s, 'p3');
  assert.equal(r.orders.length, 1); assert.equal(r.orders[0].id, 'o1'); assert.equal(r.orders[0].stage, 'Shipped');
});

ok('approve creates a fresh order when nothing matches', () => {
  const s = { orders: [], vendors: [], actionLog: [], pendingOrders: [{ id: 'p4', draft: { vendor: 'New Co', stage: 'Ordered', poNumber: 'PO-X', total: 10, lines: [{ sku: 'Z', qty: 1 }] } }] };
  const r = approvePending(s, 'p4');
  assert.equal(r.orders.length, 1); assert.equal(r.orders[0].poNumber, 'PO-X');
});

ok('legacy "Draft" stage normalizes to "Quoted" on load', () => {
  assert.equal(normStage('Draft'), 'Quoted');
  assert.equal(normStage('Ordered'), 'Ordered', 'non-legacy stages pass through');
  assert.equal(normStage('Contacted'), 'Contacted');
});

ok('BOM 3-way status from Deficit: negative=to-order, 0=Check MES, positive=In stock', () => {
  const mk = (deficit, qtyRequired, ordered) => bomWithStats({ bom: [{ partNumber: 'P', deficit, qtyRequired }],
    orders: ordered != null ? [{ deleted: false, stage: 'Ordered', lines: [{ sku: 'P', qty: ordered }] }] : [] })[0];
  assert.equal(mk(5, 0, null).status, 'In stock', 'surplus -> In stock');
  assert.equal(mk(0, 0, null).status, 'Check MES', 'balanced -> Check MES (verify before ordering)');
  assert.equal(mk(-3, 3, null).status, 'Not Started', 'shortfall, nothing ordered');
  assert.equal(mk(-3, 3, 1).status, 'Partial', 'shortfall, partially ordered');
  assert.equal(mk(-3, 3, 3).status, 'Full', 'shortfall, fully ordered');
  // a cell-stack part (no deficit field) falls back to classic coverage logic
  const cell = bomWithStats({ bom: [{ partNumber: 'C', qtyRequired: 100 }], orders: [{ deleted: false, stage: 'Ordered', lines: [{ sku: 'C', qty: 100 }] }] })[0];
  assert.equal(cell.status, 'Full', 'no-deficit part -> classic coverage, still maps + flags ordered');
});

ok('syncVendorsFromBom adds missing BOM suppliers (case-insensitive dedup), skips existing/deleted', () => {
  const s = { vendors: [{ name: 'Superlok' }], actionLog: [], bom: [
    { partNumber: 'A', preferredVendor: 'MCMASTER-CARR', alternateVendor: 'Superlok' },
    { partNumber: 'B', preferredVendor: 'superlok' },                 // case-insensitive dup of existing -> skip
    { partNumber: 'C', preferredVendor: 'ZORO', alternateVendor: '' },
    { partNumber: 'D', preferredVendor: 'MCMASTER-CARR' },            // dup within bom -> once
    { partNumber: 'E', preferredVendor: 'Deleted Co', deleted: true },// deleted -> ignore
  ] };
  const r = syncVendorsFromBom(s);
  const added = r.vendors.map(v => v.name).filter(n => n !== 'Superlok').sort();
  assert.deepEqual(added, ['MCMASTER-CARR', 'ZORO'], 'adds only distinct, non-deleted, not-already-present suppliers');
  assert.equal(r.vendors.length, 3);
  assert.equal(syncVendorsFromBom({ ...s, vendors: r.vendors }), null, 're-run is idempotent (nothing to add)');
});

console.log('\nALL ' + pass + ' APP-LOGIC TESTS PASS');
