"use strict";

// Dorgesh-Kaan's broken lamps (Wiki: Lamp (Dorgesh-Kaan), Light orb). Ten of the city's 64 lamps are
// broken for each player; using a light orb on one (or its Fix option) needs 52 Firemaking and 52
// Crafting, gives 500 XP in each, and breaks another lamp. Every 50 lamps give 2,500 more of each.
//
// The cache gives each lamp (dorgesh_lamp_N) a multivar bit of the shared loc4 varp, and lamps in
// different parts of the city share bits, so the varp says only which lamps are broken near the
// player. The city splits into six parts: each floor, north and south of y 5312. Each bit shows the
// part's own lamp, or the other half's lamp on that floor when the part has no lamp on it.
// data/dorgesh-kaan-lamps.json holds each lamp's tile, checked against the cache map by its test.
//
// Not modelled, for want of a source: the "another broken lamp nearby" hint and minimap arrow, an
// animation or sound for the repair, and the dorgesh_bulbs_fixed varbit. The total's wording comes
// from the Dorgesh-Kaan lamps RuneLite plugin's chat pattern; the low-level refusal is this plugin's.
// Lamps on other floors that share a bit show the current part's state; they can't be reached from
// here, so only their look is off. The six parts are Areas, so they hold the city's area slot: later
// Dorgesh-Kaan area content must extend these rather than register its own.

const LAMPS = require("./data/dorgesh-kaan-lamps.json");

const BROKEN_ATTRIBUTE = "dorgesh-kaan-lamps:broken";
const FIXED_ATTRIBUTE = "dorgesh-kaan-lamps:fixed";
const FIXED_EVENT = "dorgesh-kaan-lamps:fixed";
const LAMPS_VARBIT = "dorgesh_light_bulb_all";
const BROKEN_LAMPS = 10;
const LEVEL = 52;
const XP = 500;
const BATCH = 50;
const BATCH_XP = 2500;
// The plugin's map split: Dorgesh-Kaan's lamps lie in x 2688-2751, y 5248-5375.
const CITY = { west: 2688, east: 2751, south: 5248, north: 5375, line: 5312 };
const PLANES = [0, 1, 2];

const FILAMENT = "You need to add a filament to that orb before you put it in.";
const NOTHING = "Nothing interesting happens.";
const BATCH_MESSAGE = "<col=239929>You have fixed a batch of 50 lights and have gained some extra experience.</col>";

let api;
let core;
let random = Math.random;
/** name -> { name, id, bit, part, x, y, z } once the cache is loaded. */
let lamps = null;
let byId = null;

function partOf(y, z) {
  return `${z}:${y >= CITY.line ? "north" : "south"}`;
}

function opposite(part) {
  const [z, half] = part.split(":");
  return `${z}:${half === "north" ? "south" : "north"}`;
}

function catalogue() {
  if (lamps) return lamps;
  const C = core.CacheDefinitions;
  lamps = new Map();
  byId = new Map();
  for (const [name, [x, y, z]] of Object.entries(LAMPS)) {
    const id = C.getLocId(name);
    const varbit = C.getVarbit(C.getObject(id).transformVarbit);
    const lamp = { name, id, bit: varbit.startBit, part: partOf(y, z), x, y, z };
    lamps.set(name, lamp);
    byId.set(id, lamp);
  }
  return lamps;
}

function broken(player) {
  const saved = player.getAttribute(BROKEN_ATTRIBUTE);
  const known = Array.isArray(saved) ? [...new Set(saved.filter(name => catalogue().has(name)))] : [];
  if (known.length >= BROKEN_LAMPS) return known.slice(0, BROKEN_LAMPS);
  // A new player's lamps, or a save that lost some: break working lamps until there are ten.
  const filled = [...known];
  while (filled.length < BROKEN_LAMPS) filled.push(pickWorking(filled, null));
  player.setAttribute(BROKEN_ATTRIBUTE, filled);
  return filled;
}

function pickWorking(brokenNames, justFixed) {
  const working = [...catalogue().keys()].filter(name => !brokenNames.includes(name) && name !== justFixed);
  return working[Math.floor(random() * working.length)];
}

/** The loc4 bits for a part of the city: its own lamps, then the other half's on bits it doesn't use. */
function varbitValue(brokenNames, part) {
  const own = [...catalogue().values()].filter(lamp => lamp.part === part);
  const used = new Set(own.map(lamp => lamp.bit));
  const other = [...catalogue().values()].filter(lamp => lamp.part === opposite(part) && !used.has(lamp.bit));
  let value = 0;
  for (const lamp of [...own, ...other]) if (brokenNames.includes(lamp.name)) value |= 1 << lamp.bit;
  return value;
}

