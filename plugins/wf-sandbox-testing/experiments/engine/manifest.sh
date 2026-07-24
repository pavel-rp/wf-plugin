#!/usr/bin/env bash
# manifest.sh — load, validate, and expose one experiment manifest.
#
# Sourced by every other engine script. Carries no experiment-specific knowledge: the slot set it
# validates is the frozen v1 contract in schema.md, and every value it exposes comes from the
# manifest file the caller names.
#
# Usage (sourced):
#   . "<engine>/manifest.sh"
#   manifest_load /path/to/experiment.json    # validates; non-zero + named reason on any violation
#
# After a successful load the following are set:
#   MANIFEST_PATH        absolute path to the loaded manifest
#   KIT_DIR              dirname(MANIFEST_PATH) — the experiment's root; every emitted path derives
#                        from it, so an experiment folder is relocatable
#   RESULTS_DIR          $KIT_DIR/results
#   MANIFEST_NAME        the experiment's name
#   ARM_LABELS[]         arm labels, in declaration order
#   ARM_REFS[]           per-arm wf_ref, index-aligned with ARM_LABELS
#   COMPARE_BASES[]      compares[].base, in declaration order
#   COMPARE_AGAINSTS[]   compares[].against, index-aligned with COMPARE_BASES
#   BLINDING_VOCAB[]     the blinding vocabulary (guaranteed non-empty)
#   FORBIDDEN_PATHS[]    glob patterns, relative to a seeded tree, that must not exist there
#                        (may be empty)
#   CONST_IMAGE_REPO CONST_WORKLOAD_REF CONST_CLI_VERSION CONST_UMBRELLA_ID
#   CONST_GATE_SKILL CONST_FAKE_SCRIPTS CONST_MEASURED_SKILL CONST_MODEL
#   CONST_PACKS CONST_GAP_SECONDS
#
# Validation is loud and named, and it runs for every phase INCLUDING --dry-run: a manifest defect
# is a defect whether or not anything is about to be spent. An empty blinding vocabulary is
# rejected here, at load, before any image build or container start — a degenerate banned-word
# pattern must never reach the gate.

manifest_die() { echo "manifest.sh: ERROR — $*" >&2; return 2; }

