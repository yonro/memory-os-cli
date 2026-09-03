import { commandSpec } from './command-registry.js';
import { writeLine } from '../../core/io.js';
import { commandInputSchema } from './input-schema.js';

const common = Object.freeze({
  '--json': { type: 'boolean', description: '输出单个 JSON envelope。' },
  '--base-url': { type: 'https-url', description: '目标 XMemo 服务地址。' },
  '--timeout-ms': { type: 'integer>0', description: '单次 HTTP 请求超时。' },
  '--allow-legacy-credential': { type: 'boolean', description: '仅允许无 origin 元数据的旧凭证连接默认服务；推荐重新登录迁移。' }
});

const INPUT_COMMANDS = new Set([
  'memory.add', 'memory.search', 'context.recall', 'state.save', 'state.restore',
  'restart.snapshot', 'restart.restore', 'knowledge.add', 'knowledge.search',
  'knowledge.read', 'knowledge.update', 'dream.preview', 'dream.show', 'dream.apply',
  'cloud-skill.add', 'cloud-skill.list', 'cloud-skill.show', 'cloud-skill.update', 'cloud-skill.run'
]);

const option = (type, description) => ({ type, description });
const COMMAND_OPTIONS = Object.freeze({
  'memory.add': { '--content': option('string', '记忆正文。'), '--path': option('string', '记忆路径。'), '--bucket': option('string', '数据桶。'), '--scope': option('string', '空间。'), '--team': option('id', '团队 ID。') },
  'memory.search': { '<query>': option('string', '检索文本。'), '--limit': option('integer>0', '结果上限。'), '--team': option('id', '团队 ID。'), '--bucket': option('string', '数据桶。'), '--path': option('string', '路径过滤。'), '--prefer-working': option('boolean', '优先 working 记忆。') },
  'context.recall': { '<query>': option('string', '召回目标。'), '--include-knowledge': option('boolean', '包含知识库结果。'), '--team': option('id', '团队 ID。') },
  'state.save': { '--state-key': option('string', '状态槽。'), '--content': option('string', '状态正文。'), '--current-task': option('string', '当前任务。'), '--next-action': option('string', '下一动作。'), '--blocked-reason': option('string', '阻塞原因。'), '--ttl-seconds': option('integer>=0', '存活时间。') },
  'state.restore': { '--state-key': option('string', '状态槽。'), '--bucket': option('string', '数据桶。'), '--scope': option('string', '空间。') },
  'restart.snapshot': { '--state-key': option('string', '状态槽。'), '--bucket': option('string', '数据桶。'), '--scope': option('string', '空间。') },
  'restart.restore': { '--snapshot-id': option('id', '快照 ID。'), '--state-key': option('string', '状态槽。'), '--bucket': option('string', '数据桶。'), '--scope': option('string', '空间。') },
  'knowledge.add': { '--base': option('id', '知识库 ID。'), '--create-base': option('string', '显式新建知识库。'), '--title': option('string', '条目标题。'), '--text': option('string', '文本内容。'), '--file': option('path', '文本或文档文件。'), '--document': option('id', '已有 Document ID。'), '--document-version': option('integer>0', 'Document 版本。'), '--publish': option('boolean', '创建为发布状态。'), '--yes': option('boolean', '确认发布。'), '--team': option('id', '团队 ID。') },
  'knowledge.search': { '<query>': option('string', '检索文本。'), '--base': option('id', '知识库 ID。'), '--limit': option('integer>0', '结果上限。'), '--cursor': option('string', '服务端游标。'), '--team': option('id', '团队 ID。') },
  'knowledge.read': { '<item-id>': option('id', '知识条目 ID。'), '--offset': option('integer>=0', '正文偏移。'), '--limit-chars': option('integer>0', '本页字符数。'), '--team': option('id', '团队 ID。') },
  'knowledge.update': { '<item-id>': option('id', '知识条目 ID。'), '--from': option('path', 'knowledge read JSON。'), '--text': option('string', '新文本。'), '--file': option('path', '新文本文件。'), '--document': option('id', '同一来源 Document ID。'), '--document-version': option('integer>0', 'Document 版本。'), '--publish': option('boolean', '修改线上内容或发布草稿。'), '--yes': option('boolean', '确认发布。'), '--team': option('id', '团队 ID。') },
  'dream.preview': { '--window-days': option('1..365', '回看天数。'), '--wait': option('boolean', '本地等待完成。'), '--wait-timeout': option('integer>0', '本地等待上限。'), '--idempotency-key': option('string', '复用同一预览意图。'), '--team': option('id', '团队 ID。') },
  'dream.show': { '<run-id>': option('id', 'Dream run ID。'), '--wait': option('boolean', '本地等待完成。'), '--wait-timeout': option('integer>0', '本地等待上限。'), '--team': option('id', '团队 ID。') },
  'dream.apply': { '<run-id>': option('id', 'Dream run ID。'), '--item': option('id', '单个候选 ID。'), '--from': option('path', 'dream show JSON。'), '--yes': option('boolean', '确认写入。'), '--team': option('id', '团队 ID。') },
  'cloud-skill.add': { '--file': option('SKILL.md', '单文件技能。'), '--dir': option('directory', '技能目录。'), '--name': option('string', '显示名。'), '--slug': option('string', '唯一 slug。'), '--publish': option('boolean', '请求发布。'), '--yes': option('boolean', '确认发布。'), '--team': option('id', '团队 ID。') },
  'cloud-skill.list': { '--team': option('id', '团队 ID。') },
  'cloud-skill.show': { '<skill-id>': option('id', '技能 ID。'), '--draft': option('boolean', '读取最新维护版本。'), '--team': option('id', '团队 ID。') },
  'cloud-skill.update': { '<skill-id>': option('id', '技能 ID。'), '--file': option('SKILL.md', '单文件技能。'), '--dir': option('directory', '技能目录。'), '--from': option('path', 'cloud-skill show JSON。'), '--publish': option('boolean', '请求发布。'), '--yes': option('boolean', '确认发布。'), '--team': option('id', '团队 ID。') },
  'cloud-skill.run': { '<skill-id>': option('id', '技能 ID。'), '--script': option('logical-path', '明确脚本入口。'), '--input': option('path', '包含 input_args 的 JSON。'), '--from': option('path', 'published show JSON。'), '--yes': option('boolean', '确认远端执行。'), '--timeout-seconds': option('1..60', '脚本运行上限。'), '--team': option('id', '团队 ID。') }
});

