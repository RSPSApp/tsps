// Static world-entity ships (the Red Reef's Zenith/pirate boats and the Pandemonium tutorial
// ship). Hull/deck/locs are the cache's template chunks; boarding uses a real BoatDeckArea.
// Core access arrives through the plugin api (`attach`) like the other sailing units.
const fs = require("fs");
const path = require("path");

const DEFINITIONS = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "static-ships.json"), "utf8"));
const definitions = new Map(DEFINITIONS.map((definition) => [definition.id, definition]));
const ships = new Map();
/** Where each player was before boarding a static ship, for the return trip. */
const returns = new Map();
const BOARD_RANGE = 8;

let core;

/** Called once by the owning plugin; all functions below use only these exposed core units. */
function attach(api) {
  core = api.core ?? api;
}

function coreApi() {
  if (!core) throw new Error("StaticShips used before its plugin attached");
  return core;
}

function templateLocations(definition) {
  const locs = [];
  const walkable = [];
  const zoneCountX = Math.ceil(definition.sizeX / 8);
  const zoneCountY = Math.ceil(definition.sizeZ / 8);
  for (let zoneX = 0; zoneX < zoneCountX; zoneX++) {
    for (let zoneY = 0; zoneY < zoneCountY; zoneY++) {
      const chunkX = definition.templateChunkX + zoneX;
      const chunkY = definition.templateChunkY + zoneY;
      const region = coreApi().readTemplateRegion(((chunkX >> 3) << 8) | (chunkY >> 3));
      if (!region) continue;
      const localChunkX = chunkX & 7;
      const localChunkY = chunkY & 7;
      for (let plane = 0; plane < 4; plane++) {
        for (const loc of region.chunks[(plane << 6) | (localChunkX << 3) | localChunkY] ?? []) {
          locs.push({
            id: loc.id,
            x: zoneX * 8 + (loc.localX & 7),
            y: zoneY * 8 + (loc.localY & 7),
            level: plane,
            shape: loc.type,
            rotation: loc.face,
            blocks: (coreApi().CacheDefinitions.getObject(loc.id)?.clipType ?? 0) !== 0,
          });
        }
      }
      if (definition.walkableTiles) continue;
      const plane = definition.deckLevel;
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
          const sourceX = (localChunkX << 3) + x;
          const sourceY = (localChunkY << 3) + y;
          const setting = region.settings[(plane << 12) | (sourceX << 6) | sourceY];
          if (definition.walkable !== "all" && setting === 0) continue;
          walkable.push({ x: zoneX * 8 + x, y: zoneY * 8 + y });
        }
      }
    }
  }
  return { locs, walkable };
}

function deckLocs(definition) {
  return (definition.deckLocs ?? []).map((loc) => ({
    ...loc,
    blocks: loc.blocks ?? (coreApi().CacheDefinitions.getObject(loc.id)?.clipType ?? 0) !== 0,
  }));
}

function specFor(definition) {
  const { locs, walkable } = templateLocations(definition);
  const additions = deckLocs(definition);
  return {
    type: definition.id,
    configId: definition.configId,
    templateChunkX: definition.templateChunkX,
    templateChunkY: definition.templateChunkY,
    sizeX: definition.sizeX,
    sizeZ: definition.sizeZ,
    hull: definition.hull,
    deckCentreX: definition.deckCentreX,
    deckCentreY: definition.deckCentreY,
    deckLevel: definition.deckLevel,
    walkableDeck: (definition.walkableTiles ?? walkable)
      .map((tile) => Array.isArray(tile) ? { x: tile[0], y: tile[1] } : tile),
    boardingTile: definition.boardingTile,
    locs: [...locs, ...additions],
    syncLocs: additions,
  };
}

/**
 * Spawns a fixed ship from the data file. ownerOnly/owner keep a quest instance private to one
 * player; without them the ship is a public world entity.
 */
