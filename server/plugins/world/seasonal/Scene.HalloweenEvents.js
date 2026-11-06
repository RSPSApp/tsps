"use strict";

// Installs the 2025 Halloween scene for the event window and restores the world
// exactly on close: the archived NPC/item definitions, the event map's seasonal
// scenery at Fred's and Groats' farms (with the current scenery it displaced) and
// the wandering spooky chairs. Mirrors Scene.ChristmasDinner's ownership checks.
const source = require("./data/halloween-2025-archive.json");
const scene = require("./data/halloween-2025-scene.json");
const { BUNDLE } = require("./Progress.HalloweenEvents");
let state = null;

function sameTile(object, row) {
  const p = object.getLocation();
  return p.getX() === row.x && p.getY() === row.y && p.getZ() === row.z && object.getType() === row.shape;
}
function globalObject(object) { return !object.getPrivateArea() && !object.getOwner(); }
function standing(core, row) {
  return [...(core.MapObjects.mapObjects.get(core.MapObjects.getHash(row.x, row.y, row.z)) ?? [])];
}
function foreignOnTile(core, row, owned) {
  return core.ObjectManager.objectsAt(new core.Location(row.x, row.y, row.z))
    .some(object => globalObject(object) && sameTile(object, row) && !owned.has(object));
}
function install(api, bundles) {
  const request = { bundles };
  api.emitCustomEvent("definition-archives:install", request);
  if (!request.handled) throw new Error(request.error || "Halloween definition archive installation was refused");
}
function bundleFor(core) {
  const counts = core.CacheDefinitions.getCounts(), next = { npc: counts.npcs, loc: counts.objects, obj: counts.items };
  const bundle = JSON.parse(JSON.stringify(source.bundle));
  // Other activities may already occupy appended ids; the registry remaps the graph.
  for (const row of bundle.definitions) if (row.expectedCurrentCrc === undefined) row.id = next[row.kind]++;
  return bundle;
}
function bounds(object) {
  const p = object.getLocation(), definition = object.getDefinition();
  let width = definition?.getSizeX() ?? 1, height = definition?.getSizeY() ?? 1;
  if ((object.getFace() & 1) !== 0) [width, height] = [height, width];
  if (object.getType() <= 3) return { x: p.getX() - 1, y: p.getY() - 1, maxX: p.getX() + 1, maxY: p.getY() + 1, z: p.getZ() };
  return { x: p.getX(), y: p.getY(), maxX: p.getX() + width - 1, maxY: p.getY() + height - 1, z: p.getZ() };
}
function repairClipping(core, objects) {
  if (!objects.length) return;
  const affected = objects.map(bounds);
  // Clip masks are shared OR bits: reapply standing geometry over changed footprints.
  for (const list of core.MapObjects.mapObjects.values()) for (const object of list) {
    if (!globalObject(object)) continue;
    const box = bounds(object);
    if (affected.some(r => box.z === r.z && box.x <= r.maxX && box.maxX >= r.x && box.y <= r.maxY && box.maxY >= r.y)) {
      core.RegionManager.addObjectClipping(object);
    }
  }
}
function locId(core, row) {
  return row.archived ? core.CacheDefinitions.getArchivedId(BUNDLE, "loc", row.symbol) : row.sourceId;
}
function placeAll(api, rows) {
  const c = api.core, changed = [];
  for (const row of rows) {
    for (const original of row.originals) {
      if (c.MapObjects.get(original.getId(), original.getLocation(), null) === original) c.ObjectManager.deregister(original, true);
      changed.push(original);
    }
    if (row.object) { c.ObjectManager.register(row.object, true); changed.push(row.object); }
  }
  repairClipping(c, changed);
}
function spawnChairs(api) {
  const c = api.core, npcs = [];
  const event = c.CacheDefinitions.getArchivedId(BUNDLE, "npc", "hw25_chair_npc_event");
  const seth = c.CacheDefinitions.getArchivedId(BUNDLE, "npc", "hw25_chair_seth");
  if (event === null || seth === null) throw new Error("Missing archived spooky chair actors");
  const rows = [
    ...scene.eventChairs.map(([x, y]) => ({ id: event, x, y, z: 0, wanderRadius: scene.eventChairWander })),
    { id: seth, x: scene.sethChair.x, y: scene.sethChair.y, z: scene.sethChair.z, wanderRadius: scene.sethChair.wander },
  ];
  for (const [index, row] of rows.entries()) {
    const npc = api.spawnNpc({ ...row, unique: "halloween-2025:chair-" + index });
    if (!npc) throw new Error("Could not create a spooky chair");
    npc.__skipDefaultRespawn = true;
    npcs.push(npc);
    if (!npc.isRegistered()) throw new Error("No world capacity for the spooky chairs");
  }
  return npcs;
}

