#!/bin/sh
# Post-deploy smoke test — verifies a deploy actually rendered and the security gates hold.
# No browser needed. Usage:
#   sh smoke-test.sh                       # tests the live site
#   sh smoke-test.sh <preview-channel-url> # tests a preview channel before promoting to live
set -u
URL="${1:-https://amur-supplychain.web.app}"
FS="https://firestore.googleapis.com/v1/projects/amur-supplychain/databases/(default)/documents"
FAIL=0
check() { if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (want $2, got $3)"; FAIL=1; fi }
# HTTP status with one retry on a transient 000 (dropped connection), so blips don't false-fail
httpcode() { c=$(curl -s -o /dev/null -w '%{http_code}' "$@"); [ "$c" = "000" ] && { sleep 1; c=$(curl -s -o /dev/null -w '%{http_code}' "$@"); }; echo "$c"; }

echo "Smoke-testing: $URL"
page=$(curl -s "$URL")
check "page serves 200"            200 "$(httpcode "$URL")"
check "app shell rendered"         1   "$([ "$(printf '%s' "$page" | grep -c '__bundler')" -ge 1 ] && echo 1 || echo 0)"
check "page is non-trivial (>100KB)" 1 "$([ "$(printf '%s' "$page" | wc -c)" -gt 100000 ] && echo 1 || echo 0)"

# no sensitive seed-data leaking into the served page (markers live in gitignored backups/)
MF="$(dirname "$0")/backups/seed-markers.txt"
if [ -f "$MF" ]; then
  while IFS= read -r m; do [ -n "$m" ] || continue
    check "no seed marker '$m' in page" 0 "$(printf '%s' "$page" | grep -c "$m")"
  done < "$MF"
else
  echo "SKIP: seed-marker check (backups/seed-markers.txt not present)"
fi

# Firestore security gates (same DB backs live + previews)
check "unauthenticated read denied"   403 "$(httpcode "$FS/dashboard/main")"
check "unauthenticated write denied"  403 "$(httpcode -X PATCH -H 'Content-Type: application/json' -d '{"fields":{"x":{"stringValue":"y"}}}' "$FS/dashboard/main")"
check "other collections denied"      403 "$(httpcode "$FS/anything/doc1")"

[ "$FAIL" = 0 ] && echo "SMOKE TEST: ALL PASS" || echo "SMOKE TEST: FAILURES FOUND"
exit $FAIL
