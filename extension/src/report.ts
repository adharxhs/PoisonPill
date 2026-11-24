import { jsPDF } from 'jspdf';

import type { ClauseFinding, ScanRecord } from './types';

const ARBITRATION_GUIDANCE =
  'Save the agreement and the version you accepted. Check whether the clause covers your dispute, whether it names a forum or gives you a small-claims option, and whether any opt-out window is still open. A written opt-out is practical if the terms provide a method and your deadline has not passed. For an existing dispute, verify filing fees, eligibility and deadlines with the named forum or a qualified local adviser.';

const RULE_GUIDANCE: Record<string, string> = {
  'forced_arbitration.class_action_waiver': 'Check whether this waiver covers your type of claim and whether an individual claim is practical for the amount at stake.',
  'forced_arbitration.class_action_bar': 'Identify where individual claims can be filed and whether filing fees and time are proportionate to the likely remedy.',
  'forced_arbitration.jury_trial_waiver': 'Check whether the agreement separately restricts access to court. If a court claim is available, ask about proceeding without a jury and how the waiver applies locally.',
  'forced_arbitration.court_access_waiver': 'Identify what forum the agreement specifies and whether a small-claims or other exception is stated.',
};

const GUIDANCE: Record<string, string> = {
  forced_arbitration: ARBITRATION_GUIDANCE,
  intellectual_property:
    'Check which submissions are covered and whether rights survive account closure. Before uploading, use material you can license and ask for a narrower license if the content has commercial value. For existing use, preserve examples and verify your ownership and the licence terms before seeking removal.',
  indemnification:
    'Check what triggers the obligation, who controls the defence, and what costs are covered. If a demand arrives, preserve the notice and promptly check response deadlines and applicable insurance. Professional review is most useful when an actual claim or substantial legal cost is involved.',
  surveillance:
    'Check the data categories, recipients, privacy settings and available disclosures. Use the provider’s published objection or opt-out method where applicable and save confirmation. A privacy complaint depends on your jurisdiction, the data involved and the provider’s response.',
  liability_caps:
    'Compare the stated cap with the loss and check for exceptions elsewhere in the agreement. Keep receipts and evidence of the loss. A written refund request is usually simpler to pursue than a formal claim, which requires checking whether the cap applies to your circumstances.',
  termination_asymmetry:
    'Save the terms, notices and account history. If access was removed, check for an appeal or cure process and ask for reinstatement, data export or a refund where appropriate. Feasibility depends on the termination reason, available records and contractual or local rights.',
  unilateral_modification:
    'Save both versions of the terms and any notice you received. If a change led to a charge or loss of service, ask the provider in writing to reverse the change or explain the cancellation options. This is usually a low-effort first step if you have dates and records. For a formal complaint, verify that the complaint body covers the service and jurisdiction and that any filing deadline is still open.',
};

function safeSource(url: string): string {
  try {
    const source = new URL(url);
    return source.origin === 'null' ? source.protocol : source.origin + source.pathname;
  } catch {
    return 'Source unavailable';
  }
}

