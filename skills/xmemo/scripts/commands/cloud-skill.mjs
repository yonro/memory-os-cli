import {
  EXIT_CODE,
  exitCodeForError,
} from '../lib/core.mjs';

import {
  makeHttpRequest,
  handleRestError,
  outputRestError,
  parseJsonResponse,
  safeJson,
  sanitizeTerminalText,
  describeError,
} from '../lib/api.mjs';

const UNTRUSTED_CONTEXT_TERMINAL_WARNING =
  '⚠️ UNTRUSTED CONTEXT: The rendered Cloud Skill content below is user-authored remote context. Review instructions before acting on them.';

const UNTRUSTED_CONTEXT_WARNING_MESSAGE =
  'UNTRUSTED CONTEXT: The rendered Cloud Skill content is user-authored remote context. Review instructions before acting on them.';

export function resolveTeamId(flags) {
  return flags.team || flags['team-id'] || flags.team_id || null;
}

export function buildSkillsPath(teamId) {
  if (!teamId) return '/v1/skills';
  return `/v1/skills?team_id=${encodeURIComponent(teamId)}`;
}

export async function resolveSkillId(flags, options, token) {
  if (flags.id !== undefined && String(flags.id).trim()) {
    return String(flags.id).trim();
  }
  const slug = String(flags.slug || '').trim();
  const teamId = resolveTeamId(flags);
  const path = buildSkillsPath(teamId);
  const res = await makeHttpRequest(options.baseUrl, path, 'GET', null, {
    'Authorization': `Bearer ${token}`,
  }, options.timeoutMs);

  const data = handleRestError(res, {
    notFoundMessage: 'Cloud Skills not found.',
    context: 'List cloud skills for slug resolution',
    options,
  });

  const skills = Array.isArray(data) ? data : (Array.isArray(data?.skills) ? data.skills : []);
  let matches = skills.filter((s) => s && s.slug === slug);
  if (matches.length === 0) {
    matches = skills.filter((s) => s && s.name === slug);
  }
  if (matches.length === 0) {
    outputRestError('not_found', `Cloud Skill with slug "${slug}" not found.`, options, null, EXIT_CODE.USER_ERROR);
  }
  if (matches.length > 1) {
    outputRestError('invalid_argument', `Multiple Cloud Skills matched slug "${slug}". Specify --id instead.`, options, null, EXIT_CODE.USER_ERROR);
  }
  const matched = matches[0];
  const resolvedId = matched.skill_id || matched.id;
  if (!resolvedId) {
    outputRestError('not_found', `Cloud Skill with slug "${slug}" has no valid ID.`, options, null, EXIT_CODE.USER_ERROR);
  }
  return resolvedId;
}

