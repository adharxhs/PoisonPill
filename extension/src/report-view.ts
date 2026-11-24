import { gsap } from 'gsap';
import type { ClauseFinding } from './types';

/** Same colours, evenly spaced, as the gauge's `#risk` gradient in the report views. */
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
  label: 'Very high score',
  verdict: 'The scan found a combination of terms worth checking carefully.',
};

const BANDS: BandInfo[] = [
  { band: 'none', below: Number.EPSILON, label: 'No findings', verdict: 'The supported rules found no matching clauses in the scanned text.' },
  { band: 'low', below: 35, label: 'Lower score', verdict: 'The scan found wording worth checking.' },
  { band: 'moderate', below: 60, label: 'Moderate score', verdict: 'Review how the flagged terms could affect you.' },
  { band: 'high', below: 80, label: 'High score', verdict: 'Review the combined effect of the flagged terms.' },
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

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setText(id: string, text: string): void {
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

function renderFinding(finding: ClauseFinding, decorate?: (item: HTMLLIElement, finding: ClauseFinding) => void): HTMLLIElement {
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

  item.append(quote, meta);
  decorate?.(item, finding);
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

export function renderFindings(
  container: HTMLElement | null,
  findings: ClauseFinding[],
  decorate?: (item: HTMLLIElement, finding: ClauseFinding) => void,
): void {
  if (!container) return;
  const groups = new Map<string, ClauseFinding[]>();
  for (const finding of findings) {
    const list = groups.get(finding.rule_id) ?? [];
    list.push(finding);
    groups.set(finding.rule_id, list);
  }

  const sections = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([ruleId, list]) => {
      const rule = RULES[ruleId] ?? { title: list[0]?.label ?? ruleId, blurb: '' };
      const section = el('section', 'card group');

      const heading = el('h2');
      heading.append(el('span', undefined, rule.title), el('span', 'count', String(list.length)));
      section.append(heading);
      if (rule.blurb) section.append(el('p', 'blurb', rule.blurb));

      const ol = el('ol');
      for (const finding of list) ol.append(renderFinding(finding, decorate));
      section.append(ol);
      return section;
    });
  container.replaceChildren(...sections);
  container.querySelectorAll<HTMLElement>('blockquote.clamped').forEach(makeExpandable);
}

function formatIndex(index: number): string {
  return index.toLocaleString(undefined, { maximumFractionDigits: 2 });
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

export function resetScoreAnimation(): void {
  gaugeMedia?.revert();
  gaugeMedia = undefined;
}

export function renderScore(index: number, scannedAt: string): void {
  resetScoreAnimation();
  const summary = document.getElementById('summary');
  const band = bandFor(index);
  summary?.setAttribute('data-band', band.band);
  setText('band', band.label);
  setText('verdict', band.verdict);

  const value = Math.max(0, Math.min(100, index));
  animateScore(value, index);
  summary?.querySelector('.gauge')?.setAttribute('aria-valuenow', String(value));

  const time = document.querySelector<HTMLTimeElement>('#scanned-at');
  if (time) {
    time.textContent = relativeTime(scannedAt);
    time.dateTime = scannedAt;
    time.title = new Date(scannedAt).toLocaleString();
  }
}
