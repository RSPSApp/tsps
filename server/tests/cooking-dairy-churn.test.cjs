// Run after `yarn build`: node --test tests/cooking-dairy-churn.test.cjs
// Dairy churns against rsprox captures 90 and 1105 (menu, animation, butter line, slots, timing)
// and the Wiki's levels, XP and cycle lengths.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const Cooking = require("../plugins/skills/Cooking.plugin");

before(() => CachePipeline.initialize());

const noop = () => {};
const hooks = { object: {}, itemOnObject: [] };
const produced = [];
Cooking.register(new Proxy({
  core,
  getTaskManager: () => ({ submit: noop }),
  emitCustomEvent: (name, request) => { if (name === "skills:produced") produced.push(request); },
  onObjectInteraction: (name, actions) => { hooks.object[name] = { ...hooks.object[name], ...actions }; },
  onItemOnObject: (handler, filter) => hooks.itemOnObject.push({ handler, filter }),
}, { get: (target, key) => target[key] ?? noop }));

const obj = (name) => core.CacheDefinitions.getObjId(name);
const seq = (name) => core.CacheDefinitions.getSeqId(name);
const ticks = (count) => { for (let i = 0; i < count; i++) core.TaskManager.process(); };

/** A player with a 28-slot inventory that really changes; `carried` is [name, count] in slot order. */
function churner(cooking, carried, filler = 0) {
  const slots = new Array(28).fill(null);
  let next = 0;
  for (const [name, count] of carried) for (let i = 0; i < count; i++) slots[next++] = obj(name);
  for (let i = 0; i < filler; i++) slots[next++] = obj("logs");
  const sent = { spam: [], messages: [], menu: null, statements: [] };
  const packet = new Proxy({
    sendCreationMenu: (menu) => { sent.menu = menu; return packet; },
    sendTypedMessage: (_type, text) => { sent.spam.push(text); return packet; },
  }, { get: (target, key) => target[key] ?? (() => packet) });
  const inventory = {
    slots,
    getAmount: (id) => slots.filter((slot) => slot === id).length,
    getFreeSlots: () => slots.filter((slot) => slot === null).length,
    getSlotForItemId: (id) => slots.indexOf(id),
    setItem: (slot, item) => { slots[slot] = item.getId(); return inventory; },
    addItem: (item) => { slots[slots.indexOf(null)] = item.getId(); return inventory; },
    refreshItems: noop,
  };
  const xp = [];
  const seqs = [];
  return {
    sent, xp, seqs, inventory,
    getIndex: () => 7,
    isRegistered: () => true,
    getHitpoints: () => 10,
    getInventory: () => inventory,
    getPacketSender: () => packet,
    sendMessage: (text) => sent.messages.push(text),
    getSkillManager: () => ({ getCurrentLevel: () => cooking, addExperiences: (_skill, gained) => xp.push(gained) }),
    getDialogueManager: () => ({ startDialogues: (chain) => sent.statements.push(chain) }),
    performAnimation: (animation) => seqs.push(animation.getId()),
  };
}

function churn(p) {
  hooks.object["Dairy churn"].Churn({ player: p, object: churnLoc() });
}

function churnLoc() {
  return { getDefinition: () => ({ getName: () => "Dairy churn", getInteractions: () => ["Churn"] }) };
}

function useOnChurn(p, name) {
  const event = { player: p, object: churnLoc(), itemId: obj(name), handled: false };
  for (const { handler, filter } of hooks.itemOnObject) if (!event.handled && !filter?.fallback) handler(event);
  return event;
}

test("Churn with milk opens the captured Cream/Butter/Cheese menu on the most it can make", () => {
  const p = churner(99, [["bucket_milk", 2]]);
  churn(p);
  assert.equal(p.sent.menu.getTitle(), "What would you like to make?");
  assert.deepEqual(p.sent.menu.getItems(), ["pot_of_cream", "pot_of_butter", "cheese"].map(obj));
  assert.deepEqual(p.sent.menu.getOptions(), { mode: 0, labels: ["Cream", "Butter", "Cheese"], maxAmount: 2, lastAmount: 2 });
});

