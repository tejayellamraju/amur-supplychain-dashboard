# MAINTENANCE — how to change this dashboard yourself (without Claude)

Honest summary up front: **data + deploy + rollback are easy and you can do them alone. Editing the app's UI code is HARD** because `public/index.html` is a compiled/bundled file (see the ⚠️ section). That difficulty is the whole reason the source migration exists — once that's done, edits become normal and any tool can do them cheaply.

---

## 0. The easy stuff — NO terminal, NO code

Most day-to-day changes need none of the below:
- **Add/edit orders, BOM parts, vendors** → just use the app UI at https://amur-supplychain.web.app (sign in with your @fourier.earth Google account).
- **Bulk BOM changes** → **Import BOM (CSV/Excel)** button, or **Export JSON** → edit → **Import JSON**.
- **Vendor emails** → Vendors tab → click a vendor → add email.
- **Fix a wrong order** → open it → Edit, or Delete (soft-delete, restorable from Activity log).

If your change is data, stop here — you don't need a terminal.

---

## 1. Open the project in a terminal

1. Open **Terminal**: press `Cmd`+`Space`, type `Terminal`, hit Enter.
2. Go to the project:
   ```
   cd /Users/tejayellamraju/my-firebase-app
   ```
3. Get the latest version:
   ```
   git pull
   ```
4. If you still have Claude Code, start it here with:  `claude`  (then say "read CLAUDE.md and continue").

---

## 2. Deploy a change (the normal flow)

The site **auto-deploys when you push to GitHub**. So:
```
git add -A
git commit -m "describe what you changed"
git push
```
Wait ~1–2 minutes, then hard-refresh https://amur-supplychain.web.app (`Cmd`+`Shift`+`R`).

Deploy the **security rules** (only if you edit `firestore.rules`):
```
npx -y firebase-tools@latest deploy --only firestore:rules --project amur-supplychain
```

---

## 3. ⚠️ Editing the app UI — `public/index.html` (the HARD part)

`public/index.html` is **NOT normal HTML** — it's a compiled artifact. The real app is a giant JSON-escaped string on **line 389**. You cannot just open it and type; a stray character breaks the whole page.

**Do not hand-edit it.** Your realistic options:
1. **Use Claude Code** (or another capable AI) with the recipe in `CLAUDE.md` (the "Python string surgery" section). Always: **Export JSON first** (backup), test with `node test-app-logic.js`, deploy to a **preview** channel, check it, *then* push to live.
2. **Wait for / do the migration** — after the app is rebuilt as real React source, editing is normal (small files, any editor or AI). This is the recommended long-term answer.

If you ever must attempt it alone, the safety rules: back up (Export JSON), change one thing, run the tests, deploy to preview and eyeball it, and if anything looks wrong — **don't push**, roll back (section 5).

---

## 4. Editing the email robot — `apps-script/Code.gs` (easier)

The robot is plain code you edit in a browser:
1. Go to https://script.google.com → open the purchasing-bot Apps Script project.
2. Open **`Code.gs`**, make your change, press **`Cmd`+`S`** (Save). The scheduled trigger runs the latest saved code — no deploy needed.
3. Keep `apps-script/Code.gs` in this repo in sync (paste the same code, commit, push) so the repo stays the source of truth.

---

## 5. If something breaks — roll back

- **Bad code push** → undo the last commit and redeploy:
  ```
  git revert HEAD
  git push
  ```
- **Bad data** → **Import JSON** with a good backup export, OR use **PITR** (Firestore Point-in-Time Recovery, 7-day rewind) in the Firebase console, OR the in-app **Activity log** restore.
- You always have three data safety nets: Export-JSON backups, PITR, and the Activity log.

---

## 6. Using another AI if Claude credits lapse

- **Data / config / deploy** → any tool works, or just the app UI + these instructions.
- **Code inside `public/index.html`** → expensive and error-prone for *any* AI, because it's one massive escaped string. **Do the migration first**; then any tool edits clean React files cheaply.

---

## 7. Starting a Claude session — just talk to it plainly

Every session:
1. Open **Terminal** (`Cmd`+`Space` → `Terminal` → Enter)
2. `cd /Users/tejayellamraju/my-firebase-app`
3. `claude`
4. **Say what you want in plain English.** Claude auto-loads its instructions (`CLAUDE.md`) and already knows how to edit the bundled file safely, run the tests, and preview before going live — you do NOT need to mention file names or steps.

Examples — this is *all* you say:
- **Change the live app:** "Add the weekday next to the date at the top. Show me a preview first."
- **Continue the migration:** "Let's keep building the new React app (the migration). Read your notes first. Don't touch the current live app."
- **New BOM arrives:** "I got a new BOM — convert it into our format and give me the file to import."

Claude handles the *how* (finding the code, the string-surgery edit, tests, preview, push). If you ever want to be extra-safe, just add "preview first, don't push to live yet."

## 8. Where everything lives

- **Code (source of truth):** GitHub → `tejayellamraju/amur-supplychain-dashboard`
- **On this Mac:** `/Users/tejayellamraju/my-firebase-app`
- **Map + deep docs:** `CLAUDE.md`, `ARCHITECTURE.md`, `TESTING.md`, this file
- **Data:** Firebase Firestore, document `dashboard/main` (+ your Export-JSON backups)
- **Claude's saved notes:** `~/.claude/projects/-Users-tejayellamraju-my-firebase-app/memory/`
- **Live site:** https://amur-supplychain.web.app · **Firebase project:** `amur-supplychain`
