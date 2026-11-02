#!/usr/bin/env bash
# Extra check: /admin must ALLOW a real admin (proves the DB role re-check is
# not a blanket redirect). Uses the service-role key locally; never printed.
set -u
BASE="http://localhost:3001"
EMAIL="adminprobe$(date +%s)@example.com"
PASS="Password123!"
JAR=$(mktemp)

SUPA_URL=$(grep -m1 '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2-)
SERVICE_KEY=$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)
[ -n "$SUPA_URL" ] && [ -n "$SERVICE_KEY" ] || { echo "missing supabase env"; exit 1; }

echo "=== register probe user (student) ==="
curl -s -o /dev/null -c "$JAR" -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"fullName\":\"Admin Probe\"}"
USER_ID=$(curl -s "$SUPA_URL/rest/v1/users?email=eq.$EMAIL&select=id" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  | sed 's/.*"id":"\([^"]*\)".*/\1/')
echo "user id: $USER_ID"

echo; echo "=== as student: GET /admin ==="
S=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE/admin")
echo "student /admin -> $S"

echo; echo "=== promote to admin in the DB (service role) ==="
P=$(curl -s -w '\nHTTP:%{http_code}' -X PATCH "$SUPA_URL/rest/v1/users?id=eq.$USER_ID" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' -H 'Prefer: return=minimal' \
  -d '{"role":"admin"}')
echo "promote -> $P"

echo "NOTE: the JWT still says role=student (stale token). Re-login to refresh it."
curl -s -o /dev/null -c "$JAR" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"

echo; echo "=== as admin: GET /admin ==="
A=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE/admin")
echo "admin /admin -> $A"

echo; echo "=== stale/forged token: JWT says role=admin while DB says student ==="
DEMOTE=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$SUPA_URL/rest/v1/users?id=eq.$USER_ID" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d '{"role":"student"}')
echo "demote in DB -> $DEMOTE"
FORGED=$(JWT_SECRET=$(grep -m1 '^JWT_SECRET=' .env.local | cut -d= -f2-) USER_ID="$USER_ID" EMAIL="$EMAIL" \
  node -e 'const {SignJWT}=require("jose");const s=new TextEncoder().encode(process.env.JWT_SECRET);new SignJWT({email:process.env.EMAIL,role:"admin"}).setProtectedHeader({alg:"HS256"}).setSubject(process.env.USER_ID).setIssuedAt().setExpirationTime("1h").sign(s).then(t=>console.log(t))')
FORGED_ADMIN=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H "Cookie: session=$FORGED" "$BASE/admin")
echo "forged role=admin JWT -> $FORGED_ADMIN  (expect redirect to /chat: DB wins)"
curl -s -o /dev/null -X PATCH "$SUPA_URL/rest/v1/users?id=eq.$USER_ID" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d '{"role":"admin"}' || true

echo; echo "=== tampered cookie (bad signature) on /chat ==="
BAD="${FORGED%?}X"
TAMPERED=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H "Cookie: session=$BAD" "$BASE/chat")
echo "tampered JWT -> $TAMPERED  (expect redirect to /login)"

echo; echo "=== cleanup: delete probe row ==="
curl -s -o /dev/null -w 'DELETE http: %{http_code}\n' -X DELETE "$SUPA_URL/rest/v1/users?email=eq.$EMAIL" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY"
rm -f "$JAR"
