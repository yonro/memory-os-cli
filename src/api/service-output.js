import { writeLine } from '../core/io.js';

export function writeHumanServiceResult(io, command, data, meta = {}) {
  if (command === 'memory.search') return writeMemorySearch(io, data, meta);
  if (command === 'memory.read') return writeMemoryRead(io, data);
  if (command === 'context.recall') return writeContextRecall(io, data);
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

function writeContextRecall(io, data) {
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.memories) ? data.memories : [];
  const budget = data?.budget ?? data?.usage ?? {};
  writeLine(io.stdout, `Recalled ${items.length} context ${items.length === 1 ? 'item' : 'items'}.`);
  if (budget.used_tokens !== undefined || budget.max_tokens !== undefined) writeLine(io.stdout, `Token budget: ${budget.used_tokens ?? 'unknown'} / ${budget.max_tokens ?? 'unknown'}.`);
  if (typeof data?.context_text === 'string' && data.context_text) writeLine(io.stdout, data.context_text);
  else if (items.length === 0) writeLine(io.stdout, 'No matching context was returned. Refine the query or adjust the current filters.');
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
    writeLine(io.stdout, 'No matching memories found. Try a more specific query or adjust --path, --bucket, or --team.');
    return;
  }
  writeLine(io.stdout, `Found ${results.length} matching ${results.length === 1 ? 'memory' : 'memories'}.`);
  for (const [index, item] of results.entries()) {
    const id = item?.memory_id ?? item?.id ?? 'unknown';
    const location = item?.path ?? item?.memory_path ?? 'unknown path';
    const content = typeof item?.content === 'string' ? item.content.replace(/\s+/gu, ' ').trim() : '(content unavailable)';
    writeLine(io.stdout, `${index + 1}. ${location}  [${id}]`);
    writeLine(io.stdout, `   ${content.length > 180 ? `${content.slice(0, 177)}...` : content}`);
  }
  if (meta.nextCursor) writeLine(io.stdout, `More results: rerun with the returned cursor in JSON output.`);
}

export function writeHumanServiceFailure(io, error) {
  writeLine(io.stderr, `Error: ${error.message}`);
  if (error?.outcome === 'unknown') writeLine(io.stderr, 'Remote change may have happened, but it was not confirmed. Do not automatically repeat the write.');
  if (error?.data?.run_id) writeLine(io.stderr, `Run: ${error.data.run_id}`);
  if (error?.nextAction) writeLine(io.stderr, `Next: ${error.nextAction}`);
}
