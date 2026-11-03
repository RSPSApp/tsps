"use strict";

/**
 * The Tombs of Amascut's Combat Achievements (plugins/achievements/combatachievements/).
 *
 * Wiki (Combat Achievements/All tasks) gives the 51 tasks, under Entry, Normal and Expert. Rooms
 * report through `raid.failTask` and `raid.completeTask`; this unit announces, applies each task's
 * mode, and decides what the raid as a whole decides: counts, raid levels, deaths, speed, supplies,
 * gear, and the composite tasks.
 *
 * Captured:
 * - "You have failed <col=0cc919>Task</col>: reason." A party's failure names the player ("Z-Kris
 *   lost water from their container.", 223/00014 tick 164); a personal one says "You" ("You dropped
 *   an orb."). Failures are announced in every mode, Expert's in Entry raids too (223/00014 tick
 *   1074, as the Wiki warns), but a task finishes only in its mode.
 * - Mode: the Normal tasks finish from raid level 150, the Expert tasks from 300 at the raid's end
 *   (Wiki). 227/00553: Tombs Speed Runner and Helpful spirit who? at level 150.
 * - "Tomb Explorer" counts Normal and Expert completions: 227/00101 tick 16010, the first Expert
 *   raid, finishes Tomb Explorer and Expert Tomb Explorer together.
 * - Supplies: any potion or food not from the raid fails You are not prepared at once (a ranging
 *   potion, 227/01762 tick 17837; a shark, 223/00014 tick 278); any of the spirit's supplies fails
 *   Helpful spirit who? (smelling salts, 227/00553 tick 8128). Both are "You ...".
 * - But... Damage fails on entering (227/00554 tick 6883, 13 ticks in) with the item's name and
 *   Jagex's spelling of "posession".
 * - Speed runs on the overall time. 227/01852 tick 15259: Speed Runner II at overall 20:00.60,
 *   challenge 17:37.80; 227/01779 tick 15272: not at overall 20:34.80, challenge 17:36.00. So the
 *   limits are overall ones, with the 20:00.60 allowing for the timer's own tick.
 * Estimates:
 * - The composites (Perfection of X, Insanity) are announced by nothing: no capture fails one.
 * - Tier 75 is read from the item's skill requirements: 75 or more in any combat skill.
 */

const Shared = require("./Shared.TombsOfAmascut");

const MONSTER = { entry: "EM: Tombs of Amascut", normal: "Tombs of Amascut", expert: "XM: Tombs of Amascut" };
const FAIL_COLOUR = "0cc919";
const NORMAL_LEVEL = 150;
const EXPERT_LEVEL = 300;
const FULL_PARTY = 8;
const TIER_75 = 75;
const TICKS_PER_MINUTE = 100;
/** The timer's own tick: 20:00.60 still finished "within 20 mins" (227/01852 tick 15259). */
const SPEED_GRACE_TICKS = 1;

const ENTRY_COUNTS = [["Novice Tomb Explorer", 1], ["Novice Tomb Looter", 25], ["Novice Tomb Raider", 50]];
const NORMAL_COUNTS = [["Tomb Explorer", 1], ["Tomb Looter", 25], ["Tomb Raider", 50]];
const EXPERT_COUNTS = [["Expert Tomb Explorer", 1], ["Expert Tomb Looter", 25], ["Expert Tomb Raider", 50]];
const LEVEL = [["Movin' on up", 50], ["Confident Raider", 100]];
const LEVEL_WITHOUT_DEATHS = [["Something of an expert myself", 350], ["Amascut's Remnant", 500]];
const COMPOSITES = [
  ["Perfection of Scabaras", ["Perfect Scabaras", "Perfect Kephri"]],
  ["Perfection of Apmeken", ["Perfect Apmeken", "Perfect Ba-Ba"]],
  ["Perfection of Het", ["Perfect Het", "Perfect Akkha"]],
  ["Perfection of Crondis", ["Perfect Crondis", "Perfect Zebak"]],
  ["Insanity", ["Perfect Wardens"]],
];
const BOSS_INVOCATIONS = ["AKKHA", "KEPHRI", "ZEBAK", "BA_BA", "THE_WARDENS"];

