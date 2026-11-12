/**
 * The thieving chest in the Isle of Souls Dungeon (loc sw_dungeon_thieving_chest_closed, open variant
 * sw_dungeon_thieving_chest_open), "Picklock". Wiki: https://oldschool.runescape.wiki/w/Chest_(Isle_of_Souls_Dungeon).
 *
 * Wiki: 28 Thieving, 150 experience a loot, the loot back 2 ticks later; the unlock roll is the skilling chart
 * -23/153 out of 256, a carried lockpick adding 26 to both (Mod Ash); a failed roll springs the trap 1 time in 6,
 * teleporting the player north-east of the dungeon entrance; the loot table below, out of 200.
 *
 * rsprox.net captures (recordings 91, 92, 95 and 1842, rev 227, Leagues V; 906 attempts, 55 traps), ticks from
 * the click on an adjacent chest:
 * - 0: human_lockedchest, sound 1243, "You attempt to picklock the chest." (spam); 1: varbit busy 1.
 * - Unlocked, 2: human_openchest and sound 52 (both delay 10), "You manage to unlock the chest."; 3: "You steal
 *   some loot from the chest.", the loot, the Thieving XP (2,400 at Leagues' 16x) and the chest open;
 *   4: sound 51 (delay 15); 5: the chest closed again and busy 0. Other players' loots open it meanwhile
 *   without stopping the attempt (recordings 91, 95).
 * - Failed, 2: sound 2402, "You fail to picklock the chest.", busy 0.
 * - Trapped, 2: as failed, plus human_castteleport, teleport_casting (height 92) and area sound 200 (range
 *   10); 4: "You have activated a trap on the chest."; 5: busy 0 and the player teleported (sequence -1) to a
 *   random tile of 2321-2327, 2930-2936 (the 55 landings fill that square).
 *
 * Ours: whether a whole loot fits is checked when it lands (the Wiki's "nothing whenever the player only has one
 * free inventory slot, when two unstackable items would be awarded", applied to any loot that does not fit), and
 * a medium clue the player cannot hold (one per tier, through the treasure-trails services) is no loot either;
 * no level refusal is captured, so the stalls' "You need a Thieving level of at least 28 to do this." is used.
 */
const ObstacleRunner = require("../agility/ObstacleRunner.Agility");

const CHEST = "sw_dungeon_thieving_chest_closed";
const CHEST_OPEN = "sw_dungeon_thieving_chest_open";
const LEVEL = 28;
const XP = 150;
/** Wiki (Module:Skilling success chart), Mod Ash: -23/153, a lockpick +26 to both. */
const CHANCE = Object.freeze({ low: -23, high: 153, lockpick: 26 });
const TRAP_CHANCE = 1 / 6;
const OPEN_TICKS = 2;
/** The trap's landings, north-east of the dungeon entrance (2308, 2918). */
const TRAP_AREA = Object.freeze({ minX: 2321, maxX: 2327, minY: 2930, maxY: 2936 });

const SOUND = Object.freeze({ ATTEMPT: 1243, FAIL: 2402, UNLOCK: 52, LOOT: 51, TRAP: 200 });
const TRAP_SOUND_RADIUS = 10;
const MESSAGE = Object.freeze({
  ATTEMPT: { spam: "You attempt to picklock the chest." },
  FAIL: { spam: "You fail to picklock the chest." },
  UNLOCK: { spam: "You manage to unlock the chest." },
  LOOT: { spam: "You steal some loot from the chest." },
  TRAP: { spam: "You have activated a trap on the chest." },
});

