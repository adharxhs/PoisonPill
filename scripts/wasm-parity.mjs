// Native/Wasm parity over the regression corpus.
//
// The native goldens are the source of truth. This script feeds the same inputs
// through the shipped Wasm artifact and requires byte-identical canonical JSON.
// It compares strings, not parsed objects, so field order and float formatting
// are covered too.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadShippedEngine, paths, projectRoot } from './wasm-loader.mjs';

const CLASSES = ['positive', 'hard_negative', 'negative'];

function casesFor(className) {
  const directory = join(projectRoot, 'fixtures/cases', className);
  return readdirSync(directory)
    .filter((name) => name.endsWith('.txt'))
    .sort()
    .map((name) => ({
      name: name.slice(0, -'.txt'.length),
      className,
      input: readFileSync(join(directory, name), 'utf8'),
      golden: readFileSync(
        join(projectRoot, 'fixtures/golden', className, `${name.slice(0, -4)}.json`),
        'utf8',
      ).trimEnd(),
    }));
}

const cases = CLASSES.flatMap(casesFor);
const { analyze, review, wasmBytes } = await loadShippedEngine();

let failures = 0;
for (const testCase of cases) {
  const actual = analyze(testCase.input);
  const label = `${testCase.className}/${testCase.name}`;
  if (actual === testCase.golden) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL ${label}`);
    console.error(`  native: ${testCase.golden}`);
    console.error(`  wasm:   ${actual}`);
  }
}

console.log(
  `\nparity: ${cases.length - failures}/${cases.length} cases byte-identical ` +
    `(${wasmBytes.length} byte artifact, ${paths.wasm})`,
);

// Boundary checks: the same truncation rules must hold across the Wasm edge.
// Keep this in sync with `MAX_INPUT_BYTES` in engine/src/deontic.rs.
const MAX_INPUT_BYTES = 512 * 1024;
let boundaryFailures = 0;
const check = (condition, message) => {
  if (!condition) {
    boundaryFailures += 1;
    console.error(`FAIL boundary: ${message}`);
  }
};

const reviewText = 'Café: We reserve the right to make changes to these terms at any time by posting them here.';
const [reviewReport, candidates] = JSON.parse(review(reviewText));
check(JSON.stringify(reviewReport) === JSON.stringify(JSON.parse(analyze(reviewText))), 'review changed the scored report');
check(candidates.some(({ category }) => category === 'unilateral_modification'), 'review missed the known model candidate');
const original = Buffer.from(reviewText, 'utf8');
check(
  candidates.every(({ source }) =>
    original.subarray(source.start_offset, source.end_offset).toString('utf8') === source.text),
  'review source ranges do not match original UTF-8 text',
);

const clause = 'You waive any right to a class action. ';
const oversize = clause.repeat(Math.ceil(MAX_INPUT_BYTES / clause.length) + 20);
const oversizeReport = JSON.parse(analyze(oversize)).report;
check(oversizeReport.truncated === true, 'oversize input is not marked truncated');
check(oversizeReport.findings.length > 0, 'truncated prefix produced no findings');
for (const finding of oversizeReport.findings) {
  check(
    oversize.slice(finding.start_offset, finding.end_offset) === finding.raw_text,
    'truncated finding does not slice the original input',
  );
  check(
    finding.end_offset <= MAX_INPUT_BYTES,
    `finding ends past the cap: ${finding.end_offset}`,
  );
}

// A multi-byte character straddling the cap must not split or panic.
const multibyte = 'a'.repeat(MAX_INPUT_BYTES - 1) + 'é You waive any right to a class action. ';
const multibyteReport = JSON.parse(analyze(multibyte)).report;
check(multibyteReport.truncated === true, 'multibyte input is not marked truncated');

if (boundaryFailures === 0) {
  console.log('boundary: truncation and offsets hold through Wasm');
}

process.exitCode = failures === 0 && boundaryFailures === 0 ? 0 : 1;
