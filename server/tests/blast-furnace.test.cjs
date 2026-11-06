// Run after `yarn build`: node --test tests/blast-furnace.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds, NpcIds } = require("../dist/util/IdEnums");

const spawned = [];
const BlastFurnace = require("../plugins/minigames/BlastFurnace.plugin");
const Machinery = require("../plugins/minigames/blastfurnace/Machinery.BlastFurnace");
const { Location } = require("../dist/game/model/Location");
const { Player } = require("../dist/game/entity/impl/player/Player");
let giantDwarfStarted = false;
let dwarfOperated = true;
let playerIndex = 0;
let nativeRun = false, mockApi;
const prompts = [];
const { init, tick, stateOf, putOre, takeBars, take, fillBucket, foremanCondition, foremanPaid, coolWithWater, stairs } = BlastFurnace._test;
before(async () => {
 await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(process.cwd());
 PluginManager.getCoreApi().RegionManager.init();
 mockApi = {
  core: { ...PluginManager.getCoreApi(), WorldDefinition: { hasGlobalWorldTag: () => dwarfOperated } },
  spawnNpc: ({ id }) => {
    const npc = { id, removed: false, moveTo() {}, performAnimation() {}, setScriptedMovement() {} };
    spawned.push(npc);
    return npc;
  },
  removeNpc: (npc) => { npc.removed = true; },
  emitCustomEvent(name, request) {
    if (name === "quest:is-started") request.started = giantDwarfStarted;
  },
  getTaskManager: () => ({ submit: (task) => task.setRunning(true) }),
  sendMultiChatboxPrompt: (player, title, ...choices) => prompts.push({ player, title, choices }),
 };
 init(mockApi);
});

const DISPENSER = 936;

function player({ smithing = 99, items = {}, hands = -1 } = {}) {
  const attributes = new Map();
  const inventory = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  const equipment = new Array(14).fill(null);
  if (hands !== -1) equipment[Equipment.HANDS_SLOT] = { getId: () => hands };
  const p = {
    messages: [], spam: [], xp: 0, varbits: new Map(), dialogues: 0, statement: null, sounds: [], menu: null, inventory,
    index: ++playerIndex, location: new Location(1940, 4960, 0), runEnergy: 10000, moving: false,
    getIndex: () => p.index,
    getLocation: () => p.location,
    isRegistered: () => true,
    isPlayer: () => true,
    getHitpoints: () => 99,
    getNpcTransformationId: () => -1,
    getMovementQueue: () => ({ size: () => p.moving ? 1 : 0 }),
    getForceMovement: () => null,
    getRunEnergy: Player.prototype.getRunEnergy,
    getRunEnergyUnits: Player.prototype.getRunEnergyUnits,
    setRunEnergy: Player.prototype.setRunEnergy,
    setRunEnergyUnits: Player.prototype.setRunEnergyUnits,
    setPositionToFace() {},
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      contains: (id) => (inventory.get(id) ?? 0) > 0,
      getFreeSlots: () => 28 - [...inventory.values()].reduce((sum, n) => sum + n, 0),
      getAddableAmount: (item) => Math.min(item.getAmount(), Math.max(0, 28 - [...inventory.values()].reduce((sum, n) => sum + n, 0))),
      deleteNumber: (id, n) => inventory.set(id, inventory.get(id) - n),
      addItem: (item) => inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()),
      add: (item) => inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()),
      refreshItems() {},
    }),
    getEquipment: () => ({ getItems: () => equipment }),
    getSkillManager: () => ({ getCurrentLevel: () => smithing, getMaxLevel: () => smithing, addExperiences: (_, xp) => { p.xp += xp; } }),
    getPacketSender() {
      const sender = new Proxy({}, { get: (_, name) => {
        if (name === "getVarbit") return (id) => p.varbits.get(id) ?? 0;
        return (...args) => {
          if (name === "sendVarbit") p.varbits.set(args[0], args[1]);
          if (name === "sendCreationMenu") p.menu = args[0];
          if (name === "sendSound") p.sounds.push(args[0]);
          if (name === "sendTypedMessage") p.spam.push(args[1]);
          return sender;
        };
      } });
      return sender;
    },
    getDialogueManager: () => ({ startDialogues: (chain) => { p.dialogues++; p.statement = chain.getDialogues().get(0)?.getText(); } }),
    sendMessage: (message) => p.messages.push(message),
    performAnimation() {},
  };
  return p;
}

function loadedOre(p, id) {
  return (stateOf(p).ores[id] ?? 0) + stateOf(p).conveyor.filter((load) => load.item === id)
    .reduce((sum, load) => sum + load.count, 0);
}

function ticks(count) {
  for (let i = 0; i < count; i++) tick();
}

beforeEach(() => {
  if (nativeRun) return;
  dwarfOperated = true;
  Machinery._test.reset();
  ticks(10); // let anything a previous test left on the belt or pouring finish
  spawned.length = 0;
});

function manualTicks(count) {
  for (let i = 0; i < count; i++) {
    for (const operation of [...Machinery._test.snapshot().operators.values()]) operation.task.execute();
    tick();
  }
}

const station = (player) => ({ player, object: { getLocation: () => player.getLocation() } });

test("coal bags must be emptied before belt loading; excess inventory coal remains carried", () => {
  const p = player({ items: { [ItemIds.COAL]: 10, [ItemIds.MITHRIL_ORE]: 1 } });
  stateOf(p).coffer = 1000;
  stateOf(p).ores[ItemIds.COAL] = 240;
  p.setAttribute("storage-items:coal-bag", [[ItemIds.COAL, 27]]);
  putOre(p);
  assert.equal(loadedOre(p, ItemIds.COAL), 250);
  assert.deepEqual(p.getAttribute("storage-items:coal-bag"), [[ItemIds.COAL, 27]], "Put-ore-on does not auto-empty a bag");
  assert.equal(p.inventory.get(ItemIds.COAL), 0);
  assert.equal(loadedOre(p, ItemIds.MITHRIL_ORE), 1);
  const Storage = require("../plugins/items/storage/Common.StorageItems");
  Storage.init({ core: PluginManager.getCoreApi() });
  Storage.emptyToInventory(p, { key: "coal-bag" });
  putOre(p);
  assert.equal(loadedOre(p, ItemIds.COAL), 254);
  assert.equal(p.inventory.get(ItemIds.COAL), 23, "unloaded coal remains when the furnace is full");
});