/** Wiki loot table: [ItemIdentifiers key, min, max, weight out of 200]. */
const LOOT = Object.freeze([
  ["COINS", 90, 190, 20],
  ["FEATHER", 30, 80, 20],
  ["CHOCOLATE_BAR", 1, 1, 6],
  ["BIRD_SNARE", 1, 2, 6],
  ["BOX_TRAP", 1, 2, 6],
  ["GRIMY_GUAM_LEAF", 1, 2, 20],
  ["GRIMY_LANTADYME", 1, 1, 12],
  ["GRIMY_RANARR_WEED", 1, 1, 10],
  ["UNCUT_SAPPHIRE", 1, 2, 8],
  ["UNCUT_EMERALD", 1, 2, 8],
  ["UNCUT_RUBY", 1, 2, 6],
  ["UNCUT_DIAMOND", 1, 2, 4],
  ["MITHRIL_PICKAXE", 1, 1, 6],
  ["MITHRIL_AXE", 1, 1, 6],
  ["ADAMANT_SCIMITAR", 1, 1, 4],
  ["MIND_RUNE", 1, 10, 15],
  ["NATURE_RUNE", 1, 2, 20],
  ["DEATH_RUNE", 1, 2, 20],
  ["CLUE_SCROLL_MEDIUM_", 1, 1, 2],
  ["DARK_KEY", 1, 1, 1],
]);

let api;
let core;
let ids = null;
/** ObstacleRunner is set up on the first attempt, not at attach (unit tests attach with a partial api). */
let runnerReady = false;
/** The unit's rolls; tests replace it. */
let random = Math.random;
/** Players mid-attempt. */
const attempts = new WeakSet();
/** Open chests by tile: { closed, opened, token }. */
const opened = new Map();

function resolveIds() {
  if (ids) return ids;
  const cache = core.CacheDefinitions;
  ids = {
    chest: cache.getLocId(CHEST),
    chestOpen: cache.getLocId(CHEST_OPEN),
    lockedChest: cache.getSeqId("human_lockedchest"),
    openChest: cache.getSeqId("human_openchest"),
    castTeleport: cache.getSeqId("human_castteleport"),
    castGfx: cache.getSpotanimId("teleport_casting"),
    busy: cache.getVarbitId("busy"),
  };
  return ids;
}

const tileKey = (location) => `${location.getX()},${location.getY()},${location.getZ()}`;

/** Wiki (Module:Skilling success chart): low/high interpolated by level, out of 256. */
function successChance(level, lockpick) {
  const bonus = lockpick ? CHANCE.lockpick : 0;
  const low = CHANCE.low + bonus;
  const high = CHANCE.high + bonus;
  return Math.max(0, Math.min(1, (1 + Math.floor(low * (99 - level) / 98 + high * (level - 1) / 98 + 0.5)) / 256));
}

/** One roll of the table: an Item, or null when the roll is a medium clue the player cannot hold. */
function rollLoot(player) {
  const total = LOOT.reduce((sum, row) => sum + row[3], 0);
  let roll = random() * total;
  let row = LOOT[LOOT.length - 1];
  for (const entry of LOOT) {
    roll -= entry[3];
    if (roll < 0) { row = entry; break; }
  }
  const [key, min, max] = row;
  const amount = min + Math.floor(random() * (max - min + 1));
  if (key === "CLUE_SCROLL_MEDIUM_") return clue(player);
  return new core.Item(core.ItemIdentifiers[key], amount);
}

/** A medium clue through the shared clue services: one per tier, a scroll box after X Marks the Spot. */
function clue(player) {
  const allowed = { player, tier: "medium", allowed: null };
  api.emitCustomEvent("treasure-trails:can-receive", allowed);
  if (allowed.allowed === false) {
    api.emitCustomEvent("treasure-trails:missed-clue", { player, tier: "medium" });
    return null;
  }
  const award = { player, itemId: core.ItemIdentifiers.CLUE_SCROLL_MEDIUM_, box: false };
  api.emitCustomEvent("treasure-trails:clue-item", award);
  return new core.Item(award.itemId, 1);
}

/** The whole item fits: a stack it joins, or a free slot per unstackable item. */
function fits(player, item) {
  return player.getInventory().getAddableAmount(item) >= item.getAmount();
}

function giveLoot(player) {
  const item = rollLoot(player);
  if (item && fits(player, item)) {
    player.getInventory().add(item, false);
    player.getInventory().refreshItems();
  }
  player.getSkillManager().addExperiences(core.Skill.THIEVING, XP);
  api.emitCustomEvent("chest:opened", { player, objectId: resolveIds().chest });
}

