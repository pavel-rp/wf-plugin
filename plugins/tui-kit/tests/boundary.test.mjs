// Guards the pack's two boundaries: the kit stays host-free (copy-in safe), and
// the pack stays independent of the repository's workflow plugin in both
// directions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packRoot = join(here, '..');
const kitRoot = join(packRoot, 'kit');
const pluginsRoot = join(packRoot, '..');

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.git') return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('kit files are ES modules that import only sibling kit files by relative path', () => {
  const files = walk(kitRoot);
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.match(file, /\.mjs$/, `${file} must be an .mjs module`);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
      assert.match(m[1], /^\.\/[a-z0-9-]+\.mjs$/, `${relative(packRoot, file)} imports ${m[1]}`);
    }
  }
});

test('kit files touch no host or runtime global', () => {
  const banned = [/\brequire\s*\(/, /\bimport\s*\(/, /\bprocess\b/, /\bglobalThis\b/, /\bwindow\b/, /\bDeno\b/, /\bBun\b/, /\$\./];
  for (const file of walk(kitRoot)) {
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const re of banned) assert.doesNotMatch(code, re, `${relative(packRoot, file)} matches ${re}`);
  }
});

test('the pack names nothing of the workflow plugin', () => {
  // Built from parts so this file does not match its own patterns.
  const terms = ['/' + 'wf' + ':', 'wf' + '-', '_' + 'local', 'capa' + 'bilit'];
  for (const file of walk(packRoot)) {
    const src = readFileSync(file, 'utf8');
    for (const term of terms) {
      assert.ok(!src.includes(term), `${relative(packRoot, file)} contains ${JSON.stringify(term)}`);
    }
  }
});

test('the workflow plugin names nothing of the kit', () => {
  const core = join(pluginsRoot, 'wf');
  if (!existsSync(core)) return;
  const name = 'tui' + '-kit';
  const hits = walk(core).filter((f) => readFileSync(f).includes(name));
  assert.deepEqual(hits.map((f) => relative(pluginsRoot, f)), []);
});