test("manual worlds require pedals and heat, not a coffer deposit", (t) => {
  dwarfOperated = false;
  t.mock.method(Math, "random", () => 1);
  const loader = player({ items: { [ItemIds.IRON_ORE]: 3, [ItemIds.SPADE]: 1 } });
  BlastFurnace._test.enterRoom({ player: loader });
  putOre(loader);
  ticks(5);
  assert.equal(stateOf(loader).bars[ItemIds.IRON_BAR], undefined, "stationary conveyor");
  Machinery._test.pedal(station(loader));
  manualTicks(4);
  assert.equal(stateOf(loader).bars[ItemIds.IRON_BAR], undefined, "cold furnace");
  assert.equal(loader.getRunEnergy(), 98);
  Machinery.leave(loader);
  Machinery._test.collectCoke({ player: loader });
  Machinery._test.refuel({ player: loader });
  assert.equal(loader.inventory.get(ItemIds.SPADE), 1, "refueling returns the spade");
  const pumper = player();
  Machinery._test.pump(station(pumper));
  manualTicks(40);
  assert.equal(stateOf(loader).bars[ItemIds.IRON_BAR], 3);
  assert.equal(pumper.xp, 40 * 2 + 1.5, "Strength plus contribution XP");
  assert.equal(stateOf(loader).coffer, 0);
  BlastFurnace._test.leaveRoom({ player: loader });
});

test("lead and cupronickel use their shared recipes and nickel cannot fill the pot", () => {
  const lead = player({ items: { [ItemIds.LEAD_ORE]: 4 } });
  stateOf(lead).coffer = 1000;
  putOre(lead);
  ticks(4);
  assert.equal(stateOf(lead).bars[ItemIds.LEAD_BAR], 2);
  assert.equal(lead.xp, 31);
  const nickel = player({ items: { [ItemIds.NICKEL_ORE]: 28 } });
  stateOf(nickel).coffer = 1000;
  putOre(nickel);
  ticks(4);
  assert.equal(stateOf(nickel).ores[ItemIds.NICKEL_ORE], 14);
  nickel.inventory.set(ItemIds.COPPER_ORE, 28);
  putOre(nickel);
  ticks(4);
  assert.equal(stateOf(nickel).bars[ItemIds.CUPRONICKEL_BAR], 7);
  assert.equal(nickel.xp, 7 * 42);
  assert.equal(stateOf(nickel).ores[ItemIds.NICKEL_ORE], 7);
  assert.equal(nickel.inventory.get(ItemIds.COPPER_ORE), 14, "the shared primary-ore limit still applies");
  const mixed = player({ items: { [ItemIds.NICKEL_ORE]: 28 } });
  stateOf(mixed).coffer = 1000;
  stateOf(mixed).ores[ItemIds.IRON_ORE] = 20;
  putOre(mixed);
  assert.equal(loadedOre(mixed, ItemIds.NICKEL_ORE), 8);
});

test("emptying requires confirmation, destroys only owned ore and clears its conveyor NPCs", () => {
  const p = player({ items: { [ItemIds.IRON_ORE]: 5 } }), other = player({ items: { [ItemIds.GOLD_ORE]: 2 } });
  stateOf(p).coffer = stateOf(other).coffer = 1000;
  putOre(p); putOre(other);
  BlastFurnace._test.checkPot({ player: p });
  prompts.at(-1).choices[3]();
  assert.equal(loadedOre(p, ItemIds.IRON_ORE), 5, "selecting Empty alone destroys nothing");
  prompts.at(-1).choices[1]();
  ticks(4);
  assert.deepEqual(stateOf(p).ores, {});
  assert.equal(stateOf(p).bars[ItemIds.IRON_BAR], undefined);
  assert.equal(stateOf(other).bars[ItemIds.GOLD_BAR], 2);
});

test("the dispenser holds at most 28 bars per metal", () => {
  const p = player({ items: { [ItemIds.IRON_ORE]: 28 } });
  stateOf(p).coffer = 1000;
  stateOf(p).bars[ItemIds.GOLD_BAR] = 27;
  putOre(p);
  ticks(4);
  assert.equal(stateOf(p).bars[ItemIds.IRON_BAR], 28);
  assert.equal(stateOf(p).ores[ItemIds.IRON_ORE], 0);
  p.inventory.set(ItemIds.IRON_ORE, 1);
  putOre(p);
  ticks(4);
  assert.equal(stateOf(p).bars[ItemIds.IRON_BAR], 28);
  assert.equal(p.inventory.get(ItemIds.IRON_ORE), 1, "ore stays carried when a metal's dispenser is full");
});

test("manual machine actions stop for movement, exhaustion and logout", () => {
  dwarfOperated = false;
  const p = player();
  Machinery._test.pedal(station(p));
  p.moving = true;
  manualTicks(1);
  assert.equal(Machinery._test.snapshot().operators.size, 0);
  p.moving = false;
  p.setRunEnergy(0);
  Machinery._test.pedal(station(p));
  manualTicks(1);
  assert.equal(Machinery._test.snapshot().operators.size, 0);
  Machinery._test.pump(station(p));
  BlastFurnace._test.logout({ player: p });
  assert.equal(Machinery._test.snapshot().operators.size, 0);
});

test("pedalling charges a whole energy point per two ticks, including across restarts", () => {
  dwarfOperated = false;
  const p = player();
  Machinery._test.pedal(station(p));
  manualTicks(1);
  assert.equal(p.getRunEnergy(), 100);
  Machinery.leave(p);
  Machinery._test.pedal(station(p));
  manualTicks(1);
  assert.equal(p.getRunEnergy(), 99);
  manualTicks(18);
  assert.equal(p.getRunEnergy(), 90);
  assert.equal(p.xp, 20);
});

