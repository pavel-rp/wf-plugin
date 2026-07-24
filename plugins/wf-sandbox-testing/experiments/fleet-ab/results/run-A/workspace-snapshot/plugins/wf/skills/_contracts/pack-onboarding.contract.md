# Provider-pack onboarding — contract & rationale

**Reference half** of the provider-pack onboarding split. Rationale, history, and
authoring detail live here; the bounded runtime-ops half is `pack-onboarding.ops.md`
(read at boot by each `/wf-<pack>:init`). This file is **never read at boot**.

**Model:** claude-opus-4-8

---

## Why a shared onboarding spine

Every provider pack (`wf-git`, `wf-ado`, `wf-linear`, and any future single-capability
pack) onboards the same way: it registers its one capability into the downstream
`## Capabilities` registry and records its install root into `## Plugin Roots`, so core's
read-side resolution can find it on a plugin-only install. Before WF-229 each pack's
`/wf-<pack>:init` **inlined** that whole spine — ~130–150 near-identical lines per file
across three packs — differing only by the pack/capability noun. The copies had already
drifted: each pack's intro and registry-write carve-out named a **different predecessor
sibling** (`wf-ado` → `wf-git`, `wf-linear` → `wf-ado`), a lineage chain that goes stale
on any pack rename.

WF-229 extracted the invariant spine here. This doc is the **write-side** counterpart to
core's **read-side** `capability-registry.ops.md`: onboarding writes the two registry
tables that resolution later reads. It is deliberately generic — it names no concrete
pack, so it belongs in core, not in any one capability. Core `_contracts/` is also the
only viable shared home: the packs install independently, so a doc living in one pack
would vanish when another pack is installed without it; core is always present, and the
inits already read `capability-registry.ops.md` from this same folder (Phase 5).

## Parameters

The spine is parameterized by exactly three values so a single procedure serves every
pack: `<pack>` (the plugin name), `<capability>` (its single registered capability), and
a **Phase 4 detail** slot the invoking SKILL.md fills. Keeping the parameter surface this
small is deliberate — the more a pack must supply, the more surface there is to re-drift.
A pack that ever needs a second capability or a genuinely different spine authors its own
procedure rather than widening these parameters.

## Phase 0: Preconditions

Onboarding **augments** a registry `/wf:init` already created; it never bootstraps
`_local/`. Hence the hard precondition on a resolved registry file, and the shared
`registryPath` resolution (config key, default `_local/config.md`) so a project that
relocated its registry is honored identically by every pack.

## Phase 1: Discover self

The install root (`$CLAUDE_PLUGIN_ROOT`) is the one datum core cannot obtain on its own:
that variable resolves only the **executing** plugin's root, so only a skill shipping
*inside* the pack can capture it. This is the entire reason each pack needs its own init
skill rather than a single core command. Forward-slash normalization keeps the recorded
root portable across the Windows/POSIX boundary.

## Phase 2: Record the plugin root

The `## Plugin Roots` table is per-machine, gitignored, and written by the pack's own
init — core only reads it. Upsert-by-plugin-name (never duplicate, never touch another
plugin's row) keeps re-runs and multi-pack repos stable. Full semantics of the mapping
live in `capability-registry.contract.md` §"The `## Plugin Roots` mapping".

## Phase 3: Register the capability

Append-only, skip-if-present by capability name preserves registry order (= injection
order, general → specific) and makes re-runs idempotent. A pack never polices whether a
*conflicting* capability is already registered (e.g. a second tracker provider) — that is
a registry-**validation** concern caught structurally when both are active, not something
onboarding special-cases.

## Phase 4: Pack-specific step

The one phase that varies. `wf-git` has no config to gather, so its Phase 4 is the
generic no-op profile seed (its manifest declares no `profile-template:`). `wf-ado` and
`wf-linear` each run a config **interview + carry-forward** for their tracker-product
values, writing their own config section (`## Azure DevOps` / `## Linear`) under
`_local/`. The spine owns only the *slot*; the invoking init owns the content, including
the matching final-output rows, so tracker-specific prose never leaks into the shared
doc.

## Phase 5: Self-check

The single in-repo runtime assertion: resolve the just-registered capability exactly the
way core will, self-heal included, so a recorded root that went stale after an upgrade
counts as PASS (it recovers via the install-manifest fallback), and only a genuinely
unrecoverable pack is FAIL. The resolution algorithm itself is not restated here — it is
owned by `capability-registry.ops.md` §"Recorded-root-first resolution with
install-manifest self-heal", so the two never drift.

## Edge cases

The generic stop/idempotency conditions shared by every pack: `/wf:init` not run,
`$CLAUDE_PLUGIN_ROOT` unset, capability already registered, plugin-root row already
present, registry relocated to a committed file, and self-check FAIL. A pack with a
bespoke Phase 4 adds its own interview-specific edge cases in its SKILL.md; the shared
list carries only the spine's.

## Final output

Every init ends with a fenced `WF-<PACK>-INIT — <status>` block as the last thing output
to chat — downstream readers grep the `NAME — status` shape, so it is preserved per pack.
The spine fixes the shared rows (`Registry:`, `Pack root:`, `Registered:`, `Self-check:`,
`Next:`); each pack inserts its Phase-4-specific rows between `Registered:` and
`Self-check:`. The exact block per pack lives in that pack's SKILL.md, not here.
