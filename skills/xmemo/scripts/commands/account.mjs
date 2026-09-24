import {
  EXIT_CODE,
  exitCodeForError,
} from '../lib/core.mjs';

import {
  makeHttpRequest,
  handleRestError,
  safeJson,
  sanitizeTerminalText,
} from '../lib/api.mjs';

export async function handleAccount(ctx) {
  const { command, options, flags, token } = ctx;

  if (command === 'overview') {
    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: 'overview',
        arguments: {},
      }, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Account overview not found.',
        context: 'Get overview request',
        options,
      });

      const result = (data && typeof data.result === 'object' && data.result !== null) ? data.result : data;

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...(data?.operation ? { operation: data.operation } : {}),
          ...result,
          result,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log('XMemo Account Overview:');
      console.log(`- Memories: ${result.memories_total ?? 0} total (${result.memories_active ?? 0} active, ${result.memories_archived ?? 0} archived, ${result.memories_forgotten ?? 0} forgotten)`);
      console.log(`- Active Agents: ${result.agents_active ?? 0}`);
      console.log(`- Storage: ${result.storage_mb ?? 0} MB`);
      console.log(`- Tokens (30d): ${result.tokens_30d ?? 0}`);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Get overview failed:', e.message);
      process.exit(exitCodeForError(e));
    }
  }

  if (command === 'activity') {
    const args = {};
    if (flags.limit !== undefined) {
      const parsed = Number(flags.limit);
      args.limit = Number.isInteger(parsed) ? parsed : flags.limit;
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: 'activity',
        arguments: args,
      }, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Account activity not found.',
        context: 'Get activity request',
        options,
      });

      const result = (data && typeof data.result === 'object' && data.result !== null) ? data.result : data;

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...(data?.operation ? { operation: data.operation } : {}),
          ...result,
          result,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      const activityList = Array.isArray(result.activity) ? result.activity : [];
      if (activityList.length === 0) {
        console.log('No recent activity found.');
        process.exit(EXIT_CODE.SUCCESS);
      }

      const totalInfo = result.total !== undefined ? ` (total: ${result.total})` : '';
      console.log(`XMemo Recent Activity (${activityList.length}${totalInfo}):`);
      activityList.forEach((item, idx) => {
        const ts = item.ts || '(unknown date)';
        const type = item.type || 'unknown';
        const summary = item.summary || '';
        const ref = item.ref_id ? ` [ref: ${item.ref_id}]` : '';
        console.log(`[${idx + 1}] ${sanitizeTerminalText(ts)} | ${type.toUpperCase()} | ${sanitizeTerminalText(summary)}${ref}`);
      });
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Get activity failed:', e.message);
      process.exit(exitCodeForError(e));
    }
  }

  if (command === 'stats') {
    const scope = flags.scope;
    const path = flags.path;
    const bucket = flags.bucket;
    const memoryType = flags['memory-type'] !== undefined ? flags['memory-type'] : flags.memory_type;
    const status = flags.status;
    const source = flags.source;
    const since = flags.since;
    const until = flags.until;
    const groupBy = flags['group-by'] !== undefined ? flags['group-by'] : flags.group_by;
    const topN = flags['top-n'] !== undefined ? flags['top-n'] : flags.top_n;
    const teamId = flags['team-id'] !== undefined ? flags['team-id'] : flags.team_id;

    const queryParams = [];
    if (scope) queryParams.push(`scope=${encodeURIComponent(scope)}`);
    if (path) queryParams.push(`path=${encodeURIComponent(path)}`);
    if (bucket) queryParams.push(`bucket=${encodeURIComponent(bucket)}`);
    if (memoryType) queryParams.push(`memory_type=${encodeURIComponent(memoryType)}`);
    if (status) queryParams.push(`status=${encodeURIComponent(status)}`);
    if (source) queryParams.push(`source=${encodeURIComponent(source)}`);
    if (since) queryParams.push(`since=${encodeURIComponent(since)}`);
    if (until) queryParams.push(`until=${encodeURIComponent(until)}`);
    if (groupBy) queryParams.push(`group_by=${encodeURIComponent(groupBy)}`);
    if (topN !== undefined) queryParams.push(`top_n=${encodeURIComponent(topN)}`);
    if (teamId) queryParams.push(`team_id=${encodeURIComponent(teamId)}`);

    let endpoint = '/v1/memories/stats';
    if (queryParams.length > 0) {
      endpoint += `?${queryParams.join('&')}`;
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'GET', null, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Memory stats not found.',
        context: 'Get memory stats request',
        options,
      });

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...data,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      if ((data.total_count ?? 0) === 0 && (data.filtered_count ?? 0) === 0) {
        console.log('No memory statistics available.');
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log('XMemo Memory Statistics:');
      console.log(`- Total Memories: ${data.total_count ?? 0} (filtered: ${data.filtered_count ?? 0}, scanned: ${data.scanned_count ?? 0})`);
      if (data.latest_at) console.log(`- Latest Memory: ${data.latest_at}`);
      if (data.oldest_at) console.log(`- Oldest Memory: ${data.oldest_at}`);
      if (data.type_counts && Object.keys(data.type_counts).length > 0) {
        const counts = Object.entries(data.type_counts).map(([k, v]) => `${k}: ${v}`).join(', ');
        console.log(`- Types: ${counts}`);
      }
      if (data.status_counts && Object.keys(data.status_counts).length > 0) {
        const counts = Object.entries(data.status_counts).map(([k, v]) => `${k}: ${v}`).join(', ');
        console.log(`- Status: ${counts}`);
      }
      if (data.bucket_counts && Object.keys(data.bucket_counts).length > 0) {
        const counts = Object.entries(data.bucket_counts).map(([k, v]) => `${k}: ${v}`).join(', ');
        console.log(`- Buckets: ${counts}`);
      }
      if (Array.isArray(data.groups) && data.groups.length > 0) {
        console.log(`- Groups (${data.groups.length}):`);
        data.groups.forEach((g) => {
          const dims = g.group_by ? Object.entries(g.group_by).map(([k, v]) => `${k}=${v}`).join(', ') : '';
          console.log(`  * [${dims}]: ${g.count}`);
        });
      }
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Get memory stats failed:', e.message);
      process.exit(exitCodeForError(e));
    }
  }
}
