import { hasFlag, optionValue, parseIntegerInRange } from '../core/args.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import { readAndValidateReceipt, createReadReceipt } from '../api/read-receipt.js';
import { assertKnownOptions, assertNoUnknownInputFields, booleanInput, readJsonInput, rejectInputFlagConflicts } from '../api/input.js';
import { ServiceClientError, UnknownOutcomeError, errorToExitCode } from '../api/errors.js';
import { writeFailure, writeSuccess } from '../api/envelope.js';
import { serviceContext } from '../api/service-context.js';
import { writeServiceHelpSchema } from '../api/contracts/help-schema.js';
import { collectSkillFiles, readSkillFile } from '../api/upload-input.js';
import { writeHumanServiceResult } from '../api/service-output.js';
import { confirmRemoteAction } from '../api/confirmation.js';

export async function cloudSkillCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || hasFlag(args, '--help')) {
    if (subcommand !== 'help' && hasFlag(args, '--json') && writeServiceHelpSchema(io, `cloud-skill.${subcommand}`)) return 0;
    writeLine(io.stdout, 'Cloud Skill commands:');
    writeLine(io.stdout, '  xmemo cloud-skill add --file SKILL.md|--dir <folder> [--publish --yes] [--json]');
    writeLine(io.stdout, '  xmemo cloud-skill list [--team <id>] [--json]');
    writeLine(io.stdout, '  xmemo cloud-skill show <skill-id> [--draft] [--json]');
    writeLine(io.stdout, '  xmemo cloud-skill update <skill-id> --from <view.json> --file|--dir ... [--json]');
    writeLine(io.stdout, '  xmemo cloud-skill run <skill-id> [--script <path>] --input <args.json> --from <view.json> --yes [--json]');
    return 0;
  }
  if (subcommand === 'add') return await run('cloud-skill.add', args.slice(1), io, addSkill);
  if (subcommand === 'list') return await run('cloud-skill.list', args.slice(1), io, listSkills);
  if (subcommand === 'show') return await run('cloud-skill.show', args.slice(1), io, showSkill);
  if (subcommand === 'update') return await run('cloud-skill.update', args.slice(1), io, updateSkill);
  if (subcommand === 'run') return await run('cloud-skill.run', args.slice(1), io, runSkill);
  throw new UsageError(`Unknown cloud-skill command: ${subcommand}`);
}

