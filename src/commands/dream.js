import { hasFlag, optionValue, parseIntegerInRange, parsePositiveInteger } from '../core/args.js';
import { randomUUID } from 'node:crypto';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import { sleep } from '../core/runtime.js';
import { assertKnownOptions, assertNoUnknownInputFields, booleanInput, readJsonInput, rejectInputFlagConflicts } from '../api/input.js';
import { createReadReceipt, readAndValidateReceipt } from '../api/read-receipt.js';
import { InterruptedError, PrerequisiteRequiredError, ServiceClientError, UnknownOutcomeError, errorToExitCode } from '../api/errors.js';
import { writeFailure, writeSuccess } from '../api/envelope.js';
import { serviceContext } from '../api/service-context.js';
import { writeServiceHelpSchema } from '../api/contracts/help-schema.js';
import { writeHumanServiceResult } from '../api/service-output.js';
import { confirmRemoteAction } from '../api/confirmation.js';

export async function dreamCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || hasFlag(args, '--help')) {
    if (subcommand !== 'help' && hasFlag(args, '--json') && writeServiceHelpSchema(io, `dream.${subcommand}`)) return 0;
    writeLine(io.stdout, 'Dream commands:');
    writeLine(io.stdout, '  xmemo dream preview [--window-days <n>] [--wait] [--json]');
    writeLine(io.stdout, '  xmemo dream show <run-id> [--wait] [--json]');
    writeLine(io.stdout, '  xmemo dream apply <run-id> --item <id> --from <view.json> --yes [--json]');
    return 0;
  }
  if (subcommand === 'preview') return await run('dream.preview', args.slice(1), io, previewDream);
  if (subcommand === 'show') return await run('dream.show', args.slice(1), io, showDream);
  if (subcommand === 'apply') return await run('dream.apply', args.slice(1), io, applyDream);
  throw new UsageError(`Unknown dream command: ${subcommand}`);
}

async function previewDream(args, io, context) {
  assertKnownOptions(args, ['--window-days', '--wait', '--wait-timeout', '--idempotency-key', '--team', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['window_days', 'idempotency_key', 'wait', 'wait_timeout', 'team_id']);
  rejectInputFlagConflicts(input, [['--window-days', 'window_days'], ['--idempotency-key', 'idempotency_key'], ['--wait', 'wait'], ['--wait-timeout', 'wait_timeout'], ['--team', 'team_id']], args);
  const teamId = optionValue(args, '--team') ?? input?.team_id;
  const wait = hasFlag(args, '--wait') || booleanInput(input, 'wait');
  const waitTimeout = parseIntegerInRange(optionValue(args, '--wait-timeout') ?? input?.wait_timeout ?? 120000, '--wait-timeout', { min: 1, max: 2_147_483_647 });
  const idempotencyKey = optionValue(args, '--idempotency-key') ?? input?.idempotency_key ?? randomUUID();
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 256) throw new UsageError('idempotency_key must be a non-empty string of at most 256 characters.');
  const rawWindowDays = optionValue(args, '--window-days') ?? input?.window_days;
  const body = compact({ window_days: rawWindowDays === undefined ? undefined : parseIntegerInRange(rawWindowDays, '--window-days', { min: 1, max: 365 }), idempotency_key: idempotencyKey });
  const settingsResponse = await context.client.request({ method: 'GET', path: '/api/v1/me/dream/settings', query: compact({ team_id: teamId }), retry: 'bounded' });
  const settings = settingsResponse.data;
  if (settings?.enabled === false || settings?.mode === 'off' || settings?.entitlement?.can_preview === false) {
    throw new PrerequisiteRequiredError('Dream preview is disabled; CLI will not change Dream settings.', { data: { settings }, nextAction: 'Enable Dream preview in the management UI, then retry.' });
  }
  let response;
  try {
    response = await context.client.request({ method: 'POST', path: '/api/v1/me/dream/runs', query: compact({ team_id: teamId }), body, sideEffect: true });
  } catch (error) {
    if (error instanceof UnknownOutcomeError) {
      error.data = { ...(error.data ?? {}), idempotency_key: idempotencyKey };
    }
    throw error;
  }
  const entitlementAllowsApply = settings?.entitlement?.can_apply !== false;
  const applyAvailable = settings?.enabled !== false && settings?.mode === 'confirm_each_run' && entitlementAllowsApply;
  const applyUnavailableReason = applyAvailable
    ? null
    : settings?.mode !== 'confirm_each_run'
      ? 'Dream settings mode must be confirm_each_run before a preview can be applied.'
      : 'The current entitlement does not allow Dream apply.';
  let result = response.data;
  if (!result?.run?.run_id && !result?.run?.id) throw new UnknownOutcomeError('Dream preview returned no run ID; verify the same idempotency key before retrying.', { data: { idempotency_key: idempotencyKey } });
  if (wait) result = await waitForDream(context, result?.run?.run_id ?? result?.run?.id, args, null, waitTimeout, teamId);
  result = { ...result, applyAvailable, applyUnavailableReason };
  return { data: result };
}

