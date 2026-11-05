// Run after `yarn build`: node --test tests/leaping-fish-cooking.test.cjs
// A knife on leaping trout, salmon and sturgeon: roe or caviar, offcuts and Cooking XP (Wiki, Mod Ash's rates).
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");

const core = PluginManager.getCoreApi();
const events = [];
const itemOnItem = [];
const api = new Proxy({
  core,
  persistAttribute() {},
  onItemOnItem: (handler, filter) => itemOnItem.push({ handler, filter }),
  emitCustomEvent: (name, payload) => { if (name === "skills:produced") events.push(payload); },
}, { get: (target, key) => target[key] ?? (() => {}) });

let LeapingFish;
before(async () => {
  await CachePipeline.initialize(process.cwd());
  require("../plugins/skills/Cooking.plugin").register(api);
  LeapingFish = require("../plugins/skills/cooking/LeapingFish.Cooking")._test;
});

function player(t, cooking, carried) {
  const p = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  t.mock.method(p, "getPacketSender", () => sender);
  t.mock.method(p, "sendMessage", () => {});
  t.mock.method(p, "isRegistered", () => true);
  t.mock.method(p.getSkillManager(), "getCurrentLevel", () => cooking);
  for (const [id, amount] of carried) for (let i = 0; i < amount; i++) p.getInventory().add(new Item(id, 1), false);
  return p;
}

function cookingXp(p) {
  return p.getSkillManager().getExperience(core.Skill.COOKING);
}

/** A random() that returns these values in order. */
function rolls(...values) {
  return () => values.shift();
}

function fish(id) {
  return LeapingFish.fishTable().get(id);
}

/** Uses the knife on the fish through the registered item-on-item handler, as the packet does. */
function useKnife(p, fishId, knife = I.KNIFE) {
  const event = { player: p, usedItemId: knife, usedWithItemId: fishId, handled: false };
  for (const { handler } of itemOnItem) if (!event.handled) handler(event);
  return event;
}

function withTasks(t) {
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => tasks.push(task));
  t.mock.method(core.TaskManager, "cancelTasks", () => { tasks.length = 0; });
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => true);
  return { tasks, tick: () => { for (const task of [...tasks]) task.execute(); } };
}

test("roe and caviar chances rise linearly with Cooking (Mod Ash)", () => {
  const trout = fish(I.LEAPING_TROUT);
  const salmon = fish(I.LEAPING_SALMON);
  const sturgeon = fish(I.LEAPING_STURGEON);
  assert.equal(LeapingFish.roeChance(trout, 1), 1 / 150);
  assert.equal(LeapingFish.roeChance(trout, 99), 99 / 150);
  assert.equal(LeapingFish.roeChance(salmon, 1), 1 / 80);
  assert.equal(LeapingFish.roeChance(salmon, 40), 0.5);
  assert.equal(LeapingFish.roeChance(salmon, 80), 1);
  assert.equal(LeapingFish.roeChance(sturgeon, 99), 1);
  assert.equal(trout.productId, I.ROE);
  assert.equal(salmon.productId, I.ROE);
  assert.equal(sturgeon.productId, I.CAVIAR);
});

test("a successful sturgeon cut gives caviar, offcuts and 15 XP, and reports the product", (t) => {
  const p = player(t, 80, [[I.KNIFE, 1], [I.LEAPING_STURGEON, 2]]);
  events.length = 0;
  assert.equal(LeapingFish.cutOne(p, fish(I.LEAPING_STURGEON), rolls(0.99, 0.8)), true);
  const inventory = p.getInventory();
  assert.equal(inventory.getAmount(I.LEAPING_STURGEON), 1);
  assert.equal(inventory.getAmount(I.CAVIAR), 1);
  assert.equal(inventory.getAmount(I.FISH_OFFCUTS), 1);
  assert.equal(cookingXp(p), 15);
  assert.deepEqual(events.map(({ itemId, amount, xp, kind }) => [itemId, amount, xp, kind]), [[I.CAVIAR, 1, 15, "leaping-fish"]]);
});

test("a success without offcuts still pays the static XP; offcuts stack", (t) => {
  const p = player(t, 99, [[I.KNIFE, 1], [I.LEAPING_TROUT, 3], [I.FISH_OFFCUTS, 1]]);
  const trout = fish(I.LEAPING_TROUT);
  LeapingFish.cutOne(p, trout, rolls(0.1, 0.5));
  assert.equal(p.getInventory().getAmount(I.ROE), 1);
  assert.equal(p.getInventory().getAmount(I.FISH_OFFCUTS), 1, "1/2 offcuts: a roll of 0.5 misses");
  assert.equal(cookingXp(p), 10);
  LeapingFish.cutOne(p, trout, rolls(0.1, 0.49));
  assert.equal(p.getInventory().getAmount(I.FISH_OFFCUTS), 2);
  assert.equal(p.getInventory().getSlotForItemId(I.FISH_OFFCUTS) >= 0, true);
  assert.equal(p.getInventory().getFreeSlots(), 28 - 5, "knife, fish, two roe and one offcuts stack");
});

