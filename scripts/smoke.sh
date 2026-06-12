#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BASE_URL="${BASE_URL:-http://localhost:8080}"
export KUBECONFIG="$ROOT/.kube/k3d-k3s-test.yaml"

[[ -f "$KUBECONFIG" ]] || { echo "Missing k3d kubeconfig. Run ./scripts/up.sh first."; exit 1; }
set -a
source .env
set +a

curl -fsS "$BASE_URL/" >/dev/null
curl -fsS "$BASE_URL/api/hello/world" | grep -q "Hello world"

username="smoke_$(date +%s)"
cookie_jar="$(mktemp)"
trap 'rm -f "$cookie_jar"' EXIT

signup="$(curl -fsS -c "$cookie_jar" -H 'content-type: application/json' \
  -d "{\"username\":\"$username\",\"password\":\"smoke-test-password\"}" \
  "$BASE_URL/api/auth/signup")"
token="$(printf '%s' "$signup" | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).accessToken')"

curl -fsS -H "authorization: Bearer $token" "$BASE_URL/api/hello/user" | grep -q "Hello $username"
test "$(curl -sS -o /dev/null -w '%{http_code}' -H "authorization: Bearer $token" "$BASE_URL/api/hello/admin")" = "403"

refreshed="$(curl -fsS -b "$cookie_jar" -c "$cookie_jar" -X POST "$BASE_URL/api/auth/refresh")"
printf '%s' "$refreshed" | grep -q accessToken

admin_signin="$(curl -fsS -H 'content-type: application/json' \
  -d "{\"username\":\"$BOOTSTRAP_ADMIN_USERNAME\",\"password\":\"$BOOTSTRAP_ADMIN_PASSWORD\"}" \
  "$BASE_URL/api/auth/signin")"
admin_token="$(printf '%s' "$admin_signin" | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).accessToken')"
curl -fsS -H "authorization: Bearer $admin_token" "$BASE_URL/api/hello/admin" | grep -q "Hello admin"

backend_pod="$(kubectl get pods -n k3s-auth -l app=backend -o jsonpath='{.items[0].metadata.name}')"
frontend_pod="$(kubectl get pods -n k3s-auth -l app=frontend -o jsonpath='{.items[0].metadata.name}')"
kubectl delete pod -n k3s-auth "$backend_pod" --wait=false
kubectl delete pod -n k3s-auth "$frontend_pod" --wait=false
curl -fsS "$BASE_URL/api/hello/world" | grep -q "Hello world"
kubectl rollout status deployment/backend -n k3s-auth --timeout=180s
kubectl rollout status deployment/frontend -n k3s-auth --timeout=180s
curl -fsS "$BASE_URL/api/hello/world" | grep -q "Hello world"

echo "Smoke test passed"