test("Dumpy repeats the captured nine-tick coke and animation sequence", (t) => {
  const core = PluginManager.getCoreApi();
  const events = [];
  let cycle = 0;
  const stoker = {
    getId: () => core.NpcIdentifiers.DUMPY,
    getLocation: () => new Location(1955, 4967, 0),
    isRegistered: () => true,
    setNpcTransformationId: (id) => events.push([cycle, "form", id]),
    performAnimation: (animation) => events.push([cycle, "animation", animation.getId(), animation.getDelay()]),
  };
  t.mock.method(core.World, "getNpcs", () => [stoker]);
  Machinery._test.startup();
  for (cycle = 0; cycle < 18; cycle++) tick();
  const oneCycle = [
    [0, "form", core.NpcIdentifiers.DUMPY],
    [0, "animation", core.CacheDefinitions.getSeqId("human_shovel_coke_up"), 15],
    [1, "form", core.NpcIdentifiers.DUMPY_2],
    [2, "animation", core.CacheDefinitions.getSeqId("human_shovel_coke_down"), 15],
    [4, "form", core.NpcIdentifiers.DUMPY],
    [4, "animation", core.CacheDefinitions.getSeqId("human_shovel_coke_fin"), 0],
  ];
  assert.deepEqual(events, [...oneCycle, ...oneCycle.map(([at, ...rest]) => [at + 9, ...rest])]);
});

test("collecting old bars or reentering cannot smelt ore still on a stopped conveyor", (t) => {
  dwarfOperated = false;
  t.mock.method(Math, "random", () => 1);
  const p = player({ items: { [ItemIds.GOLD_ORE]: 3 } });
  const pumper = player({ items: { [ItemIds.SPADE]: 1 } });
  Machinery._test.collectCoke({ player: pumper });
  Machinery._test.refuel({ player: pumper });
  Machinery._test.pump(station(pumper));
  manualTicks(40);
  stateOf(p).bars[ItemIds.IRON_BAR] = 1;
  p.varbits.set(DISPENSER, 3);
  putOre(p);
  take(p, ItemIds.IRON_BAR, 1);
  assert.equal(stateOf(p).bars[ItemIds.GOLD_BAR], undefined);
  BlastFurnace._test.enterRoom({ player: p });
  assert.equal(stateOf(p).bars[ItemIds.GOLD_BAR], undefined);
  assert.equal(loadedOre(p, ItemIds.GOLD_ORE), 3);
  Machinery._test.pedal(station(p));
  manualTicks(4);
  assert.equal(stateOf(p).bars[ItemIds.GOLD_BAR], 3);
  BlastFurnace._test.leaveRoom({ player: p });
});

test("manual actions cannot be used outside the furnace", () => {
  dwarfOperated = false;
  const p = player({ items: { [ItemIds.SPADE]: 1 } });
  p.location = new Location(3222, 3218, 0);
  Machinery._test.collectCoke({ player: p });
  Machinery._test.pedal(station(p));
  assert.equal(p.inventory.get(ItemIds.SPADE), 1);
  assert.equal(Machinery._test.snapshot().operators.size, 0);
});

test("manual contribution is 1.5 XP per pour, has a ten-tick cooldown and expires", () => {
  dwarfOperated = false;
  const p = player();
  Machinery.contribute(p);
  Machinery.contribution();
  Machinery.contribution();
  assert.equal(p.xp, 1.5);
  manualTicks(10);
  Machinery.contribution();
  assert.equal(p.xp, 3);
  manualTicks(101);
  Machinery.contribution();
  assert.equal(p.xp, 3);
});

test("pouring bars and a stale hot-bar menu cannot bypass cooling", () => {
  const p = player();
  stateOf(p).bars[ItemIds.IRON_BAR] = 5;
  p.varbits.set(DISPENSER, 1);
  takeBars({ player: p });
  take(p, ItemIds.IRON_BAR, 5);
  assert.equal(p.menu, null);
  assert.equal(p.inventory.get(ItemIds.IRON_BAR), undefined);
  p.varbits.set(DISPENSER, 2);
  take(p, ItemIds.IRON_BAR, 5);
  assert.equal(stateOf(p).bars[ItemIds.IRON_BAR], 5);
});

// Captured (rsprox, recs 96, 1757, 3278): the belt and sink lines are spam; taking bars names the
// count in a message box (Wiki changelog: "A message displaying the numbers of bars withdrawn").
test("the belt, sink and dispenser give the recorded feedback", () => {
  const p = player({ items: { [ItemIds.MITHRIL_ORE]: 3, [ItemIds.BUCKET]: 1 } });
  stateOf(p).coffer = 1000;
  putOre(p);
  assert.equal(p.spam.at(-1), "All your ore goes onto the conveyor belt.");
  fillBucket({ player: p });
  assert.equal(p.spam.at(-1), "You fill the bucket from the sink.");
  assert.deepEqual(p.sounds, [2609]);
  assert.equal(p.inventory.get(ItemIds.BUCKET_OF_WATER), 1);
  stateOf(p).bars[ItemIds.MITHRIL_BAR] = 23;
  p.varbits.set(DISPENSER, 3);
  take(p, ItemIds.MITHRIL_BAR, 23);
  assert.equal(p.statement, "You take 23 mithril bars from the dispenser.");
  assert.equal(p.messages.length, 0);
});

