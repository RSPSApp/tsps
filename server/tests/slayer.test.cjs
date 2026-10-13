// Run after `yarn build`: node --test tests/slayer.test.cjs
// Slayer against the real cache: tasks, kills, points, rewards (docs/slayer.md).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
CachePipeline.initialize();
new NpcDefinitionLoader().load();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { PacketSender } = require("../dist/net/packet/PacketSender");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Skill } = require("../dist/game/model/Skill");

const Slayer = require("../plugins/skills/Slayer.plugin");
const Data = require("../plugins/skills/slayer/Data.Slayer");
const Tasks = require("../plugins/skills/slayer/Tasks.Slayer");
const Masters = require("../plugins/skills/slayer/Masters.Slayer");
const Combat = require("../plugins/skills/slayer/Combat.Slayer");
const Rewards = require("../plugins/skills/slayer/Rewards.Slayer");
const Checks = require("../plugins/skills/slayer/Checks.Slayer");
const Equipment = require("../plugins/skills/slayer/Equipment.Slayer");
const Finishers = require("../plugins/skills/slayer/Finishers.Slayer");
const Superiors = require("../plugins/skills/slayer/Superiors.Slayer");

const core = PluginManager.getCoreApi();
const handlers = { events: new Map(), death: [], canAttack: [] };
const emitted = [];
const spawned = [];
const commands = {};
Slayer.register({
  core,
  persistAttribute() {},
  onPlayerLogin() {},
  onNpcDeath: (fn) => handlers.death.push(fn),
  onCanAttack: (fn) => handlers.canAttack.push(fn),
  onNpcInteraction() {},
  onAnyNpcInteraction() {},
  onNpcDialogueCondition() {},
  onItemAction() {},
  onInterfaceActionButton() {},
  onCombatHitRoll() {},
  onCombatHitResolved() {},
  onNpcHitModify() {},
  registerIncomingDamageModifier() {},
  onNpcBeforeDeath() {},
  onItemOnNpc() {},
  onItemOnItem() {},
  registerCommand: (name, fn) => { commands[name] = fn; },
  spawnNpc: (definition) => { spawned.push(definition); return { getCombat: () => ({ attack() {} }) }; },
  onCustomEvent: (name, fn) => handlers.events.set(name, [...(handlers.events.get(name) ?? []), fn]),
  emitCustomEvent: (name, payload) => {
    emitted.push([name, payload]);
    for (const fn of handlers.events.get(name) ?? []) fn(payload);
  },
});

const varbit = (player, name) => player.getPacketSender().getVarbit(CacheDefinitions.getVarbitId(name));
const varp = (player, name) => player.getPacketSender().getVarp(CacheDefinitions.getVarpId(name));
const setVarbit = (player, name, value) => player.getPacketSender().sendVarbit(CacheDefinitions.getVarbitId(name), value);

function createPlayer({ combat = 126, slayer = 99, levels = {}, points = 0 } = {}) {
  const attributes = new Map();
  const messages = [];
  const xp = [];
  const inventory = [];
  const player = {
    messages,
    xp,
    inventory,
    isPlayer: () => true,
    isPlayerBot: () => false,
    getSession: () => ({ sendClientPacket() {}, write() {} }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => messages.push(message),
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill === Skill.SLAYER ? slayer : levels[skill.getIndex?.()] ?? 99),
      getCurrentLevel: (skill) => (skill === Skill.SLAYER ? slayer : 99),
      getCombatLevel: () => combat,
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getInventory: () => ({
      getFreeSlots: () => 28 - inventory.length,
      contains: (id) => inventory.some(([item]) => item === id),
      adds: (id, amount) => inventory.push([id, amount]),
    }),
  };
  const sender = new PacketSender(player);
  player.getPacketSender = () => sender;
  if (points) setVarbit(player, "slayer_points", points);
  return player;
}

