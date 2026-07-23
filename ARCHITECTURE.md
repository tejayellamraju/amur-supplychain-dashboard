# Amur 002 Supply-Chain Dashboard — Architecture

*A single source of truth for how the system works, for both a non-technical reader and a senior engineer. Last updated: July 2026.*

---

## 1. What this is, in one paragraph

A web dashboard that tracks everything we buy for the **Amur 002** project — the parts we need (BOM), the orders we've placed, and the vendors we buy from. Its standout feature: an **email robot** that reads vendor emails automatically and turns them into pre-filled "review cards," so orders keep themselves up to date instead of being typed in by hand. A human always approves before anything becomes real. It's deployed, live, and in daily use.

- **Live site:** https://amur-supplychain.web.app
- **Firebase project:** `amur-supplychain`
- **Repo:** `tejayellamraju/amur-supplychain-dashboard` (private)

---

## 2. The big picture

```
   VENDORS / TEAM                         GOOGLE WORKSPACE                    THE DASHBOARD
   ─────────────                          ────────────────                   ─────────────
                        email / CC
   vendor quotes,  ───────────────▶  purchasing@fourier.earth  (Google Group, vendor-facing)
   confirmations,                              │  delivers a copy to members
   shipping notes                              ▼
                                       purchasing-bot@  (dedicated mailbox)
                                              │  Gmail filter labels it "purchasing"
                                              ▼
                                       ┌──────────────────────┐
                                       │  Email Robot          │   reads label every 10 min,
                                       │  (Apps Script + Claude)│   parses with AI, matches to
                                       └──────────┬────────────┘   BOM, checks for duplicates
                                                  │  writes ONLY review cards
                                                  ▼
   Brex PO PDF  ──drag & drop──▶  ┌───────────────────────────────────────┐
   (deterministic parse)          │  Firestore  dashboard/main             │
                                  │  { bom[], orders[], vendors[],         │◀──── React dashboard
                                  │    pendingOrders[], actionLog[] }       │      (browser app)
                                  └───────────────────────────────────────┘        │
                                                  ▲                                 │
                                                  └── human clicks "Approve" ────────┘
                                                      in the Review Inbox
```

**The one rule that governs the whole design:** AI output is never trusted directly. Everything the robot produces lands in a **Review Inbox** as a suggestion. A human approves it before it becomes a real order. The AI drafts; people decide.

---

## 3. Components

### 3.1 The dashboard (front-end)
- **Plain English:** the web page you log into. Shows tabs for Overview, BOM, Orders, Vendors, and a Review Inbox.
- **For the senior dev:** a client-side **React single-page app**, currently shipped as a **self-contained bundled `index.html`** (React + app compiled and inlined into one file — originally a claude.ai artifact export). Served as a static asset by **Firebase Hosting**. All business logic runs in the browser; it talks directly to Firestore via the Firebase JS SDK. No custom backend server.
- **Note:** "static HTML" is a packaging detail — it *is* a full React app, just bundled into one file. See §8 for the migration path.

### 3.2 Authentication
- **Plain English:** you sign in with your company Google account. Outsiders can't get in.
- **For the senior dev:** **Firebase Auth**, Google sign-in. Two layers: (1) a client-side gate that shows "Access denied" and signs out anyone whose email isn't `@fourier.earth` / `@fourierearth.com`; (2) — the real enforcement — **Firestore Security Rules** that allow read/write on `dashboard/{doc}` only when `request.auth != null && email_verified == true && email matches the domain regex`, with a deny-all fallback on everything else. The client gate is UX; the rules are the security boundary.

### 3.3 Data
- **Plain English:** all the data lives in one record in Google's cloud database.
- **For the senior dev:** **Cloud Firestore**, a single document `dashboard/main` holding arrays: `bom[]`, `orders[]`, `vendors[]`, `pendingOrders[]` (review cards), `actionLog[]` (audit trail, capped at 200, newest first). **Derived stats (coverage %, vendor spend, qty ordered) are computed at render time by matching order-line SKUs against BOM part numbers — never stored.** Every edit is stamped (`lastEditedBy/At`); deletes are soft (`deleted` flag), logged, and restorable.

