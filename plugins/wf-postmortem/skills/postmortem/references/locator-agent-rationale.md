# wf-postmortem:locator agent — authoring rationale

**Authoring-only — never read at runtime.** `agents/locator.md` states the operative dispatch
procedure inline (Prerequisites, Input, Procedure, Output, Rules — the behavior-bearing steps the
locator agent follows); this document is the paired rationale for *why* three of that file's
constraints hold, kept out of the runtime-read file per this repo's ops/reference split (`≤150
behavior-bearing lines` in the runtime half; rationale here). A future edit to the operative
procedure changes `agents/locator.md` first; update this file to match, not the other way around.

## Why this file is not under `agents/`

Every `.md` file directly inside a plugin's `agents/` folder is auto-discovered as a subagent. A
rationale file placed there registered as a bogus, frontmatter-less `locator-rationale` agent. It
lives beside the seam's own rationale (`locator-rationale.md`) under the postmortem skill's
`references/` instead, which is never auto-discovered and never read at runtime.

## Why no `tools:` field

A subagent with no `tools` field inherits the full tool catalog — every built-in plus every connected
MCP server. Declaring `tools:` is a *restricting allowlist that overrides* that inheritance, and would
silently starve this agent of the resolver MCP call it needs to obtain the seam's own procedure
(`locator.md`) — without that call, the agent has no record layout to follow at all, and the failure
mode would be a confusing tool-not-found error deep inside the Prerequisites step rather than an
obvious one at dispatch time. Omitting `tools:` is also the config-agnostic choice, since MCP server
names vary per repo. This agent is read-only by discipline (the Rules section), not by tool
allowlist — an allowlist would be the wrong mechanism for a constraint that is really about what the
agent chooses to do with the tools it has, not about which tools exist.

## Why no pinned model

`agents/locator.md` deliberately pins no model, for the same reason `session-reader.md` and
`excerpt-fetcher.md` pin none: the model comes from the caller's dispatch (via `resolve_routing`'s
model selector), not from this file. Pinning a model here would bypass the routing precedence chain
every other sibling-skill edge in the pack goes through, and would silently stop responding to a
project's own `_local/config.md` routing overrides or a host's model enforcement.

## Why no host-specific names in this file

This agent names no host-specific record path, filename convention, or field name of its own. Every
fact of that kind — where sessions live, what a record file is named, how a subagent record attaches,
which structural fields exist — lives in exactly one place, `locator.md` (the skill reference this
agent obtains at the start of every dispatch and follows exactly). A future host release that changes
any of those facts changes only that one file; this agent's own body never needs to change, because it
contains no copy of those facts to fall out of sync. Duplicating even one host-specific fact here would
recreate the exact drift risk `locator.md`'s own header describes as the reason it exists as "one
replaceable seam."
