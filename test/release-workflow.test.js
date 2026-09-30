import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repoRoot, '.github/workflows/release-xmemo-skill.yml');

test('the Skill release announcement carries no free-form release text', async () => {
  const workflow = await readFile(workflowPath, 'utf8');

  // Forwarding the whole release object made the announcement depend on how the
  // release notes were worded: a body containing a shell pipeline was rejected
  // by the receiver's edge protection with HTTP 403, and because the package
  // cache has no expiry that silently kept the previous Skill published.
  assert.match(workflow, /action: 'published', release: \{ tag_name: tagName, assets \}/);
  assert.match(workflow, /name: asset\.name/);
  assert.match(workflow, /browser_download_url: asset\.browser_download_url/);
  assert.doesNotMatch(workflow, /event\.release = /);
  assert.doesNotMatch(workflow, /GITHUB_EVENT_PATH/);
});

test('the Skill release announcement fails fast instead of retrying a rejection', async () => {
  const workflow = await readFile(workflowPath, 'utf8');

  assert.doesNotMatch(workflow, /--retry-all-errors/);
  assert.match(workflow, /Announcement rejected with HTTP \$\{http_code:-none\}; not retrying\./);

  // Retrying every error turned one rejection into four identical rejections
  // followed by an opaque failure. Only answers that can plausibly change on a
  // second attempt are retried.
  assert.match(workflow, /000 \| 408 \| 429 \| 5\*\)/);
});

test('the Skill release is verified against the public endpoint before it is called done', async () => {
  const workflow = await readFile(workflowPath, 'utf8');

  // The announcement only queues a refresh, so the release job must confirm the
  // public endpoint really serves this tag rather than trusting a 2xx reply.
  assert.match(workflow, /- name: Verify xmemo\.dev serves this release/);
  assert.match(workflow, /v1\/skill\/package\?format=\$format/);
  assert.match(workflow, /for format in tar\.gz zip; do/);
  assert.match(workflow, /\[\[ "\$location" == \*"\/\$RELEASE_TAG" \]\]/);
  assert.match(workflow, /still does not serve \$RELEASE_TAG/);
});

test('CLI release workflow creates releases with --latest=false and explicit CLI title', async () => {
  const cliWorkflowPath = path.join(repoRoot, '.github/workflows/release.yml');
  const cliWorkflow = await readFile(cliWorkflowPath, 'utf8');

  assert.match(cliWorkflow, /--latest=false/);
  assert.match(cliWorkflow, /--title "XMemo CLI v\$\{VERSION\}"/);
});

test('CLI release and recovery workflows use OIDC trusted publishing with zero NPM_TOKEN secrets', async () => {
  const workflowsDir = path.join(repoRoot, '.github/workflows');
  const files = await readdir(workflowsDir);
  const ymlFiles = files.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

  assert.ok(ymlFiles.length > 0, 'workflow files should exist');

  for (const file of ymlFiles) {
    const content = await readFile(path.join(workflowsDir, file), 'utf8');
    assert.doesNotMatch(
      content,
      /secrets\.NPM_TOKEN/,
      `workflow ${file} must not reference secrets.NPM_TOKEN`,
    );
  }

  // CLI release workflow (release.yml)
  const releaseWorkflow = await readFile(path.join(workflowsDir, 'release.yml'), 'utf8');
  assert.match(releaseWorkflow, /environment:\s*npm/);
  assert.match(releaseWorkflow, /id-token:\s*write/);
  assert.match(releaseWorkflow, /npm install -g npm@11\.6\.4/);
  assert.match(releaseWorkflow, /npm --version/);
  assert.doesNotMatch(releaseWorkflow, /registry-url/);
  assert.match(releaseWorkflow, /npm publish --access public --provenance/);

  // CLI recovery publish workflow (publish.yml)
  const publishWorkflow = await readFile(path.join(workflowsDir, 'publish.yml'), 'utf8');
  assert.match(publishWorkflow, /environment:\s*npm/);
  assert.match(publishWorkflow, /id-token:\s*write/);
  assert.match(publishWorkflow, /npm install -g npm@11\.6\.4/);
  assert.match(publishWorkflow, /npm --version/);
  assert.doesNotMatch(publishWorkflow, /registry-url/);
  assert.match(publishWorkflow, /npm publish --access public --provenance/);
});

