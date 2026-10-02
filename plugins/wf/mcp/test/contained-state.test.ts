// WF-1004 — the aside-lock directory listing is bound to the directory its
// walk verified: a directory swapped between the checks and the listing is
// `unsafe`, never an `ok` listing of whatever was swapped in.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { listContainedStateEntries } from "../src/resolver/contained-state.js";

const DIR = "_local/resolver";
const PREFIX = "setup.lock.stale-";
const noLinks = process.platform === "win32";
const noPermissionTests = process.platform === "win32" || process.getuid?.() === 0;

function sandbox(): { root: string; outside: string; cleanup: () => void } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "wf-contained-list-")));
  const root = join(base, "ws");
  const outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  return { root, outside, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function write(path: string, content = "x"): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

test("lists only prefix-matching names, sorted", () => {
  const s = sandbox();
  try {
    write(join(s.root, DIR, `${PREFIX}bbbbbbbbbbbb`));
    write(join(s.root, DIR, `${PREFIX}aaaaaaaaaaaa`));
    write(join(s.root, DIR, "setup.lock"));
    const listed = listContainedStateEntries(s.root, DIR, PREFIX);
    assert.deepEqual(listed, { ok: true, names: [`${PREFIX}aaaaaaaaaaaa`, `${PREFIX}bbbbbbbbbbbb`] });
  } finally {
    s.cleanup();
  }
});

test("an absent directory or ancestor has no entries", () => {
  const s = sandbox();
  try {
    assert.deepEqual(listContainedStateEntries(s.root, DIR, PREFIX), { ok: true, names: [] });
    mkdirSync(join(s.root, "_local"));
    assert.deepEqual(listContainedStateEntries(s.root, DIR, PREFIX), { ok: true, names: [] });
  } finally {
    s.cleanup();
  }
});

test("a hook that changes nothing leaves the listing ok", () => {
  const s = sandbox();
  try {
    write(join(s.root, DIR, `${PREFIX}aaaaaaaaaaaa`));
    let fired = false;
    const listed = listContainedStateEntries(s.root, DIR, PREFIX, { afterVerify: () => (fired = true) });
    assert.equal(fired, true);
    assert.deepEqual(listed, { ok: true, names: [`${PREFIX}aaaaaaaaaaaa`] });
  } finally {
    s.cleanup();
  }
});

test("a symlinked directory found by the walk is unsafe", { skip: noLinks }, () => {
  const s = sandbox();
  try {
    write(join(s.outside, `${PREFIX}aaaaaaaaaaaa`));
    mkdirSync(join(s.root, "_local"));
    symlinkSync(s.outside, join(s.root, DIR));
    const listed = listContainedStateEntries(s.root, DIR, PREFIX);
    assert.equal(!listed.ok && listed.kind, "unsafe", JSON.stringify(listed));
  } finally {
    s.cleanup();
  }
});

test("a directory swapped for a symlink after the walk is unsafe, not an outside listing", { skip: noLinks }, () => {
  const s = sandbox();
  try {
    const dir = join(s.root, DIR);
    const aside = `${PREFIX}0123456789ab`;
    write(join(dir, aside), "live holder");
    const moved = join(s.root, "_local", "resolver-moved");
    const listed = listContainedStateEntries(s.root, DIR, PREFIX, {
      afterVerify: () => {
        renameSync(dir, moved);
        symlinkSync(s.outside, dir);
      },
    });
    assert.equal(listed.ok, false, `the swapped-in empty directory was listed: ${JSON.stringify(listed)}`);
    assert.equal(!listed.ok && listed.kind, "unsafe");
    assert.equal(existsSync(join(moved, aside)), true, "the moved-away aside record is untouched");
  } finally {
    s.cleanup();
  }
});

test("a directory swapped for a symlink to a populated outside directory is unsafe", { skip: noLinks }, () => {
  const s = sandbox();
  try {
    const dir = join(s.root, DIR);
    mkdirSync(dir, { recursive: true });
    write(join(s.outside, `${PREFIX}ffffffffffff`));
    const listed = listContainedStateEntries(s.root, DIR, PREFIX, {
      afterVerify: () => {
        rmSync(dir, { recursive: true });
        symlinkSync(s.outside, dir);
      },
    });
    assert.equal(!listed.ok && listed.kind, "unsafe", JSON.stringify(listed));
  } finally {
    s.cleanup();
  }
});

test("a directory swapped for a different real directory after the walk is unsafe", () => {
  const s = sandbox();
  try {
    const dir = join(s.root, DIR);
    const aside = `${PREFIX}0123456789ab`;
    write(join(dir, aside), "live holder");
    const moved = join(s.root, "_local", "resolver-moved");
    const listed = listContainedStateEntries(s.root, DIR, PREFIX, {
      afterVerify: () => {
        renameSync(dir, moved);
        mkdirSync(dir);
      },
    });
    assert.equal(!listed.ok && listed.kind, "unsafe", JSON.stringify(listed));
    assert.equal(existsSync(join(moved, aside)), true);
  } finally {
    s.cleanup();
  }
});

test("an ancestor swapped for a symlink after the walk is unsafe", { skip: noLinks }, () => {
  const s = sandbox();
  try {
    const local = join(s.root, "_local");
    write(join(local, "resolver", `${PREFIX}0123456789ab`));
    const listed = listContainedStateEntries(s.root, DIR, PREFIX, {
      afterVerify: () => {
        renameSync(local, join(s.outside, "_local"));
        symlinkSync(join(s.outside, "_local"), local);
      },
    });
    assert.equal(!listed.ok && listed.kind, "unsafe", JSON.stringify(listed));
  } finally {
    s.cleanup();
  }
});

test("a directory removed after the walk is unsafe", () => {
  const s = sandbox();
  try {
    const dir = join(s.root, DIR);
    mkdirSync(dir, { recursive: true });
    const listed = listContainedStateEntries(s.root, DIR, PREFIX, {
      afterVerify: () => rmSync(dir, { recursive: true }),
    });
    assert.equal(!listed.ok && listed.kind, "unsafe", JSON.stringify(listed));
  } finally {
    s.cleanup();
  }
});

test("a directory that cannot be listed fails with the listing's reason", { skip: noPermissionTests }, () => {
  const s = sandbox();
  const dir = join(s.root, DIR);
  try {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o300);
    const listed = listContainedStateEntries(s.root, DIR, PREFIX);
    assert.equal(!listed.ok && listed.kind, "failed", JSON.stringify(listed));
    assert.match(!listed.ok ? listed.detail : "", /could not be listed/);
  } finally {
    chmodSync(dir, 0o700);
    s.cleanup();
  }
});