const NORMAL_TASKS = new Set(["No skipping allowed", "Down Do Specs", "Dropped the ball", "Helpful spirit who?", "Hardcore Raiders",
  "Perfect Crondis", "Hardcore Tombs", "Perfect Apmeken", "I'm in a rush", "Perfect Het", "Perfect Wardens", "You are not prepared",
  "Tombs Speed Runner", "Better get movin'", "Chompington", "Perfect Kephri", "Perfect Scabaras", "Perfect Ba-Ba", "Perfect Zebak",
  "Perfect Akkha", ...NORMAL_COUNTS.map(([task]) => task)]);
const EXPERT_TASKS = new Set(["All out of medics", "Resourceful Raider", "Warden't you believe it", "Fancy feet", "Doesn't bug me",
  "But... Damage", "Something of an expert myself", "Ba-Bananza", "Rockin' around the croc", "Perfection of Scabaras",
  "Tombs Speed Runner II", "Insanity", "Akkhan't Do it", "All Praise Zebak", "Amascut's Remnant", "Tombs Speed Runner III",
  "Perfection of Apmeken", "Perfection of Het", "Perfection of Crondis", "Maybe I'm the boss.", ...EXPERT_COUNTS.map(([task]) => task)]);

function neededLevel(task) {
  if (EXPERT_TASKS.has(task)) return EXPERT_LEVEL;
  return NORMAL_TASKS.has(task) ? NORMAL_LEVEL : 0;
}

function hasTask(player, task) {
  const request = { player, task, done: false };
  Shared.api().emitCustomEvent("combat-achievements:has-task", request);
  return request.done;
}

function announce(player, task, reason) {
  if (!hasTask(player, task)) player.sendMessage(`You have failed <col=${FAIL_COLOUR}>${task}</col>: ${reason}`);
}

/** A task's chance is gone: for the party, or for one `player`. Each is announced once. */
function failed(raid, task, reason, player = null) {
  if (raid.failedTasks.has(task)) return;
  if (!player) {
    raid.failedTasks.add(task);
    for (const member of raid.players) if (!raid.member(member).failedTasks.has(task)) announce(member, task, reason);
    return;
  }
  const member = raid.member(player);
  if (member.failedTasks.has(task)) return;
  member.failedTasks.add(task);
  announce(player, task, reason);
}

function live(raid, task, player = null) {
  if (raid.failedTasks.has(task)) return false;
  return !player || !raid.member(player).failedTasks.has(task);
}

/** Awards a task if it's still live for them and the raid reaches its mode. */
function completed(raid, task, players) {
  if (raid.tasksOff) return;
  for (const player of players ?? raid.players) {
    if (!live(raid, task, player)) continue;
    const member = raid.member(player);
    if (member.earnedTasks.has(task)) continue;
    member.earnedTasks.add(task);
    if (raid.raidLevel >= neededLevel(task)) Shared.api().emitCustomEvent("combat-achievements:complete", { player, task });
    completeComposites(raid, player);
  }
}

/** "Complete 'Perfect X' and 'Perfect Y' in a single run". Insanity is Perfect Wardens at expert. */
function completeComposites(raid, player) {
  const member = raid.member(player);
  for (const [task, parts] of COMPOSITES) {
    if (parts.every((part) => member.earnedTasks.has(part))) completed(raid, task, [player]);
  }
}

// ------------------------------------------------------------------ what the raid reports

function suppliesFromOutside(raid, player) {
  failed(raid, "You are not prepared", "You used supplies from outside the raid.", player);
}

function suppliesFromSpirit(raid, player) {
  failed(raid, "Helpful spirit who?", "You used supplies from inside the raid.", player);
}

function tierOf(id) {
  const { ItemDefinition, Skill } = Shared.core();
  const requirements = ItemDefinition.forId(id)?.getRequirements?.();
  if (!requirements) return 0;
  const combat = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC];
  return Math.max(0, ...combat.map((skill) => Number(requirements[skill.getId?.() ?? skill]) || 0));
}

