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
const Keys = require("../plugins/skills/slayer/Keys.Slayer");
const Choice = require("../plugins/skills/slayer/Choice.Slayer");

const core = PluginManager.getCoreApi();
const handlers = { events: new Map(), death: [], canAttack: [] };
const emitted = [];
const spawned = [];
const commands = {};
const persistedAttributes = new Map();
Slayer.register({
  core,
  persistAttribute: (key, initial) => persistedAttributes.set(key, initial),
  onPlayerLogin() {},
  onNpcDeath: (fn) => handlers.death.push(fn),
  onCanAttack: (fn) => handlers.canAttack.push(fn),
  onNpcInteraction() {},
  onAnyNpcInteraction() {},
  onNpcDialogueCondition() {},
  onItemAction: (...args) => PluginManager.createApi("SlayerTest").onItemAction(...args),
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
    setInterfaceId() {},
    getInterfaceId: () => -1,
    getFrameUpdater: () => ({ clear() {}, clearGroup() {} }),
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill === Skill.SLAYER ? slayer : levels[skill.getIndex?.()] ?? 99),
      getCurrentLevel: (skill) => (skill === Skill.SLAYER ? slayer : 99),
      getCombatLevel: () => combat,
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getEquipment: () => ({ getItems: () => [] }),
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

test("Krystilia's kills count in the Wilderness Slayer Cave (#1351)", () => {
  const CAVE_HELLHOUND = 7877; // the Hellhound npc-spawns.json places in the cave
  const player = createPlayer();
  giveTask(player, 7, "Hellhounds", 5);
  kill(player, npc(CAVE_HELLHOUND, { getX: () => 3439, getY: () => 10082, getZ: () => 0 }));
  assert.equal(varp(player, "slayer_count"), 4);
  assert.deepEqual(player.xp.map(([skill]) => skill), [Skill.SLAYER]);
});

test("Krystilia's kills count in the Wilderness dungeons (#1381)", () => {
  const player = createPlayer();
  giveTask(player, 7, "Fire Giants", 5);
  kill(player, npc(2078, { getX: () => 3049, getY: () => 10338, getZ: () => 0 })); // Deep Wilderness Dungeon
  assert.equal(varp(player, "slayer_count"), 4);
  giveTask(player, 7, "Black Dragons", 5);
  kill(player, npc(255, { getX: () => 3048, getY: () => 10266, getZ: () => 0 })); // Lava Maze Dungeon
  assert.equal(varp(player, "slayer_count"), 4);
  giveTask(player, 7, "Black Demons", 5);
  kill(player, npcNamed("Black demon", { getX: () => 3090, getY: () => 9950, getZ: () => 0 })); // Edgeville Dungeon
  assert.equal(varp(player, "slayer_count"), 4);
  giveTask(player, 7, "Bloodveld", 5);
  kill(player, npcNamed("Bloodveld", { getX: () => 3040, getY: () => 10150, getZ: () => 0 })); // Wilderness God Wars Dungeon
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

test("content can exclude an exact NPC from both on-task queries and task kill credit", t => {
  const player = createPlayer();
  giveTask(player, 3, "Bloodveld", 3);
  const excluded = npcNamed("Bloodveld");
  const regular = npcNamed("Bloodveld");
  const prior = handlers.events.get("slayer:target-eligible");
  let queries = 0;
  handlers.events.set("slayer:target-eligible", [(request) => {
    assert.equal(request.eligible, true, "eligible by default");
    if (request.npc === excluded) {
      assert.equal(request.player, player);
      request.eligible = false;
      queries++;
    }
  }]);
  t.after(() => prior ? handlers.events.set("slayer:target-eligible", prior) : handlers.events.delete("slayer:target-eligible"));
  const onTask = npc => {
    const request = { player, npc, onTask: false };
    for (const fn of handlers.events.get("slayer:on-task")) fn(request);
    return request.onTask;
  };
  assert.equal(onTask(excluded), false);
  kill(player, excluded);
  assert.equal(varp(player, "slayer_count"), 3);
  assert.equal(player.xp.length, 0);
  assert.equal(onTask(regular), true, "same cache ID in another instance stays eligible");
  kill(player, regular);
  assert.equal(varp(player, "slayer_count"), 2);
  assert.equal(player.xp.length, 1);
  assert.ok(queries >= 2, "query and authoritative death handling both consult content");
});

test("a target eligibility veto removes black-mask and imbued helmet accuracy and damage bonuses", t => {
  const player = createPlayer();
  giveTask(player, 3, "Bloodveld", 3);
  const target = npcNamed("Bloodveld");
  target.getAsNpc = () => target;
  player.getAsPlayer = () => player;
  player.getCombat = () => ({ getTarget: () => target });
  let head = core.ItemIdentifiers.SLAYER_HELMET_I_;
  player.getEquipment = () => ({ getItems: () => [new core.Item(head)] });
  const modifiers = {};
  const api = new Proxy({
    core,
    emitCustomEvent(name, payload) { for (const fn of handlers.events.get(name) ?? []) fn(payload); },
    registerMeleeAttackAccuracyModifier: fn => { modifiers.meleeAccuracy = fn; },
    registerMeleeHitModifier: fn => { modifiers.meleeDamage = fn; },
    registerRangedAttackAccuracyModifier: fn => { modifiers.rangedAccuracy = fn; },
    registerRangedHitModifier: fn => { modifiers.rangedDamage = fn; },
    registerMagicAttackAccuracyModifier: fn => { modifiers.magicAccuracy = fn; },
    registerMagicHitModifier: fn => { modifiers.magicDamage = fn; },
  }, { get: (api, key) => api[key] ?? (() => {}) });
  require("../plugins/items/SlayerHelmet.plugin").register(api);
  let eligible = true;
  const prior = handlers.events.get("slayer:target-eligible");
  handlers.events.set("slayer:target-eligible", [request => { if (request.npc === target) request.eligible = eligible; }]);
  t.after(() => prior ? handlers.events.set("slayer:target-eligible", prior) : handlers.events.delete("slayer:target-eligible"));
  for (const [kind, boosted] of [["meleeAccuracy", 140], ["meleeDamage", 140], ["rangedAccuracy", 138],
    ["rangedDamage", 138], ["magicAccuracy", 138], ["magicDamage", 138]]) {
    eligible = true;
    assert.equal(modifiers[kind](player, 120), boosted, kind);
    eligible = false;
    assert.equal(modifiers[kind](player, 120), 120, `${kind} veto`);
  }
  head = core.ItemIdentifiers.BLACK_MASK;
  eligible = false;
  assert.equal(modifiers.meleeAccuracy(player, 120), 120);
  assert.equal(modifiers.meleeDamage(player, 120), 120);
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

test("the rock hammer also finishes the Grotesque Guardians, each with its own line ('Dusk cracks apart.')", () => {
  const player = createPlayer();
  player.inventory.push([4162, 1]);
  player.performAnimation = () => {};
  const finishers = require("../plugins/skills/data/slayer-finishers.json").finishers;
  for (const name of ["Dusk", "Dawn"]) {
    const guardian = npcNamed(name);
    let hitpoints = 6;
    Object.assign(guardian, {
      getAttribute: () => undefined, setAttribute() {},
      getHitpoints: () => hitpoints, setHitpoints: (value) => { hitpoints = value; },
      getCombat: () => ({ getKiller: () => player }),
    });
    const event = { player, target: guardian, itemId: 4162, handled: false };
    Finishers.itemOnNpc(event);
    assert.equal(event.handled, true, name);
    assert.equal(player.messages.at(-1), finishers.find((f) => f.names.includes(name)).finished, name);
    assert.equal(player.messages.at(-1), `${name} cracks apart.`, name);
  }
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

test("keys: brimstone on Konar's tasks, Larran's on Krystilia's, by combat level", () => {
  assert.deepEqual([1, 50, 99, 100, 200, 349, 350, 1000].map(Keys.brimstoneDenominator), [2060, 600, 100, 100, 80, 51, 50, 50]);
  assert.deepEqual([1, 40, 80, 81, 200, 350, 351].map(Keys.larranDenominator), [1972, 580, 100, 100, 77, 50, 50]);
  const placed = () => emitted.filter(([name]) => name === "npc-drops:place").map(([, event]) => event.drops[0].itemId);
  const before = placed().length;
  const player = createPlayer();
  const bloodveld = npcNamed("Bloodveld");
  giveTask(player, 3, "Bloodveld", 5);
  Keys.taskKill({ player, npc: bloodveld }, () => 0);
  assert.equal(placed().length, before, "Vannaka's tasks drop no keys");
  giveTask(player, 8, "Bloodveld", 5);
  const level = bloodveld.getDefinition().getCombatLevel();
  const expected = (1 / Keys.brimstoneDenominator(level)) * 1.2;
  assert.ok(Math.abs(Keys.chance({ denominator: Keys.brimstoneDenominator }, bloodveld) - expected) < 1e-12, "Slayer level: 20% more");
  Keys.taskKill({ player, npc: bloodveld }, () => expected + 0.001);
  assert.equal(placed().length, before);
  Keys.taskKill({ player, npc: bloodveld }, () => 0);
  assert.equal(placed().at(-1), CacheDefinitions.getObjId("konar_key"));
  Keys.taskKill({ player, npc: npcNamed("Insatiable Bloodveld") }, () => 0.999);
  assert.equal(placed().length, before + 2, "a superior always drops one");
  giveTask(player, 7, "Bears", 5);
  Keys.taskKill({ player, npc: npcNamed("Grizzly bear", { getX: () => 3100, getY: () => 3700, getZ: () => 0 }) }, () => 0);
  assert.equal(placed().at(-1), CacheDefinitions.getObjId("slayer_wilderness_key"));
  const larran = { denominator: Keys.larranDenominator, caveBoost: true };
  const bear = (x, y) => npcNamed("Grizzly bear", { getX: () => x, getY: () => y, getZ: () => 0 });
  assert.ok(Math.abs(Keys.chance(larran, bear(3385, 10100)) / Keys.chance(larran, bear(3100, 3700)) - 1.15) < 1e-12, "Wilderness Slayer Cave: 15% more");
});

test("drop tables no longer hand out slayer keys on every kill", () => {
  const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");
  NpcDrops._test.loadDrops();
  const keys = new Set([CacheDefinitions.getObjId("konar_key"), CacheDefinitions.getObjId("slayer_wilderness_key")]);
  for (const tables of NpcDrops._test.tablesByNpc.values()) {
    for (const table of tables) {
      for (const entry of [...(table.entries ?? []), ...(table.tertiary ?? [])]) assert.ok(!keys.has(entry.item_id), table.label);
    }
  }
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
  for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".Quest.js")) continue;
    for (const match of fs.readFileSync(path.join(dir, file.name), "utf8").matchAll(/\bkey:\s*"([a-z0-9_]+)"/g)) keys.add(match[1]);
  }
  const taskQuests = require("../plugins/skills/data/slayer-masters.json").taskQuests;
  for (const [id, needs] of Object.entries(taskQuests)) {
    assert.equal(Data.get().taskById.get(Number(id))?.displayName, needs.task, `task ${id}`);
    for (const key of needs.any) assert.ok(keys.has(key), `${needs.task}: ${key} is a quest`);
  }
});

// --- Mortimer (rsprox captures: mortimer-and-task-completion)

const MORTIMER = Data.MORTIMER;
const sequence = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
const setVarp = (player, name, value) => player.getPacketSender().sendConfig(CacheDefinitions.getVarpId(name), value);
const entryFor = (name) => master(MORTIMER).tasks.find((entry) => entry.task.displayName === name);

test("Mortimer's modifiers come from the cache: ranges per task, unlocks per modifier", () => {
  const unlocks = Object.fromEntries([...Data.get().modifiers.values()].map((modifier) => [modifier.id, modifier.requirement]));
  assert.deepEqual(unlocks, { 1: 0, 2: 0, 3: 15, 4: 25, 5: 40 });
  assert.deepEqual(entryFor("Cave Crawlers").modifiers.find((range) => range.id === Data.MODIFIER.QUANTITY),
    { id: 2, min: 15, max: 30, negative: true });
  assert.deepEqual(entryFor("Aberrant Spectres").modifiers.find((range) => range.id === Data.MODIFIER.QUANTITY),
    { id: 2, min: 30, max: 80, negative: false });
});

test("Mortimer's modifier values are multiples of 5, from the modifiers the player has unlocked", () => {
  const range = { min: 30, max: 80 };
  assert.equal(Choice.steppedValue(range, () => 0), 30);
  assert.equal(Choice.steppedValue(range, () => 0.9999), 80);
  for (let i = 0; i < 50; i++) assert.equal(Choice.steppedValue(range, Math.random) % 5, 0);
  const player = createPlayer();
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(Choice.rollModifier(player, entryFor("Aberrant Spectres")).id);
  assert.deepEqual([...seen].sort(), [1, 2], "points and quantity only at first");
  setVarp(player, "slayer_mortimer_tasks_completed", 40);
  for (let i = 0; i < 400; i++) seen.add(Choice.rollModifier(player, entryFor("Aberrant Spectres")).id);
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5]);
});

test("Mortimer offers two different tasks, three after 50 of his tasks, and keeps the roll", () => {
  const player = createPlayer();
  assert.ok(Choice.open(player, master(MORTIMER)));
  const first = [1, 2, 3].map((n) => varbit(player, `slayer_choose_task_${n}`));
  assert.ok(first[0] && first[1] && first[0] !== first[1]);
  assert.equal(first[2], 0);
  assert.equal(varbit(player, "slayer_choose_rolled_master"), MORTIMER);
  assert.ok(varbit(player, "slayer_choose_task_1_modifier_id") > 0, "every choice has a modifier");
  assert.ok(Choice.open(player, master(MORTIMER)));
  assert.deepEqual([1, 2, 3].map((n) => varbit(player, `slayer_choose_task_${n}`)), first, "reopening doesn't roll again");
  assert.equal(Masters.assignmentLine(player, master(5)),
    "Hmm... It appears as though Mortimer has provided you with a task choice, you must go to them in order to pick.");

  commands.mortimertasks({ player, parts: ["mortimertasks", "60"] });
  assert.equal(varbit(player, "slayer_choose_rolled_master"), 0, "::mortimertasks drops the waiting roll");
  Choice.open(player, master(MORTIMER));
  assert.ok(varbit(player, "slayer_choose_task_3"), "rolled again, with a third choice");

  const veteran = createPlayer();
  setVarp(veteran, "slayer_mortimer_tasks_completed", 50);
  Choice.roll(veteran, master(MORTIMER));
  const three = [1, 2, 3].map((n) => varbit(veteran, `slayer_choose_task_${n}`));
  assert.equal(new Set(three).size, 3);
  assert.ok(!three.includes(0));
});

test("picking a task sets it with its modifier, as live does", () => {
  const player = createPlayer();
  Choice.roll(player, master(MORTIMER));
  setVarbit(player, "slayer_choose_task_2", taskId("Aberrant Spectres"));
  setVarbit(player, "slayer_choose_task_2_modifier_id", Data.MODIFIER.QUANTITY);
  setVarbit(player, "slayer_choose_task_2_modifier_value", 75);
  setVarbit(player, "slayer_choose_task_2_modifier_negative", 0);
  const before = emitted.length;
  Choice.pick({ player, action: 10 });
  const task = Tasks.current(player);
  assert.equal(task.taskId, taskId("Aberrant Spectres"));
  assert.equal(task.masterId, MORTIMER);
  assert.deepEqual(task.modifier, { id: 2, value: 75, negative: false });
  assert.equal(task.count, task.original + 75, "the base roll, then the modifier");
  assert.ok(task.original >= 80 && task.original <= 120);
  for (const name of ["slayer_choose_task_1", "slayer_choose_task_2", "slayer_choose_task_2_modifier_value", "slayer_choose_rolled_master"]) {
    assert.equal(varbit(player, name), 0, name);
  }
  assert.ok(emitted.slice(before).some(([name]) => name === "slayer:task-chosen"));

  const shorter = createPlayer();
  Choice.roll(shorter, master(MORTIMER));
  setVarbit(shorter, "slayer_choose_task_1", taskId("Cave Crawlers"));
  setVarbit(shorter, "slayer_choose_task_1_modifier_id", Data.MODIFIER.QUANTITY);
  setVarbit(shorter, "slayer_choose_task_1_modifier_value", 20);
  setVarbit(shorter, "slayer_choose_task_1_modifier_negative", 1);
  Choice.pick({ player: shorter, action: 0 });
  assert.equal(Tasks.current(shorter).count, Tasks.current(shorter).original - 20);
});

test("completing a Mortimer task: his own streak and the points modifier (captured lines)", () => {
  const player = createPlayer({ points: 190 });
  giveTask(player, MORTIMER, "Cave Crawlers", 1);
  setVarp(player, "slayer_mortimer_tasks_completed", 1);
  setVarbit(player, "slayer_modifier_id", Data.MODIFIER.POINTS);
  setVarbit(player, "slayer_modifier_value", 5);
  kill(player, npcNamed("Cave crawler"));
  assert.equal(varp(player, "slayer_mortimer_tasks_completed"), 2);
  assert.equal(varbit(player, "slayer_points"), 195);
  assert.equal(varbit(player, "slayer_tasks_completed"), 0, "not the standard streak");
  assert.equal(varbit(player, "slayer_modifier_id"), 0, "cleared with the task");
  assert.equal(player.messages.at(-1),
    "<col=ef1020>You've completed </col>2 Mortimer tasks<col=ef1020> and received </col>5 points<col=ef1020>, giving you a total of </col>195<col=ef1020>; return to a Slayer master.</col>");

  const plain = createPlayer({ points: 10 });
  giveTask(plain, MORTIMER, "Cave Crawlers", 1);
  setVarbit(plain, "slayer_modifier_id", Data.MODIFIER.CLUES);
  setVarbit(plain, "slayer_modifier_value", 50);
  kill(plain, npcNamed("Cave crawler"));
  assert.equal(varbit(plain, "slayer_points"), 10);
  assert.equal(plain.messages.at(-1), "<col=ef1020>You've completed </col>1 Mortimer tasks<col=ef1020>; return to a Slayer master.</col>");
});

test("Mortimer's Slayer XP and clue modifiers", () => {
  const player = createPlayer();
  giveTask(player, MORTIMER, "Bloodveld", 10);
  setVarbit(player, "slayer_modifier_id", Data.MODIFIER.XP);
  setVarbit(player, "slayer_modifier_value", 25);
  const bloodveld = npcNamed("Bloodveld");
  kill(player, bloodveld);
  assert.equal(player.xp.at(-1)[1], bloodveld.getDefinition().getHitpoints() * 1.25);

  setVarbit(player, "slayer_modifier_id", Data.MODIFIER.CLUES);
  setVarbit(player, "slayer_modifier_value", 100);
  const chance = (name, npc) => {
    const request = { player, npc, rules: [] };
    for (const fn of handlers.events.get("npc-drops:tertiary-chance")) fn(request);
    return request.rules.filter((rule) => rule.pattern.test(name)).reduce((total, rule) => total * rule.multiplier, 1);
  };
  assert.equal(chance("Clue scroll (hard)", npcNamed("Bloodveld")), 2);
  assert.equal(chance("Long bone", npcNamed("Bloodveld")), 1, "only clue scrolls");
  assert.equal(chance("Clue scroll (hard)", npcNamed("Abyssal demon")), 1, "only on task");
});

test("superiors roll the unique tables, more often with Mortimer's modifier", () => {
  const hand = npcNamed("Crushing hand");
  assert.equal(Superiors.uniqueChance(hand), 200 - 60 ** 2 / 125, "Wiki: 1/171.2 for a Slayer level 5 superior");
  const { ItemIdentifiers } = core;
  assert.deepEqual(Superiors.rollUniques(hand, 1, () => 0), [ItemIdentifiers.IMBUED_HEART, ItemIdentifiers.ETERNAL_GEM]);
  assert.deepEqual(Superiors.rollUniques(hand, 1, sequence(0, 0.99, 0, 0.99)), [ItemIdentifiers.MIST_BATTLESTAFF]);
  assert.deepEqual(Superiors.rollUniques(hand, 1, () => 0.01), [], "1/171.2 misses 0.01");
  assert.equal(Superiors.rollUniques(hand, 2, sequence(0.01, 0, 0.99)).length, 1, "doubled, 0.01 hits");

  const player = createPlayer();
  giveTask(player, MORTIMER, "Crawling Hands", 10);
  setVarbit(player, "slayer_modifier_id", Data.MODIFIER.SUPERIOR_UNIQUES);
  setVarbit(player, "slayer_modifier_value", 50);
  assert.equal(Tasks.killBoost(player, hand, Data.MODIFIER.SUPERIOR_UNIQUES), 1.5);
});


function braceletPlayer() {
  const player = createPlayer();
  const items = Array.from({ length: 14 }, () => new core.Item(-1));
  const bag = [new core.Item(core.ItemIdentifiers.BRACELET_OF_SLAUGHTER)];
  items[core.Equipment.HANDS_SLOT] = new core.Item(core.ItemIdentifiers.BRACELET_OF_SLAUGHTER);
  const equipment = {
    get: slot => items[slot], getItems: () => items,
    set: (slot, item) => { items[slot] = item; return equipment; },
    refreshItems() { player.equipmentRefreshes++; return equipment; },
  };
  const inventory = {
    get: slot => bag[slot], getItems: () => bag,
    deleteAtSlot(slot) { bag[slot] = new core.Item(-1); return inventory; },
    refreshItems() { return inventory; },
  };
  player.equipmentRefreshes = 0;
  player.getEquipment = () => equipment;
  player.getInventory = () => inventory;
  // Keep the real PacketSender, but capture typed messages too.
  player.getSession = () => ({ sendClientPacket() { return true; }, write() {} });
  const sender = player.getPacketSender();
  const typed = sender.sendTypedMessage.bind(sender);
  player.typedMessages = [];
  sender.sendTypedMessage = (type, message) => { player.typedMessages.push([type, message]); return typed(type, message); };
  return player;
}

function braceletAction(player, worn, clickType) {
  const slot = worn ? core.Equipment.HANDS_SLOT : 0;
  const item = (worn ? player.getEquipment() : player.getInventory()).get(slot);
  return PluginManager.emitItemAction({ player, item, itemId: item.getId(), slot, clickType,
    interfaceId: worn ? core.Equipment.INVENTORY_INTERFACE_ID : 149, handled: false });
}

test("slaughter activation preserves the last task kill and XP, using the captured spam message", t => {
  const player = braceletPlayer();
  giveTask(player, 3, "Bloodveld", 1);
  t.mock.method(Math, "random", () => 0);
  const target = npcNamed("Bloodveld");
  kill(player, target);
  assert.equal(varp(player, "slayer_count"), 1);
  assert.equal(player.xp[0][1], target.getDefinition().getHitpoints());
  assert.deepEqual(player.typedMessages, [[core.ChatType.SPAM,
    "Your bracelet of slaughter prevents your slayer count from decreasing. It has 29 charges left."]]);
  assert.equal(varbit(player, "slayer_tasks_completed"), 0);
});

test("slaughter rolls only on qualifying kills while worn and has a 25% boundary", t => {
  const player = braceletPlayer();
  giveTask(player, 3, "Bloodveld", 4);
  const random = t.mock.method(Math, "random", () => 0.25);
  kill(player, npcNamed("Bloodveld"));
  assert.equal(varp(player, "slayer_count"), 3);
  assert.equal(player.typedMessages.length, 0);
  random.mock.mockImplementation(() => 0.249999);
  kill(player, npcNamed("Bloodveld"));
  assert.equal(varp(player, "slayer_count"), 3);
  const rolls = random.mock.callCount();
  kill(player, npcNamed("Goblin"));
  player.getEquipment().set(core.Equipment.HANDS_SLOT, new core.Item(-1));
  kill(player, npcNamed("Bloodveld"));
  assert.equal(random.mock.callCount(), rolls, "off-task and inventory bracelets never roll");
  assert.equal(varp(player, "slayer_count"), 2);
});

test("slaughter charges are shared by replacement bracelets and Check works worn and in inventory", t => {
  const player = braceletPlayer();
  giveTask(player, 3, "Bloodveld", 2);
  t.mock.method(Math, "random", () => 0);
  kill(player, npcNamed("Bloodveld"));
  assert.equal(braceletAction(player, false, 3), true);
  assert.match(player.messages.at(-1), /29 charges/);
  // A distinct item has the same remaining charges; no per-item metadata.
  player.getEquipment().set(core.Equipment.HANDS_SLOT, new core.Item(core.ItemIdentifiers.BRACELET_OF_SLAUGHTER));
  assert.equal(braceletAction(player, true, 2), true);
  assert.match(player.messages.at(-1), /29 charges/);
});

test("the thirtieth activation removes only the worn bracelet and resets shared charges", t => {
  const player = braceletPlayer();
  giveTask(player, 3, "Bloodveld", 1);
  t.mock.method(Math, "random", () => 0);
  for (let n = 0; n < 30; n++) kill(player, npcNamed("Bloodveld"));
  assert.equal(player.getEquipment().get(core.Equipment.HANDS_SLOT).getId(), -1);
  assert.equal(player.equipmentRefreshes, 1);
  assert.equal(varp(player, "slayer_count"), 1);
  assert.equal(braceletAction(player, false, 3), true);
  assert.match(player.messages.at(-1), /30 charges/);
  kill(player, npcNamed("Bloodveld"));
  assert.equal(varp(player, "slayer_count"), 0, "a subsequent kill completes normally");
  assert.equal(varbit(player, "slayer_tasks_completed"), 1);
});

test("Break sacrifices the selected inventory bracelet and resets the worn bracelet's shared pool", t => {
  const player = braceletPlayer();
  giveTask(player, 3, "Bloodveld", 1);
  t.mock.method(Math, "random", () => 0);
  kill(player, npcNamed("Bloodveld"));
  assert.equal(braceletAction(player, false, 4), true);
  assert.equal(player.getInventory().get(0).getId(), -1);
  assert.equal(player.getEquipment().get(core.Equipment.HANDS_SLOT).getId(), core.ItemIdentifiers.BRACELET_OF_SLAUGHTER);
  assert.equal(braceletAction(player, true, 2), true);
  assert.match(player.messages.at(-1), /30 charges/);
});


test("slaughter charges survive an attribute save/load and do not leak between players", t => {
  const Bracelet = require("../plugins/skills/slayer/SlaughterBracelet.Slayer");
  assert.equal(persistedAttributes.get(Bracelet.CHARGES_ATTRIBUTE), 30);
  const player = braceletPlayer();
  giveTask(player, 3, "Bloodveld", 2);
  t.mock.method(Math, "random", () => 0);
  kill(player, npcNamed("Bloodveld"));
  const saved = JSON.parse(JSON.stringify(Object.fromEntries(
    [...persistedAttributes.keys()].map(key => [key, player.getAttribute(key)]))));
  const restored = braceletPlayer();
  for (const [key, value] of Object.entries(saved)) restored.setAttribute(key, value);
  assert.equal(braceletAction(restored, true, 2), true);
  assert.match(restored.messages.at(-1), /29 charges/);
  const other = braceletPlayer();
  braceletAction(other, true, 2);
  assert.match(other.messages.at(-1), /30 charges/);
});

test("Jad and Zuk never consume slaughter charges or roll the effect", () => {
  const Bracelet = require("../plugins/skills/slayer/SlaughterBracelet.Slayer");
  const player = braceletPlayer();
  for (const name of ["TzTok-Jad", "TzKal-Zuk"]) {
    assert.equal(Bracelet.preventsDecrement(player, npcNamed(name), () => { throw Error("excluded boss rolled"); }), false);
  }
  assert.equal(Bracelet.charges(player), 30);
});

test("claimed elite Combat Achievements regenerate on a roll below 10%, otherwise the bracelet disappears", t => {
  const Bracelet = require("../plugins/skills/slayer/SlaughterBracelet.Slayer");
  const previous = handlers.events.get("combat-achievements:tier");
  let claimed = true;
  handlers.events.set("combat-achievements:tier", [request => {
    assert.equal(request.tier, "Elite");
    request.unlocked = true;
    request.claimed = claimed;
  }]);
  t.after(() => previous ? handlers.events.set("combat-achievements:tier", previous) : handlers.events.delete("combat-achievements:tier"));
  for (const [roll, isClaimed] of [[0.099999, true], [0.1, true], [0, false]]) {
    claimed = isClaimed;
    const player = braceletPlayer();
    giveTask(player, 3, "Bloodveld", 1);
    player.setAttribute(Bracelet.CHARGES_ATTRIBUTE, 1);
    let n = 0;
    const mock = t.mock.method(Math, "random", () => n++ === 0 ? 0 : roll);
    kill(player, npcNamed("Bloodveld"));
    mock.mock.restore();
    assert.equal(varp(player, "slayer_count"), 1);
    assert.equal(player.xp.length, 1);
    assert.equal(Bracelet.charges(player), 30);
    const regenerates = isClaimed && roll < 0.1;
    assert.equal(player.getEquipment().get(core.Equipment.HANDS_SLOT).getId(), regenerates ? core.ItemIdentifiers.BRACELET_OF_SLAUGHTER : -1);
    assert.match(player.typedMessages.at(-1)[1], regenerates ? /regenerates/ : /crumbles/);
  }
});

test("notes and placeholders cannot Check or Break the shared slaughter charges", () => {
  for (const itemId of [core.ItemIdentifiers.BRACELET_OF_SLAUGHTER_2, core.ItemIdentifiers.BRACELET_OF_SLAUGHTER_3]) {
    const player = braceletPlayer();
    const item = new core.Item(itemId);
    for (const clickType of [3, 4]) {
      assert.equal(PluginManager.emitItemAction({ player, item, itemId, slot: 0, clickType, interfaceId: 149, handled: false }), false);
    }
    assert.equal(player.messages.length, 0);
  }
});

test("leaving the Fight Cave clears a Jad task, with the Wiki's message and the streak kept", () => {
  const player = createPlayer();
  const jad = npcNamed("TzTok-Jad");
  const leave = (who, npcId) => handlers.events.get("slayer:leave-task-area").forEach((fn) => fn({ player: who, npcId, message: "the fight cave" }));
  giveTask(player, MORTIMER, "TzTok-Jad", 2);
  setVarbit(player, "slayer_tasks_completed", 7);
  leave(player, npcNamed("Bloodveld").getId());
  assert.equal(varp(player, "slayer_count"), 2, "another monster's area leaves it be");
  leave(player, jad.getId());
  assert.equal(varp(player, "slayer_count"), 0);
  assert.equal(player.messages.at(-1), "You no longer have a slayer task as you left the fight cave.");
  assert.equal(varbit(player, "slayer_tasks_completed"), 7, "the streak is not reset");
});

test("native superior deaths keep three normal rolls and 550 XP; CoX scavengers keep two rolls", (t) => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { NPCDeathTask } = require("../dist/game/task/impl/NPCDeathTask");
  const Drops = require("../plugins/npcs/NpcDrops.plugin");
  const Scavengers = require("../plugins/minigames/cox/Scavengers.ChambersOfXeric");
  const depth = PluginManager.npcDeathHooks.length;
  t.after(() => { PluginManager.npcDeathHooks.length = depth; });
  Slayer.register(PluginManager.createApi("SuperiorDeathTest"));
  const placed = [];
  const api = {
    ...PluginManager.createApi("SuperiorDropTest"),
    getItemOnGroundManager: () => ({
      registerLocation: (_player, item) => placed.push([item.getId(), item.getAmount()]),
    }),
    log() {},
  };
  Drops.register(api);
  Scavengers(api);
  t.mock.method(Math, "random", () => 0.1); // Normal loot hits; the rare unique tables miss.
  let nextIndex = 1900;
  function nativeKill(id, onTask = false, room = null) {
    const player = new Player(null);
    player.setIndex(nextIndex++);
    player.setRegistered(true);
    player.getSession = () => ({ sendClientPacket: () => true, write() {} });
    player.getSkillManager().setMaxLevel(Skill.SLAYER, 99);
    const xp = [];
    t.mock.method(player.getSkillManager(), "addExperiences", (skill, amount) => xp.push([skill, amount]));
    if (onTask) giveTask(player, 1, "Crawling Hands", 10);
    const monster = PluginManager.spawnNpc({ id, x: 3420, y: 3560, z: 0, owner: player }, "SuperiorDeathTest");
    if (room) monster.__coxRoom = room;
    t.after(() => { core.World.getNpcs().remove(monster); player.setRegistered(false); });
    monster.getCombat().addDamage(player, monster.getCurrentDefinition().getHitpoints());
    monster.setHitpoints(0);
    placed.length = 0;
    const death = new NPCDeathTask(monster);
    death.execute();
    death.execute();
    return { drops: placed.slice(), xp, player };
  }
  const hand = core.NpcIdentifiers.CRUSHING_HAND;
  assert.equal(CacheDefinitions.getNpc(hand).name, "Crushing hand");
  for (const onTask of [false, true]) {
    const result = nativeKill(hand, onTask);
    assert.deepEqual(result.drops, [
      [core.ItemIdentifiers.BONES, 1],
      ...Array.from({ length: 3 }, () => [core.ItemIdentifiers.LEATHER_GLOVES, 1]),
    ], "one guaranteed bones drop and three independent normal loot rolls");
    assert.deepEqual(result.xp, [[Skill.SLAYER, 550]], "superior XP is given once, on or off task");
    if (onTask) assert.equal(varp(result.player, "slayer_count"), 9);
  }
  const scavenger = nativeKill(core.NpcIdentifiers.SCAVENGER_BEAST, false,
    Object.create(Scavengers.ScavengerRoom.prototype));
  assert.equal(scavenger.drops.filter(([id]) => id === core.ItemIdentifiers.BONES).length, 1);
  assert.equal(scavenger.drops.filter(([id]) => id !== core.ItemIdentifiers.BONES).length, 2,
    "the canonical two-roll table replaces CoX's extra-roll workaround");
});
