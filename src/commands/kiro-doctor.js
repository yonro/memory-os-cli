import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hasFlag, optionValue } from '../core/args.js';
import { UsageError } from '../core/errors.js';
import { isPlainObject, parseJsonConfig } from '../core/runtime.js';
import { defaultKiroConfigPath } from '../mcp/identity/paths.js';
import { jsonClientServerConfig } from '../mcp/formats/json.js';
import { writeLine } from '../core/io.js';

// Offline configuration repair only: never read OAuth stores, send tokens, or kill processes.
export async function kiroDoctor(args, io) {
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--client', '--config', '--auth', '--fix', '--json'].includes(flag) || seen.has(flag)) throw new UsageError('Unsupported or duplicate Kiro doctor option. Use --client kiro [--config PATH] [--auth oauth|key] [--fix] [--json].');
    seen.add(flag);
    if (['--client', '--config', '--auth'].includes(flag)) { optionValue(args, flag); i++; }
  }
  const configPath = optionValue(args, '--config') ?? defaultKiroConfigPath(io.env);
  const auth = optionValue(args, '--auth');
  if (auth && !['oauth', 'key'].includes(auth)) throw new UsageError('--auth must be oauth or key.');
  const fix = hasFlag(args, '--fix');
  let raw;
  try { raw = await fs.readFile(configPath, 'utf8'); }
  catch (e) { if (e.code !== 'ENOENT') throw new UsageError('Cannot read Kiro config.'); }
  let config;
  try { config = raw === undefined ? {} : parseJsonConfig(raw, configPath); }
  catch { throw new UsageError('Kiro config is invalid JSON; unchanged.'); }
  if (!isPlainObject(config) || (config.mcpServers !== undefined && !isPlainObject(config.mcpServers))) throw new UsageError('Invalid Kiro MCP configuration; unchanged.');
  const server = config.mcpServers?.XMemo;
  const issues = [];
  if (isPlainObject(server) && ['headers', 'env', 'oauth'].some(k => server[k] !== undefined && !isPlainObject(server[k]))) throw new UsageError('Invalid Kiro authentication fields; config unchanged.');
  if (!isPlainObject(server)) issues.push('xmemo_server_missing');
  const legacy = isPlainObject(server) && Array.isArray(server.args) && server.args.includes('mcp-remote');
  if (legacy) issues.push('legacy_mcp_remote');
  if (server?.command && !legacy) issues.push('custom_command_requires_manual_review');
  const authorization = Object.entries(server?.headers ?? {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
  if (server?.env?.XMEMO_KEY === '${env:XMEMO_KEY}' || (typeof authorization === 'string' && authorization.includes('${env:'))) issues.push('unsupported_key_interpolation');
  if (server?.oauth && authorization) issues.push('oauth_authorization_conflict');
  if (typeof authorization === 'string' && authorization !== 'Bearer ${XMEMO_KEY}') issues.push('nonstandard_authorization_header');
  let endpoint = server?.url ?? (legacy ? server.args.find(a => typeof a === 'string' && /^https?:\/\//.test(a)) : undefined);
  let validEndpoint = false;
  try { const u = new URL(endpoint); validEndpoint = u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/mcp'; } catch { /* reported below */ }
  if (!validEndpoint) issues.push('invalid_or_missing_https_endpoint');
  const mode = auth ?? (authorization && !server?.oauth && !legacy ? 'key' : 'oauth');
  if (auth && isPlainObject(server) && ((auth === 'key' && !authorization) || (auth === 'oauth' && authorization))) issues.push('authentication_mode_change');
  const report = { client: 'kiro', configPath, ok: issues.length === 0, issues, fixed: false, authentication: mode, networkUsed: false, authenticationVerified: false };
  if (fix && issues.length) {
    if (!server || !validEndpoint || (server.command && !legacy)) throw new UsageError('Cannot safely repair this Kiro entry. Run setup kiro or review its endpoint/command; config unchanged.');
    const identity = { agentId: server.headers?.['X-Memory-OS-Agent-ID'] ?? 'kiro', agentInstanceId: server.headers?.['X-Memory-OS-Agent-Instance-ID'] ?? server.env?.XMEMO_AGENT_INSTANCE_ID ?? `xmemo-kiro-${randomUUID()}` };
    const replacement = jsonClientServerConfig('kiro', endpoint, identity, { auth: mode });
    // Preserve transport timeouts, tool approvals, disabled state and unrelated client fields.
    const { command, args: oldArgs, env, headers, oauth, type, ...retained } = server;
    const safeHeaders = Object.fromEntries(Object.entries(headers ?? {}).filter(([k]) => k.toLowerCase() !== 'authorization'));
    config.mcpServers.XMemo = { ...retained, ...replacement, headers: { ...safeHeaders, ...replacement.headers } };
    if (mode === 'oauth' && isPlainObject(oauth)) config.mcpServers.XMemo.oauth = oauth;
    const backupPath = `${configPath}.xmemo-backup-${randomUUID()}`;
    await fs.writeFile(backupPath, raw, { flag: 'wx', mode: 0o600 });
    // Refuse to overwrite a concurrent editor change after creating the backup.
    if (await fs.readFile(configPath, 'utf8') !== raw) throw new UsageError('Kiro config changed during repair; retry after the editor finishes.');
    const temporary = path.join(path.dirname(configPath), `.xmemo-repair-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, configPath);
    } finally { await fs.rm(temporary, { force: true }); }
    Object.assign(report, { ok: true, fixed: true, backupPath });
  }
  report.nextStep = report.fixed ? 'Reload Kiro. Complete OAuth consent or supply XMEMO_KEY in the launching environment. Verify a real tool call; config repair does not prove authentication.' : report.ok ? 'Configuration check passed; verify authentication in Kiro.' : 'Run xmemo doctor --client kiro --fix to repair a recognized configuration.';
  writeLine(io.stdout, hasFlag(args, '--json') ? JSON.stringify(report, null, 2) : `${report.ok ? 'PASS' : 'FAIL'} Kiro configuration: ${issues.join(', ') || 'native HTTP'}\n${report.nextStep}${report.backupPath ? `\nBackup: ${report.backupPath}` : ''}`);
  return report.ok ? 0 : 1;
}
