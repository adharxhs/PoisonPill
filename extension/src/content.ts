// Extract visible text and send it to the extension worker. Detection runs in Rust.
import { clearClauseHighlight, highlightClause } from './highlight';
import { isJumpToClauseRequest } from './types';
import type { AnalyzeRequest, JumpToClauseResponse, PageScanResponse, ScanRecord, WorkerResponse } from './types';

const LEGAL_PATH = /^(?:terms(?:[-_]of[-_](?:service|use)|[-_]and[-_]conditions)?|termsandconditions|tos|privacy(?:[-_](?:policy|notice|statement))?|cookie[-_]policy|eula|dpa|user[-_]agreement|license[-_]agreement|data[-_]processing[-_]agreement)(?:\.html?)?$/i;
const LEGAL_HEADING = /^(?:terms(?: of (?:service|use)| and conditions)?|privacy (?:policy|notice|statement)|cookie policy|end[- ]user licen[cs]e agreement|user agreement|data processing agreement)$/i;
const MAX_CHARS = 120_000;
let scanSequence = 0;

function looksLegal(): boolean {
  const segments = location.pathname.split('/').filter(Boolean);
  const leaf = segments.at(-1) ?? '';
  const documentPath = /^[a-z]{2}(?:[-_][a-z]{2})?$/i.test(leaf) ? segments.at(-2) ?? leaf : leaf;
  if (LEGAL_PATH.test(documentPath) || /^legal(?:\.html?)?$/i.test(documentPath)) return true;

  // Page-level labels identify the document. Footer links and consent controls
  // are common on pages that do not contain the terms themselves.
  return [document.title, document.querySelector('h1')?.innerText ?? '']
    .some((label) => label.split(/\s*[|:–—]\s*|\s+-\s+/).some((part) => LEGAL_HEADING.test(part.trim())));
}

async function scan(review = false): Promise<ScanRecord> {
  const visibleText = document.body?.innerText ?? '';
  let text = visibleText.slice(0, MAX_CHARS);
  // Avoid cutting a UTF-16 surrogate pair before passing text to Wasm.
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  if (!text.trim()) throw new Error('This page has no visible text to scan.');

  const sequence = ++scanSequence;
  const url = location.href;
  const request: AnalyzeRequest = { type: 'ANALYZE_TEXT', text, input_truncated: text.length < visibleText.length, review };
  const response = await chrome.runtime.sendMessage<AnalyzeRequest, WorkerResponse>(request);
  if (response?.type !== 'ANALYSIS_RESULT') throw new Error('The local engine could not analyse this page.');
  if (sequence !== scanSequence || location.href !== url) {
    throw new Error('The page or scan changed. Refresh the report again.');
  }

  if (!response.record) throw new Error('The background worker did not return a page report.');
  return response.record;
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, respond: (response: PageScanResponse | JumpToClauseResponse) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (isJumpToClauseRequest(message)) {
      respond(highlightClause(message));
      return false;
    }
    if (message !== 'REFRESH_PAGE_REPORT' && message !== 'REVIEW_PAGE_REPORT' && message !== 'AUTO_PAGE_REPORT') {
      return false;
    }
    const automatic = message === 'AUTO_PAGE_REPORT';
    if (automatic && !looksLegal()) {
      respond({ status: 'error', message: 'This page is outside automatic legal-page scanning.' });
      return false;
    }
    if (!automatic) clearClauseHighlight();
    void scan(message === 'REVIEW_PAGE_REPORT').then(
      (record) => respond({ status: 'ok', record }),
      (error: unknown) => respond({
        status: 'error',
        message: error instanceof Error ? error.message : 'The page could not be scanned.',
      }),
    );
    return true;
  },
);

if (document.visibilityState === 'visible' && looksLegal()) {
  void scan().catch(() => {
    // A manual refresh is available when automatic scanning skips the page.
  });
}
