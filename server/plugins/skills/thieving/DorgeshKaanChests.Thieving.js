/**
 * Dorgesh-Kaan's lockable chests, "Pick-lock": the rich chests (loc dorgesh_rich_chest_closed, 8 placements on the
 * city's first and second floors) and the average chests (loc dorgesh_average_chest_closed, 17 placements on all three
 * floors). Wiki: https://oldschool.runescape.wiki/w/Chest_(Dorgesh-Kaan_Rich),
 * https://oldschool.runescape.wiki/w/Chest_(Dorgesh-Kaan_Average).
 *
 * Rich, Wiki: 78 Thieving (not boostable) and a lockpick (a hair clip works too, 30 June 2016); 650 Thieving
 * experience a loot; the loot respawns every 300 seconds; one roll of the 15-row table below, each row 1/15;
 * cave goblin wire comes as 2 with the elite Lumbridge & Draynor Diary (8 May 2024). Looting one is the elite
 * task "Steal from a Dorgesh-Kaan rich chest."
 *
 * Average, Wiki: 52 Thieving and a lockpick (the Strange old lockpick doesn't work); 200 Thieving experience a loot;
 * the loot respawns every 90 seconds. Three tables by chest: the normal one (coins 1-250 3/7, then an oil lantern, a
 * bullseye lantern, a mining helmet or cave goblin wire, 1/7 each), Zanik's two chests (23 rows, 1/23 each; the easy
 * clue scroll is coins 1-250 when the player already has an easy clue) and Oldak's chest (20 rows, 1/20 each). Wire is
 * 2 with the elite diary in every table.
 *
 * rsprox.net captures, ticks from the player's arrival beside the chest:
 * - rich, recording 1843 (rev 227, Leagues V, one loot, ticks 4870-4877):
 *   0: the player faces the chest, sound 2419, "You attempt to pick the lock." and "You manage to pick
 *   the lock." (spam); 1: varbit busy 1; 2: "You open the chest." (spam), sound 52; 4: human_lockedchest,
 *   "You find treasure inside!" (spam), the chest open (dorgesh_rich_chest_open), the loot (an iron bar),
 *   the Thieving XP (10,400 at Leagues' 16x: 650) and the diary task; 7: the chest closed and empty
 *   (dorgesh_rich_chest_closed_empty) and busy 0.
 * - rich, recording 3197 (rev 232, a normal world, two other players' loots seen): open -> empty after 3 ticks
 *   (1834 -> 1837, 1847 -> 1850), empty -> full again after 499 ticks (1837 -> 2336, 1850 -> 2349), the
 *   Wiki's 300 seconds. Each chest empties and refills for everyone on its own.
 * - average, local recordings 1000195-1000215 (rev 227, Leagues V, 29 loots on the ground floor): the same timeline
 *   as the rich chest, with dorgesh_average_chest_open at 4 and dorgesh_average_chest_closed_empty 3 ticks later, the
 *   XP 2,400 at Leagues' 12x (200); the chest full again 149 ticks after it emptied (1000195 ticks 17138 -> 17287,
 *   the Wiki's 90 seconds). Pick-lock on an emptied chest: "It looks like this chest has already been looted."
 *   (game message, 1000195 tick 17141). Open on a full one: sound 2402 and "This chest is locked." (1000210 tick 38).
 *   Too low a level (41 Thieving, 1000416 tick 11095): "You attempt to pick the lock." (spam), then a message box
 *   "You are not a high enough level to pick this lock.", no sound.
 *
 * Ours (nothing captured): the rich chest's level, lockpick and full-inventory refusals (the stalls' and the Ardougne
 * castle chest's lines; the level is the unboosted one, Wiki Boostable=No) and the average chest's lockpick and
 * full-inventory ones; the average chest's level is unboosted too, like the rich one's; amounts in a range are
 * uniform; also when the inventory fills before the loot tick (the chest stays full); an attempt ends without loot if
 * the player moves, dies, logs out or the chest is emptied by someone else before tick 4, and walking off or clicking
 * again ends it at once (the engine cancels the task). The rich chest's Open, and Pick-lock on an empty rich chest,
 * are not answered here.
 */
const SOUND = Object.freeze({ ATTEMPT: 2419, OPEN: 52, LOCKED: 2402 });
const TICK = Object.freeze({ BUSY: 1, OPEN: 2, LOOT: 4, EMPTY: 7 });
const MESSAGE = Object.freeze({
  ATTEMPT: "You attempt to pick the lock.",
  PICKED: "You manage to pick the lock.",
  OPEN: "You open the chest.",
  LOOT: "You find treasure inside!",
  LEVEL: "You need a Thieving level of at least 78 to do this.",
  LOCKPICK: "You need a lockpick to pick this lock.",
  AVERAGE_LEVEL: "You are not a high enough level to pick this lock.",
  LOOTED: "It looks like this chest has already been looted.",
  LOCKED: "This chest is locked.",
});
const DIARY = Object.freeze({ diary: "lumbridge", tier: "elite", task: "steal-from-a-dorgesh-kaan-rich-chest" });
const WIRE = "dorgesh_wire";
const ELITE_WIRE = 2;

