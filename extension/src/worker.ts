/// <reference lib="webworker" />
import type { AnalyzeRequest, DocumentReport, WorkerResponse } from './types';

// `wasm-pack --target no-modules` publishes a global `wasm_bindgen` loader with
// the exported types attached as properties.
declare const wasm_bindgen: {
  (wasmUrl?: string): Promise<void>;
  LegalEngine: new () => { analyze_document(text: string): DocumentReport };
};

type Engine = InstanceType<typeof wasm_bindgen.LegalEngine>;

let enginePromise: Promise<Engine> | null = null;

function getEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      importScripts(chrome.runtime.getURL('engine.js'));
      await wasm_bindgen(chrome.runtime.getURL('engine.wasm'));
      return new wasm_bindgen.LegalEngine();
    })();
  }
  return enginePromise;
}

function respond(message: WorkerResponse): void {
  (self as unknown as { postMessage(value: WorkerResponse): void }).postMessage(message);
}

self.onmessage = async (event: MessageEvent<AnalyzeRequest>) => {
  if (event.data?.type !== 'ANALYZE_TEXT') return;

  try {
    const engine = await getEngine();
    respond({ type: 'ANALYSIS_RESULT', report: engine.analyze_document(event.data.text) });
  } catch (error) {
    // An engine failure must never take down the page scan loop.
    enginePromise = null;
    respond({ type: 'ANALYSIS_ERROR', error: String(error) });
  }
};
