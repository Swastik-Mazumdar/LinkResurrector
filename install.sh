#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "============================================================"
echo "   LinkResurrector - Native Messaging Helper Installer"
echo "============================================================"
echo ""

ext_id="${1:-}"
if [[ -z "$ext_id" ]]; then
  read -rp "Enter your 32-character Extension ID from chrome://extensions: " ext_id
fi

node server/install.mjs "$ext_id"
