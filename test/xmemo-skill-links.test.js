import assert from 'node:assert/strict';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMAND_FLAGS, REST_COMMANDS } from '../skills/xmemo/scripts/lib/core.mjs';
import { COMMAND_USAGE_REGISTRY } from '../skills/xmemo/scripts/lib/help.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = path.join(repoRoot, 'skills', 'xmemo');

async function markdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath);
  }
  return files;
}

function addCommandLiterals(target, source, expression) {
  for (const match of source.matchAll(expression)) target.add(match[1]);
}

test('SKILL.md lists every registered and dispatched command with a reference', async () => {
  const skill = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const entrypoint = await readFile(path.join(skillRoot, 'scripts', 'xmemo-skill.mjs'), 'utf8');
  const commands = new Set([
    ...REST_COMMANDS,
    ...Object.keys(COMMAND_FLAGS),
    ...Object.keys(COMMAND_USAGE_REGISTRY),
  ]);

  const main = entrypoint.slice(entrypoint.indexOf('async function main()'));
  addCommandLiterals(commands, main, /command\s*===\s*'([^']+)'/g);
  for (const match of main.matchAll(/\[([^\]]+)\]\.includes\(command\)/g)) {
    addCommandLiterals(commands, match[1], /'([^']+)'/g);
  }
  const tick = '`';
  const templateAssignment = 'command = `cloud-skill-${subcommand}`';
  if (main.includes(templateAssignment)) {
    const subcommands = new Set();
    for (const match of main.matchAll(/\[([^\]]+)\]\.includes\(subcommand\)/g)) {
      addCommandLiterals(subcommands, match[1], /'([^']+)'/g);
    }
    for (const subcommand of subcommands) commands.add('cloud-skill-' + subcommand);
  }

  // 1. Every command and alias must appear in SKILL.md
  const missing = [...commands].filter((name) => !skill.includes(tick + name + tick));
  assert.deepEqual(missing, [], 'Add a one-line purpose for every command and alias to SKILL.md');
  assert.ok(skill.includes('XMEMO_NO_UPDATE_CHECK'), 'SKILL.md must disclose XMEMO_NO_UPDATE_CHECK');
  assert.ok(skill.includes('skill-update-check.json'), 'SKILL.md must disclose skill-update-check.json');
  assert.ok(skill.includes('profile-offer.json'), 'SKILL.md must disclose profile-offer.json');

  // 2. Command Directory table coverage
  const commandSection = skill.slice(
    skill.indexOf('## Command Directory'),
    skill.indexOf('[cmd]:')
  );
  const commandRows = commandSection.split('\n').filter((line) => line.startsWith('| `'));
  const rowCommands = new Set(
    commandRows.flatMap((row) => Array.from(row.matchAll(/`([^`]+)`/g), (m) => m[1]))
  );
  const missingFromTable = [...commands].filter((name) => !rowCommands.has(name));
  assert.deepEqual(missingFromTable, [], 'Each command or alias must be documented in the Command Directory table');

  // 3. Every row links to a bundled detail reference and the target file contains the primary command
  const refDefs = Object.fromEntries(
    Array.from(skill.matchAll(/^\[([^\]]+)\]:\s*([^\s]+)/gm), (m) => [m[1], m[2]])
  );
  const targetCache = new Map();
  for (const row of commandRows) {
    const inlineMatch = row.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const refMatch = row.match(/\[([^\]]+)\]\[([^\]]+)\]/);
    assert.ok(inlineMatch || refMatch, 'Every command row must link to a reference: ' + row);
    const targetPath = inlineMatch ? inlineMatch[2] : refDefs[refMatch[2]];
    assert.ok(targetPath, 'Reference definition must resolve for row: ' + row);
    assert.match(targetPath, /^references\/[a-z0-9_-]+\.md(?:#[a-z0-9_-]+)?$/, 'Target must be in references/: ' + targetPath);

    const primaryCmd = row.match(/^\|\s*`([^`]+)`/)[1];
    const filePath = path.resolve(skillRoot, targetPath.split('#')[0]);
    if (!targetCache.has(filePath)) {
      targetCache.set(filePath, await readFile(filePath, 'utf8'));
    }
    const fileContent = targetCache.get(filePath);
    assert.ok(
      fileContent.includes('`' + primaryCmd + '`'),
      'Target file ' + targetPath + ' must document primary command `' + primaryCmd + '`'
    );
  }
  assert.ok(skill.includes('runtime-operations.md#command-syntax-and-flags'),
    'The entrypoint must link to the full flags matrix');
});

test('SKILL.md and reference Markdown links resolve inside the bundled Skill', async () => {
  const files = [
    path.join(skillRoot, 'SKILL.md'),
    ...await markdownFiles(path.join(skillRoot, 'references')),
  ];
  const relativeLinks = [];
  const linkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^)]*['"])?\)/g;
  const refDefPattern = /^\[([^\]]+)\]:\s*([^\s]+)/gm;

  for (const sourceFile of files) {
    const text = await readFile(sourceFile, 'utf8');
    const targets = [
      ...Array.from(text.matchAll(linkPattern), (m) => m[1]),
      ...Array.from(text.matchAll(refDefPattern), (m) => m[2]),
    ];
    for (const target of targets) {
      if (!target || target.startsWith('#') || target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const pathname = decodeURIComponent(target.split(/[?#]/, 1)[0]);
      if (!pathname) continue;
      const resolved = path.resolve(path.dirname(sourceFile), pathname);
      const relative = path.relative(skillRoot, resolved);
      assert.ok(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative),
        sourceFile + ' links outside the Skill bundle: ' + target);
      await access(resolved);
      assert.ok((await stat(resolved)).isFile(), sourceFile + ' links to a non-file: ' + target);
      relativeLinks.push(target);
    }
  }

  assert.ok(relativeLinks.length > 0, 'The link check should inspect relative reference links');
});
