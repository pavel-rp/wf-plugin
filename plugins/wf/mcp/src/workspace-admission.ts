// wf resolver — lifecycle workspace selection and admission (WF-445).
//
// ONE resolver-owned API selects the lifecycle workspace root under a fixed
// precedence — explicit argument, then `WF_WORKSPACE_ROOT`, then cwd — and
// admits the winner against the launch worktree family, returning a typed
// discriminated-union result later lifecycle surfaces consume unchanged.
//
// THE ABSENT-VS-INVALID DISTINCTION IS THE POINT. A source that is `null` /
// `undefined` is ABSENT: it falls through to the next tier and is not a failure.
// A source that is present but blank is a DECLARATION, and an invalid
// declaration is TERMINAL — it never falls through to a lower-precedence tier.
// The expression this module replaces (`process.env.WF_WORKSPACE_ROOT ||
// process.cwd()`) cannot tell those apart, so a blank declaration silently
// resolved against cwd — the containment defect this boundary closes.
//
// This module reads and probes only: nothing here writes a file, directory,
// ledger, snapshot, environment variable, or working directory on ANY success
// or failure path. It composes over `git-workspace.ts` rather than
// reimplementing canonicalization or identity, and it deliberately shares NO
// code with plugin installation-root validation (`resolver/paths.ts`,
// `resolver/resolve.ts`, `resolver/registry.ts`) — project workspace admission
// and plugin-root validation are distinct concerns, and inventory-supplied
// plugin roots remain governed by that separate validation.

import {
  resolveWorkspaceIdentity,
  type WorkspaceIdentity,
} from "./git-workspace.js";

export type { WorkspaceIdentity };

/** Which precedence tier supplied the root that was attempted. */
export type WorkspaceRootSource = "explicit" | "environment" | "cwd";

/** Why admission failed. `declaration-empty` is the absent-vs-invalid
 *  distinction: an unset source is absent (falls through, not a failure);
 *  a present-but-blank source is invalid (terminal). */
export type WorkspaceAdmissionReason =
  | "declaration-empty"
  | "not-absolute"
  | "not-found"
  | "not-a-directory"
  | "out-of-family";

/** The candidate roots, in precedence order. `null`/`undefined` means the
 *  source is absent; a present-but-blank string is a declaration, not an absence. */
export interface WorkspaceRootDeclaration {
  explicit?: string | null;
  environment?: string | null;
  cwd: string;
}

/** The single canonical admitted-root value later lifecycle surfaces consume. */
export type AdmittedWorkspaceRoot =
  | {
      ok: true;
      root: string;
      source: WorkspaceRootSource;
      identity: WorkspaceIdentity;
    }
  | {
      ok: false;
      root: null;
      source: WorkspaceRootSource;
      reason: WorkspaceAdmissionReason;
      diagnostic: string;
    };

/** Human-readable label for a tier, used in the canonicalization error messages
 *  `git-workspace.ts` raises and in every diagnostic this module composes. */
function label(source: WorkspaceRootSource): string {
  if (source === "explicit") return "explicit workspace root";
  if (source === "environment") return "WF_WORKSPACE_ROOT";
  return "current working directory";
}

function failure(
  source: WorkspaceRootSource,
  reason: WorkspaceAdmissionReason,
  diagnostic: string,
): AdmittedWorkspaceRoot {
  return { ok: false, root: null, source, reason, diagnostic };
}

/**
 * Map a canonicalization/identity throw onto the CLOSED reason set. The
 * messages matched here are the ones `git-workspace.ts` raises; an unrecognized
 * message still resolves to a closed token (`not-found` — the declared root
 * could not be resolved to an admissible directory) rather than propagating.
 * A throw escaping this boundary would defeat the typed-result contract.
 */
function reasonFromThrow(message: string): WorkspaceAdmissionReason {
  if (message.includes("must be an absolute path")) return "not-absolute";
  if (message.includes("must be a directory")) return "not-a-directory";
  if (message.includes("does not exist")) return "not-found";
  return "not-found";
}

