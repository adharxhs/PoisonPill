// Content script: extract page text, hand it to the worker, store the report.
//
// This is the reference shell, not the product UI. It makes no DOM writes and
// performs no classification; detection lives in Rust. Only the most recent
// report is persisted, and nothing ever leaves the browser.

import type { AnalyzeRequest, ScanRecord, WorkerResponse } from './types';

const LEGAL_URL = /(terms|privacy|eula|conditions|legal|tos|dpa|agreement)/i;
// Keep the request comfortably below the engine's 512 KiB cap; 120k UTF-16
// code units is at most ~480 KiB even for three-byte characters.
const MAX_CHARS = 120_000;

const worker = new Worker(chrome.runtime.getURL('worker.js'));

worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
  if (event.data.type === 'ANALYSIS_ERROR') {
    console.warn('[PoisonPill] analysis failed:', event.data.error);
    return;
  }

  const record: ScanRecord = {
    url: location.href,
    scanned_at: new Date().toISOString(),
    report: event.data.report,
  };
  void chrome.storage.local.set({ last_scan: record });
};

function looksLegal(): boolean {
  return (
    LEGAL_URL.test(location.href) ||
    document.querySelector('input[type="checkbox"]') !== null ||
    document.querySelectorAll('a[href*="terms"], a[href*="privacy"]').length > 0
  );
}

function scan(): void {
  if (!looksLegal()) return;

  const text = document.body?.innerText.slice(0, MAX_CHARS) ?? '';
  if (text.trim().length < 200) return;

  const request: AnalyzeRequest = { type: 'ANALYZE_TEXT', text };
  worker.postMessage(request);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scan, { once: true });
} else {
  scan();
}
