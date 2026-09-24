#!/usr/bin/env node
/**
 * scripts/measure-skill-startup.mjs
 *
 * Measures startup latency for xmemo-skill.mjs across `--version` and `--help`.
 * Runs each command 10 times after a warmup run, computing the median, min, max, and mean.
 *
 * Usage:
 *   node scripts/measure-skill-startup.mjs [--json] [--runs <n>]
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const skillScript = path.join(repoRoot, 'skills', 'xmemo', 'scripts', 'xmemo-skill.mjs');

function parseArgs() {
  const args = process.argv.slice(2);
  let runs = 10;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') {
      json = true;
    } else if (args[i] === '--runs' && i + 1 < args.length) {
      runs = parseInt(args[++i], 10) || 10;
    }
  }
  return { runs, json };
}

function measureCommand(args, runs) {
  // Warmup run
  spawnSync(process.execPath, [skillScript, ...args], {
    cwd: repoRoot,
    env: { ...process.env, XMEMO_FORCE_TTY: '0' },
    stdio: 'ignore',
  });

  const samples = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const res = spawnSync(process.execPath, [skillScript, ...args], {
      cwd: repoRoot,
      env: { ...process.env, XMEMO_FORCE_TTY: '0' },
      stdio: 'ignore',
    });
    const duration = performance.now() - start;
    if (res.status !== 0) {
      throw new Error(`Command "${args.join(' ')}" failed with exit code ${res.status}`);
    }
    samples.push(Math.round(duration * 100) / 100);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = Math.round((samples.reduce((a, b) => a + b, 0) / samples.length) * 100) / 100;

  return { runs, samples, median, min, max, mean };
}

export function runBenchmark(runs = 10) {
  const versionMetrics = measureCommand(['--version'], runs);
  const helpMetrics = measureCommand(['--help'], runs);
  return {
    timestamp: new Date().toISOString(),
    runs,
    metrics: {
      version: versionMetrics,
      help: helpMetrics,
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { runs, json } = parseArgs();
  const results = runBenchmark(runs);
  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log('='.repeat(65));
    console.log(`XMemo Skill Startup Latency Benchmark (${runs} iterations)`);
    console.log('='.repeat(65));
    console.log(`Command: node skills/xmemo/scripts/xmemo-skill.mjs --version`);
    console.log(`  Median: ${results.metrics.version.median.toFixed(2)} ms`);
    console.log(`  Min:    ${results.metrics.version.min.toFixed(2)} ms`);
    console.log(`  Max:    ${results.metrics.version.max.toFixed(2)} ms`);
    console.log(`  Mean:   ${results.metrics.version.mean.toFixed(2)} ms`);
    console.log(`  Samples: [${results.metrics.version.samples.join(', ')}]`);
    console.log('-'.repeat(65));
    console.log(`Command: node skills/xmemo/scripts/xmemo-skill.mjs --help`);
    console.log(`  Median: ${results.metrics.help.median.toFixed(2)} ms`);
    console.log(`  Min:    ${results.metrics.help.min.toFixed(2)} ms`);
    console.log(`  Max:    ${results.metrics.help.max.toFixed(2)} ms`);
    console.log(`  Mean:   ${results.metrics.help.mean.toFixed(2)} ms`);
    console.log(`  Samples: [${results.metrics.help.samples.join(', ')}]`);
    console.log('='.repeat(65));
  }
}
