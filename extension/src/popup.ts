// Popup actions and active-tab report state.
import { buildPdf, reportFilename } from './report';
import { el, renderFindings, renderScore, resetScoreAnimation, setText } from './report-view';

import { CURRENT_SCHEMA_VERSION } from './types';
import type { ClauseFinding, JumpToClauseRequest, JumpToClauseResponse, PageScanResponse, ScanRecord } from './types';

function show(id: string): void {
  document.getElementById(id)?.removeAttribute('hidden');
}

function hostOf(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    return hostname.replace(/^www\./, '') + (pathname === '/' ? '' : pathname);
  } catch {
    return url;
  }
}

function optOutDraft(finding: ClauseFinding): HTMLDetailsElement {
  const draft = el('details', 'draft');
  const text = el('textarea');
  text.setAttribute('aria-label', 'Editable arbitration opt-out draft');
  text.rows = 8;
  text.value = [
    finding.opt_out_target ? `To: ${finding.opt_out_target}` : 'To: [recipient specified in the agreement]',
    'Subject: Arbitration opt-out notice',
    '',
    'To whom it may concern,',
    '',
    'I am exercising the arbitration opt-out described in [agreement name and version].',
    'Account reference: [reference required by the agreement]',
    'Name: [full name]',
    'Date accepted: [date, if required]',
    '',
    'Please confirm receipt of this notice.',
  ].join('\n');
  const copy = el('button', undefined, 'Copy draft');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text.value);
      status('Opt-out draft copied.');
    } catch {
      text.focus();
      text.select();
      status('Copy the selected draft using your browser’s copy command.');
    }
  });
  draft.append(
    el('summary', undefined, 'Prepare an opt-out draft'),
    el('p', undefined, 'Check the deadline, delivery method, recipient and required details against the version you accepted before sending.'),
    text,
    copy,
  );
  return draft;
}

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('There is no active page.');
  return tab.id;
}

