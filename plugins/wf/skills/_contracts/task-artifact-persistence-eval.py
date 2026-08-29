#!/usr/bin/env python3
"""task-artifact-persistence-eval.py — evaluate the fleet task-artifact persistence contract.

It derives the contract's capabilities from the dispatch brief by clause matching,
then SIMULATES a multi-item run over them and asserts the recorded outcome for
each item. The simulation is what makes this more than a presence lint — but the
derivation is still keyed on the clauses' wording, so a reworded clause has to be
re-synced here deliberately. That coupling is intended, not incidental: these
clauses ARE the contract, and a silent rewording of one is exactly the drift the
guard exists to make visible.

It simulates a multi-item run in which one item's worktree is readable,
one item's worktree is lost before persistence runs, one item's persistence write
fails part-way, and one item never had a worktree at all — asserting the recorded
outcome for each, plus the run-level outcome, plus the structural properties those
outcomes depend on:

  * the destination lies in the orchestrator's own workspace, so it survives a
    prune of every worktree — and every path the step actually WRITES must be
    EXACTLY one of the declared tokens (exact membership, not a shared prefix),
    so a declaration cannot drift from the write path it is supposed to
    describe, and the step cannot drift to an undeclared sibling path that
    merely starts with the same {task-root} prefix;
  * the index row is reached ONLY by invoking the index writer, ONCE PER
    ARTIFACT (that writer edits exactly one row per call), and `index.md` is
    never in the persistence write set;
  * the shipper's own prohibition is asserted INSIDE the dispatch template and as
    a whole sentence, so persistence can never be bought by relaxing it.

Usage:
    task-artifact-persistence-eval.py <file>              evaluate one document
    task-artifact-persistence-eval.py --emit-fixtures DIR synthesize self-test corpus

Exit 0 = the contract is sound; exit 1 = at least one assertion failed;
exit 2 = the evaluator could not run.

Model: claude-opus-5[1m]
"""

import os
import re
import sys

PREFIX = "task-artifact-persistence"
STEP_MARKER = "task-artifact persistence."
DEST_HEADING = "### the task-artifact persistence destination"
TEMPLATE_HEADING = "## the shipper dispatch template"
SHIPPER_RULE = (
    "if your isolated worktree is unavailable or lost, stop and report it "
    "-- do not fall back to the shared checkout."
)
# Trailing '.' is excluded alongside the existing punctuation so a path token
# ending a sentence (e.g. "...`{task-root}/_archive/<id>/`.") is not swallowed
# together with the full stop -- exact-membership comparison needs the same
# token whether the mention falls mid-sentence or at a sentence's end.
PATH_TOKEN = re.compile(r"\{task-root\}/[^\s,;).]*")


def emit(message):
    print("%s: %s" % (PREFIX, message))


def normalize(text):
    """Strip markdown emphasis/code fencing so a clause matches on its words."""
    text = text.replace("**", "").replace("`", "").replace("*", "")
    text = text.replace("—", "--").replace("’", "'")
    return re.sub(r"[ \t]+", " ", text).lower()


def section(lines, start_pred, stop_pred):
    out, active = [], False
    for line in lines:
        if not active:
            if start_pred(line):
                active = True
                out.append(line)
            continue
        if stop_pred(line):
            break
        out.append(line)
    return "\n".join(out)


