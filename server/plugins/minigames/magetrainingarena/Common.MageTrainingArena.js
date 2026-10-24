/**
 * Mage Training Arena: what the units share - the plugin api, plugins/minigames/data/
 * mage-training-arena.json with its gameval names resolved to cache ids, Pizazz Points (saved
 * per player, capped per type), the overlays and messages.
 */
const fs = require("fs");
const path = require("path");

const POINT_TYPES = ["telekinetic", "alchemist", "enchantment", "graveyard"];
const POINTS_ATTRIBUTE = (type) => `mage-training-arena:${type}-points`;
const HAT_GIVEN_ATTRIBUTE = "mage-training-arena:hat-given";
/** (161 << 16) | 8: the toplevel's overlay slot, as other minigame HUDs. */
const OVERLAY_HUD_UID = (161 << 16) | 8;

let api = null;
let core = null;
let data = null;
let ids = null;

function resolve(names, lookup, kind) {
  const out = {};
  for (const [key, name] of Object.entries(names)) {
    if (key.startsWith("_")) continue;
    const id = lookup(name);
    if (id === null || id === undefined) throw new Error(`[MageTrainingArena] unknown ${kind} ${name}`);
    out[key] = id;
  }
  return out;
}

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "mage-training-arena.json"), "utf8"));
  const cache = core.CacheDefinitions;
  ids = {
    npcs: resolve(data.names.npcs, (name) => cache.getNpcId(name), "npc"),
    locs: resolve(data.names.locs, (name) => cache.getLocId(name), "loc"),
    items: resolve(data.names.items, (name) => cache.getObjId(name), "item"),
    interfaces: resolve(data.names.interfaces, (name) => cache.getInterfaceId(name), "interface"),
    components: resolve(data.names.components, (name) => cache.getComponentId(name), "component"),
  };
}

function message(key, values = {}) {
  return data.messages[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);

/** Whether a tile is inside [minX, maxX, minY, maxY, z?] (any of `levels` when given). */
function inBox(location, [minX, maxX, minY, maxY, z], levels = null) {
  const x = location.getX();
  const y = location.getY();
  const plane = location.getZ();
  if (levels ? !levels.includes(plane) : plane !== (z ?? 0)) return false;
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

// --- Pizazz Points

function points(player, type) {
  return Math.max(0, Number(player.getAttribute(POINTS_ATTRIBUTE(type))) || 0);
}

/** Adds (or with a negative amount, spends) points, up to the type's cap; returns what changed. */
function addPoints(player, type, amount) {
  const cap = data.points.caps[type];
  const before = points(player, type);
  const after = Math.max(0, Math.min(cap, before + Math.floor(amount)));
  player.setAttribute(POINTS_ATTRIBUTE(type), after);
  refreshHat(player);
  if (amount > 0 && after === cap && before + amount > cap) {
    player.sendMessage(message("pointsCapped", { type: type[0].toUpperCase() + type.slice(1) }));
  }
  return after - before;
}

/** The hat for these points: energised at 300 of each type, full at 600 (Wiki: Progress_hat). */
function hatFor(player) {
  const lowest = Math.min(...POINT_TYPES.map((type) => points(player, type)));
  if (lowest >= data.points.hatFull) return ids.items.hatFull;
  if (lowest >= data.points.hatEnergised) return ids.items.hatEnergised;
  return ids.items.hatDull;
}

const hatIds = () => [ids.items.hatDull, ids.items.hatEnergised, ids.items.hatFull];

/** The hat carried or worn shows the points: it brightens as they grow, and dulls when spent. */
function refreshHat(player) {
  const want = hatFor(player);
  const inventory = player.getInventory();
  for (const id of hatIds()) {
    if (id === want || !inventory.contains(id)) continue;
    inventory.deleteNumber(id, 1);
    inventory.adds(want, 1);
  }
  const { Equipment, Item } = core;
  const equipment = player.getEquipment?.();
  const head = equipment?.get?.(Equipment.HEAD_SLOT);
  if (head && hatIds().includes(head.getId()) && head.getId() !== want) {
    equipment.set(Equipment.HEAD_SLOT, new Item(want, 1));
    equipment.refreshItems?.();
    player.getUpdateFlag?.()?.flag?.(core.Flag?.APPEARANCE);
  }
}

function ownsHat(player) {
  const { Equipment } = core;
  const head = player.getEquipment?.()?.get?.(Equipment.HEAD_SLOT);
  if (hatIds().includes(head?.getId?.())) return true;
  if (hatIds().some((id) => player.getInventory().contains(id))) return true;
  const searchTab = core.Bank?.BANK_SEARCH_TAB_INDEX;
  return (player.getBanks?.() ?? []).some((bank, tab) => tab !== searchTab && hatIds().some((id) => bank?.contains?.(id)));
}

// --- Overlays

function sendOverlay(player, interfaceId) {
  player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, interfaceId, 1);
}

function closeOverlay(player) {
  player.getPacketSender().closeSubInterface?.(OVERLAY_HUD_UID);
}

module.exports = {
  init, message, toLocation, inBox, points, addPoints, hatFor, hatIds, refreshHat, ownsHat, sendOverlay, closeOverlay,
  POINT_TYPES, POINTS_ATTRIBUTE, HAT_GIVEN_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
  get ids() { return ids; },
};
