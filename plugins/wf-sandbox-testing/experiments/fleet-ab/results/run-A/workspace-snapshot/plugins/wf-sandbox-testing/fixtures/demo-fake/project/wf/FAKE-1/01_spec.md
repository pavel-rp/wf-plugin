# FAKE-1 — Demo fixture task

**Type:** feat
**Complexity:** S
**Model:** claude-opus-4-8

---

## Objective

A minimal spec so a demonstrated skill invocation (e.g. `/wf:branch FAKE-1`, `/wf:standup`)
has a real task folder to resolve against. This fixture exists only to drive a hermetic skill
run against the scripted `fake` providers; it ships no product source.

## Success Criteria

- [ ] The demonstrated skill invocation resolves the `fake` delivery/tracker provider and
      returns its scripted responses, appending each op to `_local/fake/op-log.jsonl`.
