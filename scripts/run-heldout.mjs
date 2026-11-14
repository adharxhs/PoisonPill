// Run the held-out corpus exactly once against the shipped Wasm artifact.
//
// Held-out documents were written before the Wasm milestone and are not part of
// the golden harness. This script prints a Markdown record (input digests,
// findings, canonical JSON) that is committed as fixtures/heldout/REPORT.md.
// Do not re-run it to make results look better; the point is an honest snapshot.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadShippedEngine, projectRoot } from './wasm-loader.mjs';

const directory = join(projectRoot, 'fixtures/heldout');
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.txt'))
  .sort();

const { analyze, wasmBytes } = await loadShippedEngine();
const artifactDigest = createHash('sha256').update(wasmBytes).digest('hex');
const today = new Date().toISOString().slice(0, 10);

const results = files.map((file) => {
  const bytes = readFileSync(join(directory, file));
  const text = bytes.toString('utf8');
  const canonical = analyze(text);
  const { report } = JSON.parse(canonical);
  return {
    file,
    inputDigest: createHash('sha256').update(bytes).digest('hex'),
    canonical,
    report,
  };
});

const ruleCounts = new Map();
for (const result of results) {
  for (const finding of result.report.findings) {
    ruleCounts.set(finding.rule_id, (ruleCounts.get(finding.rule_id) ?? 0) + 1);
  }
}

console.log('# Held-out corpus: one-shot report');
console.log('');
console.log(
  'Written before the Wasm milestone and analysed once through the committed ' +
    'artifact. These documents are not used for tuning and have no goldens.',
);
console.log('');
console.log(`- Date: ${today}`);
console.log(`- Wasm artifact: ${wasmBytes.length} bytes, sha256 \`${artifactDigest}\``);
console.log(`- Documents: ${results.length}`);
console.log(
  `- Findings: ${results.reduce((total, result) => total + result.report.findings.length, 0)}`,
);
console.log('');

console.log('## Summary');
console.log('');
console.log('| Document | Input sha256 | Findings | P_I | Rules |');
console.log('| :--- | :--- | ---: | ---: | :--- |');
for (const result of results) {
  const rules = result.report.findings.map((finding) => `\`${finding.rule_id}\``).join(', ') || '—';
  console.log(
    `| \`${result.file}\` | \`${result.inputDigest.slice(0, 12)}\` | ` +
      `${result.report.findings.length} | ${result.report.poison_index} | ${rules} |`,
  );
}
console.log('');

console.log('## Rule coverage');
console.log('');
if (ruleCounts.size === 0) {
  console.log('No rule fired.');
} else {
  console.log('| Rule | Findings |');
  console.log('| :--- | ---: |');
  for (const rule of [...ruleCounts.keys()].sort()) {
    console.log(`| \`${rule}\` | ${ruleCounts.get(rule)} |`);
  }
}
console.log('');

console.log('## Canonical reports');
console.log('');
for (const result of results) {
  console.log(`### ${result.file}`);
  console.log('');
  console.log(`Full input sha256: \`${result.inputDigest}\``);
  console.log('');
  console.log('```json');
  console.log(result.canonical);
  console.log('```');
  console.log('');
}
