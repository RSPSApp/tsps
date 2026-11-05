"use strict";

// The 2026 Easter scene: the event-active cache's own placements (the start set-piece
// south of the Grand Exchange and the eight hunt scenery swaps), the archived Easter
// Bunny and the vault Archibald. Everything here is installed when the window opens and
// restored exactly when it closes, a restart included. Pattern: Scene.ChristmasDinner.js.
const source = require("./data/easter-2026-archive.json");
const BUNDLE = "easter-2026";
// RSProx rev237 recordings 03988-04042: npc_info adds easter26_easter_bunny (15578) at
// 3159,3458,0 with spawnangle east (Wiki map pin 3159,3458).
const BUNNY = Object.freeze({ symbol: "easter26_easter_bunny", x: 3159, y: 3458, z: 0, face: "EAST" });
// No recording or coordinate source places the vault Archibald. The Wiki puts him in
// the Varrock West Bank basement "next to the gate" of the vault; this is the free
// anteroom tile beside the vault's rows of chests (3187-3196, 9818-9825).
const VAULT_EGG = Object.freeze({ symbol: "easter26_egg_last_spot", x: 3191, y: 9827, z: 0, face: "SOUTH" });
let scene = null;

function sameTile(object, row) {
  const p = object.getLocation();
  return p.getX() === row.x && p.getY() === row.y && p.getZ() === row.z && object.getType() === row.shape;
}
function globalObject(object) { return !object.getPrivateArea() && !object.getOwner(); }
function standingAt(core, row) {
  return [...(core.MapObjects.mapObjects.get(core.MapObjects.getHash(row.x, row.y, row.z)) ?? [])].filter(globalObject);
}
function install(api, bundles) {
  const request = { bundles };
  api.emitCustomEvent("definition-archives:install", request);
  if (!request.handled) throw new Error(request.error || "Easter definition archive installation was refused");
}
function bounds(object) {
  const p = object.getLocation(), definition = object.getDefinition();
  let width = definition?.getSizeX() ?? 1, height = definition?.getSizeY() ?? 1;
  if ((object.getFace() & 1) !== 0) [width, height] = [height, width];
  if (object.getType() <= 3) return { x: p.getX() - 1, y: p.getY() - 1, maxX: p.getX() + 1, maxY: p.getY() + 1, z: p.getZ() };
  return { x: p.getX(), y: p.getY(), maxX: p.getX() + width - 1, maxY: p.getY() + height - 1, z: p.getZ() };
}
function repairClipping(core, rows) {
  if (!rows.length) return;
  const affected = rows.flatMap(row => [row.object, ...row.normal]).filter(Boolean).map(bounds);
  // Clip masks are shared bits, so reapply standing geometry over the changed footprints.
  for (const objects of core.MapObjects.mapObjects.values()) for (const object of objects) {
    if (!globalObject(object)) continue;
    const box = bounds(object);
    if (affected.some(r => box.z === r.z && box.x <= r.maxX && box.maxX >= r.x && box.y <= r.maxY && box.maxY >= r.y)) {
      core.RegionManager.addObjectClipping(object);
    }
  }
}
function bundleFor(core) {
  const counts = core.CacheDefinitions.getCounts(), next = { npc: counts.npcs, loc: counts.objects, obj: counts.items };
  const bundle = JSON.parse(JSON.stringify(source.bundle));
  // Other activities may already occupy appended ids; the registry remaps the closed graph.
  for (const row of bundle.definitions) row.id = next[row.kind]++;
  return bundle;
}
function originals(core, row) {
  // Exactly the ordinary map rows the event row replaced in the event-active cache.
  return standingAt(core, row).filter(object => object.getLocation().getZ() === row.z &&
    row.replaces.some(rep => rep.id === object.getId() && rep.shape === object.getType() && rep.rotation === object.getFace()));
}
function plan(core) {
  return source.placements.map(row => {
    core.RegionManager.loadMapFiles(row.x, row.y, false);
    const region = core.RegionManager.getRegionid(core.RegionManager.regionIdForTile(row.x, row.y));
    if (!region?.isLoaded()) throw new Error("Original Easter scene region is not loaded");
    if (standingAt(core, row).some(object => sameTile(object, row) && !object.isMapOriginal())) {
      throw new Error("Runtime scenery occupies an original Easter tile");
    }
    const normal = originals(core, row);
    if (normal.length !== row.replaces.length) throw new Error("Native scenery differs at an Easter tile " + row.x + "," + row.y + "," + row.z);
    return { ...row, location: new core.Location(row.x, row.y, row.z), normal };
  });
}
function spawn(api, row) {
  const id = api.core.CacheDefinitions.getArchivedId(BUNDLE, "npc", row.symbol);
  if (id === null) throw new Error("Missing archived Easter NPC " + row.symbol);
  return api.spawnNpc({ id, x: row.x, y: row.y, z: row.z, wanderRadius: 0,
    face: api.core.Direction[row.face].getId(), unique: "easter-events:" + row.symbol });
}

