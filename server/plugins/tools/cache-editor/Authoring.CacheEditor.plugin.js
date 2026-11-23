// Local authoring service for the cache editor, on its own loopback port. Game content endpoints stay
// read-only; this is the only writable surface, and it only opens when explicitly enabled.
//
// The guards are the ones the item editor's authoring service already established: loopback bind, an
// origin allow-list matched to the local client, a bounded body, and an atomic replace of a canonical
// document. Saving never touches the cache — it writes overlay rows and asks for a restart.
//
// It also hosts the Model Extractor (Extract.CacheEditor.cjs): what extracting a definition writes,
// writing it into data/models for the Blender add-ons, an NPC's animations and an animation's bodies.
// Those read files and write folders, so they belong here, not on the public content endpoints.
const http = require("node:http");
const path = require("node:path");
const Document = require("./Document.CacheEditor.cjs");
const Assets = require("./Assets.CacheEditor.cjs");
const { createExtract } = require("./Extract.CacheEditor.cjs");

/** Upload bodies: an animation folder is up to 1 MiB of files, as base64 in JSON. */
const UPLOAD_LIMIT = 3 * 1024 * 1024;

function createAuthoring(core, root) {
  const snapshot = () => Document.snapshot(root);
  const extract = createExtract(core, root);

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

  async function bodyOf(request, limit) {
    if (!request.headers["content-type"]?.startsWith("application/json")) throw Object.assign(new Error("Send JSON"), { status: 405 });
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > limit) throw Object.assign(new Error("Upload is too large"), { status: 413 });
    }
    return JSON.parse(body);
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
    const send = (value) => response.end(JSON.stringify(value));
    const notAllowed = () => {
      response.writeHead(405);
      response.end();
    };
    try {
      const url = new URL(request.url, "http://localhost");
      const route = url.pathname;
      const query = url.searchParams;
      // Uploads: base64 in JSON, or a path under data/models (the asset library), validated by kind (a
      // model must carry its version trailer, an animation's frames must decode), stored
      // content-addressed so the same bytes are one file and one row.
      if (route === "/assets") {
        if (request.method === "GET") return send({ assets: Assets.assetsOf(root), revision: Document.revision(Document.read(root)) });
        if (request.method !== "POST") return notAllowed();
        const payload = await bodyOf(request, UPLOAD_LIMIT);
        if (payload.rename) return send(Assets.renameAsset(root, payload, core));
        return send(Assets.addAsset(root, payload, core));
      }
      // The asset library: the add-ons' exports under data/models that can be imported, by kind.
      if (route === "/library") {
        if (request.method !== "GET") return notAllowed();
        const kind = query.get("kind") || "model";
        return send({ kind, entries: Assets.library(root, kind) });
      }
      // An asset written back to data/models/<folder>/ for Blender.
      if (route === "/assets/export") {
        if (request.method !== "POST") return notAllowed();
        const payload = await bodyOf(request, 64 * 1024);
        return send(Assets.exportAsset(root, payload));
      }
      if (route === "/extract") {
        if (request.method === "GET") return send(extract.details(query.get("kind"), query.get("id")));
        if (request.method !== "POST") return notAllowed();
        const payload = await bodyOf(request, 64 * 1024);
        return send(extract.extract(payload.kind, payload.id, payload.folder, payload.overwrite));
      }
      if (route === "/npc-animations") {
        if (request.method !== "GET") return notAllowed();
        return send(await extract.npcAnimations(query.get("id")));
      }
      if (route === "/animation-bodies") {
        if (request.method !== "GET") return notAllowed();
        return send(await extract.bodies(query.get("id")));
      }
      if (route !== "/definitions") {
        response.writeHead(404);
        response.end();
        return;
      }
      if (request.method === "GET") return send(snapshot());
      if (request.method !== "POST") return notAllowed();
      const payload = await bodyOf(request, 1024 * 1024).catch((failure) => {
        throw failure.status === 413 ? new Error("Definition is too large") : failure;
      });
      send(Document.save(core, root, payload));
    } catch (error) {
      response.statusCode = error.status || 400;
      response.end(JSON.stringify({ error: error.message, ...(error.code ? { code: error.code } : {}) }));
    }
  }

  return { handle, snapshot };
}

function startup(apiCore) {
  // Opening a write service is an explicit local development choice.
  if (process.env.CACHE_EDITOR_ENABLED !== "1" || process.env.BROWSER_HOST === "1") return;
  const root = path.resolve(__dirname, "../../..");
  const { handle } = createAuthoring(apiCore, root);
  const port = Number(process.env.WEBSOCKET_PORT || 43594) + 1101;
  const server = http.createServer(handle);
  server.on("error", (error) => console.error("[cache-editor] Local saving unavailable:", error.message));
  server.listen(port, "127.0.0.1", () => console.log(`[cache-editor] Local authoring service :${port}`));
}

module.exports = {
  name: "CacheEditorAuthoring",
  description: "Opens a loopback-only writable service for the cache editor that saves overlay rows and uploads, imports the Blender add-ons' exports and extracts cache models, animations and graphics, only when explicitly enabled for local development.",
  register(api) {
    api.onServerStartup(startup.bind(null, api.core));
  },
  createAuthoring,
};
