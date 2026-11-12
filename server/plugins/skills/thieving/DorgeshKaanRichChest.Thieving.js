/**
 * Dorgesh-Kaan's rich chests (loc dorgesh_rich_chest_closed, 8 placements on the city's first and second
 * floors), "Pick-lock". Wiki: https://oldschool.runescape.wiki/w/Chest_(Dorgesh-Kaan_Rich).
 *
 * Wiki: 78 Thieving (not boostable) and a lockpick (a hair clip works too, 30 June 2016); 650 Thieving
 * experience a loot; the loot respawns every 300 seconds; one roll of the 15-row table below, each row 1/15;
 * cave goblin wire comes as 2 with the elite Lumbridge & Draynor Diary (8 May 2024). Looting one is the elite
 * task "Steal from a Dorgesh-Kaan rich chest."
 *
 * rsprox.net captures, ticks from the player's arrival beside the chest:
 * - recording 1843 (rev 227, Leagues V, one loot, ticks 4870-4877):
 *   0: the player faces the chest, sound 2419, "You attempt to pick the lock." and "You manage to pick
 *   the lock." (spam); 1: varbit busy 1; 2: "You open the chest." (spam), sound 52; 4: human_lockedchest,
 *   "You find treasure inside!" (spam), the chest open (dorgesh_rich_chest_open), the loot (an iron bar),
 *   the Thieving XP (10,400 at Leagues' 16x: 650) and the diary task; 7: the chest closed and empty
 *   (dorgesh_rich_chest_closed_empty) and busy 0.
 * - recording 3197 (rev 232, a normal world, two other players' loots seen): open -> empty after 3 ticks
 *   (1834 -> 1837, 1847 -> 1850), empty -> full again after 499 ticks (1837 -> 2336, 1850 -> 2349), the
 *   Wiki's 300 seconds. Each chest empties and refills for everyone on its own.
 *
 * Ours (nothing captured): the level, lockpick and full-inventory refusals (the stalls' and the Ardougne castle
 * chest's lines); an attempt ends without loot if the player moves, dies, logs out or the chest is emptied by
 * someone else before tick 4; Open, and Pick-lock on an empty chest, are not answered here.
 */
const LEVEL = 78;
const XP = 650;
const RESPAWN_TICKS = 499;
const SOUND = Object.freeze({ ATTEMPT: 2419, OPEN: 52 });
const TICK = Object.freeze({ BUSY: 1, OPEN: 2, LOOT: 4, EMPTY: 7 });
const MESSAGE = Object.freeze({
  ATTEMPT: "You attempt to pick the lock.",
  PICKED: "You manage to pick the lock.",
  OPEN: "You open the chest.",
  LOOT: "You find treasure inside!",
  LEVEL: `You need a Thieving level of at least ${LEVEL} to do this.`,
  LOCKPICK: "You need a lockpick to pick this lock.",
});
const DIARY = Object.freeze({ diary: "lumbridge", tier: "elite", task: "steal-from-a-dorgesh-kaan-rich-chest" });

/** Wiki loot table, each row 1/15: [ItemIdentifiers key, amount]. Items are the pages' default (unlit) versions. */
const LOOT = Object.freeze([
  ["UNCUT_SAPPHIRE", 1],
  ["UNCUT_EMERALD", 1],
  ["UNCUT_RUBY", 1],
  ["UNCUT_DIAMOND", 1],
  ["UNCUT_OPAL", 1],
  ["UNCUT_JADE", 1],
  ["UNCUT_RED_TOPAZ", 1],
  ["BULLSEYE_LANTERN", 1],
  ["MINING_HELMET_2", 1],
  ["FROG_LEATHER_CHAPS", 1],
  ["FROG_LEATHER_BODY", 1],
  ["IRON_BAR", 1],
  ["CAVE_GOBLIN_WIRE", 1],
  ["LIGHT_ORB", 1],
  ["EMPTY_LIGHT_ORB", 1],
]);
const WIRE = "CAVE_GOBLIN_WIRE";
const ELITE_WIRE = 2;

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
  ids = {
    chest: cache.getLocId("dorgesh_rich_chest_closed"),
    open: cache.getLocId("dorgesh_rich_chest_open"),
    empty: cache.getLocId("dorgesh_rich_chest_closed_empty"),
    seq: cache.getSeqId("human_lockedchest"),
    busy: cache.getVarbitId("busy"),
  };
  return ids;
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