/** One row: [obj gameval, amount or [min, max]]. Items are the pages' default (unlit) versions. */
const RICH_LOOT = Object.freeze([
  ["uncut_sapphire", 1], ["uncut_emerald", 1], ["uncut_ruby", 1], ["uncut_diamond", 1], ["uncut_opal", 1],
  ["uncut_jade", 1], ["uncut_red_topaz", 1], ["bullseye_lantern_unlit", 1], ["cave_goblin_mining_helmet_unlit", 1],
  ["dorgesh_frog_armour_bottoms", 1], ["dorgesh_frog_armour_top", 1], ["iron_bar", 1], [WIRE, 1],
  ["dorgesh_light_bulb", 1], ["dorgesh_lightbulb_nofilament", 1],
]);
/** Wiki: coins 3/7, the other four rows 1/7 each, so coins fill three of seven slots. */
const AVERAGE_LOOT = Object.freeze([
  ["coins", [1, 250]], ["coins", [1, 250]], ["coins", [1, 250]],
  ["oil_lantern_unlit", 1], ["bullseye_lantern_unlit", 1], ["cave_goblin_mining_helmet_unlit", 1], [WIRE, 1],
]);
const CLUE = "clue";
const ZANIK_LOOT = Object.freeze([
  [CLUE, 1], ["rope", 1], ["cave_goblin_mining_helmet_unlit", 1], ["dorgesh_frog_armour_top", 1],
  ["dorgesh_frog_armour_bottoms", 1], ["oil_lantern_unlit", 1], ["bullseye_lantern_unlit", 1], ["newcomer_map", 1],
  ["dttd_bone_crossbow_bolt", [1, 89]], ["dttd_bone_crossbow", 1], ["dttd_bone_dagger", 1], ["hammer", 1],
  ["big_bones", 1], ["ham_hood", 1], ["ham_badge", 1], ["ham_shirt", 1], ["ham_robe", 1], ["ham_gloves", 1],
  ["ham_cloak", 1], ["ham_boots", 1], ["spade", 1], ["bucket_empty", 1], [WIRE, 1],
]);
const OLDAK_LOOT = Object.freeze([
  ["airrune", [10, 19]], ["mindrune", [10, 19]], ["waterrune", [10, 19]], ["earthrune", [10, 19]],
  ["firerune", [10, 19]], ["bodyrune", [10, 19]], ["cosmicrune", [5, 9]], ["chaosrune", [5, 9]], ["lawrune", [5, 9]],
  ["naturerune", [2, 4]], ["deathrune", [2, 4]], ["dorgesh_teleport_artifact", 1], ["stafforb", 1], [WIRE, 1],
  ["dorgesh_lightbulb_nofilament", 1], ["dorgesh_light_bulb", 1], ["air_talisman", 1], ["water_talisman", 1],
  ["earth_talisman", 1], ["fire_talisman", 1],
]);
/** Wiki: the easy clue row of Zanik's table pays coins 1-250 when the player already has an easy clue. */
const CLUE_COINS = Object.freeze(["coins", [1, 250]]);
/** The cache's placements of the special average chests (the Wiki's map pins, its floor 2 drawn 128 tiles north-east). */
const OLDAK_CHESTS = Object.freeze(["2706,5364,2"]);
const ZANIK_CHESTS = Object.freeze(["2743,5350,2", "2746,5350,2"]);

const KINDS = Object.freeze({
  rich: Object.freeze({
    locs: { chest: "dorgesh_rich_chest_closed", open: "dorgesh_rich_chest_open", empty: "dorgesh_rich_chest_closed_empty" },
    level: 78, xp: 650, respawnTicks: 499, diary: DIARY,
  }),
  average: Object.freeze({
    locs: { chest: "dorgesh_average_chest_closed", open: "dorgesh_average_chest_open", empty: "dorgesh_average_chest_closed_empty" },
    level: 52, xp: 200, respawnTicks: 149, diary: null,
  }),
});

let api;
let core;
let ids = null;
/** The unit's rolls; tests replace it. */
let random = Math.random;
/** Players mid-attempt. */
const attempts = new WeakSet();
/** Chests looted and not yet refilled, by tile. */
const emptied = new Set();

