const fs = require("fs");
const path = require("path");
const { hasToken, tokenMatches, hostAllowed, originAllowed, sessionCookie } = require("./Access.WorldAdmin");

// Routing, body parsing and input checks for the WorldAdmin listener. What each route does
// lives in WorldAdmin.plugin.js (`actions`); this file never touches world config itself.

const MAX_BODY_BYTES = 1024 * 1024;
const PAGE_FILE = path.join(__dirname, "page.html");
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const CHANGE_SECTIONS = new Set(["world", "plugins", "pluginConfig"]);

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function rejectForbiddenKeys(value, where) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => rejectForbiddenKeys(item, `${where}[${i}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new HttpError(400, `key "${key}" is not allowed (${where})`);
    rejectForbiddenKeys(value[key], `${where}.${key}`);
  }
}

/**
 * `changes` as WorldConfigStore.plan expects it: plain objects all the way, no prototype keys,
 * and `changes.world` only the declared world settings (`worldSettingKeys`).
 */
function checkChanges(changes, worldSettingKeys) {
  if (!isPlainObject(changes)) throw new HttpError(400, "changes must be an object");
  rejectForbiddenKeys(changes, "changes");
  for (const [section, map] of Object.entries(changes)) {
    if (!CHANGE_SECTIONS.has(section)) throw new HttpError(400, `changes.${section} is not a known section`);
    if (!isPlainObject(map)) throw new HttpError(400, `changes.${section} must be an object`);
  }
  for (const key of Object.keys(changes.world ?? {})) {
    if (!worldSettingKeys.has(key)) throw new HttpError(400, `changes.world.${key} is not a world setting`);
  }
  return changes;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      request.resume();
      reject(new HttpError(413, "request body too large"));
      return;
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, "request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

async function readJson(request) {
  const contentType = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new HttpError(415, "Content-Type must be application/json");
  const text = await readBody(request);
  if (text.trim() === "") return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
  if (!isPlainObject(body)) throw new HttpError(400, "body must be an object");
  rejectForbiddenKeys(body, "body");
  return body;
}

function send(response, status, body, headers = {}) {
  const isText = typeof body === "string";
  response.writeHead(status, {
    ...BASE_HEADERS,
    "Content-Type": isText ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
  });
  response.end(isText ? body : JSON.stringify(body));
}

function sendPage(response) {
  let html;
  try {
    html = fs.readFileSync(PAGE_FILE);
  } catch {
    send(response, 404, "The world config page is not built yet.");
    return;
  }
  response.writeHead(200, { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

/**
 * `access`: { token, port(), loopback }. `actions`: catalog(), preview(body), apply(body),
 * cancel(); each returns { status, body, afterResponse? } (afterResponse runs once the response
 * has been sent). `worldSettingKeys`: the keys `changes.world` may carry.
 */
function createRequestHandler(access, actions, worldSettingKeys) {
  const allowedWorldKeys = new Set(worldSettingKeys);
  async function route(request, response) {
    const port = access.port();
    if (!hostAllowed(request, port, access.loopback)) {
      send(response, 403, { error: "Host not allowed" });
      return;
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";

    if (method === "GET" && url.pathname === "/" && url.searchParams.has("token")) {
      if (!tokenMatches(url.searchParams.get("token"), access.token)) {
        send(response, 401, { error: "Unauthorized" });
        return;
      }
      send(response, 302, "", { Location: "/", "Set-Cookie": sessionCookie(access.token, port) });
      return;
    }
    if (!hasToken(request, access.token, port)) {
      send(response, 401, { error: "Unauthorized" });
      return;
    }

    if (url.pathname === "/") {
      if (method !== "GET") throw new HttpError(405, "Method not allowed");
      sendPage(response);
      return;
    }
    if (url.pathname === "/api/catalog") {
      if (method !== "GET") throw new HttpError(405, "Method not allowed");
      const result = actions.catalog();
      send(response, result.status, result.body);
      return;
    }
    const post = { "/api/preview": "preview", "/api/apply": "apply", "/api/cancel": "cancel" }[url.pathname];
    if (!post) throw new HttpError(404, "Not found");
    if (method !== "POST") throw new HttpError(405, "Method not allowed");
    if (!originAllowed(request)) throw new HttpError(403, "Cross-origin request refused");
    const body = await readJson(request);
    if (post !== "cancel") {
      checkChanges(body.changes, allowedWorldKeys);
      if (typeof body.localHash !== "string") throw new HttpError(400, "localHash must be a string");
    }
    const result = actions[post](body);
    if (result.afterResponse) {
      // 'finish' once the response is sent; 'close' too, so an aborted request still restarts.
      let ran = false;
      const run = () => {
        if (ran) return;
        ran = true;
        result.afterResponse();
      };
      response.once("finish", run);
      response.once("close", run);
    }
    send(response, result.status, result.body);
  }

  return function handleRequest(request, response) {
    route(request, response).catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof HttpError) {
        send(response, error.status, { error: error.message }, error.status === 413 ? { Connection: "close" } : {});
        return;
      }
      console.error(`[world-admin] request failed: ${error?.message ?? error}`);
      send(response, 500, { error: "Internal error; see the server log" });
    });
  };
}

module.exports = { createRequestHandler, HttpError, MAX_BODY_BYTES };