# manifest_load <path> — validate and populate. Returns 2 on any violation.
manifest_load() {
  local path="${1:-}"
  [ -n "$path" ] || { manifest_die "manifest_load needs a manifest path"; return 2; }
  [ -f "$path" ] || { manifest_die "manifest not found: $path"; return 2; }
  [ -r "$path" ] || { manifest_die "manifest not readable: $path"; return 2; }

  command -v node >/dev/null 2>&1 || { manifest_die "node not found on PATH — the manifest reader needs Node."; return 2; }

  local dump rc=0
  dump="$(node -e '
    const fs = require("node:fs");
    const Q = String.fromCharCode(39);
    const q = (s) => Q + String(s).split(Q).join(Q + "\\" + Q + Q) + Q;
    const bad = (m) => { process.stderr.write("manifest.sh: ERROR — " + m + "\n"); process.exit(2); };

    const p = process.argv[1];
    let doc;
    try { doc = JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { bad("manifest is not parseable JSON (" + p + "): " + e.message); }
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) bad("manifest must be a JSON object");

    const name = doc.name;
    if (typeof name !== "string" || name === "") bad("`name` is required and must be a non-empty string");

    // --- arms ---------------------------------------------------------------------------------
    const arms = doc.arms;
    if (!Array.isArray(arms)) bad("`arms` is required and must be an array");
    if (arms.length === 0) bad("`arms` must declare at least one arm");
    const labels = [], refs = [], seen = new Set();
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i];
      if (a === null || typeof a !== "object" || Array.isArray(a)) bad("arms[" + i + "] must be an object");
      const l = a.label;
      if (typeof l !== "string" || l === "") bad("arms[" + i + "].label is required and must be a non-empty string");
      if (!/^[A-Za-z0-9]+$/.test(l)) bad("arms[" + i + "].label " + JSON.stringify(l) + " must contain only [A-Za-z0-9] (it composes an image tag and a directory name)");
      if (seen.has(l)) bad("duplicate arm label " + JSON.stringify(l));
      seen.add(l);
      const r = a.wf_ref;
      if (typeof r !== "string" || r === "") bad("arms[" + i + "] (label " + JSON.stringify(l) + ") is missing a non-empty `wf_ref`");
      labels.push(l); refs.push(r);
    }

    // --- constants ----------------------------------------------------------------------------
    const c = doc.constants;
    if (c === null || typeof c !== "object" || Array.isArray(c)) bad("`constants` is required and must be an object");
    const required = ["image_repo", "workload_ref", "cli_version", "umbrella_id", "gate_skill", "fake_scripts", "measured_skill", "model"];
    for (const k of required) {
      if (typeof c[k] !== "string" || c[k] === "") bad("constants." + k + " is required and must be a non-empty string");
    }
    if (!("packs" in c)) bad("constants.packs is required (it may be an empty string — an empty value means the flag is ABSENT, never present-and-empty)");
    if (typeof c.packs !== "string") bad("constants.packs must be a string (possibly empty)");
    if (!("gap_seconds" in c)) bad("constants.gap_seconds is required");
    const gap = c.gap_seconds;
    if (!(typeof gap === "number" && Number.isFinite(gap) && gap >= 0)) bad("constants.gap_seconds must be a non-negative number");

    // --- compares -----------------------------------------------------------------------------
    const cmp = doc.compares;
    if (!Array.isArray(cmp)) bad("`compares` is required and must be an array");
    if (cmp.length === 0) bad("`compares` must declare at least one pairwise comparison");
    const bases = [], againsts = [];
    for (let i = 0; i < cmp.length; i++) {
      const e = cmp[i];
      if (e === null || typeof e !== "object" || Array.isArray(e)) bad("compares[" + i + "] must be an object");
      const b = e.base, g = e.against;
      if (typeof b !== "string" || b === "") bad("compares[" + i + "].base is required and must be a non-empty string");
      if (typeof g !== "string" || g === "") bad("compares[" + i + "].against is required and must be a non-empty string");
      if (!seen.has(b)) bad("compares[" + i + "].base " + JSON.stringify(b) + " names an arm that is not declared");
      if (!seen.has(g)) bad("compares[" + i + "].against " + JSON.stringify(g) + " names an arm that is not declared");
      if (b === g) bad("compares[" + i + "] compares arm " + JSON.stringify(b) + " with itself");
      bases.push(b); againsts.push(g);
    }

    // --- mechanism_signals: RESERVED. Presence and type are validated; contents are never read. -
    if (!Array.isArray(doc.mechanism_signals)) bad("`mechanism_signals` is required and must be an array (reserved slot — its contents are never read)");

    // --- blinding vocabulary ------------------------------------------------------------------
    const bl = doc.blinding;
    if (bl === null || typeof bl !== "object" || Array.isArray(bl)) bad("`blinding` is required and must be an object");
    const vocab = bl.vocabulary;
    if (!Array.isArray(vocab)) bad("`blinding.vocabulary` is required and must be an array");
    if (vocab.length === 0) bad("`blinding.vocabulary` is EMPTY — refusing to proceed. An empty vocabulary degenerates the blinding gate pattern; declare the words that must never leak.");
    for (let i = 0; i < vocab.length; i++) {
      if (typeof vocab[i] !== "string" || vocab[i] === "") bad("blinding.vocabulary[" + i + "] must be a non-empty string");
    }
    const forbidden = bl.forbidden_paths;
    if (!Array.isArray(forbidden)) bad("`blinding.forbidden_paths` is required and must be an array (it may be empty)");
    for (let i = 0; i < forbidden.length; i++) {
      if (typeof forbidden[i] !== "string" || forbidden[i] === "") bad("blinding.forbidden_paths[" + i + "] must be a non-empty string");
      if (forbidden[i].startsWith("/") || forbidden[i].split("/").includes("..")) bad("blinding.forbidden_paths[" + i + "] must be relative to the seeded tree and must not escape it");
    }

    const out = [];
    out.push("MANIFEST_NAME=" + q(name));
    out.push("ARM_LABELS=(" + labels.map(q).join(" ") + ")");
    out.push("ARM_REFS=(" + refs.map(q).join(" ") + ")");
    out.push("COMPARE_BASES=(" + bases.map(q).join(" ") + ")");
    out.push("COMPARE_AGAINSTS=(" + againsts.map(q).join(" ") + ")");
    out.push("BLINDING_VOCAB=(" + vocab.map(q).join(" ") + ")");
    out.push("FORBIDDEN_PATHS=(" + forbidden.map(q).join(" ") + ")");
    out.push("CONST_IMAGE_REPO=" + q(c.image_repo));
    out.push("CONST_WORKLOAD_REF=" + q(c.workload_ref));
    out.push("CONST_CLI_VERSION=" + q(c.cli_version));
    out.push("CONST_UMBRELLA_ID=" + q(c.umbrella_id));
    out.push("CONST_GATE_SKILL=" + q(c.gate_skill));
    out.push("CONST_FAKE_SCRIPTS=" + q(c.fake_scripts));
    out.push("CONST_MEASURED_SKILL=" + q(c.measured_skill));
    out.push("CONST_MODEL=" + q(c.model));
    out.push("CONST_PACKS=" + q(c.packs));
    out.push("CONST_GAP_SECONDS=" + q(String(gap)));
    process.stdout.write(out.join("\n") + "\n");
  ' "$path")" || rc=$?
  [ "$rc" -eq 0 ] || return "$rc"

  MANIFEST_PATH="$(cd "$(dirname "$path")" && pwd)/$(basename "$path")"
  KIT_DIR="$(cd "$(dirname "$path")" && pwd)"
  RESULTS_DIR="$KIT_DIR/results"
  eval "$dump"
  return 0
}

# manifest_has_arm <label> — 0 when the manifest declares that arm.
manifest_has_arm() {
  local want="$1" l
  for l in ${ARM_LABELS+"${ARM_LABELS[@]}"}; do [ "$l" = "$want" ] && return 0; done
  return 1
}

# manifest_arm_ref <label> — print the arm's wf_ref; non-zero when the arm is not declared.
manifest_arm_ref() {
  local want="$1" i=0
  for i in "${!ARM_LABELS[@]}"; do
    [ "${ARM_LABELS[$i]}" = "$want" ] && { printf '%s' "${ARM_REFS[$i]}"; return 0; }
  done
  return 1
}

# manifest_image_tag <label> — the arm's image ref, composed from the manifest's image repo.
manifest_image_tag() { printf '%s' "${CONST_IMAGE_REPO}:arm${1}"; }

# manifest_run_flag <label> — the analysis flag naming an arm's measured-run directory.
manifest_run_flag() { local l="$1"; printf '%s' "--run-${l,,}"; }

# manifest_arm_ref_flag <label> — the per-arm build-ref override flag.
manifest_arm_ref_flag() { local l="$1"; printf '%s' "--wf-ref-${l,,}"; }

# manifest_require_arm <label> <who> — validate a caller-supplied label against the manifest.
manifest_require_arm() {
  local want="$1" who="${2:-manifest.sh}"
  manifest_has_arm "$want" && return 0
  echo "$who: ERROR — arm '$want' is not declared by this manifest (declared: ${ARM_LABELS[*]})" >&2
  return 2
}