function sync(player, part) {
  const id = core.CacheDefinitions.getVarbitId(LAMPS_VARBIT);
  player.getPacketSender().sendVarbit(id, part ? varbitValue(broken(player), part) : 0);
}

function currentPart(player) {
  const area = player.getArea?.();
  return area?.lampPart ?? null;
}

function skills(player) {
  const manager = player.getSkillManager();
  return manager.getCurrentLevel(core.Skill.FIREMAKING) >= LEVEL && manager.getCurrentLevel(core.Skill.CRAFTING) >= LEVEL;
}

/** Fixes a broken lamp with a held light orb. Returns false if this isn't one of the player's broken lamps. */
function fix(player, objectId) {
  const lamp = (catalogue(), byId.get(objectId));
  if (!lamp) return false;
  const brokenNames = broken(player);
  if (!brokenNames.includes(lamp.name)) return false;
  const inventory = player.getInventory();
  const I = core.ItemIdentifiers;
  if (!inventory.contains(I.LIGHT_ORB)) {
    player.sendMessage(inventory.contains(I.EMPTY_LIGHT_ORB) ? FILAMENT : NOTHING);
    return true;
  }
  if (!skills(player)) {
    player.sendMessage(`You need a Firemaking and Crafting level of ${LEVEL} to fix this lamp.`);
    return true;
  }
  inventory.deleteNumber(I.LIGHT_ORB, 1);
  const manager = player.getSkillManager();
  const fixed = (Number(player.getAttribute(FIXED_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(FIXED_ATTRIBUTE, fixed);
  manager.addExperiences(core.Skill.FIREMAKING, XP);
  manager.addExperiences(core.Skill.CRAFTING, XP);
  const next = brokenNames.filter(name => name !== lamp.name);
  next.push(pickWorking(next, lamp.name));
  player.setAttribute(BROKEN_ATTRIBUTE, next);
  // The Wiki: "a filtered chatbox message will appear after every lamp fixed".
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, `You replace the orb. Total lights fixed: ${fixed.toLocaleString("en-GB")}`);
  if (fixed % BATCH === 0) {
    manager.addExperiences(core.Skill.FIREMAKING, BATCH_XP);
    manager.addExperiences(core.Skill.CRAFTING, BATCH_XP);
    player.sendMessage(BATCH_MESSAGE);
  }
  sync(player, currentPart(player) ?? lamp.part);
  api.emitCustomEvent(FIXED_EVENT, { player, itemId: I.LIGHT_ORB, lamp: lamp.name, location: new core.Location(lamp.x, lamp.y, lamp.z) });
  return true;
}

/** A lamp that isn't one of the player's broken ones falls through (it can look broken across the line). */
function fixOption(event) {
  return fix(event.player, event.objectId);
}

function orbOnLamp(event) {
  return fix(event.player, event.objectId);
}

function emptyOrbOnLamp(event) {
  const lamp = (catalogue(), byId.get(event.objectId));
  if (!lamp || !broken(event.player).includes(lamp.name)) return false;
  event.player.sendMessage(FILAMENT);
  return true;
}

function createPart(z, half) {
  const south = half === "south";
  const boundary = new core.Boundary(CITY.west, CITY.east, south ? CITY.south : CITY.line, south ? CITY.line - 1 : CITY.north, z);
  const part = `${z}:${half}`;
  return new (class extends core.Area {
    constructor() {
      super([boundary]);
      this.lampPart = part;
    }

    postEnter(mobile) {
      if (mobile.isPlayer()) sync(mobile.getAsPlayer(), part);
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer() && !logout) sync(mobile.getAsPlayer(), null);
    }
  })();
}

function registerParts() {
  for (const z of PLANES) for (const half of ["north", "south"]) api.registerArea(createPart(z, half));
}

module.exports = {
  name: "DorgeshKaanLamps",
  members: true,
  register(registry) {
    api = registry;
    core = api.core;
    api.persistAttribute(BROKEN_ATTRIBUTE, []);
    api.persistAttribute(FIXED_ATTRIBUTE, 0);
    api.onObjectInteraction("Broken lamp", { Fix: fixOption });
    api.onItemOnObject("Light orb", "Broken lamp", orbOnLamp, { noted: false });
    api.onItemOnObject("Empty light orb", "Broken lamp", emptyOrbOnLamp, { noted: false });
    registerParts();
  },
  _test: {
    BROKEN_ATTRIBUTE, FIXED_ATTRIBUTE, FIXED_EVENT, LAMPS_VARBIT, catalogue, broken, varbitValue, fix, partOf,
    setRandom(fn) { random = fn; },
  },
};
