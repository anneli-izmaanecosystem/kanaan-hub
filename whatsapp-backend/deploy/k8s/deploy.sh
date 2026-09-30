#!/usr/bin/env sh
# Deploys the Kanaan WhatsApp backend into the "kanaan" namespace. Only ever creates or
# updates objects in that namespace (plus the namespace itself).
#
# Usage (from the repo root):  KUBECONFIG=/path/to/kubeconfig sh whatsapp-backend/deploy/k8s/deploy.sh
# Needs whatsapp-backend/.env with the real values (becomes the kanaan-service-env Secret).
set -eu

KUBECTL=${KUBECTL:-kubectl}
HERE=$(cd "$(dirname "$0")" && pwd)
SVC=$(cd "$HERE/../.." && pwd)
NS=kanaan
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

tar czf "$TMP/app.tgz" -C "$SVC" --exclude=__pycache__ --exclude='*.pyc' app migrations scripts requirements.txt
SUM=$(sha256sum "$TMP/app.tgz" "$SVC/.env" | sha256sum | cut -c1-16)

"$KUBECTL" get ns "$NS" >/dev/null 2>&1 || "$KUBECTL" create ns "$NS"
"$KUBECTL" -n "$NS" create secret generic kanaan-service-env --from-env-file="$SVC/.env" \
  --dry-run=client -o yaml | "$KUBECTL" apply -f -
"$KUBECTL" -n "$NS" create configmap kanaan-service-bundle --from-file=app.tgz="$TMP/app.tgz" \
  --dry-run=client -o yaml | "$KUBECTL" apply -f -
"$KUBECTL" apply -f "$HERE/kanaan-service.yaml"
# Roll the pod when code or env changed (ConfigMap/Secret edits don't restart it by themselves).
"$KUBECTL" -n "$NS" patch deploy kanaan-service -p \
  "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"kanaan/bundle-sum\":\"$SUM\"}}}}}"
"$KUBECTL" -n "$NS" rollout status deploy/kanaan-service --timeout=300s
