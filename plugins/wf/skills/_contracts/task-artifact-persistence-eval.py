#!/usr/bin/env python3
"""task-artifact-persistence-eval.py — evaluate the fleet task-artifact persistence contract.

This is a BEHAVIOURAL assertion over the persistence step's decision graph, not a
re-read of its wording. It derives the contract's capabilities from the dispatch
brief, then simulates a multi-item run in which one item's worktree is readable,
one item's worktree is lost before persistence runs, and one item's persistence
write fails part-way — and asserts the recorded outcome for each, plus the
run-level outcome, plus the two structural properties the outcome depends on:

  * the destination lies in the orchestrator's own workspace, so it survives a
    prune of every worktree;
  * the index row is reached ONLY by invoking the index writer, and `index.md`
    is never in the persistence write set, so the sole-writer invariant holds.

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

STEP_MARKER = "task-artifact persistence."
DEST_HEADING = "### the task-artifact persistence destination"


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
    norm_lines = [normalize(l) for l in lines]
    whole = "\n".join(norm_lines)

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

    c = {}

    # --- the destination ----------------------------------------------------
    c["destination_declared"] = bool(dest) and "one folder per in-scope item" in dest
    c["destination_outside_worktree"] = "in this orchestrator's own workspace" in dest
    # A committed-lifecycle path would move authority to the resolver, which must
    # not become a writer of task artifacts. The destination must name none.
    c["destination_no_committed_class"] = (
        ".wf/" not in dest
        and "committed artifact class" not in dest.replace("declares no committed artifact class", "")
    )
    c["destination_sibling_not_share"] = "sibling" in dest and "never a share of it" in dest
    c["destination_no_new_exception"] = "write-scope exception list" in dest and (
        "adds no skill to the write-scope exception list" in dest
    )
    c["destination_same_article"] = "same write-scope article" in dest

    # --- the shipper's own rule, which persistence must never relax ----------
    c["shipper_rule_intact"] = "do not fall back to the shared checkout" in whole

    # --- the persistence step -----------------------------------------------
    c["step_present"] = bool(step)
    c["runs_per_terminal_item"] = "terminal outcome" in step and "once per item" in step
    c["locate_from_row"] = "own row records" in step and "never a raw worktree query" in step
    c["locate_read_only"] = "read-only" in step
    c["locate_archive_candidate"] = "_archive" in step
    c["locate_nondestructive"] = "nothing is moved, emptied, removed, or pruned" in step
    c["write_excludes_index"] = (
        "index.md is excluded from the write set" in step
        and "never copied, mirrored, or reconstructed" in step
    )
    c["row_only_by_invocation"] = (
        "invoke /wf:index" in step and "the only way a row is produced here" in step
    )
    c["row_sole_writer_preserved"] = "sole writer of every task's index.md" in step
    c["states_persisted"] = "persisted: " in step
    c["states_not_persisted"] = "not-persisted: " in step
    c["covers_worktree_loss"] = "unreadable or already gone" in step
    c["covers_write_failure"] = "fails part-way" in step
    c["failure_isolated"] = "every other terminal item still persists" in step
    c["reports_incomplete"] = "incomplete process record" in step

    # --- the reporting surface ----------------------------------------------
    c["slot_rendered"] = bool(
        re.search(r"^persistence: +\S", whole, re.MULTILINE)
    )
    c["slot_fallback"] = "not persisted: <ids | none>" in whole
    c["tick_segment"] = "-- persistence: <p> persisted / <n> not persisted" in whole

    return c


def simulate(c):
    """Simulate a three-item run and return each item's recorded outcome."""
    conditions = [
        ("item-a", "readable"),
        ("item-b", "worktree-lost"),
        ("item-c", "write-failed"),
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
                and c["row_only_by_invocation"]
                and c["states_persisted"]
            )
            outcomes[item] = "persisted" if sound else "unsound"
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
        print("task-artifact-persistence-eval: cannot read %s: %s" % (path, exc), file=sys.stderr)
        return 2

    c = derive(raw)
    o = simulate(c)
    problems = []

    # 1. A readable item persists, and the destination survives a prune.
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

    # 2. The sole-writer invariant.
    if not c["write_excludes_index"]:
        problems.append(
            "index.md is not excluded from the persistence write set — a copied row "
            "duplicates the index into the destination and displaces its sole writer"
        )
    if not c["row_only_by_invocation"] or not c["row_sole_writer_preserved"]:
        problems.append(
            "the index row is not reached solely by invoking the index writer"
        )

    # 3/4. Both failure paths are stated per item, and confined to that item.
    if o["item-b"] != "not-persisted-stated":
        problems.append(
            "an item whose worktree is lost before persistence completes is not "
            "recorded with a stated reason — the gap reads as an item that simply "
            "has no artifacts"
        )
    if o["item-c"] != "not-persisted-stated":
        problems.append(
            "an item whose persistence write fails is not recorded with a stated reason"
        )
    if not c["failure_isolated"]:
        problems.append(
            "a failed persistence is not confined to its own item — the other items "
            "are not stated to persist regardless"
        )
    if not c["reports_incomplete"]:
        problems.append(
            "a run with a failed persistence is not stated to report an incomplete "
            "process record"
        )

    # 5. The reporting surface renders on every pass, with a stated fallback.
    if not c["slot_rendered"]:
        problems.append("the run block carries no rendered Persistence slot")
    if not c["slot_fallback"]:
        problems.append("the Persistence slot states no fallback token")
    if not c["tick_segment"]:
        problems.append("the tick REPORT line carries no persistence segment")

    # 6. Authority comes from the article, not a path prefix — and costs no exception.
    if not c["destination_no_committed_class"]:
        problems.append(
            "the destination claims a committed-lifecycle path; that route requires the "
            "resolver to be the writer, which this contract forbids for task artifacts"
        )
    if not c["destination_same_article"] or not c["destination_no_new_exception"]:
        problems.append(
            "the destination is not declared under the shared write-scope article with "
            "no skill added to its exception list"
        )
    if not c["destination_sibling_not_share"]:
        problems.append(
            "the destination is not declared a sibling of the machine-emitted "
            "run-evidence class rather than a share of it"
        )

    # 7. Non-destructive, row-sourced location.
    if not c["locate_nondestructive"] or not c["locate_archive_candidate"]:
        problems.append(
            "the location step is not stated non-destructive over both the live and "
            "archived task-folder candidates"
        )
    if not c["runs_per_terminal_item"]:
        problems.append("the step is not scoped to run once per terminal item")

    # 8. The shipper's own prohibition is untouched.
    if not c["shipper_rule_intact"]:
        problems.append(
            "the shipper's do-not-fall-back-to-the-shared-checkout prohibition is absent; "
            "persistence must never be bought by relaxing it"
        )

    if problems:
        for p in problems:
            print("task-artifact-persistence: %s" % p)
        return 1

    print(
        "task-artifact-persistence: OK — readable item persisted to a prune-surviving "
        "destination, lost-worktree and failed-write items each recorded with a stated "
        "reason while siblings persisted, row reached only by the index writer."
    )
    return 0


