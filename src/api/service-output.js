import { writeLine } from '../core/io.js';

export function writeHumanServiceResult(io, command, data, meta = {}) {
  if (command === 'memory.search') return writeMemorySearch(io, data, meta);
  if (command === 'memory.read') return writeMemoryRead(io, data);
  if (command === 'memory.list') return writeMemoryList(io, data, meta);
  if (command === 'memory.add') return writeMemoryAdd(io, data);
  if (command === 'context.recall') return writeContextRecall(io, data, meta);
  if (command === 'state.save' || command === 'state.restore') return writeStateResult(io, command, data);
  if (command === 'restart.snapshot') return writeRestartSnapshot(io, data);
  if (command === 'cloud-skill.list') return writeCloudSkillList(io, data);
  if (command === 'knowledge.read') return writeKnowledgeRead(io, data);
  if (command === 'dream.show') return writeDreamShow(io, data);
  if (command === 'cloud-skill.show') return writeCloudSkillShow(io, data, meta);
  if (command === 'cloud-skill.run') return writeCloudSkillRun(io, data);
  writeLine(io.stdout, `${command} completed.`);
  if (data !== undefined) writeLine(io.stdout, JSON.stringify(data, null, 2));
  if (meta.nextCursor) writeLine(io.stdout, `Next cursor: ${meta.nextCursor}`);
  if (Array.isArray(meta.warnings)) {
    for (const warning of meta.warnings) writeLine(io.stderr, `Warning: ${warning}`);
  }
}

function writeMemoryList(io, data, meta) {
  const memories = Array.isArray(data) ? data : Array.isArray(data?.memories) ? data.memories : Array.isArray(data?.items) ? data.items : [];
  if (memories.length === 0) {
    writeLine(io.stdout, 'No memories found.');
  } else {
    for (const item of memories) {
      const id = item?.id ?? item?.memory_id ?? 'unknown';
      const location = item?.path ?? item?.memory_path ?? 'unknown path';
      const content = typeof item?.content === 'string' ? item.content.replace(/\s+/gu, ' ').trim() : '';
      const preview = content.length > 80 ? `${content.slice(0, 77)}...` : content;
      writeLine(io.stdout, `${location}  [${id}]${preview ? `  ${preview}` : ''}`);
    }
  }
  if (meta?.nextCursor || data?.next_cursor) {
    writeLine(io.stdout, `Next cursor: ${meta?.nextCursor ?? data.next_cursor}`);
  }
  const allWarnings = [...(meta?.warnings ?? []), ...(data?.warnings ?? [])];
  for (const warning of allWarnings) {
    writeLine(io.stderr, `Warning: ${warning}`);
  }
}

function writeMemoryAdd(io, data) {
  const id = data?.id ?? data?.memory_id ?? data?.memoryId ?? 'unknown';
  const path = data?.path ?? data?.memory_path ?? 'unknown';
  writeLine(io.stdout, `Saved memory ${id} at ${path}`);
}

function writeStateResult(io, command, data) {
  const key = data?.state_key ?? data?.key ?? data?.arguments?.state_key ?? 'active_task';
  const version = data?.version ?? 'unknown';
  const expiry = data?.expires_at ?? (data?.ttl_seconds !== undefined ? `${data.ttl_seconds}s` : null) ?? 'none';
  const verb = command === 'state.restore' ? 'Restored' : 'Saved';
  writeLine(io.stdout, `${verb} state: key=${key}, version=${version}, expiry=${expiry}`);
  if (command === 'state.restore' && typeof data?.content === 'string' && data.content) {
    writeLine(io.stdout, data.content);
  }
}

