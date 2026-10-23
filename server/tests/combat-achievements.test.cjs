// Run after `yarn build`: node --test tests/combat-achievements.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Task } = require("../dist/game/task/Task");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const Ca = require("../plugins/achievements/CombatAchievements.plugin");
const Data = require("../plugins/achievements/combatachievements/Data.CombatAchievements");
const Progress = require("../plugins/achievements/combatachievements/Progress.CombatAchievements");
const Kills = require("../plugins/achievements/combatachievements/Kills.CombatAchievements");
const Interface = require("../plugins/achievements/combatachievements/Interface.CombatAchievements");
const Rewards = require("../plugins/achievements/combatachievements/Rewards.CombatAchievements");
const Fights = require("../plugins/achievements/combatachievements/Fights.CombatAchievements");

const tasks = [];
const customEvents = new Map();
let processCycle = 0;
const fakeApi = new Proxy({
  core: {
    CacheDefinitions, Task, ItemIdentifiers,
    Item: class { constructor(id, amount) { this.id = id; this.amount = amount; } getId() { return this.id; } },
    World: { getProcessCycle: () => processCycle },
    Equipment: { WEAPON_SLOT: 3 },
    PrayerHandler: { PROTECT_FROM_MELEE: 18, isActivated: (player, id) => player.prayers?.has(id) === true },
    PlayerRights: { ADMINISTRATOR: 2 },
  },
  getTaskManager: () => ({ submit: (task) => { task.setRunning(true); tasks.push(task); } }),
  onCustomEvent: (name, handler) => customEvents.set(name, [...(customEvents.get(name) ?? []), handler]),
  emitCustomEvent: (name, request) => (customEvents.get(name) ?? []).forEach((handler) => handler(request)),
}, { get: (target, key) => target[key] ?? (() => {}) });
Ca.register(fakeApi);
require("../plugins/interface/Notifications.plugin").register(fakeApi);

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

function createPlayer({ freeSlots = 28 } = {}) {
  const log = [];
  const attributes = new Map();
  const varbits = new Map();
  const added = [];
  const sender = {
    sendConfig: (id, value) => { log.push(`varp ${id}=${value}`); return sender; },
    sendVarbit: (id, value) => { varbits.set(id, value); log.push(`varbit ${id}=${value}`); return sender; },
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendSubInterface: (target, group, type) => { log.push(`open ${target >>> 16}:${target & 0xffff} ${group} ${type}`); return sender; },
    closeSubInterface: (target) => { log.push(`close ${target >>> 16}:${target & 0xffff}`); return sender; },
    closeInterface: (group) => { log.push(`close ${group}`); return sender; },
    sendInterfaceScript: (id, args = []) => { log.push(`script ${id} [${args}]`); return sender; },
    sendInterfaceFlagsRange: (uid, from, to, flags) => { log.push(`events ${uid >>> 16}:${uid & 0xffff} ${from}-${to} ${flags}`); return sender; },
    sendJingle: (id, length) => { log.push(`jingle ${id} ${length}`); return sender; },
    isWorldMapOpen: () => false,
    toggleWorldMap: () => { log.push("worldmap"); return sender; },
  };
  return {
    log,
    added,
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => log.push(message),
    setInterfaceId: () => {},
    isRegistered: () => true,
    isPlayer: () => true,
    getInventory: () => ({ getFreeSlots: () => freeSlots, addItem: (item) => added.push(item.getId()) }),
  };
}

const named = (name) => Data.taskNamed(name);