export function buildPdf(
  record: ScanRecord,
  describe: (finding: ClauseFinding) => string | undefined,
): jsPDF {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  pdf.setProperties({ title: 'PoisonPill contract scan', creator: 'PoisonPill' });
  const margin = 46;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  const limit = pdf.internal.pageSize.getHeight() - margin - 16;
  let y = margin;

  function room(height: number): void {
    if (y + height <= limit) return;
    pdf.addPage();
    y = margin;
  }

  function unicodeParagraph(text: string, size: number, bold: boolean): boolean {
    if (/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text) || typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const scale = 2;
    const lineHeight = size * 1.45;
    const font = `${bold ? 'bold' : 'normal'} ${size}px sans-serif`;
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(lineHeight * scale);
    ctx.scale(scale, scale);
    ctx.font = font;
    ctx.textBaseline = 'top';
    const write = (line: string) => {
      room(lineHeight);
      ctx.clearRect(0, 0, width, lineHeight);
      ctx.fillStyle = '#182536';
      ctx.fillText(line, 0, 1);
      pdf.addImage(canvas, 'PNG', margin, y, width, lineHeight, undefined, 'FAST');
      y += lineHeight;
    };
    for (const paragraph of text.split(/\r\n|\r|\n/)) {
      let line = '';
      for (const part of paragraph.split(/(\s+)/)) {
        if (line && ctx.measureText(line + part).width > width) {
          write(line);
          line = '';
        }
        if (ctx.measureText(part).width <= width) {
          line += part;
          continue;
        }
        for (const char of part) {
          if (ctx.measureText(line + char).width > width) {
            write(line);
            line = '';
          }
          line += char;
        }
      }
      if (line) write(line);
    }
    y += 6;
    return true;
  }

  function paragraph(text: string, size = 10, bold = false): void {
    if (unicodeParagraph(text, size, bold)) return;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(bold ? 15 : 24, bold ? 61 : 37, bold ? 84 : 54);
    const lineHeight = size * 1.4;
    for (const line of pdf.splitTextToSize(text, width) as string[]) {
      room(lineHeight);
      pdf.text(line, margin, y, { baseline: 'top' });
      y += lineHeight;
    }
    y += 6;
  }

  const { report } = record;
  paragraph('PoisonPill contract scan', 24, true);
  paragraph(`Source: ${safeSource(record.url)}\nScanned: ${record.scanned_at}`);
  paragraph(`Poison Index: ${report.poison_index}/100   |   Findings: ${report.findings.length}`, 13, true);
  paragraph(report.truncated
    ? 'Coverage: partial. The scan reached the input limit and analysed only the first part of the visible text.'
    : 'Coverage: visible text extracted from the page at scan time. Linked documents, PDF viewers and embedded frames may be outside the scan.');
  paragraph('This report flags contractual wording for review. Whether a term applies or can be challenged depends on the agreement you accepted, the facts, the jurisdiction and applicable deadlines.');
  if (report.findings.length === 0) paragraph('The supported rules produced no findings in the scanned text.');

  for (const [index, finding] of report.findings.entries()) {
    room(72);
    y += 10;
    paragraph(`${index + 1}. ${finding.label}`, 15, true);
    paragraph(`Rule: ${finding.rule_id} | Severity: ${finding.severity}/5 | Modality: ${finding.modality}\nSource bytes: ${finding.start_offset} to ${finding.end_offset} (end exclusive) | Exception analysis: ${finding.inversion.replaceAll('_', ' ')}`);
    paragraph('Clause text', 11, true);
    paragraph(finding.raw_text);
    paragraph('Why it was flagged', 11, true);
    paragraph(finding.reason);
    const description = describe(finding);
    if (description) paragraph(description);
    if (finding.evidence?.length) {
      const excerpts = [...new Set(finding.evidence.map(({ text }) => text))];
      paragraph(`Matched source wording: ${excerpts.join(' | ')}`);
    }
    if (finding.opt_out_available) {
      paragraph('Opt-out wording detected', 11, true);
      if (finding.opt_out_source) {
        const source = finding.opt_out_source;
        paragraph(`Source bytes: ${source.start_offset} to ${source.end_offset}\n${source.text}`);
      } else {
        paragraph('Refresh the page report to capture the source wording.');
      }
      if (finding.opt_out_target) paragraph(`Address in the terms: ${finding.opt_out_target}`);
      paragraph('Confirm the deadline trigger, required delivery method and address in the version you accepted. Keep proof of delivery.');
    } else if (finding.category === 'forced_arbitration') {
      paragraph('The scan found no associated opt-out window. Check the surrounding dispute section.');
    }
    paragraph('Options and practical feasibility', 11, true);
    const specific = RULE_GUIDANCE[finding.rule_id];
    if (specific) paragraph(specific);
    paragraph(GUIDANCE[finding.category] ??
      'Save the relevant terms and communications. Ask the provider to explain how the clause applies. If the issue caused a loss or a deadline may be approaching, verify your options with a qualified adviser in your jurisdiction.');
  }

  if (report.findings.length) {
    room(90);
    paragraph('If contacting the provider does not resolve the issue', 13, true);
    paragraph('Check a local consumer protection or legal aid service for eligibility. A complaint may help obtain a response. A formal claim requires checking the proper forum, any fees, deadlines, evidence and the remedy you are seeking.');
    paragraph('Examples of official complaint resources, where eligible:\nIndia consumer grievances: https://consumerhelpline.gov.in/public/\nU.S. financial products or services: https://www.consumerfinance.gov/complaint/');
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(96, 106, 122);
    pdf.text(`PoisonPill  |  ${page} / ${pages}`, margin, limit + 24);
  }
  return pdf;
}
