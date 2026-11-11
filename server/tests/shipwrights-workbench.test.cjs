// Run after `yarn build`: node --test tests/shipwrights-workbench.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const Workbench = require("../plugins/skills/sailing/ShipwrightsWorkbench.Sailing");
const { start, DATA, makeable, hasRoom, openMenu, TASK_ATTRIBUTE } = Workbench._test;

const core = PluginManager.getCoreApi();
const events = [];
const tasks = [];
/** What the plank sack holds, by item id ("storage:amount" / "storage:take"). */
const sack = new Map();
/** What the Carpenter's outfit multiplies Construction experience by ("construction:outfit-multiplier"). */
let outfit = 1;
const api = {
  core,
  emitCustomEvent: (name, payload) => {
    events.push({ name, ...payload });
    if (name === "storage:amount") payload.amount += sack.get(payload.itemId) ?? 0;
    if (name === "construction:outfit-multiplier") payload.multiplier *= outfit;
    if (name === "storage:take") sack.set(payload.itemId, (sack.get(payload.itemId) ?? 0) - payload.amount);
  },
  getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
};
const id = (name) => CacheDefinitions.getObjId(name);
const ANCHOR = { getDistance: () => 1 };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  start(api);
});

beforeEach(() => {
  events.length = 0;
  tasks.length = 0;
  sack.clear();
  outfit = 1;
});

/** 28 slots; nails and swamp paste stack, everything else takes a slot each. */
function createPlayer(slots, { construction = 99 } = {}) {
  const inventory = Array.from({ length: 28 }, (_, slot) => slots[slot] ?? null);
  const stacks = (itemId) => core.ItemDefinition.forId(itemId).isStackable();
  const said = [];
  const spam = [];
  const animations = [];
  const xp = [];
  let menu = null;
  const attributes = new Map();
  const container = {
    contains: (itemId) => inventory.some((item) => item?.id === itemId),
    getAmount: (itemId) => inventory.filter((item) => item?.id === itemId).reduce((sum, item) => sum + item.amount, 0),
    getFreeSlots: () => inventory.filter((item) => !item).length,
    canTake: (item) => inventory.includes(null) || (stacks(item.getId()) && container.contains(item.getId())),
    add: (item) => {
      const stack = stacks(item.getId()) && inventory.find((entry) => entry?.id === item.getId());
      if (stack) stack.amount += item.getAmount();
      else inventory[inventory.indexOf(null)] = { id: item.getId(), amount: item.getAmount() };
    },
    delete: (itemId, amount) => {
      let left = amount;
      for (let slot = 0; slot < 28 && left > 0; slot++) {
        const item = inventory[slot];
        if (item?.id !== itemId) continue;
        const take = Math.min(left, item.amount);
        item.amount -= take;
        left -= take;
        if (item.amount === 0) inventory[slot] = null;
      }
    },
  };
  return {
    said, spam, animations, xp, inventory, attributes,
    menu: () => menu,
    getIndex: () => 7,
    isRegistered: () => true,
    getHitpoints: () => 10,
    getInterfaceId: () => -1,
    getMovementQueue: () => ({ size: () => 0 }),
    getLocation: () => ANCHOR,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getEquipment: () => ({ get: () => null }),
    getInventory: () => container,
    performAnimation: (animation) => animations.push(animation.getId?.() ?? animation.id),
    sendMessage: (text) => said.push(text),
    getSkillManager: () => ({
      getCurrentLevel: () => construction,
      addExperiences: (skill, amount) => xp.push(amount),
    }),
    getPacketSender: () => ({
      sendCreationMenu: (value) => { menu = value; },
      sendSound: () => {},
      sendTypedMessage: (type, text) => spam.push(text),
    }),
    getDialogueManager: () => ({
      startDialogues: (builder) => said.push([...builder.getDialogues().values()][0].text ?? [...builder.getDialogues().values()][0].getText?.()),
    }),
  };
}

const tools = () => ({ 0: { id: core.ItemIds.HAMMER, amount: 1 }, 1: { id: core.ItemIds.SAW, amount: 1 } });
const planks = (name, count, from = 2) => Object.fromEntries(Array.from({ length: count }, (_, i) => [from + i, { id: id(name), amount: 1 }]));
const find = (category, name) => {
  const index = DATA.recipes[category].findIndex((entry) => entry.item === name);
  return { index, entry: DATA.recipes[category][index] };
};

/** Runs the submitted task `ticks` times. */
function run(ticks) {
  for (let i = 0; i < ticks; i++) tasks.forEach((task) => task.execute());
}

test("the data: every item, tool and the animation is in the cache; the menus fit skillmulti", () => {
  for (const category of ["hull", "kits"]) {
    assert.ok(DATA.recipes[category].length <= 18);
    for (const entry of DATA.recipes[category]) {
      assert.ok(id(entry.item) != null, entry.item);
      for (const [name] of entry.materials) assert.ok(id(name) != null, name);
    }
  }
  assert.equal(CacheDefinitions.getLocId(DATA.loc), 59723);
  assert.equal(CacheDefinitions.getObject(59723).name, "Shipwrights' Workbench");
});