test("water cools other hot bars within five tiles", () => {
  const p = player({ items: { [ItemIds.BUCKET_OF_WATER]: 1 } }), nearby = player(), distant = player();
  distant.location = new Location(1955, 4975, 0);
  for (const actor of [p, nearby, distant]) {
    stateOf(actor).bars[ItemIds.IRON_BAR] = 1;
    BlastFurnace._test.enterRoom({ player: actor });
    actor.varbits.set(DISPENSER, 2);
  }
  coolWithWater({ player: p, objectId: 9092, itemId: ItemIds.BUCKET_OF_WATER });
  assert.equal(nearby.varbits.get(DISPENSER), 3);
  assert.equal(distant.varbits.get(DISPENSER), 2);
  for (const actor of [p, nearby, distant]) BlastFurnace._test.leaveRoom({ player: actor });
});

test("helpers with no hot bars can cool another player's bars, using one bucket", () => {
  for (const helperState of [0, 3]) {
    const helper = player({ items: { [ItemIds.BUCKET_OF_WATER]: 1 } }), owner = player();
    BlastFurnace._test.enterRoom({ player: owner });
    stateOf(owner).bars[ItemIds.IRON_BAR] = 1;
    owner.varbits.set(DISPENSER, 2);
    helper.varbits.set(DISPENSER, helperState);
    coolWithWater({ player: helper, objectId: 9092, itemId: ItemIds.BUCKET_OF_WATER });
    assert.equal(owner.varbits.get(DISPENSER), 3);
    assert.equal(helper.inventory.get(ItemIds.BUCKET_OF_WATER), 0);
    assert.equal(helper.inventory.get(ItemIds.BUCKET), 1);
    BlastFurnace._test.leaveRoom({ player: owner });
  }
  const nobody = player({ items: { [ItemIds.BUCKET_OF_WATER]: 1 } });
  coolWithWater({ player: nobody, objectId: 9092, itemId: ItemIds.BUCKET_OF_WATER });
  assert.equal(nobody.inventory.get(ItemIds.BUCKET_OF_WATER), 1);
});

test("overheating breaks parts without damage; hammer repairs award XP only once", (t) => {
  dwarfOperated = false;
  t.mock.method(Math, "random", () => 1);
  Machinery._test.startup();
  const stoker = player({ items: { [ItemIds.SPADE]: 1, [ItemIds.HAMMER]: 1 } });
  for (let i = 0; i < 3; i++) {
    Machinery._test.collectCoke({ player: stoker });
    Machinery._test.refuel({ player: stoker });
  }
  Machinery._test.pump(station(stoker));
  manualTicks(100);
  const state = Machinery._test.snapshot();
  assert.equal(state.heat, 0);
  assert.equal(state.operators.size, 0);
  assert.equal(state.parts.length, 4);
  assert.ok(state.parts.every((part) => part.broken));
  const xp = stoker.xp;
  const event = { player: stoker, object: state.parts[0].object };
  Machinery._test.repair(event);
  Machinery._test.repair(event);
  assert.equal(stoker.xp, xp + 50);
  assert.equal(state.parts[0].broken, false);
});

test("ore needs coins in the coffer and, under 60 Smithing, the foreman's permit", () => {
  const p = player({ smithing: 50, items: { [ItemIds.IRON_ORE]: 5 } });
  putOre(p);
  assert.equal(p.inventory.get(ItemIds.IRON_ORE), 5, "empty coffer");
  stateOf(p).coffer = 1000;
  putOre(p);
  assert.equal(p.inventory.get(ItemIds.IRON_ORE), 5, "no permit");
  stateOf(p).permitUntil = Date.now() + 60_000;
  putOre(p);
  assert.equal(p.inventory.get(ItemIds.IRON_ORE), 0);
  assert.equal(loadedOre(p, ItemIds.IRON_ORE), 5);
});

test("iron with coal smelts into steel with half the coal; the rest is iron", () => {
  const p = player({ items: { [ItemIds.IRON_ORE]: 10, [ItemIds.COAL]: 6 } });
  stateOf(p).coffer = 1000;
  putOre(p);
  assert.equal(spawned.length, 2, "one ore npc per type");
  ticks(3);
  assert.equal(stateOf(p).bars[ItemIds.STEEL_BAR], undefined, "still on the belt");
  ticks(1);
  assert.deepEqual([stateOf(p).bars[ItemIds.STEEL_BAR], stateOf(p).bars[ItemIds.IRON_BAR]], [6, 4]);
  assert.equal(stateOf(p).ores[ItemIds.COAL], 0);
  assert.ok(Math.abs(p.xp - (6 * 17.5 + 4 * 12.5)) < 1e-9);
  assert.equal(p.varbits.get(943), 6, "steel bar varbit");
  assert.equal(p.varbits.get(DISPENSER), 1, "pouring");
});

test("mithril waits in the pot for its coal, and primary ore is capped at 28", () => {
  const p = player({ items: { [ItemIds.MITHRIL_ORE]: 30 } });
  stateOf(p).coffer = 1000;
  stateOf(p).ores[ItemIds.MITHRIL_ORE] = 10;
  putOre(p);
  assert.equal(loadedOre(p, ItemIds.MITHRIL_ORE), 28);
  assert.equal(p.inventory.get(ItemIds.MITHRIL_ORE), 12);
  ticks(4);
  assert.equal(stateOf(p).bars[ItemIds.MITHRIL_BAR], undefined);
  p.inventory.set(ItemIds.COAL, 20);
  putOre(p);
  ticks(4);
  assert.equal(stateOf(p).bars[ItemIds.MITHRIL_BAR], 10, "two coal a bar");
});

test("goldsmith gauntlets add 33.7 XP a gold bar", () => {
  const p = player({ hands: ItemIds.GOLDSMITH_GAUNTLETS, items: { [ItemIds.GOLD_ORE]: 2 } });
  stateOf(p).coffer = 1000;
  putOre(p);
  ticks(4);
  assert.ok(Math.abs(p.xp - 2 * 56.2) < 1e-9);
});

