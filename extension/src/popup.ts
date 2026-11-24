// Popup: renders the last stored report in the extension's own document.
//
// No highlighting, jump-to-clause, mail generation or history. Those are product
// features layered on top of the contract in docs/CONTRACT.md. The bands below
// are display-only; the engine defines no thresholds for `poison_index`.

import { gsap } from 'gsap';
import { buildPdf } from './report';

import type { ClauseFinding, JumpToClauseRequest, JumpToClauseResponse, PageScanResponse, ScanRecord } from './types';

/** Same colours, evenly spaced, as the gauge's `#risk` gradient in popup.html. */
const RISK_STOPS = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#be123c'];

type Band = 'none' | 'low' | 'moderate' | 'high' | 'severe';

interface BandInfo {
  band: Band;
  below: number;
  label: string;
  verdict: string;
}

const SEVERE: BandInfo = {
  band: 'severe',
  below: Infinity,
  label: 'Severe risk',
  verdict: 'The scan found a high concentration of potentially restrictive terms.',
};

const BANDS: BandInfo[] = [
  { band: 'none', below: Number.EPSILON, label: 'No findings', verdict: 'The supported rules found no matching clauses in the scanned text.' },
  { band: 'low', below: 25, label: 'Low risk', verdict: 'A few clauses limit your legal options.' },
  { band: 'moderate', below: 50, label: 'Moderate risk', verdict: 'Some terms may materially affect your rights or obligations.' },
  { band: 'high', below: 75, label: 'High risk', verdict: 'Review the flagged terms and their potential impact.' },
  SEVERE,
];

/** Plain-language names for rule ids; unknown rules fall back to the engine label. */
const RULES: Record<string, { title: string; blurb: string }> = {
  'unilateral_modification.without_notice': {
    title: 'Changes without notice',
    blurb: 'The terms say the provider may amend the agreement without notifying you in advance.',
  },
  'intellectual_property.perpetual_commercial_license': {
    title: 'Perpetual commercial content license',
    blurb: 'The provider receives broad rights to commercially use or sublicense user content.',
  },
  'indemnification.provider_defense_costs': {
    title: 'Provider indemnity and legal fees',
    blurb: 'The terms place responsibility for claims and legal costs on the user.',
  },
  'surveillance.advertising_disclosure': {
    title: 'Data disclosure to advertisers',
    blurb: 'The terms allow disclosure of specified user data to advertising recipients.',
  },
  'liability_caps.provider_paid_fees': {
    title: 'Provider liability limited to fees paid',
    blurb: 'The terms may limit the amount the provider must pay for covered losses.',
  },
  'termination_asymmetry.immediate_provider_notice_for_user': {
    title: 'Unequal termination notice',
    blurb: 'The provider can terminate immediately while the user is required to give notice.',
  },
  'forced_arbitration.mandatory_arbitration': {
    title: 'Mandatory arbitration',
    blurb: 'The terms say covered disputes must go to arbitration.',
  },
  'forced_arbitration.class_action_waiver': {
    title: 'Class action waiver',
    blurb: 'The wording seeks to restrict participation in a group lawsuit.',
  },
  'forced_arbitration.class_action_bar': {
    title: 'Individual claims only',
    blurb: 'Claims may only be brought by you alone, not as a group.',
  },
  'forced_arbitration.jury_trial_waiver': {
    title: 'Jury trial waiver',
    blurb: 'The wording seeks to waive a jury trial.',
  },
  'forced_arbitration.court_access_waiver': {
    title: 'Court access waiver',
    blurb: 'The wording seeks to restrict bringing a claim in court.',
  },
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function show(id: string): void {
  document.getElementById(id)?.removeAttribute('hidden');
}

function setText(id: string, text: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

function bandFor(index: number): BandInfo {
  return BANDS.find((b) => index < b.below) ?? SEVERE;
}

function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
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
        await activeTabId(), { type: 'JUMP_TO_CLAUSE', url: record.url, text: finding.raw_text },
        { frameId: 0 },
      );
      if (result.status === 'error') throw new Error(result.message);
      status('Moved to the clause.');
    } catch (error: unknown) {
      status(error instanceof Error ? error.message : 'The clause could not be located.');
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function renderFinding(finding: ClauseFinding): HTMLLIElement {
  const item = el('li', 'finding');

  // Clamped to four lines; made expandable only if it actually overflows
  // (see makeExpandable, which runs once the quote is laid out).
  const quote = el('blockquote', 'clamped', finding.raw_text);

  const meta = el('div', 'meta');
  if (finding.opt_out_available) {
    meta.append(
      el(
        'span',
        'badge optout',
        finding.opt_out_target ? `Opt-out: ${finding.opt_out_target}` : 'Opt-out available',
      ),
    );
  } else {
    meta.append(el('span', 'badge', 'No opt-out stated'));
  }

  const why = el('details');
  why.append(el('summary', undefined, 'Why flagged'), el('p', undefined, finding.reason));
  if (finding.opt_out_source && finding.opt_out_source.text !== finding.raw_text) {
    why.append(el('p', undefined, 'Related opt-out wording'), el('p', undefined, finding.opt_out_source.text));
  }
  meta.append(why);

  item.append(quote, meta, jumpButton(finding));
  if (finding.category === 'forced_arbitration' && finding.opt_out_source) {
    item.append(optOutDraft(finding));
  }
  return item;
}

/** Turn a clamped quote into a toggle, or unclamp it if it already fits. */
function makeExpandable(quote: HTMLElement): void {
  if (quote.scrollHeight <= quote.clientHeight + 1) {
    quote.classList.remove('clamped');
    return;
  }
  quote.setAttribute('role', 'button');
  quote.tabIndex = 0;
  quote.setAttribute('aria-expanded', 'false');
  quote.title = 'Show full clause';
  const toggle = () => {
    const expanded = quote.classList.toggle('clamped') === false;
    quote.setAttribute('aria-expanded', String(expanded));
    quote.title = expanded ? 'Show less' : 'Show full clause';
  };
  quote.addEventListener('click', toggle);
  quote.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  });
}