function spawn(id, { owner, ownerOnly = false, entityIndex, fineX, fineY, level = 0, angle = 0 } = {}) {
  const definition = definitions.get(id);
  if (!definition) return undefined;
  const spec = specFor(definition);
  const boat = coreApi().BoatManager.spawnStatic(owner?.getIndex?.() ?? -1, spec, {
    fineX: fineX ?? (definition.fineX ?? 0),
    fineY: fineY ?? (definition.fineY ?? 0),
    level,
    angle,
  }, entityIndex);
  if (!boat) return undefined;
  boat.ownerOnly = ownerOnly;
  const ship = { id, definition, boat, spec, hitpoints: definition.hitpoints, maxHitpoints: definition.hitpoints };
  ships.set(boat.entityIndex, ship);
  return ship;
}

function get(entityIndex) {
  const ship = ships.get(entityIndex);
  return ship && coreApi().BoatManager.getBoat(entityIndex) === ship.boat ? ship : undefined;
}

function all() {
  return Array.from(ships.values());
}

function isAboard(player, ship) {
  return !!ship && coreApi().BoatManager.getBoatAboard(player) === ship.boat;
}

function deckLocation(ship, x, y, level = 0) {
  return new (coreApi().Location)(ship.boat.deckBaseX + x, ship.boat.deckBaseY + y, level);
}

/** Whether this player is allowed to see/use the ship (owner-private ships stay private). */
function canSee(player, ship) {
  const boat = ship?.boat;
  return !!boat
    && coreApi().BoatManager.getBoat(boat.entityIndex) === boat
    && coreApi().BoatManager.canSeeBoat(player, boat);
}

/** Main-world range from the player's root tile to the ship's centre. */
function inRange(player, ship, range) {
  const root = coreApi().BoatManager.rootLocation(player);
  const target = new (coreApi().Location)(ship.boat.tileX, ship.boat.tileY, ship.boat.level);
  return root.isWithinDistance(target, range);
}

/** Spawns an owner-scoped NPC on the ship's deck; it walks and is clicked like any deck actor. */
function addDeckNpc(ship, npcId, x, y, owner) {
  const location = deckLocation(ship, x, y);
  const npc = coreApi().PluginManager.spawnNpc({
    id: npcId, x: location.getX(), y: location.getY(), z: location.getZ(), owner, ownerOnly: true,
  });
  if (!npc) return undefined;
  coreApi().BoatManager.getDeck(ship.boat)?.enter(npc);
  return npc;
}

/**
 * Boards the ship at its captured tile. A player arriving from their own boat is taken off its
 * deck without sinking or disposing it, so they can return there.
 */
function board(player, ship) {
  if (!canSee(player, ship)) return "That ship is no longer there.";
  const aboard = coreApi().BoatManager.getBoatAboard(player);
  if (aboard && get(aboard.entityIndex)) return "You're already on a ship.";
  const area = player.getArea();
  const previous = { ship, player, area, location: player.getLocation().clone() };
  if (area?.boat && coreApi().BoatManager.getBoat(area.boat.entityIndex) === area.boat) area.leave(player, false);
  coreApi().BoatManager.getDeck(ship.boat)?.enter(player);
  returns.set(player.getIndex(), previous);
  player.moveTo(deckLocation(ship, ship.spec.boardingTile.x, ship.spec.boardingTile.y));
  return null;
}

/** The player's own boat deck/boarding tile, or their last dock/return point. */
function fallbackDestination(player) {
  const boat = coreApi().Sailing.instanceFor(player);
  if (boat && coreApi().BoatManager.getBoat(boat.entityIndex) === boat) {
    const deck = coreApi().BoatManager.getDeck(boat);
    const spec = coreApi().BoatManager.getSpec(boat);
    if (deck && spec) {
      return {
        area: deck,
        location: new (coreApi().Location)(boat.deckBaseX + spec.boardingTile.x, boat.deckBaseY + spec.boardingTile.y, 0),
      };
    }
  }
  if (typeof player.getSailing === "function") return { location: coreApi().Sailing.returnLocation(player) };
  return { location: coreApi().GameConstants.DEFAULT_LOCATION.clone() };
}

