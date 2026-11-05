"use strict";

// Installs the archived 25th Anniversary definitions, the event-window scenery placed in
// live squares (Varrock house, Party Room, city decorations) and the Realm of Memories map
// squares, and puts every one of them back exactly when the window closes.
const zlib = require("node:zlib");
const source = require("./data/anniversary-2026-archive.json");
const Data = require("./Data.BirthdayAnniversary");
// Footprints are at most 5 tiles: look this far round a changed tile for standing geometry.
const CLIP_MARGIN = 5;
let scene = null;

function sameTile(object, row) {
  const p = object.getLocation();
  return p.getX() === row.x && p.getY() === row.y && p.getZ() === row.z && object.getType() === row.shape;
}
function globalObject(object) { return !object.getPrivateArea() && !object.getOwner(); }
function install(api, bundles) {
  const request = { bundles };
  api.emitCustomEvent("definition-archives:install", request);
  if (!request.handled) throw new Error(request.error || "25th Anniversary definition archive installation was refused");
}
function bundleFor(core) {
  const counts = core.CacheDefinitions.getCounts();
  const next = { npc: counts.npcs, loc: counts.objects, obj: counts.items, seq: counts.seqs };
  const bundle = JSON.parse(JSON.stringify(source.bundle));
  // Other activities may already hold appended ids; the registry rebinds the closed graph.
  for (const row of bundle.definitions) row.id = next[row.kind]++;
  return bundle;
}
function rows() {
  const placed = [];
  for (const [name, list] of Object.entries(source.placements)) {
    const [kind, value] = name.split(":");
    for (const [x, y, z, shape, rotation] of list) {
      placed.push({ kind, symbol: kind === "archived" ? value : null, nativeId: kind === "native" ? Number(value) : null, x, y, z, shape, rotation });
    }
  }
  return placed;
}
/** Re-add clipping of standing global geometry near the changed tiles (clip bits are shared ORs). */
function repairClipping(core, changed) {
  if (!changed.length) return;
  const seen = new Set();
  for (const row of changed) {
    for (let dx = -CLIP_MARGIN; dx <= CLIP_MARGIN; dx++) for (let dy = -CLIP_MARGIN; dy <= CLIP_MARGIN; dy++) {
      for (const object of core.MapObjects.mapObjects.get(core.MapObjects.getHash(row.x + dx, row.y + dy, row.z)) ?? []) {
        if (!globalObject(object) || seen.has(object)) continue;
        seen.add(object);
        core.RegionManager.addObjectClipping(object);
      }
    }
  }
}
/** Map-loc file bytes (as the cache stores them) for one Realm square, ids rebound to the bundle. */
function encodeLocs(core, locs) {
  const bytes = [];
  const smart = value => value < 128 ? bytes.push(value) : bytes.push(((value + 0x8000) >> 8) & 0xff, (value + 0x8000) & 0xff);
  const bigSmart = value => { while (value >= 32767) { smart(32767); value -= 32767; } smart(value); };
  const byId = new Map();
  for (const [identity, position, flags] of locs) {
    const id = typeof identity === "number" ? identity : core.CacheDefinitions.getArchivedId(Data.BUNDLE, "loc", identity);
    if (id === null || id === undefined) throw new Error("Missing archived Realm loc " + identity);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push([position, flags]);
  }
  let previousId = -1;
  for (const id of [...byId.keys()].sort((a, b) => a - b)) {
    bigSmart(id - previousId);
    previousId = id;
    let previousPosition = 0;
    for (const [position, flags] of byId.get(id).sort((a, b) => a[0] - b[0])) {
      smart(position - previousPosition + 1);
      previousPosition = position;
      bytes.push(flags);
    }
    smart(0);
  }
  smart(0);
  return Uint8Array.from(bytes);
}
function open(api) {
  const c = api.core;
  if (scene) return scene.ready ? { handled: true } : { handled: false, error: "The previous 25th Anniversary scene needs cleanup before reopening" };
  try {
    const existing = [...c.CacheDefinitions.getDefinitionArchiveBundles()];
    if (existing.some(bundle => bundle.id === Data.BUNDLE)) throw new Error("Another owner has installed the 25th Anniversary archive");
    const bundle = bundleFor(c);
    c.CacheDefinitions.getDefinitionArchiveChanges([...existing, bundle]);
    install(api, [...existing, bundle]);
    scene = { bundle, rows: [], realm: [], skipped: 0, ready: false };
    for (const row of rows()) {
      c.RegionManager.loadMapFiles(row.x, row.y, false);
      const standing = [...(c.MapObjects.mapObjects.get(c.MapObjects.getHash(row.x, row.y, row.z)) ?? [])].filter(object => globalObject(object) && sameTile(object, row));
      const runtime = c.ObjectManager.objectsAt(new c.Location(row.x, row.y, row.z)).some(object => globalObject(object) && sameTile(object, row) && !object.isMapOriginal());
      // A live runtime owner (a door state, another activity) keeps its tile; the decoration is left out.
      if (runtime || standing.some(object => !object.isMapOriginal()) ||
        c.World.getRemovedObjects().some(object => globalObject(object) && sameTile(object, row))) { scene.skipped++; continue; }
      const id = row.kind === "archived" ? c.CacheDefinitions.getArchivedId(Data.BUNDLE, "loc", row.symbol) : row.nativeId;
      if (id === null || id === undefined) throw new Error("Missing archived scene symbol " + row.symbol);
      const object = new c.GameObject(id, new c.Location(row.x, row.y, row.z), row.shape, row.rotation, null);
      for (const original of standing) c.ObjectManager.deregister(original, true);
      c.ObjectManager.register(object, true);
      scene.rows.push({ ...row, object, normal: standing });
    }
    repairClipping(c, scene.rows.filter(row => row.normal.length));
    for (const square of source.realm) {
      const terrain = Uint8Array.from(zlib.gunzipSync(Buffer.from(square.terrainGzipBase64, "base64")));
      if (!api.replaceMapRegionData(square.region, terrain, encodeLocs(c, square.locs))) throw new Error("Realm of Memories square " + square.region + " was refused");
      scene.realm.push(square.region);
    }
    if (scene.skipped) api.log(`25th Anniversary scene: ${scene.skipped} decoration tiles are held by runtime objects and were left out`);
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
    const installed = c.CacheDefinitions.getDefinitionArchiveBundles().find(bundle => bundle.id === Data.BUNDLE);
    if (installed && JSON.stringify(installed) !== JSON.stringify(scene.bundle)) throw new Error("25th Anniversary archive has changed ownership");
    scene.ready = false;
    for (const region of scene.realm.splice(0)) api.restoreMapRegion(region);
    // Deregister while the archived types still exist: collision removal reads their footprints.
    for (const row of scene.rows) if (c.World.getObjects().includes(row.object) || c.MapObjects.get(row.object.getId(), row.object.getLocation(), null) === row.object) c.ObjectManager.deregister(row.object, true);
    for (const row of scene.rows) for (const original of row.normal) {
      if (c.MapObjects.get(original.getId(), original.getLocation(), null) !== original) c.ObjectManager.register(original, true);
    }
    repairClipping(c, scene.rows);
    if (installed) install(api, c.CacheDefinitions.getDefinitionArchiveBundles().filter(bundle => bundle.id !== Data.BUNDLE));
    scene = null;
    return { handled: true };
  } catch (error) { return { handled: false, error: error.message }; }
}
/** A reloaded live square brings back its native objects; put the event scenery back over them. */
function replay(api, { regionId }) {
  if (!scene?.ready) return { handled: true };
  const c = api.core, affected = scene.rows.filter(row => c.RegionManager.regionIdForTile(row.x, row.y) === regionId);
  for (const row of affected) {
    for (const standing of [...(c.MapObjects.mapObjects.get(c.MapObjects.getHash(row.x, row.y, row.z)) ?? [])]) {
      if (standing !== row.object && sameTile(standing, row) && globalObject(standing)) c.ObjectManager.deregister(standing, true);
    }
    c.ObjectManager.register(row.object, true);
  }
  repairClipping(c, affected);
  return { handled: true };
}
function active() { return scene?.ready === true; }
function archivedId(api, kind, symbol) { return active() ? api.core.CacheDefinitions.getArchivedId(Data.BUNDLE, kind, symbol) : null; }
function archivedSymbol(api, kind, id) {
  if (!active()) return null;
  const row = scene.bundle.definitions.find(definition => definition.kind === kind && definition.symbol &&
    api.core.CacheDefinitions.getArchivedId(Data.BUNDLE, kind, definition.symbol) === id);
  return row?.symbol ?? null;
}
function inRealm(location) {
  const x = location.getX() >> 6, y = location.getY() >> 6;
  return Data.REALM_SQUARES.some(([sx, sy]) => sx === x && sy === y);
}

module.exports = { open, close, replay, active, archivedId, archivedSymbol, inRealm, encodeLocs };
