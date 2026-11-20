/**
 * Lock-picking doors that nothing answered (issue #5744). Each is a cache loc named "Door" with Open and Pick-lock,
 * so a click did nothing at all. Wiki pages: https://oldschool.runescape.wiki/w/Door_(Magic_axe_hut),
 * /w/Door_(Pirates%27_Hideout), /w/Door_(East_Ardougne) and /w/Door_(Chaos_Druid_Tower).
 *
 * | Door | Loc | Thieving | XP | Lockpick |
 * | --- | --- | --- | --- | --- |
 * | Magic axe hut (3190,3957 and 3191,3963) | 11726 | 32 | 22.5 | yes |
 * | Pirates' Hideout (3038,3956, 3041,3959, 3044,3956) | 11727 | 39 | 35 | yes |
 * | East Ardougne house, north wall (2674,3305) | 11719 | 1 | 3.8 | no |
 * | East Ardougne house, south wall (2674,3304) | 11720 | 16 | 15 | no |
 * | Chaos Druid Tower (2565,3356) | 11723 | 46 | 37.5 | no |
 * | Ardougne Sewers gate (2655,9714 and 2655,9715), from the west | 11722, 11721 | 31 | 25 | no |
 *
 * The cache also places the East Ardougne pair at 3378,5929 and 3378,5928, with the same rotations; they are kept alike.
 *
 * Every page: a failed pick is retried by clicking again, and a door needs no picking from the inside. The East
 * Ardougne page says a door opened from the inside "will just open if attempted, displaying the message The door
 * is already unlocked." (taken for every door here). The Chaos Druid Tower door rolls twice: a trap first, which
 * deals 6% of maximum Hitpoints when it goes off, then the lock.
 *
 * The chances are the pages' charts, each as a roll out of 256 at two levels and linear between them: axe hut 25
 * at level 1 and 176 at 99, Pirates' Hideout 13 and 88, East Ardougne south 33 and 251 (the page gives no chart for the
 * north door; Ours: the same one), Chaos Druid Tower lock 9 and 76, its trap disarm 221 at level 1 rising to every
 * roll at 58. No rsprox capture touches these doors (a search of every local recording for OpLoc on these ids finds none).
 *
 * Ours (nothing captured): every message below except the inside one, the pick animation (the one Pyramid
 * Plunder's and the Forthos door's Pick-lock use), the unlock resolving on the click, the level being the current
 * (boostable) one, and Open from outside answering "The door is locked." (Yanille's door says the same).
 *
 * The Ardougne Sewers gate (https://oldschool.runescape.wiki/w/Gate_(Ardougne_Sewers), "Gate" with Open and
 * Pick-lock; chart 16 at level 1 and 100 at 99) is locked going east, towards the Rat Pits. rsprox capture 1625
 * (rev 226) has it: Open from the west plays synth 2402 with "The door is locked." (tick 1999); Pick-lock plays 2402,
 * "You attempt to pick the lock." (spam) and "You manage to pick the lock." with 25 XP in the same tick and no
 * animation, then the gate lets the player through (tick 2003); Open from the east says "You go through the door."
 * (spam) as it opens (tick 2512). The gate's swap and crossing are objects/Doors.plugin.js's pass-through gates.
 * Ours: the failure line and the inside Pick-lock reply are the doors' ones, and a failed pick plays 2402 too
 * (only a success is captured).
 *
 * Not done: Ross' House (40178), the H.A.M. Hideout jail door (5501) and the
 * Monkey Madness II door (28783). The wiki pages give their charts but not which side is "inside" (or the retry ramp the
 * jail door uses), and the last has no page.
 */
const LOCKPICK_ITEM = "LOCKPICK";
const PICK_ANIMATION = "human_pickuptable";
const MESSAGE = Object.freeze({
  LEVEL: (level) => `You need a Thieving level of ${level} to pick this lock.`,
  LOCKPICK: "You need a lockpick to pick this lock.",
  FAIL: "You fail to pick the lock.",
  PICKED: "You manage to pick the lock.",
  LOCKED: "The door is locked.",
  UNLOCKED: "The door is already unlocked.",
  TRAP: "You trigger a trap and take damage.",
});