function writeRestartSnapshot(io, data) {
  const id = data?.snapshot_id ?? data?.id ?? 'unknown';
  const expiry = data?.expires_at ?? (data?.ttl_seconds !== undefined ? `${data.ttl_seconds}s` : null) ?? 'none';
  writeLine(io.stdout, `Restart snapshot ${id} saved.`);
  writeLine(io.stdout, `Expiry: ${expiry}`);
  const counts = [];
  if (data?.timeline_count !== undefined) counts.push(`timeline=${data.timeline_count}`);
  else if (Array.isArray(data?.timeline)) counts.push(`timeline=${data.timeline.length}`);
  if (data?.reminders_count !== undefined) counts.push(`reminders=${data.reminders_count}`);
  else if (Array.isArray(data?.reminders)) counts.push(`reminders=${data.reminders.length}`);
  if (data?.decisions_count !== undefined) counts.push(`decisions=${data.decisions_count}`);
  else if (Array.isArray(data?.decisions)) counts.push(`decisions=${data.decisions.length}`);
  if (data?.states_count !== undefined) counts.push(`states=${data.states_count}`);
  else if (Array.isArray(data?.states)) counts.push(`states=${data.states.length}`);
  if (counts.length) {
    writeLine(io.stdout, `Counts: ${counts.join(', ')}`);
  }
}

function writeCloudSkillList(io, data) {
  const skills = Array.isArray(data) ? data : Array.isArray(data?.skills) ? data.skills : [];
  if (skills.length === 0) {
    writeLine(io.stdout, 'No cloud skills found.');
    return;
  }
  writeLine(io.stdout, `Found ${skills.length} cloud ${skills.length === 1 ? 'skill' : 'skills'}:`);
  for (const skill of skills) {
    const name = skill?.name ?? 'Unnamed';
    const slug = skill?.slug ?? 'no-slug';
    const status = skill?.status ?? 'unknown';
    writeLine(io.stdout, `- ${name} (${slug}) · ${status}`);
  }
}

function writeContextRecall(io, data, meta = {}) {
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.memories) ? data.memories : [];
  const budget = data?.budget ?? data?.usage ?? {};
  writeLine(io.stdout, `Recalled ${items.length} context ${items.length === 1 ? 'item' : 'items'}.`);
  if (budget.used_tokens !== undefined || budget.max_tokens !== undefined) writeLine(io.stdout, `Token budget: ${budget.used_tokens ?? 'unknown'} / ${budget.max_tokens ?? 'unknown'}.`);
  if (typeof data?.context_text === 'string' && data.context_text) writeLine(io.stdout, data.context_text);
  else if (items.length === 0) writeLine(io.stdout, 'No matching context was returned. Refine the query or adjust the current filters.');

  for (const item of items) {
    if (item?.document_backed && (!item?.expanded || item?.content_truncated)) {
      const id = item?.memory_id ?? item?.id ?? '';
      if (id) writeLine(io.stdout, `Full document: xmemo memory read ${id}`);
    }
  }

  const allWarnings = [...(meta?.warnings ?? []), ...(data?.warnings ?? [])];
  for (const warning of allWarnings) {
    writeLine(io.stderr, `Warning: ${warning}`);
  }
}

function writeKnowledgeRead(io, data) {
  const content = data?.revision?.canonical_content;
  if (typeof content === 'string') writeLine(io.stdout, content);
  else writeLine(io.stdout, 'Knowledge revision has no readable content. Use --json to inspect the response.');
  const item = data?.item ?? {};
  if (item.item_id ?? item.id) writeLine(io.stdout, `ID: ${item.item_id ?? item.id} · Revision: ${item.current_revision_id ?? 'unknown'}`);
}

function writeDreamShow(io, data) {
  const run = data?.run ?? {};
  const items = Array.isArray(data?.items) ? data.items : [];
  writeLine(io.stdout, `Dream run ${run.run_id ?? run.id ?? 'unknown'}: ${run.status ?? 'unknown'} · ${items.length} candidate(s).`);
  for (const item of items) writeLine(io.stdout, `- ${item.title ?? item.summary ?? item.id ?? 'Unnamed candidate'} [${item.id ?? 'unknown'}]`);
  if (items.length) writeLine(io.stdout, `Review and apply one: xmemo dream apply ${run.run_id ?? run.id} --item <candidate-id> --from <view.json>`);
}