function open(api) {
  const c = api.core;
  if (scene) return { handled: scene.ready };
  try {
    const existing = [...c.CacheDefinitions.getDefinitionArchiveBundles()];
    if (existing.some(bundle => bundle.id === BUNDLE)) throw new Error("Another owner has installed the Easter archive");
    const rows = plan(c), bundle = bundleFor(c);
    c.CacheDefinitions.getDefinitionArchiveChanges([...existing, bundle]);
    install(api, [...existing, bundle]);
    scene = { bundle, rows: [], npcs: [], ready: false };
    for (const row of rows) {
      const object = new c.GameObject(row.id, row.location, row.shape, row.rotation, null);
      scene.rows.push({ ...row, object });
      for (const original of row.normal) c.ObjectManager.deregister(original, true);
      c.ObjectManager.register(object, true);
    }
    repairClipping(c, scene.rows);
    scene.npcs.push(spawn(api, BUNNY), spawn(api, VAULT_EGG));
    scene.ready = true;
    return { handled: true };
  } catch (error) {
    if (scene) {
      const cleanup = close(api);
      if (!cleanup.handled) return { handled: false, error: error.message + "; cleanup: " + cleanup.error };
    }
    return { handled: false, error: error.message };
  }
}

function close(api) {
  if (!scene) return { handled: true };
  const c = api.core;
  try {
    scene.ready = false;
    for (const npc of scene.npcs) if (npc) api.removeNpc(npc);
    scene.npcs = [];
    // Deregister while the archived types still exist, then put back the exact originals.
    for (const row of scene.rows) if (c.World.getObjects().includes(row.object)) c.ObjectManager.deregister(row.object, true);
    for (const row of scene.rows) for (const original of row.normal) {
      if (c.MapObjects.get(original.getId(), original.getLocation(), null) !== original) c.ObjectManager.register(original, true);
    }
    repairClipping(c, scene.rows);
    install(api, c.CacheDefinitions.getDefinitionArchiveBundles().filter(bundle => bundle.id !== BUNDLE));
    scene = null;
    return { handled: true };
  } catch (error) {
    return { handled: false, error: error.message };
  }
}

function replay(api, { regionId }) {
  if (!scene?.ready) return { handled: true };
  const c = api.core, rows = scene.rows.filter(row => c.RegionManager.regionIdForTile(row.x, row.y) === regionId);
  // A reloaded region recreates its native objects; take them down again and replay ours.
  for (const row of rows) {
    for (const object of standingAt(c, row)) {
      if (object === row.object || !object.isMapOriginal()) continue;
      if (row.replaces.some(rep => rep.id === object.getId() && rep.shape === object.getType() && rep.rotation === object.getFace())) {
        c.ObjectManager.deregister(object, true);
      }
    }
    if (!c.World.getObjects().includes(row.object)) c.ObjectManager.register(row.object, true);
  }
  repairClipping(c, rows);
  return { handled: true };
}

function active() { return scene?.ready === true; }
function npcId(api, symbol) { return api.core.CacheDefinitions.getArchivedId(BUNDLE, "npc", symbol); }
function isNpc(api, npc, symbol) { return active() && npc && scene.npcs.includes(npc) && npc.getId() === npcId(api, symbol); }

module.exports = { BUNDLE, BUNNY, VAULT_EGG, open, close, replay, active, npcId, isNpc, source };
