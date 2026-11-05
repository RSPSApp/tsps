"use strict";

const { api, CacheDefinitions, Animation, ChatType, CountdownTask, Direction, GameObject, Item, PlayerStatus, RegionManager, TaskManager } = require("./Core.Construction");
const { DECORATIONS_ATTRIBUTE } = require("./StorageState.Construction");
const Ids = require("./Ids.Construction");
const Data = require("./Data.Construction");
const House = require("./House.Construction");
const DATA = require("./data/holiday-decorations.json");

// Holiday decorations planted in the house (Wintumber tree, Halloween scarecrow). Rev 230
// recording 2923 shows the tree planted on the faced tile 3 ticks after Plant and dug up 2 ticks
// after Dig-up, with gublinch_tree_x/z/planted set, so it stays in the house. Each is saved here as
// a tile of the house grid on the ground floor and drawn as an extra object on every rebuild.
const GROUND_FLOOR = 1;
const SHAPE = 10;
const RESET = -1;

const decorations = DATA.decorations.map(entry => ({
  ...entry,
  itemId: Ids.obj(entry.item),
  locId: Ids.loc(entry.loc),
  plantSeq: Ids.seq(entry.plantSeq),
  digSeq: Ids.seq(entry.digSeq),
}));
const byItem = new Map(decorations.map(decoration => [decoration.itemId, decoration]));
const byLoc = new Map(decorations.map(decoration => [decoration.locId, decoration]));
// Hooked by cache name; "Scarecrow" is shared with other locs, which decorationAt leaves alone.
const itemNames = new Set(decorations.map(decoration => CacheDefinitions.getItem(decoration.itemId).name));
const locNames = new Set(decorations.map(decoration => CacheDefinitions.getObject(decoration.locId).name));
/** house -> Map(key -> drawn GameObject) */
const drawn = new WeakMap();
/** player -> the Plant or Dig-up task waiting for its tick; walking away stops it (walkToReset). */
const pending = new WeakMap();

function saved(player) {
  const value = player.getAttribute(DECORATIONS_ATTRIBUTE);
  return value && typeof value === "object" ? value : {};
}

function save(player, value) {
  player.setAttribute(DECORATIONS_ATTRIBUTE, { ...value });
}

function origin(house) {
  return house.roomCorner({ x: 0, y: 0, plane: GROUND_FLOOR });
}

function tileOf(house, entry) {
  return origin(house).transform(entry.x, entry.y);
}

function outdoors(house, tile) {
  const position = house.getRoomPositionAt(tile);
  const room = position && house.getRoom(position);
  return room ? Data.ROOM_BY_KEY.get(room.roomKey)?.outdoors === true : false;
}

function covers(x, y, width, length, tile) {
  return tile.getX() >= x && tile.getX() < x + width && tile.getY() >= y && tile.getY() < y + length;
}

/** Wiki: "any free non-hotspot space" of an outdoor room. */
function onHotspot(house, tile) {
  const position = house.getRoomPositionAt(tile);
  return house.hotspotTiles(position).some(hotspot => covers(hotspot.x, hotspot.y, hotspot.width ?? 1, hotspot.length ?? 1, tile));
}

function occupied(house, tile, except = null) {
  const objects = [...house.furnitureObjects, ...house.extraObjects];
  return objects.some(object => {
    if (object === except) return false;
    const at = object.getLocation(), definition = CacheDefinitions.getObject(object.getId());
    const turned = (object.getFace() & 1) === 1;
    const width = (turned ? definition?.sizeY : definition?.sizeX) ?? 1, length = (turned ? definition?.sizeX : definition?.sizeY) ?? 1;
    return at.getZ() === tile.getZ() && covers(at.getX(), at.getY(), width, length, tile);
  });
}

function free(house, tile) {
  return tile.getZ() === GROUND_FLOOR && outdoors(house, tile) && !onHotspot(house, tile)
    && !occupied(house, tile) && !RegionManager.blocked(tile, house);
}

function message(player, decoration, key, type = ChatType.GAME) {
  const text = decoration.messages[key];
  if (text) player.getPacketSender().sendTypedMessage(type, text);
}

function draw(house, decoration, entry) {
  const object = new GameObject(decoration.locId, tileOf(house, entry), SHAPE, entry.face & 3, house);
  RegionManager.addObjectClipping(object);
  house.addExtraObject(object);
  return object;
}

/**
 * Instance.rebuild: draws the owner's decorations. One whose tile is no longer a free outdoor
 * space (its room was removed, moved or rebuilt indoors) is forgotten, so Diango replaces it as a
 * lost item (Wiki), instead of standing indoors or blocking a room.
 */