test("milk to butter: animation on the choice, butter 18 ticks later in the milk's slot, the next 19 after", () => {
  produced.length = 0;
  const p = churner(99, [["bucket_milk", 2]]);
  churn(p);
  p.sent.menu.execute(obj("pot_of_butter"), 2);
  const medium = seq("player_churns_milk_medium");
  assert.deepEqual(p.seqs, [medium]);
  const butter = () => p.inventory.getAmount(obj("pot_of_butter"));
  ticks(17); assert.equal(butter(), 0);
  ticks(1); assert.equal(butter(), 1);
  assert.equal(p.inventory.slots[0], obj("pot_of_butter"), "the product takes the milk's slot");
  assert.equal(p.inventory.slots[2], obj("bucket_empty"), "the bucket goes to a free slot");
  assert.deepEqual(p.seqs, [medium, medium], "again for the second bucket");
  ticks(18); assert.equal(butter(), 1);
  ticks(1); assert.equal(butter(), 2);
  assert.deepEqual(p.seqs, [medium, medium], "not after the last");
  assert.deepEqual(p.sent.spam, ["You churn your milk to make butter.", "You churn your milk to make butter."]);
  assert.deepEqual(p.xp, [40.5, 40.5]);
  assert.equal(p.inventory.getAmount(obj("bucket_milk")), 0);
  assert.equal(p.inventory.getAmount(obj("bucket_empty")), 2);
  assert.deepEqual(produced.map(({ itemId, kind }) => [itemId, kind]), [[obj("pot_of_butter"), "churn"], [obj("pot_of_butter"), "churn"]]);
});

test("Wiki cycle lengths, levels and XP for every input and product", () => {
  const cases = [
    ["bucket_milk", "pot_of_cream", 10, "player_churns_milk_short", 18, "You churn your milk to make cream."],
    ["bucket_milk", "cheese", 26, "player_churns_milk_long", 64, "You churn your milk to make cheese."],
    ["pot_of_cream", "pot_of_butter", 10, "player_churns_milk_short", 22.5, "You churn your cream to make butter."],
    ["pot_of_cream", "cheese", 19, "player_churns_milk_medium", 46, "You churn your cream to make cheese."],
    ["pot_of_butter", "cheese", 10, "player_churns_milk_short", 23.5, "You churn your butter to make cheese."],
  ];
  for (const [input, product, cycle, anim, xp, line] of cases) {
    const p = churner(99, [[input, 1]]);
    churn(p);
    p.sent.menu.execute(obj(product), 1);
    assert.deepEqual(p.seqs, [seq(anim)], `${input} -> ${product}`);
    ticks(cycle - 2); assert.equal(p.inventory.getAmount(obj(product)), 0, `${input} -> ${product} not yet`);
    ticks(1); assert.equal(p.inventory.getAmount(obj(product)), 1, `${input} -> ${product} at ${cycle - 1}`);
    assert.deepEqual(p.xp, [xp]);
    assert.deepEqual(p.sent.spam, [line]);
    assert.equal(p.inventory.getAmount(obj("bucket_empty")), input === "bucket_milk" ? 1 : 0);
  }
});

