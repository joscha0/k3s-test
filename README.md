# K3s Authentication Demo

<img width="2851" height="1638" alt="image" src="https://github.com/user-attachments/assets/14c9237f-d30d-4e0a-8b54-139af8a6bde9" />


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

### Make User Admin

Open MongoDB:

```bash
kubectl --kubeconfig .kube/k3d-k3s-test.yaml exec -it -n k3s-auth mongodb-0 -- sh -lc \
  'mongosh --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin k3s_auth'
```

Make User Admin

```js
db.users.updateOne(
  { username: "test" },
  { $set: { role: "admin", updatedAt: new Date() } },
);
```

## Application

- `Hello World` is public.
- `Hello User` requires a signed-in user.
- `Hello Admins` requires the `admin` role.
- `/dashboard` gives admins a live architecture view with pod CPU and memory usage, configured requests and limits, recent request flows, and pod deletion controls.
- Sign-up creates normal users. The configured bootstrap account is created or promoted to admin whenever a backend pod starts.
- Access JWTs live for 15 minutes and remain in browser memory. Rotating refresh tokens live for seven days in an HttpOnly, SameSite cookie.

The dashboard reads pod usage from the K3s Metrics Server. Metrics may briefly show as unavailable while a new pod or the metrics pipeline becomes ready.
