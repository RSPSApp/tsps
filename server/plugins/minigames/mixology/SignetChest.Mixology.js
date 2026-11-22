"use strict";

/**
 * The chest in the lab's basement by the stairs (loc alchemist_signet_chest at 1386, 9315; open variant
 * alchemist_signet_chest_open), "Open" with an alchemist's signet (alchemist_ring).
 * Wiki: https://oldschool.runescape.wiki/w/Chest_(alchemist%27s_signet)
 *
 * Wiki: the signet is used up and the chest gives four stacks: a noted aldarium, one roll of the secondaries
 * and seeds table, one noted grimy herb of the useful herb table and two noted grimy herbs of the combat herb
 * table (tables below; the herb rates 1/3.2, 1/4, 1/4, 1/5.3 are 5, 4, 4, 3 out of 16). Its lines are "The
 * alchemist's signet fits perfectly into an indent on the chest, causing it to open..." and "You take some
 * loot from inside." (the captures agree).
 *
 * rsprox.net captures (recording 4185, rev 238, Leagues VI; 8 clicks: 3 opens, 5 refusals), ticks from the first response:
 * - 0: human_openchest and sound 52 (both delay 10), the signet line (game message), varbit busy 1.
 * - 1: the loot line (game message), the chest open, the signet gone and the four stacks.
 * - 2: sound 51 (delay 15).
 * - 3: the chest closed, busy 0.
 * - Without a signet: sound 2402 and a message box, "The chest appears tightly locked, but it has a ring shaped
 *   indent on the front of it...". With signets but fewer than four free slots: a message box, "You need at
 *   least four free inventory spaces to take anything from this chest." Both set busy 1 with the box, and
 *   busy 0 when it is dismissed (ticks 34/36, 101/105, 1081/1084, 1122/1124).
 *
 * Ours: no capture opens it without a signet and with a full pack, so the signet is checked first. A
 * box closed by any other route (walking away) also clears busy. A signet gone by the loot tick (dropped
 * mid-open) ends the open there, with nothing given; so does a loot stack that can't fit (a stack at its
 * limit), with the four-spaces box and the signet kept.
 */

const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
const Shared = require("./Shared.Mixology");

const CHEST = "alchemist_signet_chest";
const CHEST_OPEN = "alchemist_signet_chest_open";
const FREE_SLOTS = 4;
const SOUND = Object.freeze({ UNLOCK: 52, LOOT: 51, LOCKED: 2402 });
const MESSAGE = Object.freeze({
  UNLOCK: "The alchemist's signet fits perfectly into an indent on the chest, causing it to open...",
  LOOT: "You take some loot from inside.",
  LOCKED: "The chest appears tightly locked, but it has a ring shaped indent on the front of it...",
  FULL: "You need at least four free inventory spaces to take anything from this chest.",
});

/** Wiki: [ItemIdentifiers key, min, max, weight, noted]. Each table is rolled once per open. */
const ALDARIUM = Object.freeze(["ALDARIUM", 1, 1, 1, true]);
const SECONDARIES = Object.freeze([
  ["MORT_MYRE_FUNGUS", 5, 8, 5, true],
  ["SNAPE_GRASS", 3, 5, 5, true],
  ["WINE_OF_ZAMORAK", 2, 4, 3, true],
  ["HARRALANDER_SEED", 2, 3, 3, false],
  ["IRIT_SEED", 2, 3, 3, false],
  ["AVANTOE_SEED", 2, 3, 3, false],
  ["TOADFLAX_SEED", 2, 3, 2, false],
  ["RANARR_SEED", 1, 2, 1, false],
]);
const USEFUL_HERBS = Object.freeze([
  ["GRIMY_AVANTOE", 1, 1, 5, true],
  ["GRIMY_RANARR_WEED", 1, 1, 4, true],
  ["GRIMY_SNAPDRAGON", 1, 1, 4, true],
  ["GRIMY_TORSTOL", 1, 1, 3, true],
]);
const COMBAT_HERBS = Object.freeze([
  ["GRIMY_KWUARM", 2, 2, 5, true],
  ["GRIMY_DWARF_WEED", 2, 2, 4, true],
  ["GRIMY_CADANTINE", 2, 2, 4, true],
  ["GRIMY_LANTADYME", 2, 2, 3, true],
]);

let api;
let ids = null;
let runnerReady = false;
/** The unit's rolls; tests replace it. */
let random = Math.random;
const opening = new WeakSet();
/** Open chests by tile: { closed, open, token }. */
const opened = new Map();

const core = () => Shared.core();

function resolveIds() {
  if (ids) return ids;
  const cache = core().CacheDefinitions;
  ids = {
    chest: cache.getLocId(CHEST),
    chestOpen: cache.getLocId(CHEST_OPEN),
    openChest: cache.getSeqId("human_openchest"),
    busy: cache.getVarbitId("busy"),
    signet: core().ItemIdentifiers.ALCHEMISTS_SIGNET,
  };
  return ids;
}

const tileKey = (location) => `${location.getX()},${location.getY()},${location.getZ()}`;

function itemId(key, noted) {
  const id = core().ItemIdentifiers[key];
  return noted ? core().ItemDefinition.forId(id).getNoteId() : id;
}

