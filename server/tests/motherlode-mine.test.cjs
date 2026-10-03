// Run after `yarn build`: node --test tests/motherlode-mine.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { Location } = require("../dist/game/model/Location");
const { Skill } = require("../dist/game/model/Skill");
const { ItemIds } = require("../dist/util/IdEnums");

const Mine = require("../plugins/areas/motherlode/MotherlodeState");
const Veins = require("../plugins/areas/motherlode/MotherlodeVeins");
const Machine = require("../plugins/areas/motherlode/MotherlodeMachine");
const Rockfalls = require("../plugins/areas/motherlode/MotherlodeRockfalls");

const hooks = { objects: {}, conditions: [], events: {} };
const spawned = [];
const MotherlodeMine = require("../plugins/areas/MotherlodeMine.plugin");
MotherlodeMine.register({
  persistAttribute() {},
  onServerStartup() {},
  onPlayerLogin() {},
  onPlayerLogout() {},
  onZoneEnter() {},
  onZoneExit() {},
  onObjectRoute() {},
  onObjectInteraction: (name, actions) => { hooks.objects[name] = { ...hooks.objects[name], ...actions }; },
  onNpcDialogueCondition: (handler) => hooks.conditions.push(handler),
  onCustomEvent: (name, handler) => { (hooks.events[name] ??= []).push(handler); },
  registerCommand() {},
  spawnNpc: ({ id, x, y }) => {
    const npc = { id, location: new Location(x, y, 0), removed: false };
    npc.moveTo = (location) => { npc.location = location; };
    npc.setScriptedMovement = () => {};
    spawned.push(npc);
    return npc;
  },
  removeNpc: (npc) => { npc.removed = true; },
});
const { tick, percyCondition } = MotherlodeMine._test;

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  Veins.spawnAll();
  Machine.start(0);
});

let now = 0;
function ticks(count) {
  for (let i = 0; i < count; i++) {
    now++;
    tick();
  }
}

function withRandom(value, run) {
  const random = Math.random;
  Math.random = typeof value === "function" ? value : () => value;
  try {
    return run();
  } finally {
    Math.random = random;
  }
}

function inventory(capacity = 28) {
  const items = [];
  return {
    items,
    getAmount: (id) => items.filter((item) => item.id === id).reduce((sum, item) => sum + item.amount, 0),
    contains: (id) => items.some((item) => item.id === id),
    isFull: () => items.length >= capacity,
    getFreeSlots: () => capacity - items.length,
    add(item) {
      const stack = item.getId() === ItemIds.GOLDEN_NUGGET && items.find((entry) => entry.id === item.getId());
      if (stack) stack.amount += item.getAmount();
      else items.push({ id: item.getId(), amount: item.getAmount() });
    },
    delete(id, amount) {
      for (let i = items.length - 1; i >= 0 && amount > 0; i--) {
        if (items[i].id !== id) continue;
        const taken = Math.min(amount, items[i].amount);
        items[i].amount -= taken;
        amount -= taken;
        if (!items[i].amount) items.splice(i, 1);
      }
    },
  };
}

function player(x, y, { mining = 99, smithing = 99 } = {}) {
  const attributes = new Map();
  const p = {
    messages: [], xp: [], animations: [], varbits: new Map(), dialogues: [], hits: [],
    location: new Location(x, y, 0),
    inventory: inventory(),
    getUsername: () => "miner",
    getLocation: () => p.location,
    moveTo(location) { p.location = location; },
    isRegistered: () => true,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => p.inventory,
    getEquipment: () => ({ getItems: () => new Array(14).fill(null) }),
    getMovementQueue: () => ({ size: () => 0 }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.SMITHING ? smithing : mining),
      getMaxLevel: (skill) => (skill === Skill.SMITHING ? smithing : mining),
      addExperiences: (skill, amount) => p.xp.push([skill.getName(), amount]),
    }),
    getPacketSender() {
      const sender = new Proxy({}, { get: (_, name) => (...args) => {
        if (name === "sendVarbit") p.varbits.set(args[0], args[1]);
        return sender;
      } });
      return sender;
    },
    getDialogueManager: () => ({ startDialogues: (chain) => p.dialogues.push(chain) }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => p.hits.push(...hits.map((h) => h.getDamage())) }) }),
    sendMessage: (message) => p.messages.push(message),
    performAnimation: (animation) => p.animations.push(animation.getId()),
  };
  return p;
}

function locAt(id, [x, y]) {
  return MapObjects.get(id, new Location(x, y, 0), null);
}

