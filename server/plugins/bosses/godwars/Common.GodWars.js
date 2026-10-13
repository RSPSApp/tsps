"use strict";

/**
 * Shared God Wars Dungeon state: the data file, the four factions, essence, the general kill
 * counts and small helpers the other units use. See docs/god-wars-dungeon.md.
 */
const fs = require("fs");
const path = require("path");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "godwars.json"), "utf8"));

/** Per god: the essence kept for the trip (also on the god's varbit) and the general's kills. */
const essenceAttribute = (key) => `godwars:essence-${key}`;
const killsAttribute = (key) => `godwars:kills-${key}`;
const ALTAR_ATTRIBUTE = "godwars:altar-prayed-at";
/** The god whose private chamber the player is in, so a login after a crash lands outside it. */
const CHAMBER_ATTRIBUTE = "godwars:private-chamber";
const ENTRANCE_ROPE_ATTRIBUTE = "godwars:entrance-rope";
const ropeAttribute = (varbit) => `godwars:rope-${varbit}`;

const factions = Object.entries(data.factions).map(([key, faction]) => ({ key, ...faction }));

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);

function inBox(box, x, y, z) {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && (box.z === undefined || box.z === z);
}

function inDungeon(location) {
  const { dungeon } = data;
  return inBox(dungeon, location.getX(), location.getY()) && dungeon.planes.includes(location.getZ());
}

const factionByKey = (key) => factions.find((faction) => faction.key === key) ?? null;
const factionForDoor = (id) => factions.find((faction) => faction.door.id === id) ?? null;
const factionForAltar = (id) => factions.find((faction) => faction.altar === id) ?? null;

/** The god an NPC id follows, the general and bodyguards included. */
function factionForNpc(id) {
  return factions.find((faction) => faction.followers.some(([lo, hi]) => id >= lo && id <= hi)) ?? null;
}

/** The faction whose (real) chamber holds this tile. */
function factionForRoom(location) {
  return factions.find((faction) => inBox(faction.room, location.getX(), location.getY(), location.getZ())) ?? null;
}

function getEssence(player, faction) {
  return Math.max(0, Math.trunc(Number(player.getAttribute(essenceAttribute(faction.key))) || 0));
}

function setEssence(player, faction, value) {
  const essence = Math.max(0, Math.min(data.essence.max, Math.trunc(value)));
  player.setAttribute(essenceAttribute(faction.key), essence);
  player.getPacketSender().sendVarbit(faction.essenceVarbit, essence);
}

function syncEssence(player) {
  for (const faction of factions) player.getPacketSender().sendVarbit(faction.essenceVarbit, getEssence(player, faction));
}

function resetEssence(player) {
  for (const faction of factions) setEssence(player, faction, 0);
}

/** Wearing anything of the god's (by the cache's item name, so every variant counts). */
function godItemCount(player, faction) {
  let count = 0;
  for (const item of player.getEquipment().getItems()) {
    if (!item || item.getId() <= 0) continue;
    const name = core.ItemDefinition.forId(item.getId())?.getName?.()?.toLowerCase?.() ?? "";
    if (faction.itemKeywords.some((keyword) => name.includes(keyword))) count++;
  }
  return count;
}

/** The general's kill count: varp, attribute and the captured message. */
function addGeneralKill(player, faction, npcName) {
  const kills = (Number(player.getAttribute(killsAttribute(faction.key))) || 0) + 1;
  player.setAttribute(killsAttribute(faction.key), kills);
  player.getPacketSender().sendConfig(faction.killsVarp, kills);
  player.sendMessage(`Your ${npcName} kill count is: <col=ff0000>${kills}</col>.`);
}

function syncKills(player) {
  for (const faction of factions) {
    const kills = Number(player.getAttribute(killsAttribute(faction.key))) || 0;
    if (kills > 0) player.getPacketSender().sendConfig(faction.killsVarp, kills);
  }
}

function later(ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(ticks, false);
    }

    execute() {
      this.stop();
      action();
    }
  })());
}

/** A sound everyone near the source hears. */
function areaSound(source, id, delay = 0) {
  core.Sounds.sendSound(source, new core.Sound(id, 1, delay, 0));
}

function graphic(id, { delay = 0, height = 0 } = {}) {
  const gfx = new core.Graphic(id);
  gfx.delay = delay;
  gfx.height = height;
  return gfx;
}

/**
 * The boss door opening for a moment, as captured: the open door and its swung leaf replace the
 * closed door, and two ticks later the closed door is back.
 */
function swingDoor(faction) {
  const { GameObject, MapObjects, ObjectManager } = core;
  const [openId, openShape, face] = faction.door.open;
  const [wallId, wallShape, wallFace] = faction.door.openWall;
  const at = toLocation(faction.door.tile);
  const closed = MapObjects.get(faction.door.id, at, null);
  if (!closed) return;
  const open = new GameObject(openId, at, openShape, face, null);
  const wall = new GameObject(wallId, at, wallShape, wallFace, null);
  ObjectManager.deregister(closed, false);
  ObjectManager.register(open, true);
  ObjectManager.register(wall, true);
  later(2, () => {
    ObjectManager.deregister(wall, true);
    ObjectManager.deregister(open, false);
    ObjectManager.register(new GameObject(faction.door.id, at, 10, face, null), true);
  });
}

module.exports = {
  data,
  factions,
  ALTAR_ATTRIBUTE,
  CHAMBER_ATTRIBUTE,
  ENTRANCE_ROPE_ATTRIBUTE,
  essenceAttribute,
  killsAttribute,
  ropeAttribute,
  init,
  get api() {
    return api;
  },
  get core() {
    return core;
  },
  toLocation,
  inBox,
  inDungeon,
  factionByKey,
  factionForDoor,
  factionForAltar,
  factionForNpc,
  factionForRoom,
  getEssence,
  setEssence,
  syncEssence,
  resetEssence,
  godItemCount,
  addGeneralKill,
  syncKills,
  later,
  areaSound,
  graphic,
  swingDoor,
};
