// wf resolver MCP runtime — server module.
//
// This module owns the MCP server surface. It is bundled by esbuild into a
// single self-contained dist/runtime.mjs (all dependencies inlined), which the
// dist/server.mjs launcher imports only after confirming a supported Node.js.
//
// WF-287 established the runtime + protocol handshake (the liveness tool).
// WF-270 wires the deterministic resolver engine (WF-269) to the MCP surface as
// the typed resolver query tools + the pack register write-path (see tools.ts /
// service.ts). Every query response is bounded metadata — no fragment bodies.

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ResolverService } from "./service.js";
import { createDefaultPorts, resolveWorkspaceRoot } from "./ports.js";
import { registerResolverTools } from "./tools.js";

const SERVER_NAME = "wf-resolver";
const SERVER_VERSION = "0.2.0";

function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "wf_resolver_status",
    {
      title: "wf resolver status",
      description:
        "Reports that the bundled wf resolver MCP runtime is alive. Liveness probe for the resolver runtime; the typed resolver queries are the resolve_* / *_pack tools.",
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: `${SERVER_NAME} ${SERVER_VERSION} ready`,
        },
      ],
    }),
  );

  const service = new ResolverService(createDefaultPorts(resolveWorkspaceRoot()));
  registerResolverTools(server, service);

  return server;
}

serveStdio(createServer);
