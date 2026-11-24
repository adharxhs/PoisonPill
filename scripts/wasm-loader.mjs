// Load the shipped `no-modules` Wasm bundle inside Node.
//
// The extension itself uses a classic worker with `importScripts`, so the
// loader is deliberately not an ES module. In Node we evaluate it in a vm
// context, expose the internal `wasm_bindgen` binding, and initialise it with
// the exact bytes committed under `extension/public/`.

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  glue: join(projectRoot, 'extension/public/engine.js'),
  wasm: join(projectRoot, 'extension/public/engine.wasm'),
};

/** @returns {Promise<{ analyze: (text: string) => string, review: (text: string) => string, wasmBytes: Buffer }>} */
export async function loadShippedEngine() {
  const glue = readFileSync(paths.glue, 'utf8');
  const wasmBytes = readFileSync(paths.wasm);

  const context = createContext({
    console,
    TextDecoder,
    TextEncoder,
    URL,
    WebAssembly,
  });

  runInContext(
    `${glue}\n;globalThis.__wasmBindgen = wasm_bindgen;`,
    context,
    { filename: paths.glue },
  );

  // Build the options object inside the vm realm so the glue's identity check
  // (`Object.getPrototypeOf(x) === Object.prototype`) succeeds.
  context.__wasmBytes = wasmBytes;
  await runInContext('__wasmBindgen({ module_or_path: __wasmBytes })', context);
  const engine = new context.__wasmBindgen.LegalEngine();

  return {
    analyze: (text) => engine.analyzeJson(text),
    review: (text) => engine.analyzeReviewJson(text),
    wasmBytes,
  };
}
