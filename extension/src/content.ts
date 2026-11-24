// Extract visible text and send it to the extension worker. Detection runs in Rust.
import { clearClauseHighlight, highlightClause } from './highlight';
import { readPageText, type PageText } from './page-text';
import { isJumpToClauseRequest } from './types';
import type { AnalyzeRequest, JumpToClauseResponse, PageScanResponse, ScanRecord, WorkerResponse } from './types';

const LEGAL_PATH = /^(?:terms(?:[-_]of[-_](?:service|use)|[-_]and[-_]conditions)?|termsandconditions|tos|privacy(?:[-_](?:policy|notice|statement))?|cookie[-_]policy|eula|dpa|user[-_]agreement|license[-_]agreement|data[-_]processing[-_]agreement)(?:\.html?)?$/i;
const LEGAL_HEADING = /^(?:terms(?: of (?:service|use)| and conditions)?|privacy (?:policy|notice|statement)|cookie policy|end[- ]user licen[cs]e agreement|user agreement|data processing agreement)$/i;
const RESCAN_DELAY_MS = 700;
let scanSequence = 0;
let scanInFlight = false;
let rescanTimer: ReturnType<typeof setTimeout> | undefined;
let lastScan: { url: string; text: string; truncated: boolean } | undefined;
const observedDocuments = new WeakSet<Document>();

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

const observer = new MutationObserver(scheduleRescan);

function observeDocuments(documents: Document[]): void {
  for (const current of documents) {
    if (observedDocuments.has(current) || !current.documentElement) continue;
    observedDocuments.add(current);
    observer.observe(current.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'src', 'srcdoc'],
    });
    current.addEventListener('load', (event) => {
      const tag = (event.target as Element | null)?.tagName;
      if (tag === 'IFRAME' || tag === 'OBJECT') scheduleRescan();
    }, true);
  }
}

function scheduleRescan(): void {
  if (document.visibilityState !== 'visible' || rescanTimer !== undefined) return;
  rescanTimer = setTimeout(() => {
    rescanTimer = undefined;
    if (document.visibilityState !== 'visible' || !looksLegal()) return;
    if (scanInFlight) {
      scheduleRescan();
      return;
    }
    const snapshot = readPageText(document);
    observeDocuments(snapshot.documents);
    if (!snapshot.text.trim() || (
      lastScan?.url === location.href &&
      lastScan.text === snapshot.text &&
      lastScan.truncated === snapshot.truncated
    )) return;
    void scan(false, snapshot).catch(() => undefined);
  }, RESCAN_DELAY_MS);
}

async function scan(
  review = false,
  snapshot = readPageText(document),
  openPopupOnLoad = false,
): Promise<ScanRecord> {
  const { text, truncated } = snapshot;
  if (!text.trim()) throw new Error('This page has no visible text to scan.');
  if (looksLegal()) observeDocuments(snapshot.documents);

  const sequence = ++scanSequence;
  const url = location.href;
  scanInFlight = true;
  try {
    const request: AnalyzeRequest = {
      type: 'ANALYZE_TEXT', text, input_truncated: truncated, review,
      open_popup_on_load: openPopupOnLoad,
    };
    const response = await chrome.runtime.sendMessage<AnalyzeRequest, WorkerResponse>(request);
    if (response?.type !== 'ANALYSIS_RESULT') throw new Error('The local engine could not analyse this page.');
    if (sequence !== scanSequence || location.href !== url) {
      throw new Error('The page or scan changed. Refresh the report again.');
    }
    if (!response.record) throw new Error('The background worker did not return a page report.');
    lastScan = { url, text, truncated };
    return response.record;
  } finally {
    if (sequence === scanSequence) scanInFlight = false;
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, respond: (response: PageScanResponse | JumpToClauseResponse | boolean) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (message === 'CAN_OPEN_LOADED_REPORT') {
      respond(document.visibilityState === 'visible' && looksLegal());
      return false;
    }
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

// The inexpensive observer also notices when a single-page app changes an
// ordinary view into a legal page. Only eligible pages are extracted.
observeDocuments([document]);
window.addEventListener('popstate', scheduleRescan);
window.addEventListener('hashchange', scheduleRescan);
if ('navigation' in window && window.navigation instanceof EventTarget) {
  window.navigation.addEventListener('navigatesuccess', scheduleRescan);
}

if (document.visibilityState === 'visible' && looksLegal()) {
  void scan(false, readPageText(document), true).catch(() => {
    // A manual refresh is available when automatic scanning skips the page.
  });
}