/** The chest shows open for everyone until 2 ticks after the latest loot. */
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
  const token = ++state.token;
  core.TaskManager.submit(new core.CountdownTask(state.open, OPEN_TICKS, () => {
    if (state.token !== token || opened.get(key) !== state) return;
    opened.delete(key);
    core.ObjectManager.deregister(state.open, true);
    core.ObjectManager.register(state.closed, true);
  }));
}

function trapTile() {
  const x = TRAP_AREA.minX + Math.floor(random() * (TRAP_AREA.maxX - TRAP_AREA.minX + 1));
  const y = TRAP_AREA.minY + Math.floor(random() * (TRAP_AREA.maxY - TRAP_AREA.minY + 1));
  return [x, y, 0];
}

function steps(player, object, outcome) {
  const id = resolveIds();
  const start = [
    { anim: id.lockedChest },
    { sound: SOUND.ATTEMPT },
    { msg: MESSAGE.ATTEMPT },
    { wait: 1 },
    { varbit: [id.busy, 1] },
    { wait: 1 },
  ];
  if (outcome === "unlock") {
    return [...start,
      { anim: id.openChest, delay: 10 },
      { sound: SOUND.UNLOCK, delay: 10 },
      { msg: MESSAGE.UNLOCK },
      { wait: 1 },
      { msg: MESSAGE.LOOT },
      { run: () => { giveLoot(player); openChest(object); } },
      { wait: 1 },
      { sound: SOUND.LOOT, delay: 15 },
      { wait: 1 },
      { varbit: [id.busy, 0] },
    ];
  }
  const failed = [{ sound: SOUND.FAIL }, { msg: MESSAGE.FAIL }];
  if (outcome === "fail") return [...start, ...failed, { varbit: [id.busy, 0] }];
  const at = player.getLocation();
  return [...start,
    { anim: id.castTeleport },
    { gfx: id.castGfx, height: 92 },
    { areaSound: SOUND.TRAP, at: [at.getX(), at.getY(), at.getZ()], radius: TRAP_SOUND_RADIUS },
    ...failed,
    { wait: 2 },
    { msg: MESSAGE.TRAP },
    { wait: 1 },
    { varbit: [id.busy, 0] },
    { anim: -1 },
    { tele: trapTile() },
  ];
}

function hasLockpick(player) {
  return player.getInventory().contains(core.ItemIdentifiers.LOCKPICK);
}

function outcomeFor(player) {
  const level = player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);
  if (random() < successChance(level, hasLockpick(player))) return "unlock";
  return random() < TRAP_CHANCE ? "trap" : "fail";
}

function picklock(event) {
  const { player, object } = event;
  if (!player || !object || object.getId() !== resolveIds().chest) return false;
  if (attempts.has(player) || ObstacleRunner.isBusy(player)) return true;
  if (player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < LEVEL) {
    player.sendMessage(`You need a Thieving level of at least ${LEVEL} to do this.`);
    return true;
  }
  player.setPositionToFace(object.getLocation());
  const outcome = outcomeFor(player);
  if (!runnerReady) {
    ObstacleRunner.init(api);
    runnerReady = true;
  }
  attempts.add(player);
  ObstacleRunner.run({ player, object }, steps(player, object, outcome), {
    keepAnimation: true,
    onFinish: (completed) => {
      attempts.delete(player);
      // An attempt cut short (death, logout) never reaches its busy 0.
      if (!completed) player.getPacketSender().sendVarbit(resolveIds().busy, 0);
    },
  });
  return true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  ids = null;
  runnerReady = false;
  pluginApi.onObjectInteraction("Chest", { Picklock: picklock });
};
module.exports._test = {
  successChance, rollLoot, picklock, opened, LOOT, TRAP_AREA, LEVEL, XP,
  setRandom(fn) { random = fn ?? Math.random; },
};
