/**
 * Amur purchasing robot — runs inside purchasing-bot@fourier.earth's Apps Script.
 *
 * Every 10 min: reads new mail in the `purchasing` Gmail label, sends thread text +
 * PDF attachments to Claude (with the live BOM as matching context), and upserts
 * ONE review card per Gmail thread into dashboard/main.pendingOrders in Firestore.
 * Never touches orders/bom/vendors — humans approve cards in the dashboard.
 *
 * Setup (one time, signed in as purchasing-bot):
 *   1. script.google.com → New project → paste this file; paste appsscript.json into
 *      the manifest (Project Settings → check "Show appsscript.json").
 *   2. Project Settings → Script Properties → add ANTHROPIC_API_KEY = sk-ant-...
 *   3. Run setup() once (grants Gmail/Firestore permissions, installs the trigger).
 *   4. Send a test email to purchasing@fourier.earth and wait ≤10 min.
 */

var CONFIG = {
  LABEL: 'purchasing',
  PROJECT: 'amur-supplychain',
  EVERY_MINUTES: 10,
  PROJECT_TAG: /amur\s*1\.1/i,      // PO memo tag; quotes/threads don't need it
  MODEL: 'claude-opus-4-8',
  MAX_THREAD_CHARS: 20000,          // per-thread body text cap sent to Claude
  OVERLAP_MS: 15 * 60 * 1000        // re-scan window; upsert is idempotent so overlap is safe
};

// ---------- entry points ----------

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pollPurchasing').timeBased().everyMinutes(CONFIG.EVERY_MINUTES).create();
  // touch services once so the auth prompt covers everything
  GmailApp.getUserLabelByName(CONFIG.LABEL);
  fetchDashboard();
  Logger.log('Setup complete. Trigger installed every ' + CONFIG.EVERY_MINUTES + ' min.');
}

function pollPurchasing() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ANTHROPIC_API_KEY')) throw new Error('Set ANTHROPIC_API_KEY in Script Properties');

  var lastRun = Number(props.getProperty('LAST_RUN') || 0);
  var since = Math.floor(Math.max(0, lastRun - CONFIG.OVERLAP_MS) / 1000);
  var query = 'label:' + CONFIG.LABEL + (since ? ' after:' + since : ' newer_than:2d');
  var threads = GmailApp.search(query, 0, 25);
  props.setProperty('LAST_RUN', String(Date.now()));
  if (!threads.length) return;

  var dash = fetchDashboard(); // { data: {bom, orders, pendingOrders, ...}, raw }
  threads.forEach(function (thread) {
    try { processThread(thread, dash.data); }
    catch (e) { Logger.log('thread ' + thread.getId() + ' failed: ' + e); }
  });
}

// ---------- per-thread processing ----------

function processThread(thread, data) {
  var threadId = thread.getId();
  var existingCard = (data.pendingOrders || []).find(function (p) { return p.gmailThreadId === threadId; });

  // Idempotent by design: regenerate the card from the whole thread every time.
  var messages = thread.getMessages();
  var textParts = [], docBlocks = [], unparsed = [];
  messages.forEach(function (m) {
    textParts.push('--- Message from ' + m.getFrom() + ' on ' + m.getDate() + ' ---\nSubject: ' +
      m.getSubject() + '\n' + m.getPlainBody());
    m.getAttachments().forEach(function (a) {
      var type = a.getContentType() || '';
      if (type === 'application/pdf' && docBlocks.length < 4) {
        docBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Utilities.base64Encode(a.getBytes()) } });
      } else if (/^text\/|csv/.test(type)) {
        textParts.push('--- Attachment ' + a.getName() + ' ---\n' + a.getDataAsString().slice(0, 8000));
      } else {
        unparsed.push(a.getName()); // xlsx/docs: flagged on the card, human opens it
      }
    });
  });
  var threadText = textParts.join('\n\n').slice(0, CONFIG.MAX_THREAD_CHARS);

  var result = extractWithClaude(threadText, docBlocks, data, existingCard, unparsed);
  if (!result || result.kind === 'ignore') return;

  var card = buildCard(threadId, result, unparsed, thread.getLastMessageDate());
  upsertPendingCard(card);
}

