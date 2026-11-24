import { jsPDF } from 'jspdf';

import type { ClauseFinding, ScanRecord } from './types';

interface FindingExplanation {
  title: string;
  meaning: string;
  nextStep: string;
}

const EXPLANATIONS: Record<string, FindingExplanation> = {
  'unilateral_modification.without_notice': {
    title: 'The company can change the terms without telling you',
    meaning: 'The company says it can change the agreement without warning you first. You might only learn about a change after it affects you.',
    nextStep: 'Save both versions of the terms and any message about the change. If you were charged more or lost access to something you paid for, ask the company in writing to explain or reverse the change. Include dates, receipts and the result you want.',
  },
  'intellectual_property.perpetual_commercial_license': {
    title: 'The company can use what you upload for business purposes',
    meaning: 'The company says it can use your work or let others use it without paying you. The wording may allow that use to continue after you close your account.',
    nextStep: 'Check what material the wording covers before uploading anything valuable. If your work is already being used and you want it removed, keep a copy of the terms and screenshots showing how the work was used.',
  },
  'indemnification.provider_defense_costs': {
    title: 'You may have to pay the company’s legal costs',
    meaning: 'The terms say you may have to cover the company’s legal bills if someone brings certain claims. Check which actions by you could trigger that responsibility.',
    nextStep: 'If the company asks you to pay, save the message and check the response deadline. Before agreeing to pay a substantial amount, check whether insurance covers it or seek local legal advice.',
  },
  'surveillance.advertising_disclosure': {
    title: 'Your information can be shared with advertisers',
    meaning: 'The company says it can give certain details about you or how you use the service to advertisers. The type of information and the reason for sharing it matter.',
    nextStep: 'Check your privacy settings and ask what is shared and with whom. If the company offers a way to stop the sharing, use the stated method and keep its confirmation.',
  },
  'liability_caps.provider_paid_fees': {
    title: 'The company may owe you only what you paid',
    meaning: 'If something goes wrong and the company is responsible, the terms say its payment may be limited to the fees you paid. That could be much less than your loss.',
    nextStep: 'Keep your receipts and evidence of what went wrong. Asking for a refund in writing is usually a simpler first step than starting a formal dispute. Check for exceptions in the agreement if the loss is greater than the fees you paid.',
  },
  'termination_asymmetry.immediate_provider_notice_for_user': {
    title: 'The company can end the agreement sooner than you can',
    meaning: 'The company says it can end your access or agreement immediately, while you have to give advance notice to leave.',
    nextStep: 'Save any message about the closure. If your account was closed, ask how to appeal, get your data back, or recover any payment for unused service.',
  },
  'forced_arbitration.mandatory_arbitration': {
    title: 'You may have to resolve a dispute outside court',
    meaning: 'For certain disputes, the terms say you must go to arbitration. This is a process where an independent person decides the dispute outside court.',
    nextStep: 'Check what kinds of disputes the clause covers and whether it allows small claims court. If a dispute has started, check deadlines and fees before deciding how to proceed.',
  },
  'forced_arbitration.class_action_waiver': {
    title: 'You may be unable to join a group lawsuit',
    meaning: 'If many customers have the same problem, the company says you cannot join them in a single lawsuit. You may need to pursue your own complaint.',
    nextStep: 'Check which disputes the restriction covers. If your own loss is small, compare the time and possible fees of bringing an individual case with asking the company for a refund or sending a consumer complaint.',
  },
  'forced_arbitration.class_action_bar': {
    title: 'You may have to bring a complaint on your own',
    meaning: 'The company says each customer must bring their case separately, even where many customers have the same issue.',
    nextStep: 'Find out where you can bring an individual case. Check whether the time and cost are reasonable for the amount at stake.',
  },
  'forced_arbitration.jury_trial_waiver': {
    title: 'You may be giving up a jury trial',
    meaning: 'If your dispute goes to court, the terms say a jury cannot decide it. Depending on the dispute, a judge may still be able to hear it.',
    nextStep: 'Check whether a separate section limits access to court. If a case is already underway, ask a local adviser what the jury wording means for your options.',
  },
  'forced_arbitration.court_access_waiver': {
    title: 'You may be giving up the option to take the company to court',
    meaning: 'The company says certain disputes must be handled somewhere other than a regular court. The wording and any exceptions determine what options are available.',
    nextStep: 'Look for where the agreement tells you to bring a complaint and whether it mentions small claims court. If the company disagrees with your reading, ask a local adviser before a deadline passes.',
  },
};

function safeSource(url: string): string {
  try {
    const source = new URL(url);
    return source.origin === 'null' ? source.protocol : source.origin + source.pathname;
  } catch {
    return 'Source unavailable';
  }
}

