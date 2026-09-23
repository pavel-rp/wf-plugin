# The `/wf:verify-spec` chat summary shape

The verbatim shape of the concise summary printed inline after `04_verify.md` is written, so a
reader can triage pass/fail without opening the file. Read only on that write path, so it stays
out of the boot body — the same placement rule the `04_verify.md` report template beside it
follows.

## Contents

- [Chat Summary Shape](#chat-summary-shape) — the ordered item list and the conditional suggestion

## Chat Summary Shape

Print, in this order:

- **Verdict line:** `**Verdict:** <PASS | FAIL | PARTIAL>` — `<n>/<total>` requirements. Echo
  the report's own `**Verdict:**` value verbatim; it is computed from the blocking set, so a
  non-blocking finding listed below never contradicts a `PASS` here.
- **Report pointer:** one line — `Report: <task-folder>/04_verify.md`.
- **FAILs and PARTIALs:** one bullet each — short requirement name, one-line reason,
  `file:line` citation. Skip the section entirely if none.
- **Capability findings:** one line — either `none` (**no blocking-set member under
  `## Capability findings`** — whether because no capability contributed at `verify`, or
  because everything they contributed was routed to a non-gating section) or
  `<N> findings across <M> capabilities: <comma-separated
  shortlist, each tagged with its source>`. `<N>` counts the blocking-set members rendered under
  the report's `## Capability findings` and `<M>` the capabilities they came from; append
  `· <P> pre-existing · <W> accepted warnings` when either non-blocking section carries entries,
  so they are visible without changing the verdict. A run with contributors but nothing blocking
  therefore reads `none · <P> pre-existing · <W> accepted warnings`, never `0 findings across 1`.
- **Adversarial findings:** one line — either `none` or `<N>: <comma-separated shortlist>`,
  then `· <W> withdrawn` when any were, and `· coverage incomplete (<provenance>)` when a
  contributor failed. Non-gating: this line never changes the verdict line above it.
- **Critic:** one line — `not dispatched (no candidates)` when the candidate set was empty;
  `<A> confirmed · <R> refuted · <U> unverifiable (→ warn)` on a well-formed dispatch (omit
  zero-count categories); or `dispatch <failed | malformed> — <N> held blocking, unconfirmed`
  on a fail-closed batch. Non-gating on its own — a refutation already removed that candidate
  from the blocking set the verdict line above reads, and this line never re-derives it.
- **Top next actions:** 1–3 bullets — the most important items from the report's
  "Recommended next actions".
- **`/wf:verify-fix` suggestion (conditional):** one line —
  `Suggested: /wf:verify-fix {task-id} — <N> mechanical fixes look auto-applicable.` Include
  **only** when a FAIL or PARTIAL finding carries a concrete literal `Expected` value at a
  cited `file:line`. Omit on PASS, when every finding is UNVERIFIABLE, structural, or
  vaguely `Expected` — and whenever in doubt.

Target ~15 lines total. If the summary grows past that, trim detail, not items — the user can
open the file for the rest.
