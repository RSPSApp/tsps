#!/usr/bin/env node
/**
 * Model Extractor: a page for finding items, NPCs and objects in the local OSRS cache by id or
 * name and saving their models as .dat files under server/data/models/<folder>/.
 *
 *   cd server && yarn build && yarn models
 *
 * Separate from the game server, the local panel and the cache editor: it only reads the cache
 * and writes into data/models. It listens on 127.0.0.1 only (MODEL_EXTRACTOR_PORT, default
 * 4790) and opens the page in your browser (MODEL_EXTRACTOR_OPEN=0 to skip that).
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { ModelExtractor, KINDS, fileRows } = require("./ModelExtractor.cjs");
const { buildDecoder } = require("./decoder.cjs");

const SERVER_DIR = path.resolve(__dirname, "..", "..");
const PAGE = path.join(__dirname, "page.html");
const PREVIEW = path.join(__dirname, "preview.js");
const MAX_BODY = 16 * 1024;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Request too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/** Only this page, on this machine: other sites can't call the API (Host and Origin checks). */
function allowed(request, port) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(String(request.headers.host ?? ""))) return false;
  const origin = request.headers.origin;
  return origin === undefined || hosts.some((host) => origin === `http://${host}`);
}

function kindOf(value) {
  if (!KINDS.includes(value)) throw Object.assign(new Error(`kind must be one of ${KINDS.join(", ")}`), { status: 400 });
  return value;
}

function idOf(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 0) throw Object.assign(new Error("id must be a whole number"), { status: 400 });
  return id;
}

/** `decoder` is buildDecoder's result: the page's preview script, or why there is none. */
function createHandler(extractor, port, decoder = { error: "No preview decoder" }) {
  return async (request, response) => {
    try {
      if (!allowed(request, port)) return json(response, 403, { error: "Forbidden" });
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(fs.readFileSync(PAGE));
        return;
      }
      if (request.method === "GET" && url.pathname === "/preview.js") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        response.end(fs.readFileSync(PREVIEW));
        return;
      }
      if (request.method === "GET" && url.pathname === "/decoder.js") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        response.end(decoder.code ?? `var OsrsModel = null; var OsrsModelError = ${JSON.stringify(decoder.error)};`);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/model") {
        const bytes = extractor.modelBytes(idOf(url.searchParams.get("id")));
        if (!bytes) return json(response, 404, { error: "That model isn't in the cache" });
        response.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" });
        response.end(bytes);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/search") {
        const kind = kindOf(url.searchParams.get("kind"));
        const results = extractor.search(kind, url.searchParams.get("q"), { includeVariants: url.searchParams.get("variants") === "1" });
        return json(response, 200, { results });
      }
      if (request.method === "GET" && url.pathname === "/api/details") {
        const details = extractor.details(kindOf(url.searchParams.get("kind")), idOf(url.searchParams.get("id")));
        const { infos, ...shown } = details;
        return json(response, 200, { ...shown, rows: fileRows(details.files), exists: fs.existsSync(path.join(extractor.modelsDir, details.folder)) });
      }
      if (request.method === "GET" && url.pathname === "/api/npc-animations") {
        await extractor.animations.warm();
        return json(response, 200, extractor.animations.npcAnimations(idOf(url.searchParams.get("id"))));
      }
      if (request.method === "GET" && url.pathname === "/api/bodies") {
        await extractor.animations.warm();
        return json(response, 200, extractor.animations.animationBodies(idOf(url.searchParams.get("id"))));
      }
      if (request.method === "GET" && url.pathname === "/api/body") {
        return json(response, 200, extractor.animations.body(String(url.searchParams.get("kind")), idOf(url.searchParams.get("id"))));
      }
      if (request.method === "GET" && url.pathname === "/api/animation") {
        return json(response, 200, extractor.animations.animation(idOf(url.searchParams.get("id"))));
      }
      if (request.method === "GET" && url.pathname === "/api/folder") {
        const folder = String(url.searchParams.get("name") ?? "");
        return json(response, 200, { exists: fs.existsSync(extractor.folderPath(folder)) });
      }
      if (request.method === "POST" && url.pathname === "/api/extract") {
        if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) return json(response, 415, { error: "Send JSON" });
        const body = JSON.parse(await readBody(request));
        const result = extractor.extract(kindOf(body.kind), idOf(body.id), String(body.folder ?? ""), { overwrite: body.overwrite === true });
        return json(response, 200, {
          folder: result.folder,
          path: path.relative(path.dirname(SERVER_DIR), result.directory).split(path.sep).join("/"),
          written: result.written,
        });
      }
      return json(response, 404, { error: "Not found" });
    } catch (error) {
      const status = error.status ?? (error.code === "EXISTS" ? 409 : 400);
      return json(response, status, { error: error.message, code: error.code ?? null });
    }
  };
}

function openBrowser(url) {
  const [command, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Opening is a convenience; the URL is printed either way.
  }
}

async function main() {
  process.chdir(SERVER_DIR);
  const port = Number(process.env.MODEL_EXTRACTOR_PORT ?? 4790);
  console.log("[model-extractor] loading the cache...");
  const extractor = await new ModelExtractor(SERVER_DIR).open();
  const decoder = buildDecoder(path.dirname(SERVER_DIR));
  if (decoder.error) console.warn(`[model-extractor] no preview: ${decoder.error}`);
  const server = http.createServer(createHandler(extractor, port, decoder));
  server.on("error", (error) => {
    console.error(error.code === "EADDRINUSE"
      ? `[model-extractor] port ${port} is in use: set MODEL_EXTRACTOR_PORT to another one`
      : `[model-extractor] ${error.message}`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}/`;
    console.log(`[model-extractor] open ${url} (Ctrl+C to stop)`);
    console.log(`[model-extractor] files go to ${extractor.modelsDir}`);
    if (process.env.MODEL_EXTRACTOR_OPEN !== "0") openBrowser(url);
    // NPC animation lists and animation previews need every animation's skeleton; read them now.
    extractor.animations.warm().catch((error) => console.warn(`[model-extractor] couldn't index animations: ${error.message}`));
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[model-extractor] ${error.message}`);
    process.exit(1);
  });
}

module.exports = { createHandler, allowed };
