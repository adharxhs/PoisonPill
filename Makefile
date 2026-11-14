SHELL := /bin/bash

ENGINE_DIR   := engine
EXTENSION_DIR := extension
PUBLIC_DIR   := $(EXTENSION_DIR)/public
DIST_DIR     := dist

WASM_PKG     := $(ENGINE_DIR)/pkg
WASM_ARTIFACT := $(PUBLIC_DIR)/engine.wasm

.PHONY: all engine extension assets clean check

all: engine extension

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
## NOTE: package.json / tsconfig.json are not committed yet, so this target is a stub.
extension: assets
	@command -v tsc >/dev/null || { echo "tsc missing: TypeScript build tooling is not configured yet"; exit 1; }
	tsc -p $(EXTENSION_DIR)/tsconfig.json --outDir $(DIST_DIR)
	@echo "assembled $(DIST_DIR)/ — load it via chrome://extensions"

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

clean:
	rm -rf $(DIST_DIR) $(WASM_PKG) $(ENGINE_DIR)/target
	rm -f $(WASM_ARTIFACT)
