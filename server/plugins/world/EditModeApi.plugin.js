const fs = require("fs");
const path = require("path");
const { Server } = require("../../src/main/typescript/elvarg/Server");
const { getWorldDefinition } = require("../../src/main/typescript/elvarg/game/definition/WorldDefinition");

/**
 * Supplies the standalone local map editor with the server's loaded world definition
 * (spawn, zones, disabled plugins etc) via GET /api/world.
 * Uses the existing game server HTTP port and content API, including ETag revalidation;
 * /api/world/object-spawns supplies the canonical JSON document for editing and
 * downloading locally. `/api/world/npc-spawns` serves the persisted NPC
 * spawns the editor renders, and `/api/world/npc-spawns-custom` serves the editor's
 * existing spawn patch (empty when none has been exported yet). All endpoints are read-only
 * and is registered only in development, never in production. Browser-host editors
 * continue receiving world data through host messaging instead of this endpoint.
 */
module.exports = {
  name: "EditModeApi",
  register(api) {
    if (Server.PRODUCTION) return;
    api.registerContentEndpoint("world", (_query, segments) => {
      if (segments.length === 0) return getWorldDefinition();
      if (segments.length !== 1) return undefined;
      const file = segments[0] === "object-spawns" ? "object-spawns.json"
        : segments[0] === "npc-spawns" ? "npc-spawns.json"
        : segments[0] === "npc-spawns-custom" ? "npc-spawns-custom.json" : undefined;
      if (!file) return undefined;
      const full = path.resolve(process.cwd(), "data/definitions", file);
      // The editor's spawn patch is optional until the first export.
      if (!fs.existsSync(full)) return file === "npc-spawns-custom.json" ? [] : undefined;
      return JSON.parse(fs.readFileSync(full, "utf8"));
    });
  },
};
