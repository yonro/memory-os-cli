import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));

async function temp(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-client-bin-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function findNpmCli() {
  const npmCandidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean);

  for (const candidate of npmCandidates) {
    try {
      if (candidate.endsWith('.js')) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

function child(executable, args, { cwd, env, input = '', timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Process timed out after ${timeout}ms: ${executable} ${args.join(' ')}`));
    }, timeout);

    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.stdout.on('data', (data) => {
      stdout += data;
    });
    proc.stderr.on('data', (data) => {
      stderr += data;
    });
    proc.stdin.on('error', () => {});
    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    if (input) {
      proc.stdin.write(input);
    }
    proc.stdin.end();
  });
}

test('package.json declares client bin mapping to bin/memory-os.js', async () => {
  const pkgContent = await fs.readFile(path.join(root, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgContent);
  assert.equal(pkg.bin?.client, 'bin/memory-os.js');
  assert.equal(pkg.bin?.xmemo, 'bin/memory-os.js');
  assert.equal(pkg.bin?.['xmemo-mcp'], 'bin/mcp-stdio.js');
  assert.equal(pkg.bin?.['memory-os'], 'bin/memory-os.js');
});

test('packed tarball exposes bin client and npm exec runs client commands', async (t) => {
  const npmCli = findNpmCli();
  assert.ok(npmCli, 'Could not locate npm-cli.js');

  const pkgContent = await fs.readFile(path.join(root, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgContent);
  const expectedVersion = pkg.version;

  const directory = await temp(t);
  const cleanEnv = {
    ...process.env,
    XMEMO_KEY: '',
    MEMORY_OS_API_KEY: '',
    MEMORY_OS_MCP_TOKEN: '',
    npm_config_cache: path.join(directory, 'npm-cache')
  };

  // 1. Pack the package into the temp directory
  const packResult = await child(
    process.execPath,
    [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', directory],
    { cwd: root, env: cleanEnv }
  );
  assert.equal(packResult.code, 0, packResult.stderr);

  const packInfo = JSON.parse(packResult.stdout)[0];
  assert.ok(packInfo.filename, 'pack output should contain filename');
  const tgzPath = path.join(directory, packInfo.filename);

  // 2. Unpack package.json from the tarball and verify bin field
  const unpacked = path.join(directory, 'unpacked');
  await fs.mkdir(unpacked);
  const extractResult = await child(
    'tar',
    ['-xf', tgzPath, '-C', unpacked],
    { cwd: directory, env: cleanEnv }
  );
  assert.equal(extractResult.code, 0, extractResult.stderr);

  const unpackedPkg = JSON.parse(
    await fs.readFile(path.join(unpacked, 'package', 'package.json'), 'utf8')
  );
  assert.equal(unpackedPkg.bin?.client, 'bin/memory-os.js');

  // 3. Subprocess test running `client --version` via npm exec --package <tgz>
  const versionRun = await child(
    process.execPath,
    [npmCli, 'exec', '--offline', '--package', tgzPath, '--', 'client', '--version'],
    { cwd: directory, env: cleanEnv }
  );
  assert.equal(versionRun.code, 0, versionRun.stderr);
  assert.equal(versionRun.stdout.trim(), expectedVersion);

  // 4. Subprocess test running `client mcp serve` via npm exec --package <tgz>
  const mcpProc = spawn(
    process.execPath,
    [npmCli, 'exec', '--offline', '--package', tgzPath, '--', 'client', 'mcp', 'serve'],
    {
      cwd: directory,
      env: cleanEnv,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );

  let mcpStdout = '';
  let mcpStderr = '';
  mcpProc.stdout.setEncoding('utf8');
  mcpProc.stderr.setEncoding('utf8');
  mcpProc.stdout.on('data', (chunk) => {
    mcpStdout += chunk;
  });
  mcpProc.stderr.on('data', (chunk) => {
    mcpStderr += chunk;
  });

  const request = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  mcpProc.stdin.write(`${JSON.stringify(request)}\n`);
  mcpProc.stdin.end();

  const mcpExitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      mcpProc.kill();
      reject(new Error('client mcp serve subprocess timed out after 30s'));
    }, 30000);

    mcpProc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    mcpProc.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  assert.equal(mcpExitCode, 0, mcpStderr);

  const lines = mcpStdout.trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length >= 1, `Expected at least 1 JSON-RPC response line, got: ${mcpStdout}`);
  const jsonRpcResponse = JSON.parse(lines[0]);
  assert.equal(jsonRpcResponse.id, 1);
  assert.ok(jsonRpcResponse.result?.tools?.length > 0, 'Tools list should not be empty');
  const toolNames = jsonRpcResponse.result.tools.map((t) => t.name);
  assert.ok(toolNames.includes('get_mcp_identity'));
  assert.ok(toolNames.includes('remember'));
});
