import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { resolveTarget } from '../src/core/target-resolver.js';
import { Plan, executePlan, printPlan } from '../src/core/plan-runner.js';
import {
  CLIENT_REGISTRY,
  allClientIds,
  getClient,
  registerClient,
  supportedClientsForResource,
  unregisterClient
} from '../src/clients/registry.js';

function discoveryFetch() {
  return async (url) => {
    if (url.endsWith('/.well-known/memory-os.json')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            service: 'memory-os',
            urls: {
              api_base: 'https://api.example.test',
              mcp: 'https://mcp.example.test/mcp',
              token_portal: 'https://console.example.test/tokens',
              onboarding_status: 'https://api.example.test/v1/onboarding/status'
            },
            auth: {
              token_env_var: 'XMEMO_KEY'
            }
          };
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ready: true,
          onboarding_complete: true,
          account_ready: true,
          mcp_ready: true
        };
      }
    };
  };
}

function createMockIo({ stdin = '', env = {}, cwd = process.cwd(), fetch = discoveryFetch() } = {}) {
  let stdout = '';
  let stderr = '';
  const listeners = {};
  const io = {
    stdout: { write: (s) => { stdout += s; } },
    stderr: { write: (s) => { stderr += s; }, isTTY: true },
    stdin: {
      isTTY: true,
      on: (event, handler) => {
        listeners[event] = handler;
        if (event === 'data') {
          queueMicrotask(() => {
            handler(stdin);
          });
        }
      },
      off: (event) => {
        delete listeners[event];
      },
      [Symbol.asyncIterator]: async function* () {
        yield stdin;
      }
    },
    env,
    cwd,
    fetch
  };
  return {
    io,
    getStdout: () => stdout,
    getStderr: () => stderr
  };
}

// -----------------------------------------------------------------------------
// Principle 4: One Data Source & Zero Client ID Literals in src/commands
// -----------------------------------------------------------------------------

