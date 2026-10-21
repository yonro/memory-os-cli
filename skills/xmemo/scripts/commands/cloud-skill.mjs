import {
  EXIT_CODE,
  exitCodeForError,
} from '../lib/core.mjs';

import {
  makeHttpRequest,
  handleRestError,
  outputRestError,
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
  const matched = skills.find((s) => s && (s.slug === slug || s.name === slug));
  if (!matched || !matched.skill_id) {
    outputRestError('not_found', `Cloud Skill with slug "${slug}" not found.`, options, null, EXIT_CODE.USER_ERROR);
  }
  return matched.skill_id;
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
        const id = item.skill_id || item.id || '(no-id)';
        const slug = item.slug || item.name || '';
        const name = item.name || slug || '(unnamed)';
        const status = item.asset_status || item.status || 'active';
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
      const res = await makeHttpRequest(
        options.baseUrl,
        `/v1/skills/${encodeURIComponent(skillId)}`,
        'GET',
        null,
        { 'Authorization': `Bearer ${token}` },
        options.timeoutMs
      );

      const data = handleRestError(res, {
        notFoundMessage: `Cloud Skill '${skillId}' not found.`,
        context: 'Show cloud skill request',
        options,
      });

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...data,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      const skill = data.skill || data;
      const pubRev = data.published_revision;
      const latestRev = data.latest_revision;
      console.log(`Cloud Skill: ${skill.name || skill.slug || skill.skill_id}`);
      console.log(`- ID: ${skill.skill_id}`);
      console.log(`- Slug: ${skill.slug}`);
      if (skill.description) {
        console.log(`- Description: ${sanitizeTerminalText(skill.description)}`);
      }
      console.log(`- Status: ${skill.asset_status || 'active'}`);
      console.log(`- Scope: ${skill.owner_scope_type || 'personal'}`);
      if (pubRev) {
        console.log(`- Published Revision: #${pubRev.revision_number} (${pubRev.revision_id})`);
        if (pubRev.published_at) {
          console.log(`  Published At: ${pubRev.published_at}`);
        }
      }
      if (latestRev && (!pubRev || latestRev.revision_id !== pubRev.revision_id)) {
        console.log(`- Latest Revision: #${latestRev.revision_number} (${latestRev.revision_id})`);
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
        const warnings = Array.isArray(data.warnings) ? [...data.warnings] : [];
        if (!warnings.includes(UNTRUSTED_CONTEXT_WARNING_MESSAGE)) {
          warnings.unshift(UNTRUSTED_CONTEXT_WARNING_MESSAGE);
        }
        console.log(safeJson({
          ok: true,
          untrusted_context: true,
          warning: UNTRUSTED_CONTEXT_WARNING_MESSAGE,
          ...data,
          warnings,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log(UNTRUSTED_CONTEXT_TERMINAL_WARNING);
      console.log(data.rendered_content ?? '');
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Render cloud skill failed:', describeError(e));
      process.exit(exitCodeForError(e));
    }
  }
}