def derive(raw):
    """Derive the contract's capability set from the document."""
    lines = raw.splitlines()
    whole = normalize("\n".join(lines))

    dest = normalize(
        section(
            lines,
            lambda l: normalize(l).startswith(DEST_HEADING),
            lambda l: l.startswith("## ") or l.startswith("### 1."),
        )
    )
    step = normalize(
        section(
            lines,
            lambda l: STEP_MARKER in normalize(l),
            lambda l: l.startswith("### ") or l.startswith("## "),
        )
    )
    template = normalize(
        section(
            lines,
            lambda l: normalize(l).startswith(TEMPLATE_HEADING),
            lambda l: l.startswith("## ") and not normalize(l).startswith(TEMPLATE_HEADING),
        )
    )

    c = {}

    # --- the destination ----------------------------------------------------
    c["destination_declared"] = bool(dest) and "one folder per in-scope item" in dest
    c["destination_outside_worktree"] = "in this orchestrator's own workspace" in dest
    # A committed-lifecycle path would move authority to the resolver, which must
    # not become a writer of task artifacts. Neither half may name one.
    c["destination_no_committed_class"] = ".wf/" not in dest and ".wf/" not in step
    c["destination_sibling_not_share"] = "sibling" in dest and "never a share of it" in dest
    c["destination_no_new_exception"] = "adds no skill to the write-scope exception list" in dest
    c["destination_same_article"] = "same write-scope article" in dest

    # The declaration must describe the path the step ACTUALLY writes. Without
    # this the two halves drift independently and the guard sees neither.
    # Membership is EXACT, not a shared-prefix check: every token the step writes
    # must itself be one of the declared tokens, not merely start with a declared
    # token's parent segment (a prefix match would let the step drift to an
    # undeclared sibling path -- e.g. `{task-root}/_scratch/<id>/` -- that still
    # starts with `{task-root}` and would pass a startswith() test undetected).
    declared = set(PATH_TOKEN.findall(dest))
    written = set(PATH_TOKEN.findall(step))
    c["write_paths_match_declaration"] = (
        bool(declared) and bool(written) and written.issubset(declared)
    )

    # --- the shipper's own rule, asserted where it actually lives -----------
    c["shipper_rule_intact"] = bool(template) and SHIPPER_RULE in template

    # --- the persistence step -----------------------------------------------
    c["step_present"] = bool(step)
    c["runs_per_terminal_item"] = "terminal outcome" in step
    c["gated_on_terminal_activation"] = "whose activation is itself terminal" in step
    c["persist_at_most_once"] = "persist an item at most once" in step
    c["locate_from_row"] = "own row records" in step and "never a raw worktree query" in step
    c["locate_read_only"] = "read-only" in step
    c["locate_archive_candidate"] = "_archive" in step
    c["locate_nondestructive"] = "nothing is moved, emptied, removed, or pruned" in step
    c["locate_refuses_escaping_source"] = "refuse rather than read" in step
    c["handles_missing_worktree"] = "no-artifacts:" in step
    c["write_id_single_segment"] = "single path segment" in step
    c["write_staged_then_moved"] = (
        "staging location first" in step and "only once the whole set is written" in step
    )
    c["write_preserves_existing"] = "delete neither" in step
    c["write_excludes_index"] = (
        "index.md is excluded from the write set" in step
        and "never copied, mirrored, or reconstructed" in step
    )
    c["row_per_artifact"] = (
        "for each artifact step 2 wrote" in step
        and "exactly one row per invocation" in step
    )
    c["row_only_by_invocation"] = (
        "invoke /wf:index" in step and "the only way a row is produced here" in step
    )
    c["row_sole_writer_preserved"] = "sole writer of every task's index.md" in step
    # Anchored: "not-persisted: " CONTAINS "persisted: ", so an unanchored test is
    # satisfied by the failure token alone and the success clause can be deleted.
    c["states_persisted"] = bool(re.search(r"(?<!not-)persisted: ", step))
    c["states_not_persisted"] = "not-persisted: " in step
    c["states_no_artifacts"] = "no-artifacts: " in step
    c["covers_worktree_loss"] = "unreadable or already gone" in step
    c["covers_write_failure"] = "part-way" in step
    c["failure_isolated"] = "every other terminal item still persists" in step
    c["reports_incomplete"] = "incomplete process record" in step
    c["no_artifacts_not_a_failure"] = "counted apart from" in step
    c["marker_before_write"] = "before step 2 writes anything" in step
    c["token_finality_stated"] = "final for the run" in step
    c["deferred_counted"] = "counted deferred" in step
    c["local_containment"] = "_local/" in dest

    # --- the reporting surface ----------------------------------------------
    # Matched on the outcome-token vocabulary and the count-slot shape rather than
    # a frozen sentence, so a reworded surround does not turn this red on its own.
    tally = r"<\w+> persisted / <\w+> not-persisted / <\w+> no-artifacts of <\w+> terminal"
    c["slot_rendered"] = bool(re.search(r"^persistence: +\S", whole, re.MULTILINE))
    c["slot_fallback"] = bool(re.search(r"not-persisted: <ids\s*\|\s*none>", whole))
    c["tick_segment"] = bool(re.search(r"-- persistence: " + tally, whole))
    c["tally_has_denominator"] = bool(re.search(r"^persistence: +" + tally, whole, re.MULTILINE))

    return c


