import type { DocumentReport, ScanComparison } from './types';

const KEY = 'scan_fingerprints';
const MAX_PAGES = 24;
const MAX_FINDINGS = 250;
const encoder = new TextEncoder();

interface Snapshot {
  page: string;
  text: string;
  findings: string[];
  scannedAt: string;
}

let pending: Promise<unknown> = Promise.resolve();

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function difference(left: string[], right: string[]): number {
  const counts = new Map<string, number>();
  for (const value of right) counts.set(value, (counts.get(value) ?? 0) + 1);
  let difference = 0;
  for (const value of left) {
    const count = counts.get(value) ?? 0;
    if (count) counts.set(value, count - 1);
    else difference += 1;
  }
  return difference;
}

async function update(url: string, text: string, report: DocumentReport): Promise<ScanComparison | undefined> {
  const source = new URL(url);
  if (!['file:', 'http:', 'https:'].includes(source.protocol)) return;
  const [page, pageText, ...findings] = await Promise.all([
    digest(source.origin + source.pathname + (source.hash.startsWith('#/') ? source.hash : '')),
    digest(text),
    ...report.findings.map((finding) => digest(JSON.stringify([finding.rule_id, finding.raw_text]))),
  ]);
  const snapshot: Snapshot = { page, text: pageText, findings, scannedAt: new Date().toISOString() };
  const stored = await chrome.storage.local.get(KEY);
  const history = (stored[KEY] ?? []) as Snapshot[];
  const previous = history.find((scan) => scan.page === page);
  await chrome.storage.local.set({
    [KEY]: [snapshot, ...history.filter((scan) => scan.page !== page)].slice(0, MAX_PAGES),
  });
  if (!previous) return;
  return {
    previous_scanned_at: previous.scannedAt,
    visible_text_changed: previous.text !== pageText,
    findings_added: difference(findings, previous.findings),
    findings_removed: difference(previous.findings, findings),
  };
}

export function compareScan(
  url: string,
  text: string,
  report: DocumentReport,
): Promise<ScanComparison | undefined> {
  if (report.truncated || report.findings.length > MAX_FINDINGS) return Promise.resolve(undefined);
  // Serialize the read-modify-write so simultaneous tabs cannot drop baselines.
  const result = pending.then(() => update(url, text, report));
  pending = result.catch(() => undefined);
  return result;
}
