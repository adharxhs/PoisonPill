SHELL := /bin/bash

ENGINE_DIR   := engine
EXTENSION_DIR := extension
PUBLIC_DIR   := $(EXTENSION_DIR)/public
DIST_DIR     := dist

WASM_PKG     := $(ENGINE_DIR)/pkg
WASM_ARTIFACT := $(PUBLIC_DIR)/engine.wasm

.PHONY: all engine extension assets clean check verify fmt clippy test budget parity measure-wasm heldout goldens typecheck

all: engine extension

## Full gate: formatting, lints, unit/integration tests, wasm build, budgets,
## native/Wasm parity, and the TypeScript typecheck.
verify: fmt clippy test budget parity typecheck

## Compile the Rust core to WebAssembly and copy loader + binary into public/.
## `no-modules` keeps the classic Worker (importScripts) path working.
engine:
	@command -v wasm-pack >/dev/null || { echo "wasm-pack missing: cargo install wasm-pack"; exit 1; }
	wasm-pack build $(ENGINE_DIR) \
		--target no-modules \
		--release \
		--out-dir pkg \
		--out-name poisonpill_engine
	cp $(WASM_PKG)/poisonpill_engine_bg.wasm $(WASM_ARTIFACT)
	cp $(WASM_PKG)/poisonpill_engine.js $(PUBLIC_DIR)/engine.js
	@echo "wrote $(WASM_ARTIFACT) ($$(du -h $(WASM_ARTIFACT) | cut -f1))"

## Compile TypeScript and assemble the unpacked extension in dist/.
## Prerequisite: `npm install` once. esbuild bundles each entry as a classic
## script because content scripts and the worker are not ES modules.
extension:
	rm -rf $(DIST_DIR)
	@$(MAKE) --no-print-directory assets
	@test -x node_modules/.bin/esbuild || { echo "TypeScript tooling missing: run 'npm install'"; exit 1; }
	npm run --silent build
	@echo "assembled $(DIST_DIR)/ — load it via chrome://extensions"

## Typecheck without emitting. Part of `verify`.
typecheck:
	@test -x node_modules/.bin/tsc || { echo "TypeScript tooling missing: run 'npm install'"; exit 1; }
	npm run --silent typecheck

## Copy manifest, icons, and public assets into dist/.
assets:
	mkdir -p $(DIST_DIR)/icons
	cp manifest.json $(DIST_DIR)/manifest.json
	cp $(EXTENSION_DIR)/icons/*.png $(DIST_DIR)/icons/
	cp -R $(PUBLIC_DIR)/. $(DIST_DIR)/
	@if [ ! -f $(PUBLIC_DIR)/engine.wasm ]; then \
		echo "warning: $(PUBLIC_DIR)/engine.wasm missing, run 'make engine'"; \
	fi

## Static checks that do not require the wasm toolchain.
check:
	cargo check --manifest-path $(ENGINE_DIR)/Cargo.toml

fmt:
	cargo fmt --manifest-path $(ENGINE_DIR)/Cargo.toml -- --check

clippy:
	cargo clippy --manifest-path $(ENGINE_DIR)/Cargo.toml --all-targets -- -D warnings

test:
	cargo test --manifest-path $(ENGINE_DIR)/Cargo.toml

## Size and latency budgets. Release mode is required for the latency number.
budget: engine
	# Match the test harness panic strategy so Cargo builds one native library.
	CARGO_PROFILE_RELEASE_PANIC=unwind cargo test --release --manifest-path $(ENGINE_DIR)/Cargo.toml --test budgets -- --ignored --nocapture
	./scripts/check-size.sh $(WASM_ARTIFACT)

## Regenerate golden reports from the native engine. Review the diff: tests never
## write goldens. Held-out fixtures are deliberately excluded.
goldens:
	./scripts/update-goldens.sh

## Compare the shipped Wasm output with the native goldens, byte for byte.
## Run after `make engine`; part of `verify`.
parity:
	node scripts/wasm-parity.mjs

## Record 10k-word latency through the shipped Wasm artifact.
measure-wasm:
	node scripts/measure-wasm.mjs

## Print the one-shot held-out report (redirect to fixtures/heldout/REPORT.md).
heldout:
	node scripts/run-heldout.mjs

clean:
	rm -rf $(DIST_DIR) $(WASM_PKG) $(ENGINE_DIR)/target
