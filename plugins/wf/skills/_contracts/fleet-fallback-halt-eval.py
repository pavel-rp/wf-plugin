#!/usr/bin/env python3
"""Reachability evaluator for the fleet dispatch brief's project-pipeline fallback chain.

The chain is a decision procedure: the pipeline driver returns one outcome token
and the chain decides which routed steps run and what per-item outcome is
recorded. This evaluator resolves each routed step by its *routing tokens*
(``role`` / ``unitIds``) rather than by line number, derives the set of outcome
tokens each step admits, applies the halt clause, and asserts the recorded
per-item outcome for every token.

It never asserts wording: the only string facts it uses are the routing tokens
that identify a step and the outcome tokens the chain itself is written in
terms of. A chain that opens a pull request or finalizes an item under a
non-success token fails, however that chain is phrased.

Model: claude-opus-5[1m]
"""

from __future__ import annotations

import os
import re
import sys

# The outcome tokens the pipeline driver can return. `complete` is the only
# success outcome; `gated` is a handoff that loops; the other two are failures.
SUCCESS = "complete"
HANDOFF = "gated"
FAILURES = ("blocked", "error")
ALL_TOKENS = (HANDOFF, SUCCESS) + FAILURES

# Steps are resolved by their routing tokens, never by position.
STEP_KEYS = {
    "gated": 'unitIds: ["ship:phase"]',
    "pr": 'unitIds: ["ship:pr"]',
    "finalize": 'unitIds: ["ship:finalize"]',
}

BLOCK_START = "use the project-pipeline fallback"
BLOCK_END = "Each fallback edge gets its own decision"

TOKEN_RE = re.compile(r"RUN\s+[—-]\s+(gated|complete|blocked|error)")
STEP_RE = re.compile(r"^>?\s*\d+\.\s")

# A halt that no one can read is not a halt. The orchestrator must map a
# reported halt onto the item's row state, and the row must have a stated
# rendering for a state and its reason.
HALT_ROW_STATE = "blocked"
ROW_MAPPING_RE = re.compile(r"halt[^.\n]*`" + HALT_ROW_STATE + r"`", re.I)
ROW_RENDERING_RE = re.compile(r"`<state>:\s*<[^`>]*reason>`")


class Failure(Exception):
    pass


def extract_block(text: str) -> str:
    start = text.find(BLOCK_START)
    end = text.find(BLOCK_END)
    if start == -1:
        raise Failure("the project-pipeline fallback chain's opening sentence is absent")
    if end == -1 or end <= start:
        raise Failure("the project-pipeline fallback chain's closing sentence is absent")
    return text[start:end]


def split_units(block: str):
    """Split the chain into numbered steps and free clauses, in order."""
    steps, clauses = [], []
    for raw in block.splitlines():
        line = raw.strip()
        if not line or line == ">":
            continue
        body = line[1:].strip() if line.startswith(">") else line
        if STEP_RE.match(line) or STEP_RE.match(body):
            steps.append(body)
        else:
            clauses.append(body)
    return steps, clauses


def resolve_step(steps, key: str) -> str:
    needle = STEP_KEYS[key]
    found = [s for s in steps if needle in s]
    if not found:
        raise Failure(f"no routed step carries {needle}")
    if len(found) > 1:
        raise Failure(f"{len(found)} routed steps carry {needle}; expected exactly one")
    return found[0]


def step_admits(step: str, token: str) -> bool:
    """A step admits a token when it names that token, or names none at all.

    Naming no outcome token is the pre-fix defect: an unconditional step runs
    whatever the driver returned.
    """
    named = set(TOKEN_RE.findall(step))
    if not named:
        return True
    return token in named


def step_admits_failure(step: str):
    """The failure outcomes a step admits *by name*.

    A step that names a failure outcome admits it directly, and a halt clause
    elsewhere in the chain cannot take that back: the two contradict, and a
    contradiction is resolved by the step the shipper is reading, not by the
    clause the evaluator would prefer.
    """
    return sorted(set(TOKEN_RE.findall(step)) & set(FAILURES))


def find_halt_clause(clauses):
    """The clause that closes the chain for every failure outcome.

    It must name every failure token and must state that neither trailing edge
    runs. Both facts are structural: without the first, a token falls through;
    without the second, the clause records a state but authorises nothing.
    """
    for clause in clauses:
        named = set(TOKEN_RE.findall(clause))
        if not all(token in named for token in FAILURES):
            continue
        low = clause.lower()
        if "no pull request" in low and "no finalize" in low:
            return clause
    return None


def check_row_recording(text: str):
    """A halted item's outcome must be readable from its own scoreboard row.

    Two independent facts: the orchestrator maps a reported halt onto the row's
    ``blocked`` state, and the row has a stated rendering for a state and its
    reason. Either one alone leaves the halt inferable only from an absent row,
    which is the failure mode the row convention exists to close.
    """
    problems = []
    if not ROW_MAPPING_RE.search(text):
        problems.append(
            "no clause maps a reported halt onto the item's "
            f"`{HALT_ROW_STATE}` row state"
        )
    if not ROW_RENDERING_RE.search(text):
        problems.append(
            "the row states no `<state>: <reason>` rendering, so a halt's "
            "reason has no defined place in the row"
        )
    return problems


