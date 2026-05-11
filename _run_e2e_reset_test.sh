#!/bin/bash
set -euo pipefail

BASE_URL="http://localhost:8080"
EMAIL="e2e.reset.$(date +%s)@5riverscap.com"
NAME="E2E Reset User"
PASS_INITIAL="StartPass2026!"
PASS_NEW="ResetPass2026!"
OTP_SIGNUP="111111"
OTP_RESET="222222"

post_json() {
  local path="$1"
  local body="$2"
  local out_file
  out_file=$(mktemp)
  local code
  code=$(curl -s -o "$out_file" -w "%{http_code}" -X POST "${BASE_URL}${path}" -H 'Content-Type: application/json' -d "$body")
  echo "$code|$out_file"
}

echo "[1/9] Request signup OTP for fresh email: $EMAIL"
r=$(post_json "/api/auth/register/request-otp" "{\"email\":\"$EMAIL\",\"password\":\"$PASS_INITIAL\",\"full_name\":\"$NAME\"}")
code="${r%%|*}"; file="${r##*|}"
cat "$file"; echo
if [ "$code" != "200" ]; then
  echo "Signup OTP request failed with status $code" >&2
  exit 1
fi

echo "[2/9] Force known signup OTP in pending_registrations"
OTP_HASH_SIGNUP=$(docker exec -w /app/server -e OTP="$OTP_SIGNUP" deploy-web-1 node -e "const b=require('bcryptjs'); console.log(b.hashSync(process.env.OTP,12));")
docker exec deploy-db-1 psql -U cap_user -d claim_analytics -c "UPDATE pending_registrations SET otp_hash='${OTP_HASH_SIGNUP}', attempts=0, expires_at=NOW() + interval '10 minutes' WHERE email='${EMAIL}';"

echo "[3/9] Verify signup OTP and create account"
r=$(post_json "/api/auth/register/verify-otp" "{\"email\":\"$EMAIL\",\"otp\":\"$OTP_SIGNUP\"}")
code="${r%%|*}"; file="${r##*|}"
cat "$file"; echo
if [ "$code" != "201" ]; then
  echo "Signup OTP verify failed with status $code" >&2
  exit 1
fi

echo "[4/9] Confirm login works with initial password"
r=$(post_json "/api/auth/login" "{\"email\":\"$EMAIL\",\"password\":\"$PASS_INITIAL\"}")
code="${r%%|*}"; file="${r##*|}"
if [ "$code" != "200" ]; then
  cat "$file"; echo
  echo "Initial login failed with status $code" >&2
  exit 1
fi

echo "[5/9] Request forgot-password OTP"
r=$(post_json "/api/auth/forgot-password/request-otp" "{\"email\":\"$EMAIL\"}")
code="${r%%|*}"; file="${r##*|}"
cat "$file"; echo
if [ "$code" != "200" ]; then
  echo "Forgot-password OTP request failed with status $code" >&2
  exit 1
fi

echo "[6/9] Force known reset OTP in password_reset_requests"
OTP_HASH_RESET=$(docker exec -w /app/server -e OTP="$OTP_RESET" deploy-web-1 node -e "const b=require('bcryptjs'); console.log(b.hashSync(process.env.OTP,12));")
docker exec deploy-db-1 psql -U cap_user -d claim_analytics -c "UPDATE password_reset_requests SET otp_hash='${OTP_HASH_RESET}', attempts=0, expires_at=NOW() + interval '10 minutes' WHERE email='${EMAIL}';"

echo "[7/9] Verify reset OTP and set new password"
r=$(post_json "/api/auth/forgot-password/verify-otp" "{\"email\":\"$EMAIL\",\"otp\":\"$OTP_RESET\",\"new_password\":\"$PASS_NEW\"}")
code="${r%%|*}"; file="${r##*|}"
cat "$file"; echo
if [ "$code" != "200" ]; then
  echo "Reset verify failed with status $code" >&2
  exit 1
fi

echo "[8/9] Confirm old password is rejected"
r=$(post_json "/api/auth/login" "{\"email\":\"$EMAIL\",\"password\":\"$PASS_INITIAL\"}")
code="${r%%|*}"; file="${r##*|}"
cat "$file"; echo
if [ "$code" != "401" ]; then
  echo "Expected old password to fail with 401, got $code" >&2
  exit 1
fi

echo "[9/9] Confirm new password login succeeds"
r=$(post_json "/api/auth/login" "{\"email\":\"$EMAIL\",\"password\":\"$PASS_NEW\"}")
code="${r%%|*}"; file="${r##*|}"
cat "$file"; echo
if [ "$code" != "200" ]; then
  echo "Expected new password login 200, got $code" >&2
  exit 1
fi

echo "E2E_RESET_TEST_PASSED email=$EMAIL"