test("molten bars need ice gloves or water; cooled bars are taken into free slots", () => {
  const p = player({ items: { [ItemIds.IRON_ORE]: 3 } });
  stateOf(p).coffer = 1000;
  putOre(p);
  ticks(4 + 2);
  assert.equal(p.varbits.get(DISPENSER), 2, "hot");
  takeBars({ player: p });
  assert.equal(p.menu, null, "no gloves");
  const event = { player: p, objectId: 9092, itemId: ItemIds.BUCKET_OF_WATER, itemSlot: 0, handled: false };
  p.inventory.set(ItemIds.BUCKET_OF_WATER, 1);
  coolWithWater(event);
  assert.equal(event.handled, true);
  assert.equal(p.varbits.get(DISPENSER), 3, "cooled");
  assert.equal(p.inventory.get(ItemIds.BUCKET), 1);
  takeBars({ player: p });
  assert.deepEqual(p.menu.getItems(), [ItemIds.IRON_BAR]);
  take(p, ItemIds.IRON_BAR, 28);
  assert.equal(p.inventory.get(ItemIds.IRON_BAR), 3);
  assert.equal(p.varbits.get(DISPENSER), 0, "empty");
});

test("bars cool by themselves after 16 ticks", () => {
  const p = player({ items: { [ItemIds.SILVER_ORE]: 1 } });
  stateOf(p).coffer = 1000;
  putOre(p);
  ticks(4 + 17);
  assert.equal(p.varbits.get(DISPENSER), 2);
  ticks(1);
  assert.equal(p.varbits.get(DISPENSER), 3);
});

test("the foreman's conditions and fee", () => {
  const p = player({ smithing: 40, items: { [ItemIds.COINS]: 3000 } });
  const ask = (text, stepId) => foremanCondition({ player: p, npcId: NpcIds.BLAST_FURNACE_FOREMAN, text, stepId });
  assert.equal(ask("If the player has less than 60 Smithing:"), true);
  assert.equal(ask("If the player has 2,500 or more coins on them:"), true);
  assert.equal(ask("If the player is wearing the Ring of Charos(a):"), false);
  assert.equal(ask("If the player has discovered how to smith chromium ingots:"), false);
  assert.equal(ask("Something else:"), null);
  foremanPaid({ player: p, npcId: NpcIds.BLAST_FURNACE_FOREMAN, text: "Okay, you can use the furnace for ten minutes. Remember, you only need half as much coal as with a regular furnace." });
  assert.equal(p.inventory.get(ItemIds.COINS), 500);
  assert.ok(stateOf(p).permitUntil > Date.now());
});

test("the Furnace stairs gate entry but always allow the exit", () => {
  const locations = [];
  const messages = [];
  const p = { moveTo: (location) => locations.push([location.getX(), location.getY()]), sendMessage: (message) => messages.push(message) };
  giantDwarfStarted = false;
  stairs({ player: p, objectId: 9084 });
  assert.deepEqual(locations, [], "unstarted players cannot enter the Furnace");
  assert.match(messages[0], /start The Giant Dwarf/);

  stairs({ player: p, objectId: 9138 });
  assert.deepEqual(locations, [[2931, 10196]], "players can leave the Furnace without the quest");
  giantDwarfStarted = true;
  stairs({ player: p, objectId: 9084 });
  assert.deepEqual(locations.at(-1), [1939, 4958], "starting The Giant Dwarf permits entry");
  giantDwarfStarted = false;
});

// rsprox 1757: 28 runite bars, 16 runite ore and 20 coal; the next coal load is refused.
test("a full dispenser refuses all belt loading until bars are collected", () => {
  const p = player({ items: { [ItemIds.COAL]: 5, [ItemIds.RUNITE_ORE]: 5 } });
  stateOf(p).coffer = 1000;
  stateOf(p).bars[ItemIds.RUNITE_BAR] = 28;
  stateOf(p).ores[ItemIds.RUNITE_ORE] = 16;
  stateOf(p).ores[ItemIds.COAL] = 20;
  putOre(p);
  assert.equal(p.inventory.get(ItemIds.COAL), 5);
  assert.equal(p.inventory.get(ItemIds.RUNITE_ORE), 5);
  assert.equal(stateOf(p).ores[ItemIds.COAL], 20);
  assert.equal(spawned.length, 0);
  assert.equal(p.statement, "You should collect your bars before making any more.");
  p.varbits.set(DISPENSER, 3);
  take(p, ItemIds.RUNITE_BAR, 28);
  putOre(p);
  assert.equal(p.inventory.get(ItemIds.COAL), 0, "taking bars releases the belt");
});

test("coal-only conveyor loads are lost on logout, but coal already in the pot stays", () => {
  const p = player({ items: { [ItemIds.COAL]: 5 } });
  stateOf(p).coffer = 1000;
  stateOf(p).ores[ItemIds.COAL] = 20;
  putOre(p);
  BlastFurnace._test.logout({ player: p });
  BlastFurnace._test.enterRoom({ player: p });
  ticks(4);
  assert.equal(stateOf(p).ores[ItemIds.COAL], 20);
  BlastFurnace._test.leaveRoom({ player: p });
});

test("mixed conveyor loads survive logout without becoming pot contents on reentry", () => {
  dwarfOperated = false;
  const p = player({ items: { [ItemIds.COAL]: 5, [ItemIds.MITHRIL_ORE]: 2 } });
  putOre(p);
  BlastFurnace._test.logout({ player: p });
  BlastFurnace._test.enterRoom({ player: p });
  assert.equal(stateOf(p).ores[ItemIds.COAL] ?? 0, 0);
  assert.equal(stateOf(p).ores[ItemIds.MITHRIL_ORE] ?? 0, 0);
  assert.equal(stateOf(p).bars[ItemIds.MITHRIL_BAR], undefined);
  dwarfOperated = true;
  stateOf(p).coffer = 1000;
  ticks(4);
  assert.equal(stateOf(p).bars[ItemIds.MITHRIL_BAR], 2);
  assert.equal(stateOf(p).ores[ItemIds.COAL], 1);
  BlastFurnace._test.leaveRoom({ player: p });
});

test("an empty belt uses the recorded message box", () => {
  const p = player();
  stateOf(p).coffer = 1000;
  putOre(p);
  assert.equal(p.statement, "You don't have anything suitable for putting into the blast furnace.");
});

