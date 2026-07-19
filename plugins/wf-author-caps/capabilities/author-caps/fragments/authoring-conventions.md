# `authoring-conventions` fragment — author-caps capability (implement-phase guidance)

**Version:** 1.0.0 (WF-355 — the author-caps `implement`-phase convention guidance)
**Wired by:** `plugins/wf-author-caps/capabilities/author-caps/manifest.md`
(`implement | guidance | inline: fragments/authoring-conventions.md`)
**Model:** claude-opus-4-8

---

Guidance a core skill follows when it fires the `implement` phase with `author-caps` active and the
change under implementation **writes a skill, capability, agent, or pack file for this
marketplace**. `guidance` aggregates additively in registry order — these conventions join the
phase's generic authoring guidance, they do not replace it.

## Applies when

The change writes or edits a `SKILL.md`, an `agents/<name>.md`, a capability `manifest.md`, a phase
fragment, or a plugin manifest. A change to product source with no such file in scope is outside
this fragment — contribute nothing rather than bending product code toward authoring shapes.

## Conventions (follow while writing)

- **Slug and folder agree.** A skill's `name` frontmatter matches its folder name exactly:
  lowercase letters, digits, hyphens. Use the **bare** name — the namespace comes from the plugin,
  so prefixing the plugin name into the slug doubles it in the invoked command.
- **Description carries what and when.** Third person, trigger stated early. It is the only content
  preloaded for auto-selection, so it must stand alone. Avoid angle brackets — they break
  frontmatter parsing.
- **Tools are declared narrowly on skills, omitted on agents.** A skill lists the built-in tools its
  safety rules actually need. An **agent** that must reach MCP omits the field entirely: it is a
  restricting allowlist that overrides the inherited toolset, so declaring a built-in-only list
  silently starves the agent of every MCP server.
- **Edit in place.** Renaming or moving a skill folder breaks invocation and every existing task
  artifact that references it. Change the body, keep the path.
- **Never hardcode a project constant.** A project value belongs in the downstream config file and
  is referenced as a placeholder. Adding a value means adding a config key, not a literal.
- **A `## Edge Cases` section, spelled exactly that way.** Every skill carries its stop conditions
  under that heading.
- **The terminal block is the last thing emitted.** A fenced `NAME — status` block, ending in a
  `Next:` line that names the command(s) to run or states that the skill is a terminus. Preserve an
  existing block's exact shape when editing — downstream skills grep it.
- **Invoke a sibling skill; never read its body.** To run another skill, invoke it through the
  Skill tool. A filesystem read of a sibling's `SKILL.md` as a load step is a defect: the
  version-pinned path sits outside the workspace on a marketplace install, so the read trips the
  workspace-boundary prompt and breaks on the next version bump. A failed invocation hard-stops
  into the error block — falling back to reading the body resurrects the defect.
- **Respect the ops/reference budget.** Any doc opened at boot or mid-run is a bounded ops doc:
  behavior-bearing steps, guards, and outcome mappings only, one level deep, with a table of
  contents past 100 lines. Rationale and history go in a paired reference file that is never read
  at runtime. Test each clause by removing it — if the artifact still acts correctly without it,
  it belongs in the reference file.

## Capability files specifically

Every fragments-table row's `dispatch` path must name a file that actually exists, forward-slash
and relative to the capability folder. Author the fragment file in the same change as the row —
a row pointing at nothing is the defect class the verify-phase checks exist to catch.

Give every fragment an explicit **no-op** clause stating what it contributes when its trigger
condition is absent. A fragment without one leaves the phase guessing whether silence was intended.

## Version bump

Every merged change to a pack bumps that pack's manifest version and its marketplace entry in
lockstep, plus the marketplace top-level version. A behavior-visible addition is a MINOR bump;
wording, links, and internal refinements are PATCH.

## No-op

When the `implement` work writes no marketplace authoring artifact, this fragment contributes
**nothing**; the phase proceeds on its generic guidance alone. With the capability unregistered the
fragment is never reached at all.