function writeCloudSkillShow(io, data, meta) {
  const skill = data?.skill ?? {};
  const revision = data?.displayed_revision ?? {};
  const components = Array.isArray(data?.components) ? data.components : [];
  writeLine(io.stdout, `${skill.name ?? skill.slug ?? skill.skill_id ?? 'Cloud Skill'} · ${revision.status ?? 'unknown'} revision ${revision.revision_id ?? 'unknown'}.`);
  const scripts = components.filter((component) => String(component?.type ?? '').toLowerCase() === 'script').map((component) => component.logical_path).filter(Boolean);
  if (scripts.length) writeLine(io.stdout, `Scripts: ${scripts.join(', ')}`);
  else writeLine(io.stdout, 'This skill has readable instructions but no executable script.');
  for (const warning of meta.warnings ?? []) writeLine(io.stderr, `Warning: ${warning}`);
}

function writeCloudSkillRun(io, data) {
  writeLine(io.stdout, `Cloud Skill run: ${data?.status ?? 'unknown'} · exit code ${data?.exit_code ?? 'unknown'}.`);
  const output = data?.output ?? data?.stdout;
  if (typeof output === 'string' && output) writeLine(io.stdout, output);
  if (data?.output_truncated) writeLine(io.stderr, 'Warning: remote output was truncated. Use --json to inspect response metadata.');
}

function writeMemoryRead(io, data) {
  const memory = data?.memory ?? data?.item ?? data?.record ?? data;
  const content = typeof memory?.content === 'string' ? memory.content : null;
  if (content) writeLine(io.stdout, content);
  else writeLine(io.stdout, 'Memory details were returned without readable content. Use --json to inspect the service response.');
  const id = memory?.memory_id ?? memory?.id;
  const path = memory?.path ?? memory?.memory_path;
  const version = memory?.version;
  const details = [id && `ID: ${id}`, path && `Path: ${path}`, version !== undefined && `Version: ${version}`].filter(Boolean);
  if (details.length) writeLine(io.stdout, details.join(' · '));
}

function writeMemorySearch(io, data, meta) {
  const results = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) {
    writeLine(io.stdout, 'No matching memories found. Try a more specific query or adjust --team.');
    return;
  }
  writeLine(io.stdout, `Found ${results.length} matching ${results.length === 1 ? 'memory' : 'memories'}.`);
  for (const [index, item] of results.entries()) {
    const id = item?.memory_id ?? item?.id ?? 'unknown';
    const location = item?.path ?? item?.memory_path ?? 'unknown path';
    const content = typeof item?.content === 'string' ? item.content.replace(/\s+/gu, ' ').trim() : '(content unavailable)';
    writeLine(io.stdout, `${index + 1}. ${location}  [${id}]`);
    writeLine(io.stdout, `   ${content.length > 180 ? `${content.slice(0, 177)}...` : content}`);
    if (item?.document_backed) {
      if (item?.expanded) {
        if (item?.content_truncated) {
          writeLine(io.stdout, `   Full document: xmemo memory read ${id}`);
        }
      } else if (item?.expand_error) {
        writeLine(io.stdout, `   (failed to expand document: ${item.expand_error})`);
        writeLine(io.stdout, `   Full document: xmemo memory read ${id}`);
      } else {
        writeLine(io.stdout, `   Full document: xmemo memory read ${id}`);
      }
    }
  }
  if (meta.nextCursor) writeLine(io.stdout, `More results: rerun with the returned cursor in JSON output.`);
}

export function writeHumanServiceFailure(io, error) {
  writeLine(io.stderr, `Error: ${error.message}`);
  if (error?.outcome === 'unknown') writeLine(io.stderr, 'Remote change may have happened, but it was not confirmed. Do not automatically repeat the write.');
  if (error?.data?.run_id) writeLine(io.stderr, `Run: ${error.data.run_id}`);
  if (error?.nextAction) writeLine(io.stderr, `Next: ${error.nextAction}`);
}
