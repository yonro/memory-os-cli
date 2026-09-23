import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'release-xmemo-skill.yml');

async function findBashExecutable() {
  if (process.platform === 'win32') {
    const gitBashPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    ];
    for (const p of gitBashPaths) {
      try {
        await access(p);
        return p;
      } catch {}
    }
  }
  return 'bash';
}

function toPosixPath(filePath) {
  if (process.platform === 'win32') {
    const cygpathCandidates = [
      'C:\\Program Files\\Git\\usr\\bin\\cygpath.exe',
      'cygpath',
    ];
    for (const bin of cygpathCandidates) {
      try {
        const out = execFileSync(bin, ['-u', filePath], { encoding: 'utf8' }).trim();
        if (out) return out;
      } catch {}
    }
    let p = filePath.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(p)) {
      return `/cygdrive/${p[0].toLowerCase()}${p.slice(2)}`;
    }
    return p;
  }
  return filePath;
}

async function extractPackagingScript() {
  const workflowContent = await readFile(workflowPath, 'utf8');
  const stepRegex = /- name: Build verified Skill archives\s+shell: bash\s+run: \|\s+([\s\S]*?)\n\s+- name:/;
  const match = workflowContent.match(stepRegex);
  if (!match || !match[1]) {
    throw new Error('Failed to extract "Build verified Skill archives" bash run block from workflow.');
  }
  return match[1];
}

async function setupZipShims(binDir) {
  await mkdir(binDir, { recursive: true });

  const zipPy = `import sys, zipfile, os
zip_path = None
for arg in sys.argv[1:]:
    if arg.endswith('.zip'):
        zip_path = arg
        break
if not zip_path:
    sys.exit(1)
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk('.'):
        for f in sorted(files):
            p = os.path.join(root, f)
            arcname = os.path.relpath(p, '.').replace('\\\\', '/')
            zf.write(p, arcname)
`;

  const unzipPy = `import sys, zipfile
zip_path = None
dest = '.'
args = sys.argv[1:]
for i, arg in enumerate(args):
    if arg.endswith('.zip'):
        zip_path = arg
    elif arg == '-d' and i + 1 < len(args):
        dest = args[i + 1]
if not zip_path:
    sys.exit(1)
with zipfile.ZipFile(zip_path, 'r') as zf:
    zf.extractall(dest)
`;

  await writeFile(path.join(binDir, 'zip.py'), zipPy, 'utf8');
  await writeFile(path.join(binDir, 'unzip.py'), unzipPy, 'utf8');

  const zipSh = `#!/usr/bin/env bash
set -e
args=()
for a in "$@"; do
  if command -v cygpath >/dev/null 2>&1; then
    args+=("$(cygpath -w "$a" 2>/dev/null || echo "$a")")
  else
    args+=("$a")
  fi
done
script_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
py_script="$(cygpath -w "$script_dir/zip.py" 2>/dev/null || echo "$script_dir/zip.py")"
python "$py_script" "\${args[@]}" 2>/dev/null || python3 "$py_script" "\${args[@]}"
`;
  const unzipSh = `#!/usr/bin/env bash
set -e
args=()
for a in "$@"; do
  if command -v cygpath >/dev/null 2>&1; then
    args+=("$(cygpath -w "$a" 2>/dev/null || echo "$a")")
  else
    args+=("$a")
  fi
done
script_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
py_script="$(cygpath -w "$script_dir/unzip.py" 2>/dev/null || echo "$script_dir/unzip.py")"
python "$py_script" "\${args[@]}" 2>/dev/null || python3 "$py_script" "\${args[@]}"
`;

  await writeFile(path.join(binDir, 'zip'), zipSh, { mode: 0o755 });
  await writeFile(path.join(binDir, 'unzip'), unzipSh, { mode: 0o755 });
}

