const fs = require("fs");
const path = require("path");
const { Server } = require("../../src/main/typescript/elvarg/Server");
const { getWorldDefinition } = require("../../src/main/typescript/elvarg/game/definition/WorldDefinition");
const { listTemplates, readTemplate } = require("../agent/mcp/MapTemplateFiles");
const { listWarps } = require("./MapWarps");
const { readGroundItemEdits } = require("./GroundItemsEditor.plugin");
const MapPlans = require("./MapPlans");
const { effectiveFile, readLayers } = require("./MapEditFiles");
const Landscape = require("./LandscapePlans");

function landscapeOptions(query, depth = 0) {
  const options = {};
  for (const key of ["x", "y", "width", "height", "seed", "relief", "foliage", "lakes", "edgeBlend"]) {
    if (query.has(key)) options[key] = Number(query.get(key));
  }
  for (const key of ["landform", "biome", "size"]) {
    if (query.has(key)) options[key] = query.get(key);
  }
  if (query.has("scenery")) options.scenery = query.get("scenery") === "true";
  if (query.has("extend")) options.extend = query.get("extend") === "true";
  if (query.has("squares")) options.squares = query.get("squares").split(",", 65).map(Number);
  const source = query.get("source");
  if (options.extend && source && depth < 2 && source.length <= 4096) {
    options.source = landscapeOptions(new URLSearchParams(source), depth + 1);
  }
  return options;
}

function readWorldEditorResource(core, query, segments) {
  if (segments.length === 0) return getWorldDefinition();
  if (segments.length === 1 && segments[0] === "map-save-base") return { latest: readLayers().latest };
  if (segments.length === 1 && segments[0] === "map-warps") return listWarps();
  if (segments.length === 1 && segments[0] === "ground-items-custom") return readGroundItemEdits();
  if (segments.length === 1 && segments[0] === "map-plans") return MapPlans.catalog();
  if (segments[0] === "landscapes") {
    if (segments.length === 1) return Landscape.catalog();
    try {
      if (segments[1] === "occupied") return Landscape.occupiedSquareIds(core);
      if (segments[1] === "scenery") {
        return Landscape.sampleBiome(core, query.get("biome")).scenery
          .filter(({ habitat }) => habitat !== "water").map(({ id, name }) => ({ id, name }));
      }
      if (segments[1] === "site") {
        const skip = new Set((query.get("skip") ?? "").split(",", 1024)
          .filter((id) => /^\d{1,5}$/.test(id)).map(Number));
        return Landscape.findEmptySite(core, landscapeOptions(query), skip);
      }
      if (["preview", "packs", "scene"].includes(segments[1])) {
        const plan = Landscape.planLandscape(core, landscapeOptions(query));
        const occupied = Landscape.occupiedRegions(core, plan);
        if (segments[1] === "preview") return { ...Landscape.overview(plan), occupied };
        if (segments[1] === "scene") {
          const packs = occupied.length ? [] : Landscape.buildPacks(core, plan)
            .map(({ regionId, pack }) => ({ regionId, data: pack.toString("base64") }));
          return { ...Landscape.overview(plan), occupied, packs };
        }
        if (occupied.length) throw new Error(`Choose empty map squares. Already used: ${occupied.join(", ")}`);
        return Landscape.buildPacks(core, plan).map(({ regionId, pack }) => ({ regionId, data: pack.toString("base64") }));
      }
    } catch (error) { return { error: String(error.message ?? error) }; }
  }
  if (segments.length === 2 && segments[0] === "map-plans" && segments[1] === "preview") {
    try { return MapPlans.preview(core, query); } catch (error) { return { error: String(error.message ?? error) }; }
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
  if (segments[0] === "templates") {
    if (segments.length === 1) return listTemplates();
    if (segments.length === 2) {
      try { return readTemplate(segments[1]); } catch { return undefined; }
    }
  }
  if (segments.length !== 1) return undefined;
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
  description: "Serves the local map editor read-only world data (zones, object and NPC spawns) over the content API, in development builds only.",
  register(api) {
    if (Server.PRODUCTION) return;
    api.registerContentEndpoint("world", readWorldEditorResource.bind(null, api.core));
  },
};
