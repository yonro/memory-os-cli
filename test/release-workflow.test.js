import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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