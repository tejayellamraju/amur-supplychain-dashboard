// Brex PO PDF parsing — deterministic, no AI. Layout proven against PO-10085/10086.
(function (g) {
  var MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  function toISO(us) { // "Jun 22, 2026" -> "2026-06-22"
    var m = /([A-Z][a-z]{2})[a-z]*\s+(\d{1,2}),\s*(\d{4})/.exec(us || '');
    if (!m || !MONTHS[m[1]]) return '';
    return m[3] + '-' + MONTHS[m[1]] + '-' + ('0' + m[2]).slice(-2);
  }
  function num(s) { return Number(String(s).replace(/,/g, '')) || 0; }

  // text: full extracted text of the PDF. Returns an order-draft patch, or null if it doesn't look like a Brex PO.
  function parseBrexPO(text) {
    var po = /PO-\d+/.exec(text);
    if (!po || !/Send to/.test(text)) return null;

    var vendor = /Send to\s+([\s\S]*?)\s*([\w.+-]+@[\w.-]+\.\w+)/.exec(text);
    var created = /Created on\s+([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(text);
    var close = /Close date\s+([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(text);
    var memo = /Memo\s+([\s\S]*?)\s*Submitting bills/.exec(text);
    var grand = /Total\s+\$([\d,]+(?:\.\d+)?)\s+USD/.exec(text);

    // Line items live between the table header and the grand total.
    var lines = [];
    var head = /Product\s+Qty\s+Unit\s+price\s+Total/.exec(text);
    var end = grand ? text.indexOf(grand[0]) : -1;
    if (head && end > head.index) {
      var section = text.slice(head.index + head[0].length, end);
      var row = /([\s\S]+?)\s+([\d,]+)\s+\$([\d,]+(?:\.\d+)?)\s+\$([\d,]+(?:\.\d+)?)/g, m;
      while ((m = row.exec(section))) {
        var desc = m[1].replace(/\s+/g, ' ').trim();
        lines.push({
          sku: desc.split(' ')[0],
          desc: desc,
          qty: num(m[2]),
          unit: 'ea',
          total: num(m[4]),
          receivedQty: 0
        });
      }
    }

    return {
      poNumber: po[0],
      orderType: 'Purchase Order',
      vendor: vendor ? vendor[1].replace(/\s+/g, ' ').trim() : '',
      vendorEmail: vendor ? vendor[2] : '',
      stage: 'Ordered',
      createdDate: created ? toISO(created[1]) : '',
      eta: close ? toISO(close[1]) : '',
      total: grand ? num(grand[1]) : 0,
      terms: memo ? memo[1].replace(/\s+/g, ' ').trim() : '',
      lines: lines
    };
  }

  // Browser-only: extract text from a PDF File via self-hosted pdf.js.
  function pdfFileToText(file) {
    return file.arrayBuffer().then(function (buf) {
      g.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
      return g.pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (doc) {
      var pages = [];
      for (var i = 1; i <= doc.numPages; i++) pages.push(doc.getPage(i).then(function (p) { return p.getTextContent(); }));
      return Promise.all(pages);
    }).then(function (contents) {
      return contents.map(function (c) {
        return c.items.map(function (it) { return it.str; }).join('\n');
      }).join('\n');
    });
  }

  g.parseBrexPO = parseBrexPO;
  g.pdfFileToText = pdfFileToText;
})(typeof window !== 'undefined' ? window : globalThis);
