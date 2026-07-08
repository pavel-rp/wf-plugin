# Fixture registry — the real sr capability attaches a `finding` at the `pre-commit` seam (passes)

Registers the **real, shipped** sr capability (`plugins/wf-caps/capabilities/sr`) — not a
synthetic stand-in — so this fixture proves the actual manifest WF-160 ships validates clean:
its one `pre-commit | finding | inline:` row uses a recognized phase + the reused `finding`
kind, and its `article: precommit-self-review = required` clause has no contradicting
counterpart. Complements `pass-precommit-review.md` (which proves the seam abstractly).

## Capabilities

| Capability | Path                                    |
|------------|-----------------------------------------|
| sr         | plugins/wf-caps/capabilities/sr         |