function rollLoot(player) {
  const [key, base] = LOOT[Math.min(LOOT.length - 1, Math.floor(random() * LOOT.length))];
  const amount = key === WIRE && eliteDone(player) ? ELITE_WIRE : base;
  return new core.Item(core.ItemIdentifiers[key], amount);
}

/** The chest shown to everyone: replaces the loc at the same tile, shape and rotation. */
function place(current, id) {
  const next = new core.GameObject(id, current.getLocation().clone(), current.getType(), current.getFace(), current.getPrivateArea?.() ?? null);
  core.ObjectManager.deregister(current, true);
  core.ObjectManager.register(next, true);
  return next;
}

/** Open now, closed and empty 3 ticks on, full again 499 ticks after that. */
function emptyChest(chest) {
  const key = tileKey(chest.getLocation());
  emptied.add(key);
  const open = place(chest, resolveIds().open);
  core.TaskManager.submit(new core.CountdownTask(open, TICK.EMPTY - TICK.LOOT, () => {
    const empty = place(open, resolveIds().empty);
    core.TaskManager.submit(new core.CountdownTask(empty, RESPAWN_TICKS, () => {
      emptied.delete(key);
      place(empty, chest.getId());
    }));
  }));
}

function loot(player, chest) {
  emptyChest(chest);
  player.performAnimation(new core.Animation(resolveIds().seq));
  spam(player, MESSAGE.LOOT);
  player.getInventory().add(rollLoot(player));
  player.getSkillManager().addExperiences(core.Skill.THIEVING, XP);
  api.emitCustomEvent("diary:task", { player, diary: DIARY.diary, task: DIARY.task });
}

function stillThere(player, origin, area) {
  return player.isRegistered() && player.getHitpoints() > 0 && !player.isDyingReturn?.()
    && player.getLocation().equals(origin) && player.getPrivateArea() === area;
}

function pickLock(event) {
  const { player, object } = event;
  if (event.objectId !== resolveIds().chest || emptied.has(tileKey(object.getLocation()))) return false;
  event.handled = true;
  if (attempts.has(player)) return;
  if (player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < LEVEL) { player.sendMessage(MESSAGE.LEVEL); return; }
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
  const finish = (task) => { attempts.delete(player); setBusy(player, 0); task.stop(); };
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player.getIndex()); }
    execute() {
      elapsed += 1;
      if (!looted && (!stillThere(player, origin, area) || emptied.has(tileKey(object.getLocation())))) { finish(this); return; }
      if (elapsed === TICK.BUSY) setBusy(player, 1);
      if (elapsed === TICK.OPEN) {
        spam(player, MESSAGE.OPEN);
        player.getPacketSender().sendSound(SOUND.OPEN, 1, 0);
      }
      if (elapsed === TICK.LOOT) { looted = true; loot(player, object); }
      if (elapsed >= TICK.EMPTY) finish(this);
    }
  })());
}

module.exports = function registerDorgeshKaanRichChest(registry) {
  api = registry;
  core = registry.core;
  registry.onObjectInteraction("Chest", { "Pick-lock": pickLock });
};

module.exports._test = {
  LEVEL, XP, RESPAWN_TICKS, LOOT, MESSAGE, DIARY,
  setRandom(fn) { random = fn; },
  reset() { emptied.clear(); ids = null; random = Math.random; },
};
