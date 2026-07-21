// wf resolver — request-scoped workspace admission and service selection.
//
// A Git launch may serve every main/linked worktree in its repository family;
// a plain-directory launch may serve only that canonical directory. Each admitted
// root owns exactly one permanently root-bound ResolverService; aliases converge.

import { resolveWorkspaceIdentity, type WorkspaceIdentity } from "./git-workspace.js";
import { createDefaultPorts } from "./ports.js";
import { ResolverService } from "./service.js";

type ServiceFactory = (workspaceRoot: string) => ResolverService;

export class WorkspaceServiceRegistry {
  private readonly launchIdentity: WorkspaceIdentity;
  private readonly services = new Map<string, ResolverService>();

  constructor(
    launchDirectory: string,
    private readonly createService: ServiceFactory = (root) =>
      new ResolverService(createDefaultPorts(root)),
  ) {
    this.launchIdentity = resolveWorkspaceIdentity(launchDirectory, "launch directory");
  }

  /** Validate, admit, and select the service for one MCP request. */
  select(workspaceRoot: string): ResolverService {
    const identity = resolveWorkspaceIdentity(workspaceRoot);
    if (this.launchIdentity.kind === "git") {
      if (identity.kind !== "git" || identity.commonDir !== this.launchIdentity.commonDir) {
        throw new Error(
          `workspaceRoot is outside the launch repository's worktree family: ${workspaceRoot}`,
        );
      }
    } else if (identity.root !== this.launchIdentity.root) {
      // Preserve the launch anchor across a plain→Git transition: if that exact
      // directory becomes a worktree top-level, its Git identity still keys the
      // existing service. Any nested/unrelated repository or linked worktree has
      // a different top-level and remains outside the admitted plain launch root.
      throw new Error(
        `workspaceRoot is outside the plain launch directory: ${workspaceRoot}`,
      );
    }

    let service = this.services.get(identity.root);
    if (!service) {
      service = this.createService(identity.root);
      this.services.set(identity.root, service);
    }
    return service;
  }
}