/** A door's chart: a roll out of 256 at two levels, linear between and flat outside. */
const chart = (lowLevel, lowRoll, highLevel, highRoll) => Object.freeze({ lowLevel, lowRoll, highLevel, highRoll });
const HUT = Object.freeze({ level: 32, xp: 22.5, lockpick: true, chance: chart(1, 25, 99, 176) });
const HIDEOUT = Object.freeze({ level: 39, xp: 35, lockpick: true, chance: chart(1, 13, 99, 88) });
const ARDOUGNE_NORTH = Object.freeze({ level: 1, xp: 3.8, lockpick: false, chance: chart(1, 33, 99, 251) });
const ARDOUGNE_SOUTH = Object.freeze({ level: 16, xp: 15, lockpick: false, chance: chart(1, 33, 99, 251) });
/** Wiki: the trap rolls first (no level needed, every roll from level 58) and deals 6% of maximum Hitpoints. */
const DRUID_TOWER = Object.freeze({
  level: 46, xp: 37.5, lockpick: false, chance: chart(1, 9, 99, 76),
  trap: Object.freeze({ disarm: chart(1, 221, 58, 256), damage: 0.06 }),
});
/** Wiki level, XP and chart; rsprox 1625: the lock sound, the attempt and inside lines, no pick animation. */
const SEWER_GATE = Object.freeze({
  level: 31, xp: 25, lockpick: false, chance: chart(1, 16, 99, 100),
  sound: 2402, animation: false, attempt: "You attempt to pick the lock.", through: "You go through the door.",
});

/**
 * One row a placement ("id,x,y,z"): the Wiki door, and the two tiles either side of its wall. A player closer to
 * `inside` than to `outside` is inside and needs no lock-picking.
 */
const DOORS = new Map([
  ["11726,3190,3957,0", { door: HUT, inside: [3190, 3958], outside: [3190, 3957] }],
  ["11726,3191,3963,0", { door: HUT, inside: [3191, 3962], outside: [3191, 3963] }],
  ["11727,3038,3956,0", { door: HIDEOUT, inside: [3038, 3956], outside: [3037, 3956] }],
  ["11727,3041,3959,0", { door: HIDEOUT, inside: [3041, 3959], outside: [3041, 3960] }],
  ["11727,3044,3956,0", { door: HIDEOUT, inside: [3044, 3956], outside: [3045, 3956] }],
  ["11719,2674,3305,0", { door: ARDOUGNE_NORTH, inside: [2674, 3305], outside: [2674, 3306] }],
  ["11720,2674,3304,0", { door: ARDOUGNE_SOUTH, inside: [2674, 3304], outside: [2674, 3303] }],
  ["11719,3378,5929,0", { door: ARDOUGNE_NORTH, inside: [3378, 5929], outside: [3378, 5930] }],
  ["11720,3378,5928,0", { door: ARDOUGNE_SOUTH, inside: [3378, 5928], outside: [3378, 5927] }],
  ["11723,2565,3356,0", { door: DRUID_TOWER, inside: [2565, 3356], outside: [2564, 3356] }],
  ["11722,2655,9714,0", { door: SEWER_GATE, inside: [2656, 9714], outside: [2655, 9714] }],
  ["11721,2655,9715,0", { door: SEWER_GATE, inside: [2656, 9715], outside: [2655, 9715] }],
]);

let api;
let core;
/** Players whose unlock is opening the door: the "door:toggle" check below must let that Open through. */
const OPENERS = new WeakSet();
/** The unit's rolls; tests replace it. */
let random = Math.random;

const keyOf = (object) => {
  const at = object.getLocation();
  return `${object.getId()},${at.getX()},${at.getY()},${at.getZ()}`;
};

const distance = (from, tile) => Math.abs(from.getX() - tile[0]) + Math.abs(from.getY() - tile[1]);