function renderGroups(findings: ClauseFinding[]): HTMLElement[] {
  const groups = new Map<string, ClauseFinding[]>();
  for (const finding of findings) {
    const list = groups.get(finding.rule_id) ?? [];
    list.push(finding);
    groups.set(finding.rule_id, list);
  }

  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([ruleId, list]) => {
      const rule = RULES[ruleId] ?? { title: list[0]?.label ?? ruleId, blurb: '' };
      const section = el('section', 'card group');

      const heading = el('h2');
      heading.append(el('span', undefined, rule.title), el('span', 'count', String(list.length)));
      section.append(heading);
      if (rule.blurb) section.append(el('p', 'blurb', rule.blurb));

      const ol = el('ol');
      for (const finding of list) ol.append(renderFinding(finding));
      section.append(ol);
      return section;
    });
}

function formatIndex(index: number): string {
  return index.toFixed(index % 1 ? 1 : 0);
}

/**
 * Score-card entrance: the arc fills, the knob rides its end (taking the
 * gradient's colour at that point) and the number counts up, all together;
 * the risk pill and verdict follow as the sweep settles. Reduced motion jumps
 * straight to the end state.
 */
let gaugeMedia: ReturnType<typeof gsap.matchMedia> | undefined;

function animateScore(value: number, index: number): void {
  const fill = document.getElementById('gauge-fill');
  const knob = document.getElementById('gauge-knob');
  const readout = document.getElementById('poison-index');
  const reveal = ['#band', '#verdict'].flatMap((sel) => document.querySelector(sel) ?? []);
  if (!fill || !knob || !readout) return;

  const colourAt = gsap.utils.interpolate(RISK_STOPS);
  const gauge = { value: 0 };
  const render = () => {
    fill.style.strokeDasharray = `${gauge.value} 100`;
    knob.style.stroke = colourAt(gauge.value / 100);
    readout.textContent = String(Math.round(gauge.value));
  };

  gsap.set(fill, { autoAlpha: value > 0 ? 1 : 0 });
  render(); // paint the zero state now, so the placeholder never shows
  gsap.set(knob, { rotation: 0, svgOrigin: '110 110' });

  // matchMedia only runs the handler when a condition matches, so list both.
  gaugeMedia = gsap.matchMedia();
  gaugeMedia.add(
    {
      motion: '(prefers-reduced-motion: no-preference)',
      reduce: '(prefers-reduced-motion: reduce)',
    },
    (context) => {
      const tl = gsap.timeline({
        defaults: { duration: 0.6, ease: 'power3.out' },
        onComplete: () => {
          readout.textContent = formatIndex(index);
        },
      });

      tl.addLabel('sweep', 0)
        .to(gauge, { value, onUpdate: render }, 'sweep')
        .to(knob, { rotation: value * 1.8, svgOrigin: '110 110' }, 'sweep')
        .from(reveal, { autoAlpha: 0, y: 6, duration: 0.3, stagger: 0.06 }, 'sweep+=0.25');

      if (context.conditions?.reduce) tl.progress(1);
    },
  );
}

