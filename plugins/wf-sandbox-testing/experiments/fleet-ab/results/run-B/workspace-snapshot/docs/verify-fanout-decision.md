# WF-380 verify fan-out decision

**Recorded:** 2026-07-22
**Decision:** Do not collapse for gating purposes

## Result

The required comparison is inconclusive because no accepted comparable fixture is available. No collapse or payload change is implemented. The existing five-lens verify fan-out remains unchanged.

This is the ticket's permitted time-boxed close. An inconclusive result is treated as **do not collapse for gating purposes**: WF-381 is skipped unless a later accepted measurement produces an affirmative collapse decision. This is not evidence that the current shape is cheaper or catches more findings.

## Evidence admissibility

| Required pass | Shape | Admissible result | Dollar result | Findings result |
|---|---|---|---|---|
| A | Whole-file, five agents | unavailable | not measurable | not measurable |
| B | Hunk-scoped, five agents | unavailable | not measurable | not measurable |
| C | Whole-file, one collapsed agent | unavailable | not measurable | not measurable |

**Comparable passes completed:** 0/3.

No missing value is interpreted as zero. Therefore neither the A-to-B payload delta nor the A-to-C collapse delta can be calculated, and whether auditors need a diff remains open.

## Why no substitute pass was run

The only committed WF-373 candidate is explicitly rejected as the charter fixture. `plugins/wf-sandbox-testing/accounting/README.md` states that it is incomparable, lacks audit fan-out, and is only a mechanics regression reference. It also says later optimization items must not use its absolute cost as their before-point.

WF-374's corrected dispatch baseline merged in [PR 203](https://github.com/pavel-rp/wf-plugin/pull/203). That change safely gates excluded lenses before dispatch and removes per-lens contract/profile refetches. Its recorded evidence limit says no real post-change verify transcript was captured and makes no generalized token or dollar-saving claim. It corrects the code baseline but does not supply Pass A.

Using either source as A, B, or C would invent comparability and violate the dedup-corrected, no-lost-findings constraint.

## Time box

**Working sessions consumed:** 2/2 bounded evidence-review sessions.

1. Session 1 checked the committed WF-373 fixture and established that its own status rejects it for downstream optimization measurements.
2. Session 2 rechecked the latest delivery base after WF-374/PR 203 and confirmed that the corrected implementation still has no accepted real post-change verify transcript.

The three-pass cap was not consumed because the prerequisite accepted fixture was absent. Commissioning unbounded replacement-fixture work here would exceed this decision item's scope and time box.

## Tradeoff and decision

Collapsing may reduce cost, but it also removes independent perspectives and parallelism. Hunk-scoping may reduce payload, but its effect on real findings and auditors' need for a diff is unmeasured. The governing constraint is that a cheaper run catching fewer real defects is a regression.

With no admissible cost or findings comparison, neither lever can be recommended. In particular, collapse requires affirmative evidence; absence of evidence cannot satisfy that gate. The decision is therefore:

- preserve all five current verify lenses;
- do not collapse for gating purposes;
- do not implement hunk-scoped payload delivery in this change;
- formally skip WF-381 under this close;
- allow WF-382 to proceed without waiting for collapse implementation;
- reopen only when one accepted fixture can produce all three comparable, dedup-corrected passes.

## Remaining open evidence

A future reconsideration needs exactly the original three passes over one accepted fixture: A whole-file/five-agent, B hunk-scoped/five-agent, and C whole-file/collapsed-agent. It must report both dollars and deduplicated real findings for each lever. A fourth combined pass is not required.