/** Restores a stored return, falling back to the player's own boat or last dock. */
function restore(player, previous) {
  if (previous && !previous.area?.boat) {
    player.moveTo(previous.location);
    return;
  }
  if (previous?.area?.boat
    && coreApi().BoatManager.getBoat(previous.area.boat.entityIndex) === previous.area.boat) {
    previous.area.enter(player);
    player.moveTo(previous.location);
    return;
  }
  // The saved deck was since removed; use the live owned boat or last return point instead
  // of stranding on an orphan deck tile.
  const fallback = fallbackDestination(player);
  if (fallback.area) fallback.area.enter(player);
  player.moveTo(fallback.location);
}

/**
 * Returns the player to where they boarded from: their own boat's deck, or the land tile. With
 * no stored return (direct deck entry/login), falls back to their own boat or last dock.
 */
function leave(player) {
  const current = coreApi().BoatManager.getBoatAboard(player);
  if (!current || !get(current.entityIndex)) return false;
  const previous = returns.get(player.getIndex());
  returns.delete(player.getIndex());
  const area = player.getArea();
  if (area?.boat && coreApi().BoatManager.getBoat(area.boat.entityIndex) === area.boat) area.leave(player, false);
  restore(player, previous);
  return true;
}

/** Evacuates every passenger, then removes the ship and its live deck. */
function dispose(ship) {
  if (!ship) return;
  const deck = coreApi().BoatManager.getDeck(ship.boat);
  for (const player of deck?.getPlayers?.() ?? []) leave(player);
  for (const [index, previous] of returns) {
    if (previous.ship !== ship) continue;
    // Player.onLogout leaves the area before plugin logout hooks run, and quests may dispose
    // the ship before this module's own logout hook. Recover the stored return for those
    // already-removed passengers instead of silently dropping it.
    const player = previous.player;
    const location = player?.getLocation?.();
    if (player && !player.getArea?.()
      && location && coreApi().BoatManager.isDeckTile(location.getX(), location.getY())) {
      restore(player, previous);
    }
    returns.delete(index);
  }
  ships.delete(ship.boat.entityIndex);
  coreApi().BoatManager.dispose(ship.boat);
}

/** Applies damage; `sunk` is true only for the hit that takes it from positive HP to zero. */
function damage(ship, amount) {
  if (!ship || ship.hitpoints <= 0) {
    return { damage: 0, hitpoints: ship?.hitpoints ?? 0, sunk: false, alreadySunk: true };
  }
  const dealt = Math.max(0, Math.min(ship.hitpoints, Math.trunc(amount)));
  ship.hitpoints -= dealt;
  return { damage: dealt, hitpoints: ship.hitpoints, sunk: ship.hitpoints <= 0, alreadySunk: false };
}

/** Logout/disconnect: step off any static deck, then remove this player's owner-only ships. */
function forget(player) {
  const previous = returns.get(player.getIndex());
  const aboard = coreApi().BoatManager.getBoatAboard(player);
  if (aboard && get(aboard.entityIndex)) leave(player);
  for (const ship of Array.from(ships.values())) {
    if (ship.boat.ownerOnly && ship.boat.ownerPlayerId === player.getIndex()) dispose(ship);
  }
  // Player.onLogout leaves the area before plugin logout hooks run, so the player may have no
  // area but still carry a deck-scene tile. Keep the original land return when the stored
  // return was land; otherwise use the owned-boat/last-dock fallback.
  const location = player.getLocation();
  if (!player.getArea?.() && coreApi().BoatManager.isDeckTile(location.getX(), location.getY())) {
    player.setLocation(previous && !previous.area?.boat
      ? previous.location
      : fallbackDestination(player).location);
  }
  returns.delete(player.getIndex());
}

module.exports = {
  attach,
  BOARD_RANGE,
  definitions,
  spawn,
  get,
  all,
  isAboard,
  deckLocation,
  canSee,
  inRange,
  addDeckNpc,
  board,
  leave,
  dispose,
  damage,
  forget,
};