def recorded_outcome(token: str, admits_pr: bool, admits_finalize: bool) -> str:
    if admits_pr or admits_finalize:
        return "advanced"
    if token == HANDOFF:
        return "handoff — loops back to the pipeline driver"
    return "halted"


def evaluate(path: str):
    with open(path, encoding="utf-8") as handle:
        text = handle.read()

    block = extract_block(text)
    steps, clauses = split_units(block)
    row_recording = check_row_recording(text)

    gated = resolve_step(steps, "gated")
    pr = resolve_step(steps, "pr")
    finalize = resolve_step(steps, "finalize")

    problems = []

    # The handoff step is the chain's one pre-existing conditional step and must
    # keep naming the handoff token it branches on.
    if HANDOFF not in set(TOKEN_RE.findall(gated)):
        problems.append(
            "the routed ship:phase step no longer branches on the RUN — gated handoff"
        )

    halt = find_halt_clause(clauses)
    if halt is None:
        problems.append(
            "no halt clause covers every failure outcome ("
            + ", ".join(f"RUN — {t}" for t in FAILURES)
            + ") while stating that no pull request is opened and no finalize runs"
        )

    for key, step in (("pr", pr), ("finalize", finalize)):
        if not TOKEN_RE.findall(step):
            problems.append(
                f"the routed ship:{key} step is unconditional — it names no "
                "pipeline-driver outcome, so every outcome reaches it"
            )
        for token in step_admits_failure(step):
            problems.append(
                f"the routed ship:{key} step admits RUN — {token} by name; a "
                "halt clause elsewhere cannot mask a step that routes a "
                "failure outcome into this edge"
            )

    # The recorded per-item outcome, token by token. A halt clause closes a
    # failure outcome only where no step admits that outcome by name —
    # otherwise the clause would launder the contradiction flagged above.
    outcomes = {}
    for token in ALL_TOKENS:
        halted_by_clause = halt is not None and token in FAILURES
        pr_closed = halted_by_clause and token not in step_admits_failure(pr)
        finalize_closed = halted_by_clause and token not in step_admits_failure(finalize)
        admits_pr = step_admits(pr, token) and not pr_closed
        admits_finalize = step_admits(finalize, token) and not finalize_closed
        outcomes[token] = (
            recorded_outcome(token, admits_pr, admits_finalize),
            admits_pr,
            admits_finalize,
        )

    for token in FAILURES:
        outcome, admits_pr, admits_finalize = outcomes[token]
        if outcome != "halted":
            reached = []
            if admits_pr:
                reached.append("ship:pr")
            if admits_finalize:
                reached.append("ship:finalize")
            problems.append(
                f"RUN — {token} does not halt the item: it reaches "
                + " and ".join(reached)
            )

    outcome, admits_pr, admits_finalize = outcomes[SUCCESS]
    if not (admits_pr and admits_finalize):
        problems.append(
            "RUN — complete no longer reaches both the ship:pr and the "
            "ship:finalize step; the success path was narrowed too far"
        )

    if not step_admits(gated, HANDOFF):
        problems.append("RUN — gated no longer reaches the ship:phase step")

    problems.extend(row_recording)

    if problems:
        raise Failure("; ".join(problems))

    return outcomes


SOUND_CHAIN = """> Only if that Skill is genuinely unavailable or its checks loop cannot run, use the project-pipeline fallback. Route and execute each edge independently in this exact order:
>
> 1. Route with `role: "phase-runner"` and `unitIds: ["ship:run-initial"]`, then invoke the initial run.
> 2. On every resume, route with `role: "phase-runner"` and `unitIds: ["ship:run-resume"]`, then invoke it again.
> 3. On each `RUN — gated` handoff, route with `role: "phase-runner"` and `unitIds: ["ship:phase"]`, then invoke the exact named phase.
> 4. **Only on a `RUN — complete` outcome** (see the halt branch below): Route with `role: "pr"` and `unitIds: ["ship:pr"]`, then open the pull request.
> 5. **Only on a `RUN — complete` outcome** (see the halt branch below): Route with `role: "finalize"` and `unitIds: ["ship:finalize"]`, then finalize the item.
>
> **Halt branch.** If the pipeline driver returns `RUN — blocked` or `RUN — error`, steps 4 and 5 do **not** run: stop where you stand and report the item with its blocking reason. **No pull request is opened and no finalize runs.**
>
> Each fallback edge gets its own decision and compact record immediately before execution.
"""