function refresh(house) {
  const owner = house.owner;
  if (!owner) return;
  const objects = drawn.get(house) ?? new Map();
  drawn.set(house, objects);
  const entries = saved(owner);
  let changed = false;
  for (const decoration of decorations) {
    const entry = entries[decoration.key], object = objects.get(decoration.key);
    const tile = entry && tileOf(house, entry);
    // Re-checked on every rebuild, also when the decoration is already drawn: a room moved,
    // removed or rebuilt under it on this same instance must not leave it standing there.
    const stands = entry && outdoors(house, tile) && !onHotspot(house, tile) && !occupied(house, tile, object);
    if (stands && object && object.getLocation().equals(tile) && object.getFace() === (entry.face & 3)) continue;
    if (object) {
      house.removeExtraObject(object);
      objects.delete(decoration.key);
    }
    if (!entry) continue;
    if (!stands) {
      delete entries[decoration.key];
      changed = true;
      continue;
    }
    objects.set(decoration.key, draw(house, decoration, entry));
  }
  if (changed) save(owner, entries);
}

function after(player, ticks, action) {
  const task = new CountdownTask(player.getIndex(), ticks, action);
  pending.set(player, task);
  TaskManager.submit(task);
}

function ready(player) {
  return !pending.get(player)?.isRunning() && player.getHitpoints() > 0 && player.getStatus() === PlayerStatus.NONE && !player.busy?.();
}

function plant(event) {
  const { player, slot } = event;
  const decoration = byItem.get(event.itemId);
  if (!decoration || !player) return;
  event.handled = true;
  if (!ready(player)) return;
  const house = House.houseFor(player);
  if (!house || house.owner !== player || !outdoors(house, player.getLocation())) {
    message(player, decoration, "wrongPlace");
    return;
  }
  const direction = player.getFacingDirection();
  const tile = player.getLocation().transform(direction.getX(), direction.getY());
  // Recording 2923: the player turns to the tile even when it has no space.
  if (direction !== Direction.NONE) player.setPositionToFace(tile);
  if (direction === Direction.NONE || saved(player)[decoration.key] || !free(house, tile)) {
    message(player, decoration, "noSpace");
    return;
  }
  player.performAnimation(new Animation(decoration.plantSeq));
  message(player, decoration, "planted", ChatType.SPAM);
  after(player, decoration.plantTicks, () => {
    player.performAnimation(new Animation(RESET));
    const inventory = player.getInventory(), item = inventory.getItems()[slot];
    if (House.houseFor(player) !== house || item?.getId() !== decoration.itemId || saved(player)[decoration.key] || !free(house, tile)) return;
    inventory.deleteAtSlot(slot, 1);
    const corner = origin(house);
    const entries = saved(player);
    // The recording's rotations vary (0, 2, 3) with no link to the facing seen, so pick one.
    entries[decoration.key] = { x: tile.getX() - corner.getX(), y: tile.getY() - corner.getY(), face: Math.floor(Math.random() * 4) };
    save(player, entries);
    refresh(house);
    // Planting uses the item, as Wear and Play-with do (rev 232 recording 3200), so Diango
    // knows it: a decoration forgotten later (its room removed) can then be replaced there.
    api.emitCustomEvent("holiday-rewards:used", { player, itemId: decoration.itemId });
  });
}

function decorationAt(event) {
  const decoration = byLoc.get(event.objectId);
  const house = event.player && House.houseFor(event.player);
  const object = decoration && house && drawn.get(house)?.get(decoration.key);
  const at = object?.getLocation();
  if (!at || at.getX() !== event.location.x || at.getY() !== event.location.y || at.getZ() !== (event.location.z ?? at.getZ())) return null;
  return { decoration, house, object };
}

function digUp(event) {
  const found = decorationAt(event);
  if (!found) return;
  event.handled = true;
  const { player } = event, { decoration, house, object } = found;
  if (!ready(player)) return;
  if (house.owner !== player) {
    message(player, decoration, "notOwner");
    return;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.getInventory().full();
    return;
  }
  player.setPositionToFace(object.getLocation());
  player.performAnimation(new Animation(decoration.digSeq));
  message(player, decoration, "dugUp", ChatType.SPAM);
  after(player, decoration.digTicks, () => {
    const entries = saved(player);
    if (House.houseFor(player) !== house || !entries[decoration.key] || player.getInventory().getFreeSlots() <= 0) return;
    delete entries[decoration.key];
    save(player, entries);
    refresh(house);
    player.getInventory().add(new Item(decoration.itemId, 1), true);
  });
}

/** Cache options Rotate-clockwise / Rotate-anticlockwise; nothing records a sequence or message. */
function rotate(event, turn) {
  const found = decorationAt(event);
  if (!found || !found.decoration.rotatable) return;
  event.handled = true;
  const { player } = event, { decoration, house } = found;
  if (house.owner !== player || !ready(player)) return;
  const entries = saved(player);
  entries[decoration.key] = { ...entries[decoration.key], face: (entries[decoration.key].face + turn) & 3 };
  save(player, entries);
  refresh(house);
}

const rotateClockwise = event => rotate(event, 1);
const rotateAnticlockwise = event => rotate(event, 3);

function attachDecorations(api) {
  api.persistAttribute(DECORATIONS_ATTRIBUTE, {});
  for (const name of itemNames) api.onItemAction(name, { Plant: plant });
  for (const name of locNames) api.onObjectInteraction(name, { "Dig-up": digUp, "Rotate-clockwise": rotateClockwise, "Rotate-anticlockwise": rotateAnticlockwise });
}

Object.assign(module.exports, { refresh, attachDecorations });
