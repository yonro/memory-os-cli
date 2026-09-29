import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const FORBIDDEN_PATH_PATTERNS = [
  /^\.progress\//,
  /^\.agents\//,
  /(^|\/)AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /devflow/i,
  /\.plan\.json$/,
  /review_rationale/,
  /\.xmemo\.bak/
];

const FORBIDDEN_CONTENT_STRINGS = [
  'C:\\Users\\',
  'C:/Users/',
  'D:\\repos',
  '.progress/scripts'
];

function isBinary(buffer) {
  const len = Math.min(buffer.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

test('repo-hygiene: no tracked files match internal development-process patterns', () => {
  const output = execSync('git ls-files', { encoding: 'utf-8' });
  const files = output.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);

  const matched = [];
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    for (const pattern of FORBIDDEN_PATH_PATTERNS) {
      if (pattern.test(normalized)) {
        matched.push({ file, pattern: pattern.toString() });
      }
    }
  }

  assert.deepEqual(matched, [], `Found tracked files matching forbidden patterns: ${JSON.stringify(matched, null, 2)}`);
});

test('repo-hygiene: no tracked text files contain internal paths or scripts', () => {
  const output = execSync('git ls-files', { encoding: 'utf-8' });
  const files = output.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);

  const violations = [];

  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');

    // Excluded files: CHANGELOG.md, test fixtures, and this test itself
    if (
      normalized === 'CHANGELOG.md' ||
      normalized.startsWith('test/fixtures/') ||
      normalized === 'test/repo-hygiene.test.js'
    ) {
      continue;
    }

    const fullPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;

    const buffer = fs.readFileSync(fullPath);
    if (isBinary(buffer)) continue;

    const content = buffer.toString('utf-8');
    for (const forbidden of FORBIDDEN_CONTENT_STRINGS) {
      if (content.includes(forbidden)) {
        violations.push({ file, forbidden });
      }
    }
  }

  assert.deepEqual(violations, [], `Found tracked text files containing forbidden strings: ${JSON.stringify(violations, null, 2)}`);
});

const FORBIDDEN_INTERNAL_MARKERS = [
  { name: 'CLI internal tasks', regex: /\bCLI-(DOGFOOD|MEMORY-UX|DESIGN)\b/ },
  { name: 'Review revision markers', regex: /\bRev-[0-9a-f]{8}\b/ },
  { name: 'INBOX task codes', regex: /\bINBOX-\d{8}/ },
  { name: 'TID task markers', regex: /\bTID:/ },
  { name: 'Reviewer-requested markers', regex: /reviewer-requested/i },
  { name: 'DevFlow references', regex: /\bdevflow\b/i }
];

const TEST_NAME_REVIEW_UUID_REGEX = /(?:test|it|describe)\s*\(\s*['"`][^'"`]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test('repo-hygiene: no tracked files contain internal development markers', () => {
  const output = execSync('git ls-files', { encoding: 'utf-8' });
  const files = output.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);

  const violations = [];

  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');

    // Only this test itself is excluded from checking internal markers
    if (normalized === 'test/repo-hygiene.test.js') {
      continue;
    }

    const fullPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;

    const buffer = fs.readFileSync(fullPath);
    if (isBinary(buffer)) continue;

    const content = buffer.toString('utf-8');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Allow the existing devflow-lifecycle hook line in .gitignore
      if (normalized === '.gitignore' && /\.github\/hooks\/devflow-lifecycle\.json/.test(line)) {
        continue;
      }

      for (const marker of FORBIDDEN_INTERNAL_MARKERS) {
        if (marker.regex.test(line)) {
          violations.push({ file, line: i + 1, marker: marker.name, snippet: line.trim() });
        }
      }

      if (TEST_NAME_REVIEW_UUID_REGEX.test(line)) {
        violations.push({ file, line: i + 1, marker: 'review-request UUID in test name', snippet: line.trim() });
      }
    }
  }

  assert.deepEqual(violations, [], `Found tracked files containing internal development markers: ${JSON.stringify(violations, null, 2)}`);
});

test('repo-hygiene: no stray test directories left in working tree', () => {
  const repoRoot = path.resolve(process.cwd());
  const strayDirs = ['xmemo-skill', 'xmemo-skill-test', 'custom-app-dir', '.kimi-code', 'Python'];
  for (const dir of strayDirs) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, dir)),
      false,
      `Stray test directory "${dir}" must not exist at repo root`
    );
  }
});


