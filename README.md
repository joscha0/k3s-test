# K3s Authentication Demo

Minimal full-stack authentication demo running in a k3d-managed K3s cluster:

`browser -> k3d nginx serverlb -> Traefik Ingress -> frontend/backend -> MongoDB`

The generated k3d nginx load balancer maps [http://localhost:8080](http://localhost:8080) to port 80 on the single K3s server. Traefik and Kubernetes Services route and balance application traffic across two frontend and two backend replicas.

## Prerequisites

- Docker
- k3d
- kubectl
- Node.js 24 and pnpm for local development

## Run

```bash
cp .env.example .env
# Change every secret value in .env.
./scripts/up.sh
./scripts/smoke.sh
```

Delete the environment with `./scripts/down.sh`. The MongoDB volume belongs to the disposable k3d cluster and is removed with it.

The scripts generate and use `.kube/k3d-k3s-test.yaml` explicitly. They do not read or modify the host K3s kubeconfig at `/etc/rancher/k3s/k3s.yaml`.

## Application

- `Hello World` is public.
- `Hello User` requires a signed-in user.
- `Hello Admins` requires the `admin` role.
- `/dashboard` gives admins a live architecture view with pod CPU and memory usage, configured requests and limits, recent request flows, and pod deletion controls.
- Sign-up creates normal users. The configured bootstrap account is created or promoted to admin whenever a backend pod starts.
- Access JWTs live for 15 minutes and remain in browser memory. Rotating refresh tokens live for seven days in an HttpOnly, SameSite cookie.

The dashboard reads pod usage from the K3s Metrics Server. Metrics may briefly show as unavailable while a new pod or the metrics pipeline becomes ready.

## Development

Run backend checks with `cd backend && pnpm test`. Run frontend checks with `cd frontend && pnpm build`.

The k3s resources use a reusable Kustomize base and a local k3d overlay. `.env` is copied to the ignored `k3s/overlays/local/secret.env` before deployment. These are standard Kubernetes API manifests because k3s implements the Kubernetes API.

## Production Notes

This repository is a production-oriented base, not a complete production platform. Replace the single in-cluster MongoDB instance with a managed or replicated deployment, manage secrets outside Git, terminate TLS before or at the cluster entrypoint, use a highly available control plane, and publish immutable images through a registry.

When enabling HTTPS, set `COOKIE_SECURE=true`.
