import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { hasFlag, optionValue, parseIntegerInRange, parsePositiveInteger } from '../core/args.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import { booleanInput, readJsonInput, rejectInputFlagConflicts } from '../api/input.js';
import { createReadReceipt, readAndValidateReceipt } from '../api/read-receipt.js';
import { InterruptedError, PartialCompletionError, ServiceClientError, UnknownOutcomeError, errorToExitCode } from '../api/errors.js';
import { writeFailure, writeSuccess } from '../api/envelope.js';
import { serviceContext } from '../api/service-context.js';
import { readDocumentInput } from '../api/upload-input.js';
import { readTextFileBounded } from '../api/text-input.js';
import { writeServiceHelpSchema } from '../api/contracts/help-schema.js';
import { sleep } from '../core/runtime.js';
import { assertKnownOptions, assertNoUnknownInputFields } from '../api/input.js';
import { writeHumanServiceResult } from '../api/service-output.js';
import { confirmRemoteAction } from '../api/confirmation.js';

export async function knowledgeCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || hasFlag(args, '--help')) {
    if (subcommand !== 'help' && hasFlag(args, '--json') && writeServiceHelpSchema(io, `knowledge.${subcommand}`)) return 0;
    writeLine(io.stdout, 'Knowledge commands:');
    writeLine(io.stdout, '  xmemo knowledge add --base <id> (--text <text>|--file <path>|--document <id>) [--publish --yes] [--json]');
    writeLine(io.stdout, '  xmemo knowledge search <query> [--base <id>] [--cursor <cursor>] [--json]');
    writeLine(io.stdout, '  xmemo knowledge read <item-id> [--offset <n>] [--limit-chars <n>] [--json]');
    writeLine(io.stdout, '  xmemo knowledge update <item-id> --from <view.json> [--text <text>|--file <path>|--document <id> --document-version <n>] [--publish --yes] [--json]');
    return 0;
  }
  if (subcommand === 'add') return await run('knowledge.add', args.slice(1), io, addKnowledge);
  if (subcommand === 'search') return await run('knowledge.search', args.slice(1), io, searchKnowledge);
  if (subcommand === 'read') return await run('knowledge.read', args.slice(1), io, readKnowledge);
  if (subcommand === 'update') return await run('knowledge.update', args.slice(1), io, updateKnowledge);
  throw new UsageError(`Unknown knowledge command: ${subcommand}`);
}

