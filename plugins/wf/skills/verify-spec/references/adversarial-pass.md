# The lean adversarial pass — rationale

Background and worked examples for the `## The lean adversarial pass` section of
`verify-spec/SKILL.md`. **Never read on the audit path** — the behaviour-bearing clauses
all live in the skill body. This file exists so that body can stay short.

## Contents

- [Why core needs an adversarial default at all](#why-core-needs-an-adversarial-default-at-all)
- [Why the list is closed at two classes](#why-the-list-is-closed-at-two-classes)
- [Why two-sided citation is the anti-fabrication rule](#why-two-sided-citation-is-the-anti-fabrication-rule)
- [Why it reports rather than gates](#why-it-reports-rather-than-gates)
- [Why it is inline rather than dispatched](#why-it-is-inline-rather-than-dispatched)
- [Worked examples](#worked-examples)

## Why core needs an adversarial default at all

Spec conformance and correctness are different questions. The audit resolves every
requirement to a verdict against `00_reqs.md`; a change can satisfy all of them and still
be wrong, because the requirements are themselves an interpretation. A project with an
empty registry previously got no answer to the second question from the harness at all —
the only adversarial review available arrived through a registered capability, and a
project with none simply went without.

The measured case behind this: a diagnostic of one large unattended run found that
hand-rolled adversarial reviewers caught a substantial defect population before merge —
among them a pre-flight predicate bounding a quantity at `1–5` where the codebase defined
that same quantity as `1–10`, forwarded as a live abort condition — while an external
review tool approved the same changes with zero comments and the harness's own `verify`
phase reported none of them. Both of the classes this pass checks are drawn directly from
that population, which is why the list is exactly two long and not a general checklist.

Core Article 8 governs the shape of the fix: every core extension point ships a lean
default and runs inert when no capability is registered, and core never names or
hard-depends on a specific capability. That is why the alternative the diagnostic itself
floated — making an adversarial capability a precondition for the run — was rejected. A
precondition is the opposite of a lean default.

## Why the list is closed at two classes

An open-ended instruction ("look for defects") has two failure modes and this pass must
avoid both. It is unbounded in cost, because there is no point at which the reader can
say the work is finished; and it is unbounded in output, because a model asked to find
problems will find them whether or not they exist. A closed list terminates: there are two
questions, each is answered against the changed lines, and the pass is over.

Widening the list is therefore not a cheap improvement — it is a change to the pass's cost
profile and its false-positive rate at the same time, and it should be argued for on
evidence rather than added because a third class seems plausible.

## Why two-sided citation is the anti-fabrication rule

Both defect classes are *relational*: a bound is only out of range relative to a range
defined somewhere else, and an assumption is only unstated relative to a precondition
something else requires. Neither can be established from the changed line alone. So
requiring a citation on both sides is not extra rigour bolted on — it is the minimum
evidence the claim needs to be true.

It also happens to be exactly the rule that suppresses the failure mode a lean default
shipped to every project would otherwise have. A speculation cannot produce a second
citation. A restatement of the change as a risk cannot produce a second citation. A
finding whose evidence is that something is *missing* cannot produce a second citation,
because an absence has no line number. The rule and the suppression list are the same
rule stated twice — once as what is required, once as what that requirement excludes.

The pass is measured on a clean change as much as on a defective one. A default that
fabricates findings on every clean change fails just as badly as one that misses real
ones, and it fails more often, because most changes are clean.

## Why it reports rather than gates

The adversarial pass changes what `verify` does for every project with an empty registry
— including projects using the interactive single-task chain, which is a change surface
here even though it is not a beneficiary. Holding that chain harmless means adding no new
interactive stop and no gate that was not there before. A finding that could flip a
requirement verdict from PASS to FAIL would be exactly such a gate.

So findings are recorded, in their own report section and on their own chat-summary line,
and the verdict machinery is untouched. A reader decides what to do about them. This also
keeps the `VERIFY —` final-output block byte-identical, which matters because downstream
skills grep it.

## Why it is inline rather than dispatched

The cost concern is real and was raised as a high risk: a default that runs on every task
must not make `verify` materially more expensive. Dispatching the pass to a subagent would
have added a routing decision, a Task spawn, and a fresh context to fill with the diff —
per run, on every task, including the overwhelming majority that carry neither defect
class.

Running inline over the diff the audit has already gathered adds none of those. It also
keeps the pass structurally outside the invariants
`plugins/wf/skills/_contracts/verify-dispatch-cost-guard.sh` protects: every one of them
constrains the *contributor dispatch* path — the contributor gate preceding any routing or
Task call, caller-side profile resolution, and the inlined finding contract. A pass that
performs no dispatch cannot weaken a guarantee about how dispatch is performed.

For the same reason the pass is strictly additive to whatever contributors are registered
at the `verify` phase, rather than a reshaping of them. Their dispatch shape is settled
elsewhere, by a recorded decision not to change it without affirmative evidence; this
change supplies no such evidence and makes no such attempt. Core states no count and no
list here — how many contributors exist, and what they are, is the registry's business.

## Worked examples

**Reportable — out-of-range bound.** A change adds a pre-flight check rejecting inputs
whose difficulty falls outside `1..5`. The type that carries that field declares the range
as `1..10`, and callers construct values above `5`. Both sides cite: the new predicate
line, and the declaration line establishing `1..10`. The finding is real, and it is the
kind that aborts healthy work at runtime.

**Reportable — unstated assumption behind a derivation.** A change derives a total by
summing a collection and dividing by its length. Correctness depends on the collection
being non-empty; the change neither states that nor guards it, and the calling path can
supply an empty collection. Both sides cite: the derivation line, and the caller or
declaration that permits the empty case.

**Not reportable — absence as evidence.** The same derivation, but no caller admitting an
empty collection can be found. The concern is now "there might be a caller somewhere that
does". There is no second citation, so there is no finding. This is the case the rule
exists to reject: it reads as diligence and it is indistinguishable from invention.

**Not reportable — restated risk.** A change lowers a retry limit. Nothing in the codebase
defines a different limit for that quantity, and no derivation depends on the old value.
"Lowering the retry limit could cause failures under load" restates the change as a
hazard without contradicting anything. No second citation, no finding.
