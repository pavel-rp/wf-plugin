import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../..');
const target = resolve(repoRoot, process.argv[2] ?? '_local');

async function discover(path) {
  const info = await stat(path);
  if (info.isFile()) return path.endsWith('.test.ts') ? [path] : [];

  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() && ['node_modules', '.git'].includes(entry.name)) continue;
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...await discover(child));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(child);
  }
  return files;
}

const files = await discover(target);
if (files.length === 0) {
  console.log('No *.test.ts files found.');
  process.exit(0);
}

const child = spawn(
  process.execPath,
  ['--test', '--test-reporter=spec', '--no-warnings=MODULE_TYPELESS_PACKAGE_JSON', ...files],
  { cwd: repoRoot, stdio: 'inherit' },
);
child.on('exit', code => process.exit(code ?? 1));
