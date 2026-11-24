// Extract visible text and send it to the extension worker. Detection runs in Rust.
import type { AnalyzeRequest, PageScanResponse, ScanRecord, WorkerResponse } from './types';

const LEGAL_URL = /(terms|privacy|eula|conditions|legal|tos|dpa|agreement)/i;
const MAX_CHARS = 120_000;
let scanSequence = 0;

function looksLegal(): boolean {
  return (
    LEGAL_URL.test(location.href) ||
    document.querySelector('input[type="checkbox"]') !== null ||
    document.querySelector('a[href*="terms"], a[href*="privacy"]') !== null
  );
}

async function scan(minimumLength: number): Promise<ScanRecord> {
  const visibleText = document.body?.innerText ?? '';
  let text = visibleText.slice(0, MAX_CHARS);
  // Avoid cutting a UTF-16 surrogate pair before passing text to Wasm.
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  if (text.trim().length < minimumLength) throw new Error('This page has too little visible text to scan.');

  const sequence = ++scanSequence;
  const url = location.href;
  const request: AnalyzeRequest = { type: 'ANALYZE_TEXT', text };
  const response = await chrome.runtime.sendMessage<AnalyzeRequest, WorkerResponse>(request);
  if (response?.type !== 'ANALYSIS_RESULT') throw new Error('The local engine could not analyse this page.');
  if (sequence !== scanSequence || location.href !== url) {
    throw new Error('The page or scan changed. Refresh the report again.');
  }

  const record: ScanRecord = {
    url,
    scanned_at: new Date().toISOString(),
    report: {
      ...response.report,
      truncated: response.report.truncated || text.length < visibleText.length,
    },
  };
  await chrome.storage.local.set({ last_scan: record });
  return record;
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, respond: (response: PageScanResponse) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message !== 'REFRESH_PAGE_REPORT') {
      return false;
    }
    void scan(1).then(
      (record) => respond({ status: 'ok', record }),
      (error: unknown) => respond({
        status: 'error',
        message: error instanceof Error ? error.message : 'The page could not be scanned.',
      }),
    );
    return true;
  },
);

if (looksLegal()) {
  void scan(200).catch(() => {
    // A manual refresh is available when automatic scanning skips the page.
  });
}
