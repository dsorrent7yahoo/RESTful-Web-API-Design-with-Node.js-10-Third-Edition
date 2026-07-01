# Kubernetes Workflow — Django Microservices

How Kubernetes gets Docker images running and keeps them alive in this project.

---

## Architecture Overview

```
Developer machine (Windows + Docker Desktop)
│
├── Docker daemon  ←── builds images
├── Local registry  localhost:5000  ←── stores images
│
└── KIND cluster  (Kubernetes-in-Docker)
      └── desktop-control-plane container  (node)
            ├── glue-catalog        pod  (port 4010)
            ├── claims-generator    pod  (port 4011)
            ├── claims-cleaner      pod  (port 4012)
            ├── sqs-monitor         pod  (port 4013)
            ├── athena-client       pod  (port 4014)
            ├── flask-backend       pod  (port 4001)
            └── patients-encounters pod  (port 4015)

kubectl port-forward bridges localhost:3000X → pod ports
```

---

## Step 1 — Build the Docker Image

```bash
# Build from a clean /tmp context (avoids OneDrive BuildKit hang)
cp microservices/claims_generator/app.py       /tmp/claims-gen-ctx/
cp microservices/claims_generator/requirements.txt /tmp/claims-gen-ctx/
cp django-back-end/lambdas/*.py                /tmp/claims-gen-ctx/lambdas/

docker build -t localhost:5000/claims-generator:latest /tmp/claims-gen-ctx/
```

**What Kubernetes needs in the image:**
- Application code (`app.py`)
- All Python dependencies (installed via `pip` in `RUN` layer)
- Lambda modules baked into `/app/lambdas/` (not mounted — no docker-compose volumes in K8s)
- `ENV LAMBDA_DIR=/app/lambdas` set in the Dockerfile

---

## Step 2 — Push to the Local Registry

```bash
docker push localhost:5000/claims-generator:latest
```

The local registry runs as a Docker container:
```
local-registry   registry:2   0.0.0.0:5000->5000/tcp
```

The KIND node (`desktop-control-plane`) resolves `localhost:5000` because it has a
`/etc/hosts` entry pointing to the host's Docker bridge IP. Kubernetes pulls images
from this registry when creating pods.

> **imagePullPolicy: Always** must be set on the Deployment so Kubernetes re-pulls
> after each `docker push` instead of using the node's cached layer.

---

## Step 3 — Kubernetes Objects Created (`kubectl apply`)

Applying `k8s/microservices.yaml` creates these objects in the `healthcare` namespace:

### Namespace
```
healthcare
```
Isolates all microservice resources from the default namespace.

### ConfigMap  `django-config`
Key/value environment variables shared by all pods:
```
AWS_REGION, STAGING_BUCKET, CLAIMS_PREFIX, CLEAN_PREFIX,
JWT_SECRET, GLUE_DATABASE, ATHENA_WORKGROUP, ...
```

### Secret  `aws-credentials`
Created by `deploy-microservices.sh` from `~/.aws/credentials` and `~/.aws/config`.
Mounted read-only into every pod at `/root/.aws` so boto3 can authenticate with AWS.

### Deployment  (one per microservice)
A Deployment is the controller that owns the pod. Key fields:

```yaml
spec:
  replicas: 1                          # desired pod count
  selector:
    matchLabels:
      app: claims-generator            # links Deployment → ReplicaSet → Pod
  template:
    spec:
      containers:
        - name: claims-generator
          image: localhost:5000/claims-generator:latest
          imagePullPolicy: Always      # always pull after docker push
          envFrom:
            - configMapRef:
                name: django-config    # inject all config env vars
          volumeMounts:
            - name: aws-credentials
              mountPath: /root/.aws    # AWS SDK reads creds from here
              readOnly: true
      volumes:
        - name: aws-credentials
          secret:
            secretName: aws-credentials
```

### Service  (NodePort, one per microservice)
Gives the pod a stable network address and exposes it on the node:

```yaml
spec:
  type: NodePort
  selector:
    app: claims-generator     # routes to pods with this label
  ports:
    - port: 4011              # ClusterIP port (internal)
      targetPort: 4011        # container port uvicorn listens on
      nodePort: 30001         # port on the KIND node (30000–32767)
```

| Service | ClusterIP port | Container port | NodePort |
|---|---|---|---|
| glue-catalog | 4010 | 4010 | 30000 |
| claims-generator | 4011 | 4011 | 30001 |
| claims-cleaner | 4012 | 4012 | 30002 |
| sqs-monitor | 4013 | 4013 | 30003 |
| athena-client | 4014 | 4014 | 30004 |

