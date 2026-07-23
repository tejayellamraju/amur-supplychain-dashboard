# Purchasing robot — deployment checklist (~10 min)

Everything here happens signed in as **purchasing-bot@fourier.earth**.

## 1. Create the Apps Script project
1. Go to https://script.google.com → **New project** → name it `purchasing-robot`
2. Replace the default `Code.gs` contents with `apps-script/Code.gs` from this repo
3. Project Settings (⚙) → check **"Show appsscript.json manifest file"** → back in the editor,
   replace `appsscript.json` contents with `apps-script/appsscript.json` from this repo

## 2. Add the Claude API key
Project Settings → **Script Properties** → Add property:
- Name: `ANTHROPIC_API_KEY`
- Value: your `sk-ant-...` key (from console.anthropic.com)

The key lives only here — never in code, never in the repo, never in the browser.

## 3. Authorize + install the trigger
In the editor, select the `setup` function → **Run**. Google will ask you to authorize
(Gmail read, external requests, Firestore). Approve as purchasing-bot. This installs the
10-minute timer.

## 4. Test end to end
1. From any account, email `purchasing@fourier.earth` something order-like, e.g.
   "Quote attached: 50x widget W-100 at $12/ea, total $600. Ships in 2 weeks." (attach any PDF quote if handy)
2. Wait ≤10 minutes (or run `pollPurchasing` manually in the editor for instant results)
3. Open the dashboard → **Review Inbox** → a card should appear
4. Executions tab (left sidebar) shows every run + logs if anything fails

## Behavior summary
- Reads only the `purchasing` Gmail label, every 10 min
- One review card per email thread, regenerated as the thread evolves (idempotent)
- PDFs parsed natively; text/CSV attachments inlined; xlsx/docs flagged on the card for a human
- POs require the `amur002` memo tag; quotes/updates don't
- Writes ONLY the `pendingOrders` field in Firestore (updateMask) — can never touch orders/BOM/vendors
- Chatter → no card. Unparseable-but-relevant → "NEEDS REVIEW" card. Nothing is ever silent-dropped except clear noise.