PRE_FIX_CHAIN = """> Only if that Skill is genuinely unavailable or its checks loop cannot run, use the project-pipeline fallback. Route and execute each edge independently in this exact order:
>
> 1. Route with `role: "phase-runner"` and `unitIds: ["ship:run-initial"]`, then invoke the initial run.
> 2. On every resume, route with `role: "phase-runner"` and `unitIds: ["ship:run-resume"]`, then invoke it again.
> 3. On each `RUN — gated` handoff, route with `role: "phase-runner"` and `unitIds: ["ship:phase"]`, then invoke the exact named phase.
> 4. Route with `role: "pr"` and `unitIds: ["ship:pr"]`, then open the pull request.
> 5. Route with `role: "finalize"` and `unitIds: ["ship:finalize"]`, then finalize the item.
>
> Each fallback edge gets its own decision and compact record immediately before execution.
"""

HALT_CLAUSE_INCOMPLETE_CHAIN = """> Only if that Skill is genuinely unavailable or its checks loop cannot run, use the project-pipeline fallback. Route and execute each edge independently in this exact order:
>
> 1. Route with `role: "phase-runner"` and `unitIds: ["ship:run-initial"]`, then invoke the initial run.
> 2. On every resume, route with `role: "phase-runner"` and `unitIds: ["ship:run-resume"]`, then invoke it again.
> 3. On each `RUN — gated` handoff, route with `role: "phase-runner"` and `unitIds: ["ship:phase"]`, then invoke the exact named phase.
> 4. **Only on a `RUN — complete` outcome:** Route with `role: "pr"` and `unitIds: ["ship:pr"]`, then open the pull request.
> 5. **Only on a `RUN — complete` outcome:** Route with `role: "finalize"` and `unitIds: ["ship:finalize"]`, then finalize the item.
>
> **Halt branch.** If the pipeline driver returns `RUN — blocked`, stop where you stand. **No pull request is opened and no finalize runs.**
>
> Each fallback edge gets its own decision and compact record immediately before execution.
"""

# The row-recording half: the two facts that make a halt readable from the
# item's own row rather than inferable from its absence.
ROW_RECORDING = """
A shipper reporting a halt instead of a merge is recorded `blocked`, with its stated reason written into that row.

Any state other than plain `merged` also carries its reason in `notes`, rendered `<state>: <one-line reason>`.
"""

GATED_STEP_DAMAGED_CHAIN = SOUND_CHAIN.replace(
    "> 3. On each `RUN — gated` handoff, route with",
    "> 3. Route with",
)

# A well-formed halt clause sitting above a pull-request step that routes a
# failure outcome into itself anyway. The clause must not launder the step.
HALT_CLAUSE_MASKS_STEP_CHAIN = SOUND_CHAIN.replace(
    "> 4. **Only on a `RUN — complete` outcome** (see the halt branch below): Route with",
    "> 4. On a `RUN — complete` outcome, and also after a `RUN — blocked` outcome, Route with",
)

FIXTURES = {
    "sound": SOUND_CHAIN + ROW_RECORDING,
    "pre-fix": PRE_FIX_CHAIN + ROW_RECORDING,
    "halt-clause-incomplete": HALT_CLAUSE_INCOMPLETE_CHAIN + ROW_RECORDING,
    "gated-step-damaged": GATED_STEP_DAMAGED_CHAIN + ROW_RECORDING,
    "halt-clause-masks-step": HALT_CLAUSE_MASKS_STEP_CHAIN + ROW_RECORDING,
    # Sound chain, but the halt is never written anywhere a reader can see it.
    "row-recording-absent": SOUND_CHAIN,
}


def emit_fixtures(destination: str) -> int:
    os.makedirs(destination, exist_ok=True)
    for name, body in FIXTURES.items():
        with open(os.path.join(destination, f"{name}.md"), "w", encoding="utf-8") as handle:
            handle.write(body)
    return 0


def main(argv) -> int:
    if len(argv) == 3 and argv[1] == "--emit-fixtures":
        return emit_fixtures(argv[2])
    if len(argv) != 2:
        print("usage: fleet-fallback-halt-eval.py <dispatch-brief.md>", file=sys.stderr)
        print("       fleet-fallback-halt-eval.py --emit-fixtures <dir>", file=sys.stderr)
        return 2
    try:
        outcomes = evaluate(argv[1])
    except Failure as failure:
        print(f"fleet-fallback-halt-guard: {failure}", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"fleet-fallback-halt-guard: {error}", file=sys.stderr)
        return 2
    for token in ALL_TOKENS:
        outcome, admits_pr, admits_finalize = outcomes[token]
        print(
            f"fleet-fallback-halt-guard: RUN — {token} → {outcome} "
            f"(ship:pr {'reached' if admits_pr else 'not reached'}, "
            f"ship:finalize {'reached' if admits_finalize else 'not reached'})"
        )
    print(
        "fleet-fallback-halt-guard: PASS — every non-success outcome halts the "
        "item before the pull-request and finalize edges."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
