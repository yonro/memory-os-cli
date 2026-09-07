import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDirectory = path.join(repositoryRoot, 'test');
const testFiles = (await readdir(testDirectory))
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(testDirectory, name));

if (testFiles.length === 0) {
  console.error(`No root CLI tests found in ${testDirectory}.`);
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(`Could not start the Node test runner: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) process.exitCode = 1;
    else process.exitCode = code ?? 1;
  });
}