function npcNamed(name, location = { getX: () => 3200, getY: () => 3200, getZ: () => 0 }) {
  const count = CacheDefinitions.getCounts().npcs;
  for (let id = 0; id < count; id++) {
    const type = CacheDefinitions.getNpc(id);
    if (type?.name === name && (type.actions ?? []).includes("Attack")) return npc(id, location);
  }
  throw new Error(`no attackable NPC named ${name}`);
}

function npc(id, location) {
  const definition = core.NpcDefinition.forId(id);
  return {
    getId: () => id,
    isNpc: () => true,
    getLocation: () => location,
    getDefinition: () => definition,
    getCurrentDefinition: () => definition,
  };
}

const kill = (player, target) => handlers.death.forEach((fn) => fn({ killer: player, npc: target }));
const master = (id) => Data.get().masters.get(id);
const taskId = (name) => [...Data.get().taskById.values()].find((task) => task.displayName === name).id;

/** Gives the player this task from this master, as an assignment would. */
function giveTask(player, masterId, name, amount) {
  player.getPacketSender().sendConfig(CacheDefinitions.getVarpId("slayer_target"), taskId(name));
  player.getPacketSender().sendConfig(CacheDefinitions.getVarpId("slayer_count"), amount);
  player.getPacketSender().sendConfig(CacheDefinitions.getVarpId("slayer_count_original"), amount);
  setVarbit(player, "slayer_master", masterId);
}

test("the masters' task lists come from the cache's slayer_master_task table", () => {
  const counts = Object.fromEntries([...Data.get().masters.values()].map((entry) => [entry.names[0], entry.tasks.length]));
  assert.deepEqual(counts, {
    Turael: 24, Mazchna: 30, Vannaka: 46, Chaeldar: 40, Duradel: 43, Nieve: 46,
    Krystilia: 37, "Konar quo Maten": 39, Spria: 25, Mortimer: 29,
  });
  assert.equal(Data.masterForNpcName("Steve").id, 6, "Steve is Nieve's master id");
  assert.equal(Data.masterForNpcName("Kuradal").id, 5);
});

test("task levels come from the NPC definitions; sub-tasks count by name", () => {
  assert.equal(Data.taskLevel(taskId("Bloodveld")), 50);
  assert.equal(Data.taskLevel(taskId("Abyssal Demons")), 85);
  assert.equal(Data.taskLevel(taskId("Cave Kraken")), 87);
  assert.equal(Data.taskLevel(taskId("Goblins")), 1);
  const fever = npcNamed("Fever spider");
  assert.ok(Data.npcCountsFor(taskId("Fever Spiders"), fever.getId(), "Fever spider"));
  assert.ok(Data.npcCountsFor(taskId("Bloodveld"), npcNamed("Mutated Bloodveld").getId(), "Mutated Bloodveld"));
});

test("an assignment sets the task varps and respects the Slayer level", () => {
  const player = createPlayer({ slayer: 1, combat: 126 });
  const result = Tasks.assign(player, master(3), () => 0.5);
  assert.match(result.line, /^Your new task is to kill \d+ .+\.$/);
  const task = Tasks.current(player);
  assert.equal(varp(player, "slayer_count"), task.count);
  assert.equal(varp(player, "slayer_count_original"), task.count);
  assert.equal(varbit(player, "slayer_master"), 3);
  assert.equal(Data.taskLevel(task.taskId), 1, "a level-1 Slayer only gets tasks without a level");
  const assigned = emitted.filter(([name]) => name === "slayer:task-assigned").at(-1)[1];
  assert.equal(assigned.master, 3);
});

test("blocked tasks are never assigned", () => {
  const player = createPlayer();
  const vannaka = master(3);
  const all = vannaka.tasks.map((entry) => entry.task.id);
  // Block all but one task through the six block slots and a diary slot: not enough, so
  // check the filter directly instead: the eligible rows leave out a blocked id.
  setVarbit(player, "slayer_blocked_vannaka_1", taskId("Bloodveld"));
  for (let i = 0; i < 200; i++) {
    Tasks.clear(player);
    Tasks.assign(player, vannaka, Math.random);
    assert.notEqual(Tasks.current(player).taskId, taskId("Bloodveld"));
  }
  assert.ok(all.includes(taskId("Bloodveld")));
});