async function runPackagingDrillCase({ name, bashExe, scriptContent, setupFn }) {
  const tempWorkspace = await mkdtemp(path.join(os.tmpdir(), 'verify-pkg-drill-'));
  const binDir = path.join(tempWorkspace, 'bin');
  const tmpDir = path.join(tempWorkspace, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  await setupZipShims(binDir);

  const skillsDir = path.join(tempWorkspace, 'skills', 'xmemo');
  await mkdir(path.dirname(skillsDir), { recursive: true });
  await cp(path.join(repoRoot, 'skills', 'xmemo'), skillsDir, { recursive: true });

  if (setupFn) {
    await setupFn(skillsDir);
  }

  const scriptFile = path.join(tempWorkspace, 'drill-build.sh');
  await writeFile(scriptFile, scriptContent, 'utf8');

  const posixWorkspace = toPosixPath(tempWorkspace);
  const posixBin = toPosixPath(binDir);
  const posixTmp = toPosixPath(tmpDir);

  return new Promise((resolve) => {
    const bashCommand = `export PATH="${posixBin}:$PATH"; export TMPDIR="${posixTmp}"; export GITHUB_WORKSPACE="${posixWorkspace}"; cd "${posixWorkspace}"; bash drill-build.sh`;
    const child = spawn(bashExe, ['-c', bashCommand], {
      cwd: tempWorkspace,
      env: {
        ...process.env,
        GITHUB_WORKSPACE: tempWorkspace,
        TMPDIR: tempWorkspace,
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));

    child.on('close', async (code) => {
      await rm(tempWorkspace, { recursive: true, force: true }).catch(() => {});
      resolve({
        name,
        code: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

async function main() {
  console.log('Running Release Packaging Workflow Execution Drill (executing exact YAML bash block)...');

  const bashExe = await findBashExecutable();
  console.log(`Using bash executable: ${bashExe}`);

  const scriptContent = await extractPackagingScript();
  console.log(`Extracted "Build verified Skill archives" bash block (${scriptContent.length} bytes).`);

  // Drill 1: Positive verification
  console.log('\n--- Drill Case 1: Positive build with real skills/xmemo ---');
  const positiveResult = await runPackagingDrillCase({
    name: 'positive',
    bashExe,
    scriptContent,
  });
  console.log(`Exit code: ${positiveResult.code}`);
  if (positiveResult.stdout) console.log(`Stdout: ${positiveResult.stdout.trim()}`);
  if (positiveResult.stderr) console.log(`Stderr: ${positiveResult.stderr.trim()}`);
  assert.equal(positiveResult.code, 0, `Positive build failed: ${positiveResult.stderr}`);
  console.log('✓ Positive packaging test passed: YAML bash step exited 0 and built verified archives.');

  // Drill 2: Negative verification (scripts/lib/token.mjs)
  console.log('\n--- Drill Case 2: Negative build with planted lib/token.mjs ---');
  const negTokenResult = await runPackagingDrillCase({
    name: 'negative-token',
    bashExe,
    scriptContent,
    setupFn: async (dir) => {
      const libDir = path.join(dir, 'scripts', 'lib');
      await mkdir(libDir, { recursive: true });
      await writeFile(path.join(libDir, 'token.mjs'), 'export const t = 1;\n', 'utf8');
    },
  });
  console.log(`Exit code: ${negTokenResult.code}`);
  console.log(`Stderr: ${negTokenResult.stderr.trim()}`);
  assert.equal(negTokenResult.code, 1, 'Expected exit code 1 for planted token.mjs');
  assert.match(negTokenResult.stderr, /Sensitive-looking file found in skills\/xmemo: scripts\/lib\/token\.mjs/);
  assert.match(negTokenResult.stderr, /Release packaging rejected: 1 file\(s\) matched sensitive name rules: scripts\/lib\/token\.mjs/);
  console.log('✓ Negative drill 1 passed: lib/token.mjs correctly rejected with hard exit 1.');

  // Drill 3: Negative verification (.env.local)
  console.log('\n--- Drill Case 3: Negative build with planted .env.local ---');
  const negEnvResult = await runPackagingDrillCase({
    name: 'negative-env',
    bashExe,
    scriptContent,
    setupFn: async (dir) => {
      await writeFile(path.join(dir, '.env.local'), 'SECRET=123\n', 'utf8');
    },
  });
  console.log(`Exit code: ${negEnvResult.code}`);
  console.log(`Stderr: ${negEnvResult.stderr.trim()}`);
  assert.equal(negEnvResult.code, 1, 'Expected exit code 1 for planted .env.local');
  assert.match(negEnvResult.stderr, /Sensitive-looking file found in skills\/xmemo: \.env\.local/);
  assert.match(negEnvResult.stderr, /Release packaging rejected: 1 file\(s\) matched sensitive name rules: \.env\.local/);
  console.log('✓ Negative drill 2 passed: .env.local correctly rejected with hard exit 1.');

  // Drill 4: Negative verification (secret_dir/)
  console.log('\n--- Drill Case 4: Negative build with planted secret directory ---');
  const negSecretResult = await runPackagingDrillCase({
    name: 'negative-secret',
    bashExe,
    scriptContent,
    setupFn: async (dir) => {
      const secretDir = path.join(dir, 'secret_dir');
      await mkdir(secretDir, { recursive: true });
      await writeFile(path.join(secretDir, 'config.json'), '{"key": "123"}\n', 'utf8');
    },
  });
  console.log(`Exit code: ${negSecretResult.code}`);
  console.log(`Stderr: ${negSecretResult.stderr.trim()}`);
  assert.equal(negSecretResult.code, 1, 'Expected exit code 1 for planted secret directory');
  assert.match(negSecretResult.stderr, /Sensitive-looking file found in skills\/xmemo: secret_dir\/config\.json/);
  assert.match(negSecretResult.stderr, /Release packaging rejected: 1 file\(s\) matched sensitive name rules: secret_dir\/config\.json/);
  console.log('✓ Negative drill 3 passed: secret directory correctly rejected with hard exit 1.');

  console.log('\nAll 4 release packaging bash workflow execution drills passed successfully.');
}

main().catch((err) => {
  console.error('Packaging drill failed:', err);
  process.exit(1);
});