test('Skill release documentation explicitly specifies --latest for GitHub Release creation', async () => {
  const docPath = path.join(repoRoot, 'docs/maintainers/xmemo-skill-release.md');
  const doc = await readFile(docPath, 'utf8');

  assert.match(doc, /gh release create skill-v/);
  assert.match(doc, /--latest/);
  assert.match(doc, /--title "XMemo Skill v/);
});

test('skillhub.cn publish workflow structure and safety invariants', async () => {
  const skillhubWorkflowPath = path.join(repoRoot, '.github/workflows/publish-skillhub.yml');
  const workflow = await readFile(skillhubWorkflowPath, 'utf8');

  // Triggered by workflow_run of "Package XMemo Skill release assets" and workflow_dispatch
  assert.match(workflow, /Package XMemo Skill release assets/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /release_tag/);

  // Secret isolation: secrets are scoped to specific steps, not in job-level env
  assert.doesNotMatch(workflow, /environment:\s*skillhub/);
  const jobEnvMatch = workflow.match(/runs-on:\s*ubuntu-latest\s*\r?\n\s*env:\s*\r?\n([\s\S]*?)\r?\n\s*steps:/);
  assert.ok(jobEnvMatch, 'job-level env block should exist');
  const jobEnv = jobEnvMatch[1];
  assert.doesNotMatch(jobEnv, /SKILLHUB_KEY/);
  assert.doesNotMatch(jobEnv, /GH_TOKEN/);
  assert.match(workflow, /- name: Download and extract Release archive[\s\S]*?GH_TOKEN:\s*\${{\s*github\.token\s*}}/);
  assert.match(workflow, /gh release download "\$RELEASE_TAG" --repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /- name: Authenticate to skillhub\.cn[\s\S]*?SKILLHUB_KEY:\s*\${{\s*secrets\.SKILLHUB_KEY\s*}}/);

  // Script injection hardening: display_title fallback eliminated, inputs passed via env
  assert.doesNotMatch(workflow, /display_title/);
  const steps = workflow.split(/^\s*-\s*name:/m).slice(1);
  for (const step of steps) {
    const runMatch = step.match(/^\s*run:\s*\|?\s*\r?\n([\s\S]*?)(?=^\s*[a-z_-]+:|$)/m);
    if (runMatch) {
      assert.doesNotMatch(runMatch[1], /\${{\s*vars\.XMEMO_SKILL_SKILLHUB_PUBLISH\s*}}/);
      assert.doesNotMatch(runMatch[1], /\${{\s*github\.event\.workflow_run/);
    }
  }

  // Safe installer and frontmatter injection
  assert.match(workflow, /curl -fsSL https:\/\/skillhub\.cn\/install\/install\.sh/);
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /--cli-only/);
  assert.match(workflow, /node --input-type=module -/);
  assert.match(workflow, /slug/);
  assert.match(workflow, /displayName/);
  assert.match(workflow, /license/);
  assert.match(workflow, /iconUrl/);
  assert.match(workflow, /console\.log\(newFrontmatter\)/);

  // Payload integrity check hardening: does not abort on diff non-zero exit under pipefail
  assert.match(workflow, /cmp -s "\$GITHUB_WORKSPACE\/baseline\.files" "\$GITHUB_WORKSPACE\/updated\.files"/);
  assert.match(workflow, /diff_out="\$\(diff -u "\$GITHUB_WORKSPACE\/baseline\.sha256" "\$GITHUB_WORKSPACE\/updated\.sha256" \|\| true\)"/);
});

test('skillhub frontmatter injection logic preserves original SKILL.md and adds required keys', async () => {
  const skillPath = path.join(repoRoot, 'skills/xmemo/SKILL.md');
  const content = await readFile(skillPath, 'utf8');

  const semver = '1.1.33';
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fmMatch, 'Frontmatter delimiter not found in real SKILL.md');

  const originalFrontmatter = fmMatch[1];
  const originalBody = content.slice(fmMatch[0].length);

  const descMatch = originalFrontmatter.match(/^description:\s*([\s\S]+?)$/m);
  let summary = descMatch ? descMatch[1].trim() : '';
  if ((summary.startsWith('"') && summary.endsWith('"')) || (summary.startsWith("'") && summary.endsWith("'"))) {
    summary = summary.slice(1, -1);
  }

  const appendedLines = [
    `displayName: ${JSON.stringify('XMemo Memory')}`,
    `slug: ${JSON.stringify('xmemo')}`,
    `version: ${JSON.stringify(semver)}`,
    `summary: ${JSON.stringify(summary)}`,
    `license: ${JSON.stringify('MIT')}`,
    `iconUrl: ${JSON.stringify('https://xmemo.dev/xmemo-claude-connector-icon.png')}`,
  ];

  const newFrontmatter = [
    '---',
    originalFrontmatter.trimEnd(),
    ...appendedLines,
    '---',
  ].join('\n');

  const updatedContent = newFrontmatter + originalBody;

  // Verify original name and description lines are unchanged
  assert.match(originalFrontmatter, /^name:\s*xmemo-memory$/m);
  assert.match(newFrontmatter, /^name:\s*xmemo-memory$/m);
  const origDescLine = originalFrontmatter.match(/^description:\s*.+$/m)?.[0];
  assert.ok(origDescLine);
  assert.ok(newFrontmatter.includes(origDescLine));

  // Verify the required platform keys are present
  assert.match(newFrontmatter, /^displayName:\s*"XMemo Memory"$/m);
  assert.match(newFrontmatter, /^slug:\s*"xmemo"$/m);
  assert.match(newFrontmatter, /^version:\s*"1\.1\.33"$/m);
  assert.match(newFrontmatter, /^summary:\s*"/m);
  assert.match(newFrontmatter, /^license:\s*"MIT"$/m);
  assert.match(newFrontmatter, /^iconUrl:\s*"https:\/\/xmemo\.dev\/xmemo-claude-connector-icon\.png"$/m);

  // Verify body is byte-identical
  const updatedFmMatch = updatedContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const updatedBody = updatedContent.slice(updatedFmMatch[0].length);
  assert.strictEqual(updatedBody, originalBody);
});