export async function handleCloudSkill(ctx) {
  const { command, options, flags, token } = ctx;

  if (command === 'cloud-skill-list') {
    const teamId = resolveTeamId(flags);
    const path = buildSkillsPath(teamId);
    try {
      const res = await makeHttpRequest(options.baseUrl, path, 'GET', null, {
        'Authorization': `Bearer ${token}`,
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Cloud Skills not found.',
        context: 'List cloud skills request',
        options,
      });

      if (options.json) {
        if (Array.isArray(data)) {
          console.log(safeJson({
            ok: true,
            skills: data,
            total: data.length,
          }));
        } else {
          console.log(safeJson({
            ok: true,
            ...data,
          }));
        }
        process.exit(EXIT_CODE.SUCCESS);
      }

      const skills = Array.isArray(data) ? data : (Array.isArray(data?.skills) ? data.skills : []);
      if (skills.length === 0) {
        console.log('No Cloud Skills found.');
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log(`Cloud Skills (${skills.length}):`);
      for (const item of skills) {
        const id = sanitizeTerminalText(item.skill_id || item.id || '(no-id)');
        const slug = sanitizeTerminalText(item.slug || item.name || '');
        const name = sanitizeTerminalText(item.name || slug || '(unnamed)');
        const status = sanitizeTerminalText(item.asset_status || item.status || 'active');
        const desc = item.description ? ` - ${sanitizeTerminalText(item.description)}` : '';
        console.log(`- ${name} (slug: ${slug}, id: ${id}, status: ${status})${desc}`);
      }
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('List cloud skills failed:', describeError(e));
      process.exit(exitCodeForError(e));
    }
  }

  if (command === 'cloud-skill-show') {
    try {
      const skillId = await resolveSkillId(flags, options, token);
      const [res, compRes] = await Promise.all([
        makeHttpRequest(
          options.baseUrl,
          `/v1/skills/${encodeURIComponent(skillId)}`,
          'GET',
          null,
          { 'Authorization': `Bearer ${token}` },
          options.timeoutMs
        ),
        makeHttpRequest(
          options.baseUrl,
          `/v1/skills/${encodeURIComponent(skillId)}/components`,
          'GET',
          null,
          { 'Authorization': `Bearer ${token}` },
          options.timeoutMs
        ),
      ]);

      const data = handleRestError(res, {
        notFoundMessage: `Cloud Skill '${skillId}' not found.`,
        context: 'Show cloud skill request',
        options,
      });

      let components = [];
      if (compRes.statusCode >= 200 && compRes.statusCode < 300) {
        try {
          const compData = parseJsonResponse(compRes, 'Fetch cloud skill components');
          components = Array.isArray(compData) ? compData : (Array.isArray(compData?.components) ? compData.components : []);
        } catch {
          components = [];
        }
      }

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...data,
          components,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      const skill = data.skill || data;
      const pubRev = data.published_revision;
      const latestRev = data.latest_revision;
      const skillName = sanitizeTerminalText(skill.name || skill.slug || skill.skill_id || '(unnamed)');
      const skillIdVal = sanitizeTerminalText(skill.skill_id || skill.id || '');
      const skillSlug = sanitizeTerminalText(skill.slug || '');
      const skillStatus = sanitizeTerminalText(skill.asset_status || skill.status || 'active');
      const skillScope = sanitizeTerminalText(skill.owner_scope_type || 'personal');

      console.log(`Cloud Skill: ${skillName}`);
      console.log(`- ID: ${skillIdVal}`);
      console.log(`- Slug: ${skillSlug}`);
      if (skill.description) {
        console.log(`- Description: ${sanitizeTerminalText(skill.description)}`);
      }
      console.log(`- Status: ${skillStatus}`);
      console.log(`- Scope: ${skillScope}`);
      if (pubRev) {
        const revId = sanitizeTerminalText(pubRev.revision_id || '');
        console.log(`- Published Revision: #${pubRev.revision_number} (${revId})`);
        if (pubRev.published_at) {
          console.log(`  Published At: ${sanitizeTerminalText(pubRev.published_at)}`);
        }
      }
      if (latestRev && (!pubRev || latestRev.revision_id !== pubRev.revision_id)) {
        const revId = sanitizeTerminalText(latestRev.revision_id || '');
        console.log(`- Latest Revision: #${latestRev.revision_number} (${revId})`);
      }
      if (components.length > 0) {
        console.log(`- Components (${components.length}):`);
        for (const c of components) {
          const cName = sanitizeTerminalText(c.name || c.component_name || c.component_id || c.id || '(unnamed)');
          const cType = sanitizeTerminalText(c.component_type || c.type || 'unknown');
          console.log(`  - ${cName} (${cType})`);
        }
      }
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Show cloud skill failed:', describeError(e));
      process.exit(exitCodeForError(e));
    }
  }

  if (command === 'cloud-skill-render') {
    try {
      const skillId = await resolveSkillId(flags, options, token);
      const res = await makeHttpRequest(
        options.baseUrl,
        `/v1/skills/${encodeURIComponent(skillId)}/render`,
        'GET',
        null,
        { 'Authorization': `Bearer ${token}` },
        options.timeoutMs
      );

      const data = handleRestError(res, {
        notFoundMessage: `Cloud Skill '${skillId}' not found.`,
        context: 'Render cloud skill request',
        options,
      });

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...data,
          untrusted_context: true,
          untrusted_warning: UNTRUSTED_CONTEXT_WARNING_MESSAGE,
          warning: UNTRUSTED_CONTEXT_WARNING_MESSAGE,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log(UNTRUSTED_CONTEXT_TERMINAL_WARNING);
      console.log(sanitizeTerminalText(data.rendered_content ?? ''));
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Render cloud skill failed:', describeError(e));
      process.exit(exitCodeForError(e));
    }
  }
}
