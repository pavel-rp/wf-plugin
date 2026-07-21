# `reference-existence` fragment — author-caps capability (verify-phase finding)

**Version:** 1.0.0 (WF-355 — the author-caps `verify`-phase reference-existence findings)
**Wired by:** `plugins/wf-author-caps/capabilities/author-caps/manifest.md`

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.
(`verify | finding | inline: fragments/reference-existence.md`)
**Contributes:** a `finding` at the `verify` phase, per
`plugins/wf/skills/_contracts/capability-registry.ops.md`
**Model:** claude-opus-4-8

---

The existence half of the pack's verify contribution: a schema-conformant artifact can still name a
sibling command, agent, or file that **does not exist**. Schema validation cannot see that — the
row is well-formed, the target is simply absent. This fragment catches it. The schema half is a
separate row, `fragments/structural-validation.md`.

## The defect class

An authored body names a sibling command, agent, or path; that target is later renamed or removed;
the naming body is never updated. What ships is a body instructing a reader to invoke something
that no longer resolves. The failure is worst on **fallback and recovery paths**, because those
run precisely when a task is already in trouble — the dead name is reached exactly when the reader
most needs it to work, and it has no second fallback behind it.

Two properties make this hard to catch by eye and easy to reintroduce:

- **It is invisible on the happy path.** A body's main flow can be exercised for months while a
  recovery branch naming a removed target is never taken.
- **The check keys on the shape, not the intent.** A body that merely *describes* another body
  naming a removed target is flagged the same as one *instructing* the reader to run it. Prose in
  the invocation form is treated as an invocation regardless of surrounding narration. This is
  deliberate: narrowing it to directive-only would need an intent classifier, and a dead name that
  a reader can act on is a live defect whether or not the author meant it as illustration.

**Authoring consequence — this fragment binds itself.** When documenting this defect class, do not
write a removed command in its invocation form, not even as an example. Describe the defect
**structurally** (as above), and when a concrete illustration is genuinely needed, name a command
that actually exists — `/wf:run` and `/wf:verify-spec` are safe because they resolve. A document
explaining dead references that itself contains one is the defect, not a description of it.

## Run the validator

Call the bundled resolver runtime's typed, read-only `validate_references` tool. It takes `{ path?, workspaceRoot }`
— a **file or a folder**; zero-arg walks every plugin's `skills/` and `agents/` trees. Scope it to
the work under review. Its rule id is `REF-1`. It returns the frozen `ValidationVerdict`:

```
{ tool, status: "pass" | "fail" | "error", target,
  findings: [ { rule, severity, file, line, message } ],
  ruleSources: [...], summary }
```

`findings` is empty **if and only if** `status` is `pass`. There is no warning tier.

## Map the verdict into a finding

- **`pass`** — contribute no finding.
- **`fail`** — emit **one finding per `findings[]` entry**, carrying `rule` (`REF-1`), `file`,
  `line`, and `message` verbatim. Severity is `fail`: a reference that does not resolve is a real
  defect, not a style nit. The recommendation is either to update the name to the target that
  replaced it, or to delete the branch that named it — never to suppress the check.
- **`error`** — emit **one finding** at severity `fail` recording that the check could not run,
  naming the tool and the verdict's `summary` as evidence. An `error` is not a pass and not a
  silent skip; an unrun existence check leaves dead references unverified.

If the resolver runtime is unavailable so the tool cannot be called, emit a single `fail` finding
stating that, and stop — do not substitute a hand-rolled search for the validator.

## The finding shape you return

Return **only** this fenced block, no prose around it:

```
AUTHOR-CAPS-REFERENCES — <clean | findings>

capability: author-caps
findings:
- severity: fail
  location: <file:line from the verdict entry>
  issue: <REF-1 and the entry's message, one line — name the unresolved target>
  evidence: <tool: validate_references · status: <fail|error> · <the entry or summary text>>
  recommendation: <the replacement target, or removal of the branch naming it>
```

Every finding carries `capability: author-caps` — the provenance tag the verify phase renders it
under.

## No-op

When the work under review touches no authored body, or the verdict is `pass`, return the block
with an empty findings list and `AUTHOR-CAPS-REFERENCES — clean`. An empty result is the conformant
signal; never halt the verdict and never surface a capability term on that path. With the
capability unregistered this fragment is never reached at all.
