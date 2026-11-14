#!/usr/bin/env bash
# Regenerate every golden report from the native engine.
#
# This is a deliberate, reviewable action: `cargo test` never writes goldens.
# A diff here means detection behaviour changed, so read the JSON before
# committing it. Never run this to make a red test green without understanding
# why the output moved.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="$root/engine/target/release/analyze"

cargo build --release --quiet --manifest-path "$root/engine/Cargo.toml" --bin analyze

shopt -s nullglob
for class in positive hard_negative negative; do
	mkdir -p "$root/fixtures/golden/$class"
	for case in "$root/fixtures/cases/$class"/*.txt; do
		name="$(basename "$case" .txt)"
		"$bin" "$case" >"$root/fixtures/golden/$class/$name.json"
		echo "wrote fixtures/golden/$class/$name.json"
	done
done