async function addSkill(args, io, context) {
  assertKnownOptions(args, ['--file', '--dir', '--name', '--slug', '--publish', '--yes', '--team', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['name', 'slug', 'team_id', 'publish']);
  rejectInputFlagConflicts(input, [['--name', 'name'], ['--slug', 'slug'], ['--team', 'team_id'], ['--publish', 'publish']], args);
  const publish = hasFlag(args, '--publish') || booleanInput(input, 'publish');
  const files = await readSkillSource(args);
  showUploadManifest(io, files);
  const body = compact({
    markdown_content: files.rootMarkdown,
    sub_files: files.subFiles,
    name: optionValue(args, '--name') ?? input?.name,
    slug: optionValue(args, '--slug') ?? input?.slug,
    publish,
    team_id: optionValue(args, '--team') ?? input?.team_id
  });
  if (publish) await confirmRemoteAction(args, io, 'Publish this Cloud Skill?');
  const response = await context.client.request({
    method: 'POST', path: '/v1/skills/create', body, sideEffect: true,
    operation: { contractRequired: true, name: 'Cloud Skill create-only' }
  });
  assertWriteReceipt(response.data);
  return { data: response.data, meta: { uploadManifest: manifest(files), warnings: [`Uploaded ${files.included.length} validated file(s); omitted paths were not sent.`] } };
}

async function updateSkill(args, io, context) {
  assertKnownOptions(args, ['--file', '--dir', '--from', '--publish', '--yes', '--team', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['skill_id', 'from', 'team_id', 'publish']);
  rejectInputFlagConflicts(input, [['--from', 'from'], ['--team', 'team_id'], ['--publish', 'publish']], args);
  const positionalSkillId = positional(args);
  if (positionalSkillId && input?.skill_id !== undefined) throw new UsageError('Cloud Skill ID cannot be supplied both positionally and in --input.');
  const skillId = positionalSkillId ?? input?.skill_id;
  const fromPath = optionValue(args, '--from') ?? input?.from;
  if (!skillId || !fromPath) throw new UsageError('cloud-skill update requires <skill-id> and --from <view.json>.');
  const publish = hasFlag(args, '--publish') || booleanInput(input, 'publish');
  const teamId = optionValue(args, '--team') ?? input?.team_id;
  const receipt = await readAndValidateReceipt(fromPath, { baseUrl: context.baseUrl, resource: `cloud-skill:${skillId}`, scope: teamId ?? 'personal' });
  if (!receipt.displayedRevision) throw new UsageError('Cloud Skill read receipt lacks a revision; run cloud-skill show again.');
  if (receipt.latestRevision !== receipt.displayedRevision) {
    throw new UsageError('The viewed Cloud Skill draft is no longer the latest revision; run cloud-skill show --draft again.');
  }
  const hasSource = Boolean(optionValue(args, '--file') || optionValue(args, '--dir'));
  if (!hasSource && !publish) throw new UsageError('cloud-skill update requires --file/--dir, or --publish to publish the reviewed revision.');
  const files = hasSource ? await readSkillSource(args) : null;
  if (files) showUploadManifest(io, files);
  const body = compact({
    expected_revision_id: receipt.displayedRevision,
    markdown_content: files?.rootMarkdown,
    sub_files: files?.subFiles,
    publish,
    team_id: teamId
  });
  if (publish) await confirmRemoteAction(args, io, 'Publish these Cloud Skill changes?');
  const response = await context.client.request({
    method: 'PUT', path: `/v1/skills/${encodeURIComponent(skillId)}/content`, body, sideEffect: true,
    operation: { contractRequired: true, name: 'Cloud Skill content-CAS update' }
  });
  assertWriteReceipt(response.data);
  return { data: response.data, meta: { uploadManifest: files ? manifest(files) : null, warnings: files ? [`Uploaded ${files.included.length} validated file(s); preservation of omitted paths requires the MOS-01 server contract.`] : [] } };
}

async function listSkills(args, io, context) {
  assertKnownOptions(args, ['--team', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['team_id']);
  rejectInputFlagConflicts(input, [['--team', 'team_id']], args);
  const response = await context.client.request({ method: 'GET', path: '/v1/skills', query: compact({ team_id: optionValue(args, '--team') ?? input?.team_id }), retry: 'bounded' });
  return response;
}

async function showSkill(args, io, context) {
  assertKnownOptions(args, ['--draft', '--team', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['skill_id', 'draft', 'team_id']);
  rejectInputFlagConflicts(input, [['--draft', 'draft'], ['--team', 'team_id']], args);
  const positionalSkillId = positional(args);
  if (positionalSkillId && input?.skill_id !== undefined) throw new UsageError('Cloud Skill ID cannot be supplied both positionally and in --input.');
  const skillId = positionalSkillId ?? input?.skill_id;
  if (!skillId) throw new UsageError('cloud-skill show requires a skill ID.');
  const teamId = optionValue(args, '--team') ?? input?.team_id;
  let showDraft = hasFlag(args, '--draft') || booleanInput(input, 'draft');
  const detail = await context.client.request({ method: 'GET', path: `/v1/skills/${encodeURIComponent(skillId)}`, query: compact({ team_id: teamId }), retry: 'bounded' });
  const publishedRevision = detail.data?.published_revision;
  const latestRevision = detail.data?.latest_revision;
  if (!showDraft && !publishedRevision?.revision_id) {
    showDraft = true;
  }
  const targetRevision = showDraft ? latestRevision?.revision_id : publishedRevision?.revision_id;
  if (!targetRevision) throw new ServiceClientError('Cloud Skill has no readable revision.', { code: 'INVALID_RESPONSE' });
  const components = await context.client.request({ method: 'GET', path: `/v1/skills/${encodeURIComponent(skillId)}/components`, query: compact({ team_id: teamId, revision_id: targetRevision }), retry: 'bounded' });
  const displayedRevision = targetRevision ?? null;
  const displayedRevisionData = showDraft ? latestRevision : publishedRevision;
  const receipt = createReadReceipt({ baseUrl: context.baseUrl, resource: `cloud-skill:${skillId}`, scope: teamId ?? 'personal', revision: displayedRevision, latestRevision: latestRevision?.revision_id ?? detail.data?.skill?.latest_revision_id, revisionStatus: String(displayedRevisionData?.status ?? (showDraft ? 'draft' : 'published')).toLowerCase(), revisionKind: showDraft ? 'draft' : 'published' });
  return { data: { skill: detail.data?.skill, displayed_revision: displayedRevisionData, components: components.data, executable: !showDraft && scriptCandidates(components.data).length > 0 }, meta: { readReceipt: receipt, warnings: showDraft ? ['This is a maintenance view; run requires a published view.'] : latestRevision?.revision_id !== targetRevision ? ['A newer maintenance revision exists; use show --draft before update.'] : [] } };
}

async function runSkill(args, io, context) {
  assertKnownOptions(args, ['--script', '--input', '--from', '--yes', '--team', '--timeout-seconds', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const skillId = positional(args);
  const fromPath = optionValue(args, '--from');
  const inputPath = optionValue(args, '--input');
  if (!skillId || !fromPath || !inputPath) throw new UsageError('cloud-skill run requires <skill-id>, --input <args.json>, and --from <view.json>.');
  const teamId = optionValue(args, '--team');
  const receipt = await readAndValidateReceipt(fromPath, { baseUrl: context.baseUrl, resource: `cloud-skill:${skillId}`, scope: teamId ?? 'personal' });
  if (!receipt.displayedRevision) throw new UsageError('Cloud Skill read receipt lacks a published revision; run cloud-skill show again.');
  if (receipt.revisionStatus !== 'published' || receipt.revisionKind !== 'published') throw new UsageError('Cloud Skill execution requires a published read receipt; run cloud-skill show without --draft.');
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['input_args', 'script_path']);
  if (!input.input_args || typeof input.input_args !== 'object' || Array.isArray(input.input_args)) throw new UsageError('Cloud Skill input JSON must contain an object field named input_args.');
  rejectInputFlagConflicts(input, [['--script', 'script_path']], args);
  const timeoutSeconds = parseIntegerInRange(optionValue(args, '--timeout-seconds') ?? 30, '--timeout-seconds', { min: 1, max: 60 });
  const requestTimeoutMs = parseIntegerInRange(optionValue(args, '--timeout-ms') ?? timeoutSeconds * 1000 + 5000, '--timeout-ms', { min: 1, max: 2_147_483_647 });
  if (requestTimeoutMs < timeoutSeconds * 1000 + 5000) throw new UsageError('--timeout-ms must cover --timeout-seconds plus 5000ms transport overhead.');
  const componentsResponse = await context.client.request({ method: 'GET', path: `/v1/skills/${encodeURIComponent(skillId)}/components`, query: compact({ team_id: teamId, revision_id: receipt.displayedRevision }), retry: 'bounded' });
  const reviewedScripts = scriptCandidates(componentsResponse.data);
  const requestedScript = optionValue(args, '--script') ?? input.script_path;
  if (requestedScript && !reviewedScripts.includes(requestedScript)) throw new UsageError('Requested Cloud Skill script is not present in the reviewed published revision.');
  const scriptPath = requestedScript ?? (reviewedScripts.length === 1 ? reviewedScripts[0] : null);
  if (!scriptPath) throw new UsageError(reviewedScripts.length > 1 ? 'Cloud Skill has multiple scripts; select one with --script.' : 'Cloud Skill has no executable script; use cloud-skill show to read its instructions.');
  await confirmRemoteAction(args, io, `Run Cloud Skill ${skillId}, revision ${receipt.displayedRevision}, script ${scriptPath}, with the supplied input_args?`);
  let response;
  try {
    response = await context.client.request({ method: 'POST', path: `/v1/skills/${encodeURIComponent(skillId)}/execute`, query: compact({ team_id: teamId }), body: { script_path: scriptPath, revision_id: receipt.displayedRevision, input_args: input.input_args, timeout_seconds: timeoutSeconds }, timeoutMs: requestTimeoutMs, sideEffect: true });
  } catch (error) {
    if (error instanceof UnknownOutcomeError) error.data = { skill_id: skillId, revision_id: receipt.displayedRevision, script_path: scriptPath };
    throw error;
  }
  const data = response.data;
  if (String(data?.status ?? '').toLowerCase() !== 'success' || data?.exit_code !== 0) throw new ServiceClientError('Cloud Skill execution returned a business failure.', { code: 'SKILL_EXECUTION_FAILED', httpStatus: 200, data });
  return response;
}

function scriptCandidates(components) {
  const scripts = Array.isArray(components)
    ? components.filter((component) => String(component?.type ?? '').toLowerCase() === 'script')
    : [];
  return [...new Set(scripts.map((component) => String(component?.logical_path ?? '').trim()).filter(Boolean))];
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
  const optionsWithValue = new Set(['--team', '--script', '--input', '--from', '--file', '--dir', '--name', '--slug', '--timeout-seconds', '--timeout-ms', '--base-url', '--url']);
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith('--')) return args[index];
    if (optionsWithValue.has(args[index])) index += 1;
  }
  return null;
}

async function readSkillSource(args) {
  const filePath = optionValue(args, '--file');
  const directory = optionValue(args, '--dir');
  if (Boolean(filePath) === Boolean(directory)) throw new UsageError('Provide exactly one of --file SKILL.md or --dir <folder>.');
  return filePath ? await readSkillFile(filePath) : await collectSkillFiles(directory);
}

function manifest(files) {
  return { included: files.included, excluded: files.excluded ?? [], totalBytes: files.totalBytes };
}

function assertWriteReceipt(data) {
  const revisionId = data?.revision_id ?? data?.revision?.revision_id ?? data?.latest_revision?.revision_id;
  if (typeof revisionId !== 'string' || !revisionId) throw new UnknownOutcomeError('Cloud Skill write returned no revision receipt. Verify the MOS-01 response contract and remote state; no fallback or retry was attempted.');
}

function showUploadManifest(io, files) {
  writeLine(io.stderr, `Cloud Skill upload: ${JSON.stringify(manifest(files))}`);
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}
