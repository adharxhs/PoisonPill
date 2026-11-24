// Background service worker: the only place the Wasm engine is instantiated.
//
// Content scripts run in the page's origin and cannot construct a Worker from a
// chrome-extension:// URL (Chrome throws a cross-origin SecurityError), so the
// engine lives in the extension's own service worker and content scripts reach
// it with `chrome.runtime.sendMessage`. This keeps parsing off the page's main
// thread and needs no permission beyond `storage`.
//
// `engine.js` is the `wasm-pack --target no-modules` loader. Service workers
// may only call `importScripts` during initial evaluation, so it is imported at
// top level; the Wasm module itself is instantiated lazily on first use.
// Everything stays on the extension origin; nothing is fetched from the network.

import { compareScan } from './audit';

import type {
  AnalyzeResponse,
  DocumentReport,
  EngineError,
  ReviewCandidate,
  ScanRecord,
  WorkerRequest,
  WorkerResponse,
} from './types';

interface LegalEngine {
  analyzeJson(text: string): string;
  analyzeReviewJson(text: string): string;
}

declare function importScripts(...urls: string[]): void;

declare const wasm_bindgen: {
  (options: { module_or_path: string }): Promise<void>;
  LegalEngine: new () => LegalEngine;
};

importScripts('engine.js');

class EngineFailure extends Error {
  constructor(readonly payload: EngineError) {
    super(payload.message);
    this.name = 'EngineFailure';
  }
}

let enginePromise: Promise<LegalEngine> | null = null;

function loadEngine(): Promise<LegalEngine> {
  enginePromise ??= (async () => {
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
  // `analyzeJson` returns the canonical envelope as a JSON string.
  return unwrap(parseEnvelope(JSON.parse(engine.analyzeJson(text)) as unknown));
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

async function handle(request: WorkerRequest, pageUrl?: string): Promise<WorkerResponse> {
  try {
    let report: DocumentReport;
    let reviewCandidates: ReviewCandidate[] | undefined;
    if (request.type === 'ANALYZE_TEXT' && request.review === true) {
      const engine = await loadEngine();
      const review: unknown = JSON.parse(engine.analyzeReviewJson(request.text));
      if (!Array.isArray(review) || review.length !== 2 || !Array.isArray(review[1])) {
        throw new Error('engine returned a malformed review result');
      }
      report = unwrap(parseEnvelope(review[0]));
      reviewCandidates = review[1] as ReviewCandidate[];
    } else {
      report = await run(request);
    }
    if (request.type === 'ANALYZE_TEXT' && request.input_truncated === true) {
      report.truncated = true;
    }
    const comparison = request.type === 'ANALYZE_TEXT' && pageUrl
      ? await compareScan(pageUrl, request.text, report).catch(() => undefined)
      : undefined;
    return { type: 'ANALYSIS_RESULT', report, comparison, review_candidates: reviewCandidates };
  } catch (error: unknown) {
    return { type: 'ANALYSIS_ERROR', error: toEngineError(error) };
  }
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const { type } = value as { type: unknown };
  if (type === 'PLAYBACK_FIXTURE') return true;
  return type === 'ANALYZE_TEXT' && typeof (value as { text?: unknown }).text === 'string';
}

let activeScanRevision = 0;
let pendingActivation: { tabId: number } | undefined;

function requestActivationScan(activation: { tabId: number }): void {
  void chrome.tabs.sendMessage(activation.tabId, 'AUTO_PAGE_REPORT', { frameId: 0 })
    .then(() => {
      if (pendingActivation === activation) pendingActivation = undefined;
    })
    .catch(() => {
      // A newly selected tab can still be loading. Retry at load completion.
    });
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  activeScanRevision += 1;
  const activation = { tabId };
  pendingActivation = activation;
  requestActivationScan(activation);
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete' && tab.active && pendingActivation?.tabId === tabId) {
    requestActivationScan(pendingActivation);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (pendingActivation?.tabId === tabId) pendingActivation = undefined;
});

async function handlePageRequest(request: WorkerRequest, sender: chrome.runtime.MessageSender): Promise<WorkerResponse> {
  if (request.type === 'ANALYZE_TEXT' && request.local_pdf === true &&
    sender.url === chrome.runtime.getURL('pdf.html')) {
    return handle(request);
  }
  const tabId = sender.tab?.id;
  const pageUrl = sender.url;
  if (request.type !== 'ANALYZE_TEXT' || tabId === undefined || !pageUrl) {
    return handle(request);
  }

  const revision = sender.tab?.active ? ++activeScanRevision : undefined;
  const response = await handle(request, pageUrl);
  if (response.type === 'ANALYSIS_ERROR') return response;

  const record: ScanRecord = {
    tab_id: tabId,
    url: pageUrl,
    scanned_at: new Date().toISOString(),
    report: response.report,
    comparison: response.comparison,
    review_candidates: response.review_candidates,
  };
  if (revision !== undefined && revision === activeScanRevision) {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab?.id === tabId && revision === activeScanRevision) {
      await chrome.storage.local.set({ last_scan: record });
    }
  }
  return { ...response, record };
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (response: WorkerResponse) => void) => {
    // Only this extension's own scripts may ask for analysis.
    if (sender.id !== chrome.runtime.id || !isWorkerRequest(message)) {
      return false;
    }
    void handlePageRequest(message, sender).then(sendResponse, (error: unknown) => {
      sendResponse({ type: 'ANALYSIS_ERROR', error: toEngineError(error) });
    });
    return true; // keep the channel open for the async response
  },
);