async function addKnowledge(args, io, context) {
  assertKnownOptions(args, ['--base', '--create-base', '--title', '--text', '--file', '--document', '--document-version', '--team', '--publish', '--yes', '--wait-timeout', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['knowledge_base_id', 'title', 'content', 'document_id', 'document_version', 'team_id', 'publish']);
  rejectInputFlagConflicts(input, [['--base', 'knowledge_base_id'], ['--title', 'title'], ['--text', 'content'], ['--document', 'document_id'], ['--document-version', 'document_version'], ['--team', 'team_id'], ['--publish', 'publish']], args);
  const explicitBaseId = optionValue(args, '--base') ?? input?.knowledge_base_id;
  const createBaseName = optionValue(args, '--create-base');
  if (explicitBaseId && createBaseName) throw new UsageError('--base and --create-base are mutually exclusive.');
  let knowledgeBaseId = explicitBaseId ?? (!createBaseName ? io.env.XMEMO_KNOWLEDGE_BASE_ID : null);
  let createdBase = null;
  const title = optionValue(args, '--title') ?? input?.title ?? 'Untitled knowledge item';
  const teamId = optionValue(args, '--team') ?? input?.team_id;
  const publish = hasFlag(args, '--publish') || booleanInput(input, 'publish');
  const text = optionValue(args, '--text') ?? input?.content;
  const filePath = optionValue(args, '--file');
  const documentId = optionValue(args, '--document') ?? input?.document_id;
  parseIntegerInRange(optionValue(args, '--wait-timeout') ?? 120000, '--wait-timeout', { min: 1, max: 2_147_483_647 });
  if ([Boolean(text), Boolean(filePath), Boolean(documentId)].filter(Boolean).length !== 1) {
    throw new UsageError('knowledge add requires exactly one of --text, --file, or --document.');
  }
  let preparedDocument = null;
  let preparedText = text;
  if (filePath) {
    if (isTextFile(filePath)) {
      preparedText = await readTextFile(filePath);
    } else {
      preparedDocument = await readDocumentInput(filePath);
    }
  }
  let documentVersion = null;
  if (documentId) {
    documentVersion = parseIntegerInRange(input?.document_version ?? optionValue(args, '--document-version'), '--document-version', { min: 1, max: Number.MAX_SAFE_INTEGER });
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 500) throw new UsageError('knowledge add requires a title of 1..500 characters.');
  if (preparedText !== undefined && preparedText !== null && (typeof preparedText !== 'string' || !preparedText.trim() || preparedText.length > 500000)) throw new UsageError('knowledge add content must contain 1..500000 characters.');
  if (!knowledgeBaseId && !createBaseName) {
    knowledgeBaseId = await selectKnowledgeBase(context, io, teamId, hasFlag(args, '--json'));
  }
  if (knowledgeBaseId && (preparedDocument || (!explicitBaseId && io.env.XMEMO_KNOWLEDGE_BASE_ID))) {
    await context.client.request({ method: 'GET', path: `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`, query: compact({ team_id: teamId }), retry: 'bounded' });
  }
  if (documentId) {
    const document = (await context.client.request({ method: 'GET', path: `/api/v1/documents/${encodeURIComponent(documentId)}`, query: compact({ bucket: 'private', team_id: teamId }), retry: 'bounded' })).data;
    if (document?.extraction_status !== 'succeeded' || document.version !== documentVersion) throw new UsageError('Document must have completed extraction at the requested version before creating a knowledge snapshot.');
  }
  if (publish) await confirmRemoteAction(args, io, 'Publish this knowledge item?');
  if (!knowledgeBaseId && createBaseName) {
    const baseResponse = await context.client.request({ method: 'POST', path: '/api/v1/knowledge-bases', body: { name: createBaseName, team_id: optionValue(args, '--team') ?? input?.team_id }, sideEffect: true });
    createdBase = baseResponse.data;
    knowledgeBaseId = createdBase?.knowledge_base_id ?? createdBase?.id;
    if (!knowledgeBaseId) throw new PartialCompletionError('Knowledge base was created but its ID was not returned.', { data: { createdBase } });
  }
  let data;
  let uploadedDocument = null;
  try {
    if (documentId) {
      data = await createFromDocument(context, knowledgeBaseId, documentId, documentVersion, title, publish, teamId);
    } else if (filePath && !isTextFile(filePath)) {
      uploadedDocument = await uploadDocument(context, preparedDocument, teamId);
      const extracted = await waitForDocumentExtraction(context, uploadedDocument, args, teamId);
      const finalDocument = extracted ?? uploadedDocument;
      if (finalDocument.extraction_status !== 'succeeded') throw new PartialCompletionError('Document upload completed but extraction did not succeed.', { data: { document: finalDocument } });
      uploadedDocument = finalDocument;
      if (!Number.isSafeInteger(finalDocument.version) || finalDocument.version < 1) throw new PartialCompletionError('Extracted Document did not return its version; snapshot creation was not attempted.', { data: { document: finalDocument } });
      data = await createFromDocument(context, knowledgeBaseId, finalDocument.document_id, finalDocument.version, title, publish, teamId);
    } else {
      const response = await context.client.request({ method: 'POST', path: `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/items`, body: compact({ title, content: preparedText, status: publish ? 'published' : 'draft', team_id: teamId }), sideEffect: true });
      data = response.data;
    }
  } catch (error) {
    if (createdBase || uploadedDocument) {
      if (error instanceof UnknownOutcomeError || error?.code === 'LOCAL_WAIT_TIMEOUT' || error?.code === 'INTERRUPTED') {
        error.data = { base: createdBase, document: uploadedDocument, ...(error.data ?? {}) };
        throw error;
      }
      throw new PartialCompletionError('Knowledge add completed an earlier remote step but did not create the final item.', { cause: error, data: { base: createdBase, document: uploadedDocument, error: { code: error.code, message: error.message } } });
    }
    throw error;
  }
  return { data: compact({ base: createdBase, document: uploadedDocument, item: data }) };
}

async function searchKnowledge(args, io, context) {
  assertKnownOptions(args, ['--base', '--team', '--limit', '--cursor', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['query', 'knowledge_base_id', 'limit', 'cursor', 'mode', 'alpha', 'query_embedding', 'k', 'team_id', 'scope']);
  rejectInputFlagConflicts(input, [['--base', 'knowledge_base_id'], ['--limit', 'limit'], ['--cursor', 'cursor'], ['--team', 'team_id']], args);
  const query = positional(args) ?? input?.query;
  if (positional(args) && input?.query !== undefined) throw new UsageError('Search query cannot be supplied both positionally and in --input.');
  if (!query) throw new UsageError('knowledge search requires a query.');
  const rawLimit = optionValue(args, '--limit') ?? input?.limit;
  const response = await context.client.request({ method: 'POST', path: '/api/v1/knowledge/search', body: compact({ ...input, query, knowledge_base_id: optionValue(args, '--base') ?? input?.knowledge_base_id, limit: rawLimit === undefined || rawLimit === null ? undefined : parseIntegerInRange(rawLimit, '--limit', { min: 1, max: 100 }), cursor: optionValue(args, '--cursor') ?? input?.cursor ?? '', team_id: optionValue(args, '--team') ?? input?.team_id }), sideEffect: false, retry: 'bounded' });
  return response;
}

async function readKnowledge(args, io, context) {
  assertKnownOptions(args, ['--from', '--team', '--offset', '--limit-chars', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['item_id', 'from', 'team_id', 'offset', 'limit_chars']);
  rejectInputFlagConflicts(input, [['--from', 'from'], ['--team', 'team_id'], ['--offset', 'offset'], ['--limit-chars', 'limit_chars']], args);
  const positionalItemId = positional(args);
  if (positionalItemId && input?.item_id !== undefined) throw new UsageError('Knowledge item ID cannot be supplied both positionally and in --input.');
  const itemId = positionalItemId ?? input?.item_id;
  if (!itemId) throw new UsageError('knowledge read requires an item ID.');
  const teamId = optionValue(args, '--team') ?? input?.team_id;
  const offset = parseIntegerInRange(optionValue(args, '--offset') ?? input?.offset ?? 0, '--offset', { min: 0, max: 2_147_483_647 });
  const limitChars = parseIntegerInRange(optionValue(args, '--limit-chars') ?? input?.limit_chars ?? 100000, '--limit-chars', { min: 1, max: 100000 });
  const fromPath = optionValue(args, '--from') ?? input?.from;
  if (offset > 0 && !fromPath) throw new UsageError('Continuation pages require --from <previous-read.json> to pin the viewed revision.');
  const previous = fromPath ? await readAndValidateReceipt(fromPath, { baseUrl: context.baseUrl, resource: `knowledge-item:${itemId}`, scope: teamId ?? 'personal' }) : null;
  const item = previous ? { item_id: itemId, current_revision_id: previous.displayedRevision, version: previous.version, status: previous.itemStatus, source_type: previous.sourceType } : (await context.client.request({ method: 'GET', path: `/api/v1/knowledge-items/${encodeURIComponent(itemId)}`, query: compact({ team_id: teamId }), retry: 'bounded' })).data;
  const revisionId = previous?.displayedRevision ?? item?.current_revision_id;
  if (!revisionId) throw new ServiceClientError('Knowledge item did not return current_revision_id.', { code: 'INVALID_RESPONSE' });
  const revisionResponse = await context.client.request({ method: 'GET', path: `/api/v1/knowledge-items/${encodeURIComponent(itemId)}/revisions/${encodeURIComponent(revisionId)}`, query: compact({ offset, limit_chars: limitChars, team_id: teamId }), retry: 'bounded' });
  const revision = revisionResponse.data;
  const receipt = createReadReceipt({ baseUrl: context.baseUrl, resource: `knowledge-item:${itemId}`, scope: teamId ?? 'personal', revision: revisionId, version: item.version, itemStatus: item.status, content: revision?.canonical_content, sourceType: item.source_type, sourceRef: revision?.source_ref ?? previous?.sourceRef });
  return { data: { item, revision }, meta: { readReceipt: receipt } };
}

async function updateKnowledge(args, io, context) {
  assertKnownOptions(args, ['--from', '--text', '--file', '--document', '--document-version', '--publish', '--yes', '--team', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['item_id', 'from', 'content', 'document_id', 'document_version', 'team_id', 'publish']);
  rejectInputFlagConflicts(input, [['--from', 'from'], ['--text', 'content'], ['--document', 'document_id'], ['--document-version', 'document_version'], ['--team', 'team_id'], ['--publish', 'publish']], args);
  if (positional(args) && input?.item_id !== undefined) throw new UsageError('Knowledge item ID cannot be supplied both positionally and in --input.');
  const itemId = positional(args) ?? input?.item_id;
  if (!itemId) throw new UsageError('knowledge update requires an item ID.');
  const fromPath = optionValue(args, '--from') ?? input?.from;
  if (!fromPath) throw new UsageError('knowledge update requires --from <view.json>.');
  const teamId = optionValue(args, '--team') ?? input?.team_id;
  const receipt = await readAndValidateReceipt(fromPath, { baseUrl: context.baseUrl, resource: `knowledge-item:${itemId}`, scope: teamId ?? 'personal' });
  if (receipt.latestRevision && receipt.displayedRevision !== receipt.latestRevision) throw new UsageError('The viewed knowledge revision is not the latest maintenance revision; run knowledge read again.');
  const publish = hasFlag(args, '--publish') || booleanInput(input, 'publish');
  if (receipt.itemStatus === 'published' && !publish) throw new UsageError('Updating a published knowledge item requires explicit --publish --yes; the service has no independent draft path.');
  const text = optionValue(args, '--text') ?? input?.content;
  const filePath = optionValue(args, '--file');
  const documentId = optionValue(args, '--document') ?? input?.document_id;
  const sourceCount = [Boolean(text), Boolean(filePath), Boolean(documentId)].filter(Boolean).length;
  if (sourceCount > 1 || (sourceCount === 0 && !publish)) {
    throw new UsageError('knowledge update requires one of --text, --file, or --document, unless --publish alone is publishing an existing draft.');
  }
  if (filePath && !isTextFile(filePath)) {
    throw new UsageError('Binary replacement requires a new version of the same Document; this server contract is not yet available. Use --document <same-id> --document-version <n> only if that version already exists.');
  }
  if (sourceCount && !receipt.sourceType) throw new UsageError('Read receipt lacks source metadata; run knowledge read again before updating content.');
  if (documentId && (receipt.sourceType !== 'file' || receipt.sourceRef !== `document:${documentId}`)) throw new UsageError('Document updates must preserve the reviewed file source and Document ID.');
  if (!documentId && sourceCount && receipt.sourceType === 'file') throw new UsageError('File-backed knowledge cannot be replaced with text; use the same source Document and its version.');
  if (!documentId && (optionValue(args, '--document-version') || input?.document_version !== undefined)) throw new UsageError('--document-version requires --document.');
  if (sourceCount === 0 && receipt.itemStatus === 'published') throw new UsageError('The reviewed knowledge item is already published; provide new content to update it.');
  if (publish) await confirmRemoteAction(args, io, 'Publish these knowledge changes?');
  let data = {};
  if (sourceCount === 1) {
    let contentResponse;
    if (documentId) {
      const documentVersion = parseIntegerInRange(optionValue(args, '--document-version') ?? input?.document_version, '--document-version', { min: 1, max: Number.MAX_SAFE_INTEGER });
      contentResponse = await context.client.request({
        method: 'PUT',
        path: `/api/v1/knowledge-items/${encodeURIComponent(itemId)}/content/from-document`,
        body: { document_id: documentId, expected_document_version: documentVersion, expected_current_revision_id: receipt.displayedRevision, team_id: teamId },
        sideEffect: true
      });
    } else {
      const content = text ?? await readTextFile(filePath);
      if (typeof content !== 'string' || !content.trim() || content.length > 500000) throw new UsageError('knowledge update content must contain 1..500000 characters.');
      contentResponse = await context.client.request({ method: 'PUT', path: `/api/v1/knowledge-items/${encodeURIComponent(itemId)}/content`, body: { expected_current_revision_id: receipt.displayedRevision, canonical_content: content, team_id: teamId }, sideEffect: true });
    }
    data.content = contentResponse.data;
  }
  if (publish && receipt.itemStatus !== 'published') {
    const updatedVersion = sourceCount ? (data.content?.version ?? data.content?.item?.version) : receipt.version;
    if (!Number.isInteger(Number(updatedVersion)) || Number(updatedVersion) < 1) {
      if (!sourceCount) throw new UsageError('Knowledge read receipt has no item version; run knowledge read again.');
      throw new PartialCompletionError('Knowledge content was updated but the new item version was not returned; publish was not attempted.', { data });
    }
    try {
      const statusResponse = await context.client.request({ method: 'PATCH', path: `/api/v1/knowledge-items/${encodeURIComponent(itemId)}`, body: { expected_version: Number(updatedVersion), status: 'published', team_id: teamId }, sideEffect: true });
      data.status = statusResponse.data;
    } catch (error) {
      if (!sourceCount) throw error;
      if (error instanceof UnknownOutcomeError) {
        error.data = { ...(error.data ?? {}), ...data };
        throw error;
      }
      throw new PartialCompletionError('Knowledge content was updated but publishing failed.', { cause: error, data: { ...data, publishError: { code: error.code, message: error.message } } });
    }
  }
  return { data };
}

async function readTextFile(filePath) {
  const content = await readTextFileBounded(filePath, 'knowledge content');
  if (content.length > 500000) throw new UsageError('Knowledge content exceeds the 500000-character limit.');
  return content;
}

async function createFromDocument(context, baseId, documentId, documentVersion, title, publish, teamId) {
  const response = await context.client.request({ method: 'POST', path: `/api/v1/knowledge-bases/${encodeURIComponent(baseId)}/items/from-document`, body: { document_id: documentId, expected_document_version: documentVersion, title, status: publish ? 'published' : 'draft', team_id: teamId }, sideEffect: true });
  return response.data;
}

async function uploadDocument(context, document, teamId) {
  const response = await context.client.request({ method: 'POST', path: '/api/v1/documents', body: { filename: document.filename, content_base64: document.contentBase64, bucket: 'private', team_id: teamId }, sideEffect: true });
  return response.data;
}

async function waitForDocumentExtraction(context, document, args, teamId) {
  if (!document?.document_id) throw new PartialCompletionError('Document upload returned no document ID.', { data: { document } });
  let current = document;
  const status = () => String(current?.extraction_status ?? '').toLowerCase();
  if (status() === 'succeeded' || status() === 'failed' || status() === 'dead_letter') return current;
  const timeoutMs = parsePositiveInteger(optionValue(args, '--wait-timeout') ?? '120000', '--wait-timeout');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (context.signal?.aborted) throw new InterruptedError('Local extraction wait interrupted; the uploaded Document remains available.', { data: { document: current }, nextAction: `Run knowledge add again with --document ${document.document_id} --document-version ${current?.version ?? document.version ?? 1} after extraction completes.` });
    await sleep(250);
    try {
      current = (await context.client.request({ method: 'GET', path: `/api/v1/documents/${encodeURIComponent(document.document_id)}`, query: compact({ bucket: 'private', team_id: teamId }), retry: 'bounded', timeoutMs: Math.max(1, deadline - Date.now()) })).data;
    } catch (error) {
      error.data = { document: current, ...(error.data ?? {}) };
      if (error.code === 'REQUEST_TIMEOUT' && Date.now() >= deadline) error.code = 'LOCAL_WAIT_TIMEOUT';
      throw error;
    }
    if (['succeeded', 'failed', 'dead_letter'].includes(status())) return current;
  }
  throw new ServiceClientError('Local extraction wait timed out; the uploaded Document remains available.', { code: 'LOCAL_WAIT_TIMEOUT', outcome: 'known-failure', data: { document: current }, nextAction: `Run knowledge add again with --document ${document.document_id} --document-version ${current?.version ?? document.version ?? 1} after extraction completes.` });
}

async function run(command, args, io, handler) {
  const outputJson = hasFlag(args, '--json');
  try {
    const context = await serviceContext(args, io);
    const response = await handler(args, io, context);
    const data = Object.hasOwn(response, 'data') ? response.data : response;
    const meta = { ...response?.meta, nextCursor: response?.meta?.nextCursor ?? data?.next_cursor ?? null };
    if (outputJson) writeSuccess(io, command, data, meta);
    else writeHumanServiceResult(io, command, data, meta);
    return 0;
  } catch (error) {
    if (outputJson) writeFailure(io, command, error);
    else writeLine(io.stderr, `Error: ${error.message}`);
    return errorToExitCode(error);
  }
}

function positional(args) {
  const optionsWithValue = new Set(['--input', '--base', '--title', '--text', '--file', '--document', '--document-version', '--team', '--limit', '--cursor', '--offset', '--limit-chars', '--from', '--timeout-ms', '--base-url', '--url']);
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith('--')) return args[index];
    if (optionsWithValue.has(args[index])) index += 1;
  }
  return null;
}

async function selectKnowledgeBase(context, io, teamId, outputJson) {
  if (outputJson || (!io.stdin?.isTTY && typeof io.selectKnowledgeBase !== 'function')) {
    throw new UsageError('knowledge add requires --base, --create-base, or XMEMO_KNOWLEDGE_BASE_ID in non-interactive mode.');
  }
  const response = await context.client.request({ method: 'GET', path: '/api/v1/knowledge-bases', query: compact({ team_id: teamId, include_archived: false, limit: 100, cursor: '' }), retry: 'bounded' });
  if (response.data?.next_cursor) writeLine(io.stderr, 'Showing the first 100 bases. For another base, rerun with its explicit --base ID.');
  const bases = Array.isArray(response.data) ? response.data : response.data?.items;
  if (!Array.isArray(bases) || bases.length === 0) throw new UsageError('No active knowledge base is available. Use --create-base <name>.');
  bases.forEach((base, index) => writeLine(io.stderr, `  ${index + 1}. ${base.name ?? 'Unnamed'} (${base.knowledge_base_id ?? base.id})`));
  let selected;
  if (typeof io.selectKnowledgeBase === 'function') {
    selected = await io.selectKnowledgeBase(bases);
  } else {
    const prompt = createInterface({ input: io.stdin, output: io.stderr });
    try {
      selected = await prompt.question('Select a knowledge base number: ');
    } finally {
      prompt.close();
    }
  }
  const index = parseIntegerInRange(String(selected).trim(), 'knowledge base selection', { min: 1, max: bases.length }) - 1;
  const base = bases[index];
  const baseId = base?.knowledge_base_id ?? base?.id;
  if (!Number.isInteger(index) || index < 0 || index >= bases.length || !baseId) throw new UsageError('Invalid knowledge base selection.');
  return String(baseId);
}

function isTextFile(filePath) {
  return /\.(?:md|markdown|txt)$/i.test(filePath);
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}