/** Every tick: But... Damage, wearing or holding tier 75. */
function checkGear(raid) {
  for (const player of raid.players) {
    if (!live(raid, "But... Damage", player)) continue;
    const carried = [...player.getEquipment().getValidItems(), ...player.getInventory().getValidItems()];
    const item = carried.find((entry) => tierOf(entry.getId()) >= TIER_75);
    if (!item) continue;
    const name = Shared.core().ItemDefinition.forId(item.getId())?.getName?.() ?? "";
    failed(raid, "But... Damage", `You are in posession of an item at tier ${TIER_75} or above: ${name}.`, player);
  }
}

// ------------------------------------------------------------------ the raid's end

function allBossInvocations(raid) {
  const { definitions } = require("./Invocations.TombsOfAmascut");
  return definitions().filter(({ category }) => BOSS_INVOCATIONS.includes(category)).every(({ key }) => raid.settings.isActive(key));
}

/** The Wardens fell: the counts, and everything the whole raid decides for this player. */
function raidCompleted(raid, player, mode, counts) {
  const api = Shared.api();
  const key = mode.toLowerCase();
  api.emitCustomEvent("combat-achievements:kill", { player, monster: MONSTER[key], count: counts[key] });
  const one = (task) => completed(raid, task, [player]);
  const entry = Number(counts.entry) || 0;
  const normal = Number(counts.normal) || 0;
  const expert = Number(counts.expert) || 0;
  for (const [task, needed] of ENTRY_COUNTS) if (entry + normal + expert >= needed) one(task);
  for (const [task, needed] of NORMAL_COUNTS) if (normal + expert >= needed) one(task);
  for (const [task, needed] of EXPERT_COUNTS) if (expert >= needed) one(task);
  const level = raid.raidLevel;
  for (const [task, needed] of LEVEL) if (level >= needed) one(task);
  const deathless = raid.totalDeaths === 0;
  if (deathless) for (const [task, needed] of LEVEL_WITHOUT_DEATHS) if (level >= needed) one(task);
  const party = raid.original.size;
  if (party >= 2 && deathless) one("Hardcore Raiders");
  if (party <= 1 && raid.member(player).deaths === 0) one("Hardcore Tombs");
  if (deathless && raid.settings.isActive("ON_A_DIET") && raid.settings.isActive("DEHYDRATION")) one("Resourceful Raider");
  if (deathless) {
    one("Helpful spirit who?");
    one("You are not prepared");
    if (allBossInvocations(raid)) one("Maybe I'm the boss.");
  }
  one("But... Damage");
  const within = (minutes) => raid.totalTicks <= minutes * TICKS_PER_MINUTE + SPEED_GRACE_TICKS;
  if (key === "normal" && within(18)) one("Tombs Speed Runner");
  if (key === "expert" && within(20)) one("Tombs Speed Runner II");
  if (key === "expert" && within(18) && party >= FULL_PARTY) one("Tombs Speed Runner III");
}

/** At login: the completion counts, so earlier raids finish their kill-count tasks. */
function answerKillCount({ player, counts }) {
  // Required here: the raid requires this unit.
  const saved = player.getAttribute(require("./RaidState.TombsOfAmascut").ATTR_KILL_COUNTS) ?? {};
  for (const [key, monster] of Object.entries(MONSTER)) if (Number(saved[key]) > 0) counts[monster] = Number(saved[key]);
  const entry = Number(saved.entry) || 0;
  const normal = Number(saved.normal) || 0;
  const expert = Number(saved.expert) || 0;
  const complete = (task) => Shared.api().emitCustomEvent("combat-achievements:complete", { player, task });
  for (const [task, needed] of ENTRY_COUNTS) if (entry + normal + expert >= needed) complete(task);
  for (const [task, needed] of NORMAL_COUNTS) if (normal + expert >= needed) complete(task);
  for (const [task, needed] of EXPERT_COUNTS) if (expert >= needed) complete(task);
}

module.exports = function registerToaCombatAchievements(api) {
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
};

Object.assign(module.exports, {
  failed,
  live,
  completed,
  raidCompleted,
  checkGear,
  suppliesFromOutside,
  suppliesFromSpirit,
  neededLevel,
  allBossInvocations,
  COMPOSITES,
});