test("the tasks come from the cache: 655 in six tiers, thresholds as captured live", () => {
  assert.equal(Data.tasks().size, 655);
  assert.deepEqual(Data.tiers().map((tier) => tier.name), ["Easy", "Medium", "Hard", "Elite", "Master", "Grandmaster"]);
  assert.deepEqual(Data.tiers().map((tier) => tier.threshold), [41, 169, 436, 1100, 1965, 2697], "the capture's ca_threshold_* at login");
  const foe = Data.task(0);
  assert.equal(foe.name, "Noxious Foe");
  assert.equal(foe.points, 1);
  assert.equal(foe.killCount, 1, "Kill an Aberrant Spectre.");
  assert.equal(Data.monsterNamed("King Black Dragon").tasks.find((task) => task.description === "Kill the King Black Dragon 25 times.").killCount, 25);
  assert.equal(Data.monsterNamed("DK: Rex").killVarps[0], 1508, "total_rex_kills");
  assert.equal(Data.monsterForNpc("Dagannoth Rex"), Data.monsterNamed("DK: Rex"));
  assert.equal(Data.monsterForNpc("The Nightmare"), Data.monsterNamed("Nightmare, The"));
  assert.equal(Data.monsterForNpc("Black dragon"), Data.monsterNamed("Black Dragons"));
  assert.equal(Data.monsterForNpc("TzTok-Jad"), null, "Jad counts by Fight Caves completion");
});

test("as captured: a completion's varp, counts, points, message, then the popup with jingle 76", () => {
  const player = createPlayer();
  tasks.length = 0;
  const task = named("Yama Adept");
  assert.equal(Progress.complete(player, task), true);
  assert.deepEqual(player.log, [
    "varp 4496=8388608", // ca_task_completed_18, as captured (task 599)
    "varbit 12888=1",
    "varbit 14815=4",
    "varbit 16255=1",
    "CA_ID:599|Congratulations, you've completed an elite combat task: <col=0cc919>Yama Adept</col> (4 points).",
    "open 161:13 660 1",
    "script 3343 [Combat Task Completed!,Task Completed: <col=ffffff>Yama Adept</col> (4 points),14733725]",
    "jingle 76 4974",
  ]);
  assert.equal(Progress.complete(player, task), false, "only once");
});

test("a second popup waits for the first: 13 ticks shown, 2 ticks apart", () => {
  const player = createPlayer();
  tasks.length = 0;
  Progress.complete(player, 0);
  Progress.complete(player, 24);
  assert.equal(player.log.filter((line) => line.startsWith("open 161:13")).length, 1);
  player.log.length = 0;
  const tick = () => { for (const each of tasks.filter((t) => t.isRunning())) each.tick(); };
  for (let i = 0; i < 13; i++) tick();
  assert.deepEqual(player.log, ["close 161:13"]);
  player.log.length = 0;
  tick();
  tick();
  assert.equal(player.log[0], "open 161:13 660 1");
});

test("crossing a threshold unlocks the tier: status 1 and the unlock message", () => {
  const player = createPlayer();
  for (const task of Data.tiers()[0].tasks.slice(0, -1)) Progress.complete(player, task, { silent: true });
  player.log.length = 0;
  Progress.complete(player, Data.tiers()[0].tasks.at(-1));
  assert.ok(player.log.includes("varbit 12863=1"), "ca_tier_status_easy");
  assert.ok(player.log.includes("You've completed enough Combat Achievement tasks to unlock Easy Tier rewards! You can now claim your rewards from Ghommal."));
  assert.deepEqual(Progress.claimableTiers(player).map((tier) => tier.name), ["Easy"]);
});

test("Ghommal: the rewards variant, the lowest tier's condition, the claim after \"Yes please!\"", () => {
  const player = createPlayer();
  for (const task of Data.tiers()[0].tasks) Progress.complete(player, task, { silent: true });
  const definition = { getName: () => "Ghommal" };
  assert.equal(Rewards.dialogueVariant({ player, definition }), "combat-achievement-rewards");
  assert.equal(Rewards.dialogueCondition({ player, definition, text: "If the player has completed the medium Combat Achievements:" }), false);
  assert.equal(Rewards.dialogueCondition({ player, definition, text: "If the player has completed the easy Combat Achievements:" }), true);
  assert.equal(Rewards.dialogueCondition({ player, definition, text: "If the player doesn't have 2 inventory spaces:" }), false);
  const line = { player, definition, text: "Yes please!" };
  Rewards.dialogueLine(line);
  player.log.length = 0;
  line.after();
  assert.deepEqual(player.log, ["varbit 12863=2", "varbit 12869=1"], "as captured: claimed, lamp claimed");
  assert.deepEqual(player.added, [25920, 25926], "antique lamp and Ghommal's hilt 1");
  assert.equal(Rewards.dialogueVariant({ player, definition }), null, "nothing left to claim");
});

