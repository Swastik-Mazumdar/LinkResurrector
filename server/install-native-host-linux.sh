#!/usr/bin/env bash
set -euo pipefail

extension_id="${1:-${LINKRESURRECTOR_EXTENSION_ID:-}}"
if [[ -z "$extension_id" ]]; then
  echo "Usage: $0 <32-character Chrome extension ID>" >&2
  exit 1
fi

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$source_dir/install.mjs" "$extension_id"
