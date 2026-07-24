# Testing & release strategy

The goal isn't zero bugs (impossible in evolving software) — it's making bugs **cheap to catch, impossible to be catastrophic, and fast to recover from.** Effort goes where bugs actually occur: **every bug in this project has been in business logic, none in rendering.** So the logic layer is tested hard and automatically; the UI gets a cheap smoke test + a one-time manual pass, with full browser E2E deferred to the source-project migration.

## Layer 1 — Automated logic tests (the core net)
Fast Node tests that port the **real** app/robot logic verbatim. Every bug we've hit has a regression test here, so it can't silently return.

```sh
node test-app-logic.js     # dashboard reducers: approve/delete/edit/coverage/vendor-stats/restore/timeliness/log-cap
node test-dedup.js         # robot duplicate detection tiers
node test-robot.js         # robot converters, card builder, tag matching
node test-bom-pipeline.js  # BOM import mapping, coverage, replace-mode teardown safety
node test-brex-po.js       # Brex PO parser
```
**Rule: run these before every deploy, and add a regression test for every new bug.**

## Layer 2 — Post-deploy smoke test (automated, no browser)
Verifies a deploy actually rendered and the security gates hold. Run against a preview URL before promoting, or against live after deploy.

```sh
sh smoke-test.sh                     # test the live site
sh smoke-test.sh <preview-url>       # test a preview channel first
```
Checks: page serves 200 · app shell rendered · no seed-data leak · unauthenticated read/write/other-collections all denied.

## Layer 3 — Preview-before-prod (the process that stops bugs reaching the team)
Deploys currently go straight to the live site on push to `main`. For anything that touches the app, verify on a **preview channel** first:

```sh
# 1. deploy the current public/ to a temporary preview URL (does NOT touch live)
npx -y firebase-tools@latest hosting:channel:deploy preview --project amur-supplychain
# 2. it prints a preview URL — smoke-test it, then click through it
sh smoke-test.sh <that-preview-url>
# 3. only once it's verified, promote to live (push to main → GitHub Action deploys)
```
This is the single highest-leverage safeguard: bugs get caught on the preview URL, not on the site the team uses.

## Layer 4 — Manual UI pass (one-time, before sharing / after big UI changes)
The only thing automation can't cheaply cover (auth + real click-through). ~5 minutes:
1. Sign in (data loads) · incognito personal account → "Access denied"
2. Add → edit → delete one order → **only it** changes → Restore from Activity log
3. Approve a review card → becomes an order · Discard another → gone
4. Import a small CSV (append) → rows appear
5. Drop a Brex PO PDF → form fills

## Deferred — full browser E2E (Playwright + Firebase Emulator)
Automates Layer 4 (every click, with a fake auth user against local emulator data — no prod risk, runs in CI). **Deliberately deferred** to the source-project migration: it needs a build step + emulator wiring that fit a source repo, not the current single-file bundle. Revisit then.

## When a bug is found — the playbook
1. **Contain** — revert the change (git revert; code is always reversible)
2. **Diagnose the root cause** (not the symptom) — grep every caller
3. **Fix the cause**, once, where all callers route through
4. **Add a regression test** (Layer 1) so it can't return
5. **Verify** (tests + smoke) and redeploy
6. Recovery net if data was touched: PITR (7-day rewind) + Activity-log restore + Export JSON