# --- self-test corpus -------------------------------------------------------

SOUND = """# fixture

### The task-artifact persistence destination

The destination is `{task-root}/<id>/` in this orchestrator's own workspace, one folder per in-scope item, named by that item's own id.

It answers to the **same write-scope article** as every other write here, declares no committed artifact class, and adds **no** skill to the write-scope exception list. It is a **sibling** of the machine-emitted run-evidence class, never a share of it.

## The tick loop

### 1. OBSERVE

- **Task-artifact persistence.** Run this for every item whose row has reached a terminal outcome, exactly once per item.
  1. **Locate the set.** Take the worktree path this item's **own row** records — never a raw worktree query. Read it **read-only**: `{task-root}/<id>/`, or `{task-root}/_archive/<id>/` when archived. Nothing is moved, emptied, removed, or pruned.
  2. **Write it.** Write the set into `{task-root}/<id>/`. **`index.md` is excluded from the write set** — never copied, mirrored, or reconstructed.
  3. **Row.** Invoke `/wf:index <id> <slot> "<summary>"` through the Skill tool. That is the **only** way a row is produced here. The index writer remains the sole writer of every task's `index.md`.
  4. **Outcome.** Record `persisted: <the destination folder>`, or `not-persisted: <the mechanical reason>` — a worktree unreadable or already gone, and a write that fails part-way. Every other terminal item still persists, and the run reports an **incomplete** process record.

### 2. DISPATCH

> - **If your isolated worktree is unavailable or lost, STOP and report it — do NOT fall back to the shared checkout.**

One line: `<merged>/<total> done — persistence: <p> persisted / <n> not persisted`.

```
FLEET — <Running | Complete>

Version:          <v | unknown>
Persistence:      <p> persisted / <n> not persisted — not persisted: <ids | none>
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
        "Record `persisted: <the destination folder>`, or `not-persisted: <the mechanical reason>` — a worktree unreadable or already gone, and a write that fails part-way.",
        "Record `persisted: <the destination folder>` when it works.",
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
    # Persistence bought by relaxing the shipper's own prohibition.
    "shipper-writes": lambda s: s.replace(
        "**If your isolated worktree is unavailable or lost, STOP and report it — do NOT fall back to the shared checkout.**",
        "**If your isolated worktree is lost, write your artifacts to the shared checkout.**",
    ),
    # The outcome is computed but never rendered.
    "unreported": lambda s: s.replace(
        "Persistence:      <p> persisted / <n> not persisted — not persisted: <ids | none>\n", ""
    ).replace(" — persistence: <p> persisted / <n> not persisted", ""),
    # The row is written directly, displacing the sole writer.
    "row-written-directly": lambda s: s.replace(
        'Invoke `/wf:index <id> <slot> "<summary>"` through the Skill tool. That is the **only** way a row is produced here.',
        "Write the row into `index.md` directly.",
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
        print("task-artifact-persistence-eval: cannot emit fixtures: %s" % exc, file=sys.stderr)
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