async function showDream(args, io, context) {
  assertKnownOptions(args, ['--wait', '--wait-timeout', '--team', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['run_id', 'wait', 'wait_timeout', 'team_id']);
  rejectInputFlagConflicts(input, [['--wait', 'wait'], ['--wait-timeout', 'wait_timeout'], ['--team', 'team_id']], args);
  const positionalRunId = positional(args);
  if (positionalRunId && input?.run_id !== undefined) throw new UsageError('Dream run ID cannot be supplied both positionally and in --input.');
  const runId = positionalRunId ?? input?.run_id;
  if (!runId) throw new UsageError('dream show requires a run ID.');
  const wait = hasFlag(args, '--wait') || booleanInput(input, 'wait');
  const waitTimeout = parseIntegerInRange(optionValue(args, '--wait-timeout') ?? input?.wait_timeout ?? 120000, '--wait-timeout', { min: 1, max: 2_147_483_647 });
  const teamId = optionValue(args, '--team') ?? input?.team_id;
  let response = await context.client.request({ method: 'GET', path: `/api/v1/me/dream/runs/${encodeURIComponent(runId)}`, query: compact({ team_id: teamId }), retry: 'bounded' });
  if (wait) response = { ...response, data: await waitForDream(context, runId, args, response.data, waitTimeout, teamId) };
  const run = response.data?.run;
  const candidateItemIds = Array.isArray(response.data?.items) ? response.data.items.map((item) => item?.id).filter(Boolean) : [];
  const receipt = createReadReceipt({ baseUrl: context.baseUrl, resource: `dream-run:${runId}`, scope: teamId ?? 'personal', revision: run?.confirmation_version, settingsVersion: run?.settings_version ?? response.data?.settings_version, candidateItemIds });
  return { data: response.data, meta: { readReceipt: receipt } };
}

async function applyDream(args, io, context) {
  assertKnownOptions(args, ['--item', '--from', '--yes', '--team', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['run_id', 'item_id', 'from', 'team_id']);
  rejectInputFlagConflicts(input, [['--item', 'item_id'], ['--from', 'from'], ['--team', 'team_id']], args);
  const positionalRunId = positional(args);
  if (positionalRunId && input?.run_id !== undefined) throw new UsageError('Dream run ID cannot be supplied both positionally and in --input.');
  const runId = positionalRunId ?? input?.run_id;
  const itemId = optionValue(args, '--item') ?? input?.item_id;
  const fromPath = optionValue(args, '--from') ?? input?.from;
  if (!runId || !itemId || !fromPath) throw new UsageError('dream apply requires <run-id>, --item, and --from <view.json>.');
  const teamId = optionValue(args, '--team') ?? input?.team_id;
  const receipt = await readAndValidateReceipt(fromPath, { baseUrl: context.baseUrl, resource: `dream-run:${runId}`, scope: teamId ?? 'personal' });
  if (!receipt.displayedRevision || !receipt.settingsVersion) throw new UsageError('Dream read receipt lacks run/settings versions; run dream show again.');
  if (!Array.isArray(receipt.candidateItemIds) || !receipt.candidateItemIds.includes(String(itemId))) {
    throw new UsageError('The selected Dream item was not present in the reviewed run; run dream show again.');
  }
  await confirmRemoteAction(args, io, 'Apply this Dream candidate to memory?');
  const response = await context.client.request({
    method: 'POST',
    path: `/api/v1/me/dream/runs/${encodeURIComponent(runId)}/confirm`,
    query: compact({ team_id: teamId }),
    body: { item_id: itemId, expected_run_version: String(receipt.displayedRevision), expected_settings_version: Number(receipt.settingsVersion) },
    sideEffect: true
  });
  return response;
}

async function waitForDream(context, runId, args, initial = null, timeoutOverride = null, teamIdOverride = null) {
  if (!runId) throw new ServiceClientError('Dream preview did not return a run ID.', { code: 'INVALID_RESPONSE' });
  const timeoutMs = parsePositiveInteger(optionValue(args, '--wait-timeout') ?? timeoutOverride ?? '120000', '--wait-timeout');
  const deadline = Date.now() + timeoutMs;
  let data = initial;
  while (Date.now() <= deadline) {
    if (context.signal?.aborted) throw new InterruptedError(`Dream wait interrupted; run ${runId} remains available for show.`, { data: { run_id: runId }, nextAction: `Run \`xmemo dream show ${runId}\` to continue checking.` });
    if (!data) {
      try {
        data = (await context.client.request({ method: 'GET', path: `/api/v1/me/dream/runs/${encodeURIComponent(runId)}`, query: compact({ team_id: teamIdOverride ?? optionValue(args, '--team') }), retry: 'bounded', timeoutMs: Math.max(1, deadline - Date.now()) })).data;
      } catch (error) {
        error.data = { ...(error.data ?? {}), run_id: runId };
        error.nextAction = `Run \`xmemo dream show ${runId}\` to continue checking.`;
        if (error.code === 'REQUEST_TIMEOUT' && Date.now() >= deadline) error.code = 'LOCAL_WAIT_TIMEOUT';
        throw error;
      }
    }
    const status = String(data?.run?.status ?? '').toLowerCase();
    if (status === 'succeeded') return data;
    if (['failed', 'dead_letter', 'cancelled'].includes(status)) {
      throw new ServiceClientError(`Dream run ${runId} ended with status ${status}.`, { code: 'DREAM_RUN_FAILED', httpStatus: 200, data });
    }
    await sleep(250);
    data = null;
  }
  throw new ServiceClientError(`Dream wait timed out; run ${runId} remains available for show.`, { code: 'LOCAL_WAIT_TIMEOUT', outcome: 'known-failure', data: { run_id: runId }, nextAction: `Run \`xmemo dream show ${runId}\` to continue checking.` });
}

async function run(command, args, io, handler) {
  const outputJson = hasFlag(args, '--json');
  try {
    const context = await serviceContext(args, io);
    const response = await handler(args, io, context);
    if (outputJson) writeSuccess(io, command, response?.data ?? response, response?.meta ?? {});
    else writeHumanServiceResult(io, command, response?.data ?? response, response?.meta ?? {});
    return 0;
  } catch (error) {
    if (outputJson) writeFailure(io, command, error);
    else writeLine(io.stderr, `Error: ${error.message}`);
    return errorToExitCode(error);
  }
}

function positional(args) {
  const optionsWithValue = new Set(['--input', '--window-days', '--idempotency-key', '--wait-timeout', '--team', '--from', '--item', '--timeout-ms', '--base-url', '--url']);
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith('--')) return args[index];
    if (optionsWithValue.has(args[index])) index += 1;
  }
  return null;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}