test("an empty dispenser uses the recorded message box", () => {
  const p = player();
  takeBars({ player: p });
  assert.equal(p.statement, "The dispenser doesn't contain any bars.");
});

test("the dispenser quantity menu uses the recorded take mode and available amount", () => {
  const p = player();
  stateOf(p).bars[ItemIds.RUNITE_BAR] = 5;
  p.varbits.set(DISPENSER, 3);
  takeBars({ player: p });
  assert.equal(p.menu.getTitle(), "How many would you like to take?");
  assert.equal(p.menu.getOptions().mode, 17);
  assert.equal(p.menu.getOptions().maxAmount, 5);
  stateOf(p).bars[ItemIds.IRON_BAR] = 20;
  takeBars({ player: p });
  assert.equal(p.menu.getOptions().maxAmount, 20, "a smaller stack cannot cap the other metal");
});

test("water cooling gives the recorded feedback once, only when bars are cooled", () => {
  const p = player({ items: { [ItemIds.BUCKET_OF_WATER]: 1 } });
  p.varbits.set(DISPENSER, 2);
  coolWithWater({ player: p, objectId: 9092, itemId: ItemIds.BUCKET_OF_WATER });
  assert.equal(p.spam.at(-1), "You throw the water over the bars.");
  assert.deepEqual(p.sounds, [1051]);
  coolWithWater({ player: p, objectId: 9092, itemId: ItemIds.BUCKET_OF_WATER });
  assert.deepEqual(p.sounds, [1051]);
});

test("conveyor capacity includes pending ore, while pot varbits wait for delivery", () => {
  const p = player({ items: { [ItemIds.MITHRIL_ORE]: 28 } });
  stateOf(p).coffer = 1000;
  putOre(p);
  assert.equal(p.varbits.get(952), 0);
  p.inventory.set(ItemIds.MITHRIL_ORE, 1);
  putOre(p);
  assert.equal(p.inventory.get(ItemIds.MITHRIL_ORE), 1);
  assert.equal(p.statement, "You should make sure all your ore smelts before adding any more.");
  ticks(4);
  assert.equal(p.varbits.get(952), 28);
});

test("saved mixed conveyor loads resume once, keeping their progress", () => {
  const p = player({ items: { [ItemIds.COAL]: 5, [ItemIds.MITHRIL_ORE]: 2 } });
  stateOf(p).coffer = 1000;
  putOre(p);
  ticks(2);
  BlastFurnace._test.logout({ player: p });
  const saved = JSON.parse(JSON.stringify(stateOf(p)));
  const restored = player();
  restored.setAttribute("blast-furnace", saved);
  BlastFurnace._test.enterRoom({ player: restored });
  BlastFurnace._test.enterRoom({ player: restored });
  ticks(1);
  assert.equal(stateOf(restored).bars[ItemIds.MITHRIL_BAR], undefined);
  ticks(1);
  assert.equal(stateOf(restored).bars[ItemIds.MITHRIL_BAR], 2);
  assert.equal(stateOf(restored).ores[ItemIds.COAL], 1);
  ticks(4);
  assert.equal(stateOf(restored).bars[ItemIds.MITHRIL_BAR], 2);
  BlastFurnace._test.leaveRoom({ player: restored });
});

test("noted ore used on the belt is refused without loading raw ore carried alongside it", () => {
  const p = player({ items: { [ItemIds.MITHRIL_ORE]: 2 } });
  const core = PluginManager.getCoreApi();
  const noted = core.ItemDefinition.forId(ItemIds.MITHRIL_ORE).getNoteId();
  assert.equal(core.ItemDefinition.forId(noted).isNoted(), true);
  stateOf(p).coffer = 1000;
  BlastFurnace._test.useOreOnBelt({ player: p, itemId: noted });
  assert.equal(p.statement, "There would be no point in smelting that.");
  assert.equal(p.inventory.get(ItemIds.MITHRIL_ORE), 2);
  assert.deepEqual(stateOf(p).conveyor, []);
});


test("logging out elsewhere does not create furnace state", () => {
  const p = player();
  BlastFurnace._test.logout({ player: p });
  assert.equal(p.getAttribute("blast-furnace"), undefined);
});

