# Clean fixture — resolver-managed declared committed lifecycle artifacts

Every line below must PASS. These are the shapes the narrow exception admits, plus the ordinary
prose that must never be mistaken for a write claim.

## The declared committed lifecycle artifact classes

The resolver owns the committed lifecycle home and writes `.wf/install-state.json` as the portable
install-state ledger.

The resolver composes the committed project override at `.wf/slots/ship.review.md` and writes it
only as the lifecycle owner.

A maintainer commits `.wf/slots/spec.publish.md` so the whole team receives the same customization
on checkout.

The resolver records a phase-completion receipt into `.wf/run-evidence/<run>.json` when a
receipt-bearing phase actually completes, and seals it so a hand-authored file does not match.

A reader consults `.wf/run-evidence/` through the resolver to tell work that ran from work that
was merely claimed.

The resolver-managed home `.wf/` is a read home for every ordinary skill.

## A complete payload declaration row — the declaration mechanism itself

| Source | Destination | Production | Refresh | Removal |
|--------|-------------|------------|---------|---------|
| assets/default.json | .wf/default.json | copy | replace-if-unmodified | delete-if-unmodified |
| assets/rules.md | .wf/rules.md | copy | retain | retain |

## Ordinary prose that must not trip the classifier

This skill reads the committed override at `.wf/slots/plan.publish.md` through the resolver's
`resolve_content` surface, never by a raw filesystem read.

Resolution declares `.wf/install-state.json` as the portable evidence destination and performs no
persistence of its own.

The tier at `.wf/slots/` sits between the pack contribution and the personal `_local/` override.

This skill writes only inside `_local/`, and creates its scratch files under `_local/scratch/`.