function extractWithClaude(threadText, docBlocks, data, existingCard, unparsed) {
  var bomList = (data.bom || []).filter(function (p) { return !p.deleted; })
    .map(function (p) { return p.partNumber + ' | ' + p.description + ' | vendor:' + (p.preferredVendor || '?'); }).join('\n');
  var orderList = (data.orders || []).filter(function (o) { return !o.deleted; })
    .map(function (o) { return (o.poNumber || '(no PO)') + ' | ' + o.vendor + ' | ' + o.stage; }).join('\n');

  var system = 'You extract purchasing data from vendor email threads for the Amur 1.1 project dashboard.\n' +
    'Company part numbers (BOM) — map extracted line items to these when they match by part number or description:\n' + bomList + '\n\n' +
    'Existing orders (to classify updates vs new orders):\n' + orderList + '\n\n' +
    'Rules:\n' +
    '- One judgment for the WHOLE thread: does its latest material state describe a new order, a quote, or an update (confirmed/shipped/tracking/delay/short-ship) to an existing order?\n' +
    '- Official POs: only relevant if the memo contains the tag "amur1.1" (case-insensitive). POs with other project tags => kind "ignore".\n' +
    '- Pure chatter with nothing material => kind "ignore".\n' +
    '- Clearly purchasing-related but unextractable => kind "unparseable" and summarize why.\n' +
    '- Never invent numbers. Unknown fields => empty string or 0. Unmatched lines => sku "".\n' +
    '- Dates as YYYY-MM-DD.';

  var content = docBlocks.slice();
  content.push({ type: 'text', text: 'Email thread:\n\n' + threadText +
    (unparsed.length ? '\n\n[Unparsed attachments a human must open: ' + unparsed.join(', ') + ']' : '') +
    (existingCard ? '\n\n[A review card already exists for this thread: ' + JSON.stringify(existingCard.summary) + ']' : '') });

  var schema = {
    type: 'object', additionalProperties: false,
    required: ['kind', 'vendor', 'vendorEmail', 'poNumber', 'summary', 'refLabel', 'orderType', 'stage', 'eta', 'tracking', 'total', 'lines'],
    properties: {
      kind: { type: 'string', enum: ['new_order', 'quote', 'update', 'unparseable', 'ignore'] },
      vendor: { type: 'string' }, vendorEmail: { type: 'string' },
      poNumber: { type: 'string', description: 'PO number if referenced, else empty' },
      summary: { type: 'string', description: 'One-line human summary for the review card' },
      refLabel: { type: 'string', description: 'Order ref / quote number if any' },
      orderType: { type: 'string', enum: ['Purchase Order', 'Credit Card'] },
      stage: { type: 'string', enum: ['Draft', 'Ordered', 'Shipped', 'Delivered'] },
      eta: { type: 'string' }, tracking: { type: 'string' },
      total: { type: 'number' },
      lines: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['sku', 'desc', 'qty', 'unit', 'total'],
          properties: {
            sku: { type: 'string', description: 'Matching BOM part number, or empty if no match' },
            desc: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' }, total: { type: 'number' }
          }
        }
      }
    }
  };

  var payload = {
    model: CONFIG.MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: system,
    output_config: { format: { type: 'json_schema', schema: schema } },
    messages: [{ role: 'user', content: content }]
  };

  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('Claude API ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
  var body = JSON.parse(resp.getContentText());
  if (body.stop_reason === 'refusal') return null;
  var text = (body.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  return JSON.parse(text);
}

function buildCard(threadId, r, unparsed, lastMsgDate) {
  var kindLabels = { new_order: 'NEW ORDER — parsed from email', quote: 'QUOTE — parsed from email', update: 'ORDER UPDATE — parsed from email', unparseable: 'NEEDS REVIEW — could not parse' };
  var note = unparsed.length ? ' (unparsed attachments: ' + unparsed.join(', ') + ')' : '';
  return {
    id: 'pend-' + threadId,
    gmailThreadId: threadId,
    poNumber: r.poNumber || '',
    vendor: r.vendor || 'Unknown vendor',
    kindLabel: kindLabels[r.kind] || kindLabels.unparseable,
    refLabel: r.refLabel || '',
    summary: (r.summary || '') + note,
    updatedAt: lastMsgDate.getTime(),
    draft: {
      id: 'id-' + threadId,
      poNumber: r.poNumber || '',
      orderType: r.orderType || 'Credit Card',
      vendor: r.vendor || '',
      vendorEmail: r.vendorEmail || '',
      category: '',
      stage: r.stage || 'Draft',
      createdDate: '', eta: r.eta || '', deliveredDate: '',
      terms: '', tracking: r.tracking || '',
      total: r.total || 0,
      lines: r.lines || []
    }
  };
}

// ---------- Firestore (REST, OAuth as purchasing-bot) ----------

function firestoreUrl() {
  return 'https://firestore.googleapis.com/v1/projects/' + CONFIG.PROJECT + '/databases/(default)/documents/dashboard/main';
}

function fetchDashboard() {
  var resp = UrlFetchApp.fetch(firestoreUrl(), {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('Firestore read ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
  var doc = JSON.parse(resp.getContentText());
  return { data: fromFs({ mapValue: { fields: doc.fields } }), raw: doc };
}

// Only ever PATCHes the pendingOrders field — cannot touch orders/bom/vendors.
function upsertPendingCard(card) {
  var pending = fetchDashboard().data.pendingOrders || []; // re-read to minimize clobber window
  var idx = pending.findIndex(function (p) { return p.gmailThreadId === card.gmailThreadId; });
  if (idx >= 0) pending[idx] = card; else pending.push(card);

  var resp = UrlFetchApp.fetch(firestoreUrl() + '?updateMask.fieldPaths=pendingOrders', {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: { pendingOrders: toFs(pending) } }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('Firestore write ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
  Logger.log('Upserted card for thread ' + card.gmailThreadId + ': ' + card.summary);
}

// ---------- Firestore value <-> JS converters ----------

function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return (v % 1 === 0) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  var fields = {};
  Object.keys(v).forEach(function (k) { fields[k] = toFs(v[k]); });
  return { mapValue: { fields: fields } };
}

function fromFs(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  if ('mapValue' in v) {
    var out = {};
    var fields = v.mapValue.fields || {};
    Object.keys(fields).forEach(function (k) { out[k] = fromFs(fields[k]); });
    return out;
  }
  return null;
}
