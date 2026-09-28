import { commandSpec } from './command-registry.js';
import { writeLine } from '../../core/io.js';
import { commandInputSchema } from './input-schema.js';

const common = Object.freeze({
  '--json': { type: 'boolean', description: 'Output a single JSON envelope.' },
  '--base-url': { type: 'https-url', description: 'Target XMemo service base URL.' },
  '--timeout-ms': { type: 'integer>0', description: 'Per-request HTTP timeout in milliseconds.' },
  '--timeout': { type: 'duration', description: 'Per-request HTTP timeout; compatible with --timeout-ms.' },
  '--deadline': { type: 'duration', description: 'Total budget for overall service invocation (e.g. 30s).' },
  '--allow-legacy-credential': { type: 'boolean', description: 'Allow legacy credentials without origin metadata to connect to default service.' }
});

const INPUT_COMMANDS = new Set([
  'memory.add', 'memory.search', 'memory.read', 'memory.delete', 'memory.restore', 'context.recall', 'state.save', 'state.restore',
  'restart.snapshot', 'restart.restore', 'knowledge.add', 'knowledge.search',
  'knowledge.read', 'knowledge.update', 'dream.preview', 'dream.show', 'dream.apply',
  'cloud-skill.add', 'cloud-skill.list', 'cloud-skill.show', 'cloud-skill.update', 'cloud-skill.run'
]);