test("Konar gives an area; her kills only count inside it", () => {
  const player = createPlayer();
  const result = Tasks.assign(player, master(8), () => 0.3);
  assert.match(result.line, /^You are to bring balance to \d+ .+ in .+\.$/);
  assert.ok(Tasks.current(player).area, "slayer_area is set");

  giveTask(player, 8, "Bloodveld", 5);
  const catacombs = [...Data.get().areas.values()].find((area) => area.id === 1);
  player.getPacketSender().sendConfig(CacheDefinitions.getVarpId("slayer_area"), catacombs.id);
  const at = (x, y) => ({ getX: () => x, getY: () => y, getZ: () => 0 });
  kill(player, npcNamed("Bloodveld", at(3420, 3560))); // the Slayer Tower
  assert.equal(varp(player, "slayer_count"), 5);
  kill(player, npcNamed("Bloodveld", at(1690, 10070))); // the Catacombs
  assert.equal(varp(player, "slayer_count"), 4);
});

test("every Konar task has spawns inside each of its areas", () => {
  const spawns = require("../data/definitions/npc-spawns.json");
  const missing = [];
  for (const entry of master(8).tasks) {
    const own = spawns.filter((spawn) => Data.npcCountsFor(entry.task.id, spawn.id, CacheDefinitions.getNpc(spawn.id)?.name));
    for (const row of entry.areaRows) {
      const area = Data.get().areas.get(row);
      if (!area.boxes.length) continue;
      const at = (spawn) => ({ getX: () => spawn.x, getY: () => spawn.y });
      if (!own.some((spawn) => Data.inArea(area, at(spawn)))) missing.push(`${entry.task.displayName} ${area.text}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("Krystilia's kills only count in the Wilderness", () => {
  const player = createPlayer();
  giveTask(player, 7, "Bears", 5);
  kill(player, npcNamed("Grizzly bear"));
  assert.equal(varp(player, "slayer_count"), 5, "outside the Wilderness");
  const wilderness = { getX: () => 3100, getY: () => 3700, getZ: () => 0 };
  kill(player, npcNamed("Grizzly bear", wilderness));
  assert.equal(varp(player, "slayer_count"), 4);
});

test("kills give Slayer XP equal to the monster's hitpoints and count down", () => {
  const player = createPlayer();
  giveTask(player, 3, "Bloodveld", 3);
  const bloodveld = npcNamed("Bloodveld");
  kill(player, bloodveld);
  kill(player, npcNamed("Mutated Bloodveld"));
  assert.equal(varp(player, "slayer_count"), 1);
  assert.deepEqual(player.xp.map(([skill]) => skill), [Skill.SLAYER, Skill.SLAYER]);
  assert.equal(player.xp[0][1], bloodveld.getDefinition().getHitpoints());
  kill(player, npcNamed("Goblin"));
  assert.equal(varp(player, "slayer_count"), 1, "not on task");
});

test("no points for the first four tasks, then the master's points and the streak multipliers", () => {
  const player = createPlayer();
  const finish = (masterId) => {
    giveTask(player, masterId, "Bloodveld", 1);
    kill(player, npcNamed("Bloodveld"));
    return player.messages.at(-1);
  };
  assert.match(finish(3), /You've completed <\/col>1 task<col=ef1020> and will need <\/col>4 more/);
  finish(3); finish(3); finish(3);
  assert.equal(varbit(player, "slayer_points"), 0);
  assert.match(finish(3), /received <\/col>8 points<col=ef1020>, giving you a total of <\/col>8/);
  for (let streak = 6; streak < 10; streak++) finish(3);
  assert.match(finish(3), /You've completed <\/col>10 tasks <col=ef1020>and received <\/col>40 points/, "10th task: x5");
  assert.equal(varbit(player, "slayer_tasks_completed"), 10);
  assert.match(player.messages.find((line) => line.startsWith("<col=ef1020>You have completed your task!")), /You killed<\/col> 1 Bloodveld<col=ef1020>\. You gained<\/col> \d+ xp/);
});

test("Turael's tasks give no points and say so", () => {
  const player = createPlayer();
  giveTask(player, 1, "Goblins", 1);
  kill(player, npcNamed("Goblin"));
  assert.match(player.messages.at(-1), /eligible to earn reward points if you complete tasks from a more advanced Slayer Master/);
});

test("Turael replaces another master's task and resets the streak", () => {
  const player = createPlayer();
  setVarbit(player, "slayer_tasks_completed", 12);
  giveTask(player, 6, "Abyssal Demons", 100);
  const line = Masters.replaceTask(player, master(1));
  assert.match(line, /^Your new task is to kill/);
  assert.equal(varbit(player, "slayer_tasks_completed"), 0);
  assert.equal(varbit(player, "slayer_master"), 1);
});

test("monsters with a Slayer level can't be attacked below it", () => {
  const player = createPlayer({ slayer: 84 });
  const event = { attacker: player, target: npcNamed("Abyssal demon"), allow: null };
  Combat.canAttack(event);
  assert.equal(event.allow, false);
  assert.deepEqual(player.messages, ["You need a higher Slayer level to know how to wound this monster."]);
  const able = { attacker: createPlayer({ slayer: 85 }), target: npcNamed("Abyssal demon"), allow: null };
  Combat.canAttack(able);
  assert.equal(able.allow, null);
});

test("the gem's Check gives the task and the streak", () => {
  const player = createPlayer({ points: 20 });
  giveTask(player, 3, "Bloodveld", 44);
  Checks.check(player);
  assert.equal(player.messages[0], "You're assigned to kill bloodveld; only 44 more to go.");
  assert.match(player.messages[1], /currently have a total of <\/col>20 points/);
});

test("rewards: unlocks spend points and set their bit; cancel and block", () => {
  const player = createPlayer({ points: 500 });
  Rewards.unlock(player, 5); // Malevolent Masquerade, 400
  assert.equal(varbit(player, "slayer_points"), 100);
  assert.equal(varbit(player, "slayer_helm_unlocked"), 1, "the unlock's own varbit sits on its bit");
  Rewards.unlock(player, 0); // Gargoyle Smasher, 120: not enough
  assert.equal(Tasks.hasUnlockBit(player, 0), false);
  assert.match(player.messages.at(-1), /You need 120 points/);

  giveTask(player, 3, "Bloodveld", 10);
  Rewards.cancel(player);
  assert.equal(Tasks.current(player), null);
  assert.equal(varbit(player, "slayer_points"), 70);

  player.getPacketSender().sendConfig(101, 50); // 50 quest points: the first block slot
  setVarbit(player, "slayer_master_in_focus", 3);
  giveTask(player, 3, "Bloodveld", 10);
  Rewards.block(player);
  assert.equal(varbit(player, "slayer_points"), 10, "Vannaka's block costs 60");
  assert.equal(varbit(player, "slayer_blocked_vannaka_1"), taskId("Bloodveld"));
  assert.equal(Tasks.current(player), null);
  Rewards.unblock(player, "1");
  assert.equal(varbit(player, "slayer_blocked_vannaka_1"), 0);
});

test("rewards: the Buy tab sells enum 840's items for enum 842's prices", () => {
  const player = createPlayer({ points: 100 });
  const items = CacheDefinitions.getEnumValues(840);
  const slot = [...items].find(([, item]) => item === 4160)[0]; // broad arrows
  Rewards.buy({ player, slot, opId: 2 });
  assert.deepEqual(player.inventory, [[4160, 250]]);
  assert.equal(varbit(player, "slayer_points"), 65);
});

test("slayer:grant-points and slayer:current-task", () => {
  const player = createPlayer();
  handlers.events.get("slayer:grant-points")[0]({ player, points: 30 });
  assert.equal(varbit(player, "slayer_points"), 30);
  giveTask(player, 8, Data.get().taskById.get(Data.npcTaskId(npcNamed("Kalphite Worker").getId())).displayName, 5);
  const request = { player, task: null };
  handlers.events.get("slayer:current-task")[0](request);
  assert.equal(request.task.master, 8);
  assert.equal(request.task.name, "kalphites");
});

test("every Slayer data name is a cache NPC", () => {
  const names = new Set();
  const count = CacheDefinitions.getCounts().npcs;
  for (let id = 0; id < count; id++) {
    const name = CacheDefinitions.getNpc(id)?.name;
    if (name) names.add(name.toLowerCase());
  }
  const gear = require("../plugins/skills/data/slayer-gear.json");
  const finishers = require("../plugins/skills/data/slayer-finishers.json");
  const superiors = require("../plugins/skills/data/slayer-superiors.json");
  const all = [
    ...gear.monsters.flatMap((monster) => monster.names), ...gear.immune.names,
    ...finishers.finishers.flatMap((finisher) => finisher.names),
    ...Object.entries(superiors.superiors).flat(),
  ];
  assert.deepEqual(all.filter((name) => !names.has(name.toLowerCase())), []);
});

function equip(player, slots) {
  const items = [];
  for (const [slot, id] of Object.entries(slots)) items[slot] = { getId: () => id };
  player.getEquipment = () => ({ getItems: () => items });
  player.getCombat = () => ({ getSelectedSpell: () => null });
  return player;
}

test("protective gear: a dust devil hits a bare face for 16 and drains", () => {
  const player = equip(createPlayer(), {});
  const devil = npcNamed("Dust devil");
  devil.isPlayer = () => false;
  player.isNpc = () => false;
  const roll = { attacker: devil, target: player, forceAccurate: false };
  Equipment.hitRoll(roll);
  assert.equal(roll.forceAccurate, true);
  let damage = 3;
  Equipment.incomingDamage(player, { setDamage: (value) => { damage = value; } }, { attacker: devil });
  assert.equal(damage, 16);

  const masked = equip(createPlayer(), { 0: 4164 }); // facemask
  const safe = { attacker: devil, target: masked, forceAccurate: false };
  Equipment.hitRoll(safe);
  assert.equal(safe.forceAccurate, false);
  const helmet = equip(createPlayer(), { 0: core.ItemIdentifiers.SLAYER_HELMET });
  assert.equal(Equipment.protectedFrom(helmet, Equipment.GEAR.monsters[0]), true, "a Slayer helmet covers earmuffs");
});

test("kurask only take damage from leaf-bladed weapons", () => {
  const kurask = npcNamed("Kurask");
  const hitWith = (weapon) => {
    const player = equip(createPlayer(), { 3: weapon });
    let damage = 20;
    const hit = {
      getAttacker: () => player,
      getCombatType: () => core.CombatType.MELEE,
      setTotalDamage: (value) => { damage = value; },
    };
    player.getAsPlayer = () => player;
    Equipment.npcHit({ npc: kurask, hit });
    return damage;
  };
  assert.equal(hitWith(4587), 0, "a dragon scimitar does nothing");
  assert.equal(hitWith(core.ItemIdentifiers.LEAF_BLADED_SWORD), 20);
});

test("a gargoyle waits at 0 hitpoints for the rock hammer", () => {
  const player = createPlayer();
  player.inventory.push([4162, 1]);
  const gargoyle = npcNamed("Gargoyle");
  const attributes = new Map();
  let hitpoints = 0;
  Object.assign(gargoyle, {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getHitpoints: () => hitpoints,
    setHitpoints: (value) => { hitpoints = value; },
    getCombat: () => ({ getKiller: () => player }),
  });
  player.performAnimation = () => {};
  const event = { npc: gargoyle, preventDeath: false };
  Finishers.beforeDeath(event);
  assert.equal(event.preventDeath, true, "no Gargoyle Smasher: it stays up");

  hitpoints = 12;
  const early = { player, target: gargoyle, itemId: 4162, handled: false };
  Finishers.itemOnNpc(early);
  assert.equal(player.messages.at(-1), "The gargoyle isn't weak enough to be affected by the rock hammer.");
  hitpoints = 6;
  Finishers.itemOnNpc({ player, target: gargoyle, itemId: 4162, handled: false });
  assert.equal(player.messages.at(-1), "The gargoyle cracks apart.");
  const after = { npc: gargoyle, preventDeath: false };
  Finishers.beforeDeath(after);
  assert.equal(after.preventDeath, false);

  Rewards.setUnlockBit(player, 0, true);
  const fresh = npcNamed("Gargoyle");
  Object.assign(fresh, { getAttribute: () => undefined, setAttribute() {}, getCombat: () => ({ getKiller: () => player }) });
  const auto = { npc: fresh, preventDeath: false };
  Finishers.beforeDeath(auto);
  assert.equal(auto.preventDeath, false, "Gargoyle Smasher with a hammer finishes it");
});

test("superiors: Bigger and Badder spawns one 1 time in 200, worth ten times its hitpoints", () => {
  const player = createPlayer();
  const bloodveld = npcNamed("Bloodveld");
  assert.equal(Superiors.taskKill({ player, npc: bloodveld }, () => 0), null, "locked");
  Rewards.setUnlockBit(player, 35, true);
  assert.equal(Superiors.taskKill({ player, npc: bloodveld }, () => 0.5), null);
  assert.ok(Superiors.taskKill({ player, npc: bloodveld }, () => 0));
  assert.equal(CacheDefinitions.getNpc(spawned.at(-1).id).name, "Insatiable Bloodveld");
  assert.equal(player.messages.at(-1), "<col=ff0000>A superior foe has appeared...</col>");
  const superior = npcNamed("Insatiable Bloodveld");
  Superiors.npcKilled({ killer: player, npc: superior });
  assert.equal(player.xp.at(-1)[1], superior.getDefinition().getHitpoints() * 10);
});

test("::completetask finishes the task with its points and streak", () => {
  const player = createPlayer();
  setVarbit(player, "slayer_tasks_completed", 9);
  giveTask(player, 3, "Bloodveld", 40);
  commands.completetask({ player });
  assert.equal(Tasks.current(player), null);
  assert.equal(varbit(player, "slayer_tasks_completed"), 10);
  assert.equal(varbit(player, "slayer_points"), 40, "the 10th task: Vannaka's 8 x 5");
  commands.completetask({ player });
  assert.equal(player.messages.at(-1), "You don't have a Slayer task.");
});

test("::slayerpoints sets the points; ::clearunlocks locks everything again", () => {
  const player = createPlayer();
  commands.slayerpoints({ player, parts: ["slayerpoints", "500"] });
  assert.equal(varbit(player, "slayer_points"), 500);
  commands.slayerpoints({ player, parts: ["slayerpoints", "abc"] });
  assert.match(player.messages.at(-1), /^Usage/);
  assert.equal(varbit(player, "slayer_points"), 500);

  Rewards.setUnlockBit(player, 5, true);
  Rewards.setUnlockBit(player, 40, true);
  Rewards.setUnlockBit(player, 66, true);
  setVarbit(player, "slayer_toggleoff_superiormobs", 1);
  commands.clearunlocks({ player });
  assert.equal(varp(player, "slayer_rewards_unlocks"), 0);
  assert.equal(varp(player, "slayer_rewards_unlocks1"), 0);
  assert.equal(varp(player, "slayer_rewards_unlocks2"), 0);
  assert.equal(varbit(player, "slayer_toggleoff_superiormobs"), 0);
  assert.equal(varbit(player, "slayer_points"), 500, "points stay");
});

test("::superior spawns the current task's superior", () => {
  const player = createPlayer();
  player.getLocation = () => ({ getX: () => 3200, getY: () => 3200, getZ: () => 0 });
  commands.superior({ player });
  assert.equal(player.messages.at(-1), "You don't have a Slayer task.");
  giveTask(player, 3, "Bloodveld", 10);
  commands.superior({ player });
  assert.equal(CacheDefinitions.getNpc(spawned.at(-1).id).name, "Insatiable Bloodveld");
  assert.deepEqual([spawned.at(-1).x, spawned.at(-1).y], [3201, 3200]);
  giveTask(player, 1, "Goblins", 10);
  commands.superior({ player });
  assert.equal(player.messages.at(-1), "Your task has no superior monster.");
});

/** Answers quest:is-complete / quest:is-started from a player's `quests` map ({ key: "complete" | "started" }). */
function withQuests(run) {
  const answer = (field, done) => (request) => {
    const state = request.player.quests?.[request.key];
    if (state !== undefined) request[field] = done(state);
  };
  handlers.events.set("quest:is-complete", [answer("complete", (state) => state === "complete")]);
  handlers.events.set("quest:is-started", [answer("started", (state) => state === "complete" || state === "started")]);
  try {
    run();
  } finally {
    handlers.events.delete("quest:is-complete");
    handlers.events.delete("quest:is-started");
  }
}

test("tasks behind a quest aren't assigned without it (#504)", () => {
  withQuests(() => {
    const player = createPlayer();
    player.quests = { priest_in_peril: "not started", fairytale_ii_cure_a_queen: "not started" };
    for (let i = 0; i < 300; i++) {
      Tasks.clear(player);
      Tasks.assign(player, master(3), Math.random);
      const name = Tasks.current(player).task.displayName;
      assert.ok(!["Ghouls", "Werewolves", "Vampyres", "Abyssal Demons"].includes(name), `${name} needs Priest in Peril`);
    }
    assert.equal(Tasks.meetsQuests(player, taskId("Ghouls")), false);
    player.quests.priest_in_peril = "complete";
    assert.equal(Tasks.meetsQuests(player, taskId("Ghouls")), true);
    assert.equal(Tasks.meetsQuests(player, taskId("Werewolves")), true);
  });
});

test("Abyssal demons need either quest; partly-done quests only need starting", () => {
  withQuests(() => {
    const player = createPlayer();
    player.quests = { priest_in_peril: "not started", fairytale_ii_cure_a_queen: "complete", dragon_slayer_i: "started" };
    assert.equal(Tasks.meetsQuests(player, taskId("Abyssal Demons")), true);
    assert.equal(Tasks.meetsQuests(player, taskId("Blue Dragons")), true, "Dragon Slayer I started is enough");
    player.quests.dragon_slayer_i = "not started";
    assert.equal(Tasks.meetsQuests(player, taskId("Blue Dragons")), false);
    assert.equal(Tasks.meetsQuests(player, taskId("Goblins")), true, "no quest");
  });
  // No quest plugin answering (a quest tsps doesn't have): the task isn't blocked.
  assert.equal(Tasks.meetsQuests(createPlayer(), taskId("Ghouls")), true);
});

test("every task quest names a task and a registered quest", () => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "../plugins/quests/quests");
  const keys = new Set();
  for (const file of fs.readdirSync(dir)) {
    for (const match of fs.readFileSync(path.join(dir, file), "utf8").matchAll(/^\s+key: "([a-z0-9_]+)"/gm)) keys.add(match[1]);
  }
  const taskQuests = require("../plugins/skills/data/slayer-masters.json").taskQuests;
  for (const [id, needs] of Object.entries(taskQuests)) {
    assert.equal(Data.get().taskById.get(Number(id))?.displayName, needs.task, `task ${id}`);
    for (const key of needs.any) assert.ok(keys.has(key), `${needs.task}: ${key} is a quest`);
  }
});
