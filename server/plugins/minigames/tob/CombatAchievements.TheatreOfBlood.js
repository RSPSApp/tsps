"use strict";

/**
 * The Theatre of Blood's Combat Achievements (plugins/achievements/combatachievements/).
 *
 * Wiki (Combat Achievements/All tasks) gives the 50 tasks, grouped by mode; a task counts only in
 * its mode (no Hard Mode capture shows a Normal task's failure, 227/01764, 01852). Rooms report
 * through `raid.failTask(task, reason)` and `raid.completeTask(task)`; this unit decides what the
 * raid's end decides: the counts, speed, restrictions, Pack Like a Yak and Perfect Theatre.
 *
 * Captured:
 * - "You have failed <col=0cc919>Task</col>: reason." to the whole party, for those who haven't the
 *   task. A Perfect room's failure also fails Perfect Theatre, with the same reason.
 * - The speed tasks run on the challenge time: Trio Speed-Runner (17:30) at challenge 15:25.80,
 *   overall 17:36.00 (227/01758 tick 2122); 4-Scale Speed-Chaser (17:00) at 16:49.80, 18:52.20
 *   (227/01758 tick 166). Hard Mode's say "overall time" (Wiki).
 * - Morytania Only and Can You Dance?: "<name> equipped a Twisted bow".
 * Estimate: "within the challenge time" means the overall time inside the target, as Hard Mode's
 * rewards do (Wiki).
 */

const Shared = require("./Shared.TheatreOfBlood");
const Raid = require("./RaidState.TheatreOfBlood");

const MONSTER = { entry: "EM: Theatre of Blood", normal: "Theatre of Blood", hard: "HM: Theatre of Blood" };
const FAIL_COLOUR = "0cc919";
const ENTRY_TASKS = ["Don't Look at Me!", "Just To Be Safe", "They Won't Expect This", "Chally Time", "Anticoagulants", "No-Pillar",
  "Attack, Step, Wait", "Pass It On", "Appropriate Tools", "Nylocas, On the Rocks", "Theatre of Blood: SM Speed-Chaser", "Theatre of Blood: SM Adept"];
const NORMAL_TASKS = ["Perfect Nylocas", "Perfect Bloat", "Pop It", "Perfect Sotetseg", "Back in My Day...", "A Timely Snack", "Can You Dance?",
  "Two-Down", "Can't Drain This", "Perfect Maiden", "Perfect Xarpus", "Perfect Verzik", "Perfect Theatre", "Morytania Only"];
const HARD_TASKS = ["Hard Mode? Completed It", "Nylo Sniper", "Harder Mode I", "Pack Like a Yak", "Stop Right There!",
  "Team Work Makes the Dream Work", "Personal Space", "Harder Mode II", "Royal Affairs", "Harder Mode III"];
const MODE_OF_TASK = new Map([
  ...ENTRY_TASKS.map((task) => [task, "entry"]),
  ...NORMAL_TASKS.map((task) => [task, "normal"]),
  ...HARD_TASKS.map((task) => [task, "hard"]),
]);
const PERFECT_ROOMS = ["Perfect Maiden", "Perfect Bloat", "Perfect Nylocas", "Perfect Sotetseg", "Perfect Xarpus", "Perfect Verzik"];
const PERFECT_THEATRE = "Perfect Theatre";

const ticks = (minutes, seconds = 0) => Math.round((minutes * 60 + seconds) / 0.6);
/** Team size -> [task, ticks], per mode. Wiki's "less than". */
const SPEED = {
  normal: {
    2: [["Theatre (Duo) Speed-Runner", ticks(26)]],
    3: [["Theatre (Trio) Speed-Chaser", ticks(20)], ["Theatre (Trio) Speed-Runner", ticks(17, 30)]],
    4: [["Theatre (4-Scale) Speed-Chaser", ticks(17)], ["Theatre (4-Scale) Speed-Runner", ticks(15)]],
    5: [["Theatre (5-Scale) Speed-Chaser", ticks(16)], ["Theatre (5-Scale) Speed-Runner", ticks(14, 15)]],
  },
  entry: Object.fromEntries([1, 2, 3, 4, 5].map((size) => [size, [["Theatre of Blood: SM Speed-Chaser", ticks(17)]]])),
  hard: {
    3: [["Theatre: HM (Trio) Speed-Runner", ticks(23)]],
    4: [["Theatre: HM (4-Scale) Speed-Runner", ticks(21)]],
    5: [["Theatre: HM (5-Scale) Speed-Runner", ticks(19)]],
  },
};
for (const list of Object.values(SPEED)) {
  for (const entries of Object.values(list)) for (const [task] of entries) if (!MODE_OF_TASK.has(task)) MODE_OF_TASK.set(task, list === SPEED.hard ? "hard" : list === SPEED.entry ? "entry" : "normal");
}

