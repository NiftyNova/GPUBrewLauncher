#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source scripts/toolchain.sh
"$NODE" scripts/doctor.cjs
exec "$NODE" homebrew-launcher/start-launcher.cjs "$@"
