#!/usr/bin/env bash
# Task 3b manual test plan (curl-based). Run against http://localhost:3001.
set -u
BASE="http://localhost:3001"
EMAIL="testuser$(date +%s)@example.com"
PASS="Password123!"
JAR=$(mktemp)
PASS_COUNT=0; FAIL_COUNT=0

check() { # check <description> <expected> <actual>
  if [ "$2" == "$3" ]; then
    echo "PASS: $1"; PASS_COUNT=$((PASS_COUNT+1))
  else
    echo "FAIL: $1 (expected [$2], got [$3])"; FAIL_COUNT=$((FAIL_COUNT+1))
  fi
}

echo "=== 1. Register + Set-Cookie flags ==="
REG=$(curl -s -c "$JAR" -D - -o /dev/null -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"fullName\":\"Test User\",\"studentId\":\"BC-0001\"}" -w '\nHTTP:%{http_code}')
echo "$REG" | grep -Ei 'HTTP/|^set-cookie|HTTP:' 
check "register returns 200" "true" "$(echo "$REG" | grep -q 'HTTP:200' && echo true || echo false)"
check "session cookie is set" "true" "$(echo "$REG" | grep -qi 'set-cookie: session=' && echo true || echo false)"
check "session cookie is HttpOnly" "true" "$(echo "$REG" | grep -i 'set-cookie: session=' | grep -qi 'httponly' && echo true || echo false)"
check "session cookie is SameSite=lax" "true" "$(echo "$REG" | grep -i 'set-cookie: session=' | grep -qi 'samesite=lax' && echo true || echo false)"
check "session cookie has Path=/" "true" "$(echo "$REG" | grep -i 'set-cookie: session=' | grep -qi 'path=/' && echo true || echo false)"

echo; echo "=== 2a. Log in with correct password ==="
LI=$(curl -s -c "$JAR" -D - -o /dev/null -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" -w '\nHTTP:%{http_code}')
check "login returns 200" "true" "$(echo "$LI" | grep -q 'HTTP:200' && echo true || echo false)"
check "login sets a fresh session cookie" "true" "$(echo "$LI" | grep -qi 'set-cookie: session=[^;]' && echo true || echo false)"

echo; echo "=== 2b. Wrong password ==="
WP=$(curl -s -b "$JAR" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"WrongPass999\"}" -w '\nHTTP:%{http_code}')
echo "$WP"
check "wrong password -> 401" "true" "$(echo "$WP" | grep -q 'HTTP:401' && echo true || echo false)"
check "wrong password -> generic error, no hash leak" "true" "$(echo "$WP" | grep -q 'Invalid email or password' && echo true || echo false)"

echo; echo "=== 2c. Session works on /api/auth/me ==="
ME=$(curl -s -b "$JAR" "$BASE/api/auth/me")
echo "$ME"
check "me returns registered email" "true" "$(echo "$ME" | grep -q "$EMAIL" && echo true || echo false)"
check "me returns role student" "true" "$(echo "$ME" | grep -q '"role":"student"' && echo true || echo false)"

echo; echo "=== 2d. /login with active session -> redirect to /chat ==="
CODE=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/login")
LOC=$(curl -s -b "$JAR" -o /dev/null -w '%{redirect_url}' "$BASE/login")
check "logged-in /login redirects to /chat" "true" "$( { [ "$CODE" = "307" ] || [ "$CODE" = "308" ]; } && [ "$LOC" = "$BASE/chat" ] && echo true || echo false)"

echo; echo "=== 2e. Log out ==="
LO=$(curl -s -b "$JAR" -c "$JAR" -D - -X POST "$BASE/api/auth/logout" -w '\nHTTP:%{http_code}')
echo "$LO" | grep -Ei 'HTTP/|^set-cookie|HTTP:'
check "logout returns 200" "true" "$(echo "$LO" | grep -q 'HTTP:200' && echo true || echo false)"
check "logout clears cookie (max-age=0 or empty value)" "true" "$(echo "$LO" | grep -i 'set-cookie: session=' | grep -qiE 'max-age=0|session=;' && echo true || echo false)"

echo; echo "=== 2f. After logout, /api/auth/me is 401 ==="
ME2=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/auth/me")
check "me -> 401 after logout" "401" "$ME2"

echo; echo "=== 3. /chat while logged out -> redirect to /login ==="
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/chat")
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/chat")
echo "GET /chat (no cookie) -> $CODE, redirect: $LOC"
check "logged-out /chat redirects to /login" "true" "$( { [ "$CODE" = "307" ] || [ "$CODE" = "308" ]; } && [ "$LOC" = "$BASE/login" ] && echo true || echo false)"

echo; echo "=== 4. /admin as a student -> redirect to /chat ==="
# Re-login (fresh cookie), then hit /admin. Middleware passes (valid session);
# the page must re-check users.role in the DB and redirect students away.
curl -s -o /dev/null -c "$JAR" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"
CODE=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/admin")
LOC=$(curl -s -b "$JAR" -o /dev/null -w '%{redirect_url}' "$BASE/admin")
echo "GET /admin (student cookie) -> $CODE, redirect: $LOC"
check "student /admin redirects to /chat" "true" "$( { [ "$CODE" = "307" ] || [ "$CODE" = "308" ]; } && [ "$LOC" = "$BASE/chat" ] && echo true || echo false)"

echo; echo "=== Cleanup ==="
curl -s -b "$JAR" -o /dev/null -X POST "$BASE/api/auth/logout"
rm -f "$JAR"
echo "test user email: $EMAIL (row left in users table; delete manually if desired)"

echo; echo "RESULT: $PASS_COUNT passed, $FAIL_COUNT failed"