function isInside(player, placement) {
  const at = player.getLocation();
  return distance(at, placement.inside) < distance(at, placement.outside);
}

/** A chart's roll out of 256 at a level: linear between its two levels, flat outside them. */
function rollAt(level, { lowLevel, lowRoll, highLevel, highRoll }) {
  const along = (Math.max(lowLevel, Math.min(highLevel, level)) - lowLevel) / (highLevel - lowLevel);
  return lowRoll + (highRoll - lowRoll) * along;
}

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

function lockSound(player, door) {
  if (door.sound != null) core.Sounds.sendSound(player, new core.Sound(door.sound, 1, 0, 0));
}

function successChance(door, level) {
  return Math.max(0, Math.min(256, rollAt(level, door.chance))) / 256;
}

function open(player, object) {
  const request = { player, object, objectId: object.getId(), location: object.getLocation(), handled: false };
  OPENERS.add(player);
  try {
    api.emitCustomEvent("door:open", request);
  } finally {
    OPENERS.delete(player);
  }
  return request.handled;
}

/** The Chaos Druid Tower's trap: it goes off when the disarm roll fails. */
function springTrap(player, door, level) {
  if (!door.trap || random() * 256 < rollAt(level, door.trap.disarm)) return;
  const skills = player.getSkillManager();
  const damage = Math.floor(skills.getMaxLevel(core.Skill.HITPOINTS) * door.trap.damage);
  player.sendMessage(MESSAGE.TRAP);
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
}

function pickLock({ player, object }) {
  const placement = object && DOORS.get(keyOf(object));
  if (!placement) return false;
  player.setPositionToFace(object.getLocation());
  if (isInside(player, placement)) {
    if (!open(player, object)) return true;
    player.sendMessage(MESSAGE.UNLOCKED);
    return true;
  }
  const { door } = placement;
  const level = player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);
  if (level < door.level) {
    player.sendMessage(MESSAGE.LEVEL(door.level));
    return true;
  }
  if (door.lockpick && !player.getInventory().contains(core.ItemIdentifiers[LOCKPICK_ITEM])) {
    player.sendMessage(MESSAGE.LOCKPICK);
    return true;
  }
  lockSound(player, door);
  if (door.attempt) spam(player, door.attempt);
  const sequence = door.animation === false ? null : core.CacheDefinitions.getSeqId(PICK_ANIMATION);
  if (sequence != null) player.performAnimation(new core.Animation(sequence));
  springTrap(player, door, level);
  if (random() >= successChance(door, level)) {
    player.sendMessage(MESSAGE.FAIL);
    return true;
  }
  player.sendMessage(MESSAGE.PICKED);
  player.getSkillManager().addExperiences(core.Skill.THIEVING, door.xp);
  open(player, object);
  return true;
}

/** Open from inside swings the door as any door does; from outside it is locked. */
function openLocked(event) {
  const { player, object } = event;
  const placement = object && DOORS.get(keyOf(object));
  if (!placement || event.handled || OPENERS.has(player)) return;
  const option = event.definition?.getInteractions?.()?.[event.clickType - 1]?.toLowerCase();
  if (option !== "open") return;
  if (isInside(player, placement)) {
    if (placement.door.through) spam(player, placement.door.through);
    return;
  }
  event.handled = true;
  player.setPositionToFace(object.getLocation());
  lockSound(player, placement.door);
  player.sendMessage(MESSAGE.LOCKED);
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onObjectInteraction("Door", { "Pick-lock": pickLock });
  pluginApi.onObjectInteraction("Gate", { "Pick-lock": pickLock });
  pluginApi.onCustomEvent("door:toggle", openLocked);
};

module.exports._test = {
  DOORS, HUT, HIDEOUT, ARDOUGNE_NORTH, ARDOUGNE_SOUTH, DRUID_TOWER, SEWER_GATE, MESSAGE, successChance, rollAt, pickLock, openLocked,
  isInside, setRandom(fn) { random = fn ?? Math.random; },
};
