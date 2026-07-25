# Engineering Q&A prep — Amur 002 Dashboard

For presenting `presentation-eng.html` to senior engineers. You're not a software engineer, so the goal here is: **don't get caught flat-footed.** Each question below has a short honest answer + the one line that shows you thought about it. If a question goes deeper than the answer here, say *"good question — it's in ARCHITECTURE.md, let's look"* and open the code. Honesty beats bluffing; "we deferred that on purpose, here's the trigger" is a strong answer, not a weak one.

---

## The scaling / data-model questions

**Q: One Firestore document for everything? That doesn't scale.**
Correct, and it's deliberate. The real ceiling is the **1 MiB per-document limit**, not user count. Today the doc is a small fraction of that (298 BOM parts + orders + vendors + a 200-entry capped log). When it approaches the limit — or when concurrent-write contention actually bites — we move to **per-entity documents** (one doc per order). That's the planned migration and it's in the roadmap. We didn't do it up front because at 5–15 people it buys nothing and costs complexity.

**Q: What about concurrent edits — two people editing at once?**
Single-doc writes are **last-write-wins**. Two simultaneous edits: the later save clobbers the earlier one's unsaved changes. At current team size this is rare and fully recoverable (PITR 7-day rewind + Activity-log restore + soft-deletes). We actually *built* a read-before-write concurrency guard, hit a display glitch, and **reverted it** — because the correct fix is per-entity docs, not a bolted-on guard. Tagged with a trigger: revisit when we see real collisions or ~15+ simultaneous editors.

**Q: Why not just a Google Sheet / an ERP?**
A Sheet is great at tracking but weak at a *controlled email→approve workflow* and data integrity at 10–15 editors. An ERP (Cofactr/Fulcrum) is right at production scale but premature cost/overhead now. We built a thin custom app for the **workflow**, and kept it thin so we can throw it away for an ERP later without regret.

---

## The AI / robot questions

**Q: What does an email cost you in AI?**
~**$0.10–0.15 per parsed email** (input = the email + live BOM context; output = a small structured-JSON card). Cost scales with **email volume, not user count**. The robot polls in **10-minute batches**, and the AI *only extracts* — dedup and BOM-matching run in deterministic code, so those cost nothing and scale freely.

**Q: What happens if Claude returns garbage, refuses, or the API is down?**
Three layers: (1) output is **schema-enforced JSON** — malformed responses are rejected, not committed. (2) Every AI result lands in the **Review Inbox** — a human approves before anything touches real orders/BOM/vendors; the AI **never auto-commits**. (3) If the API is down or errors, the tick just logs and retries next cycle; nothing is lost because intake is idempotent (keyed by PO#/thread identity). Worst case = a card doesn't appear for 10 minutes.

**Q: The bot writes to your database — what stops it corrupting everything?**
The robot uses an IAM/service path that **bypasses Firestore security rules**, so containment is *code-level*: it PATCHes with `?updateMask.fieldPaths=pendingOrders` — it can only ever write the `pendingOrders` array, never orders/BOM/vendors. It runs in a **dedicated bot account**. (Honest deferral: the bot's IAM role is broader than its behavior — scoping it to a custom `datastore` role is on the deferred list with a trigger.)

**Q: Why deterministic parsing for Brex POs but AI for emails?**
Brex POs have a **fixed layout** → `pdf.js` parses them deterministically, zero AI cost, zero hallucination risk. Vendor emails are free-form → that's where the AI earns its keep. Use the cheapest tool that's reliable for each input.

---

## The security questions

**Q: Where's the Claude API key?**
**Only** in Apps Script Script Properties (server-side). The browser cannot and does not call Claude directly. Never in the repo — git history was scrubbed. `backups/` is gitignored.

**Q: Auth model?**
Google sign-in, domain-locked to verified `@fourier.earth` / `@fourierearth.com` (email_verified required), enforced in **Firestore security rules** with a deny-all fallback. The client-side gate is UX only; the rules are the actual boundary. Import-JSON is admin-only (single hardcoded verified email — no self-service admin escalation).

**Q: No per-role access? Any user can delete anything?**
True. Accepted trade-off for a small trusted team. The safety net is backups (PITR + Export-JSON) + full audit log + soft-deletes (nothing is hard-deleted; everything restorable). Per-role access is deferred with a trigger (wider/less-trusted rollout).

**Q: XSS from untrusted vendor text the robot ingests?**
Tested. Pasted `<img src=x onerror=...>` as a vendor name — rendered as literal text, no execution (React escapes by default). Untrusted robot text is safe to render.

---

## The reliability / testing questions

**Q: How do you test a bundled front-end with no real login?**
**5 test suites, 40+ assertions** run against the **real reducer logic** extracted into `test-*.js` (dedup, merge-on-approve, BOM triage, PO parsing) — every bug gets a regression test. Plus a post-deploy **smoke test** and preview-channel eyeballing before live. Honest gap: **no full browser E2E yet** — Playwright + Firebase emulator (fake auth, so no real Google login needed) lands with the source migration.

**Q: Tell me about a real bug.**
The cascade-delete incident: approving duplicate review cards reused a single order `id`, so one delete cascaded across the duplicates. Root cause: approve reused the card's thread-id as the order id. Fix: **unique `uid()` per approved order** + a regression test. Recovered fully via soft-delete + PITR — **zero data lost.** It's why we spend early on the irreversible stuff (data-loss paths) and defer the cheap-to-add stuff.

---

## The "why is the front-end one giant file" question

**Q: Your front-end is one bundled artifact — that's a bus-factor-of-one nightmare.**
Agreed — it's the biggest known debt, and the **source migration is planned** (rebuild as normal Vite + React source, in parallel, pointing at the *same* live Firestore so there's no data migration and no downtime; old URL stays as instant fallback). The MVP shipped fast in a bundled form on purpose; now that it's proven, we make it maintainable. After migration, any tool or dev edits normal small files, and full E2E tests come with it.

---

## Reflexes that land well with engineers

- **"We deferred it, here's the trigger."** Every punt (per-entity docs, App Check, scoped bot IAM, repo→org, E2E) is tagged with *when* we do it. That reads as judgment, not neglect.
- **"Cheapest reliable tool per input."** Deterministic where possible (Brex/pdf.js, dedup in code), AI only where free-form (emails).
- **"Spend early on the irreversible."** Data-loss paths got tests + backups first; cosmetic/scaling stuff waited.
- If cornered on something not covered here: *"I don't want to guess — it's in ARCHITECTURE.md / the code, let's pull it up."* Drive the deep discussion from the code, not the slides.

---

## Numbers cheat-sheet (memorize these five)

| Metric | Value |
|---|---|
| Cost per parsed email | ~$0.10–0.15 |
| Robot poll cadence | every 10 min (batched) |
| Tests | 5 suites / 40+ checks |
| Backup rewind | PITR 7-day + Activity log + Export JSON |
| Real scaling trigger | Firestore 1 MiB single-doc limit (not user count) |
