const definitions = {
  'memory.add': ['content path bucket scope team_id metadata:object memory_type', { content: 'Synthetic memory', path: 'examples/cli' }],
  'memory.search': ['query limit:integer team_id bucket path prefer_working:boolean', { query: 'Synthetic', limit: 5 }],
  'memory.read': ['memory_id team_id', { memory_id: 'memory-id' }],
  'context.recall': ['query include_knowledge:boolean team_id scope limit:integer max_items:integer max_tokens:integer path bucket memory_type status threshold:number prefer_working:boolean', { query: 'Synthetic', max_items: 5, include_knowledge: false }],
  'state.save': ['state_key content current_task next_action blocked_reason metadata:object source bucket scope path ttl_seconds:integer', { state_key: 'active_task', current_task: 'Review changes', next_action: 'Run checks' }],
  'state.restore': ['state_key bucket scope', { state_key: 'active_task' }],
  'restart.snapshot': ['session_id state_key timeline_limit:integer reminder_limit:integer decision_limit:integer metadata:object source bucket scope path ttl_seconds:integer', { state_key: 'active_task', timeline_limit: 5 }],
  'restart.restore': ['snapshot_id source_session_id target_session_id state_key restore_state:boolean record_restore_event:boolean ttl_seconds:integer source bucket scope', { snapshot_id: 'snapshot-id', restore_state: false, record_restore_event: false }],
  'knowledge.add': ['knowledge_base_id title content document_id document_version:integer team_id publish:boolean', { knowledge_base_id: 'base-id', title: 'Example', content: 'Synthetic knowledge', publish: false }],
  'knowledge.search': ['query knowledge_base_id limit:integer cursor mode alpha:number query_embedding:array k:integer team_id scope', { query: 'Synthetic', limit: 5 }],
  'knowledge.read': ['item_id from team_id offset:integer limit_chars:integer', { item_id: 'item-id', limit_chars: 10000 }],
  'knowledge.update': ['item_id from content document_id document_version:integer team_id publish:boolean', { item_id: 'item-id', from: 'knowledge-view.json', content: 'Updated text', publish: false }],
  'dream.preview': ['window_days:integer idempotency_key wait:boolean wait_timeout:integer team_id', { window_days: 30, wait: true, wait_timeout: 120000 }],
  'dream.show': ['run_id wait:boolean wait_timeout:integer team_id', { run_id: 'run-id', wait: false }],
  'dream.apply': ['run_id item_id from team_id', { run_id: 'run-id', item_id: 'candidate-id', from: 'dream-view.json' }],
  'cloud-skill.add': ['name slug team_id publish:boolean', { name: 'Example', slug: 'example', publish: false }],
  'cloud-skill.list': ['team_id', {}],
  'cloud-skill.show': ['skill_id draft:boolean team_id', { skill_id: 'skill-id', draft: false }],
  'cloud-skill.update': ['skill_id from team_id publish:boolean', { skill_id: 'skill-id', from: 'skill-view.json', publish: false }],
  'cloud-skill.run': ['input_args:object script_path', { input_args: { text: 'Synthetic input' } }]
};

export function commandInputSchema(command) {
  const [fields, example] = definitions[command];
  return {
    type: 'object', additionalProperties: false,
    properties: Object.fromEntries(fields.split(' ').map((field) => {
      const [name, type = 'string'] = field.split(':');
      return [name, { type }];
    })),
    examples: [example]
  };
}