def simulate(c):
    """Simulate a four-item run and return each item's recorded outcome."""
    conditions = [
        ("item-a", "readable"),
        ("item-b", "worktree-lost"),
        ("item-c", "write-failed"),
        ("item-d", "never-had-worktree"),
    ]
    outcomes = {}
    for item, condition in conditions:
        if not c["step_present"]:
            outcomes[item] = "no-record"
            continue
        if condition == "readable":
            sound = (
                c["locate_from_row"]
                and c["locate_read_only"]
                and c["write_excludes_index"]
                and c["write_paths_match_declaration"]
                and c["row_only_by_invocation"]
                and c["row_per_artifact"]
                and c["states_persisted"]
            )
            outcomes[item] = "persisted" if sound else "unsound"
        elif condition == "never-had-worktree":
            outcomes[item] = (
                "no-artifacts-stated"
                if (c["handles_missing_worktree"] and c["states_no_artifacts"]
                    and c["no_artifacts_not_a_failure"])
                else "miscounted"
            )
        else:
            covered = (
                c["covers_worktree_loss"]
                if condition == "worktree-lost"
                else c["covers_write_failure"]
            )
            outcomes[item] = (
                "not-persisted-stated"
                if (covered and c["states_not_persisted"])
                else "silent"
            )
    return outcomes