function interact(name, option, event) {
  return hooks.objects[name][option]({ clickType: 1, ...event });
}

beforeEach(() => {
  spawned.length = 0;
  Machine.batches.clear();
  // Both wheels turning, and not breaking on their own mid-test.
  Machine.start(now);
  for (const strut of Machine.struts) strut.breaksAt = Infinity;
});

test("pay-dirt is a nugget 1 in 32 at any level, and coal falls from 96.9% at 30 to 24.6% at 99 (Wiki)", () => {
  const chances = (level) => {
    let left = 1;
    const out = {};
    for (const ore of Mine.ORES) {
      const chance = ore.low === undefined ? 1 : level >= ore.level ? Mine.successChance(ore.low, ore.high, level) : 0;
      out[ore.key] = left * chance;
      left -= out[ore.key];
    }
    return out;
  };
  for (const level of [30, 60, 99]) assert.equal(chances(level).nugget, 1 / 32);
  assert.equal(chances(30).coal.toFixed(3), "0.969");
  assert.equal(chances(99).coal.toFixed(3), "0.246");
  assert.equal(chances(84).runite, 0, "runite needs 85");
  assert.equal(withRandom(0.99, () => Mine.rollOre(99)).key, "coal");
});

test("the live veins are spawned over the map's depleted ones", () => {
  assert.equal(Veins.veins.size, 266);
  const vein = Veins.veins.get("3729,5650") ?? [...Veins.veins.values()][0];
  assert.ok(locAt(vein.oreId, vein.tile), "the ore vein is there");
  assert.equal(locAt(vein.depletedId, vein.tile), null, "and not the depleted one");
  assert.equal(Mine.isUpperLevel(3754, 5682), true, "a captured upper-level vein");
  assert.equal(Mine.isUpperLevel(3729, 5650), false);
});

test("mining a vein gives pay-dirt with its ore rolled then, and the vein depletes on a timer", () => {
  const vein = [...Veins.veins.values()].find((candidate) => !candidate.upper && candidate.respawnsAt < 0);
  const p = player(vein.tile[0] - 1, vein.tile[1]);
  p.inventory.add({ getId: () => ItemIds.DRAGON_PICKAXE, getAmount: () => 1 });
  withRandom(0, () => interact("Ore vein", "Mine", { player: p, objectId: vein.oreId, location: { x: vein.tile[0], y: vein.tile[1], z: 0 } }));
  assert.equal(p.messages.at(-1), "You swing your pick at the rock.");
  assert.equal(p.animations.at(-1), 6758, "the dragon pickaxe's wall animation, as captured");
  withRandom(0, () => ticks(3));
  assert.equal(p.inventory.getAmount(Mine.PAY_DIRT), 1);
  assert.equal(p.messages.at(-1), "You manage to mine some pay-dirt.");
  assert.deepEqual(p.xp.at(-1), ["Mining", 60]);
  assert.deepEqual(Mine.stateOf(p).held, ["nugget"], "its ore is rolled as it is mined");
  assert.ok(vein.depletesAt > now, "its first pay-dirt starts its timer");

  Veins.stopMining(p);
  ticks(vein.depletesAt - now);
  assert.ok(locAt(vein.depletedId, vein.tile), "depleted");
  assert.equal(locAt(vein.oreId, vein.tile), null);
  ticks(vein.respawnsAt - now);
  assert.ok(locAt(vein.oreId, vein.tile), "and back");
});

test("deposited pay-dirt floats down the channel and washes into ore in the sack 12 ticks later", () => {
  const p = player(3748, 5673);
  p.inventory.add({ getId: () => Mine.PAY_DIRT, getAmount: () => 1 });
  p.inventory.add({ getId: () => Mine.PAY_DIRT, getAmount: () => 1 });
  Mine.stateOf(p).held.push("runite");
  withRandom(0.99, () => interact("Hopper", "Deposit", { player: p, objectId: Machine.HOPPER, location: { x: 3748, y: 5672, z: 0 } }));
  assert.equal(p.inventory.getAmount(Mine.PAY_DIRT), 0);
  assert.deepEqual(Mine.stateOf(p).machine, ["runite", "coal"], "the mined one's ore, then a roll for the other");
  assert.deepEqual(Mine.stateOf(p).held, []);
  assert.equal(p.animations.at(-1), 832);

  ticks(1);
  assert.deepEqual([spawned[0].id, spawned[0].location.getX(), spawned[0].location.getY()], [6564, 3748, 5671]);
  ticks(10);
  assert.equal(Mine.sackTotal(Mine.stateOf(p)), 0);
  ticks(1);
  assert.equal(spawned[0].removed, true);
  assert.deepEqual(Mine.stateOf(p).sack, { runite: 1, coal: 1 });
  assert.equal(p.varbits.get(Mine.VARBIT_SACK), 2);
  assert.deepEqual(p.xp.at(-1), ["Mining", 90], "75 for the runite and 15 for the coal");
  assert.equal(p.messages.at(-1), "Some ore is ready to be collected from the sack.");
});

