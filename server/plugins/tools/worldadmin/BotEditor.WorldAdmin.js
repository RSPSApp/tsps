"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { FILE: botEditorFile, readActivities, validateActivities } = require("../../bots/brain/Editor.PlayerBots");
const { originAllowed } = require("./Access.WorldAdmin");
const { HttpError, send, readJson } = require("./Http.WorldAdmin");

async function botEditorRoutes(request, response, url) {
  if (url.pathname === "/api/bot-editor-search") {
    if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
    const text = (url.searchParams.get("text") ?? "").trim();
    if (!text || text.length > 100) throw new HttpError(400, "Enter 1–100 characters to search.");
    const kind = url.searchParams.get("kind") ?? "item";
    if (!["item", "loc"].includes(kind)) throw new HttpError(400, "Unsupported search kind.");
    const query = new URLSearchParams({ kind, text, limit: "20" });
    try {
      const port = Number(process.env.WEBSOCKET_PORT || 43594);
      const result = await fetch(`http://127.0.0.1:${port}/api/cache-search?${query}`, { signal: AbortSignal.timeout(5000) });
      if (!result.ok) throw new Error("cache search unavailable");
      send(response, 200, await result.json());
    } catch { throw new HttpError(503, "Gameval search needs the game server and CacheEditorCatalog plugin running."); }
    return true;
  }
  if (url.pathname === "/api/bot-editor-validate") {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    if (!originAllowed(request)) throw new HttpError(403, "Cross-origin request refused");
    const body = await readJson(request);
    try {
      const result = Object.hasOwn(body, "activities")
        ? { activities: validateActivities(body.activities) }
        : { activity: validateActivities([body.activity])[0] };
      send(response, 200, result);
    } catch (error) { throw new HttpError(400, error.message); }
    return true;
  }
  if (url.pathname === "/api/bot-editor") {
    const current = readActivities();
    const hash = crypto.createHash("sha256").update(JSON.stringify(current)).digest("hex");
    if (request.method === "GET") { send(response, 200, { activities: current, hash }); return true; }
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    if (!originAllowed(request)) throw new HttpError(403, "Cross-origin request refused");
    const body = await readJson(request);
    const latestHash = crypto.createHash("sha256").update(JSON.stringify(readActivities())).digest("hex");
    if (body.hash !== latestHash) throw new HttpError(409, "Activities changed elsewhere. Reload before saving.");
    let activities;
    try { activities = validateActivities(body.activities); } catch (error) { throw new HttpError(400, error.message); }
    const temporary = botEditorFile + ".tmp";
    try { fs.writeFileSync(temporary, JSON.stringify(activities, null, 2) + "\n"); fs.renameSync(temporary, botEditorFile); }
    finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; } }
    send(response, 200, { activities, hash: crypto.createHash("sha256").update(JSON.stringify(activities)).digest("hex") });
    return true;
  }
  return false;
}

module.exports = { botEditorRoutes };