test("Ghommal: no claim without the inventory space", () => {
  const player = createPlayer({ freeSlots: 1 });
  for (const task of Data.tiers()[0].tasks) Progress.complete(player, task, { silent: true });
  const definition = { getName: () => "Ghommal" };
  Rewards.dialogueCondition({ player, definition, text: "If the player has completed the easy Combat Achievements:" });
  assert.equal(Rewards.dialogueCondition({ player, definition, text: "If the player doesn't have 2 inventory spaces:" }), true);
});

test("kill counts: a named NPC's death counts and finishes the kill-count tasks it reaches", () => {
  const player = createPlayer();
  const kbd = Data.monsterNamed("King Black Dragon");
  const npc = { getCurrentDefinition: () => ({ getName: () => "King Black Dragon" }) };
  for (let i = 0; i < 10; i++) Kills.onNpcDeath({ killer: player, npc });
  assert.equal(Kills.killCount(player, kbd), 10);
  assert.ok(player.log.includes("varp 1514=10"), "total_kbd_kills");
  const novice = kbd.tasks.find((task) => task.killCount === 10);
  assert.equal(Progress.isComplete(player, novice.id), true);
  assert.equal(Progress.isComplete(player, kbd.tasks.find((task) => task.killCount === 25).id), false);
});

test("kill counts: saves keyed by the old cache's monster keys read by name, and save by name", () => {
  const player = createPlayer();
  // osrs-241_2026-09-30 keys: 32 King Black Dragon, 71 Zulrah (both moved up one with the Fractured Archive).
  player.setAttribute(Kills.KILLS_ATTRIBUTE, { 32: 12, 71: 5 });
  assert.equal(Kills.killCount(player, Data.monsterNamed("King Black Dragon")), 12);
  assert.equal(Kills.killCount(player, Data.monsterNamed("Zulrah")), 5);
  Kills.setCount(player, Data.monsterNamed("Zulrah"), 6);
  assert.deepEqual(player.getAttribute(Kills.KILLS_ATTRIBUTE), { "King Black Dragon": 12, Zulrah: 6 });
});

test("kill counts: event-counted content and the counts plugins keep, caught up at login", () => {
  const player = createPlayer();
  fakeApi.emitCustomEvent("combat-achievements:kill", { player, monster: "Barrows" });
  assert.equal(Kills.killCount(player, Data.monsterNamed("Barrows")), 1);
  customEvents.set("combat-achievements:kill-count", [(request) => { request.counts.Zulrah = 75; }]);
  Ca._test.restore({ player });
  const zulrah = Data.monsterNamed("Zulrah");
  assert.equal(Kills.killCount(player, zulrah), 75);
  assert.ok(zulrah.tasks.filter((task) => task.killCount !== null && task.killCount <= 75).every((task) => Progress.isComplete(player, task.id)));
  customEvents.delete("combat-achievements:kill-count");
});

test("as captured: the account summary row reopens the last screen; the burger menu moves between them", () => {
  const player = createPlayer();
  Interface.open(player);
  assert.deepEqual(player.log, [
    "varbit 17940=0",
    "script 2524 [-1,-1]",
    "open 161:16 717 0",
    "events 717:17 12-16 2",
    "events 717:8 0-5 2",
  ]);
  player.log.length = 0;
  Interface.click({ player, buttonId: (717 << 16) | 8, slot: 1 });
  assert.deepEqual(player.log.slice(0, 4), ["varbit 12858=2", "varbit 17940=1", "close 717", "open 161:16 715 0"], "a tier's button: Tasks at that tier");
  player.log.length = 0;
  Interface.click({ player, buttonId: (715 << 16) | 25, slot: 14 });
  // Captured as 0-71 with 71 bosses; the Fractured Archive (osrs-241_2026-10-20) makes it 72.
  assert.deepEqual(player.log, ["varbit 17940=3", "close 715", "open 161:16 716 0", "events 716:23 10-16 2", "events 716:15 0-72 3"]);
  player.log.length = 0;
  Interface.click({ player, buttonId: (716 << 16) | 15, action: 23 });
  assert.deepEqual(player.log, ["varbit 12862=23", "varp 261=-1", "varbit 17940=4", "open 161:16 713 0", "events 713:27 10-16 2", "events 713:23 0-1 2", "events 713:24 0-0 2"]);
  player.log.length = 0;
  Interface.click({ player, buttonId: (713 << 16) | 24, slot: 0 });
  // The tier filter left at Medium goes back to all, so every one of the boss's tasks shows.
  assert.deepEqual(player.log.slice(0, 3), ["varbit 12860=23", "varbit 12858=0", "varbit 17940=1"], "the progress bar: Tasks filtered to the boss");
});

