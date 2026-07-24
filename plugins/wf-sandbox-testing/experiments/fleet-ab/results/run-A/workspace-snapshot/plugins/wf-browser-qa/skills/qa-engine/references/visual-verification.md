# Visual-verification sub-phase (Layer A / Layer B)

The detail of Phase 5v — read **on-demand**, only when the engine reaches a scenario whose `06_qa.md` block carries a `**Visual:** yes` marker. A non-visual scenario never reads this file. The gate condition, scope boundary, and the fact that a hard-fail probe or rubric failure FAILs the scenario are stated in the SKILL body; this file carries the probe table, the rubric, and the exact verdict-wiring.

**Scope boundary (restated):** absolute visual defects only — overlap, clipping/truncation, crowding/"stuck-together" controls, orphaned or mis-rendered controls, collapsed/oversized containers. **Not** visual-regression / golden-image pixel-diffing (no baseline image, no per-pixel comparison). Use only generic browser APIs (`getBoundingClientRect`, computed styles, `screenshot_page`, `run_playwright_code`); name no framework, component library, or app route.

## Contents

- [Layer A — deterministic geometry probes](#layer-a--deterministic-geometry-probes)
- [Layer B — holistic vision review (pass path)](#layer-b--holistic-vision-review-pass-path)
- [Wire the verdict](#wire-the-verdict)

## Layer A — deterministic geometry probes

Run **one** `run_playwright_code` call that walks the visible interactive/content elements via `getBoundingClientRect()` + computed styles and returns a **small JSON findings object** (not a DOM dump — keep it well under the ~2KB guard; return only elements *with* findings plus counts, not every element). Probe for:

| Probe | What it measures | Bucket |
|---|---|---|
| **interactive-element overlap** | two interactive elements' bounding rects intersect (beyond expected nesting) | **HARD-FAIL** |
| **collapsed 0-size (should be visible)** | an element that should render has `width===0` or `height===0` (or `clientHeight===0` with content) while not intentionally hidden (`display:none`/`hidden`/`aria-hidden`) | **HARD-FAIL** |
| **off-screen positioning** | a should-be-visible element sits entirely outside the viewport / its container (e.g. negative coords, pushed far beyond the layout) with no intentional off-screen pattern | **HARD-FAIL** |
| **clipping / overflow** | `scrollWidth > clientWidth` (or `scrollHeight > clientHeight`) on a container not meant to scroll, or an element extending beyond its parent/viewport bounds — text or controls truncated | advisory *(recorded; see note)* |
| **"stuck-together" adjacency** | two adjacent interactive elements with ~0px gap where spacing is expected | **advisory** |
| **low text/background contrast** | computed text vs. background color contrast below a legibility threshold | **advisory** |

**Hybrid verdict authority (exact — do not drift):**

- **HARD-FAIL set = { interactive-element overlap, collapsed 0-size element that should be visible, off-screen positioning }.** Any finding in this set **fails the scenario deterministically**. Do not demote a hard-fail finding to a note.
- **ADVISORY set = { clipping / overflow, "stuck-together" ~0px-gap adjacency, low text/background contrast }.** These are **recorded as notes only and never fail the scenario on their own.** Do not let an advisory finding flip the verdict.

State the bucket for every finding you record. The verdict from Layer A is: **any hard-fail finding → Layer-A FAIL**; otherwise Layer-A PASS (advisories, if any, ride along as notes into the `**Visual:**` sub-block's geometry table).

## Layer B — holistic vision review (pass path)

If Layer A did not already hard-fail, take a screenshot **on the pass path** (`screenshot_page` → `artifacts/qa-run-TC-NNN-<UTC>.png`) — the documented exception to "screenshots only on FAIL" stated in the SKILL's "Why this engine drives in-thread" section. **View** the screenshot and score the rendered layout against this **fixed rubric**:

- **alignment** — controls and content line up on a sensible grid; nothing visibly askew.
- **spacing / crowding** — adequate whitespace; no controls jammed together.
- **overlap** — no controls visually sitting on top of one another.
- **clipping** — no text or control cut off at an edge or container boundary.
- **consistent sizing** — like controls are sized consistently; nothing collapsed or blown up.
- **"controls look like controls"** — buttons/inputs/links render as recognizable, styled controls, not orphaned/unstyled fragments.

A **rubric failure** (any criterion clearly violated in the rendered image) **FAILs the scenario.** Record the one-line rubric verdict and the saved screenshot path, then discard the image from working memory (observation discipline — don't retain it as a page dump).

## Wire the verdict

- **A hard-fail Layer A probe OR a Layer B rubric failure → the scenario FAILs.** Use the existing FAIL shape (step/assertion table as recorded + the `**Screenshot:**` line, which for a Layer-B failure is the pass-path capture, for a Layer-A hard-fail a screenshot taken at failure time). **On a Layer-A hard-fail, explicitly take that screenshot now** (`screenshot_page` → `artifacts/qa-run-TC-NNN-<UTC>.png`) before wiring the verdict — Layer A itself only runs `run_playwright_code` and never captures an image, so without this step the required `**Screenshot:**` evidence line would be missing. Surface the offending probe/rubric criterion in the failure notes and the Defects table.
- **Otherwise the scenario PASSes**, and the report carries the `**Visual:**` PASS-path sub-block per [`output-format.md`](output-format.md): `**Visual:** PASS`, `**Screenshot:**` (the pass-path capture), `**Geometry findings:**` (the compact table, or `none`), and `**Vision review:**` (the rubric verdict). Advisory Layer-A findings appear in that geometry table tagged `advisory` — present but non-failing.

If the runtime can't take a screenshot or `run_playwright_code` is unavailable for the geometry probe, mark the scenario `BLOCKED · setup: visual verification unavailable (no screenshot / playwright)` rather than reporting a visual PASS you couldn't actually measure.