const option = (type, description) => ({ type, description });
const COMMAND_OPTIONS = Object.freeze({
  'memory.list': { '--path-prefix': option('string', 'Path prefix filter.'), '--project': option('string', 'Project name filter.'), '--exact-path': option('boolean', 'Exact literal path prefix match.'), '--query': option('string', 'Substring text filter across content and path.'), '--filter': option('string', 'Substring text filter across content and path.'), '--type': option('string', 'Filter by memory type.'), '--all': option('boolean', 'Automatically page through all matching memories.'), '--limit': option('integer>0', 'Page size limit (max 500, default 100).'), '--offset': option('integer>=0', 'Page offset.') },
  'memory.import': {'--file':option('path','Memory JSONL file.'),'--dry-run':option('boolean','Validate without writes.'),'--idempotency-key':option('string','Stable retry key.'),'--yes':option('boolean','Confirm writes.'),'--limit':option('integer 1..5000','Page size.'),'--bucket':option('string','Target bucket.'),'--scope':option('string','Authorized target scope.')},
  'memory.ledger-delete': {'--id':option('uuid','Exact transaction ID.'),'--yes':option('boolean','Confirm soft deletion.')},
  'memory.expense-delete': {'--id':option('uuid','Exact transaction ID.'),'--yes':option('boolean','Confirm soft deletion.')},
  'memory.delete': { '<memory-id>': option('id', 'Memory ID to soft delete.'), '--id': option('id', 'Memory ID to soft delete.'), '--reason': option('string', 'Optional deletion rationale.'), '--yes': option('boolean', 'Confirm deletion without prompt.') },
  'memory.restore': { '<memory-id>': option('id', 'Memory ID to restore.'), '--id': option('id', 'Memory ID to restore.'), '--yes': option('boolean', 'Confirm restore without prompt.') },
  'memory.add': { '--content': option('string', 'Memory content text.'), '--path': option('string', 'Memory storage path.'), '--bucket': option('string', 'Target bucket.'), '--scope': option('string', 'Target scope.'), '--team': option('id', 'Team ID.') },
  'memory.search': { '<query>': option('string', 'Search query text.'), '--limit': option('integer>0', 'Result limit (max 5000, default 50).'), '--team': option('id', 'Team ID.'), '--bucket': option('string', 'Target bucket.'), '--path': option('string', 'Path filter.'), '--prefer-working': option('boolean', 'Prefer working memories.'), '--expand-documents': option('boolean', 'Expand document-backed memories in results.'), '--keyword': option('string', 'Keyword filter and client rerank.'), '--exact': option('string', 'Exact phrase filter and client rerank.') },
  'memory.read': { '<memory-id>': option('id', 'Full memory ID.'), '--team': option('id', 'Team ID.') },
  'context.recall': { '<query>': option('string', 'Recall query text.'), '--max-tokens': option('integer>0', 'Context token budget.'), '--max-items': option('integer>0', 'Maximum memory items.'), '--include-knowledge': option('boolean', 'Include structured knowledge base results.'), '--expand-documents': option('boolean', 'Expand document-backed memories in results.'), '--team': option('id', 'Team ID.') },
  'state.save': { '--state-key': option('string', 'State key identifier.'), '--content': option('string', 'State content text.'), '--current-task': option('string', 'Current active task.'), '--next-action': option('string', 'Next immediate action.'), '--blocked-reason': option('string', 'Blocking reason if stalled.'), '--ttl-seconds': option('integer>=0', 'Time to live in seconds.') },
  'state.restore': { '--state-key': option('string', 'State key identifier.'), '--bucket': option('string', 'Target bucket.'), '--scope': option('string', 'Target scope.') },
  'restart.snapshot': { '--state-key': option('string', 'State key identifier.'), '--bucket': option('string', 'Target bucket.'), '--scope': option('string', 'Target scope.') },
  'restart.restore': { '--snapshot-id': option('id', 'Snapshot ID.'), '--state-key': option('string', 'State key identifier.'), '--bucket': option('string', 'Target bucket.'), '--scope': option('string', 'Target scope.'), '--preview': option('boolean', 'Inspect recovery preview without modifying state.'), '--apply': option('boolean', 'Apply recovery state and record event; requires --yes.'), '--yes': option('boolean', 'Confirm applying recovery snapshot.') },
  'knowledge.add': { '--base': option('id', 'Knowledge base ID.'), '--create-base': option('string', 'Explicitly create new base with name.'), '--title': option('string', 'Item title.'), '--text': option('string', 'Text content.'), '--file': option('path', 'Path to text or document file.'), '--document': option('id', 'Existing Document ID.'), '--document-version': option('integer>0', 'Document version.'), '--publish': option('boolean', 'Create directly in published status.'), '--yes': option('boolean', 'Confirm publish.'), '--team': option('id', 'Team ID.') },
  'knowledge.search': { '<query>': option('string', 'Search query text.'), '--base': option('id', 'Knowledge base ID.'), '--limit': option('integer>0', 'Result limit.'), '--cursor': option('string', 'Server pagination cursor.'), '--team': option('id', 'Team ID.') },
  'knowledge.read': { '<item-id>': option('id', 'Knowledge item ID.'), '--offset': option('integer>=0', 'Content page offset.'), '--limit-chars': option('integer>0', 'Characters per page limit.'), '--receipt-out': option('path', 'Save read receipt only, without content or credentials.'), '--team': option('id', 'Team ID.') },
  'knowledge.update': { '<item-id>': option('id', 'Knowledge item ID.'), '--from': option('path', 'knowledge read JSON file.'), '--text': option('string', 'New content text.'), '--file': option('path', 'New content text file.'), '--document': option('id', 'Same-source Document ID.'), '--document-version': option('integer>0', 'Document version.'), '--publish': option('boolean', 'Update live content or publish draft.'), '--yes': option('boolean', 'Confirm publish.'), '--team': option('id', 'Team ID.') },
  'dream.preview': { '--window-days': option('1..365', 'Lookback window in days.'), '--wait': option('boolean', 'Wait locally for completion.'), '--wait-timeout': option('integer>0', 'Local wait timeout limit.'), '--idempotency-key': option('string', 'Stable deduplication key.'), '--team': option('id', 'Team ID.') },
  'dream.show': { '<run-id>': option('id', 'Dream run ID.'), '--wait': option('boolean', 'Wait locally for completion.'), '--wait-timeout': option('integer>0', 'Local wait timeout limit.'), '--receipt-out': option('path', 'Save receipt only, without content or credentials.'), '--team': option('id', 'Team ID.') },
  'dream.apply': { '<run-id>': option('id', 'Dream run ID.'), '--item': option('id', 'Candidate item ID.'), '--from': option('path', 'dream show JSON file.'), '--yes': option('boolean', 'Confirm apply.'), '--team': option('id', 'Team ID.') },
  'cloud-skill.add': { '--file': option('SKILL.md', 'Single file skill.'), '--dir': option('directory', 'Skill directory.'), '--name': option('string', 'Display name.'), '--slug': option('string', 'Unique slug.'), '--publish': option('boolean', 'Request publish.'), '--yes': option('boolean', 'Confirm publish.'), '--team': option('id', 'Team ID.') },
  'cloud-skill.list': { '--team': option('id', 'Team ID.') },
  'cloud-skill.show': { '<skill-id>': option('id', 'Skill ID.'), '--draft': option('boolean', 'Read latest maintenance draft.'), '--receipt-out': option('path', 'Save receipt only.'), '--team': option('id', 'Team ID.') },
  'cloud-skill.update': { '<skill-id>': option('id', 'Skill ID.'), '--file': option('SKILL.md', 'Single file skill.'), '--dir': option('directory', 'Skill directory.'), '--from': option('path', 'cloud-skill show JSON file.'), '--publish': option('boolean', 'Request publish.'), '--yes': option('boolean', 'Confirm publish.'), '--team': option('id', 'Team ID.') },
  'cloud-skill.run': { '<skill-id>': option('id', 'Skill ID.'), '--script': option('logical-path', 'Explicit script entrypoint.'), '--input': option('path', 'JSON file containing input_args.'), '--from': option('path', 'published show JSON file.'), '--yes': option('boolean', 'Confirm remote execution.'), '--timeout-seconds': option('1..60', 'Script execution timeout limit; compatible with --execution-timeout 30s.'), '--team': option('id', 'Team ID.') }
});

