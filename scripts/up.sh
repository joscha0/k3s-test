#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export KUBECONFIG="$ROOT/.kube/k3d-k3s-test.yaml"

for command in docker k3d kubectl; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command"; exit 1; }
done

[[ -f .env ]] || { echo "Create .env from .env.example and change its secrets first."; exit 1; }
cp .env k3s/overlays/local/secret.env

if ! k3d cluster list --no-headers | awk '{print $1}' | grep -qx k3s-test; then
  k3d cluster create --config k3d/config.yaml
fi

mkdir -p "$(dirname "$KUBECONFIG")"
k3d kubeconfig get k3s-test > "$KUBECONFIG"

docker build -t k3s-auth-backend:local backend
docker build -t k3s-auth-frontend:local frontend
k3d image import -c k3s-test k3s-auth-backend:local k3s-auth-frontend:local

kubectl apply -k k3s/overlays/local
kubectl rollout restart deployment/backend deployment/frontend -n k3s-auth
kubectl rollout status statefulset/mongodb -n k3s-auth --timeout=180s
kubectl rollout status deployment/backend -n k3s-auth --timeout=180s
kubectl rollout status deployment/frontend -n k3s-auth --timeout=180s

echo "Application ready at http://localhost:8080"