function jumpButton(finding: ClauseFinding): HTMLButtonElement {
  const button = el('button', 'jump', 'Jump to clause');
  button.type = 'button';
  button.addEventListener('click', async () => {
    const record = currentRecord;
    if (!record) return;
    button.disabled = true;
    try {
      const result = await chrome.tabs.sendMessage<JumpToClauseRequest, JumpToClauseResponse>(
        await activeTabId(), {
          type: 'JUMP_TO_CLAUSE',
          url: record.url,
          text: finding.raw_text,
          start_offset: finding.start_offset,
          evidence: finding.evidence ?? [],
        },
        { frameId: 0 },
      );
      if (result.status === 'error') throw new Error(result.message);
      status(result.highlighted === 'evidence' ? 'Matched wording highlighted.' : 'Clause highlighted.');
    } catch (error: unknown) {
      status(error instanceof Error ? error.message : 'The clause could not be located.');
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

let currentRecord: ScanRecord | undefined;
let loadRevision = 0;
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh');
const reviewButton = document.querySelector<HTMLButtonElement>('#review');
const downloadButton = document.querySelector<HTMLButtonElement>('#download');

function status(message: string): void {
  const element = document.getElementById('action-status');
  if (element) {
    element.textContent = message;
    element.hidden = !message;
  }
}

const REVIEW_LABELS: Record<string, string> = {
  forced_arbitration: 'Dispute resolution or arbitration',
  unilateral_modification: 'Unilateral modification',
  liability_caps: 'Limits on liability',
  termination_asymmetry: 'Termination rights',
};

function renderCandidates(record?: ScanRecord): void {
  const section = document.getElementById('candidates');
  if (!section) return;
  section.replaceChildren();
  const candidates = record?.review_candidates;
  section.hidden = !candidates;
  if (!candidates) return;
  section.append(el('h2', undefined, 'Possible clauses for review'));
  section.append(el('p', 'blurb',
    'Up to 25 experimental suggestions are shown. Review the quoted text in context. These suggestions do not affect the Poison Index or the PDF findings.',
  ));
  if (!candidates.length) {
    section.append(el('p', undefined, 'The model suggested no additional clauses.'));
    return;
  }
  const list = el('ol');
  for (const candidate of candidates) {
    const item = el('li', 'finding');
    item.append(
      el('strong', undefined, REVIEW_LABELS[candidate.category] ?? candidate.category),
      el('blockquote', undefined, candidate.source.text),
    );
    list.append(item);
  }
  section.append(list);
}

function renderRecord(record?: ScanRecord): void {
  const stale = record && record.report.schema_version !== CURRENT_SCHEMA_VERSION;
  if (stale) record = undefined;
  currentRecord = record;
  renderCandidates(record);
  if (downloadButton) downloadButton.disabled = !record;
  for (const id of ['none', 'summary', 'empty', 'truncated', 'comparison']) {
    document.getElementById(id)?.setAttribute('hidden', '');
  }
  const container = document.getElementById('report');
  container?.replaceChildren();
  if (!record) {
    resetScoreAnimation();
    setText('empty-title', stale ? 'Report needs a refresh' : 'No report for this tab yet');
    setText('empty-instructions', stale
      ? 'Select Refresh report to calculate the updated score.'
      : 'PoisonPill scans likely legal pages automatically. Select Refresh report to check this page manually.');
    show('none');
    return;
  }

  const { report } = record;
  renderScore(report.poison_index, record.scanned_at);

  const host = document.getElementById('source-host');
  if (host) {
    host.textContent = hostOf(record.url);
    host.title = record.url;
  }
  show('summary');

  if (report.truncated) show('truncated');
  if (record.comparison) {
    const previous = record.comparison;
    const text = previous.visible_text_changed ? 'Visible text changed.' : 'Visible text matched.';
    setText('comparison', `${text} Compared with the previous complete scan: ${previous.findings_added} findings added, ${previous.findings_removed} removed.`);
    show('comparison');
  }

  if (report.findings.length === 0) {
    show('empty');
    return;
  }

  renderFindings(container ?? null, report.findings, (item, finding) => {
    item.append(jumpButton(finding));
    if (finding.category === 'forced_arbitration' && finding.opt_out_source) {
      item.append(optOutDraft(finding));
    }
  });
}

async function refreshReport(review = false): Promise<void> {
  loadRevision += 1;
  if (refreshButton) refreshButton.disabled = true;
  if (reviewButton) reviewButton.disabled = true;
  if (downloadButton) downloadButton.disabled = true;
  status(review ? 'Scanning for possible clauses…' : 'Scanning the current page…');
  try {
    const result = await chrome.tabs.sendMessage<string, PageScanResponse>(
      await activeTabId(), review ? 'REVIEW_PAGE_REPORT' : 'REFRESH_PAGE_REPORT', { frameId: 0 },
    ).catch(() => {
      throw new Error('This page cannot receive a scan. Reopen it if the extension was just updated.');
    });
    if (result.status === 'error') throw new Error(result.message);
    if (result.record.tab_id !== await activeTabId()) return;
    renderRecord(result.record);
    status(review ? 'Review scan complete.' : 'Report refreshed.');
  } catch (error: unknown) {
    status(error instanceof Error ? error.message : 'The report could not be refreshed.');
  } finally {
    if (refreshButton) refreshButton.disabled = false;
    if (reviewButton) reviewButton.disabled = false;
    if (downloadButton) downloadButton.disabled = !currentRecord;
  }
}

document.querySelector('#scan-pdf')?.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('pdf.html') }).catch(() => status('Could not open the PDF scanner.'));
});
refreshButton?.addEventListener('click', () => void refreshReport());
reviewButton?.addEventListener('click', () => void refreshReport(true));

downloadButton?.addEventListener('click', () => {
  if (!currentRecord) return;
  try {
    const pdf = buildPdf(currentRecord);
    pdf.save(reportFilename(currentRecord));
    status('PDF download started.');
  } catch {
    status('The PDF could not be generated. Refresh the report and try again.');
  }
});

async function loadActiveReport(): Promise<void> {
  const revision = ++loadRevision;
  try {
    const [tabId, stored] = await Promise.all([activeTabId(), chrome.storage.local.get('last_scan')]);
    if (revision !== loadRevision || refreshButton?.disabled) return;
    const record = stored.last_scan as ScanRecord | undefined;
    renderRecord(record?.tab_id === tabId ? record : undefined);
  } catch {
    status('The current tab report could not be loaded.');
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.last_scan && !refreshButton?.disabled) void loadActiveReport();
});
chrome.tabs.onActivated.addListener(() => {
  renderRecord();
  void loadActiveReport();
});
void loadActiveReport();