test("cream or butter only offers what it can still become; each product uses the most processed input carried, then the next", () => {
  const p = churner(99, [["pot_of_cream", 1]]);
  churn(p);
  assert.deepEqual(p.sent.menu.getItems(), ["pot_of_butter", "cheese"].map(obj));
  assert.deepEqual(p.sent.menu.getOptions().labels, ["Butter", "Cheese"]);
  const mixed = churner(99, [["bucket_milk", 3], ["pot_of_butter", 1]]);
  churn(mixed);
  assert.equal(mixed.sent.menu.getOptions().maxAmount, 4, "butter and milk both make cheese");
  mixed.sent.menu.execute(obj("cheese"), 2);
  assert.deepEqual(mixed.seqs, [seq("player_churns_milk_short")]);
  ticks(9);
  assert.equal(mixed.inventory.getAmount(obj("cheese")), 1);
  assert.equal(mixed.inventory.getAmount(obj("pot_of_butter")), 0, "butter churned first");
  assert.equal(mixed.inventory.getAmount(obj("bucket_milk")), 3);
  assert.deepEqual(mixed.seqs, [seq("player_churns_milk_short"), seq("player_churns_milk_long")], "then milk's cycle");
  ticks(25);
  assert.equal(mixed.inventory.getAmount(obj("cheese")), 1);
  ticks(1);
  assert.equal(mixed.inventory.getAmount(obj("cheese")), 2);
  assert.equal(mixed.inventory.getAmount(obj("bucket_milk")), 2);
  assert.deepEqual(mixed.xp, [23.5, 64]);
  ticks(40);
  assert.equal(mixed.inventory.getAmount(obj("cheese")), 2, "stops at the amount chosen");
});

test("milk used on the churn offers milk's products only; other items are left to other handlers", () => {
  const p = churner(99, [["bucket_milk", 1], ["pot_of_cream", 1]]);
  assert.equal(useOnChurn(p, "bucket_milk").handled, true);
  assert.deepEqual(p.sent.menu.getItems(), ["pot_of_cream", "pot_of_butter", "cheese"].map(obj));
  p.sent.menu.execute(obj("pot_of_butter"), 1);
  ticks(18);
  assert.equal(p.inventory.getAmount(obj("pot_of_cream")), 1, "the cream is untouched");
  assert.equal(p.inventory.getAmount(obj("bucket_milk")), 0);
  assert.equal(useOnChurn(churner(99, [["logs", 1]]), "logs").handled, false);
});

test("too low a level is refused on the choice; nothing to churn says so", () => {
  const p = churner(30, [["bucket_milk", 1]]);
  churn(p);
  p.sent.menu.execute(obj("pot_of_butter"), 1);
  assert.equal(p.sent.statements.length, 1);
  assert.deepEqual(p.seqs, []);
  ticks(20);
  assert.equal(p.inventory.getAmount(obj("bucket_milk")), 1);
  const none = churner(99, []);
  churn(none);
  assert.equal(none.sent.menu, null);
  assert.deepEqual(none.sent.messages, ["You have nothing to churn."]);
});

test("a full inventory keeps the bucket in the milk's slot and drops the product (Wiki)", (t) => {
  const dropped = [];
  t.mock.method(core.ItemOnGroundManager, "registers", (_player, item) => { dropped.push(item.getId()); return null; });
  const p = churner(99, [["bucket_milk", 1]], 27);
  churn(p);
  p.sent.menu.execute(obj("pot_of_cream"), 1);
  ticks(9);
  assert.equal(p.inventory.slots[0], obj("bucket_empty"));
  assert.deepEqual(dropped, [obj("pot_of_cream")]);
  assert.deepEqual(p.xp, [18]);
});

test("every churn row names cache items and sequences", () => {
  const { products, inputs } = Cooking._test.churn.churnData();
  assert.equal(inputs.length, 4);
  assert.equal(products.length, 7);
  for (const row of products) {
    assert.ok(Number.isInteger(row.productId) && row.productId > 0);
    assert.ok(Number.isInteger(row.seqId) && row.seqId > 0);
    assert.ok(row.input);
  }
});

test("free worlds: Churn refuses with the members' line, and milk on a churn is left to the fallback", (t) => {
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => false);
  const p = churner(99, [["bucket_milk", 1]]);
  churn(p);
  assert.equal(p.sent.menu, null);
  assert.deepEqual(p.sent.messages, ["To use this item please login to a members' world."]);
  assert.equal(useOnChurn(p, "bucket_milk").handled, false);
  assert.equal(p.sent.menu, null);
  ticks(30);
  assert.equal(p.inventory.getAmount(obj("bucket_milk")), 1);
});