function open(api) {
  const c = api.core;
  if (state) return state.ready ? { handled: true } : { handled: false, error: "The previous Halloween scene needs cleanup" };
  try {
    const existing = [...c.CacheDefinitions.getDefinitionArchiveBundles()];
    if (existing.some(bundle => bundle.id === BUNDLE)) throw new Error("Another owner has installed the Halloween archive");
    const displaced = source.displaced.map(row => ({ ...row, removeOnly: true }));
    const plan = [...source.placements, ...displaced].map(row => {
      c.RegionManager.loadMapFiles(row.x, row.y, false);
      const region = c.RegionManager.getRegionid(c.RegionManager.regionIdForTile(row.x, row.y));
      if (!region?.isLoaded()) throw new Error("A Halloween scene region is not loaded");
      if (c.World.getRemovedObjects().some(object => globalObject(object) && sameTile(object, row))) {
        throw new Error("Another owner has removed scenery on a Halloween tile");
      }
      if (!row.removeOnly) {
        if (foreignOnTile(c, row, new Set())) throw new Error("Runtime scenery occupies a Halloween tile");
        return { ...row, originals: [] };
      }
      const originals = standing(c, row).filter(object => globalObject(object) && object.isMapOriginal() &&
        object.getId() === row.id && sameTile(object, row) && object.getFace() === row.rotation);
      if (originals.length !== 1) throw new Error("Native scenery differs at a displaced Halloween tile");
      return { ...row, originals };
    });
    const bundle = bundleFor(c);
    c.CacheDefinitions.getDefinitionArchiveChanges([...existing, bundle]);
    install(api, [...existing, bundle]);
    state = { bundle, rows: [], chairs: [], ready: false };
    for (const row of plan) {
      const id = row.removeOnly ? null : locId(c, row);
      if (!row.removeOnly && id === null) throw new Error("Missing Halloween scene loc " + row.symbol);
      const object = row.removeOnly ? null : new c.GameObject(id, new c.Location(row.x, row.y, row.z), row.shape, row.rotation, null);
      state.rows.push({ ...row, object });
    }
    placeAll(api, state.rows);
    state.chairs = spawnChairs(api);
    state.ready = true;
    return { handled: true };
  } catch (error) {
    if (state) {
      const cleanup = close(api);
      if (!cleanup.handled) return { handled: false, error: error.message + "; cleanup: " + cleanup.error };
    }
    return { handled: false, error: error.message };
  }
}

function close(api) {
  if (!state) return { handled: true };
  const c = api.core, owned = new Set(state.rows.map(row => row.object).filter(Boolean));
  try {
    const installed = c.CacheDefinitions.getDefinitionArchiveBundles().find(bundle => bundle.id === BUNDLE);
    if (installed && JSON.stringify(installed) !== JSON.stringify(state.bundle)) throw new Error("Halloween archive has changed ownership");
    for (const row of state.rows) if (!row.removeOnly && foreignOnTile(c, row, owned)) throw new Error("A different runtime owner now occupies a Halloween tile");
    state.ready = false;
    for (const npc of state.chairs) if (npc.isRegistered()) api.removeNpc(npc);
    state.chairs = [];
    // Deregister while the archived types still exist, then restore the originals.
    const changed = [];
    for (const row of state.rows) if (row.object && c.World.getObjects().includes(row.object)) {
      c.ObjectManager.deregister(row.object, true);
      changed.push(row.object);
    }
    for (const row of state.rows) for (const original of row.originals) {
      if (c.MapObjects.get(original.getId(), original.getLocation(), null) !== original) c.ObjectManager.register(original, true);
      changed.push(original);
    }
    repairClipping(c, changed);
    if (installed) install(api, c.CacheDefinitions.getDefinitionArchiveBundles().filter(bundle => bundle.id !== BUNDLE));
    state = null;
    return { handled: true };
  } catch (error) {
    return { handled: false, error: error.message };
  }
}

/** The region loader recreates native objects; take ours back over in that region. */
function replay(api, { regionId }) {
  if (!state?.ready) return { handled: true };
  const c = api.core, rows = state.rows.filter(row => c.RegionManager.regionIdForTile(row.x, row.y) === regionId);
  const changed = [];
  for (const row of rows) {
    const reloaded = standing(c, row).filter(object => object !== row.object && globalObject(object) && sameTile(object, row) &&
      row.originals.some(original => original.getId() === object.getId() && original.getFace() === object.getFace()));
    for (const object of reloaded) { c.ObjectManager.deregister(object, true); changed.push(object); }
    if (row.object && !c.World.getObjects().includes(row.object)) { c.ObjectManager.register(row.object, true); changed.push(row.object); }
  }
  repairClipping(c, changed);
  return { handled: true };
}

function active() { return state?.ready === true; }
function isEventChair(api, npc) {
  return active() && npc?.getId() === api.core.CacheDefinitions.getArchivedId(BUNDLE, "npc", "hw25_chair_npc_event");
}

module.exports = { open, close, replay, active, isEventChair };
