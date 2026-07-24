---
name: init
description: Onboards the wf-linear pack into a wf-initialized repo in one command — self-registers the pack's linear capability into the wf capability registry by calling core's inspect_pack/register_pack resolver tools with the stable plugin id wf-linear (no manual install-root discovery or hand-edited registry rows), and interviews for (or carries forward) the Linear team/project. Use once (after /wf:init) to activate Linear tracker binding; re-run any time — register_pack is idempotent and self-checks the wiring.
allowed-tools: [Read, Write, Edit, Bash]
---

# /wf-linear:init — Onboard the wf-linear pack (self-register via the resolver + Linear interview)

Collapse wf-linear onboarding into **one command**, driven entirely by the core-bundled
**wf-resolver** MCP service. Installing the plugin makes `/wf-linear:init` discoverable
(native composition) but registers **no** phase fragment — that still requires a row in
the downstream `## Capabilities` registry. This skill performs that registration by
calling core's typed `inspect_pack` / `register_pack` tools with wf-linear's **stable
plugin id, `wf-linear`** — it never probes `${CLAUDE_PLUGIN_ROOT}`, never derives an
install root itself, and never hand-edits `_local/config.md` or a `## Plugin Roots`
mapping. Core resolves the install path (via `claude plugin list --json`), validates the
pack's manifest, computes a fingerprint, and owns the registry write end-to-end —
including the self-check that the capability now resolves. This skill additionally runs
the one phase a delivery pack never needs: an interview for the Linear team (and,
optionally, project), writing this pack's **own** `## Linear` section of
`_local/config.md` — the resolver has no typed op for that project-specific interview, so
this remains a direct `_local/` write, unlike the registry/plugin-root writes above.

**This is fragment/registry-side onboarding only.** It cannot register a `/command` — a
discoverable skill must live in a plugin's `skills/` dir (native discovery).
`/wf-linear:init` is already discoverable from installing the plugin; this skill wires
the **fragment + registry** (plus the Linear interview).

---

## Command Syntax

```
/wf-linear:init
```

Takes no arguments — it always registers the single `linear` capability this pack
ships, under the stable plugin id `wf-linear`.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Call the bundled `wf-resolver` MCP tools: `resolve_config`, `resolve_registry`,
  `inspect_pack`, `register_pack`, and — on a failure — `resolve_gate`.
- Read `_local/config.md` (or the `registryPath` `resolve_config` returns), and run
  read-only `git rev-parse --git-dir`, only to confirm `/wf:init` has already run.
- Write/edit the `## Linear` section of `_local/config.md` (the interview phase) —
  stays inside `_local/`.

**Forbidden:**

- Probe `${CLAUDE_PLUGIN_ROOT}` or otherwise derive an install root by hand —
  `inspect_pack`/`register_pack` resolve it.
- Hand-edit a `## Capabilities` row or a `## Plugin Roots` row — `register_pack` owns
  that write exclusively.
- Modify any source file except the `## Linear` interview write named above.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragment/registry).
- Invent a default value for **Linear Team** — always ask.
- Run builds, tests, installs, or any destructive git operation.

---

## Onboarding procedure

Before any resolver MCP call, run `pwd -P` once and use the returned absolute current Agent/session workspace directory as `<workspace-root>`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit the primary checkout's or a parent Agent's root. Every resolver call below must explicitly include `workspaceRoot: "<workspace-root>"`; omission is a hard schema error, with no default or fallback.

1. **Precondition.** Confirm a git repository (`git rev-parse --git-dir`); if this fails,
   stop: "`/wf-linear:init` must run inside a git repository — run `/wf:init` first."
   Call `resolve_config({ workspaceRoot: "<workspace-root>" })` for the resolved registry location and Read it to confirm the
   file exists. If it does not, stop: "Run `/wf:init` first — `/wf-linear:init`
   registers into the registry that `/wf:init` creates."
2. **Check prior state (reporting only).** Call `resolve_registry({ workspaceRoot: "<workspace-root>" })`; note whether
   `linear` already appears with `validity: "ok"`, and whether an `ado` row is also
   present (both would claim the `tracker` provider surface — a partitioned-ownership
   overlap flagged in the Final Output, not something this skill blocks on). This never
   skips a later step — it only affects reported wording.
3. **Inspect the pack.** Call `inspect_pack({ workspaceRoot: "<workspace-root>", pluginId: "wf-linear" })`. Read-only;
   returns `{ installed, enabled, installPath, capabilities[], fingerprint, valid, issues[] }`.
   - `valid: false` (not installed, disabled, no readable
     `capabilities/linear/manifest.md`, or `claude plugin list --json` itself
     unavailable) → go to **Failure path**; do not run the interview or call
     `register_pack`.
