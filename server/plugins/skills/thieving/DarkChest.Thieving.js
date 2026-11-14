/**
 * The Dark Chest in the Crumbling Tower basement, under the Isle of Souls (loc sw_dungeon_key_chest_closed,
 * open variant sw_dungeon_key_chest_open), "Open" with a dark key. Wiki: https://oldschool.runescape.wiki/w/Dark_Chest.
 *
 * Wiki: 28 Thieving ("You need a Thieving level of 28 to be able to open this chest."), the key used up,
 * 1,500 Thieving experience, the chest slamming shut for up to 10 damage, and the loot table below (out of 600,
 * after three 1/600 pre-rolls).
 *
 * rsprox.net captures (recordings 1842 and local 1000195, rev 227, Leagues V; 4 opens), ticks from the click
 * on an adjacent chest:
 * - 0: human_openchest and sound 52 (both delay 10), "You use a key to unlock the chest." (spam), varbit busy 1.
 * - 1: "You steal some loot from the chest." (spam), the key gone, the loot, the Thieving XP (24,000 at
 *   Leagues' 16x) and the chest open.
 * - 2: sound 51 (delay 15).
 * - 3: "The chest slams shut on your hands." (spam), a hit (6, 8, 9 and 9 captured) with the player's own
 *   hurt voice (518 and 520, delay 20), the chest closed and busy 0.
 *
 * Ours: no capture opens the chest without a key or with a full pack. Without a key the player gets the
 * server's "Nothing interesting happens." and nothing else. With no free slot the dungeon's other chest's
 * "You don't have enough inventory space to take anything from the chest." (local 1000195) is sent before the key
 * is used; one free slot always holds a loot (every loot is one item stack). A pre-roll that hits replaces the
 * main roll. The slam's damage is 1 to 10, even. A key gone by the loot tick (dropped mid-open) ends the open there,
 * with nothing given.
 */
const ObstacleRunner = require("../agility/ObstacleRunner.Agility");
const PlayerHitSounds = require("../../combat/PlayerHitSounds.plugin");

const CHEST = "sw_dungeon_key_chest_closed";
const CHEST_OPEN = "sw_dungeon_key_chest_open";
const LEVEL = 28;
const XP = 1500;
const DAMAGE = Object.freeze({ min: 1, max: 10 });
const SOUND = Object.freeze({ UNLOCK: 52, LOOT: 51 });
const MESSAGE = Object.freeze({
  UNLOCK: { spam: "You use a key to unlock the chest." },
  LOOT: { spam: "You steal some loot from the chest." },
  SLAM: { spam: "The chest slams shut on your hands." },
});
const LEVEL_MESSAGE = `You need a Thieving level of ${LEVEL} to be able to open this chest.`;
/** Ours: the server's reply to an option with no response (no capture clicks it without a key). */
const NO_KEY_MESSAGE = "Nothing interesting happens.";
const FULL_MESSAGE = "You don't have enough inventory space to take anything from the chest.";

/** Wiki pre-rolls: [ItemIdentifiers key, chance out of 600], each before the main table. */
const PRE_ROLLS = Object.freeze([
  ["SHIELD_LEFT_HALF", 1],
  ["DRAGON_PLATESKIRT", 1],
  ["DRAGON_PLATELEGS", 1],
]);
const PRE_ROLL_OUT_OF = 600;

/** Wiki loot table: [ItemIdentifiers key, min, max, weight out of 600, noted]. */
const LOOT = Object.freeze([
  ["RUNE_PICKAXE", 1, 1, 15],
  ["RUNE_AXE", 1, 1, 15],
  ["RUNE_LONGSWORD", 1, 1, 5],
  ["RUNE_KITESHIELD", 1, 1, 10],
  ["RUNE_CHAINBODY", 1, 1, 10],
  ["MIND_RUNE", 400, 600, 25],
  ["CHAOS_RUNE", 300, 500, 25],
  ["BLOOD_RUNE", 100, 200, 25],
  ["NATURE_RUNE", 150, 350, 25],
  ["LAW_RUNE", 100, 300, 27],
  ["DEATH_RUNE", 200, 400, 27],
  ["ADAMANT_ARROW", 200, 400, 40],
  ["RUNE_ARROW", 100, 300, 30],
  ["GRIMY_DWARF_WEED", 10, 15, 25, true],
  ["GRIMY_TORSTOL", 10, 15, 25, true],
  ["GRIMY_RANARR_WEED", 10, 15, 25, true],
  ["GRIMY_SNAPDRAGON", 10, 15, 25, true],
  ["GREEN_DRAGON_LEATHER", 5, 10, 20, true],
  ["BLUE_DRAGON_LEATHER", 5, 10, 20, true],
  ["RED_DRAGON_LEATHER", 5, 10, 20, true],
  ["BLACK_DRAGON_LEATHER", 5, 10, 20, true],
  ["BABYDRAGON_BONES", 10, 15, 35, true],
  ["DRAGON_BONES", 10, 15, 20, true],
  ["COINS", 9500, 29500, 69],
  ["DRAGONSTONE", 1, 1, 10],
  ["DARK_KEY", 2, 2, 7],
]);

let api;
let core;
let ids = null;
/** ObstacleRunner is set up on the first open, not at attach (unit tests attach with a partial api). */
let runnerReady = false;
/** The unit's rolls; tests replace it. */
let random = Math.random;
/** Players mid-open. */
const opening = new WeakSet();
/** Open chests by tile: { closed, open, token }. */
const opened = new Map();