---

## Step 4 — Kubernetes Schedules and Starts the Pod

Once `kubectl apply` runs, the control loop begins:

```
1. API Server stores the Deployment spec in etcd
2. Deployment controller sees desired replicas = 1, actual = 0
3. Deployment controller creates a ReplicaSet
4. ReplicaSet controller creates a Pod object (status: Pending)
5. Scheduler assigns the Pod to desktop-control-plane node
6. kubelet on the node sees the Pod assigned to it
7. kubelet calls containerd to pull localhost:5000/claims-generator:latest
8. containerd pulls image layers from the local registry
9. kubelet creates the container and starts the process:
     uvicorn app:app --host 0.0.0.0 --port 4011
10. Pod status transitions:  Pending → ContainerCreating → Running
```

---

## Step 5 — Kubernetes Keeps the Pod Running

The kubelet runs a continuous reconciliation loop:

### Container restart on crash
```
Container exits with non-zero code
  → kubelet restarts it (after backoff: 10s, 20s, 40s, ... up to 5min)
  → kubectl get pods shows RESTARTS count increment
```

### Liveness / Readiness (if configured)
Each microservice exposes `GET /health → {"status":"ok"}`.
If a liveness probe is added to the Deployment, kubelet polls it periodically
and kills + restarts the container if it stops responding.

### ReplicaSet enforces desired count
```
Pod deleted manually or crashes permanently
  → ReplicaSet controller detects actual < desired
  → Creates a replacement Pod immediately
  → Scheduler assigns it to the node
  → kubelet pulls image and starts container
```

---

## Step 6 — Rolling Update (on code change)

```bash
# 1. Rebuild with new code
docker build -t localhost:5000/claims-generator:latest /tmp/claims-gen-ctx/

# 2. Push new image
docker push localhost:5000/claims-generator:latest

# 3. Trigger rollout
kubectl rollout restart deployment/claims-generator -n healthcare
```

Kubernetes performs a **rolling update**:
```
1. Creates a new Pod with the new image  (new ReplicaSet)
2. Waits for new Pod to reach Running/Ready
3. Terminates the old Pod
4. Zero downtime — one pod is always serving during the swap
```

Monitor with:
```bash
kubectl rollout status deployment/claims-generator -n healthcare
```

---

## Step 7 — Port-Forward (local access workaround)

The KIND cluster node (`desktop-control-plane`) runs inside Docker with only port 6443
mapped to the host. NodePort services (30000–30004) are exposed on the node container
but not on `localhost`. `kubectl port-forward` bridges this gap:

```bash
kubectl port-forward -n healthcare svc/claims-generator 30001:4011
```

Traffic flow:
```
Browser / curl
  → localhost:30001
    → kubectl port-forward process (on host)
      → Kubernetes API Server tunnel
        → Pod:4011 (uvicorn inside container)
```

Run all 5 at once:
```bash
bash pf-microservices.sh         # start
bash pf-microservices.sh stop    # stop
```

> Port-forwards drop when pods restart during a rollout. Re-run the script after
> `kubectl rollout restart`.

---

## Step 8 — Inspecting the Running System

```bash
# Pod status
kubectl get pods -n healthcare

# Describe a pod (image, mounts, events)
kubectl describe pod -n healthcare -l app=claims-generator

# Live logs
kubectl logs -n healthcare deployment/claims-generator -f

# Exec into a running pod (python:3.12-slim has bash)
kubectl exec -it -n healthcare deployment/claims-generator -- bash

# Services and NodePorts
kubectl get svc -n healthcare

# ConfigMap values
kubectl get configmap django-config -n healthcare -o yaml

# Secrets (base64 encoded)
kubectl get secret aws-credentials -n healthcare -o yaml
```

---

## Summary — Full Workflow Sequence

```
Source code change
  ↓
docker build (from /tmp to avoid OneDrive hang)
  ↓
docker push localhost:5000/<service>:latest
  ↓
kubectl rollout restart deployment/<service> -n healthcare
  ↓
Kubernetes pulls new image (imagePullPolicy: Always)
  ↓
New pod starts, old pod terminates (rolling update)
  ↓
bash pf-microservices.sh   ← re-run after rollout
  ↓
localhost:3000X → pod serving requests
```
