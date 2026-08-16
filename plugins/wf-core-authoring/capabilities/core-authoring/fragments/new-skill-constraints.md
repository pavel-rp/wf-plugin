# `new-skill-constraints` fragment — core-authoring capability (`new-skill.constraints` slot fill)

**Version:** 1.0.0 (WF-368 — the core-only constraints on a skill scaffolded in this repository)
**Wired by:** `plugins/wf-core-authoring/capabilities/core-authoring/manifest.md`

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.
(`— | slot | inline: fragments/new-skill-constraints.md | new-skill.constraints append`)
**Contributes:** a `slot` fill at the `new-skill.constraints` composition point, merge policy
`append`, per `plugins/wf/skills/_contracts/capability-registry.ops.md`
**Model:** claude-opus-5[1m]

---

The `core-authoring` capability's fill for `new-skill.constraints`. The policy is **`append`**: the
skill's inline default has already applied, and these constraints are **added** to the emission
template — they replace nothing in it. Reaching this text means the capability is registered, which
is true only in the repository that authors the `wf` core plugin; everywhere else the point stays
unfilled and the plain scaffolder's output stands.

Everything below constrains the **emitted file**. It authorizes no write outside the target skill
folder: the scaffolder's own Forbidden list still holds, and the one constraint that concerns a
version manifest (C5) is **reported**, never applied.

## C1 — Core purity, when the target plugin is `wf`

Applies only when the resolved emission target sits under `plugins/wf/`. A core skill ships zero
stack, domain, or project knowledge — `CLAUDE.md` §1 states the rule and its litmus test, and §9
makes the post-edit grep part of "done". Do not restate either here; apply them.

After the file is written, grep it for concrete stack, domain, and project nouns. **Zero hits is the
pass condition.** A hit is a Stage 4 finding: move the named knowledge out of the core body — the
emitted skill states the generic behaviour and reads the specific value from configuration or from a
registered capability. Report the grep as run, with its hit count.

For a target outside `plugins/wf/`, C1 does not apply — say so rather than reporting it clean.

## C2 — Body budget and one-level references

`CLAUDE.md` §5 owns the budget: the body stays under about 500 lines, overflow splits into
`references/<topic>.md` exactly one level deep with no chains, and a doc read at runtime carries
only behavior-bearing content with its rationale in a paired reference. Apply it as written.

Address every reference file through the `resolve_content` references form the emission template
already names — a plain relative markdown link to one is classified as a raw-read instruction and
fails the repository's content-read guard. Report the emitted body's line count.

No repository gate measures the ops budget on a scaffolded skill: `check-ops-docs.sh` reaches only
the frozen contract layer and the provider fragment folders, so a skill folder is outside its target
set. C2 is therefore satisfied by inspection and the line count you report — never presented as a
gate verdict that was not obtained.

## C3 — A terminal block whose last line is `Next:`

`CLAUDE.md` §6 fixes the shape: a fenced `NAME — status` block is the very last thing the skill
emits, and for a user-invocable skill its last line is `Next: <command>` or `Next: none — terminus`.
The emission template already requires the block; this constraint pins the **last line**.

No repository gate asserts it. Verify by inspection and report the emitted file's literal last two
lines as the evidence, so the claim is checkable rather than asserted.

## C4 — Attribution present, promotion absent

`CLAUDE.md` §6 requires the `**Model:** <current model id>` attribution line — write `unknown`
rather than guessing. `CLAUDE.md` §8 forbids the opposite: no attribution trailer, no
"generated with" footer, no emoji, and no promotional tagline anywhere in the emitted file. Both
already sit in the scaffolder's own rules; C4 makes them a checked condition of the emission rather
than a hope, so confirm each by reading the emitted bytes.

## C5 — Name the version pair; do not write it

`CLAUDE.md` §8 makes every change to this repository a release. The scaffolder writes one skill
folder and nothing else, so it **must not** edit a version manifest. Instead, name the pending bump
in the final output block, so the maintainer applies it:

- `plugins/<plugin>/.claude-plugin/plugin.json` `version`, and the matching
  `.claude-plugin/marketplace.json` `plugins[]` entry — the pair is kept equal.
- The marketplace top-level `version`, which bumps on any change.
- Tier **MINOR**: a new skill is a new capability on the invocation surface.

Report it as an outstanding maintainer action, never as work done.

## The checks this fill adds to the Stage 3 set

Two verdict sources the loop's own check set does not already reach. Run both over the emitted file
on every pass, and map `pass` / `fail` / `error` exactly as the loop's table says — `error` is not a
pass.

- **`validate_references`** — `{ path: <emitted file>, workspaceRoot }`. The typed tool resolves the
  invocation instructions and `${CLAUDE_PLUGIN_ROOT}` path tokens an emitted body names, under rules
  `REF-1` and `REF-2`. It is the deterministic form of "a body may not instruct invocation of
  something that does not exist"; a bare prose mention never turns red.
- **`out4-skill-read-guard.sh`** — the sibling-invocation guard, run with no argument:

  ```bash
  bash <wf-plugin-root>/skills/_contracts/out4-skill-read-guard.sh
  ```

  Resolve `<wf-plugin-root>` through `resolve_plugin_root({ plugin: "wf", workspaceRoot })`. It
  scans skill bodies and agent files across every pack, so the emitted file is in its target set.
  Exit 0 is clean, exit 1 is a read-instruction finding, exit 2 means the guard could not run —
  treat exit 2 as `error`, never as a pass.

A finding from either goes to Stage 4 with the rest. Neither replaces `validate_skill_interface` or
`glossary-lint.sh`; both are additions to that set.

## Reporting

Fold one line per constraint into the scaffolder's own report — `C1`–`C5` each with its verdict and
the evidence named above, plus the two added checks with their verdicts. A constraint that did not
apply is reported as **not applicable**, never as clean.

Rationale, the section-by-section mapping, and why each rule is cited rather than restated:
[`../references/new-skill-constraints.md`](../references/new-skill-constraints.md) — read by
authors, never at slot-fire.
