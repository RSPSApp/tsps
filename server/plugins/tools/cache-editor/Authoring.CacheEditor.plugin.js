// Local authoring service for the cache editor, on its own loopback port. Game content endpoints stay
// read-only; this is the only writable surface, and it only opens when explicitly enabled.
//
// The guards are the ones the item editor's authoring service already established: loopback bind, an
// origin allow-list matched to the local client, a bounded body, and an atomic replace of a canonical
// document. Saving never touches the cache — it writes overlay rows and asks for a restart.
const http = require("node:http");
const path = require("node:path");
const Document = require("./Document.CacheEditor.cjs");
const Assets = require("./Assets.CacheEditor.cjs");

function createAuthoring(core, root) {
  const snapshot = () => Document.snapshot(root);

  function allowedOrigin(origin) {
    try {
      const url = new URL(origin);
      return url.protocol === "http:"
        && ["localhost", "127.0.0.1"].includes(url.hostname)
        && url.port === String(process.env.PORT || 3000);
    } catch {
      return false;
    }
  }

  async function handle(request, response) {
    const origin = request.headers.origin;
    if (!allowedOrigin(origin)) {
      response.writeHead(403);
      response.end();
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    try {
      const route = request.url.split("?")[0];
      // Uploads: base64 in JSON, validated by kind (a model must carry its version trailer), stored
      // content-addressed so the same bytes are one file and one row.
      if (route === "/assets") {
        if (request.method === "GET") {
          response.end(JSON.stringify({ assets: Assets.assetsOf(root), revision: Document.revision(Document.read(root)) }));
          return;
        }
        if (request.method !== "POST" || !request.headers["content-type"]?.startsWith("application/json")) {
          response.writeHead(405);
          response.end();
          return;
        }
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 3 * 1024 * 1024) throw Object.assign(new Error("Upload is too large"), { status: 413 });
        }
        const payload = JSON.parse(body);
        if (payload.rename) {
          response.end(JSON.stringify(Assets.renameAsset(root, payload)));
          return;
        }
        response.end(JSON.stringify(Assets.addAsset(root, payload)));
        return;
      }
      if (request.url !== "/definitions") {
        response.writeHead(404);
        response.end();
        return;
      }
      if (request.method === "GET") {
        response.end(JSON.stringify(snapshot()));
        return;
      }
      if (request.method !== "POST" || !request.headers["content-type"]?.startsWith("application/json")) {
        response.writeHead(405);
        response.end();
        return;
      }
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 1024 * 1024) throw new Error("Definition is too large");
      }
      response.end(JSON.stringify(Document.save(core, root, JSON.parse(body))));
    } catch (error) {
      response.statusCode = error.status || 400;
      response.end(JSON.stringify({ error: error.message }));
    }
  }

  return { handle, snapshot };
}

function startup(apiCore) {
  // Opening a write service is an explicit local development choice.
  if (process.env.CACHE_EDITOR_ENABLED !== "1" || process.env.BROWSER_HOST === "1") return;
  const root = path.resolve(__dirname, "../../../..");
  const { handle } = createAuthoring(apiCore, root);
  const port = Number(process.env.WEBSOCKET_PORT || 43594) + 1101;
  const server = http.createServer(handle);
  server.on("error", (error) => console.error("[cache-editor] Local saving unavailable:", error.message));
  server.listen(port, "127.0.0.1", () => console.log(`[cache-editor] Local authoring service :${port}`));
}

module.exports = {
  name: "CacheEditorAuthoring",
  register(api) {
    api.onServerStartup(startup.bind(null, api.core));
  },
  createAuthoring,
};
