import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(process.cwd());

function readJsonFile(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  assert.equal(fs.existsSync(fullPath), true, `Required file ${relativePath} must exist`);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

const productMeta = readJsonFile('product-metadata.json');

test('positioning: product-metadata.json defines canonical positioning facts', () => {
  assert.equal(productMeta.name, 'XMemo');
  assert.equal(productMeta.category, 'User-owned Memory OS for AI agents');
  assert.equal(typeof productMeta.description, 'string');
  assert.match(productMeta.description, new RegExp(productMeta.category, 'i'));
  assert.equal(productMeta.docsUrl, 'https://docs.xmemo.dev/');
  assert.equal(productMeta.mcpUrl, 'https://xmemo.dev/mcp');
  assert.equal(productMeta.repositoryUrl, 'https://github.com/yonro/memory-os-cli');
  assert.equal(productMeta.packageName, '@xmemo/client');
});

test('positioning: server.json metadata aligns with product-metadata and satisfies registry constraints', () => {
  const server = readJsonFile('server.json');

  assert.equal(server.title, productMeta.name, 'server.json title must be XMemo');
  assert.notEqual(server.title, 'XMemo CLI', 'server.json title must not be XMemo CLI');

  assert.equal(typeof server.description, 'string');
  assert.match(server.description, new RegExp(productMeta.category, 'i'), 'server.json description must contain canonical category');
  assert.match(server.description, /public REST/i, 'server.json description must mention "public REST" when describing REST surface');
  assert.ok(
    server.description.length <= 100,
    `server.json description length (${server.description.length}) must not exceed MCP Registry schema maxLength (100)`
  );
  assert.ok(
    server.description.length >= 1,
    'server.json description must not be empty'
  );

  assert.equal(server.websiteUrl, 'https://xmemo.dev/product/mcp');
  assert.equal(server.repository?.url, productMeta.repositoryUrl);

  const remote = server.remotes?.find((r) => r.type === 'streamable-http');
  assert.ok(remote, 'server.json must declare streamable-http remote');
  assert.equal(remote.url, productMeta.mcpUrl);

  const pkg = server.packages?.find((p) => p.registryType === 'npm');
  assert.ok(pkg, 'server.json must declare npm package');
  assert.equal(pkg.identifier, productMeta.packageName);
});

test('positioning: package.json metadata aligns with product-metadata', () => {
  const pkg = readJsonFile('package.json');

  assert.equal(pkg.name, productMeta.packageName);
  assert.match(pkg.description, new RegExp(productMeta.category, 'i'), 'package.json description must contain canonical category');
  assert.notEqual(pkg.name, 'XMemo CLI');

  const requiredKeywords = [
    'memory-os',
    'ai-agents',
    'persistent-memory',
    'agent-memory',
    'model-context-protocol',
    'mcp'
  ];
  for (const kw of requiredKeywords) {
    assert.ok(
      pkg.keywords?.includes(kw),
      `package.json keywords must include "${kw}"`
    );
  }
});

test('positioning: lhm.plugin.json metadata aligns with product-metadata', () => {
  const plugin = readJsonFile('lhm.plugin.json');

  assert.equal(plugin.name, productMeta.name, 'lhm.plugin.json name must be XMemo');
  assert.notEqual(plugin.name, 'XMemo CLI', 'lhm.plugin.json name must not be XMemo CLI');
  assert.match(plugin.description, new RegExp(productMeta.category, 'i'), 'lhm.plugin.json description must contain canonical category');
  assert.match(plugin.description, /public REST/i, 'lhm.plugin.json description must mention "public REST" when describing REST surface');
  assert.equal(plugin.cloudEndpoint, productMeta.mcpUrl);

  const requiredTags = ['memory-os', 'agent-memory', 'mcp'];
  for (const tag of requiredTags) {
    assert.ok(
      plugin.tags?.includes(tag),
      `lhm.plugin.json tags must include "${tag}"`
    );
  }
});

test('positioning: context7.json metadata aligns with product-metadata and rules grammar', () => {
  const c7 = readJsonFile('context7.json');

  assert.ok(
    c7.projectTitle?.startsWith(productMeta.name),
    `context7.json projectTitle must start with "${productMeta.name}"`
  );
  assert.notEqual(c7.projectTitle, 'XMemo CLI', 'context7.json projectTitle must not be "XMemo CLI"');
  assert.match(c7.description, new RegExp(productMeta.category, 'i'), 'context7.json description must contain canonical category');

  assert.ok(
    c7.excludeFolders?.includes('docs/maintainers'),
    'context7.json excludeFolders must include docs/maintainers'
  );

  const rules = c7.rules || [];
  const docsRule = rules.find((r) => r.includes('docs.xmemo.dev'));
  assert.ok(docsRule, 'context7.json rules must reference docs.xmemo.dev');

  const setupRule = rules.find((r) => r.includes('xmemo setup'));
  assert.ok(setupRule, 'context7.json rules must contain setup rule');
  assert.doesNotMatch(
    setupRule,
    /is dry-run by default; configuration is only written when --write/,
    'context7.json setup rule must not use outdated v1 dry-run wording'
  );

  for (const rule of rules) {
    assert.doesNotMatch(
      rule,
      /\bSDK helpers\b/i,
      'context7.json rules must not claim SDK helpers'
    );
  }
});

test('positioning: forbidden claims and superlatives are absent from metadata fields', () => {
  const server = readJsonFile('server.json');
  const pkg = readJsonFile('package.json');
  const plugin = readJsonFile('lhm.plugin.json');
  const c7 = readJsonFile('context7.json');

  const inspectedFields = [
    { source: 'server.json title', text: server.title },
    { source: 'server.json description', text: server.description },
    { source: 'package.json description', text: pkg.description },
    { source: 'lhm.plugin.json name', text: plugin.name },
    { source: 'lhm.plugin.json description', text: plugin.description },
    { source: 'context7.json projectTitle', text: c7.projectTitle },
    { source: 'context7.json description', text: c7.description }
  ];

  const readmePath = path.join(repoRoot, 'README.md');
  if (fs.existsSync(readmePath)) {
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    const beyondMcpMatch = readmeContent.match(/## Beyond MCP\r?\n([\s\S]*?)(?=\r?\n## )/);
    if (beyondMcpMatch) {
      inspectedFields.push({ source: 'README.md Beyond MCP', text: beyondMcpMatch[1] });
    }
  }

  const readmeCnPath = path.join(repoRoot, 'README_CN.md');
  if (fs.existsSync(readmeCnPath)) {
    const readmeCnContent = fs.readFileSync(readmeCnPath, 'utf8');
    const beyondMcpCnMatch = readmeCnContent.match(/## 超越 MCP\r?\n([\s\S]*?)(?=\r?\n## )/);
    if (beyondMcpCnMatch) {
      inspectedFields.push({ source: 'README_CN.md 超越 MCP', text: beyondMcpCnMatch[1] });
    }
  }

  const forbiddenPatterns = [
    { name: 'marketing superlatives', regex: /\b(?:revolutionary|industry-leading|the best|#1)\b/i },
    { name: 'connectors claim', regex: /\bconnectors\b/i },
    { name: 'AI notes service', regex: /\bAI notes service\b/i },
    { name: 'unsupported certification / GA claim', regex: /\b(?:certified|GA ready)\b/i },
    { name: 'SDK claim', regex: /\bTypeScript SDK\b|\bMemoryOSClient\b/i },
    { name: 'invented scope names', regex: /\b(?:read:state|write:state|read:memory|write:memory)\b/i }
  ];

  for (const field of inspectedFields) {
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(
        field.text,
        pattern.regex,
        `Field "${field.source}" must not contain forbidden pattern: ${pattern.name}`
      );
    }
  }
});

test('positioning: markdown first-screen block validation (for updated README / MCP-README)', () => {
  const readmePath = path.join(repoRoot, 'README.md');
  assert.equal(fs.existsSync(readmePath), true, 'README.md must exist');
  const readmeContent = fs.readFileSync(readmePath, 'utf8');
  const readmeLines = readmeContent.split(/\r?\n/);
  const readmeH1 = readmeLines.find((l) => l.startsWith('# '));
  assert.ok(readmeH1, 'README.md must contain an H1 heading');
  assert.match(readmeH1, /^# XMemo\b/, 'README H1 must start with "# XMemo"');

  const firstScreenLines = readmeLines.slice(0, 60);
  const firstScreenText = firstScreenLines.join('\n');
  assert.match(
    firstScreenText,
    new RegExp(productMeta.category, 'i'),
    'README first screen must contain canonical category phrase'
  );
  assert.match(
    firstScreenText,
    /https:\/\/docs\.xmemo\.dev\/?/,
    'README first screen must link to docs.xmemo.dev'
  );

  const readmeCnPath = path.join(repoRoot, 'README_CN.md');
  if (fs.existsSync(readmeCnPath)) {
    const readmeCnContent = fs.readFileSync(readmeCnPath, 'utf8');
    const readmeCnLines = readmeCnContent.split(/\r?\n/);
    const readmeCnH1 = readmeCnLines.find((l) => l.startsWith('# '));
    assert.ok(readmeCnH1, 'README_CN.md must contain an H1 heading');
    assert.match(readmeCnH1, /^# XMemo\b/, 'README_CN H1 must start with "# XMemo"');

    const firstScreenCnText = readmeCnLines.slice(0, 60).join('\n');
    assert.match(
      firstScreenCnText,
      /https:\/\/docs\.xmemo\.dev\/?/,
      'README_CN first screen must link to docs.xmemo.dev'
    );
  }

  const mcpReadmePath = path.join(repoRoot, 'MCP-README.md');
  if (fs.existsSync(mcpReadmePath)) {
    const content = fs.readFileSync(mcpReadmePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const h1 = lines.find((l) => l.startsWith('# '));
    if (h1 && !h1.includes('MCP Server')) {
      assert.match(h1, /^# XMemo\b/, 'When updated, MCP-README H1 must start with "# XMemo"');
    }
  }
});

test('positioning: README first-screen Beyond MCP links use dedicated docs pages', () => {
  const readmes = [
    { name: 'README.md', path: path.join(repoRoot, 'README.md'), beyondHeader: '## Beyond MCP' },
    { name: 'README_CN.md', path: path.join(repoRoot, 'README_CN.md'), beyondHeader: '## 超越 MCP' }
  ];

  for (const item of readmes) {
    if (!fs.existsSync(item.path)) continue;
    const content = fs.readFileSync(item.path, 'utf8');
    const cliHeaderIndex = content.search(/## XMemo CLI\b/);
    assert.ok(cliHeaderIndex > 0, `${item.name} must contain "## XMemo CLI" section`);
    const firstScreen = content.slice(0, cliHeaderIndex);

    const beyondRegex = new RegExp(`${item.beyondHeader}\\r?\\n([\\s\\S]*?)(?=\\r?\\n## )`);
    const beyondMatch = content.match(beyondRegex);
    assert.ok(beyondMatch, `${item.name} must contain "${item.beyondHeader}" section`);
    const beyondSection = beyondMatch[1];

    assert.doesNotMatch(
      beyondSection,
      /\b(?:read:state|write:state|read:memory|write:memory)\b/i,
      `${item.name} Beyond MCP must not contain invented scope names`
    );

    assert.doesNotMatch(
      beyondSection,
      /https:\/\/docs\.xmemo\.dev\/docs\/quickstart\b/,
      `${item.name} Beyond MCP must link to dedicated docs pages, not generic /docs/quickstart`
    );

    const docsLinks = [...firstScreen.matchAll(/https:\/\/docs\.xmemo\.dev[^\s)"]*/g)].map((m) => m[0]);
    for (const link of docsLinks) {
      assert.doesNotMatch(
        link,
        /\/docs\/quickstart\b/,
        `${item.name} first-screen link "${link}" must not be /docs/quickstart`
      );
    }

    const requiredDocsPaths = [
      '/docs/tools/remember',
      '/docs/tools/recall-context',
      '/docs/guides/resume-and-handoff',
      '/docs/concepts/projects',
      '/docs/tools/todos',
      '/docs/concepts/provenance-attribution',
      '/docs/concepts/agent-identity',
      '/docs/concepts/scopes',
      '/docs/concepts/governance-retention',
      '/docs/connect/openclaw',
      '/docs/connect/hermes',
      '/docs/connect/deepseek-harness',
      '/docs/skills/quickstart',
      '/docs/concepts/cloud-skills',
      '/docs/concepts/dream-reflection',
      '/docs/capabilities/teams',
      '/docs/concepts/memory-model',
      '/docs/mcp/overview',
      '/docs/api/authentication'
    ];

    for (const docPath of requiredDocsPaths) {
      assert.ok(
        beyondSection.includes(`https://docs.xmemo.dev${docPath}`),
        `${item.name} Beyond MCP must link to dedicated docs page "https://docs.xmemo.dev${docPath}"`
      );
    }
  }
});