### 3.4 Deployment
- **Plain English:** when we save a code change, the site updates itself automatically in a minute or two.
- **For the senior dev:** **GitHub Actions** on push to `main` → `FirebaseExtended/action-hosting-deploy` → Firebase Hosting `live` channel. Deploy uses a Firebase service-account secret stored in GitHub repo secrets. PR builds are guarded to same-repo PRs (forks can't trigger). Only `public/` is deployed; the Apps Script robot is **not** deployed by CI (see §3.5).

### 3.5 The email robot (the differentiator)
- **Plain English:** a small program that reads the purchasing mailbox every 10 minutes, understands each vendor email using AI, and creates a suggested order card for a human to approve.
- **For the senior dev:** a **Google Apps Script** running inside `purchasing-bot@fourier.earth`. A time-trigger polls the `purchasing` Gmail label, sends each thread's text + PDF attachments to the **Claude API** (`claude-opus-4-8`) with the live BOM + orders as matching context, and receives **structured JSON** (schema-enforced) describing the order. It writes **one review card per order identity** into `pendingOrders`.
  - **Email plumbing:** `purchasing@` is a **Google Group** (vendor-facing, external posting allowed). It delivers to the `purchasing-bot@` mailbox, where a Gmail filter (`list:purchasing@fourier.earth`) labels it. The robot reads only that label.
  - **Containment:** the robot writes to Firestore with a field-mask limited to **`pendingOrders` only** — it can never modify `orders`, `bom`, or `vendors`. (See §5 for the caveat on how its access is granted.)
  - **API key** lives only in the script's Script Properties — never in the browser, never in the repo.

### 3.6 Two ways an order enters
1. **Official PO (Brex):** we download the PO PDF and **drag-and-drop** it onto the Add Order form. A **deterministic parser** (self-hosted `pdf.js` + regex, no AI) reads the fixed Brex layout and pre-fills the form. Fast, exact, free.
2. **Quote / credit-card / website order (no PO):** the vendor thread is CC'd to `purchasing@`, and the robot turns it into a review card (§3.5).

### 3.7 Duplicate detection
- **Plain English:** the robot checks whether an email is about an order we already have, so we don't get the same order twice.
- **For the senior dev:** before surfacing a card, the robot matches it against committed orders by an **identity ladder** — `PO number` → `vendor + vendor's order/quote number` → fuzzy (`vendor + total ± 1% / overlapping SKUs`). Tiered outcome:
  - **exact match + re-sent quote/order** → suppressed (logged, no card)
  - **exact match + a real update** (shipping/tracking/delay) → surfaced as an **"ORDER UPDATE"** card (never suppressed)
  - **fuzzy match** → surfaced but **flagged** "possible duplicate"
  - **no match** → normal new card

  Matching runs in plain code (not AI), so it's deterministic and scales to thousands of orders at zero extra cost. Identity is keyed to the *order*, not the email thread, so it handles cross-thread duplicates and multi-order threads.

### 3.8 Conventions the team follows
- **`#amur002`** in email bodies → project tag (mainly for routing POs).
- **`FP# <part number>`** before each part → lets the robot map lines to our BOM exactly.
- **CC `purchasing@`** on vendor threads → how mail reaches the robot.
- All three are *optional* — the robot degrades gracefully without them; they just improve accuracy.

---

## 4. How an order flows, end to end

1. Vendor emails a quote; someone CC's `purchasing@` (or forwards it).
2. Group delivers → bot mailbox → labeled `purchasing`.
3. Within 10 min, the robot parses it, maps parts to the BOM, checks for duplicates.
4. A **review card** appears in the dashboard's Review Inbox (or is suppressed/flagged if a duplicate).
5. A human reviews, edits if needed, clicks **Approve** → it becomes a real order.
6. Later emails in that thread (shipped, tracking, delayed) → **update cards** → approve → order status advances.

---

## 5. Security posture

**What's protecting the data:**
- ✅ **Domain-locked database.** Only signed-in, email-verified `@fourier.earth` / `@fourierearth.com` accounts can read or write; everything else denied by rule (verified by an automated test, `test-security.sh`).
- ✅ **No secrets in the front-end.** Real vendor data was stripped from the page **and scrubbed from git history**; the Claude API key lives only in Apps Script.
- ✅ **Access-denied gate** for outside Google accounts.
- ✅ **Destructive "Import JSON" restricted** to admin emails.
- ✅ **Robot is write-scoped** to `pendingOrders` — it cannot alter real orders/BOM/vendors.
- ✅ **XSS verified clean** — untrusted vendor text renders as inert text (React escaping).
- ✅ **Audit trail** — every edit stamped, every delete soft + logged + restorable.

**🚩 Security flags & honest concerns (things a senior dev should know):**
1. **Robot's database access is broader than its behavior.** The bot account was granted the project-wide **Cloud Datastore User** IAM role, which **bypasses the Firestore security rules**. Today the robot's *code* self-limits to `pendingOrders`, but that containment is code-level, not enforced by IAM. **Harden:** a custom IAM role scoped to the single document. *(Deferred; low risk while single-doc + locked-down bot account.)*
2. **No role separation among team members.** Any verified domain user can read/write/**delete** the entire dashboard document. The Import-JSON admin gate is **client-side only** — a determined user could write to Firestore directly. Accepted trade-off for a small, trusted team; revisit with role-based rules before wide rollout.
3. **No server-side backups yet.** The project is on the free **Spark** plan, so **Point-in-Time Recovery and scheduled backups aren't available.** Only mitigation today is manual **Export JSON**. Combined with #2 (any user can overwrite), this is the **highest-priority pre-rollout fix** → upgrade to Blaze, enable PITR.
4. **App Check not enabled.** The Firestore endpoint accepts authentication attempts from anywhere (rules still block non-domain accounts). Enabling App Check (reCAPTCHA, monitor mode first) hardens against automated abuse. *(Deferred.)*
5. **Repo hygiene.** Repo should be confirmed **private**, account **2FA** on, and eventually **migrated to a company org** (re-pointing the deploy secret). The handoff docs in the repo contain vendor domains/pricing — fine while private, review before any wider sharing.
6. **Single-account dependency for the robot.** The robot lives in one Google account (`purchasing-bot@`). Mitigated by it being a *dedicated, locked-down* account (not a person's), so it survives staff changes.

**None of these is on-fire for a private, trusted-team, build-phase app.** The one to do *before wider rollout*: **#3 (backups)**.

---

## 6. Cost

- **Only the email robot spends money** (Claude API, `claude-opus-4-8`): roughly **$0.10–0.15 per email processed** (system prompt + context + PDF in, structured JSON out).
- Current testing volume: a few dollars total. Production estimate at 10–30 order emails/day: **~$30–100/month**, PDF-size dependent.
- **Levers if it grows:** cheaper model for extraction (trades some accuracy), and trimming a minor redundant re-scan. An **Anthropic spend cap** (recommended) makes the worst case bounded.
- Hosting/Firestore: effectively **$0** at this scale (free Spark tier).

---

## 7. Known limitations (engineering honesty)

- **Duplicate detection isn't 100%.** Deterministic for orders with a PO# or vendor order number; *fuzzy + flagged* for orders with no number anywhere (rare). Human review is the backstop. Email carries no universal order ID, so perfect dedup is impossible — this is the realistic ceiling.
- **BOM not yet loaded.** Coverage %, gap analysis, and description-based part matching are limited until the real BOM is imported. `FP#`-labeled numbers work in the meantime.
- **The single-file bundle is awkward to extend.** Works fine at runtime; the friction is developer-side (edits are surgical). Migration path in §8.
- **Robot re-scan overlap** causes a couple of redundant Claude calls per email in its first ~15 min (harmless, minor cost).

---

## 8. Is this the right architecture? (and the migration path)

**Yes, for the current stage.** This is deliberately a **bridge system for the build phase**: it gets us clean order tracking + AI email intake with almost no process weight, and it teaches us exactly what we'd need from a real system later. At production scale, hardware supply chain graduates to a dedicated tool (Cofactr/Fulcrum) or ERP — the `purchasing@` address and the data model carry forward; the bridge retires.

**Staying in-lane:** reconciled view of BOM/orders/vendors + AI email intake + light buyer nudges. **Out of lane (buy, don't build):** inventory/MRP, financial reconciliation (Brex is money-of-record), auto-ordering.

**The one planned refactor:** when the build phase calms down, rebuild the bundled front-end as a **proper source-based React (Vite) project**, done *in parallel* (clone → verify parity against our committed tests → cut over), so production is never at risk. Not urgent; a "phase 2 infrastructure" task.

---

## 9. What's deferred / roadmap

**Before wider team rollout:**
- Upgrade to Blaze → enable **PITR + scheduled backups** (highest priority)
- **App Check** (monitor mode → enforce)
- Lock down bot account to Gmail+Drive+Apps Script only; confirm repo private + 2FA
- Custom IAM role scoping the bot to one document

**Roadmap features:**
- Proactive **check-in agent** (flags overdue/stale orders, drafts status-check emails — draft-only first)
- Quote drag-and-drop with AI auto-fill (reuses robot as parsing backend)
- Flexport shipment tracking for freight-forwarded orders
- **(Shelved)** in-dashboard AI assistant ("Layer 1") — deferred: the dashboard UI already surfaces most of it, duplicates are auto-handled, and its best questions need the BOM. Code exists, un-deployed.

---

## 10. Tech stack summary (for the senior dev)

| Layer | Technology |
|---|---|
| Front-end | React (bundled single-file SPA) |
| Hosting | Firebase Hosting (static) |
| Auth | Firebase Auth (Google), domain-locked |
| Database | Cloud Firestore (single doc), Security Rules enforced |
| CI/CD | GitHub Actions → Firebase Hosting |
| Email intake | Google Group + dedicated mailbox + Gmail filter |
| Automation | Google Apps Script (time-triggered) |
| AI | Claude API (`claude-opus-4-8`), structured JSON output |
| PO parsing | self-hosted pdf.js + deterministic regex (no AI) |
| Tests | Node assert scripts (`test-*.js`) + live security test (`test-security.sh`) |
| Trust model | AI proposes → human approves; robot write-scoped to `pendingOrders` |