/**
 * The worktree-family constraint, identical to the one
 * `WorkspaceServiceRegistry.select()` already applies: a Git launch admits any
 * main/linked worktree sharing its common directory; a plain-directory launch
 * admits only that one canonical directory. `launch === null` imposes no family
 * constraint — the candidate IS the launch (the pre-MCP case).
 */
function admittedByFamily(
  identity: WorkspaceIdentity,
  launch: WorkspaceIdentity | null,
): boolean {
  if (launch === null) return true;
  if (launch.kind === "git") {
    return identity.kind === "git" && identity.commonDir === launch.commonDir;
  }
  return identity.root === launch.root;
}

/** Canonicalize one selected candidate and admit it against `launch`. */
function admit(
  source: WorkspaceRootSource,
  candidate: string,
  launch: WorkspaceIdentity | null,
): AdmittedWorkspaceRoot {
  let identity: WorkspaceIdentity;
  try {
    identity = resolveWorkspaceIdentity(candidate, label(source));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Classify on the WORDING ONLY, never on the rejected path. Every raised
    // message is `<label> <wording>` or `<label> <wording>: <path>`, and no
    // label contains a colon — so the segment before the first `": "` is the
    // wording and nothing else. Matching the whole message would let a path
    // that reads like another failure (`/tmp/must be a directory`) spoof the
    // token; eliding the candidate's text instead would let a path that is a
    // substring of the wording (`must`) erase it. Splitting is immune to both,
    // and 21 downstream surfaces branch on this token.
    const classifiable = message.split(": ")[0] ?? message;
    // Echo the rejected candidate when the raised message omits it (the
    // absolute-path check names the label but not the value), so a diagnostic
    // is actionable on its own.
    const diagnostic = message.includes(candidate)
      ? message
      : `${message} Received: \`${candidate}\`.`;
    return failure(source, reasonFromThrow(classifiable), diagnostic);
  }

  if (!admittedByFamily(identity, launch)) {
    return failure(
      source,
      "out-of-family",
      `${label(source)} resolves to \`${identity.root}\`, which is outside the launch workspace family.`,
    );
  }

  return { ok: true, root: identity.root, source, identity };
}

/**
 * Select one root by precedence, canonicalize it, and admit it against
 * `launch`. `launch: null` admits the candidate as the launch itself
 * (canonicalize + identify, no family constraint) — the pre-MCP case.
 * Deterministic, fail-closed, read-only.
 */
export function selectWorkspaceRoot(
  declaration: WorkspaceRootDeclaration,
  launch: WorkspaceIdentity | null,
): AdmittedWorkspaceRoot {
  const tiers: ReadonlyArray<{
    source: WorkspaceRootSource;
    value: string | null | undefined;
  }> = [
    { source: "explicit", value: declaration.explicit },
    { source: "environment", value: declaration.environment },
    { source: "cwd", value: declaration.cwd },
  ];

  for (const tier of tiers) {
    // ABSENT — not declared at all. Fall through to the next tier; never a failure.
    if (tier.value === null || tier.value === undefined) continue;

    // DECLARED BUT BLANK — invalid, and therefore terminal. Returning here (rather
    // than continuing) is what stops a blank declaration silently degrading to a
    // lower-precedence source.
    if (tier.value.trim().length === 0) {
      return failure(
        tier.source,
        "declaration-empty",
        `${label(tier.source)} is declared but blank; a declared workspace root is never replaced by a lower-precedence source.`,
      );
    }

    // DECLARED — this tier wins outright. Selection happens exactly once, so an
    // admission failure below is terminal too.
    return admit(tier.source, tier.value, launch);
  }

  // `cwd` is non-optional in the declaration type, so this is unreachable from
  // TypeScript. A plain-JavaScript caller can still omit it; fail closed at the
  // terminal tier rather than throwing.
  return failure(
    "cwd",
    "declaration-empty",
    `${label("cwd")} is undeclared, so no workspace root could be selected.`,
  );
}