4. **Linear interview (bespoke — the one phase a delivery pack never needed).**
   Reconcile `_local/config.md`'s `## Linear` section with real values, carrying forward
   anything a prior run (or a hand-edit) already set, asking only for what is still a
   placeholder:
   - **Locate the section.** Read `_local/config.md` for a `## Linear` heading.
     - **Present** — read its two rows (**Linear Team**, **Linear Project**) as they
       stand.
     - **Absent** — append it fresh:

       ```markdown
       ## Linear

       | Key | Value |
       |-----|-------|
       | **Linear Team** | `<LINEAR_TEAM: the Linear team key or name new issues are created under>` |
       | **Linear Project** | `none` |
       ```

       Treat every row as freshly created for the per-field logic below (the **Linear
       Project** row's own default, the literal `none`, still counts as "the section was
       absent" for that field's rule — step below).
   - **Placeholder-shape detection.** A row counts as **already set** — skip the
     prompt, leave it byte-identical, record `carried forward` — when its value is
     **not** wrapped in the `<...>` bracket shape the template uses for an unset value.
     A row still wrapped in that shape counts as **unset**.
   - **Linear Team** — set → leave byte-identical, `carried forward`. Unset → prompt
     (`AskUserQuestion`) for the real team key/name. **No invented default.** Record
     `set to <value>`.
   - **Linear Project** — any non-bracketed value (including the template's own literal
     `none`) counts as set → `carried forward` on essentially every run. Unset →
     default it to the literal `none` **without prompting**, record `set to none`.
     **Never prompt for Linear Project.**
   - **Write only the rows that changed.** A `carried forward` row is never rewritten; a
     `set to <value>` row replaces exactly that cell.
5. **Register.** Call
   `register_pack({ workspaceRoot: "<workspace-root>", pluginId: "wf-linear", expectedFingerprint: <fingerprint from step 3> })`.
   It writes the `## Plugin Roots` row and the `linear` `## Capabilities` row in a single
   write (a plain file write, not a filesystem-atomic temp+rename swap; register `linear`
   **even if** an `ado` row already exists — this skill never blocks its own registration
   on that overlap), refreshes the resolver snapshot, and self-checks that `linear` now
   resolves — returning `{ status, reason, capabilities[], root, selfCheck, preview[] }`.
   - `status: "rejected"` → **Failure path**.
   - `status: "registered"`, `selfCheck: "ok"` → success.
   - `status: "registered"`, `selfCheck: "failed"` → report `partial`: the registry write
     landed but `linear` still does not resolve; direct the user to re-run
     `/wf-linear:init` after checking the pack install.

### Failure path (SUB-4 / WF-272 diagnostics)

Call `resolve_gate({ workspaceRoot: "<workspace-root>", surface: "delivery-write" })` (registering a pack is a registry
write). Report its `categories`, `diagnostics`, and `recovery` alongside the pack-specific
`issues[]` (from `inspect_pack`) or `reason` (from a rejected `register_pack`) — never a
bare error. Finish with `partial`. (A failure here never rolls back the `## Linear`
interview write from step 4 — that is a separate, already-`_local/` write; only the
registry side is at risk.)

---

## Edge Cases

- **Not a git repo / `/wf:init` not run:** stop per the precondition step above.
- **`wf-linear` not installed or disabled** (`inspect_pack.installed`/`enabled` false):
  failure path; direct the user to install/enable the plugin, then re-run.
- **`claude plugin list --json` unavailable:** `inspect_pack` reports `installed: false`
  with an issue naming the CLI call as the cause (a broken/unavailable `claude` CLI, not a
  missing plugin) — failure path; direct the user to check their `claude` CLI, then
  re-run.
- **No readable pack manifest** (`inspect_pack.capabilities` empty): failure path; the
  install looks corrupted — reinstall the plugin.
- **Stale fingerprint** (`register_pack` rejects on a fingerprint mismatch): re-run
  `inspect_pack({ workspaceRoot: "<workspace-root>", pluginId: "wf-linear" })` to get the
  current fingerprint, then retry `register_pack({ workspaceRoot: "<workspace-root>",
  pluginId: "wf-linear", expectedFingerprint: <current fingerprint> })`.
- **`ado` already registered as the active tracker provider:** register `linear` anyway
  (this skill never blocks its own registration), but flag in the Final Output that both
  `ado` and `linear` are now present and that registry validation will fail on the
  overlapping `tracker` surface until one is removed — direct the user to pick one.
- **Linear Team already set (re-run on an already-onboarded repo):** the interview
  produces **zero prompts** and leaves both rows byte-identical — report both as
  `carried forward`.
- **`linear` already registered:** `register_pack` upserts idempotently — re-running is
  always safe; report `already-registered` per step 2's pre-check.
- **Self-check FAIL:** report `partial`; never claim success.

---

## Final Output

```
WF-LINEAR-INIT — <onboarded | already-registered | partial>

Registry:   <registryPath from resolve_config>
Pack root:  <installPath from inspect_pack — may be null on the failure path>
Registered: linear — <registered | already registered>
Linear:
- Linear Team    — <carried forward | set to <value>>
- Linear Project — <carried forward | set to none | set to <value>>
Self-check: <PASS — linear resolves | FAIL — <issues / reason>>
<Warning: `ado` is also registered — both claim the tracker surface; registry validation will fail until one is removed. — only when applicable>

Next: run any wf skill that needs the tracker (e.g. /wf:spec, /wf:lite, /wf:triage) — core resolves the linear capability for the tracker surface directly (no phase-firing gate). Re-run /wf-linear:init any time — register_pack is idempotent.
```

**The final-output block must always be the very last thing output to chat.**