test("one-hit echoes sharing a boss name cannot award its kill or speed achievements", () => {
  const player = createPlayer();
  player.getFightType = () => ({ getBonusType: () => 0 });
  player.getEquipment = () => ({ getItems: () => [] });
  const monster = Data.monsterNamed("Fragment of Seren");
  const task = named("Fragment of Seren Speed-Trialist");
  const npc = max => ({ isNpc: () => true, isPlayer: () => false,
    getId: () => 8917, getHitpoints: () => 0, getMaxHitpoints: () => max,
    getCurrentDefinition: () => ({ getName: () => "Fragment of Seren" }) });
  const hit = { getCombatType: () => "MAGIC", getTotalDamage: () => 1 };
  const echo = npc(1);
  Fights.onDealt({ player, target: echo, hit });
  Kills.onNpcDeath({ killer: player, npc: echo });
  Fights.onNpcDeath({ killer: player, npc: echo });
  assert.equal(Kills.killCount(player, monster), 0);
  assert.equal(Progress.isComplete(player, task.id), false);
  const boss = npc(1000);
  Fights.onDealt({ player, target: boss, hit });
  Kills.onNpcDeath({ killer: player, npc: boss });
  Fights.onNpcDeath({ killer: player, npc: boss });
  assert.equal(Kills.killCount(player, monster), 1);
  assert.equal(Progress.isComplete(player, task.id), true);
});

test("fights: a rule reads how the monster died", () => {
  const player = createPlayer();
  player.prayers = new Set([18]);
  player.getFightType = () => ({ getBonusType: () => 0 });
  player.isSpecialActivated = () => false;
  player.getEquipment = () => ({ getItems: () => [] });
  const npc = { isNpc: () => true, isPlayer: () => false, getHitpoints: () => 0, getCurrentDefinition: () => ({ getName: () => "King Black Dragon" }) };
  const hit = { getCombatType: () => "MELEE", getTotalDamage: () => 30 };
  Fights.onKill("King Black Dragon", {
    "Claw Clipper": (fight) => fight.prayedAtKill("PROTECT_FROM_MELEE"),
    "Hide Penetration": (fight) => fight.onlyMelee("stab"),
  });
  Fights.onDealt({ player, target: npc, hit });
  Fights.onHitResolved({ attacker: player, target: npc, hit });
  Fights.onNpcDeath({ npc, killer: player, damagers: [player] });
  assert.equal(Progress.isComplete(player, named("Claw Clipper").id), true);
  assert.equal(Progress.isComplete(player, named("Hide Penetration").id), true);
});

/** An NPC and a hit for the fight tracker. */
function fightNpc(name, hitpoints = 0) {
  return { isNpc: () => true, isPlayer: () => false, getHitpoints: () => hitpoints, getCurrentDefinition: () => ({ getName: () => name }) };
}

function fighter() {
  const player = createPlayer();
  player.prayers = new Set();
  player.getFightType = () => ({ getBonusType: () => 1 });
  player.isSpecialActivated = () => false;
  player.getEquipment = () => ({ getItems: () => [] });
  return player;
}

