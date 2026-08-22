# Detecting the Verify Command

Read on the scaffold write path only — `/wf:init`'s config write reaches this
file through `resolve_content({ workspaceRoot, class: "references-template",
skill: "init", ref: "verify-command-detection.md" })`, never a raw `Read` of a
plugin-cache path, and never at boot.

The goal is a **single shell command that exits 0 when the whole project
typechecks**. Do not write a hardcoded default — every repo's command differs,
and a wrong default misses the very errors the skills exist to catch.

Detect in this order. Stop at the first rule that produces a concrete command.

1. **Find project roots.** `Glob` for `**/package.json` plus any framework
   project manifests (skip `node_modules/`, `.git/`, `dist/`, `bin/`, `obj/`).
   Record each containing directory, relative to the workspace root.

2. **Prefer explicit scripts.** For each manifest, parse `scripts` and look for a
   verification-ish script in this priority: `typecheck` > `check` > `verify` >
   `build:check` > `lint:types`. First hit wins:

   ```
   npm --prefix <dir> run <script>
   ```

3. **Framework AoT build.** If no script matched but the candidate dir's manifest
   lists a framework CLI under `devDependencies` whose canonical verification is
   an ahead-of-time / production build, use that CLI's AoT/production build — it
   is the canonical way to catch template, metadata, and type errors together.
   Derive the exact command from the detected CLI at runtime (its AoT/production
   build invocation, e.g. a development-configuration build with output hashing
   disabled):

   ```
   npm --prefix <dir> exec -- <framework CLI's AoT/production build command>
   ```

4. **Generic `build` script.** If a `build` script exists, use it as a last
   resort — it almost always typechecks as a side effect:

   ```
   npm --prefix <dir> run build
   ```

5. **Plain typed source.** If the dir carries a typed-language project file but
   nothing better matched, use that toolchain's no-emit check:

   ```
   npm --prefix <dir> exec -- tsc --noEmit
   ```

   Warn in the chat summary that this catches only plain type errors; it is fine
   for a pure library, not for a framework project.

6. **Multi-candidate tie-break.** If several dirs produce different commands,
   pick in this order: any framework-build one > any with an explicit
   typecheck/check script > the shallowest dir. List the others in the chat
   summary so the user can override.

7. **Nothing found.** Write:

   ```
   TODO: replace with the command that typechecks this project (must exit non-zero on any type or template error)
   ```

   and flag it loudly in the chat summary. Never silently substitute a generic
   guess — a skill running a bogus verify is worse than one that stops with a
   clear error.

Record the chosen rule, and the rejected candidates if any, in the chat summary
so the user can see the reasoning without opening the config file.

When rule 7 fired, the Final Output block replaces its `Verify Command` line
with this not-detected form, which this file declares:

```
Verify Command: ⚠ NOT DETECTED — edit _local/config.md before running any other wf:* skill
  Scanned: <list of package.json / framework-manifest paths found, or "none">
```