const SCYTHES = /scythe of vitur/i;
const BARROWS_WEAPONS = /^(Ahrim's staff|Dharok's greataxe|Guthan's warspear|Karil's crossbow|Torag's hammers|Verac's flail)/i;
const DAWNBRINGER = /^Dawnbringer$/i;

function appliesTo(raid, task) {
  const mode = MODE_OF_TASK.get(task);
  return mode === undefined || mode === raid.mode;
}

function hasTask(player, task) {
  const request = { player, task, done: false };
  Shared.api().emitCustomEvent("combat-achievements:has-task", request);
  return request.done;
}

function announceFailure(raid, task, reason) {
  for (const player of raid.players) {
    if (hasTask(player, task)) continue;
    player.sendMessage(`You have failed <col=${FAIL_COLOUR}>${task}</col>: ${reason}`);
  }
}

function failed({ raid, task, reason }) {
  if (!appliesTo(raid, task) || raid.failedTasks.has(task)) return;
  raid.failedTasks.add(task);
  announceFailure(raid, task, reason);
  if (PERFECT_ROOMS.includes(task) && raid.mode === "normal") failed({ raid, task: PERFECT_THEATRE, reason });
}

function completed({ raid, task, players }) {
  if (!appliesTo(raid, task) || raid.failedTasks.has(task)) return;
  for (const player of players) Shared.api().emitCustomEvent("combat-achievements:complete", { player, task });
}

/** A death fails Perfect Theatre (Wiki: "without anyone dying through any means"). */
function playerDied({ raid, player }) {
  failed({ raid, task: PERFECT_THEATRE, reason: `${Shared.displayName(player)} has died.` });
}

/** Every tick: the weapon restrictions, as the raid runs (captured the tick they're equipped). */
function checkGear({ raid }) {
  const { Equipment, ItemDefinition } = Shared.core();
  for (const player of raid.players) {
    const id = player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId() ?? -1;
    if (id <= 0) continue;
    const name = ItemDefinition.forId(id)?.getName?.() ?? "";
    if (SCYTHES.test(name)) failed({ raid, task: "Back in My Day...", reason: `${Shared.displayName(player)} equipped a ${name}` });
    if (!BARROWS_WEAPONS.test(name) && !DAWNBRINGER.test(name)) failed({ raid, task: "Morytania Only", reason: `${Shared.displayName(player)} has equipped a ${name}` });
  }
}

/** Pack Like a Yak: anyone buying fails it (Wiki). */
function boughtSupplies({ raid, player }) {
  failed({ raid, task: "Pack Like a Yak", reason: `${Shared.displayName(player)} bought something from a supply chest.` });
}

/** Verzik's defeat: the count, then what the whole raid decides. */
function counted({ raid, player, mode, count }) {
  Shared.api().emitCustomEvent("combat-achievements:kill", { player, monster: MONSTER[mode], count });
  const complete = (task) => completed({ raid, task, players: [player] });
  if (mode === "entry") complete("Theatre of Blood: SM Adept");
  const anyDeaths = [...raid.members.values()].some((member) => member.deaths > 0);
  // Speed: the challenge time for Entry and Normal, the overall time for Hard (Wiki's wording).
  const time = mode === "hard" ? raid.overallTicks : raid.totalTicks;
  for (const [task, limit] of SPEED[mode]?.[raid.size] ?? []) if (time < limit) complete(task);
  if (mode === "normal") {
    complete("Back in My Day...");
    complete("Morytania Only");
    if (!anyDeaths && PERFECT_ROOMS.every((task) => raid.taskLive(task))) complete(PERFECT_THEATRE);
  }
  if (mode === "hard") {
    const target = Shared.MODES.hard.challengeTicks[raid.size];
    if (raid.overallTicks <= target) {
      complete("Hard Mode? Completed It");
      if (!anyDeaths) complete("Pack Like a Yak");
    }
  }
}

/** At login: the completion counts, so earlier raids finish their kill-count tasks. */
function answerKillCount({ player, counts }) {
  const Stats = require("./Stats.TheatreOfBlood");
  for (const [mode, monster] of Object.entries(MONSTER)) {
    const count = Stats.completionsOf(player, mode);
    if (count > 0) counts[monster] = count;
  }
}

module.exports = function registerTheatreCombatAchievements(api) {
  Shared.bind(api);
  api.onCustomEvent("tob:task-failed", failed);
  api.onCustomEvent("tob:task-complete", completed);
  api.onCustomEvent("tob:player-died", playerDied);
  api.onCustomEvent("tob:raid-tick", checkGear);
  api.onCustomEvent("tob:supplies-bought", boughtSupplies);
  api.onCustomEvent("tob:counted", counted);
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
};

Object.assign(module.exports, { failed, completed, counted, checkGear, answerKillCount, MODE_OF_TASK, SPEED, MONSTER, Raid });
