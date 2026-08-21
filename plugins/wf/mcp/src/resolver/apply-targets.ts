// wf resolver — pure rendering of the non-registry apply targets (WF-454).
//
// The DECISION half of the widened mutator's new write set, held to exactly the
// discipline `apply-install.ts` holds: deterministic, body-free, and
// side-effect-free. Nothing here opens a file, canonicalizes a path, takes a
// lock, or writes a byte. Current bytes go in, new bytes come out, and the
// caller decides what to do with them.
//
// THREE RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. A TARGET THAT WOULD NOT CHANGE IS NOT A TARGET. Every renderer below
//      reports `changed`, and the caller drops an unchanged target from the
//      transaction entirely. This is what makes "committed evidence stays
//      byte-identical while only the missing binding is seeded" a STRUCTURAL
//      property rather than a careful-writing one: on that path the committed
//      ledger is never handed to the transaction at all, so no journal entry, no
//      backup, and no replacement can touch it even in principle.
//
//   2. AN UNRELATED ENTRY SURVIVES. Each renderer parses the current document,
//      replaces only the keys it was asked to, and re-emits the rest untouched.
//      A pack this plan says nothing about keeps its recorded evidence, and a
//      question this plan does not answer keeps its persisted value.
//
//   3. A MALFORMED CURRENT DOCUMENT IS A REFUSAL, NEVER A SILENT RESET. The
//      READ path (`parseEvidenceLedger`) is deliberately tolerant, because a
//      corrupt record there degrades to "no evidence" and merely re-proposes a
//      seed. The WRITE path cannot be: re-emitting a document whose current
//      bytes could not be understood would DESTROY whatever it actually held.
//      So a ledger or profile that does not parse as a JSON object refuses, and
//      the refusal happens before the transaction opens.

import type {
  ArtifactEvidence,
  MachineBindingEvidence,
  PortablePackEvidence,
  QuestionValue,
} from "./types.js";

/** A rendered target, or the precise reason it could not be rendered. */
export type TargetRender =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; detail: string };

/** Stable JSON with sorted keys and a trailing newline.
 *
 *  Key order is normalized so two runs over the same facts produce byte-identical
 *  output — the same determinism `renderRegistryMutation` gets from applying
 *  actions in the plan's canonical order. Without it, an unrelated re-render
 *  could rewrite a file whose DATA did not change, which rule 1 forbids. */
function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input as object)) return null;
    seen.add(input as object);
    if (Array.isArray(input)) return input.map(normalize);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input as Record<string, unknown>).sort()) {
      out[key] = normalize((input as Record<string, unknown>)[key]);
    }
    return out;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

/** Parse a current document that the writer is about to re-emit.
 *
 *  Absent and empty both mean "a fresh document", which is the ordinary first-run
 *  case for a ledger or a profile. Anything present but not a JSON object is a
 *  refusal per rule 3. */
function parseDocument(
  current: string | null,
  label: string,
): { ok: true; document: Record<string, unknown> } | { ok: false; detail: string } {
  if (current === null || current.trim() === "") return { ok: true, document: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(current);
  } catch (err) {
    return {
      ok: false,
      detail: `${label} does not parse as JSON (${
        err instanceof Error ? err.message : String(err)
      }); it is not rewritten, so nothing that is there now is lost.`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      detail: `${label} is not a JSON object; it is not rewritten, so nothing that is there now is lost.`,
    };
  }
  return { ok: true, document: parsed as Record<string, unknown> };
}

function asSection(document: Record<string, unknown>, name: string): Record<string, unknown> {
  const section = document[name];
  if (typeof section !== "object" || section === null || Array.isArray(section)) return {};
  return { ...(section as Record<string, unknown>) };
}

/** One pack's evidence updates for a single ledger document. A `null` half means
 *  "this document is not where that half lives", never "erase it". */
export interface LedgerEvidenceUpdate {
  pluginId: string;
  portable?: PortablePackEvidence;
  binding?: MachineBindingEvidence;
}

/** One installed payload's ownership + hash proof, bound to its destination
 *  (WF-456).
 *
 *  Recorded in the ledger's `artifacts` section — the PORTABLE half, because the
 *  produced bytes and the capabilities that own them are project facts rather
 *  than machine facts, and `parseEvidenceLedger` already reads them from there.
 *  The `evidence` value is a fully-constructed `ArtifactEvidence`, so the owner
 *  set it carries has already passed `createArtifactEvidence`'s completeness and
 *  uniqueness checks: this renderer never assembles one from parts, and so cannot
 *  record a partial owner set by omission. */
export interface LedgerArtifactUpdate {
  destination: string;
  evidence: ArtifactEvidence;
}

/**
 * Render one evidence-ledger document with the named packs' evidence recorded.
 *
 * The three sections are written independently because the portable half may be
 * committed while the binding half is always machine-local. When the declared
 * home is `local` they land in the same file, so this renderer accepts updates
 * for any or all sections of whichever document it is given — which is also why
 * artifact proof (WF-456) is folded in HERE rather than through a second target:
 * two renderers writing one path would be two writes racing over one file, which
 * `addRendered`'s duplicate-destination gate would then have to reject.
 */
export function renderLedgerMutation(
  current: string | null,
  updates: readonly LedgerEvidenceUpdate[],
  label: string,
  artifacts: readonly LedgerArtifactUpdate[] = [],
): TargetRender {
  const parsed = parseDocument(current, label);
  if (!parsed.ok) return parsed;

  const document = { ...parsed.document };
  const portable = asSection(document, "portable");
  const binding = asSection(document, "binding");
  const artifactSection = asSection(document, "artifacts");

  for (const update of updates) {
    if (update.portable !== undefined) portable[update.pluginId] = update.portable;
    if (update.binding !== undefined) binding[update.pluginId] = update.binding;
  }
  // Rule 2 restated for the third section: only the destinations this plan names
  // are replaced, so an artifact recorded by an earlier install keeps its proof.
  for (const update of artifacts) artifactSection[update.destination] = update.evidence;

  if (Object.keys(portable).length > 0) document.portable = portable;
  if (Object.keys(binding).length > 0) document.binding = binding;
  if (Object.keys(artifactSection).length > 0) document.artifacts = artifactSection;

  const content = stableStringify(document);
  // Compared against the CURRENT BYTES, not against the parsed data, because the
  // question rule 1 asks is "would this write change the file?" — and a file that
  // parses the same but is spelled differently would still be changed by a write.
  return { ok: true, content, changed: content !== (current ?? "") };
}

/** One validated project answer bound to its declared destination. */
export interface ProfileAnswerUpdate {
  destination: string;
  value: QuestionValue;
}

/**
 * Render one capability profile document with the approved answers bound.
 *
 * The profile is a FLAT object keyed by each question's declared destination —
 * the same own-property lookup `applyQuestionValues` performs when it decides a
 * question is `resolved`. Writing any other shape would produce a file the
 * resolver could not read back, which the self-check would then catch as a
 * transaction failure; matching the reader exactly is what makes the seed take
 * effect rather than merely land.
 */
export function renderProfileMutation(
  current: string | null,
  updates: readonly ProfileAnswerUpdate[],
  label: string,
): TargetRender {
  const parsed = parseDocument(current, label);
  if (!parsed.ok) return parsed;

  const document = { ...parsed.document };
  for (const update of updates) document[update.destination] = update.value;

  const content = stableStringify(document);
  return { ok: true, content, changed: content !== (current ?? "") };
}
