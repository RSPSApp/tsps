// Run after `yarn build`: node --test tests/blast-furnace.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds, NpcIds } = require("../dist/util/IdEnums");

const spawned = [];
const BlastFurnace = require("../plugins/minigames/BlastFurnace.plugin");
let giantDwarfStarted = false;
const { init, tick, stateOf, putOre, takeBars, take, foremanCondition, foremanPaid, coolWithWater, stairs } = BlastFurnace._test;
init({
  core: PluginManager.getCoreApi(),
  spawnNpc: ({ id }) => {
    const npc = { id, removed: false, moveTo() {}, performAnimation() {}, setScriptedMovement() {} };
    spawned.push(npc);
    return npc;
  },
  removeNpc: (npc) => { npc.removed = true; },
  emitCustomEvent(name, request) { if (name === "quest:is-started") request.started = giantDwarfStarted; },
});

const DISPENSER = 936;

function player({ smithing = 99, items = {}, hands = -1 } = {}) {
  const attributes = new Map();
  const inventory = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  const equipment = new Array(14).fill(null);
  if (hands !== -1) equipment[Equipment.HANDS_SLOT] = { getId: () => hands };
  const p = {
    messages: [], xp: 0, varbits: new Map(), dialogues: 0, menu: null, inventory,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      contains: (id) => (inventory.get(id) ?? 0) > 0,
      getFreeSlots: () => 28 - [...inventory.values()].reduce((sum, n) => sum + n, 0),
      deleteNumber: (id, n) => inventory.set(id, inventory.get(id) - n),
      addItem: (item) => inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()),
    }),
    getEquipment: () => ({ getItems: () => equipment }),
    getSkillManager: () => ({ getCurrentLevel: () => smithing, addExperiences: (_, xp) => { p.xp += xp; } }),
    getPacketSender() {
      const sender = new Proxy({}, { get: (_, name) => {
        if (name === "getVarbit") return (id) => p.varbits.get(id) ?? 0;
        return (...args) => {
          if (name === "sendVarbit") p.varbits.set(args[0], args[1]);
          if (name === "sendCreationMenu") p.menu = args[0];
          return sender;
        };
      } });
      return sender;
    },
    getDialogueManager: () => ({ startDialogues: () => { p.dialogues++; } }),
    sendMessage: (message) => p.messages.push(message),
    performAnimation() {},
  };
  return p;
}

function ticks(count) {
  for (let i = 0; i < count; i++) tick();
}

beforeEach(() => {
  ticks(10); // let anything a previous test left on the belt or pouring finish
  spawned.length = 0;
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
  assert.equal(stateOf(p).ores[ItemIds.IRON_ORE], 5);
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
  assert.equal(stateOf(p).ores[ItemIds.MITHRIL_ORE], 28);
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
