const http = require("http");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { createContext } = require("./mcp/Context.AgentMcp");

// Lets an MCP client (Claude Code, etc.) drive an online player for testing. Actions are
// injected as the same decoded client messages a real client produces, so they run through
// the normal ClientConnection dispatch; the player's own web client keeps rendering it all.
// The login tool brings a player online with no client at all, for testing without a browser.
//   AGENT_MCP=1 yarn dev   (optional AGENT_MCP_PORT, default 49700)
//   claude mcp add --transport http tsps http://127.0.0.1:49700/mcp
// Tools live in ./mcp/, one file per area.

const DEFAULT_PORT = 49700;
let httpServer = null;

function buildMcpServer(core) {
  const server = new McpServer({ name: "tsps-agent", version: "1.0.0" });
  const ctx = createContext(core, server);
  require("./mcp/Session.AgentMcp")(ctx);
  require("./mcp/World.AgentMcp")(ctx);
  require("./mcp/Dialogue.AgentMcp")(ctx);
  require("./mcp/Bank.AgentMcp")(ctx);
  require("./mcp/Shop.AgentMcp")(ctx);
  require("./mcp/Social.AgentMcp")(ctx);
  return server;
}

async function handleRequest(core, port, request, response) {
  if (!request.url?.startsWith("/mcp")) {
    response.statusCode = 404;
    response.end();
    return;
  }
  // Stateless: a fresh server per request, players are named on every tool call.
  const server = buildMcpServer(core);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
  });
  response.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    console.warn("[agent-mcp] request failed", error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.end();
    }
  }
}

function startMcpServer(api) {
  if (process.env.AGENT_MCP !== "1") return;
  const port = Number(process.env.AGENT_MCP_PORT) || DEFAULT_PORT;
  httpServer = http.createServer((request, response) => handleRequest(api.core, port, request, response));
  httpServer.on("error", (error) => console.error("[agent-mcp] server error", error.message));
  // Localhost only: anyone who can reach this can drive any online player.
  httpServer.listen(port, "127.0.0.1", () =>
    console.info(`[agent-mcp] listening on http://127.0.0.1:${port}/mcp`));
}

function stopMcpServer() {
  httpServer?.close();
  httpServer = null;
}

module.exports = {
  name: "AgentMcp",
  buildMcpServer,
  register(api) {
    startMcpServer(api);
    api.onServerShutdown(stopMcpServer);
  },
};