function resolveIds() {
  if (ids) return ids;
  const cache = core.CacheDefinitions;
  const locs = (kind) => Object.fromEntries(Object.entries(KINDS[kind].locs).map(([key, name]) => [key, cache.getLocId(name)]));
  ids = {
    rich: locs("rich"),
    average: locs("average"),
    seq: cache.getSeqId("human_lockedchest"),
    busy: cache.getVarbitId("busy"),
  };
  return ids;
}

/** Which kind a loc id is, and in which state: { kind, state } or null. */
function chestOf(objectId) {
  const resolved = resolveIds();
  for (const kind of Object.keys(KINDS)) {
    for (const [state, id] of Object.entries(resolved[kind])) if (id === objectId) return { kind, state };
  }
  return null;
}

const tileKey = (location) => `${location.getX()},${location.getY()},${location.getZ()}`;

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

function setBusy(player, value) {
  const busy = resolveIds().busy;
  if (busy != null) player.getPacketSender().sendVarbit(busy, value);
}

function hasLockpick(player) {
  const inventory = player.getInventory();
  const { LOCKPICK, HAIR_CLIP } = core.ItemIdentifiers;
  return inventory.contains(LOCKPICK) || inventory.contains(HAIR_CLIP);
}

function eliteDone(player) {
  const request = { player, diary: DIARY.diary, tier: DIARY.tier, complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function questComplete(player, key) {
  const request = { player, key, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return typeof request.complete === "boolean" ? request.complete : Number(player.getAttribute(`quest.${key}.stage`)) >= 2;
}

/**
 * Wiki (Clue scroll): one clue of each tier at a time unless the clue capacity allows more, carried or banked. The
 * clue capacity plugin answers; an unanswered request means the player can take one.
 */
function ownsEasyClue(player) {
  const request = { player, tier: "easy", allowed: null };
  api.emitCustomEvent("treasure-trails:can-receive", request);
  return request.allowed === false;
}

function tableFor(kind, location) {
  if (kind === "rich") return RICH_LOOT;
  const key = tileKey(location);
  if (OLDAK_CHESTS.includes(key)) return OLDAK_LOOT;
  if (ZANIK_CHESTS.includes(key)) return ZANIK_LOOT;
  return AVERAGE_LOOT;
}

function amountOf(amount) {
  if (!Array.isArray(amount)) return amount;
  const [min, max] = amount;
  return min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
}

function rollLoot(player, kind, location) {
  const table = tableFor(kind, location);
  let [name, amount] = table[Math.min(table.length - 1, Math.floor(random() * table.length))];
  if (name === CLUE) {
    if (ownsEasyClue(player)) [name, amount] = CLUE_COINS;
    else {
      const { CLUE_SCROLL_EASY_, SCROLL_BOX_EASY_ } = core.ItemIdentifiers;
      return new core.Item(questComplete(player, "x_marks_the_spot") ? SCROLL_BOX_EASY_ : CLUE_SCROLL_EASY_, 1);
    }
  }
  const count = name === WIRE && eliteDone(player) ? ELITE_WIRE : amountOf(amount);
  return new core.Item(core.CacheDefinitions.getObjId(name), count);
}

/** The chest shown to everyone: replaces the loc at the same tile, shape and rotation. */
function place(current, id) {
  const next = new core.GameObject(id, current.getLocation().clone(), current.getType(), current.getFace(), current.getPrivateArea?.() ?? null);
  core.ObjectManager.deregister(current, true);
  core.ObjectManager.register(next, true);
  return next;
}

/** Open now, closed and empty 3 ticks on, full again the kind's respawn ticks after that. */
function emptyChest(chest, kind) {
  const key = tileKey(chest.getLocation());
  const kindIds = resolveIds()[kind];
  emptied.add(key);
  const open = place(chest, kindIds.open);
  core.TaskManager.submit(new core.CountdownTask(open, TICK.EMPTY - TICK.LOOT, () => {
    const empty = place(open, kindIds.empty);
    core.TaskManager.submit(new core.CountdownTask(empty, KINDS[kind].respawnTicks, () => {
      emptied.delete(key);
      place(empty, chest.getId());
    }));
  }));
}

/**
 * The roll goes in the backpack. The elite pair of wire is two unstackable items, so with one
 * free slot the wire that doesn't fit lands under the player instead of being lost (Ours: no
 * capture shows a pair meeting one free slot).
 */
function give(player, item) {
  const inventory = player.getInventory();
  const fits = item.getDefinition().isStackable() ? item.getAmount() : Math.min(item.getAmount(), inventory.getFreeSlots());
  if (fits > 0) inventory.add(new core.Item(item.getId(), fits));
  if (fits < item.getAmount()) {
    core.ItemOnGroundManager.registerLocation(player, new core.Item(item.getId(), item.getAmount() - fits), player.getLocation().clone());
  }
}

function loot(player, chest, kind) {
  emptyChest(chest, kind);
  player.performAnimation(new core.Animation(resolveIds().seq));
  spam(player, MESSAGE.LOOT);
  give(player, rollLoot(player, kind, chest.getLocation()));
  player.getSkillManager().addExperiences(core.Skill.THIEVING, KINDS[kind].xp);
  const diary = KINDS[kind].diary;
  if (diary) api.emitCustomEvent("diary:task", { player, diary: diary.diary, task: diary.task });
}

function stillThere(player, origin, area) {
  return player.isRegistered() && player.getHitpoints() > 0 && !player.isDyingReturn?.()
    && player.getLocation().equals(origin) && player.getPrivateArea() === area;
}

/** Too low a level for an average chest: the attempt line, then a message box (1000416). */
function averageLevelRefusal(player) {
  spam(player, MESSAGE.ATTEMPT);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, MESSAGE.AVERAGE_LEVEL)));
}

