import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const roots = ['bin', 'src', 'test'];
const files = [];

for (const root of roots) {
  await collectJavaScriptFiles(root, files);
}

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function collectJavaScriptFiles(dir, output) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectJavaScriptFiles(entryPath, output);
    } else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) {
      output.push(entryPath);
    }
  }
}