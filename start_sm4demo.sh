#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source scripts/toolchain.sh

# Select the SmileBASIC 4 demo application layout. The launcher discovers the
# demo's import table from the running module, so no separate addresses are
# needed here; this flag only records the intended target in session logs.
export HB_SM4_DEMO=1

case "${1:-}" in
  -h|--help)
    cat <<'TXT'
Usage: ./start_sm4demo.sh [computer-IP]

Demo build of the launcher for the SmileBASIC 4 demo application.

  ./start_sm4demo.sh                detect this computer's LAN address and start
  ./start_sm4demo.sh --list         list detected Wi-Fi/Ethernet addresses and exit
  ./start_sm4demo.sh 192.0.2.10     use a specific address (example only)

With no address, the host uses the only LAN address it finds. If the computer
has more than one, it lists them with interface names and asks which one the
Switch 2 can reach. Use the address on the console's network; do not use
127.0.0.1, a VPN-only address, or the console's own address.
TXT
    exit 0;;
  --list)
    exec "$NODE" smilebasic/connection.cjs --list;;
esac

"$NODE" scripts/doctor.cjs
if [ -f apps/c64-emulator/prepare.cjs ]; then
  if ! "$NODE" apps/c64-emulator/prepare.cjs; then
    echo "C64 GPU: auto-pack failed; starting with the previous package. Fix ROM/ and restart." >&2
  fi
fi
exec "$NODE" homebrew-launcher/start-launcher.cjs "$@"
