import type { AnalyzeRequest, ClauseFinding, ScanRecord, WorkerResponse } from './types';

const LEGAL_URL = /(terms|privacy|eula|conditions|legal|tos|dpa|agreement)/i;
const MAX_CHARS = 250_000;
const MUTATION_DEBOUNCE_MS = 1_500;

const worker = new Worker(chrome.runtime.getURL('worker.js'));
let pending = false;
let lastSignature = '';

worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
  pending = false;
  if (event.data.type === 'ANALYSIS_ERROR') {
    console.warn('[PoisonPill] analysis failed:', event.data.error);
    return;
  }

  const { findings, poison_index } = event.data.report;
  if (findings.length === 0) return;

  const record: ScanRecord = {
    url: location.href,
    scanned_at: new Date().toISOString(),
    poison_index,
    findings,
  };
  void chrome.storage.local.set({ last_scan: record });

  injectCheckboxShield(findings);
  highlightClauses(findings);
};

function looksLegal(): boolean {
  return (
    LEGAL_URL.test(location.href) ||
    document.querySelector('input[type="checkbox"]') !== null ||
    document.querySelectorAll('a[href*="terms"], a[href*="privacy"]').length > 0
  );
}

function scan(): void {
  if (pending || !looksLegal()) return;

  const text = document.body?.innerText?.slice(0, MAX_CHARS) ?? '';
  if (text.length < 200) return;

  // Cheap guard against re-analysing the same DOM on every mutation burst.
  const signature = `${text.length}:${text.slice(0, 96)}:${text.slice(-96)}`;
  if (signature === lastSignature) return;
  lastSignature = signature;

  pending = true;
  const request: AnalyzeRequest = { type: 'ANALYZE_TEXT', text };
  worker.postMessage(request);
}

function injectCheckboxShield(findings: ClauseFinding[]): void {
  const maxSeverity = Math.max(...findings.map((f) => f.severity));
  const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

  checkboxes.forEach((checkbox) => {
    const parent = checkbox.parentElement;
    if (!parent || parent.querySelector('.poison-pill-shield')) return;

    const badge = document.createElement('span');
    badge.className = 'poison-pill-shield';
    badge.style.cssText = `
      display: inline-flex;
      align-items: center;
      margin-left: 8px;
      padding: 2px 6px;
      font-size: 11px;
      font-weight: bold;
      border-radius: 4px;
      color: #fff;
      cursor: pointer;
      background-color: ${maxSeverity >= 4.5 ? '#dc2626' : '#d97706'};
    `;
    badge.textContent = `\u26a0 Poison Pill Detected (${findings.length})`;
    badge.title = 'Click the PoisonPill icon to inspect predatory terms.';
    parent.appendChild(badge);
  });
}

function highlightClauses(findings: ClauseFinding[]): void {
  // Only annotate the highest-severity clause per category to avoid repainting
  // an entire contract page.
  const seen = new Set<string>();
  for (const finding of findings) {
    if (seen.has(finding.category)) continue;
    seen.add(finding.category);
    markFirstMatch(finding.raw_text);
  }
}

function markFirstMatch(rawText: string): void {
  const needle = rawText.trim().slice(0, 120);
  if (needle.length < 24) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.includes(needle)) return NodeFilter.FILTER_SKIP;
      const tag = node.parentElement?.tagName;
      return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK'
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  const node = walker.nextNode();
  if (!node?.nodeValue) return;

  const index = node.nodeValue.indexOf(needle);
  if (index < 0) return;

  const range = document.createRange();
  range.setStart(node, index);
  range.setEnd(node, index + needle.length);

  const mark = document.createElement('mark');
  mark.className = 'poison-pill-hit';
  mark.style.cssText = 'background:#fee2e2;color:#7f1d1d;outline:1px solid #dc2626;';
  try {
    range.surroundContents(mark);
  } catch {
    // Clause spans multiple elements; leave it unmarked rather than destroying DOM.
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type !== 'SCROLL_TO_CLAUSE') return;
  document.querySelector('.poison-pill-hit')?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
});

let observerTimer = 0;

const observer = new MutationObserver(() => {
  window.clearTimeout(observerTimer);
  observerTimer = window.setTimeout(scan, MUTATION_DEBOUNCE_MS);
});

window.addEventListener('load', () => {
  scan();
  observer.observe(document.body, { childList: true, subtree: true });
});