function roll(table) {
  const total = table.reduce((sum, row) => sum + row[3], 0);
  let left = random() * total;
  let row = table[table.length - 1];
  for (const entry of table) {
    left -= entry[3];
    if (left < 0) { row = entry; break; }
  }
  const [key, min, max, , noted] = row;
  return new (core().Item)(itemId(key, noted), min + Math.floor(random() * (max - min + 1)));
}

/** One open's four stacks, in the Wiki's order. */
function rollLoot() {
  return [roll([ALDARIUM]), roll(SECONDARIES), roll(USEFUL_HERBS), roll(COMBAT_HERBS)];
}

/**
 * Live fills the slots aldarium, combat herbs, useful herb, then the secondary or seed (rec 4185: the freed
 * signet slot takes the combat herbs).
 */
function addOrder([aldarium, secondary, useful, combat]) {
  return [aldarium, combat, useful, secondary];
}

/**
 * Ours: on the loot tick the click's rule is checked again (four free slots: the pack may have filled since,
 * from unequipping mid-open), and every stack must fit (a stack at its limit can't take more), else nothing
 * is used.
 */
function fits(player, loot) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < FREE_SLOTS) return false;
  return loot.every((item) => inventory.getAddableAmount(item) >= item.getAmount());
}

function giveLoot(player, loot) {
  const inventory = player.getInventory();
  inventory.delete(resolveIds().signet, 1, false);
  for (const item of addOrder(loot)) inventory.add(item, false);
  inventory.refreshItems();
}

/** The chest shows open until two ticks after the latest loot. */
function showOpen(object) {
  const { GameObject, ObjectManager } = core();
  const key = tileKey(object.getLocation());
  let state = opened.get(key);
  if (!state) {
    const closed = object;
    const open = new GameObject(resolveIds().chestOpen, closed.getLocation().clone(), closed.getType(), closed.getFace(), closed.getPrivateArea());
    state = { closed, open, token: 0 };
    opened.set(key, state);
    ObjectManager.deregister(closed, true);
    ObjectManager.register(open, true);
  }
  return { key, state, token: ++state.token };
}

function showClosed({ key, state, token }) {
  if (state.token !== token || opened.get(key) !== state) return;
  opened.delete(key);
  core().ObjectManager.deregister(state.open, true);
  core().ObjectManager.register(state.closed, true);
}

function steps(player, object, run) {
  const id = resolveIds();
  return [
    { anim: id.openChest, delay: 10 },
    { sound: SOUND.UNLOCK, delay: 10 },
    { msg: MESSAGE.UNLOCK },
    { varbit: [id.busy, 1] },
    { wait: 1 },
    { run: () => {
      if (!player.getInventory().contains(id.signet)) { run.task?.stop(); return; }
      run.loot = rollLoot();
      if (!fits(player, run.loot)) { run.task?.stop(); refuse(player, MESSAGE.FULL, 0); }
    } },
    { msg: MESSAGE.LOOT },
    { run: () => { giveLoot(player, run.loot); run.shown = showOpen(object); } },
    { wait: 1 },
    { sound: SOUND.LOOT, delay: 15 },
    { wait: 1 },
    { run: () => { if (run.shown) showClosed(run.shown); } },
    { varbit: [id.busy, 0] },
  ];
}

/** Players with a refusal box up: its close, by any route, clears busy. */
const refused = new WeakSet();

/** A refusal's message box, with busy 1 until it is dismissed (rec 4185). */
function refuse(player, text, sound) {
  const sender = player.getPacketSender();
  if (sound) sender.sendSoundEffect(sound, 1, 0);
  Shared.statement(player, text);
  sender.sendVarbit(resolveIds().busy, 1);
  refused.add(player);
}

function closed({ player }) {
  if (!player || !refused.has(player)) return;
  refused.delete(player);
  player.getPacketSender().sendVarbit(resolveIds().busy, 0);
}

function open(event) {
  const { player, object } = event;
  if (!player || !object || object.getId() !== resolveIds().chest) return false;
  if (opening.has(player) || ObstacleRunner.isBusy(player)) return true;
  const inventory = player.getInventory();
  player.setPositionToFace(object.getLocation());
  if (!inventory.contains(resolveIds().signet)) {
    refuse(player, MESSAGE.LOCKED, SOUND.LOCKED);
    return true;
  }
  if (inventory.getFreeSlots() < FREE_SLOTS) {
    refuse(player, MESSAGE.FULL, 0);
    return true;
  }
  if (!runnerReady) {
    ObstacleRunner.init(api);
    runnerReady = true;
  }
  opening.add(player);
  const run = { task: null, shown: null, loot: null };
  run.task = ObstacleRunner.run({ player, object }, steps(player, object, run), {
    keepAnimation: true,
    onFinish: (completed) => {
      opening.delete(player);
      // Closed whatever the outcome: a fast-forwarded run skips the closing step.
      if (run.shown) showClosed(run.shown);
      if (!completed) player.getPacketSender().sendVarbit(resolveIds().busy, 0);
    },
  });
  return true;
}

module.exports = function attachSignetChest(pluginApi) {
  api = pluginApi;
  ids = null;
  runnerReady = false;
  pluginApi.onObjectInteraction("Chest", { Open: open });
  pluginApi.onCustomEvent("interface:closed", closed);
};
module.exports._test = {
  rollLoot, opened, MESSAGE, SECONDARIES, USEFUL_HERBS, COMBAT_HERBS,
  setRandom(fn) { random = fn ?? Math.random; },
};
