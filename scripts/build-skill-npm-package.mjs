#!/usr/bin/env node

import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function isSensitiveName(name) {
  const lower = name.toLowerCase();
  if (lower === '.env' || lower.startsWith('.env.')) return true;
  return /(secret|token|key|credential)/i.test(lower);
}

export async function extractSkillVersion(skillScriptPath) {
  const content = await fs.readFile(skillScriptPath, 'utf8');
  const match = content.match(/const SKILL_VERSION = '([^']+)';/);
  if (!match?.[1]) {
    throw new Error(`SKILL_VERSION was not found in: ${skillScriptPath}`);
  }
  return match[1];
}

export async function collectSourceFiles(sourceDir, currentSubdir = '') {
  const dirPath = currentSubdir ? path.join(sourceDir, currentSubdir) : sourceDir;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const relPath = currentSubdir ? path.join(currentSubdir, entry.name) : entry.name;
    const fullPath = path.join(sourceDir, relPath);

    // Symlink check using lstat
    const lstat = await fs.lstat(fullPath);
    if (lstat.isSymbolicLink()) {
      throw new Error(`Refusing to package symlinks: ${relPath}`);
    }

    // C3 sensitive name check on every path segment
    const segments = relPath.split(path.sep);
    for (const segment of segments) {
      if (isSensitiveName(segment)) {
        throw new Error(`Sensitive-looking file found in skill source: ${relPath}`);
      }
    }

    if (entry.isDirectory()) {
      const nested = await collectSourceFiles(sourceDir, relPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      if (entry.name === 'install.sh' || entry.name === 'install.ps1') {
        throw new Error(`Installer scripts must not be inside skill directory: ${relPath}`);
      }
      results.push(relPath);
    }
  }

  return results;
}

