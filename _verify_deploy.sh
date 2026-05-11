#!/bin/sh
F=$(ls /app/static/dashboard/assets/index-*.js | head -1)
echo "== file =="
ls -la "$F"
echo "== new strings =="
echo -n "per_claim_at_30_tail: "; grep -c per_claim_at_30_tail "$F"
echo -n "Tail %: "; grep -c "Tail %" "$F"
echo -n "expected_xirr: "; grep -c expected_xirr "$F"
echo -n "buildClaimNameMap: "; grep -c buildClaimNameMap "$F"
echo "== old strings (should be 0) =="
echo -n "Tata Tail: "; grep -c "Tata Tail" "$F"
echo -n "Tata tail: "; grep -c "Tata tail" "$F"