test('Principle 4: Zero hardcoded client ID string literals in any src/commands/*.js file', async () => {
  const commandsDir = path.resolve('src/commands');
  const files = (await fs.readdir(commandsDir)).filter((f) => f.endsWith('.js'));
  const clientIds = allClientIds();

  const violations = [];

  for (const file of files) {
    const filePath = path.join(commandsDir, file);
    const content = await fs.readFile(filePath, 'utf8');

    for (const id of clientIds) {
      // Regex matches quoted string literal 'id', "id", or `id` (exact match)
      const regex = new RegExp(`(['"\`])${id}\\1`, 'g');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const lineNum = content.slice(0, match.index).split('\n').length;
        violations.push({ file, id, line: lineNum, match: match[0] });
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Found hardcoded client ID literals in src/commands:\n${violations.map((v) => `  ${v.file}:${v.line} -> ${v.match} (client: ${v.id})`).join('\n')}`
  );
});

test('Principle 4: Every registered client has declarative setup schema', () => {
  for (const client of CLIENT_REGISTRY) {
    assert.ok(client.setup, `Client ${client.id} missing setup declaration`);
    assert.ok(Array.isArray(client.setup.default), `Client ${client.id} setup.default must be an array`);
    assert.ok(Array.isArray(client.setup.optional), `Client ${client.id} setup.optional must be an array`);
  }
});

test('Principle 4: Synthetic client dynamically registered supports setup, uninstall, mcp, profile, and tears down cleanly', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-synth-'));
  const configPath = path.join(tmpDir, 'synth-config.json');

  const syntheticClient = {
    id: 'synthetic-test-client',
    label: 'Synthetic Test Client',
    aliases: ['synth-alias'],
    mcp: {
      configKind: 'json',
      defaultConfigPath: () => configPath,
      configPathCandidates: () => [configPath],
      buildSnippet: (url) => ({ mcpServers: { XMemo: { url } } }),
      writeConfig: async (cfgPath, mcpUrl) => {
        await fs.mkdir(path.dirname(cfgPath), { recursive: true });
        await fs.writeFile(cfgPath, JSON.stringify({ mcpServers: { XMemo: { url: mcpUrl } } }, null, 2));
      },
      removeConfig: async (cfgPath) => {
        try {
          await fs.unlink(cfgPath);
          return { removed: true, removedNames: ['XMemo'] };
        } catch {
          return { removed: false };
        }
      },
      section: 'mcpServers',
      serverKind: 'http',
      authentication: 'env-bearer'
    },
    setup: {
      default: ['mcp'],
      optional: []
    }
  };

  try {
    // 1. Register synthetic client
    registerClient(syntheticClient);
    assert.equal(getClient('synthetic-test-client')?.id, 'synthetic-test-client');
    assert.equal(getClient('synth-alias')?.id, 'synthetic-test-client');

    const mcpSupported = supportedClientsForResource('mcp').map((c) => c.id);
    assert.ok(mcpSupported.includes('synthetic-test-client'));

    // 2. Run mcp install with synthetic client
    const { io: ioMcp } = createMockIo();
    const mcpCode = await run(
      ['mcp', 'install', 'synthetic-test-client', '--url', 'https://api.example.com', '--write', '--config', configPath],
      ioMcp
    );
    assert.equal(mcpCode, 0);
    const writtenConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    assert.equal(writtenConfig.mcpServers.XMemo.url, 'https://api.example.com/mcp');

    // 3. Run uninstall with synthetic client
    const { io: ioUninst } = createMockIo({ stdin: 'y\n' });
    const uninstCode = await run(['uninstall', 'synthetic-test-client', '--yes'], ioUninst);
    assert.equal(uninstCode, 0);

    const existsAfter = await fs.access(configPath).then(() => true).catch(() => false);
    assert.equal(existsAfter, false);
  } finally {
    unregisterClient('synthetic-test-client');
    assert.equal(getClient('synthetic-test-client'), null);
    assert.equal(getClient('synth-alias'), null);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Principle 1: One Grammar & Aliases with stderr Hint
// -----------------------------------------------------------------------------

test('Principle 1: mcp install, remove, status grammar works; alias mcp add prints stderr hint in human mode only', async () => {
  // Alias hint in human mode
  const { io: ioAlias, getStderr: getStderrAlias } = createMockIo();
  await run(['mcp', 'add'], ioAlias);
  assert.match(getStderrAlias(), /Hint: 'xmemo mcp add' is an alias for 'xmemo mcp install'\./);

  // No alias hint in JSON mode
  const { io: ioJson, getStderr: getStderrJson } = createMockIo();
  await run(['mcp', 'add', '--json'], ioJson);
  assert.doesNotMatch(getStderrJson(), /Hint:/);

  // Subcommands install and remove exist in mcp help
  const { io: ioHelp, getStdout: getStdoutHelp } = createMockIo();
  await run(['mcp', '--help'], ioHelp);
  assert.match(getStdoutHelp(), /mcp/);
});

test('Principle 1: skill remove and uninstall aliases print stderr hint in human mode only', async () => {
  const { io: ioSkillAlias, getStderr: getStderrSkillAlias } = createMockIo();
  await run(['skill', 'uninstall'], ioSkillAlias);
  assert.match(getStderrSkillAlias(), /Hint: 'xmemo skill uninstall' is an alias for 'xmemo skill remove'\./);

  const { io: ioSkillJson, getStderr: getStderrSkillJson } = createMockIo();
  await run(['skill', 'uninstall', '--json'], ioSkillJson);
  assert.doesNotMatch(getStderrSkillJson(), /Hint:/);
});

test('Principle 1: profile remove and uninstall aliases print stderr hint in human mode only', async () => {
  const { io: ioProfileAlias, getStderr: getStderrProfileAlias } = createMockIo();
  await run(['profile', 'uninstall'], ioProfileAlias);
  assert.match(getStderrProfileAlias(), /Hint: 'xmemo profile uninstall' is an alias for 'xmemo profile remove'\./);

  const { io: ioProfileJson, getStderr: getStderrProfileJson } = createMockIo();
  await run(['profile', 'uninstall', '--json'], ioProfileJson);
  assert.doesNotMatch(getStderrProfileJson(), /Hint:/);
});

// -----------------------------------------------------------------------------
// Principle 2: Target Resolver Precedence
// -----------------------------------------------------------------------------

test('Principle 2: target-resolver precedence explicit -> calling agent env -> detected', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-resolver-'));
  try {
    // 1. Explicit --client flag wins
    const r1 = await resolveTarget('mcp', ['--client', 'codex'], { env: { CLAUDECODE: '1' } });
    assert.equal(r1.client.id, 'codex');
    assert.equal(r1.source, 'explicit');

    // 2. Calling agent env (CLAUDECODE -> claude-code)
    const r2 = await resolveTarget('skill', [], { env: { CLAUDECODE: '1' } });
    assert.equal(r2.client.id, 'claude-code');
    assert.equal(r2.source, 'calling-agent-env');

    // 3. Non-interactive with 0 detected installed clients fails cleanly
    await assert.rejects(
      async () => {
        await resolveTarget('skill', ['--yes'], {
          env: { HOME: tmpHome, USERPROFILE: tmpHome },
          cwd: tmpHome,
          stdin: { isTTY: false }
        });
      },
      /No matching client detected/
    );
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Principle 3: Plan, Confirm Once, Apply (Plan Runner)
// -----------------------------------------------------------------------------

test('Principle 3: Plan runner executes steps sequentially, prompts [y/N] once, stops on first failure, and handles dry-run & idempotency', async () => {
  const executionLog = [];

  const plan = new Plan({
    title: 'Setup Test Client',
    steps: [
      {
        resource: 'plugin',
        client: 'test-client',
        clientLabel: 'Test Client',
        status: 'pending',
        description: 'Install Plugin',
        apply: async () => {
          executionLog.push('step-1');
          return { installed: true };
        }
      },
      {
        resource: 'skill',
        client: 'test-client',
        clientLabel: 'Test Client',
        status: 'pending',
        description: 'Install Skill',
        apply: async () => {
          executionLog.push('step-2');
          return { skill: 'ok' };
        }
      }
    ]
  });

  // 1. Dry run produces preview without executing steps
  const { io: ioDry, getStdout: getStdoutDry } = createMockIo();
  const dryCode = await executePlan(plan, { dryRun: true, io: ioDry });
  assert.equal(dryCode, 0);
  assert.equal(executionLog.length, 0);
  assert.match(getStdoutDry(), /Setup Test Client/);
  assert.match(getStdoutDry(), /Install Plugin/);
  assert.match(getStdoutDry(), /Install Skill/);

  // 2. User confirms [y/N] once with 'y' -> executes both steps sequentially
  const { io: ioConfirm } = createMockIo({ stdin: 'y\n' });
  const confirmCode = await executePlan(plan, { io: ioConfirm });
  assert.equal(confirmCode, 0);
  assert.deepEqual(executionLog, ['step-1', 'step-2']);

  // 3. User rejects [y/N] with 'n' -> cancels without executing
  const execLogReject = [];
  const planReject = new Plan({
    title: 'Setup Test Client',
    steps: [{
      resource: 'test',
      client: 'test-client',
      clientLabel: 'Test Client',
      status: 'pending',
      description: 'Step 1',
      apply: async () => { execLogReject.push('s1'); }
    }]
  });
  const { io: ioReject, getStdout: getStdoutReject } = createMockIo({ stdin: 'n\n' });
  const rejectCode = await executePlan(planReject, { io: ioReject });
  assert.equal(rejectCode, 0);
  assert.equal(execLogReject.length, 0);
  assert.match(getStdoutReject(), /cancelled/i);

  // 4. Stops on first failure
  const failLog = [];
  const planFail = new Plan({
    title: 'Failing Plan',
    steps: [
      {
        resource: 'step-1',
        client: 'c1',
        clientLabel: 'C1',
        status: 'pending',
        description: 'Fail Step',
        apply: async () => { failLog.push('f1'); throw new Error('Boom'); }
      },
      {
        resource: 'step-2',
        client: 'c2',
        clientLabel: 'C2',
        status: 'pending',
        description: 'Never Run',
        apply: async () => { failLog.push('f2'); }
      }
    ]
  });
  const { io: ioFail, getStderr: getStderrFail } = createMockIo({ stdin: 'y\n' });
  const failCode = await executePlan(planFail, { io: ioFail });
  assert.equal(failCode, 1);
  assert.match(getStderrFail(), /Boom/);
  assert.deepEqual(failLog, ['f1']);

  // 5. Empty plan (idempotent / all up to date) prints "Nothing to do"
  const emptyPlan = new Plan({ title: 'Empty Plan', steps: [] });
  const { io: ioEmpty, getStdout: getStdoutEmpty } = createMockIo();
  const emptyCode = await executePlan(emptyPlan, { io: ioEmpty });
  assert.equal(emptyCode, 0);
  assert.match(getStdoutEmpty(), /Nothing to do \(all components are up to date\)/);
});

// -----------------------------------------------------------------------------
// Reviewer Findings 1-5 End-to-End Verification Scenarios
// -----------------------------------------------------------------------------

test('Reviewer Finding 1: skill install target resolution uses calling-agent env when --client omitted', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-target-'));
  try {
    const { io, getStdout } = createMockIo({
      env: {
        HOME: tmpHome,
        USERPROFILE: tmpHome,
        CLAUDECODE: '1'
      },
      cwd: tmpHome
    });
    const code = await run(['skill', 'install', '--dry-run', '--yes'], io);
    assert.equal(code, 0);
    const expectedSubpath = path.join('.claude', 'skills', 'xmemo-memory');
    assert.ok(getStdout().includes(expectedSubpath), `Stdout should contain ${expectedSubpath}: ${getStdout()}`);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});

test('Reviewer Finding 1: skill install target resolution detects single installed client when --client omitted', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-detect-'));
  try {
    await fs.mkdir(path.join(tmpHome, '.codex'), { recursive: true });
    const { io, getStdout } = createMockIo({
      env: {
        HOME: tmpHome,
        USERPROFILE: tmpHome
      },
      cwd: tmpHome
    });
    const code = await run(['skill', 'install', '--dry-run', '--yes'], io);
    assert.equal(code, 0);
    const expectedSubpath = path.join('.codex', 'skills', 'xmemo-memory');
    assert.ok(getStdout().includes(expectedSubpath), `Stdout should contain ${expectedSubpath}: ${getStdout()}`);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});

test('Reviewer Finding 1: skill install with multiple detected clients fails cleanly asking for --client or --all', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-multi-'));
  try {
    await fs.mkdir(path.join(tmpHome, '.codex'), { recursive: true });
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    const { io, getStderr } = createMockIo({
      env: {
        HOME: tmpHome,
        USERPROFILE: tmpHome
      },
      cwd: tmpHome
    });
    const code = await run(['skill', 'install', '--dry-run', '--yes'], io);
    assert.equal(code, 2);
    assert.match(getStderr(), /Multiple matching clients detected.*specify --client <id> or --all/);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});

test('Reviewer Finding 1: skill install with no clients detected fails cleanly asking for --client <id> or --dir <path>', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-none-'));
  try {
    const { io, getStderr } = createMockIo({
      env: {
        HOME: tmpHome,
        USERPROFILE: tmpHome
      },
      cwd: tmpHome
    });
    const code = await run(['skill', 'install', '--dry-run', '--yes'], io);
    assert.equal(code, 2);
    assert.match(getStderr(), /No matching client detected; specify --client <id> \(or --dir <path>\)/);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});

test('Reviewer Finding 2 & 3: setup cursor prompts once; cancel leaves files untouched; confirm writes; rerun is idempotent', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-setup-home-'));
  const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-setup-ws-'));
  try {
    const mcpPath = path.join(tmpHome, '.cursor', 'mcp.json');
    const profilePath = path.join(tmpHome, '.cursor', 'memory-profile.md');

    // 1. Enter cancels and leaves all files untouched
    const { io: ioCancel, getStdout: getStdoutCancel } = createMockIo({
      stdin: '\n',
      env: { HOME: tmpHome, USERPROFILE: tmpHome, APPDATA: tmpHome },
      cwd: tmpWorkspace
    });
    const codeCancel = await run(['setup', 'cursor', '--url', 'https://api.example.test'], ioCancel);
    assert.equal(codeCancel, 0);
    assert.match(getStdoutCancel(), /Proceed with above changes\? \[y\/N\]/);
    assert.match(getStdoutCancel(), /Operation cancelled\./);
    assert.equal(await fs.access(mcpPath).then(() => true).catch(() => false), false);
    assert.equal(await fs.access(profilePath).then(() => true).catch(() => false), false);

    // 2. Setup with --yes writes both MCP and profile
    const { io: ioApply, getStdout: getStdoutApply } = createMockIo({
      env: { HOME: tmpHome, USERPROFILE: tmpHome, APPDATA: tmpHome },
      cwd: tmpWorkspace
    });
    const codeApply = await run(['setup', 'cursor', '--url', 'https://api.example.test', '--yes'], ioApply);
    assert.equal(codeApply, 0);
    assert.match(getStdoutApply(), /Written: true/);
    assert.match(getStdoutApply(), /Behavior profile installed: true/);
    assert.equal(await fs.access(mcpPath).then(() => true).catch(() => false), true);
    assert.equal(await fs.access(profilePath).then(() => true).catch(() => false), true);

    // 3. Rerun setup with --yes is idempotent: reports Nothing to do and leaves config intact
    const { io: ioRerun, getStdout: getStdoutRerun } = createMockIo({
      env: { HOME: tmpHome, USERPROFILE: tmpHome, APPDATA: tmpHome },
      cwd: tmpWorkspace
    });
    const codeRerun = await run(['setup', 'cursor', '--url', 'https://api.example.test', '--yes'], ioRerun);
    assert.equal(codeRerun, 0);
    assert.match(getStdoutRerun(), /Nothing to do \(all components are up to date\)/);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
  }
});

test('Reviewer Finding 4: setup openclaw defaults to plugin and skill; --no-skill skips skill', async () => {
  const { io: ioDry, getStdout: getStdoutDry } = createMockIo();
  const codeDry = await run(['setup', 'openclaw', '--url', 'https://api.example.test', '--dry-run'], ioDry);
  assert.equal(codeDry, 0);
  const outDry = getStdoutDry();
  assert.match(outDry, /openclaw plugins install/);
  assert.match(outDry, /openclaw skills install/);

  const { io: ioNoSkill, getStdout: getStdoutNoSkill } = createMockIo();
  const codeNoSkill = await run(['setup', 'openclaw', '--url', 'https://api.example.test', '--dry-run', '--no-skill'], ioNoSkill);
  assert.equal(codeNoSkill, 0);
  const outNoSkill = getStdoutNoSkill();
  assert.match(outNoSkill, /openclaw plugins install/);
  assert.doesNotMatch(outNoSkill, /openclaw skills install/);
});

test('Reviewer Finding 5: skill install --dry-run without npm on PATH produces plan and exits 0', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-no-npm-'));
  try {
    const { io, getStdout } = createMockIo({
      env: { PATH: '' },
      cwd: tmpDir
    });
    const code = await run(['skill', 'install', '--dir', tmpDir, '--dry-run'], io);
    assert.equal(code, 0);
    assert.match(getStdout(), /Would install XMemo Skill/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