test("the captured refusals: no tools, then the recipe's materials", () => {
  const camphor = find("kits", "boat_repair_kit_camphor");
  const noTools = createPlayer({});
  openMenu(noTools, "kits", ANCHOR);
  noTools.menu().execute(id("boat_repair_kit_camphor"), 1);
  assert.deepEqual(noTools.said, ["You need a hammer and a saw to use this workbench."]);

  const player = createPlayer(tools());
  openMenu(player, "kits", ANCHOR);
  player.menu().execute(id("boat_repair_kit_camphor"), 1);
  assert.deepEqual(player.said, ["You need two camphor planks, ten adamantite nails and five swamp paste to craft a set of two camphor repair kits."]);
  assert.equal(camphor.entry.amount, 2);
});

test("the Construction level", () => {
  const player = createPlayer({ ...tools(), ...planks("plank_oak", 5) }, { construction: 7 });
  openMenu(player, "hull", ANCHOR);
  player.menu().execute(id("sailing_boat_hull_part_oak"), 1);
  assert.deepEqual(player.said, ["You need a Construction level of 8 to craft some oak hull parts."]);
});

test("oak hull parts: swing on the pick, product 3 ticks later, every 4 ticks, until the planks run out", () => {
  const player = createPlayer({ ...tools(), ...planks("plank_oak", 11) });
  openMenu(player, "hull", ANCHOR);
  assert.equal(player.menu().getOptions().maxAmount, 2);
  assert.equal(player.menu().getOptions().mode, 36);
  player.menu().execute(id("sailing_boat_hull_part_oak"), 10);
  assert.deepEqual(player.animations, [CacheDefinitions.getSeqId("human_poh_build")]);
  run(2);
  assert.equal(player.spam.length, 0);
  run(1);
  assert.deepEqual(player.spam, ["You craft some oak hull parts."]);
  assert.deepEqual(player.xp, [150]);
  run(1);
  assert.equal(player.animations.length, 2);
  run(3);
  assert.equal(player.spam.length, 2);
  run(8);
  assert.equal(player.spam.length, 2, "one plank left: stops");
  assert.equal(player.getInventory().getAmount(id("sailing_boat_hull_part_oak")), 2);
  assert.equal(player.getInventory().getAmount(id("plank_oak")), 1);
  assert.equal(player.getAttribute(TASK_ATTRIBUTE), null);
});

test("the Carpenter's outfit's bonus applies to the experience (Wiki: since 26 November 2025)", () => {
  outfit = 1.025;
  const player = createPlayer({ ...tools(), ...planks("plank_oak", 5) });
  openMenu(player, "hull", ANCHOR);
  player.menu().execute(id("sailing_boat_hull_part_oak"), 1);
  run(3);
  assert.deepEqual(player.xp, [150 * 1.025]);
});

test("repair kits: the plank sack's planks after the inventory's; a set of two kits", () => {
  const player = createPlayer({ ...tools(), 2: { id: id("plank_camphor"), amount: 1 }, 3: { id: id("nails_adamant"), amount: 100 }, 4: { id: id("swamppaste"), amount: 50 } });
  sack.set(id("plank_camphor"), 3);
  assert.equal(makeable(player, { materials: DATA.recipes.kits[4].materials.map(([name, n]) => [id(name), n]) }), 2);
  openMenu(player, "kits", ANCHOR);
  assert.equal(player.menu().getOptions().mode, 2);
  player.menu().execute(id("boat_repair_kit_camphor"), 1);
  run(3);
  assert.deepEqual(player.spam, ["You craft a set of two camphor repair kits."]);
  assert.equal(player.getInventory().getAmount(id("boat_repair_kit_camphor")), 2);
  assert.equal(player.getInventory().getAmount(id("plank_camphor")), 0);
  assert.equal(sack.get(id("plank_camphor")), 2);
  assert.equal(player.getInventory().getAmount(id("nails_adamant")), 90);
  assert.equal(player.getInventory().getAmount(id("swamppaste")), 45);
  assert.deepEqual(player.xp, [255]);
});

test("ironwood kits need room for three from inventory planks", () => {
  const slots = { ...tools(), 2: { id: id("plank_ironwood"), amount: 1 }, 3: { id: id("nails_rune"), amount: 100 }, 4: { id: id("swamppaste"), amount: 50 } };
  for (let slot = 5; slot < 28; slot++) slots[slot] = { id: id("woodplank"), amount: 1 };
  const player = createPlayer(slots);
  const ironwood = { amount: 3, materials: [[id("plank_ironwood"), 1], [id("nails_rune"), 10], [id("swamppaste"), 5]] };
  assert.equal(hasRoom(player, ironwood), false);
  openMenu(player, "kits", ANCHOR);
  player.menu().execute(id("boat_repair_kit_ironwood"), 1);
  assert.deepEqual(player.said, ["You don't have enough inventory space."]);
  assert.equal(tasks.length, 0);
});

test("walking cancels it: the task is keyed by the player's index, as walkToReset cancels", () => {
  const player = createPlayer({ ...tools(), ...planks("plank_oak", 5) });
  openMenu(player, "hull", ANCHOR);
  player.menu().execute(id("sailing_boat_hull_part_oak"), 1);
  const [task] = tasks;
  TaskManager.submit(task);
  TaskManager.cancelTasks(player.getIndex());
  assert.equal(task.isRunning(), false);
  assert.equal(player.getAttribute(TASK_ATTRIBUTE), null);
  tasks.length = 0;
  assert.equal(player.getInventory().getAmount(id("plank_oak")), 5);
  assert.equal(player.getInventory().getAmount(id("sailing_boat_hull_part_oak")), 0);
});
