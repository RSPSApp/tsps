// Shipwreck salvaging: a boat's salvaging hook (Deploy) reels salvage in from a raised wreck
// nearby for Sailing XP, and a salvaging station (on a boat or at a port) sorts it into loot
// for more. Messages, animations, sounds and the timings of casting and sorting are from live
// captures; levels, XP, success charts and loot tables from the OSRS Wiki, via
// sailing-salvage.json (docs/sailing-osrs-reference.md).
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { CacheDefinitions } = require("../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { content, setVarbit, playSound, animateDeckLoc } = require("./sailingContent");
const facilities = require("./boatFacilities");
const shipwrecks = require("./shipwrecks");

const SEQ_CAST = 13576;
const SEQ_HOOK_IDLE = 13577;
const LOC_ANIM_CAST = 13573;
const LOC_ANIM_IDLE = 13574;
const SEQ_SORT = 13599;
const SOUND_SORT = 10864;
const SOUND_SORT_NEXT = 10866;
const SOUND_SORTED = 10860;
/** `sailing_sidepanel_player_at_facility_n`: 19193 + n for hotspots 0-10 (19200 is 7, as captured). */
const VARBIT_AT_FACILITY0 = 19193;
const AT_FACILITY_HOTSPOTS = 11;
/** How far (tiles) from the hook a wreck can be: about 8 in OSRS, as played. */
const HOOK_RANGE = 8;
/** Ticks from the cast until the hook settles, and until its first roll (captured: settled at 3, salvage at 10). */
const SETTLE_TICKS = 3;
const FIRST_ROLL_TICKS = 6;
/** Players roll every 4 ticks (OSRS Wiki). */
const ROLL_TICKS = 4;
/** Sorting takes 3 ticks a salvage (captured). */
const SORT_TICKS = 3;

const NO_WRECK = "There are no shipwrecks within range of the salvaging hook.";
const CAST = "You cast out your salvaging hook towards the shipwreck...";
const REELED = "You reel in some salvage.";
const SUNK = "You salvage all you can from the shipwreck before it is reclaimed by the sea.";
const FULL = "Your inventory is too full to hold any more salvage.";
const SORT_BEGIN = "You begin sorting through your salvage...";
const SORT_DONE = "You have no more salvage to sort.";

/** Per player: what they're doing (salvaging or sorting), so a new action replaces the old. */
const sessions = new Map();

function salvageData() {
  return content().salvage;
}

/** A hook's tier (0 bronze … 6 dragon) from its name, or -1. */
function hookTierOf(name) {
  const match = /^(\w+) salvaging hook$/.exec(name ?? "");
  return match ? salvageData().hookTiers.indexOf(match[1]) : -1;
}

/** The standard OSRS skilling chance: `low` at level 1 to `high` at 99, out of 256. */
function successChance(low, high, level) {
  const clamped = Math.max(1, Math.min(99, level));
  return (1 + Math.floor((low * (99 - clamped)) / 98 + (high * (clamped - 1)) / 98 + 0.5)) / 256;
}

function hasFreeSlot(player) {
  return player.getInventory().getFreeSlots() > 0;
}

function stop(player) {
  const session = sessions.get(player);
  if (!session) return;
  sessions.delete(player);
  session.task.stop();
  if (session.hotspot !== undefined) setVarbit(player, VARBIT_AT_FACILITY0 + session.hotspot, 0);
  player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
}

function begin(player, session, tick) {
  stop(player);
  session.task = new (class extends Task {
    constructor() { super(1, player); }
    execute() {
      if (sessions.get(player) !== session) return this.stop();
      tick(this);
    }
  })();
  sessions.set(player, session);
  TaskManager.submit(session.task);
}

function moved(player) {
  return player.getMovementQueue().size() > 0 || !player.isRegistered?.() || player.getHitpoints?.() <= 0;
}

/** Where a hook on a deck is in the world. */
function hookTile(boat, hook) {
  const tile = boat.deckTileToWorld(boat.deckBaseX + hook.x, boat.deckBaseY + hook.y);
  return { x: tile.x, y: tile.y, level: boat.level };
}

/**
 * Where a player faces to work a hook: out over its side of the boat (a west hotspot faces
 * west, an east one east), or the hook itself when its side isn't known.
 */
function outwardFrom(boat, hook, owned, hotspot) {
  const side = owned && hotspot !== undefined ? facilities.hotspotsOf(owned.type)[hotspot]?.side : undefined;
  const dx = side === 1 ? -1 : side === 3 ? 1 : 0;
  return new Location(boat.deckBaseX + hook.x + dx, boat.deckBaseY + hook.y, 0);
}

/** A salvaging hook's Deploy: cast it towards the nearest raised wreck in range. */
function deployHook(event) {
  if (event.clickType !== 1 || event.definition?.getInteractions?.()?.[0] !== "Deploy") return;
  const tier = hookTierOf(event.definition.getName?.());
  const { player } = event;
  const boat = tier >= 0 ? BoatManager.getBoatAboard(player) : undefined;
  if (!boat) return;
  event.handled = true;
  const x = event.location.x - boat.deckBaseX;
  const y = event.location.y - boat.deckBaseY;
  const hook = BoatManager.getSpec(boat)?.locs.find((loc) => loc.x === x && loc.y === y && loc.shape === 10);
  if (!hook) return;
  const at = hookTile(boat, hook);
  const wreck = shipwrecks.raisedWreckNear(at.x, at.y, at.level, HOOK_RANGE);
  if (!wreck) {
    player.sendMessage(NO_WRECK);
    return;
  }
  const type = shipwrecks.wreckType(wreck.type);
  if (player.getSkillManager().getCurrentLevel(Skill.SAILING) < type.level) {
    player.sendMessage(`You need a Sailing level of at least ${type.level} to salvage this shipwreck.`);
    return;
  }
  if (!hasFreeSlot(player)) {
    player.sendMessage(FULL);
    return;
  }
  const owned = Sailing.instanceAboard(player) === boat ? Sailing.activeBoat(player) : undefined;
  const hotspot = owned ? facilities.hotspotAt(owned, x, y) : undefined;
  const session = {
    boat, hook, wreck, tier, generation: wreck.generation, ticks: 0,
    hotspot: hotspot !== undefined && hotspot < AT_FACILITY_HOTSPOTS ? hotspot : undefined,
  };
  player.sendMessage(CAST);
  player.setPositionToFace(outwardFrom(boat, hook, owned, hotspot));
  player.performAnimation(new Animation(SEQ_CAST));
  animateDeckLoc(player, boat, hook, LOC_ANIM_CAST);
  shipwrecks.startDespawn(wreck);
  begin(player, session, () => salvageTick(player, session));
}

function salvageTick(player, session) {
  const { boat, hook, wreck } = session;
  if (moved(player) || BoatManager.getBoatAboard(player) !== boat) return stop(player);
  if (wreck.generation !== session.generation) {
    player.sendMessage(SUNK);
    return stop(player);
  }
  const at = hookTile(boat, hook);
  if (shipwrecks.distanceTo(wreck, at.x, at.y) > HOOK_RANGE || wreck.z !== at.level) return stop(player);
  session.ticks++;
  if (session.ticks === SETTLE_TICKS && session.hotspot !== undefined) {
    setVarbit(player, VARBIT_AT_FACILITY0 + session.hotspot, 1);
  }
  if (session.ticks >= SETTLE_TICKS) {
    player.performAnimation(new Animation(SEQ_HOOK_IDLE));
    animateDeckLoc(player, boat, hook, LOC_ANIM_IDLE);
  }
  if (session.ticks < FIRST_ROLL_TICKS || (session.ticks - FIRST_ROLL_TICKS) % ROLL_TICKS !== 0) return;
  const type = shipwrecks.wreckType(wreck.type);
  const [low, high] = type.success[session.tier];
  if (Math.random() >= successChance(low, high, player.getSkillManager().getCurrentLevel(Skill.SAILING))) return;
  if (!hasFreeSlot(player)) {
    player.sendMessage(FULL);
    return stop(player);
  }
  player.getInventory().addItem(new Item(type.salvage, 1));
  player.sendMessage(REELED);
  player.getSkillManager().addExperiences(Skill.SAILING, type.xp);
}

/** Rolls a salvage's loot: its pre-rolls first, then its main table; undefined is nothing. */
function rollLoot(salvage, random = Math.random) {
  const quantity = (line) => line.min + Math.floor(random() * (line.max - line.min + 1));
  for (const line of salvage.preRolls) {
    if (random() < 1 / line.oneIn) return { item: line.item, amount: quantity(line) };
  }
  let roll = Math.floor(random() * salvage.total);
  for (const line of salvage.table) {
    if (roll < line.weight) return { item: line.item, amount: quantity(line) };
    roll -= line.weight;
  }
  return undefined;
}

/** The first salvage in the inventory, with its sorting data. */
function nextSalvage(player) {
  const table = salvageData().salvage;
  const inventory = player.getInventory();
  for (const id of Object.keys(table)) {
    if (inventory.getAmount(Number(id)) > 0) return { id: Number(id), data: table[id] };
  }
  return undefined;
}

/** A salvaging station's Sort-salvage: sorts every salvage in the inventory, one each 3 ticks. */
function sortSalvage({ player }) {
  if (!nextSalvage(player)) {
    player.sendMessage(SORT_DONE);
    return;
  }
  player.sendMessage(SORT_BEGIN);
  player.performAnimation(new Animation(SEQ_SORT));
  playSound(player, SOUND_SORT);
  const session = { ticks: 0, sorted: 0 };
  begin(player, session, () => sortTick(player, session));
}

function sortTick(player, session) {
  if (moved(player)) return stop(player);
  session.ticks++;
  if (session.ticks % SORT_TICKS !== 0) return;
  const next = nextSalvage(player);
  if (!next) return stop(player);
  const level = player.getSkillManager().getCurrentLevel(Skill.SAILING);
  if (level < next.data.level) {
    player.sendMessage(`You need a Sailing level of at least ${next.data.level} to sort ${next.data.name.toLowerCase()}.`);
    return stop(player);
  }
  player.getInventory().delete(next.id, 1);
  const loot = rollLoot(next.data);
  const salvageName = next.data.name.toLowerCase();
  if (loot) {
    player.getInventory().addItem(new Item(loot.item, loot.amount));
    const itemName = CacheDefinitions.getItem(loot.item)?.name ?? "something";
    player.sendMessage(`You sort through the ${salvageName} and find: ${loot.amount} x ${itemName}.`);
  } else {
    player.sendMessage(`You sort through the ${salvageName} and find nothing.`);
  }
  player.getSkillManager().addExperiences(Skill.SAILING, next.data.xp);
  playSound(player, SOUND_SORTED);
  session.sorted++;
  if (!nextSalvage(player)) {
    player.sendMessage(SORT_DONE);
    return stop(player);
  }
  player.performAnimation(new Animation(SEQ_SORT));
  playSound(player, session.sorted === 1 ? SOUND_SORT : SOUND_SORT_NEXT);
}

function startShipwrecks() {
  shipwrecks.start();
}

function forgetSession({ player }) {
  stop(player);
}

module.exports = {
  name: "SailingSalvaging",
  members: true,
  hookTierOf,
  successChance,
  rollLoot,
  outwardFrom,
  register(api) {
    api.onServerStartup(startShipwrecks);
    api.onObjectInteraction(deployHook);
    api.onObjectInteraction("Salvaging station", { "Sort-salvage": sortSalvage });
    api.onPlayerLogout(forgetSession);
  },
};
