// Extract visible text and send it to the extension worker. Detection runs in Rust.
import { isJumpToClauseRequest } from './types';
import type { AnalyzeRequest, JumpToClauseRequest, JumpToClauseResponse, PageScanResponse, ScanRecord, WorkerResponse } from './types';

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

async function scan(minimumLength: number, review = false): Promise<ScanRecord> {
  const visibleText = document.body?.innerText ?? '';
  let text = visibleText.slice(0, MAX_CHARS);
  // Avoid cutting a UTF-16 surrogate pair before passing text to Wasm.
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  if (text.trim().length < minimumLength) throw new Error('This page has too little visible text to scan.');

  const sequence = ++scanSequence;
  const url = location.href;
  const request: AnalyzeRequest = { type: 'ANALYZE_TEXT', text, input_truncated: text.length < visibleText.length, review };
  const response = await chrome.runtime.sendMessage<AnalyzeRequest, WorkerResponse>(request);
  if (response?.type !== 'ANALYSIS_RESULT') throw new Error('The local engine could not analyse this page.');
  if (sequence !== scanSequence || location.href !== url) {
    throw new Error('The page or scan changed. Refresh the report again.');
  }

  const record: ScanRecord = {
    url,
    scanned_at: new Date().toISOString(),
    comparison: response.comparison,
    review_candidates: response.review_candidates,
    report: {
      ...response.report,
      truncated: response.report.truncated || text.length < visibleText.length,
    },
  };
  await chrome.storage.local.set({ last_scan: record });
  return record;
}

function jumpToClause({ text, url }: JumpToClauseRequest): JumpToClauseResponse {
  if (location.href !== url || !text || text.length > MAX_CHARS) {
    return { status: 'error', message: 'Refresh the report for this page before locating the clause.' };
  }

  let target = document.body;
  const visibleText = target?.innerText ?? '';
  const start = visibleText.indexOf(text);
  if (!target || start < 0 || visibleText.indexOf(text, start + 1) >= 0) {
    return { status: 'error', message: 'The exact clause is missing or appears more than once on this page.' };
  }

  // Follow only rendered descendants that contain the complete evidence.
  // innerText accounts for line breaks and soft formatting in the same way
  // as the scanner. No markers or other nodes are inserted into the page.
  for (;;) {
    const child = Array.from(target.children).find(
      (node): node is HTMLElement => node instanceof HTMLElement &&
        node.checkVisibility({ visibilityProperty: true }) && node.innerText.includes(text),
    );
    if (!child) break;
    target = child;
  }
  if (target === document.body) {
    return { status: 'error', message: 'The clause could not be located within a rendered page section.' };
  }
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
  return { status: 'ok' };
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, respond: (response: PageScanResponse | JumpToClauseResponse) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (isJumpToClauseRequest(message)) {
      respond(jumpToClause(message));
      return false;
    }
    if (message !== 'REFRESH_PAGE_REPORT' && message !== 'REVIEW_PAGE_REPORT') return false;
    void scan(1, message === 'REVIEW_PAGE_REPORT').then(
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