const CONFIRMATION = Object.freeze({
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
    examples: [{ input: commandInputSchema(command).examples[0], invocation: `xmemo ${command.replace('.', ' ')} --input params.json --json`, additionalFlags: command.startsWith('cloud-skill.') && ['cloud-skill.add', 'cloud-skill.update'].includes(command) ? ['--file SKILL.md (or --dir folder)'] : command === 'cloud-skill.run' ? ['<skill-id>', '--from skill-view.json', '--yes'] : CONFIRMATION[command]?.when === 'always' ? ['--yes'] : [] }],
    options: {
      ...common,
      ...(INPUT_COMMANDS.has(command) ? { '--input': option('path|-', '从 JSON 文件或 stdin 读取命令参数。') } : {}),
      ...(COMMAND_OPTIONS[command] ?? {}),
      ...(command === 'knowledge.read' ? { '--from': option('path', '后续分页使用前页 JSON，固定原修订。') } : {}),
      ...(command === 'knowledge.add' ? { '--wait-timeout': option('integer>0', '文档抽取的本地等待上限。') } : {}),
      ...(command === 'state.save' ? { '--bucket': option('string', '数据桶。'), '--scope': option('string', '空间。') } : {}),
      ...(command === 'cloud-skill.run' ? { '--input': option('path|-', '包含 input_args 的 JSON 文件或 stdin。') } : {})
    },
    confirmation: CONFIRMATION[command] ?? null,
    notes: [
      'flags 与 --input 中的同名字段不能重复。',
      '写入请求默认不自动重试；未知结果不会被当作失败重放。'
    ]
  };
}

export function writeServiceHelpSchema(io, command) {
  const schema = serviceHelpSchema(command);
  if (!schema) return false;
  writeLine(io.stdout, JSON.stringify(schema));
  return true;
}
