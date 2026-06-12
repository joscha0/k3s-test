#!/usr/bin/env bash
set -euo pipefail

if command -v k3d >/dev/null && k3d cluster list --no-headers | awk '{print $1}' | grep -qx k3s-test; then
  k3d cluster delete k3s-test
fi