function pickLock(event) {
  const { player, object } = event;
  const chest = chestOf(event.objectId);
  if (!chest) return false;
  const { kind, state } = chest;
  if (kind === "average" && state === "empty") {
    event.handled = true;
    player.setPositionToFace(object.getLocation());
    player.sendMessage(MESSAGE.LOOTED);
    return;
  }
  if (state !== "chest" || emptied.has(tileKey(object.getLocation()))) return false;
  event.handled = true;
  if (attempts.has(player)) return;
  const level = KINDS[kind].level;
  if (player.getSkillManager().getMaxLevel(core.Skill.THIEVING) < level) {
    if (kind === "average") averageLevelRefusal(player);
    else player.sendMessage(MESSAGE.LEVEL);
    return;
  }
  if (!hasLockpick(player)) { player.sendMessage(MESSAGE.LOCKPICK); return; }
  if (player.getInventory().isFull()) { player.getInventory().full(); return; }

  attempts.add(player);
  player.setPositionToFace(object.getLocation());
  player.getPacketSender().sendSound(SOUND.ATTEMPT, 1, 0);
  spam(player, MESSAGE.ATTEMPT);
  spam(player, MESSAGE.PICKED);
  const origin = player.getLocation().clone();
  const area = player.getPrivateArea();
  let elapsed = 0;
  let looted = false;
  let ended = false;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player.getIndex()); }
    /** Every end frees the player: our own, and the engine's cancelTasks on a walk or another click. */
    stop() {
      super.stop();
      if (ended) return;
      ended = true;
      attempts.delete(player);
      setBusy(player, 0);
    }
    execute() {
      elapsed += 1;
      if (!looted && (!stillThere(player, origin, area) || emptied.has(tileKey(object.getLocation())))) { this.stop(); return; }
      if (elapsed === TICK.BUSY) setBusy(player, 1);
      if (elapsed === TICK.OPEN) {
        spam(player, MESSAGE.OPEN);
        player.getPacketSender().sendSound(SOUND.OPEN, 1, 0);
      }
      if (elapsed === TICK.LOOT) {
        if (player.getInventory().isFull()) { player.getInventory().full(); this.stop(); return; }
        looted = true;
        loot(player, object, kind);
      }
      if (elapsed >= TICK.EMPTY) this.stop();
    }
  })());
}

/** Open on a full average chest: it's locked (1000210). An emptied one isn't answered (nothing captured). */
function open(event) {
  const { player, object } = event;
  const chest = chestOf(event.objectId);
  if (chest?.kind !== "average" || chest.state !== "chest") return false;
  event.handled = true;
  player.setPositionToFace(object.getLocation());
  player.getPacketSender().sendSound(SOUND.LOCKED, 1, 0);
  player.sendMessage(MESSAGE.LOCKED);
}

module.exports = function registerDorgeshKaanChests(registry) {
  api = registry;
  core = registry.core;
  registry.onObjectInteraction("Chest", { Open: open, "Pick-lock": pickLock });
};

module.exports._test = {
  LEVEL: KINDS.rich.level, XP: KINDS.rich.xp, RESPAWN_TICKS: KINDS.rich.respawnTicks, LOOT: RICH_LOOT, MESSAGE, DIARY, KINDS,
  AVERAGE_LOOT, ZANIK_LOOT, OLDAK_LOOT, OLDAK_CHESTS, ZANIK_CHESTS,
  setRandom(fn) { random = fn; },
  reset() { emptied.clear(); ids = null; random = Math.random; },
};