test("derived rules: \"Kill the Alchemical Hydra in less than 1 minute 20 seconds.\" times the fight from its first hit", () => {
  const player = fighter();
  const vorkath = fightNpc("Alchemical Hydra");
  const hit = { getCombatType: () => "RANGED", getTotalDamage: () => 50 };
  // A hit every 5 ticks for 90 seconds; a fight left alone for 100 ticks would start over.
  for (processCycle = 1000; processCycle < 1150; processCycle += 5) Fights.onDealt({ player, target: vorkath, hit });
  processCycle = 1000 + 150; // 90 seconds
  Fights.onHitResolved({ attacker: player, target: vorkath, hit });
  Fights.onNpcDeath({ npc: vorkath, killer: player, damagers: [player] });
  assert.equal(Progress.isComplete(player, named("Alchemical Speed-Chaser").id), true, "under 1:45");
  assert.equal(Progress.isComplete(player, named("Alchemical Speed-Runner").id), false, "not under 1:20");
});

test("derived rules: \"without taking any damage\" fails on any hit taken", () => {
  const player = fighter();
  const skotizo = fightNpc("Skotizo", 100);
  player.isPlayer = () => true;
  Fights.onDealt({ player, target: skotizo, hit: { getCombatType: () => "MELEE", getTotalDamage: () => 10 } });
  Fights.onHitResolved({ attacker: skotizo, target: player, hit: { getCombatType: () => "MELEE", getTotalDamage: () => 3 } });
  Fights.onNpcDeath({ npc: skotizo, killer: player, damagers: [player] });
  assert.equal(Progress.isComplete(player, named("Demon Evasion").id), false);
});

test("fights: hits on and from NPCs no rule reads are not kept (issue #748)", () => {
  const player = fighter();
  player.isPlayer = () => true;
  const man = fightNpc("Man", 7);
  const hit = { getCombatType: () => "MELEE", getTotalDamage: () => 1 };
  for (processCycle = 20000; processCycle < 26000; processCycle += 4) {
    Fights.onDealt({ player, target: man, hit });
    Fights.onHitResolved({ attacker: man, target: player, hit });
  }
  assert.equal(Fights._test.taken.get(player), undefined, "an hour tanking men keeps no history");
  Fights.onDealt({ player, target: fightNpc("Alchemical Hydra", 100), hit });
  Fights.onHitResolved({ attacker: man, target: player, hit });
  assert.equal(Fights._test.taken.get(player).length, 1, "in a fight a rule reads, every NPC's hits count");
});

test("Dagannoth Kings: all three within 9 seconds, Rex with another on one tick", () => {
  const player = fighter();
  const hit = { getCombatType: () => "MELEE", getTotalDamage: () => 10 };
  const kill = (name) => {
    const npc = fightNpc(name);
    Fights.onDealt({ player, target: npc, hit });
    Fights.onNpcDeath({ npc, killer: player, damagers: [player] });
  };
  processCycle = 5000;
  kill("Dagannoth Supreme");
  processCycle = 5010;
  kill("Dagannoth Rex");
  kill("Dagannoth Prime");
  assert.equal(Progress.isComplete(player, named("Rapid Succession").id), true);
  assert.equal(Progress.isComplete(player, named("Toppling the Diarchy").id), true);
});

test("the Gauntlet: a completed run's count, time and the Hunllef fight decide its tasks", () => {
  const GauntletShared = require("../plugins/minigames/gauntlet/Shared.Gauntlet");
  const Unit = require("../plugins/minigames/gauntlet/CombatAchievements.Gauntlet");
  GauntletShared.bind(fakeApi);
  const player = createPlayer();
  player.getEquipment = () => ({ contains: () => false });
  player.getAttribute = ((get) => (key) => (key === "gauntlet:stats" ? { completions: { regular: 5 } } : get(key)))(player.getAttribute);
  processCycle = 400;
  const run = { mode: "regular", startCycle: 0, made: { armour: 0, attunedWeapons: 2, egniol: 1 }, hunllef: { taken: { offPrayer: 0, avoidable: 0 }, wrongStyleHits: 0 } };
  Unit.completed({ run, player, reason: "completed" });
  assert.equal(Kills.killCount(player, Data.monsterNamed("Crystalline Hunllef")), 5);
  assert.equal(Progress.isComplete(player, named("Gauntlet Veteran").id), true, "5 completions");
  assert.equal(Progress.isComplete(player, named("Gauntlet Speed-Chaser").id), true, "4:00, under 4:45");
  assert.equal(Progress.isComplete(player, named("Gauntlet Speed-Runner").id), false, "not under 3:45");
  assert.equal(Progress.isComplete(player, named("Perfect Crystalline Hunllef").id), true);
  assert.equal(Progress.isComplete(player, named("Defence Doesn't Matter").id), true);
  assert.equal(Progress.isComplete(player, named("Egniol Diet").id), false, "made an egniol");
  assert.equal(Progress.isComplete(player, named("Wolf Puncher").id), false, "two attuned weapons");
});