test("a failed cut uses the fish and gives nothing", (t) => {
  const p = player(t, 1, [[I.KNIFE, 1], [I.LEAPING_SALMON, 1]]);
  events.length = 0;
  assert.equal(LeapingFish.cutOne(p, fish(I.LEAPING_SALMON), rolls(1 / 80)), true);
  assert.equal(p.getInventory().getAmount(I.LEAPING_SALMON), 0);
  assert.equal(p.getInventory().getAmount(I.ROE), 0);
  assert.equal(p.getInventory().getAmount(I.FISH_OFFCUTS), 0);
  assert.equal(cookingXp(p), 0);
  assert.equal(events.length, 0);
});

test("with a full inventory and no offcut stack, the offcuts fall to the floor", (t) => {
  const p = player(t, 99, [[I.KNIFE, 1], [I.LEAPING_STURGEON, 27]]);
  const dropped = [];
  t.mock.method(core.ItemOnGroundManager, "registers", (owner, item) => dropped.push([owner, item.getId(), item.getAmount()]));
  LeapingFish.cutOne(p, fish(I.LEAPING_STURGEON), rolls(0, 0));
  assert.equal(p.getInventory().getAmount(I.CAVIAR), 1, "the caviar takes the fish's slot");
  assert.deepEqual(dropped, [[p, I.FISH_OFFCUTS, 1]]);
});

test("a knife on a leaping fish cuts at once, then every 3 ticks until the fish run out", (t) => {
  const { tasks, tick } = withTasks(t);
  const p = player(t, 99, [[I.KNIFE, 1], [I.LEAPING_SALMON, 3], [I.LEAPING_TROUT, 1]]);
  t.mock.method(Math, "random", () => 0.99);
  const event = useKnife(p, I.LEAPING_SALMON);
  assert.equal(event.handled, true);
  assert.equal(p.getInventory().getAmount(I.LEAPING_SALMON), 2, "the first cut is on the knife use");
  assert.equal(tasks.length, 1);
  tick(); tick();
  assert.equal(p.getInventory().getAmount(I.LEAPING_SALMON), 2);
  tick();
  assert.equal(p.getInventory().getAmount(I.LEAPING_SALMON), 1, "the next cut is 3 ticks later");
  tick(); tick(); tick();
  assert.equal(p.getInventory().getAmount(I.LEAPING_SALMON), 0);
  assert.equal(p.getInventory().getAmount(I.LEAPING_TROUT), 1, "auto-cutting keeps to the fish used");
  assert.equal(p.getInventory().getAmount(I.ROE), 3);
  assert.equal(cookingXp(p), 30);
});

test("the fish on the knife works too; a second use in the same tick cuts nothing more", (t) => {
  withTasks(t);
  const p = player(t, 99, [[I.KNIFE, 1], [I.LEAPING_TROUT, 3]]);
  t.mock.method(core.World, "getProcessCycle", () => 500);
  const event = { player: p, usedItemId: I.LEAPING_TROUT, usedWithItemId: I.KNIFE, handled: false };
  for (const { handler } of itemOnItem) if (!event.handled) handler(event);
  assert.equal(event.handled, true);
  assert.equal(p.getInventory().getAmount(I.LEAPING_TROUT), 2);
  useKnife(p, I.LEAPING_TROUT);
  assert.equal(p.getInventory().getAmount(I.LEAPING_TROUT), 2, "one cut per tick, however often the knife is used");
  t.mock.method(core.World, "getProcessCycle", () => 501);
  useKnife(p, I.LEAPING_TROUT);
  assert.equal(p.getInventory().getAmount(I.LEAPING_TROUT), 1, "re-using the knife next tick cuts at once");
});

test("other knives and items are left to other handlers, and free-to-play worlds cut nothing", (t) => {
  const { tasks } = withTasks(t);
  const p = player(t, 99, [[I.KNIFE, 1], [I.LEAPING_TROUT, 1], [I.RAW_TROUT, 1]]);
  assert.equal(useKnife(p, I.RAW_TROUT).handled, false);
  assert.equal(useKnife(p, I.LEAPING_TROUT, I.FEATHER).handled, false);
  assert.equal(itemOnItem.find(({ handler }) => handler.name === "cut")?.filter?.noted, false, "noted fish are not cut");
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => false);
  assert.equal(useKnife(p, I.LEAPING_TROUT).handled, false);
  assert.equal(p.getInventory().getAmount(I.LEAPING_TROUT), 1);
  assert.equal(tasks.length, 0);
});

test("auto-cutting stops once the knife is gone", (t) => {
  const { tick } = withTasks(t);
  const p = player(t, 99, [[I.KNIFE, 1], [I.LEAPING_STURGEON, 3]]);
  t.mock.method(Math, "random", () => 0.99);
  useKnife(p, I.LEAPING_STURGEON);
  assert.equal(p.getInventory().getAmount(I.LEAPING_STURGEON), 2);
  p.getInventory().deleteNumber(I.KNIFE, 1);
  tick(); tick(); tick(); tick(); tick(); tick();
  assert.equal(p.getInventory().getAmount(I.LEAPING_STURGEON), 2, "no cut without a knife");
  assert.equal(p.getInventory().getAmount(I.CAVIAR), 1);
});
