# `structural-validation` fragment — author-caps capability (verify-phase finding)

**Version:** 1.0.0 (WF-355 — the author-caps `verify`-phase structural validator findings)
**Wired by:** `plugins/wf-author-caps/capabilities/author-caps/manifest.md`
(`verify | finding | inline: fragments/structural-validation.md`)
**Contributes:** a `finding` at the `verify` phase, per
`plugins/wf/skills/_contracts/capability-registry.ops.md`
**Model:** claude-opus-4-8

---

The structural half of the pack's verify contribution: it checks that authored artifacts **conform
to their schemas**. The reference-existence half — whether the things they name actually exist —
is a separate row, `fragments/reference-existence.md`. Follow this file exactly.

## Applies when

The work under review adds or changes a capability `manifest.md`, a registry row, or a
`SKILL.md`/`interface.md` pair in this marketplace. If the change touches none of those, emit the
clean block (see No-op) and stop — do no validation work.

## Run the validators

Call the bundled resolver runtime's typed, read-only validation tools. Each returns the frozen
`ValidationVerdict`:

```
{ tool, status: "pass" | "fail" | "error", target,
  findings: [ { rule, severity, file, line, message } ],
  ruleSources: [...], summary }
```

Run all three, scoped to the work under review:

- **`validate_manifest`** — `{path}` for a single capability manifest; zero-arg validates every
  active capability's manifest. Schema-v2 conformance: `kind`, the fragments table's four columns,
  phase and contribution-kind drawn from the fixed sets, `dispatch` well-formed, `scope` present
  exactly for partitioned kinds.
- **`validate_registry`** — no arguments; validates the resolved registry path. Unique capability
  names, every declared path present and carrying a manifest, no overlapping ownership scopes,
  `requires:` satisfied, `conflicts:` not both active, no contradictory article clauses.
- **`validate_skill_interface`** — `{plugin?, skill?}`; zero-arg validates every skill in every
  plugin. The interface declaration against the body: declared slots have markers, declared
  settings keys are real, the terminal block is declared.

`findings` is empty **if and only if** `status` is `pass`. There is deliberately **no warning
tier** — do not invent one.

## Map each verdict into a finding

Apply per tool, and never collapse the three statuses into two:

- **`pass`** — contribute no finding for that tool.
- **`fail`** — emit **one finding per `findings[]` entry**, carrying the entry's `rule`, `file`,
  `line`, and `message` verbatim. Map the entry's `severity` onto the verify phase's severity:
  a schema violation that would make the artifact fail to resolve is `fail`; an advisory entry is
  `warn`. Never summarize several entries into one finding — the count is the signal.
- **`error`** — emit **one finding** at severity `fail` recording that the check could not run,
  naming the tool and the verdict's `summary` as evidence. An `error` verdict is **not** a pass and
  **not** a silent skip: an unrun validator is an unverified artifact, and reporting nothing would
  present it as conformant.

If the resolver runtime is unavailable so that no tool can be called at all, emit a single `fail`
finding stating that, and stop — do not hand-parse a manifest or registry as a fallback.

## The finding shape you return

Return **only** this fenced block, no prose around it:

```
AUTHOR-CAPS-STRUCTURAL — <clean | findings>

capability: author-caps
findings:
- severity: <fail | warn>
  location: <file:line from the verdict entry, or the tool's target when it has no line>
  issue: <the entry's rule and message, one line>
  evidence: <tool: <name> · status: <pass|fail|error> · <the entry or summary text>>
  recommendation: <the concrete change that resolves it, or "escalate" if not bounded>
```

Every finding carries `capability: author-caps` — the provenance tag the verify phase renders it
under. Registry order is cosmetic for provenance-tagged findings.

## No-op

When the work under review touches no authored artifact, or all three verdicts are `pass`, return
the block with an empty findings list and `AUTHOR-CAPS-STRUCTURAL — clean`. An empty result is the
conformant signal; never halt the verdict and never surface a capability term on that path. With
the capability unregistered this fragment is never reached at all.
