# FIXTURE — legitimate prose references for out4-skill-read-guard.sh --selftest.
# Model: claude-opus-4-8
#
# Every non-comment line below is a REAL-SHAPE prose reference to a skill path
# (or the post-WF-290 invocation prose) that the guard MUST NOT flag. The
# --selftest asserts the classifier produces zero hits here — this is what makes
# it an instruction classifier rather than a raw `skills/.*SKILL.md` grep. The
# critical case is the "loads … classify/SKILL.md" line: a genuine skill PATH
# paired with an excluded verb ("loads"), proving the verb-set exclusion holds.

Every tracker operation is obtained the same way (mirroring `plugins/wf/skills/spec/SKILL.md`'s own tracker-surface resolution).
Reached by the same call shape `plugins/wf/skills/spec/SKILL.md` Phase 0 step 1 uses, and `plugins/wf/skills/triage/SKILL.md`.
The harness loads the skill's `SKILL.md` by invocation (not a filesystem read) and runs its body in your existing context.
If the Skill-tool invocation fails, hard-stop — never fall back to Reading the skill body.
Runs its body with no dependency on a version-pinned `${CLAUDE_PLUGIN_ROOT}` path.
So a spawn no longer eagerly loads the full caller-facing `skills/classify/SKILL.md` as part of its boot.
| `skills/test-node/SKILL.md` | the `/wf-node-ts:test-node` Node unit-test harness for pure TS helpers |
Template shape (`plugins/wf/skills/init/SKILL.md` Phase 2 "Default content") the pack self-registers against.