test("the pay-dirt stops in the channel while both wheels are broken", () => {
  const p = player(3748, 5673);
  p.inventory.add({ getId: () => Mine.PAY_DIRT, getAmount: () => 1 });
  interact("Hopper", "Deposit", { player: p, objectId: Machine.HOPPER, location: { x: 3748, y: 5672, z: 0 } });
  ticks(3);
  Machine.forceBreak({ player: p });
  Machine.forceBreak({ player: p });
  assert.equal(Machine.isFlowing(), false);
  assert.ok(locAt(Machine.BROKEN_STRUT, Machine.struts[0].strut), "the broken strut is back");
  ticks(20);
  assert.equal(Mine.sackTotal(Mine.stateOf(p)), 0, "nothing reaches the sack");

  const smith = player(3741, 5669);
  smith.inventory.add({ getId: () => ItemIds.HAMMER, getAmount: () => 1 });
  interact("Broken strut", "Hammer", { player: smith, objectId: Machine.BROKEN_STRUT, location: { x: 3742, y: 5669, z: 0 } });
  withRandom(0, () => ticks(1));
  assert.equal(smith.animations.at(-1), 3971);
  assert.equal(Machine.struts[0].broken, false, "repaired");
  assert.deepEqual(smith.xp.at(-1), ["Smithing", 148.5], "1.5 XP per Smithing level");
  ticks(12);
  assert.equal(Mine.sackTotal(Mine.stateOf(p)), 1, "and it flows again");
});

test("searching the sack gives the nuggets, then ore into the free slots", () => {
  const p = player(3748, 5660);
  const state = Mine.stateOf(p);
  state.sack = { nugget: 3, mithril: 30, coal: 5 };
  p.inventory = inventory(28);
  interact("Sack", "Search", { player: p, objectId: Machine.SACK, location: { x: 3748, y: 5659, z: 0 } });
  assert.equal(p.inventory.getAmount(ItemIds.GOLDEN_NUGGET), 3);
  assert.equal(p.inventory.getAmount(ItemIds.MITHRIL_ORE), 27, "the nuggets' stack takes one slot");
  assert.deepEqual(state.sack, { nugget: 0, mithril: 3, coal: 5 });
  assert.equal(p.varbits.get(Mine.VARBIT_SACK), 8);
  assert.equal(p.dialogues.length, 1, "You collect your ore from the sack.");
});

test("the upper hopper is Mercy's until Percy is paid, and Percy sells the unlocks", () => {
  const p = player(3755, 5678, { mining: 60 });
  p.inventory.add({ getId: () => Mine.PAY_DIRT, getAmount: () => 1 });
  interact("Hopper", "Deposit", { player: p, objectId: Machine.HOPPER, location: { x: 3755, y: 5677, z: 0 } });
  assert.equal(p.dialogues.length, 1);
  assert.equal(p.inventory.getAmount(Mine.PAY_DIRT), 1, "nothing deposited");

  const ask = (text) => percyCondition({ player: p, npcId: 6562, text });
  assert.equal(ask("If the player has none of the three upgrades unlocked:"), true);
  assert.equal(ask("If the player does not have 100 nuggets:"), true);
  p.inventory.add({ getId: () => ItemIds.GOLDEN_NUGGET, getAmount: () => 400 });
  assert.equal(ask("If the player has 100 nuggets and is at least level 54 Mining:"), true);
  const pay = (stepId) => hooks.events["npc-dialogue:action"].forEach((handler) => handler({ player: p, npcId: 6562, stepId, kind: "message" }));
  pay("oc01u6");
  assert.equal(Mine.stateOf(p).upperLevel, true);
  assert.equal(p.inventory.getAmount(ItemIds.GOLDEN_NUGGET), 300);
  pay("percyBiggerSack");
  assert.equal(Mine.stateOf(p).biggerSack, true);
  assert.equal(p.varbits.get(Mine.VARBIT_BIGGER_SACK), 1);
  assert.equal(ask("If the player has both the upper level and bigger sack unlocked without the super hopper unlocked:"), true);
  pay("gj_wc0");
  assert.equal(Mine.stateOf(p).upperHopper, true);
  assert.equal(p.inventory.getAmount(ItemIds.GOLDEN_NUGGET), 50);
  assert.equal(Mine.capacity(Mine.stateOf(p)), 189);
});

