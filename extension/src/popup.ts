import { generateOptOutMail } from './optout';
import type { ClauseFinding, ScanRecord } from './types';

const list = document.getElementById('findings') as HTMLUListElement | null;
const indexEl = document.getElementById('poison-index') as HTMLElement | null;
const emptyEl = document.getElementById('empty') as HTMLElement | null;

function severityColor(severity: number): string {
  if (severity >= 4.5) return '#dc2626';
  if (severity >= 3.5) return '#d97706';
  return '#ca8a04';
}

async function load(): Promise<void> {
  const { last_scan: record } = (await chrome.storage.local.get('last_scan')) as {
    last_scan?: ScanRecord;
  };

  if (!record || record.findings.length === 0) {
    emptyEl?.removeAttribute('hidden');
    list?.setAttribute('hidden', '');
    return;
  }

  emptyEl?.setAttribute('hidden', '');
  if (indexEl) {
    indexEl.textContent = record.poison_index.toFixed(1);
    indexEl.style.color = severityColor(record.poison_index / 20);
  }

  list?.removeAttribute('hidden');
  record.findings.forEach((finding) => list?.appendChild(renderFinding(finding)));
}

function renderFinding(finding: ClauseFinding): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'finding';

  const header = document.createElement('div');
  header.className = 'finding-header';

  const label = document.createElement('span');
  label.className = 'category';
  label.textContent = finding.category;
  label.style.color = severityColor(finding.severity);

  const score = document.createElement('span');
  score.className = 'score';
  score.textContent = `${finding.severity.toFixed(1)}/5.0`;

  header.append(label, score);

  const quote = document.createElement('blockquote');
  quote.textContent = finding.raw_text;

  const actions = document.createElement('div');
  actions.className = 'actions';

  const jump = document.createElement('button');
  jump.type = 'button';
  jump.textContent = 'Jump to clause';
  jump.addEventListener('click', () => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id !== undefined) {
        void chrome.tabs.sendMessage(tab.id, { type: 'SCROLL_TO_CLAUSE' });
      }
    });
  });
  actions.appendChild(jump);

  if (finding.opt_out_available && finding.opt_out_target) {
    const optOut = document.createElement('a');
    optOut.className = 'optout';
    optOut.textContent = 'Generate opt-out mail';
    optOut.href = generateOptOutMail(finding.opt_out_target, document.title);
    actions.appendChild(optOut);
  }

  item.append(header, quote, actions);
  return item;
}

void load();
