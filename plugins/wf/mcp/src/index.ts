// wf resolver MCP runtime — server module.
//
// This module owns the MCP server surface. It is bundled by esbuild into a
// single self-contained dist/runtime.mjs (all dependencies inlined), which the
// dist/server.mjs launcher imports only after confirming a supported Node.js.
//
// Scope (WF-287): establish the runtime + protocol handshake only. Resolver
// traversal / inventory / snapshot / typed query operations arrive in later
// tasks; this file intentionally ships a single liveness tool.

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const SERVER_NAME = "wf-resolver";
const SERVER_VERSION = "0.1.0";

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
        "Reports that the bundled wf resolver MCP runtime is alive. Placeholder surface for the resolver runtime foundation; inventory and typed query operations arrive in later tasks.",
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

  return server;
}

serveStdio(createServer);
