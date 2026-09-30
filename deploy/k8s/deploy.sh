#!/usr/bin/env sh
# Builds and deploys the Next.js app (kanaan-hub.yaml) into the "kanaan" namespace.
# Only ever creates or updates objects in that namespace.
#
# Usage (from the repo root, Git Bash or Linux):
#   KUBECONFIG=/path/to/kubeconfig sh deploy/k8s/deploy.sh
# Needs .env.kanaan-hub (becomes the kanaan-hub-env Secret) and the "kanaan" namespace,
# which whatsapp-backend/deploy/k8s/deploy.sh creates.
#
# There is no image registry: the standalone build is copied onto the kanaan-hub-app
# volume through a short-lived loader pod while the app is scaled to zero, so a deploy
# has a brief outage.
set -eu

KUBECTL=${KUBECTL:-kubectl}
NS=kanaan
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

# SKIP_BUILD=1 reuses .next/kanaan-hub-app.tgz from the last run.
if [ -z "${SKIP_BUILD:-}" ]; then
echo "== build"
NEXT_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1 npx next build
cp -r public .next/standalone/
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/
fi

echo "== package"
# Never ship an env file inside the bundle; the pod gets its env from the Secret.
find .next/standalone -maxdepth 2 -name '.env*' -exec rm -f {} +
# With pnpm, the standalone node_modules links point at the project's own
# node_modules/.pnpm by absolute path, which does not exist in the pod. tar -h ships
# copies instead, but a copied package no longer sits next to its dependencies, so the
# loader recreates each link relative to the bundle from this list after extracting.
PNPM="$ROOT/node_modules/.pnpm/"
(cd .next/standalone && find . -type l | sed 's#^\./##' | while read -r l; do
  t=$(readlink "$l")
  case "$t" in "$PNPM"*)
    rel="node_modules/.pnpm/${t#"$PNPM"}"
    [ -e "$rel" ] && echo "$l $(dirname "$l" | sed 's#[^/][^/]*#..#g')/$rel"
  esac
done > .relink)
# Links the loader recreates are left out rather than shipped as copies (most of the
# bundle's size otherwise), and so is the Windows-only sharp binary. -h still copies any
# link that cannot be recreated from inside the bundle.
sed 's#^\([^ ]*\) .*#./\1#' .next/standalone/.relink > .next/relink-exclude.txt
echo '*sharp-win32*' >> .next/relink-exclude.txt
tar -czhf .next/kanaan-hub-app.tgz -X .next/relink-exclude.txt -C .next/standalone .
SUM=$(sha256sum .next/kanaan-hub-app.tgz .env.kanaan-hub | sha256sum | cut -c1-16)

echo "== secret, volume, service, cron"
"$KUBECTL" -n "$NS" create secret generic kanaan-hub-env --from-env-file=.env.kanaan-hub \
  --dry-run=client -o yaml | "$KUBECTL" apply -f -
"$KUBECTL" apply -f deploy/k8s/kanaan-hub.yaml

echo "== copy the bundle onto the volume"
"$KUBECTL" -n "$NS" scale deploy/kanaan-hub --replicas=0
"$KUBECTL" -n "$NS" wait --for=delete pod -l app=kanaan-hub --timeout=120s 2>/dev/null || true
"$KUBECTL" -n "$NS" delete pod kanaan-hub-loader --ignore-not-found --wait=true
"$KUBECTL" -n "$NS" apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: kanaan-hub-loader
  namespace: kanaan
spec:
  restartPolicy: Never
  automountServiceAccountToken: false
  securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000 }
  volumes:
    - name: app
      persistentVolumeClaim: { claimName: kanaan-hub-app }
  containers:
    - name: loader
      image: busybox:1.36
      command: ["sleep", "600"]
      volumeMounts: [{ name: app, mountPath: /app }]
      resources:
        requests: { cpu: 10m, memory: 16Mi }
        limits: { cpu: 200m, memory: 256Mi }
      securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } }
EOF
"$KUBECTL" -n "$NS" wait --for=condition=Ready pod/kanaan-hub-loader --timeout=300s
# kubectl cp, run from inside .next: it is binary-safe (a stdin stream through exec is not
# on Windows), and the source path must be relative since it reads "C:" as a pod name.
# The upload lands on the volume, not the container filesystem, which counts as memory.
(cd .next && "$KUBECTL" -n "$NS" cp kanaan-hub-app.tgz kanaan-hub-loader:/app/.upload.tgz)
"$KUBECTL" -n "$NS" exec kanaan-hub-loader -- sh -c \
  'find /app -mindepth 1 -maxdepth 1 ! -name lost+found ! -name .upload.tgz -exec rm -rf {} + && tar xzf /app/.upload.tgz -C /app && rm /app/.upload.tgz && cd /app && while read -r l t; do rm -rf "$l" && mkdir -p "$(dirname "$l")" && ln -s "$t" "$l"; done < .relink && test -f server.js && echo "bundle extracted, $(wc -l < .relink) links restored"'
"$KUBECTL" -n "$NS" delete pod kanaan-hub-loader --wait=true

echo "== start"
"$KUBECTL" -n "$NS" scale deploy/kanaan-hub --replicas=1
"$KUBECTL" -n "$NS" patch deploy kanaan-hub -p \
  "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"kanaan/bundle-sum\":\"$SUM\"}}}}}"
"$KUBECTL" -n "$NS" rollout status deploy/kanaan-hub --timeout=300s