export function buildPdf(record: ScanRecord): jsPDF {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  pdf.setProperties({ title: 'PoisonPill contract scan', creator: 'PoisonPill' });
  const margin = 46;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  const limit = pdf.internal.pageSize.getHeight() - margin - 16;
  let y = margin;
  let continuedGroup: string | undefined;

  function room(height: number): void {
    if (y + height <= limit) return;
    pdf.addPage();
    y = margin;
    if (continuedGroup) {
      const size = pdf.getFontSize();
      const color = pdf.getTextColor();
      paragraph(`${continuedGroup} (continued)`, 11, true);
      pdf.setFontSize(size);
      pdf.setTextColor(color);
    }
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
  paragraph(`Source: ${record.source_name ?? safeSource(record.url)}\nScanned: ${record.scanned_at}`);
  const clauses = new Map<string, { quote: string; findings: ClauseFinding[] }>();
  for (const finding of report.findings) {
    const key = `${finding.start_offset}:${finding.end_offset}`;
    const clause = clauses.get(key);
    if (clause) clause.findings.push(finding);
    else clauses.set(key, { quote: finding.raw_text, findings: [finding] });
  }
  const count = clauses.size;
  paragraph(`${count} ${count === 1 ? 'clause' : 'clauses'} to review`, 14, true);
  if (report.findings.length > count) {
    paragraph(`${report.findings.length} issues ${count === 1 ? 'in this clause' : 'across these clauses'}.`);
  }
  paragraph(report.truncated
    ? 'Only the first part of the source was checked because it exceeded the scan limit.'
    : record.source_name
      ? 'This scan checked selectable text in the PDF. Words that only appear in images may have been missed.'
      : 'This scan checked visible page text and readable embedded pages on the same site. Linked files, PDF viewers and some embedded content may have been missed.');
  paragraph('Use this report to see what the terms could mean for you and what to check next. Your options depend on the version you accepted, what happened, where you live and any deadlines.');
  if (record.comparison) {
    const previous = record.comparison;
    paragraph(`Since the last complete scan, the page text ${previous.visible_text_changed ? 'changed' : 'stayed the same'}. Terms flagged since then: ${previous.findings_added} added, ${previous.findings_removed} removed.`);
  }
  if (!count) paragraph('The scan found no terms that matched the patterns it checks.');

  for (const [index, clause] of [...clauses.values()].entries()) {
    const { quote, findings } = clause;
    const grouped = findings.length > 1;
    const disputeClause = findings.every((finding) => finding.category === 'forced_arbitration');
    const groupTitle = disputeClause ? 'How you can resolve disputes' : 'Several issues in this clause';
    room(102);
    y += 10;
    if (grouped) {
      paragraph(`${index + 1}. ${groupTitle}`, 15, true);
      continuedGroup = `${index + 1}. ${groupTitle}`;
    }

    for (const finding of findings) {
      const explanation = EXPLANATIONS[finding.rule_id];
      const title = explanation?.title ?? 'A term worth checking';
      room(78);
      paragraph(grouped ? title : `${index + 1}. ${title}`, grouped ? 12 : 15, true);
      if (!grouped) paragraph('What this could mean for you', 11, true);
      paragraph(explanation?.meaning ?? 'The scan found wording that may affect your rights or what the company expects you to do. Read it together with the sections before and after it.');
      room(45);
      paragraph('What you can do', 11, true);
      paragraph(explanation?.nextStep ??
        'Save the terms and any messages about the issue. Ask the company in writing how this wording applies to you. If there is a large cost or a deadline approaching, ask a qualified local adviser.');
    }

    const optOuts = new Map<string, { target?: string; text?: string }>();
    for (const finding of findings) {
      if (!finding.opt_out_available) continue;
      const target = finding.opt_out_target;
      const text = finding.opt_out_source?.text;
      optOuts.set(JSON.stringify([target, text]), { target, text });
    }
    if (optOuts.size) {
      room(52);
      paragraph('Can you say no to this part?', 11, true);
      paragraph('The scan found instructions for declining this part of the agreement. Check when your deadline starts, how to send the notice and what details to include. Keep proof that you sent it.');
      for (const { target, text } of optOuts.values()) {
        if (target) paragraph(`Address listed in the terms: ${target}`);
        if (text && text !== quote) paragraph(text);
      }
    } else if (findings.some((finding) => finding.category === 'forced_arbitration')) {
      paragraph('Check the surrounding section for instructions on whether you can decline these dispute terms.');
    }
    room(45);
    paragraph('What the terms say', 11, true);
    paragraph(quote);

    room(48);
    paragraph(grouped ? 'Technical notes' : 'Technical note', 11, true);
    for (const finding of findings) {
      paragraph(`Rule: ${finding.rule_id} | Severity: ${finding.severity}/5. ${finding.reason}`, 9);
      if (finding.evidence?.length) {
        const excerpts = [...new Set(finding.evidence.map(({ text }) => text))];
        paragraph(`Matched wording: ${excerpts.join(' | ')}`, 9);
      }
    }
    if (new Set(findings.map((finding) => finding.category)).size < findings.length) {
      paragraph('Findings in the same category count once toward the Poison Index for this clause.', 9);
    }
    continuedGroup = undefined;
  }

  if (count) {
    room(90);
    paragraph('If the company cannot resolve the issue', 13, true);
    paragraph('A local consumer protection service or legal aid office may be able to help. Before filing a formal case, check where to file, how much it costs, what proof you need and when you must act.');
    paragraph('Examples of public complaint services:\nIndia consumer complaints: https://consumerhelpline.gov.in/public/\nU.S. financial products and services: https://www.consumerfinance.gov/complaint/');
  }

  room(40);
  paragraph(`Technical summary: Poison Index ${report.poison_index}/100. The score reflects the wording this scan flagged.`, 9);

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