test("the Fight Caves: a watched run's facts decide its tasks", () => {
  const Unit = require("../plugins/minigames/tzhaar/CombatAchievements.TzhaarFightCaves");
  Unit(new Proxy({ core: { World: { getProcessCycle: () => processCycle }, Skill: { PRAYER: "PRAYER" }, PrayerHandler: { PROTECT_FROM_MAGIC: 1, isActivated: () => false } }, emitCustomEvent: fakeApi.emitCustomEvent }, { get: (target, key) => target[key] ?? (() => {}) }));
  const player = createPlayer();
  player.isPlayer = () => true;
  player.getHitpoints = () => 50;
  player.getSkillManager = () => ({ getCurrentLevel: () => 40 });
  processCycle = 0;
  Unit.start(player);
  Unit.mejKotHealed(player);
  processCycle = 2500; // 25 minutes
  Unit.finish(player, true);
  assert.equal(Kills.killCount(player, Data.monsterNamed("TzTok-Jad")), 1);
  assert.equal(Progress.isComplete(player, named("Fight Caves Veteran").id), true);
  assert.equal(Progress.isComplete(player, named("Fight Caves Speed-Runner").id), true);
  assert.equal(Progress.isComplete(player, named("Facing Jad Head-on").id), true);
  assert.equal(Progress.isComplete(player, named("No Time for a Drink").id), true);
  assert.equal(Progress.isComplete(player, named("Denying the Healers").id), false, "a Yt-MejKot healed");
});

test("Vorkath: timed from her waking; specials, prayer and kills without leaving decide the rest", () => {
  const Unit = require("../plugins/bosses/vorkath/CombatAchievements.Vorkath");
  let prayer = 50;
  Unit.attach(new Proxy({ core: { World: { getProcessCycle: () => processCycle }, Skill: { PRAYER: "PRAYER" } }, emitCustomEvent: fakeApi.emitCustomEvent }, { get: (target, key) => target[key] ?? (() => {}) }));
  const player = createPlayer();
  player.getSkillManager = () => ({ getCurrentLevel: () => prayer });
  const vorkath = { getId: () => 8061 };
  for (let kill = 1; kill <= 5; kill++) {
    processCycle = kill * 1000;
    Unit.woke(player);
    if (kill === 1) {
      Unit.acidStarted(player);
      for (let i = 0; i < 12; i++) Unit.dealt({ player, target: vorkath });
    }
    processCycle += 80; // 48 seconds
    Unit.tick(player);
    Unit.killed(player);
  }
  assert.equal(Progress.isComplete(player, named("Vorkath Speed-Runner").id), true, "48 s from waking");
  assert.equal(Progress.isComplete(player, named("Faithless Encounter").id), true);
  assert.equal(Progress.isComplete(player, named("The Walk").id), true);
  assert.equal(Progress.isComplete(player, named("Dodging the Dragon").id), true, "5 kills, no special damage");
  assert.equal(Progress.isComplete(player, named("Extended Encounter").id), false, "only 5 of 10");

  const other = createPlayer();
  other.getSkillManager = () => ({ getCurrentLevel: () => prayer });
  processCycle = 20000;
  Unit.woke(other);
  Unit.specialDamage(other, 30, { acid: true });
  prayer = 40;
  processCycle += 200; // 2 minutes
  Unit.tick(other);
  Unit.killed(other);
  assert.equal(Progress.isComplete(other, named("Vorkath Speed-Chaser").id), false);
  assert.equal(Progress.isComplete(other, named("Faithless Encounter").id), false, "lost prayer");
});
