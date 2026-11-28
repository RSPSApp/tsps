const fs = require("fs");
const path = require("path");
const { Server } = require("../../src/main/typescript/elvarg/Server");
const { getWorldDefinition } = require("../../src/main/typescript/elvarg/game/definition/WorldDefinition");
const { listWarps } = require("./MapWarps");
const { readGroundItemEdits } = require("./GroundItemsEditor.plugin");
const { effectiveFile, readLayers } = require("./MapEditFiles");

function readTravelEditorResource(core, query, segments) {
  if (segments.length === 1 && segments[0] === "map-warps") return listWarps();
  if (segments.length === 1 && segments[0] === "object-travel") {
    const values = ["id", "x", "y", "z"].map(key => query.get(key));
    if (values.some(value => value === null || !/^\d+$/.test(value))) throw new Error("Invalid object location");
    const [id, x, y, z] = values.map(Number);
    if (!Number.isSafeInteger(id) || id > 0x7fffffff || x > 16383 || y > 16383 || z > 3) throw new Error("Invalid object location");
    core.RegionManager.loadMapFiles(x, y);
    const object = core.MapObjects.get(id, new core.Location(x, y, z), null);
    if (!object) return [];
    const actions = core.ObjectDefinition.forId(id)?.getInteractions?.() ?? [];
    const { travelDestinations } = require("../objects/Ladders.plugin");
    return actions.flatMap((actionLabel, index) => {
      if (!actionLabel) return [];
      const destinations = travelDestinations(object, actionLabel);
      return destinations.length ? [{ id, op: index + 1, from: [x, y, z], actionLabel, destinations, mapDerived: true }] : [];
    });
  }
  if (segments.length === 1 && segments[0] === "game-warps") {
    const file = path.join(__dirname, "data", "loc-teleports.json");
    const { locs } = JSON.parse(fs.readFileSync(file, "utf8"));
    return locs.map(({ id, x, y, z, op, name, to, sides, warn, ask, requires }) => ({
      id, from: [x, y, z], op, name,
      destinations: (to ? [to] : (sides ?? []).map((side) => side.to)).map((target) => ({ label: "Game destination", to: target })),
      conditional: Boolean(warn || ask || requires?.length),
    }));
  }
  return undefined;
}

function readWorldEditorResource(core, query, segments) {
  if (["map-warps", "game-warps", "object-travel"].includes(segments[0])) return readTravelEditorResource(core, query, segments);
  if (segments.length === 0) return getWorldDefinition();
  if (segments.length === 1 && segments[0] === "map-save-base") return { latest: readLayers().latest };
  if (segments.length === 1 && segments[0] === "ground-items-custom") return readGroundItemEdits();
  const file = segments[0] === "object-spawns" ? "object-spawns.json"
    : segments[0] === "npc-spawns" ? "npc-spawns.json"
    : segments[0] === "npc-spawns-custom" ? "npc-spawns-custom.json" : undefined;
  if (!file) return undefined;
  const full = effectiveFile(path.resolve(process.cwd(), "data/definitions", file));
  // The editor's spawn patch is optional until the first export.
  if (!full || !fs.existsSync(full)) return file === "npc-spawns-custom.json" ? [] : undefined;
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

/**
 * Supplies the standalone local map editor with the server's loaded world definition
 * (spawn, zones, disabled plugins etc) via GET /api/world.
 * Uses the existing game server HTTP port and content API, including ETag revalidation;
 * /api/world/object-spawns supplies the canonical JSON document for editing and
 * downloading locally. `/api/world/npc-spawns` serves the persisted NPC
 * spawns the editor renders, and `/api/world/npc-spawns-custom` serves the editor's
 * existing spawn patch (empty when none has been exported yet). All endpoints are read-only
 * and registered only in development, never in production. Browser-host editors
 * continue receiving world data through host messaging instead of this endpoint.
 */
module.exports = {
  name: "EditModeApi",
  description: "Serves public object travel lookups and development-only map editor world data over the content API.",
  register(api) {
    api.registerContentEndpoint("editor-travel", readTravelEditorResource.bind(null, api.core));
    if (Server.PRODUCTION) return;
    api.registerContentEndpoint("world", readWorldEditorResource.bind(null, api.core));
  },
};
