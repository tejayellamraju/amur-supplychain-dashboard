#!/bin/sh
# Security regression test — run any time with: sh test-security.sh
# Verifies the July 2026 audit fixes against the LIVE deployed system.
set -u
FAIL=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (expected $2, got $3)"; FAIL=1; fi
}

# 1. No sensitive seed data in the public page (no login needed to fetch it)
page=$(curl -s https://amur-supplychain.web.app)
for m in m3pn aliyun sinohykey 73125 144935; do
  check "live page has no '$m'" 0 "$(printf '%s' "$page" | grep -c "$m")"
done

# 2. Unauthenticated Firestore READ of dashboard/main is denied
code=$(curl -s -o /dev/null -w '%{http_code}' \
  "https://firestore.googleapis.com/v1/projects/amur-supplychain/databases/(default)/documents/dashboard/main")
check "unauthenticated read denied" 403 "$code"

# 3. Unauthenticated Firestore WRITE is denied
code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
  -H 'Content-Type: application/json' \
  -d '{"fields":{"pwned":{"stringValue":"test"}}}' \
  "https://firestore.googleapis.com/v1/projects/amur-supplychain/databases/(default)/documents/dashboard/main")
check "unauthenticated write denied" 403 "$code"

# 4. Any other collection is denied too (deny-all fallback rule)
code=$(curl -s -o /dev/null -w '%{http_code}' \
  "https://firestore.googleapis.com/v1/projects/amur-supplychain/databases/(default)/documents/anything/doc1")
check "other collections denied" 403 "$code"

[ "$FAIL" = 0 ] && echo "ALL PASS" || echo "FAILURES FOUND"
exit $FAIL