export async function buildSkillNpmPackage({
  outDir,
  repoRoot = DEFAULT_REPO_ROOT,
  sourceDir = path.join(repoRoot, 'skills', 'xmemo'),
  installerSource = path.join(repoRoot, 'packages', 'skill-installer', 'install.mjs'),
  licenseSource = path.join(repoRoot, 'LICENSE'),
} = {}) {
  if (!outDir) {
    throw new Error('Option --out <directory> is required.');
  }

  const resolvedOutDir = path.resolve(process.cwd(), outDir);

  // 1. Refuse non-empty destination directory
  const outStat = await fs.stat(resolvedOutDir).catch(() => null);
  if (outStat) {
    if (!outStat.isDirectory()) {
      throw new Error(`Output path is not a directory: ${resolvedOutDir}`);
    }
    const entries = await fs.readdir(resolvedOutDir);
    if (entries.length > 0) {
      throw new Error(`Output directory is not empty: ${resolvedOutDir}`);
    }
  } else {
    await fs.mkdir(resolvedOutDir, { recursive: true });
  }

  // 2. Validate skill source and extract version
  const skillScriptPath = path.join(sourceDir, 'scripts', 'xmemo-skill.mjs');
  const skillMdPath = path.join(sourceDir, 'SKILL.md');
  const [skillScriptStat, skillMdStat] = await Promise.all([
    fs.stat(skillScriptPath).catch(() => null),
    fs.stat(skillMdPath).catch(() => null),
  ]);
  if (!skillScriptStat?.isFile() || !skillMdStat?.isFile()) {
    throw new Error(`Invalid skill source directory (missing SKILL.md or scripts/xmemo-skill.mjs): ${sourceDir}`);
  }

  const skillVersion = await extractSkillVersion(skillScriptPath);

  // 3. Collect, validate (C3/symlinks), and stage files into <out>/skill/
  const relativeFiles = await collectSourceFiles(sourceDir);
  const targetSkillDir = path.join(resolvedOutDir, 'skill');
  await fs.mkdir(targetSkillDir, { recursive: true });

  for (const relFile of relativeFiles) {
    const srcFile = path.join(sourceDir, relFile);
    const dstFile = path.join(targetSkillDir, relFile);
    await fs.mkdir(path.dirname(dstFile), { recursive: true });
    await fs.copyFile(srcFile, dstFile);
  }

  // 4. Sorted manifest check between source and staged files
  const sourceManifest = relativeFiles.map((p) => p.split(path.sep).join('/')).sort();
  const stagedRelativeFiles = await collectSourceFiles(targetSkillDir);
  const stagedManifest = stagedRelativeFiles.map((p) => p.split(path.sep).join('/')).sort();

  if (sourceManifest.join('\n') !== stagedManifest.join('\n')) {
    throw new Error('Release packaging rejected: source files and staged files manifest do not match.');
  }

  // 5. Stage installer into <out>/bin/install.mjs
  const installerStat = await fs.stat(installerSource).catch(() => null);
  if (!installerStat?.isFile()) {
    throw new Error(`Missing installer source file: ${installerSource}`);
  }
  const targetBinDir = path.join(resolvedOutDir, 'bin');
  await fs.mkdir(targetBinDir, { recursive: true });

  const installerContent = await fs.readFile(installerSource, 'utf8');
  const targetInstallerPath = path.join(targetBinDir, 'install.mjs');
  const finalInstallerContent = installerContent.startsWith('#!')
    ? installerContent
    : `#!/usr/bin/env node\n\n${installerContent}`;
  await fs.writeFile(targetInstallerPath, finalInstallerContent, { encoding: 'utf8', mode: 0o755 });
  await fs.chmod(targetInstallerPath, 0o755).catch(() => {});

  // 6. Copy LICENSE
  const licenseStat = await fs.stat(licenseSource).catch(() => null);
  if (!licenseStat?.isFile()) {
    throw new Error(`Missing LICENSE file: ${licenseSource}`);
  }
  await fs.copyFile(licenseSource, path.join(resolvedOutDir, 'LICENSE'));

  // 7. Write README.md
  const readmeContent = `# @xmemo/skill

Standalone installer and distribution package for the official [XMemo](https://xmemo.dev) agent skill.

## Quick Start

Install the skill into your local project or agent environment (zero network, offline):

\`\`\`bash
npx @xmemo/skill install
\`\`\`

### Installation Options

- \`--target <dir>\`: Specify destination directory (default: \`xmemo-skill\`, or \`$XMEMO_SKILL_DIR\`)
- \`--dry-run\`: Preview installation actions without writing files
- \`--force\`: Overwrite destination directory if it already exists
- \`--json\`: Output machine-readable JSON report

## Commands

- \`xmemo-skill install\`: Install the bundled skill files
- \`xmemo-skill version\`: Print the skill version (\`${skillVersion}\`)
- \`xmemo-skill help\`: Display command usage and options

## Package Integrity

- **Zero dependencies**: Uses Node.js standard library only (\`fs\`, \`path\`, \`crypto\`, \`url\`, \`process\`).
- **Offline only**: The installer performs zero network requests and transmits no credentials.
- **Byte-identical**: The staged skill payload matches the verified GitHub Release archive.

## License

MIT
`;
  await fs.writeFile(path.join(resolvedOutDir, 'README.md'), readmeContent, 'utf8');

  // 8. Write package.json
  const packageJson = {
    name: '@xmemo/skill',
    version: skillVersion,
    description: 'Standalone installer and distribution package for the XMemo agent skill.',
    type: 'module',
    bin: {
      'xmemo-skill': 'bin/install.mjs',
    },
    files: [
      'bin',
      'skill',
      'README.md',
      'LICENSE',
    ],
    engines: {
      node: '>=20.0.0',
    },
    repository: {
      type: 'git',
      url: 'git+https://github.com/yonro/memory-os-cli.git',
      directory: 'skills/xmemo',
    },
    license: 'MIT',
  };

  await fs.writeFile(
    path.join(resolvedOutDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n',
    'utf8',
  );

  return {
    package: '@xmemo/skill',
    version: skillVersion,
    outDir: resolvedOutDir,
    fileCount: sourceManifest.length,
  };
}

function parseCliArgs(argv) {
  let outDir = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/build-skill-npm-package.mjs --out <directory>');
      console.log('');
      console.log('Options:');
      console.log('  --out <directory>   Output directory for the npm package (must be empty or not exist)');
      console.log('  --help, -h          Show this help message');
      process.exit(0);
    }
    if (arg === '--out') {
      outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outDir = arg.slice('--out='.length);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (!outDir) {
    throw new Error('Missing required option: --out <directory>');
  }
  return { outDir };
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  const currentPath = fileURLToPath(import.meta.url);
  if (process.argv[1] === currentPath || path.resolve(process.argv[1]) === currentPath) {
    return true;
  }
  try {
    return realpathSync(process.argv[1]) === realpathSync(currentPath);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  try {
    const { outDir } = parseCliArgs(process.argv.slice(2));
    const result = await buildSkillNpmPackage({ outDir });
    console.log(`Successfully built ${result.package}@${result.version} in ${result.outDir} (${result.fileCount} skill files).`);
  } catch (err) {
    console.error(`Build failed: ${err.message || String(err)}`);
    process.exit(1);
  }
}