function resolveIds() {
  if (ids) return ids;
  const cache = core.CacheDefinitions;
  ids = {
    chest: cache.getLocId(CHEST),
    chestOpen: cache.getLocId(CHEST_OPEN),
    openChest: cache.getSeqId("human_openchest"),
    busy: cache.getVarbitId("busy"),
  };
  return ids;
}

const tileKey = (location) => `${location.getX()},${location.getY()},${location.getZ()}`;

function itemId(key, noted) {
  const id = core.ItemIdentifiers[key];
  return noted ? core.ItemDefinition.forId(id).getNoteId() : id;
}

/** One opening's loot: a pre-roll's item, else one roll of the main table. */
function rollLoot() {
  for (const [key, chance] of PRE_ROLLS) {
    if (random() * PRE_ROLL_OUT_OF < chance) return new core.Item(itemId(key, false), 1);
  }
  const total = LOOT.reduce((sum, row) => sum + row[3], 0);
  let roll = random() * total;
  let row = LOOT[LOOT.length - 1];
  for (const entry of LOOT) {
    roll -= entry[3];
    if (roll < 0) { row = entry; break; }
  }
  const [key, min, max, , noted] = row;
  const amount = min + Math.floor(random() * (max - min + 1));
  return new core.Item(itemId(key, noted), amount);
}

function giveLoot(player) {
  const inventory = player.getInventory();
  inventory.delete(core.ItemIdentifiers.DARK_KEY, 1, false);
  const item = rollLoot();
  // A free slot is checked at the click, so only a stack at its limit can refuse a loot: then none is given.
  if (inventory.getAddableAmount(item) >= item.getAmount()) inventory.add(item, false);
  inventory.refreshItems();
  player.getSkillManager().addExperiences(core.Skill.THIEVING, XP);
  api.emitCustomEvent("chest:opened", { player, objectId: resolveIds().chest });
}

/** The chest shows open until the slam, 2 ticks after the latest loot. */
function openChest(object) {
  const key = tileKey(object.getLocation());
  let state = opened.get(key);
  if (!state) {
    const closed = object;
    const open = new core.GameObject(resolveIds().chestOpen, closed.getLocation().clone(), closed.getType(), closed.getFace(), closed.getPrivateArea());
    state = { closed, open, token: 0 };
    opened.set(key, state);
    core.ObjectManager.deregister(closed, true);
    core.ObjectManager.register(open, true);
  }
  return { key, state, token: ++state.token };
}

function closeChest({ key, state, token }) {
  if (state.token !== token || opened.get(key) !== state) return;
  opened.delete(key);
  core.ObjectManager.deregister(state.open, true);
  core.ObjectManager.register(state.closed, true);
}

/** The slam: 1 to 10 (Wiki "up to 10"), in the player's own hurt voice. */
function slam(player) {
  const damage = DAMAGE.min + Math.floor(random() * (DAMAGE.max - DAMAGE.min + 1));
  const hit = new core.HitDamage(damage, core.HitMask.RED).onApplied((taken) => {
    if (taken > 0) PlayerHitSounds.playOwnHurtSound(player);
  });
  player.getCombat().getHitQueue().addPendingDamage([hit]);
}

function steps(player, object, run) {
  const id = resolveIds();
  let shown = null;
  return [
    { anim: id.openChest, delay: 10 },
    { sound: SOUND.UNLOCK, delay: 10 },
    { msg: MESSAGE.UNLOCK },
    { varbit: [id.busy, 1] },
    { wait: 1 },
    // Ours: a key dropped since the click ends the open here, with no loot, XP or slam (no capture drops it mid-open).
    { run: () => { if (!player.getInventory().contains(core.ItemIdentifiers.DARK_KEY)) run.task?.stop(); } },
    { msg: MESSAGE.LOOT },
    { run: () => { giveLoot(player); shown = openChest(object); } },
    { wait: 1 },
    { sound: SOUND.LOOT, delay: 15 },
    { wait: 1 },
    { msg: MESSAGE.SLAM },
    { run: () => { slam(player); if (shown) closeChest(shown); } },
    { varbit: [id.busy, 0] },
  ];
}

function open(event) {
  const { player, object } = event;
  if (!player || !object || object.getId() !== resolveIds().chest) return false;
  if (opening.has(player) || ObstacleRunner.isBusy(player)) return true;
  if (player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < LEVEL) {
    player.sendMessage(LEVEL_MESSAGE);
    return true;
  }
  const inventory = player.getInventory();
  if (!inventory.contains(core.ItemIdentifiers.DARK_KEY)) {
    player.sendMessage(NO_KEY_MESSAGE);
    return true;
  }
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage(FULL_MESSAGE);
    return true;
  }
  player.setPositionToFace(object.getLocation());
  if (!runnerReady) {
    ObstacleRunner.init(api);
    runnerReady = true;
  }
  opening.add(player);
  const run = { task: null };
  run.task = ObstacleRunner.run({ player, object }, steps(player, object, run), {
    keepAnimation: true,
    onFinish: (completed) => {
      opening.delete(player);
      if (completed) return;
      // An open cut short (death, logout) never reaches its slam: close the chest and clear busy.
      player.getPacketSender().sendVarbit(resolveIds().busy, 0);
      const state = opened.get(tileKey(object.getLocation()));
      if (state) closeChest({ key: tileKey(object.getLocation()), state, token: state.token });
    },
  });
  return true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  ids = null;
  runnerReady = false;
  pluginApi.onObjectInteraction("Dark Chest", { Open: open });
};
module.exports._test = {
  rollLoot, open, opened, LOOT, PRE_ROLLS, LEVEL, XP, DAMAGE,
  setRandom(fn) { random = fn ?? Math.random; },
};
