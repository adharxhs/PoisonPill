// Dedicated worker: the only place the Wasm engine is instantiated.
//
// `engine.js` is the `wasm-pack --target no-modules` loader, so it is pulled in
// with `importScripts` and exposes `wasm_bindgen`. Everything stays on the
// extension origin; nothing is fetched from the network.

import type {
  AnalyzeResponse,
  DocumentReport,
  EngineError,
  WorkerRequest,
  WorkerResponse,
} from './types';

interface LegalEngine {
  analyzeJson(text: string): string;
}

declare function importScripts(...urls: string[]): void;

declare const wasm_bindgen: {
  (options: { module_or_path: string }): Promise<void>;
  LegalEngine: new () => LegalEngine;
};

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

class EngineFailure extends Error {
  constructor(readonly payload: EngineError) {
    super(payload.message);
    this.name = 'EngineFailure';
  }
}

let enginePromise: Promise<LegalEngine> | null = null;

function loadEngine(): Promise<LegalEngine> {
  enginePromise ??= (async () => {
    importScripts(chrome.runtime.getURL('engine.js'));
    await wasm_bindgen({ module_or_path: chrome.runtime.getURL('engine.wasm') });
    return new wasm_bindgen.LegalEngine();
  })().catch((error: unknown) => {
    // Allow the next scan to retry a failed instantiation.
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

function parseEnvelope(value: unknown): AnalyzeResponse {
  if (typeof value !== 'object' || value === null || !('status' in value)) {
    throw new Error('engine returned a malformed envelope');
  }
  return value as AnalyzeResponse;
}

function unwrap(response: AnalyzeResponse): DocumentReport {
  if (response.status === 'error') {
    throw new EngineFailure(response.error);
  }
  return response.report;
}

async function analyzeText(text: string): Promise<DocumentReport> {
  const engine = await loadEngine();
  return unwrap(parseEnvelope(engine.analyzeJson(text)));
}

async function playbackFixture(): Promise<DocumentReport> {
  const response = await fetch(chrome.runtime.getURL('playback.json'));
  if (!response.ok) {
    throw new Error(`playback fixture unavailable (${response.status})`);
  }
  const value: unknown = await response.json();
  return unwrap(parseEnvelope(value));
}

function toEngineError(error: unknown): EngineError {
  if (error instanceof EngineFailure) {
    return error.payload;
  }
  return {
    code: 'internal_serialization',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function run(request: WorkerRequest): Promise<DocumentReport> {
  switch (request.type) {
    case 'ANALYZE_TEXT':
      return analyzeText(request.text);
    case 'PLAYBACK_FIXTURE':
      return playbackFixture();
  }
}

async function handle(request: WorkerRequest): Promise<void> {
  try {
    scope.postMessage({ type: 'ANALYSIS_RESULT', report: await run(request) });
  } catch (error: unknown) {
    scope.postMessage({ type: 'ANALYSIS_ERROR', error: toEngineError(error) });
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request?.type !== 'ANALYZE_TEXT' && request?.type !== 'PLAYBACK_FIXTURE') {
    return;
  }
  void handle(request);
};
