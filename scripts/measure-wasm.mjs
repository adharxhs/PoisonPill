// Measure end-to-end analysis latency through the shipped Wasm artifact.
//
// This is a recorded measurement, not a gating test: wall-clock timing on a
// shared machine is noisy. The hard 200 ms budget lives in
// `engine/tests/budgets.rs` (native release). Compare the two numbers in
// docs/MEASUREMENTS.md.

import { performance } from 'node:perf_hooks';

import { loadShippedEngine } from './wasm-loader.mjs';

// Same fixture as the native budget test: 19 words per repetition, 530
// repetitions is just over 10,000 words of benign maintenance prose.
const SENTENCE =
  'The provider may send service announcements about scheduled maintenance and ' +
  'availability from time to time to the account owner. ';
const text = SENTENCE.repeat(530);
const words = text.split(/\s+/).filter(Boolean).length;

const { analyze, wasmBytes } = await loadShippedEngine();

// Two warm-up passes so module instantiation and JIT warm-up are excluded.
analyze(text);
analyze(text);

const runs = 20;
const samples = [];
for (let index = 0; index < runs; index += 1) {
  const started = performance.now();
  analyze(text);
  samples.push(performance.now() - started);
}

samples.sort((left, right) => left - right);
const min = samples[0];
const median = samples[Math.floor(samples.length / 2)];
const max = samples[samples.length - 1];
const mean = samples.reduce((total, value) => total + value, 0) / samples.length;

console.log(`wasm: ${words} words, ${runs} timed runs after 2 warm-ups`);
console.log(
  `wasm: min ${min.toFixed(2)} ms, median ${median.toFixed(2)} ms, ` +
    `mean ${mean.toFixed(2)} ms, max ${max.toFixed(2)} ms`,
);
console.log(`wasm: artifact ${wasmBytes.length} bytes`);

if (median >= 200) {
  console.error('wasm: median exceeded the 200 ms budget');
  process.exitCode = 1;
}
