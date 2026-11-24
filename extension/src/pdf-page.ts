import { getDocument, GlobalWorkerOptions, VerbosityLevel } from 'pdfjs-dist';
import { buildPdf, reportFilename } from './report';
import type { AnalyzeRequest, ScanRecord, WorkerResponse } from './types';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 200;
const MAX_TEXT = 120_000;
const TIMEOUT_MS = 20_000;
GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.mjs');

async function extract(file: File): Promise<{ text: string; truncated: boolean }> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose a PDF that is 20 MB or smaller.');
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // Text-only scans can succeed with recoverable font-rendering warnings.
    verbosity: VerbosityLevel.ERRORS,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    cMapUrl: chrome.runtime.getURL('pdf-cmaps/'),
    standardFontDataUrl: chrome.runtime.getURL('pdf-fonts/'),
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void task.destroy().catch(() => undefined);
  }, TIMEOUT_MS);
  try {
    const pdf = await task.promise;
    const end = Math.min(pdf.numPages, MAX_PAGES);
    let text = '';
    for (let number = 1; number <= end; number += 1) {
      if (number > 1) text += '\n\n';
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
        if (text.length > MAX_TEXT) {
          const prefix = text.slice(0, MAX_TEXT).replace(/[\uD800-\uDBFF]$/, '');
          return { text: prefix, truncated: true };
        }
      }
      page.cleanup();
    }
    return { text, truncated: pdf.numPages > end };
  } catch (error) {
    if (timedOut) throw new Error('Reading the PDF took too long.');
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new Error('Choose an unlocked copy of this password-protected PDF.');
    }
    throw new Error('This PDF could not be read.');
  } finally {
    clearTimeout(timer);
    await task.destroy().catch(() => undefined);
  }
}

const fileInput = document.querySelector<HTMLInputElement>('#file');
const status = document.querySelector('#status');
const result = document.querySelector<HTMLElement>('#result');
const summary = document.querySelector('#summary');
const list = document.querySelector('#findings');
const download = document.querySelector<HTMLButtonElement>('#download');
let record: ScanRecord | undefined;

if (fileInput && status && result && summary && list && download) {
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.disabled = true;
    result.hidden = true;
    status.textContent = 'Reading and scanning this PDF…';
    record = undefined;
    try {
      const { text, truncated } = await extract(file);
      if (!text.trim()) throw new Error('No selectable text was found. Try a PDF with a text layer.');
      const sourceName = file.name;
      const request: AnalyzeRequest = { type: 'ANALYZE_TEXT', text, input_truncated: truncated, local_pdf: true };
      const response = await chrome.runtime.sendMessage<AnalyzeRequest, WorkerResponse>(request);
      if (response?.type !== 'ANALYSIS_RESULT') throw new Error('The local engine could not scan this PDF.');
      record = {
        url: '',
        source_name: sourceName,
        scanned_at: new Date().toISOString(),
        report: response.report,
      };
      const findings = record.report.findings;
      summary.textContent = `${findings.length} ${findings.length === 1 ? 'term' : 'terms'} to review`;
      list.replaceChildren(...findings.map((finding) => {
        const row = document.createElement('li');
        const heading = document.createElement('strong');
        heading.textContent = finding.label;
        const quote = document.createElement('blockquote');
        quote.textContent = finding.raw_text;
        row.append(heading, quote);
        return row;
      }));
      status.textContent = record.report.truncated ? 'Scan complete. Only the first part of the PDF was scanned.' : 'Scan complete.';
      result.hidden = false;
    } catch (error: unknown) {
      status.textContent = error instanceof Error ? error.message : 'The PDF could not be scanned.';
    } finally {
      fileInput.value = '';
      fileInput.disabled = false;
    }
  });
  download.addEventListener('click', () => {
    if (!record) return;
    try {
      buildPdf(record).save(reportFilename(record));
    } catch {
      status.textContent = 'The PDF report could not be generated.';
    }
  });
}