// Registered belt callback, real player/inventory, NPCs and furnace task; no decoded packet or walking is simulated.
test("native Blast Furnace catalyst applies to coal bars at production", async t => {
  const core = PluginManager.getCoreApi();
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
  const { World, TaskManager, ItemIdentifiers: I } = core;
  const originalSubmit = TaskManager.submit, ownedTasks = [], spawnedNpcs = [];
  let started = false, liveApi;
  nativeRun = true;
  t.after(() => {
    try {
      if (started) PluginManager.emitServerShutdown({});
      for (const task of ownedTasks) task.stop();
      TaskManager.process();
      for (const npc of spawnedNpcs) if (npc?.isRegistered()) liveApi.removeNpc(npc);
      World.refreshActiveRegions();
    } finally {
      TaskManager.submit = originalSubmit;
      init(mockApi);
      nativeRun = false;
    }
  });
  TaskManager.submit = function(task) { ownedTasks.push(task); return originalSubmit.call(this, task); };
  new NpcDefinitionLoader().load();
  core.ObjectDefinition.init();
  assert.equal(core.CacheDefinitions.getObjId("smithing_catalyst"), I.SMITHING_CATALYST);
  assert.equal(I.SMITHING_CATALYST, 27017);
  assert.equal(core.ItemDefinition.forId(I.SMITHING_CATALYST).isStackable(), false);
  assert.equal(core.WorldDefinition.hasGlobalWorldTag("blast-furnace"), true);
  const api = liveApi = PluginManager.createApi("native-blast-furnace-catalyst");
  const spawnNpc = api.spawnNpc;
  api.spawnNpc = options => { const npc = spawnNpc(options); spawnedNpcs.push(npc); return npc; };
  BlastFurnace.register(api);
  started = true;
  PluginManager.emitServerStartup({});
  assert.equal(ownedTasks.length, 1, "startup registers the furnace task");
  const belt = [...core.MapObjects.mapObjects.values()].flat().find(object =>
    object.getDefinition()?.getName() === "Conveyor belt" &&
    object.getDefinition().getInteractions()?.includes("Put-ore-on") &&
    object.getLocation().isWithinDistance(new core.Location(1942, 4966, 0), 20));
  assert.ok(belt, "loaded scene contains the cache-defined belt and action");
  const clickType = belt.getDefinition().getInteractions().indexOf("Put-ore-on") + 1;
  const rate = core.GameConstants.EXPERIENCE_MULTIPLIER;
  assert.equal(rate, 1, "normal-world XP multiplier");
  let serial = 0;
  function actor(test, contents) {
    const channel = { kind: "test", isOpen: () => true, send: () => true, close() {}, onData() {}, onClose() {}, onError() {} };
    const session = new PlayerSession(channel), p = new Player(session);
    session.setPlayer(p);
    p.setUsername(`native-bf-catalyst-${serial++}`);
    p.setLocation(new core.Location(1942, 4965, 0));
    test.mock.method(p, "onAdd", () => {});
    test.mock.method(p, "onRemove", () => {});
    test.after(() => {
      BlastFurnace._test.logout({ player: p });
      if (p.isRegistered()) World.getPlayers().remove(p);
      TaskManager.cancelTasks(p);
      TaskManager.cancelTasks(p.getIndex());
    });
    assert.equal(World.getPlayers().add(p), true);
    assert.equal(World.getPlayers().get(p.getIndex()), p);
    p.getSkillManager().setMaxLevels(core.Skill.SMITHING, 99, false).setCurrentLevel(core.Skill.SMITHING, 99, false)
      .setExperience(core.Skill.SMITHING, SkillManager.getExperienceForLevel(99));
    assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.SMITHING), 99);
    for (const [id, amount] of contents) p.getInventory().adds(id, amount);
    for (const [id, amount] of contents) assert.equal(p.getInventory().getAmount(id), amount);
    stateOf(p).coffer = 1000;
    return p;
  }
  const xp = p => p.getSkillManager().getSkills().getExperiences()[core.Skill.SMITHING.getIndex()];
  const gain = value => Math.floor(value * rate * 10 + 1e-6) / 10;
  const load = p => PluginManager.emitObjectInteraction({ player:p, object:belt, objectId:belt.getId(), clickType, location:belt.getLocation(), handled:false });
  const advance = n => { for (let i = 0; i < n; i++) TaskManager.process(); };
  function start(p) {
    const old = spawnedNpcs.length, inventory = p.getInventory();
    const iron = inventory.getAmount(I.IRON_ORE), mithril = inventory.getAmount(I.MITHRIL_ORE);
    const coal = inventory.getAmount(I.COAL), catalyst = inventory.getAmount(I.SMITHING_CATALYST);
    assert.equal(load(p), true, "registered belt action handled");
    assert.equal(inventory.getAmount(I.IRON_ORE), 0, "iron ore was loaded");
    assert.equal(inventory.getAmount(I.MITHRIL_ORE), 0, "mithril ore was loaded");
    assert.equal(inventory.getAmount(I.COAL), 0, "coal was loaded");
    assert.equal(inventory.getAmount(I.SMITHING_CATALYST), catalyst, "loading leaves catalyst carried");
    assert.equal(stateOf(p).conveyor.reduce((n, load) => n + load.count, 0), iron + mithril + coal);
    assert.ok(stateOf(p).conveyor.length > 0, "real ore loads enter the conveyor");
    assert.ok(spawnedNpcs.length > old, "real ore-load NPCs spawned");
    for (const npc of spawnedNpcs.slice(old)) assert.equal(World.getNpcs().get(npc.getIndex()), npc);
    return spawnedNpcs.slice(old);
  }
  function finish(npcs) {
    advance(4);
    for (const npc of npcs) assert.equal(npc.isRegistered(), false, "delivered ore NPC removed");
  }
  await t.test("normal steel without catalyst retains the existing ore, coal and XP rules", test => {
    const p = actor(test, [[I.IRON_ORE, 2], [I.COAL, 2]]), before = xp(p);
    const npcs = start(p); finish(npcs);
    assert.equal(stateOf(p).bars[I.STEEL_BAR], 2);
    assert.equal(stateOf(p).ores[I.IRON_ORE], 0);
    assert.equal(stateOf(p).ores[I.COAL], 0);
    assert.equal(xp(p) - before, gain(35));
  });
  await t.test("a catalyst does not apply to a non-coal iron bar", test => {
    const p = actor(test, [[I.IRON_ORE, 1], [I.SMITHING_CATALYST, 1]]), before = xp(p);
    const npcs = start(p); finish(npcs);
    assert.equal(stateOf(p).bars[I.IRON_BAR], 1);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 1);
    assert.equal(xp(p) - before, gain(12.5));
  });
  await t.test("one carried catalyst is consumed only when a steel bar is made", test => {
    const p = actor(test, [[I.IRON_ORE, 1], [I.COAL, 1], [I.SMITHING_CATALYST, 1]]), before = xp(p);
    const npcs = start(p);
    advance(3);
    assert.equal(stateOf(p).bars[I.STEEL_BAR] ?? 0, 0);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 1, "belt travel does not consume catalyst");
    advance(1);
    assert.equal(stateOf(p).bars[I.STEEL_BAR], 1);
    assert.equal(stateOf(p).ores[I.IRON_ORE], 0);
    assert.equal(stateOf(p).ores[I.COAL], 0, "the usual single coal is used");
    assert.equal(xp(p) - before, gain(35));
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 0);
    for (const npc of npcs) assert.equal(npc.isRegistered(), false);
  });
  // Direct inventory changes while the server task waits characterize this TSPS commit point,
  // not the precise retail reservation lifecycle or a decoded inventory interaction.
  await t.test("a catalyst added during belt travel is available when the bar is made", test => {
    const p = actor(test, [[I.IRON_ORE, 1], [I.COAL, 1]]), before = xp(p);
    const npcs = start(p);
    advance(3);
    assert.equal(stateOf(p).bars[I.STEEL_BAR] ?? 0, 0);
    p.getInventory().adds(I.SMITHING_CATALYST, 1);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 1);
    advance(1);
    assert.equal(stateOf(p).bars[I.STEEL_BAR], 1);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 0);
    assert.equal(xp(p) - before, gain(35));
    for (const npc of npcs) assert.equal(npc.isRegistered(), false);
  });
  await t.test("a catalyst removed during belt travel cannot boost the later bar", test => {
    const p = actor(test, [[I.IRON_ORE, 1], [I.COAL, 1], [I.SMITHING_CATALYST, 1]]), before = xp(p);
    const npcs = start(p);
    advance(3);
    assert.equal(stateOf(p).bars[I.STEEL_BAR] ?? 0, 0);
    p.getInventory().deleteNumber(I.SMITHING_CATALYST, 1);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 0);
    advance(1);
    assert.equal(stateOf(p).bars[I.STEEL_BAR], 1);
    assert.equal(xp(p) - before, gain(17.5));
    for (const npc of npcs) assert.equal(npc.isRegistered(), false);
  });
  await t.test("partial catalyst stock boosts only the produced bars it covers", test => {
    const p = actor(test, [[I.IRON_ORE, 3], [I.COAL, 3], [I.SMITHING_CATALYST, 2]]), before = xp(p);
    assert.equal(p.getInventory().getItems().filter(item => item?.getId() === I.SMITHING_CATALYST).length, 2);
    const npcs = start(p); finish(npcs);
    assert.equal(stateOf(p).bars[I.STEEL_BAR], 3);
    assert.equal(stateOf(p).ores[I.IRON_ORE], 0);
    assert.equal(stateOf(p).ores[I.COAL], 0);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 0);
    assert.equal(xp(p) - before, gain(17.5 * 5));
  });
  await t.test("dispenser room limits both smelting and catalyst use", test => {
    const p = actor(test, [[I.MITHRIL_ORE, 2], [I.COAL, 4], [I.SMITHING_CATALYST, 2]]), before = xp(p);
    stateOf(p).bars[I.MITHRIL_BAR] = 27;
    const npcs = start(p); finish(npcs);
    assert.equal(stateOf(p).bars[I.MITHRIL_BAR], 28);
    assert.equal(stateOf(p).ores[I.MITHRIL_ORE], 1);
    assert.equal(stateOf(p).ores[I.COAL], 2);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 1);
    assert.equal(xp(p) - before, gain(60));
  });
  await t.test("stored ore cannot consume catalyst without ingredients or dispenser room", test => {
    const p = actor(test, [[I.SMITHING_CATALYST, 2], [I.SPADE, 1]]), before = xp(p);
    const state = stateOf(p);
    state.ores[I.MITHRIL_ORE] = 1;
    state.ores[I.COAL] = 1;
    BlastFurnace._test.smelt(p);
    assert.equal(state.ores[I.MITHRIL_ORE], 1);
    assert.equal(state.ores[I.COAL], 1);
    assert.equal(state.bars[I.MITHRIL_BAR] ?? 0, 0);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 2);
    state.ores[I.COAL] = 2;
    state.bars[I.MITHRIL_BAR] = 28;
    BlastFurnace._test.smelt(p);
    assert.equal(state.ores[I.MITHRIL_ORE], 1);
    assert.equal(state.ores[I.COAL], 2);
    assert.equal(state.bars[I.MITHRIL_BAR], 28);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 2);
    assert.equal(p.getInventory().getAmount(I.SPADE), 1);
    assert.equal(xp(p), before);
  });
  await t.test("a full dispenser refuses loading and preserves ore and catalyst", test => {
    const p = actor(test, [[I.MITHRIL_ORE, 1], [I.COAL, 2], [I.SMITHING_CATALYST, 1]]), before = xp(p);
    stateOf(p).bars[I.MITHRIL_BAR] = 28;
    assert.equal(load(p), true);
    assert.equal(stateOf(p).conveyor.length, 0);
    assert.equal(p.getInventory().getAmount(I.MITHRIL_ORE), 1);
    assert.equal(p.getInventory().getAmount(I.COAL), 2);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 1);
    assert.equal(xp(p), before);
  });
  await t.test("paused belt retains catalyst until production resumes", test => {
    const p = actor(test, [[I.IRON_ORE, 1], [I.COAL, 1], [I.SMITHING_CATALYST, 1]]), before = xp(p);
    const npcs = start(p);
    stateOf(p).coffer = 0;
    advance(4);
    assert.equal(stateOf(p).bars[I.STEEL_BAR] ?? 0, 0);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 1);
    assert.equal(xp(p), before);
    stateOf(p).coffer = 1000;
    finish(npcs);
    assert.equal(stateOf(p).bars[I.STEEL_BAR], 1);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 0);
    assert.equal(xp(p) - before, gain(35));
  });
  await t.test("one catalyst in a mixed coal batch is used once", test => {
    const p = actor(test, [[I.IRON_ORE, 1], [I.MITHRIL_ORE, 1], [I.COAL, 3], [I.SMITHING_CATALYST, 1]]), before = xp(p);
    const npcs = start(p); finish(npcs);
    assert.equal(stateOf(p).bars[I.STEEL_BAR], 1);
    assert.equal(stateOf(p).bars[I.MITHRIL_BAR], 1);
    assert.equal(stateOf(p).ores[I.COAL], 0);
    assert.equal(p.getInventory().getAmount(I.SMITHING_CATALYST), 0);
    assert.ok([gain(65), gain(77.5)].includes(xp(p) - before), "one bonus for one eligible bar; allocation order is a TSPS choice");
  });
});