let currentRecord: ScanRecord | undefined;
let refreshed = false;
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh');
const downloadButton = document.querySelector<HTMLButtonElement>('#download');

function status(message: string): void {
  const element = document.getElementById('action-status');
  if (element) {
    element.textContent = message;
    element.hidden = !message;
  }
}

function renderRecord(record?: ScanRecord): void {
  gaugeMedia?.revert();
  gaugeMedia = undefined;
  currentRecord = record;
  if (downloadButton) downloadButton.disabled = !record;
  for (const id of ['none', 'summary', 'empty', 'truncated', 'comparison']) {
    document.getElementById(id)?.setAttribute('hidden', '');
  }
  const container = document.getElementById('report');
  container?.replaceChildren();
  if (!record) {
    show('none');
    return;
  }

  const { report } = record;
  const band = bandFor(report.poison_index);
  const summary = document.getElementById('summary');
  summary?.setAttribute('data-band', band.band);

  setText('band', band.label);
  setText('verdict', band.verdict);

  const value = Math.max(0, Math.min(100, report.poison_index));
  animateScore(value, report.poison_index);
  summary?.querySelector('.gauge')?.setAttribute('aria-valuenow', String(value));

  const host = document.getElementById('source-host');
  if (host) {
    host.textContent = hostOf(record.url);
    host.title = record.url;
  }
  const time = document.querySelector<HTMLTimeElement>('#scanned-at');
  if (time) {
    time.textContent = relativeTime(record.scanned_at);
    time.dateTime = record.scanned_at;
    time.title = new Date(record.scanned_at).toLocaleString();
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

  container?.append(...renderGroups(report.findings));
  container?.querySelectorAll<HTMLElement>('blockquote.clamped').forEach(makeExpandable);
}

refreshButton?.addEventListener('click', async () => {
  refreshButton.disabled = true;
  if (downloadButton) downloadButton.disabled = true;
  status('Scanning the current page…');
  try {
    const result = await chrome.tabs.sendMessage<string, PageScanResponse>(
      await activeTabId(), 'REFRESH_PAGE_REPORT', { frameId: 0 },
    ).catch(() => {
      throw new Error('This page cannot receive a scan. Reopen it if the extension was just updated.');
    });
    if (result.status === 'error') throw new Error(result.message);
    refreshed = true;
    renderRecord(result.record);
    status('Report refreshed.');
  } catch (error: unknown) {
    status(error instanceof Error ? error.message : 'The report could not be refreshed.');
  } finally {
    refreshButton.disabled = false;
    if (downloadButton) downloadButton.disabled = !currentRecord;
  }
});

downloadButton?.addEventListener('click', () => {
  if (!currentRecord) return;
  try {
    const pdf = buildPdf(currentRecord, (finding) => RULES[finding.rule_id]?.blurb);
    const day = currentRecord.scanned_at.slice(0, 10);
    pdf.save(`poisonpill-report-${day}.pdf`);
    status('PDF download started.');
  } catch {
    status('The PDF could not be generated. Refresh the report and try again.');
  }
});

void chrome.storage.local.get('last_scan').then(({ last_scan }) => {
  if (!refreshed && !refreshButton?.disabled) renderRecord(last_scan as ScanRecord | undefined);
}).catch(() => status('The last report could not be loaded.'));
