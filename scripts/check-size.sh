#!/usr/bin/env bash
# Fail the build when the Wasm artifact grows past the recorded budget.
set -euo pipefail

artifact="${1:-extension/public/engine.wasm}"
budget_bytes=$((2 * 1024 * 1024))

if [[ ! -f "$artifact" ]]; then
  echo "size budget: missing $artifact (run 'make engine' first)" >&2
  exit 1
fi

actual_bytes=$(wc -c <"$artifact")
printf 'size budget: %s = %d bytes (%.2f KiB), budget %d bytes\n' \
  "$artifact" "$actual_bytes" "$(awk "BEGIN {print $actual_bytes/1024}")" "$budget_bytes"

if (( actual_bytes > budget_bytes )); then
  echo "size budget exceeded by $((actual_bytes - budget_bytes)) bytes" >&2
  exit 1
fi
