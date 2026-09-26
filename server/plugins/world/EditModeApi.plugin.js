const fs = require("fs");
const path = require("path");
const { Server } = require("../../src/main/typescript/elvarg/Server");
const { getWorldDefinition } = require("../../src/main/typescript/elvarg/game/definition/WorldDefinition");

/**
 * Supplies the standalone local map editor with the server's loaded world definition
 * (spawn, zones, disabled plugins etc) via GET /api/world.
 * Uses the existing game server HTTP port and content API, including ETag revalidation;
 * /api/world/shops and /api/world/npc-interactions supply canonical JSON documents
 * for editing and downloading locally. All endpoints are read-only
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
      const file = segments[0] === "shops" ? "shops.json"
        : segments[0] === "npc-interactions" ? "npc-interactions.json" : undefined;
      if (file) return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/definitions", file), "utf8"));
    });
  },
};