def evaluate(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = fh.read()
    except OSError as exc:
        print("%s: cannot read %s: %s" % (PREFIX, path, exc), file=sys.stderr)
        return 2

    c = derive(raw)
    o = simulate(c)
    problems = []

    # 1. A readable item persists to a destination that survives a prune.
    if o["item-a"] != "persisted":
        problems.append(
            "a terminal item with a readable worktree does not reach a recorded "
            "`persisted` outcome (the persistence step is absent or incomplete)"
        )
    if not c["destination_declared"]:
        problems.append("no bounded task-artifact persistence destination is declared")
    if not c["destination_outside_worktree"]:
        problems.append(
            "the destination is not stated to lie in the orchestrator's own workspace, "
            "so nothing guarantees it survives a prune of the worktrees"
        )
    if not c["write_paths_match_declaration"]:
        problems.append(
            "the path the persistence step writes is not the declared destination — "
            "the declaration and the write path can drift independently"
        )
    if not c["states_persisted"]:
        problems.append(
            "no success outcome is stated (note `not-persisted:` contains `persisted:`, "
            "so the failure token alone does not satisfy this)"
        )

    # 2. The sole-writer invariant, and a record that is not worse than the original.
    if not c["write_excludes_index"]:
        problems.append(
            "index.md is not excluded from the persistence write set — a copied row "
            "duplicates the index into the destination and displaces its sole writer"
        )
    if not c["row_only_by_invocation"] or not c["row_sole_writer_preserved"]:
        problems.append("the index row is not reached solely by invoking the index writer")
    if not c["row_per_artifact"]:
        problems.append(
            "the index writer is not invoked once per persisted artifact; it edits exactly "
            "one row per call, so a single invocation leaves every other row reading as "
            "absent — a worse record than the one the worktree held"
        )

    # 3/4/5. Every failure path is stated per item, and confined to that item.
    if o["item-b"] != "not-persisted-stated":
        problems.append(
            "an item whose worktree is lost before persistence completes is not recorded "
            "with a stated reason — the gap reads as an item that simply has no artifacts"
        )
    if o["item-c"] != "not-persisted-stated":
        problems.append(
            "an item whose persistence write fails is not recorded with a stated reason"
        )
    if o["item-d"] != "no-artifacts-stated":
        problems.append(
            "an item that never had a worktree is not recorded apart from the failures — "
            "counting it as not-persisted asserts a cause and manufactures a gap"
        )
    if not c["failure_isolated"]:
        problems.append(
            "a failed persistence is not confined to its own item — the other items are "
            "not stated to persist regardless"
        )
    if not c["reports_incomplete"]:
        problems.append(
            "a run with a failed persistence is not stated to report an incomplete record"
        )

    # 6. Capture integrity.
    if not c["gated_on_terminal_activation"]:
        problems.append(
            "persistence is not gated on the item's activation being terminal — a row that "
            "turns terminal from the delivery read alone would capture a torn set"
        )
    if not c["persist_at_most_once"]:
        problems.append(
            "persistence is not stated to run at most once per item, so a resumed run "
            "re-copies and overwrites what it already persisted"
        )
    if not c["marker_before_write"]:
        problems.append(
            "no in-progress marker is recorded before the write, so an attempt interrupted "
            "between the write and the settled token is re-run from zero and stacks a copy"
        )
    if not c["token_finality_stated"]:
        problems.append("whether a settled persistence token is final is left unstated")
    if not c["deferred_counted"] or not c["tally_has_denominator"]:
        problems.append(
            "a terminal item deferred because its activation is still live is not counted "
            "against a terminal denominator — it drops silently out of the tally, which is "
            "the omission the sibling ceremony check exists to forbid"
        )
    if not c["local_containment"]:
        problems.append(
            "the destination is not tied to the `_local/` boundary the Forbidden rule "
            "draws, leaving the write-scope rule unreconciled for a task root outside it"
        )
    if not c["write_staged_then_moved"]:
        problems.append(
            "the write is not staged and moved only when complete, so a part-way write "
            "leaves a half-populated folder indistinguishable from a complete one"
        )
    if not c["write_preserves_existing"]:
        problems.append("an existing destination folder is not preserved")
    if not c["write_id_single_segment"] or not c["locate_refuses_escaping_source"]:
        problems.append(
            "the source/destination paths are not contained — an id that is not a single "
            "segment, or a source resolving outside the recorded worktree, is not refused"
        )

    # 7. The reporting surface renders on every pass, with a stated fallback.
    if not c["slot_rendered"]:
        problems.append("the run block carries no rendered Persistence slot")
    if not c["slot_fallback"]:
        problems.append("the Persistence slot states no fallback token")
    if not c["tick_segment"]:
        problems.append("the tick REPORT line carries no persistence segment")

    # 8. Authority comes from the article, not a path prefix — and costs no exception.
    if not c["destination_no_committed_class"]:
        problems.append(
            "the declaration or the write step claims a committed-lifecycle path; that "
            "route requires the resolver to be the writer, which this contract forbids "
            "for task artifacts"
        )
    if not c["destination_same_article"] or not c["destination_no_new_exception"]:
        problems.append(
            "the destination is not declared under the shared write-scope article with no "
            "skill added to its exception list"
        )
    if not c["destination_sibling_not_share"]:
        problems.append(
            "the destination is not declared a sibling of the machine-emitted run-evidence "
            "class rather than a share of it"
        )

    # 9. Non-destructive, row-sourced location.
    if not c["locate_nondestructive"] or not c["locate_archive_candidate"]:
        problems.append(
            "the location step is not stated non-destructive over both the live and "
            "archived task-folder candidates"
        )
    if not c["runs_per_terminal_item"]:
        problems.append("the step is not scoped to terminal items")

    # 10. The shipper's own prohibition is untouched, inside the dispatch template.
    if not c["shipper_rule_intact"]:
        problems.append(
            "the shipper's do-not-fall-back-to-the-shared-checkout rule is not intact in "
            "the dispatch template; persistence must never be bought by relaxing it"
        )

    if problems:
        for p in problems:
            emit(p)
        return 1

    emit(
        "OK — readable item persisted to a prune-surviving declared destination, "
        "lost-worktree and failed-write items each recorded with a stated reason while "
        "siblings persisted, an item that never had a worktree counted apart, and every "
        "row reached only by the index writer, once per artifact."
    )
    return 0


# --- self-test corpus -------------------------------------------------------

SOUND = """# fixture

### The task-artifact persistence destination

The destination is `{task-root}/<id>/` in this orchestrator's own workspace, one folder per in-scope item, named by that item's own id — or, for an item whose source was archived, the matching `{task-root}/_archive/<id>/`.

It answers to the **same write-scope article** as every other write here — it resolves inside `_local/`, so the Forbidden rule is satisfied rather than excepted — and adds **no** skill to the write-scope exception list. It is a **sibling** of the machine-emitted run-evidence class, never a share of it.

## The tick loop

### 1. OBSERVE

- **Task-artifact persistence.** Run this for every item whose row has reached a terminal outcome **and whose activation is itself terminal**. **Persist an item at most once:** record an in-progress marker **before step 2 writes anything** and settle it in step 4. A settled token is **final for the run**. A deferred item is **counted deferred**.
  1. **Locate the set.** Take the worktree path this item's **own row** records — never a raw worktree query. A row with no worktree records `no-artifacts:` and stops. Otherwise read **read-only**: `{task-root}/<id>/`, or `{task-root}/_archive/<id>/` when archived. Nothing is moved, emptied, removed, or pruned. **Refuse rather than read** a source resolving outside the recorded worktree or onto this orchestrator's own workspace.
  2. **Write it.** Write into the matching `{task-root}/<id>/` or `{task-root}/_archive/<id>/`. Use `<id>` as a **single path segment**. Write to a **staging location first** and move it into place **only once the whole set is written**. When the destination is non-empty, write beside it and **delete neither**. **`index.md` is excluded from the write set** — never copied, mirrored, or reconstructed.
  3. **Rows.** For **each artifact step 2 wrote**, invoke `/wf:index <id> <slot> "<summary>"`. That writer edits **exactly one row per invocation**. These are the **only** way a row is produced here. The index writer remains the sole writer of every task's `index.md`.
  4. **Outcome.** Record `persisted: <the destination folder>`, or `not-persisted: <the mechanical reason>` — unreadable or already gone, a refused source, or a write that failed part-way — or `no-artifacts: <none recorded>`, which is counted apart from the failures. Every other terminal item still persists, and the run reports an **incomplete** process record.

### 2. DISPATCH

One line: `<merged>/<total> done — persistence: <k> persisted / <n> not-persisted / <x> no-artifacts of <t> terminal`.

## The shipper dispatch template

> - **If your isolated worktree is unavailable or lost, STOP and report it — do NOT fall back to the shared checkout.** Working in the shared checkout corrupts the orchestrator's view.

## Final Output

```
FLEET — <Running | Complete>

Version:          <v | unknown>
Persistence:      <k> persisted / <n> not-persisted / <x> no-artifacts of <t> terminal — not-persisted: <ids | none>
Next:             <none — complete>
```
"""

DEFECTS = {
    # The pre-fix shape: artifacts stay in the worktree, no persistence at all.
    "no-persistence": lambda s: re.sub(
        r"- \*\*Task-artifact persistence\.\*\*.*?(?=\n### 2\.)", "", s, flags=re.S
    ),
    # A "convenience" copy of the row into the destination.
    "index-copied": lambda s: s.replace(
        "**`index.md` is excluded from the write set** — never copied, mirrored, or reconstructed.",
        "`index.md` is copied along with everything else for convenience.",
    ),
    # A lost worktree produces no record — the exact F8 silence.
    "silent-failure": lambda s: s.replace(
        "or `not-persisted: <the mechanical reason>` — unreadable or already gone, a refused source, or a write that failed part-way — ", ""
    ),
    # The MIRROR of the above: the success clause is deleted. Catches an unanchored
    # `states_persisted`, since "not-persisted: " contains "persisted: ".
    "silent-success": lambda s: s.replace(
        "Record `persisted: <the destination folder>`, or ", "Record "
    ),
    # One item's failure stops the others persisting.
    "failure-contaminates": lambda s: s.replace(
        "Every other terminal item still persists, and the run reports an **incomplete** process record.",
        "Stop the run.",
    ),
    # Authority claimed from a path prefix under the committed-lifecycle home.
    "committed-path": lambda s: s.replace(
        "The destination is `{task-root}/<id>/` in this orchestrator's own workspace",
        "The destination is `.wf/task-artifacts/<id>/` in this orchestrator's own workspace",
    ),
    # The declaration stays honest while the WRITE PATH drifts to a committed home.
    "step-writes-committed-path": lambda s: s.replace(
        "Write into the matching `{task-root}/<id>/` or `{task-root}/_archive/<id>/`.",
        "Write into `.wf/task-artifacts/<id>/`.",
    ),
    # Persistence bought by relaxing the shipper's own prohibition.
    "shipper-writes": lambda s: s.replace(
        "**If your isolated worktree is unavailable or lost, STOP and report it — do NOT fall back to the shared checkout.**",
        "**If your isolated worktree is lost, write your artifacts to the shared checkout.**",
    ),
    # The outcome is computed but never rendered.
    "unreported": lambda s: s.replace(
        "Persistence:      <k> persisted / <n> not-persisted / <x> no-artifacts — not-persisted: <ids | none>\n", ""
    ).replace(" — persistence: <k> persisted / <n> not-persisted / <x> no-artifacts", ""),
    # The row is written directly, displacing the sole writer.
    "row-written-directly": lambda s: s.replace(
        'invoke `/wf:index <id> <slot> "<summary>"`. That writer edits **exactly one row per invocation**. These are the **only** way a row is produced here.',
        "write the rows into `index.md` directly.",
    ),
    # One call for an N-artifact folder: every other row reads as absent.
    "single-index-call": lambda s: s.replace(
        "For **each artifact step 2 wrote**, invoke", "Once for the whole folder, invoke"
    ),
    # An item that never had a worktree is folded into the failure count.
    "no-artifacts-as-failure": lambda s: s.replace(
        "or `no-artifacts: <none recorded>`, which is counted apart from the failures.", ""
    ),
    # A part-way write leaves a half-populated destination.
    "unstaged-write": lambda s: s.replace(
        "Write to a **staging location first** and move it into place **only once the whole set is written**.",
        "Write the files into place as they are read.",
    ),
    # Captured on the delivery outcome alone, while the shipper may still be writing.
    "delivery-outcome-only": lambda s: s.replace(
        " **and whose activation is itself terminal**", ""
    ),
    # The tally loses its terminal denominator, so a deferred item vanishes from it.
    "no-denominator": lambda s: s.replace(" of <t> terminal", ""),
    # The write happens before anything durable records that it started.
    "unmarked-attempt": lambda s: s.replace(
        "record an in-progress marker **before step 2 writes anything** and settle it in step 4",
        "settle a token in step 4",
    ),
    # The destination floats free of the write-scope rule's own boundary.
    "unbounded-write-scope": lambda s: s.replace(
        " — it resolves inside `_local/`, so the Forbidden rule is satisfied rather than excepted —",
        "",
    ),
    # The step drifts to write an undeclared THIRD path that merely shares the
    # `{task-root}` prefix with the two declared tokens. A prefix-only check
    # (startswith the declared token's parent segment) would accept this because
    # every token here still starts with `{task-root}`; only exact membership
    # against the declared set catches it.
    "undeclared-prefix-write-path": lambda s: s.replace(
        "Write into the matching `{task-root}/<id>/` or `{task-root}/_archive/<id>/`.",
        "Write into the matching `{task-root}/<id>/` or `{task-root}/_archive/<id>/`, "
        "or `{task-root}/_scratch/<id>/` when staging.",
    ),
}


def emit_fixtures(target):
    try:
        os.makedirs(target, exist_ok=True)
        with open(os.path.join(target, "sound.md"), "w", encoding="utf-8") as fh:
            fh.write(SOUND)
        for name, mutate in DEFECTS.items():
            with open(os.path.join(target, name + ".md"), "w", encoding="utf-8") as fh:
                fh.write(mutate(SOUND))
    except OSError as exc:
        print("%s: cannot emit fixtures: %s" % (PREFIX, exc), file=sys.stderr)
        return 2
    return 0


def main(argv):
    if len(argv) == 3 and argv[1] == "--emit-fixtures":
        return emit_fixtures(argv[2])
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    return evaluate(argv[1])


if __name__ == "__main__":
    sys.exit(main(sys.argv))
