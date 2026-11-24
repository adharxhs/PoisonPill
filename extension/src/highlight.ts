import { readPageText } from './page-text';
import type { JumpToClauseRequest, JumpToClauseResponse } from './types';

const NAME = 'poisonpill-matched-clause';
const DURATION = 15_000;
const MAX_MAPPED_TEXT = 240_000;
let active: { style: CSSStyleSheet; document: Document; registry: HighlightRegistry } | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ');
}

interface TextPoint {
  node: Text;
  offset: number;
}

function textMap(element: HTMLElement): { text: string; points: TextPoint[] } {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const chars: string[] = [];
  const points: TextPoint[] = [];
  for (let child = walker.nextNode(); child; child = walker.nextNode()) {
    const node = child as Text;
    if (!node.parentElement?.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    for (let offset = 0; offset < node.length; offset += 1) {
      const char = node.data.charAt(offset);
      const normalized = /\s/.test(char) ? ' ' : char;
      if (normalized === ' ' && chars.at(-1) === ' ') continue;
      chars.push(normalized);
      points.push({ node, offset });
      if (chars.length >= MAX_MAPPED_TEXT) return { text: chars.join(''), points };
    }
  }
  return { text: chars.join(''), points };
}

function rangeAt(points: TextPoint[], start: number, end: number): Range | undefined {
  const first = points[start];
  const last = points[end - 1];
  if (!first || !last || start >= end) return;
  const range = first.node.ownerDocument.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

function smallestSection(body: HTMLElement, text: string): HTMLElement {
  let target = body;
  for (;;) {
    const child = Array.from(target.children).find(
      (node): node is HTMLElement => 'innerText' in node && typeof node.innerText === 'string' &&
        node.checkVisibility({ visibilityProperty: true }) && node.innerText.includes(text),
    );
    if (!child) return target;
    target = child;
  }
}

export function clearClauseHighlight(): void {
  clearTimeout(expiry);
  if (!active) return;
  const { registry, document: source, style } = active;
  registry.delete(NAME);
  source.adoptedStyleSheets = source.adoptedStyleSheets.filter((sheet) => sheet !== style);
  active = undefined;
}

export function highlightClause(request: JumpToClauseRequest): JumpToClauseResponse {
  clearClauseHighlight();
  const { text, url, start_offset, evidence } = request;
  if (location.href !== url || !text || text.length > 120_000) {
    return { status: 'error', message: 'Refresh the report for this page before locating the clause.' };
  }

  const sources = readPageText(document).documents.filter((source) => source.body?.innerText.includes(text));
  const source = sources[0];
  const body = source?.body;
  const view = source?.defaultView;
  const visibleText = body?.innerText ?? '';
  const visibleStart = visibleText.indexOf(text);
  if (!source || !body || !view || sources.length !== 1 ||
    visibleStart < 0 || visibleText.indexOf(text, visibleStart + 1) >= 0) {
    return { status: 'error', message: 'The exact clause is missing or appears more than once on this page.' };
  }

  const target = smallestSection(body, text);
  const mapped = textMap(target);
  const quote = collapse(text);
  const start = mapped.text.indexOf(quote);
  const clause = rangeAt(mapped.points, start, start + quote.length);
  if (!clause || start < 0 || mapped.text.indexOf(quote, start + 1) >= 0 || !clause.getClientRects().length) {
    return { status: 'error', message: 'The exact text could not be highlighted on this page.' };
  }

  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const matches: Range[] = [];
  for (const excerpt of evidence) {
    const from = excerpt.start_offset - start_offset;
    const to = excerpt.end_offset - start_offset;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || from >= to || to > bytes.length) continue;
    try {
      if (decoder.decode(bytes.subarray(from, to)) !== excerpt.text) continue;
      const low = collapse(decoder.decode(bytes.subarray(0, from))).length;
      const high = collapse(decoder.decode(bytes.subarray(0, to))).length;
      const range = rangeAt(mapped.points, start + low, start + high);
      if (range) matches.push(range);
    } catch {
      // Ignore evidence with offsets that are no longer valid UTF-8 boundaries.
    }
  }

  const ranges = matches.length ? matches : [clause];
  const style = new view.CSSStyleSheet();
  style.replaceSync(`::highlight(${NAME}) { background-color: #ffdf62; color: #16130a; }`);
  source.adoptedStyleSheets = [...source.adoptedStyleSheets, style];
  const registry = view.CSS.highlights;
  registry.set(NAME, new view.Highlight(...ranges));
  active = { style, document: source, registry };
  expiry = setTimeout(clearClauseHighlight, DURATION);

  const anchor = matches[0] ?? clause;
  anchor.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'instant' });
  const position = anchor.getBoundingClientRect();
  if (position.top < 0 || position.bottom > view.innerHeight) {
    view.scrollBy({ top: position.top - view.innerHeight / 2, behavior: 'instant' });
  }
  return { status: 'ok', highlighted: matches.length ? 'evidence' : 'clause' };
}