test("the upper hopper is used across its railings, from the walkway in front of it", () => {
  const hopper = (x, y) => ({ objectId: Machine.HOPPER, object: { getLocation: () => new Location(x, y, 0) } });
  const upper = hopper(3755, 5677);
  Machine.routeToHopper(upper);
  assert.deepEqual(upper.destination, { x: 3755, y: 5676, z: 0 });
  const lower = hopper(3748, 5672);
  Machine.routeToHopper(lower);
  assert.equal(lower.destination, undefined, "the lower hopper is walked to as usual");
});

test("a rockfall is mined away for 10 XP, then comes down again on whoever stands there", () => {
  const tile = [3728, 5688];
  const rock = locAt(26679, tile);
  assert.ok(rock);
  const p = player(3728, 5687);
  p.inventory.add({ getId: () => ItemIds.DRAGON_PICKAXE, getAmount: () => 1 });
  interact("Rockfall", "Mine", { player: p, object: rock, objectId: 26679, location: { x: tile[0], y: tile[1], z: 0 } });
  ticks(2);
  assert.equal(locAt(26679, tile), null, "gone 2 ticks after the swing");
  assert.deepEqual(p.xp.at(-1), ["Mining", 10]);

  const entry = Rockfalls.cleared[0];
  const under = player(...tile);
  const { World } = require("../dist/game/World");
  const players = World.getPlayers;
  World.getPlayers = () => [under];
  try {
    ticks(entry.collapsesAt - now + 1);
  } finally {
    World.getPlayers = players;
  }
  assert.ok(locAt(26679, tile), "back");
  assert.equal(under.hits.length, 1);
  assert.ok(under.hits[0] >= 1 && under.hits[0] <= 4, "1-4 damage");
});

test("Percy's real transcript reaches his unlock menu whatever has been bought", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { pickVariant, startDialogue } = require("../plugins/npcs/NpcDialogues.plugin");
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/definitions/npc-dialogues.json"), "utf8"));
  const steps = pickVariant(data["Prospector Percy"]);
  const hook = { pluginName: "MotherlodeMine", handler: hooks.conditions[0] };
  PluginManager.npcDialogueConditionHooks.unshift(hook);
  const menuAfterAsking = (owned) => {
    const p = player(3756, 5665);
    Object.assign(Mine.stateOf(p), owned);
    p.getDialogueManager = () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          try { entry.send(p); } catch { /* unwired dialogue entries are fine here */ }
        }
      },
    });
    const menus = [];
    const api = {
      emitCustomEvent() {},
      sendMultiChatboxPrompt(_player, _title, ...pairs) {
        const options = [];
        for (let i = 0; i < pairs.length; i += 2) options.push({ text: pairs[i], cb: pairs[i + 1] });
        menus.push(options.map((option) => option.text));
        if (menus.length === 1) options.find((option) => option.text === "Is there anything else I can unlock here?").cb();
        return true;
      },
    };
    const definition = { getName: () => "Prospector Percy", getId: () => 6562 };
    const event = { player: p, npc: { getId: () => 6562 }, npcId: 6562, definition };
    startDialogue(api, event, steps, {}, { player: p, npc: event.npc, npcId: 6562, definition, pages: [] });
    return menus[1];
  };
  try {
    assert.deepEqual(menuAfterAsking({}), ["Restricted mine access: 100 nuggets", "Bigger sack: 200 nuggets", "Cancel"]);
    assert.deepEqual(menuAfterAsking({ biggerSack: true }), ["Restricted mine access: 100 nuggets", "Cancel"],
      "the Wiki has no lines for this one; npc-dialogues.json fills them from Percy's others");
    assert.deepEqual(menuAfterAsking({ upperLevel: true }), ["Bigger sack: 200 nuggets", "Cancel"]);
    assert.deepEqual(menuAfterAsking({ upperLevel: true, biggerSack: true }), ["Restricted hopper: 50 nuggets", "Cancel"]);
  } finally {
    PluginManager.npcDialogueConditionHooks.splice(PluginManager.npcDialogueConditionHooks.indexOf(hook), 1);
  }
});