const CONFIRMATION = Object.freeze({
  'memory.import': { when: 'dry-run=false', flag: '--yes' },
  'memory.ledger-delete': { when: 'always', flag: '--yes' },
  'memory.expense-delete': { when: 'always', flag: '--yes' },
  'memory.delete': { when: 'always', flag: '--yes' },
  'memory.restore': { when: 'always', flag: '--yes' },
  'knowledge.add': { when: 'publish=true', flag: '--yes' },
  'knowledge.update': { when: 'publish=true', flag: '--yes' },
  'dream.apply': { when: 'always', flag: '--yes' },
  'cloud-skill.add': { when: 'publish=true', flag: '--yes' },
  'cloud-skill.update': { when: 'publish=true', flag: '--yes' },
  'cloud-skill.run': { when: 'always', flag: '--yes' }
});

export function serviceHelpSchema(command) {
  const spec = commandSpec(command);
  if (!spec) return null;
  return {
    schemaVersion: '1',
    command,
    method: spec.method,
    path: spec.path,
    scopes: spec.scopes,
    ...(spec.conditionalScopes ? { conditionalScopes: spec.conditionalScopes } : {}),
    ...(spec.scopeNotes ? { scopeNotes: spec.scopeNotes } : {}),
    sideEffect: spec.sideEffect,
    availability: spec.availability,
    inputSchema: commandInputSchema(command),
    examples: [{ input: commandInputSchema(command).examples[0], invocation: INPUT_COMMANDS.has(command) ? `xmemo ${command.replace('.', ' ')} --input params.json --json` : `xmemo ${command.replace('.', ' ')} --help`, additionalFlags: command.startsWith('cloud-skill.') && ['cloud-skill.add', 'cloud-skill.update'].includes(command) ? ['--file SKILL.md (or --dir folder)'] : command === 'cloud-skill.run' ? ['<skill-id>', '--from skill-view.json', '--yes'] : CONFIRMATION[command]?.when === 'always' ? ['--yes'] : [] }],
    options: {
      ...common,
      ...(INPUT_COMMANDS.has(command) ? { '--input': option('path|-', 'Read command parameters from JSON file or stdin.') } : {}),
      ...(COMMAND_OPTIONS[command] ?? {}),
      ...(command === 'knowledge.read' ? { '--from': option('path', 'Use JSON from previous page for subsequent pagination, pinning revision.') } : {}),
      ...(command === 'knowledge.add' ? { '--wait-timeout': option('integer>0', 'Local timeout limit for document extraction.') } : {}),
      ...(command === 'state.save' ? { '--bucket': option('string', 'Target bucket.'), '--scope': option('string', 'Target scope.') } : {}),
      ...(command === 'cloud-skill.run' ? { '--input': option('path|-', 'JSON file or stdin containing input_args.') } : {})
    },
    confirmation: CONFIRMATION[command] ?? null,
    notes: [
      'Flags and fields in --input with the same name must not conflict.',
      'Write requests are not automatically retried; unknown outcomes are not treated as failures.'
    ]
  };
}

export function writeServiceHelpSchema(io, command) {
  const schema = serviceHelpSchema(command);
  if (!schema) return false;
  writeLine(io.stdout, JSON.stringify(schema));
  return true;
}

export function writeHumanServiceHelp(io, command) {
  const schema = serviceHelpSchema(command);
  if (!schema) return false;
  writeLine(io.stdout, `Usage: xmemo ${command.replace('.', ' ')} [options]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Options:');
  for (const [name, details] of Object.entries(schema.options)) {
    writeLine(io.stdout, `  ${name.padEnd(22)} ${details.description}`);
  }
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Example: ${schema.examples[0].invocation}`);
  if (schema.confirmation) writeLine(io.stdout, `Impact: confirmation required (${schema.confirmation.flag}).`);
  writeLine(io.stdout, 'Exit codes: 0 success; 2 input; 3 authentication; 4 permission; 6 conflict; 7 service; 10 confirmation; 11 unknown outcome.');
  return true;
}
