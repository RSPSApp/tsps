// Run after `yarn build`: node --test tests/cooking.test.cjs
// Cooking against rsprox captures: the cook menu, its lines, the burnt items and the animations.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const { ItemIds } = require("../dist/util/IdEnums");

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const Cooking = require("../plugins/skills/Cooking.plugin");

before(() => CachePipeline.initialize());

const noop = () => {};
const submittedCookingTasks = [];
const hooks = { object: {}, itemOnObject: [], itemOnItem: [], custom: {} };
Cooking.register(new Proxy({
  core,
  getTaskManager: () => ({ submit: task => submittedCookingTasks.push(task) }),
  emitCustomEvent: (name, request) => { if (name === "quest:is-complete") request.complete = true; },
  onObjectInteraction: (name, actions) => { hooks.object[name] = actions; },
  onItemOnObject: (handler, filter) => hooks.itemOnObject.push({ handler, filter }),
  onItemOnItem: (handler) => hooks.itemOnItem.push(handler),
  onCustomEvent: (name, handler) => { hooks.custom[name] = handler; },
}, { get: (target, key) => target[key] ?? noop }));

function player(cooking, carried) {
  const slots = [];
  for (const [id, amount] of carried) for (let i = 0; i < amount; i++) slots.push({ getId: () => id });
  const sent = { spam: [], varbits: new Map(), menu: null, statements: [] };
  const attributes = new Map();
  const packet = new Proxy({
    sendCreationMenu: (menu) => { sent.menu = menu; return packet; },
    sendTypedMessage: (type, text) => { sent.spam.push([type, text]); return packet; },
    sendVarbit: (id, value) => { sent.varbits.set(id, value); return packet; },
  }, { get: (target, key) => target[key] ?? (() => packet) });
  const inventory = {
    getItems: () => slots,
    getAmount: (id) => slots.filter((item) => item.getId() === id).length,
    contains: (id) => slots.some((item) => item.getId() === id),
  };
  return {
    sent,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => packet,
    getEquipment: () => ({ getItems: () => [] }),
    getSkillManager: () => ({ getCurrentLevel: () => cooking }),
    getDialogueManager: () => ({ startDialogues: (chain) => sent.statements.push(chain) }),
    performAnimation: noop,
  };
}

function cooker(name) {
  return {
    getId: () => 1,
    getDefinition: () => ({ getName: () => name, getInteractions: () => name === "Fire" ? [] : ["Cook"] }),
    getLocation: () => new core.Location(3222, 3218, 0),
    getPrivateArea: () => null,
  };
}

function statementText(chain) {
  return JSON.stringify(chain, (key, value) => value instanceof Map ? [...value.values()] : value).match(/You [^"]+/)?.[0];
}

test("the captured success and burn lines", () => {
  const line = (raw) => Cooking._test.successMessage(Cooking.COOKABLE_BY_RAW.get(raw));
  assert.equal(line(ItemIds.RAW_SHARK), "You successfully cook a shark.");
  assert.equal(line(ItemIds.RAW_ANGLERFISH), "You successfully cook an anglerfish.");
  assert.equal(line(ItemIds.RAW_SHRIMPS), "You successfully cook some shrimps.");
  assert.equal(line(ItemIds.RAW_BASS), "You cook a bass.");
  assert.equal(line(ItemIds.RAW_TUNA), "You manage to cook a tuna.");
  assert.equal(line(ItemIds.RAW_RABBIT), "You cook the rabbit.");
  assert.equal(line(ItemIds.BREAD_DOUGH), "You successfully bake some bread.");
  assert.equal(Cooking._test.burnMessage(Cooking.COOKABLE_BY_RAW.get(ItemIds.RAW_HERRING)), "You accidentally burn the herring.");
  assert.equal(Cooking._test.burnMessage(Cooking.COOKABLE_BY_RAW.get(ItemIds.RAW_KARAMBWAN)), "You accidentally burn the karambwan.");
});

test("burnt items are the captured and Wiki ones", () => {
  const burnt = (raw) => Cooking.COOKABLE_BY_RAW.get(raw).burnt;
  const id = (name) => core.CacheDefinitions.getObjId(name);
  assert.equal(burnt(ItemIds.RAW_HERRING), id("burntfish3"));
  assert.equal(burnt(ItemIds.RAW_MACKEREL), id("burntfish3"));
  assert.equal(burnt(ItemIds.RAW_BASS), id("burntfish4"));
  assert.equal(burnt(ItemIds.RAW_TUNA), id("burntfish4"));
  for (const raw of [ItemIds.RAW_TROUT, ItemIds.RAW_COD, ItemIds.RAW_PIKE, ItemIds.RAW_SALMON]) assert.equal(burnt(raw), id("burntfish2"));
  assert.equal(burnt(ItemIds.RAW_SARDINE), id("burntfish5"));
  assert.equal(burnt(ItemIds.RAW_ANCHOVIES), id("burntfish1"));
  assert.equal(burnt(ItemIds.RAW_RABBIT), id("burnt_meat"));
});

test("fires and the house's stoves play human_firecooking, other ranges and ovens human_cooking", () => {
  const seq = (name) => Cooking._test.cookAnimationFor(name).getId();
  for (const name of ["Fire", "Firepit with hook", "Small oven"]) assert.equal(seq(name), core.CacheDefinitions.getSeqId("human_firecooking"), name);
  for (const name of ["Range", "Cooking range", "Oven"]) assert.equal(seq(name), core.CacheDefinitions.getSeqId("human_cooking"), name);
});

test("one raw food opens the how-many menu on the raw item; several open the what menu on the cooked ones", () => {
  const one = player(50, [[ItemIds.RAW_TROUT, 3]]);
  hooks.object.Range.Cook({ player: one, object: cooker("Range") });
  assert.equal(one.sent.menu.getTitle(), "How many would you like to cook?");
  assert.deepEqual(one.sent.menu.getItems(), [ItemIds.RAW_TROUT]);
  assert.deepEqual(one.sent.menu.getOptions(), { mode: 6, maxAmount: 3, lastAmount: 3 });

  const many = player(50, [[ItemIds.RAW_SHRIMPS, 2], [ItemIds.RAW_TROUT, 5]]);
  hooks.object.Oven.Cook({ player: many, object: cooker("Oven") });
  assert.equal(many.sent.menu.getTitle(), "What would you like to cook?");
  assert.deepEqual(many.sent.menu.getItems(), [ItemIds.SHRIMPS, ItemIds.TROUT]);
  assert.equal(many.sent.menu.getOptions().maxAmount, 5);
});

test("the what menu shows the karambwan the player will get: poison until Tinsay's training", () => {
  const untaught = player(50, [[ItemIds.RAW_KARAMBWAN, 2], [ItemIds.RAW_TROUT, 2]]);
  hooks.object.Range.Cook({ player: untaught, object: cooker("Range") });
  assert.deepEqual(untaught.sent.menu.getItems(), [ItemIds.POISON_KARAMBWAN, ItemIds.TROUT]);
  untaught.sent.menu.execute(ItemIds.POISON_KARAMBWAN, 2);
  assert.equal(Cooking.isCookingActive(untaught), true, "the poison karambwan entry starts the raw karambwan recipe");

  const taught = player(50, [[ItemIds.RAW_KARAMBWAN, 2], [ItemIds.RAW_TROUT, 2]]);
  taught.setAttribute("quest.tai_bwo_wannai_trio.tinsay", 8);
  hooks.object.Range.Cook({ player: taught, object: cooker("Range") });
  assert.deepEqual(taught.sent.menu.getItems(), [ItemIds.COOKED_KARAMBWAN, ItemIds.TROUT]);
});

test("a single raw item cooks without a menu", () => {
  const p = player(50, [[ItemIds.RAW_TROUT, 1]]);
  const event = { player: p, object: cooker("Fire"), itemId: ItemIds.RAW_TROUT, handled: false };
  hooks.itemOnObject.find(({ filter }) => !filter.fallback).handler(event);
  assert.equal(event.handled, true);
  assert.equal(p.sent.menu, null);
  assert.equal(Cooking.isCookingActive(p), true);
});

test("refusals are message boxes", () => {
  const low = player(50, [[ItemIds.RAW_SHARK, 2]]);
  hooks.itemOnObject.find(({ filter }) => !filter.fallback).handler({ player: low, object: cooker("Fire"), itemId: ItemIds.RAW_SHARK });
  assert.equal(statementText(low.sent.statements[0]), "You need a Cooking level of 80 to cook a shark.");

  const empty = player(50, []);
  hooks.object.Range.Cook({ player: empty, object: cooker("Range") });
  assert.equal(statementText(empty.sent.statements[0]), "You haven't got anything to cook.");

  const bucket = player(50, [[ItemIds.BUCKET, 1]]);
  const refuse = hooks.itemOnObject.find(({ filter }) => filter.fallback);
  const event = { player: bucket, object: cooker("Range"), itemId: ItemIds.BUCKET, handled: false };
  refuse.handler(event);
  assert.equal(event.handled, true);
  assert.equal(statementText(bucket.sent.statements[0]), "You can't cook that.");
});

test("the Gauntlet's cooks move cooking_success_count", () => {
  const p = player(50, []);
  const varbit = core.CacheDefinitions.getVarbitId("cooking_success_count");
  hooks.custom["cooking:count"]({ player: p, burnt: false });
  hooks.custom["cooking:count"]({ player: p, burnt: false });
  assert.equal(p.sent.varbits.get(varbit), 2);
  hooks.custom["cooking:count"]({ player: p, burnt: true });
  assert.equal(p.sent.varbits.get(varbit), 0);
});

const obj = (name) => core.CacheDefinitions.getObjId(name);

test("every food, dough, recipe and wine in cooking.json names a cache item", () => {
  const data = require("../plugins/skills/data/cooking.json");
  const names = new Set();
  for (const row of data.cookables) for (const key of ["raw", "cooked", "burnt"]) names.add(row[key]);
  for (const pair of [data.doughs.flour, ...data.doughs.waters]) for (const name of pair) names.add(name);
  for (const row of data.doughs.products) names.add(row.product);
  for (const row of data.recipes) for (const name of [row.product, ...row.ingredients, ...(row.returns ?? [])]) names.add(name);
  for (const row of data.wines) for (const key of ["grapes", "unfermented", "wine", "bad"]) names.add(row[key]);
  for (const name of names) assert.ok(Number.isInteger(obj(name)), name);
  assert.equal(Cooking.COOKABLE_BY_RAW.size, data.cookables.length, "one row per raw item");
});

test("the Sailing fish cook with their captured lines (recording 4103)", () => {
  const line = (raw) => Cooking._test.successMessage(Cooking.COOKABLE_BY_RAW.get(obj(raw)));
  assert.equal(line("raw_giant_krill"), "You successfully cook the giant krill.");
  assert.equal(line("raw_haddock"), "You successfully cook the haddock.");
  assert.equal(line("raw_marlin"), "You successfully cook the marlin.");
  assert.equal(line("raw_swordtip_squid"), "You successfully cook a swordtip squid.");
  assert.equal(line("raw_jumbo_squid"), "You successfully cook a jumbo squid.");
  assert.equal(Cooking._test.burnMessage(Cooking.COOKABLE_BY_RAW.get(obj("raw_bluefin"))), "You accidentally burn the bluefin.");
  assert.equal(Cooking.COOKABLE_BY_RAW.get(obj("raw_halibut")).xp, 212.5);
});

test("pies and pizzas bake on a range with the captured lines, never on a fire", () => {
  const line = (raw) => Cooking._test.successMessage(Cooking.COOKABLE_BY_RAW.get(obj(raw)));
  assert.equal(line("uncooked_apple_pie"), "You successfully bake a traditional apple pie.");
  assert.equal(line("uncooked_redberry_pie"), "You successfully bake a delicious redberry pie.");
  assert.equal(line("uncooked_pizza"), "You successfully bake a pizza.");
  assert.equal(Cooking.COOKABLE_BY_RAW.get(obj("uncooked_summer_pie")).burnt, obj("burnt_pie"));

  const onFire = player(99, [[obj("uncooked_apple_pie"), 2]]);
  const event = { player: onFire, object: cooker("Fire"), itemId: obj("uncooked_apple_pie"), handled: false };
  hooks.itemOnObject.find(({ filter }) => !filter.fallback).handler(event);
  assert.equal(event.handled, false, "left to the fallback's \"You can't cook that.\"");
  const onRange = player(99, [[obj("uncooked_apple_pie"), 2]]);
  hooks.object.Range.Cook({ player: onRange, object: cooker("Range") });
  assert.deepEqual(onRange.sent.menu.getItems(), [obj("uncooked_apple_pie")]);
});

/** A player whose inventory really changes, for the item-on-item recipes. */
function maker(cooking, carried) {
  const p = player(cooking, []);
  const slots = new Array(28).fill(null);
  let next = 0;
  for (const [id, amount] of carried) for (let i = 0; i < amount; i++) slots[next++] = { getId: () => id };
  const item = (id) => ({ getId: () => id });
  const amount = (id) => slots.filter((slot) => slot?.getId() === id).length;
  const inventory = {
    getItems: () => slots,
    getAmount: amount,
    contains: (id) => amount(id) > 0,
    getFreeSlots: () => slots.filter((slot) => !slot).length,
    deleteNumber: (id, count) => { for (let i = 0; i < slots.length && count > 0; i++) if (slots[i]?.getId() === id) { slots[i] = null; count--; } },
    addItem: (added) => { for (let i = 0; i < added.getAmount(); i++) slots[slots.indexOf(null)] = item(added.getId()); },
    setItem: (slot, added) => { slots[slot] = item(added.getId()); },
    refreshItems: noop,
  };
  const xp = [];
  const effects = [];
  return Object.assign(p, {
    xp, effects,
    getIndex: () => 1,
    isRegistered: () => true,
    getHitpoints: () => 10,
    getInventory: () => inventory,
    getBanks: () => [],
    getSkillManager: () => ({ getCurrentLevel: () => cooking, addExperiences: (_skill, gained) => xp.push(gained) }),
    performAnimation: (animation) => effects.push(["seq", animation.getId()]),
    performGraphic: (graphic) => effects.push(["spotanim", graphic.getId()]),
  });
}

function useItems(p, used, usedWith) {
  const event = { player: p, usedItemId: obj(used), usedWithItemId: obj(usedWith), handled: false };
  for (const handler of hooks.itemOnItem) if (!event.handled) handler(event);
  return event;
}

const ticks = (count) => { for (let i = 0; i < count; i++) core.TaskManager.process(); };

test("flour on water opens the four-dough menu; pastry dough comes a tick after the choice, then a tick, then every 2", () => {
  const p = maker(1, [["pot_flour", 3], ["bucket_water", 3]].map(([name, n]) => [obj(name), n]));
  assert.equal(useItems(p, "pot_flour", "bucket_water").handled, true);
  assert.equal(p.sent.menu.getTitle(), "What sort of dough do you wish to make?");
  assert.deepEqual(p.sent.menu.getItems(), ["bread_dough", "pastry_dough", "pizza_base", "uncooked_pitta_bread"].map(obj));
  assert.deepEqual(p.sent.menu.getOptions(), { mode: 0, maxAmount: 3, lastAmount: 3 });
  p.sent.menu.execute(obj("pastry_dough"), 3);
  const doughs = () => p.getInventory().getAmount(obj("pastry_dough"));
  ticks(1); assert.equal(doughs(), 1);
  ticks(1); assert.equal(doughs(), 2);
  ticks(1); assert.equal(doughs(), 2);
  ticks(1); assert.equal(doughs(), 3);
  assert.equal(p.getInventory().getAmount(obj("pot_empty")), 3);
  assert.equal(p.getInventory().getAmount(obj("bucket_empty")), 3);
  assert.ok(p.sent.spam.some(([, text]) => text === "You mix the water and flour to make some pastry dough."));
});

test("a pizza base needs 35 Cooking", () => {
  const p = maker(20, [[obj("pot_flour"), 1], [obj("jug_water"), 1]]);
  useItems(p, "jug_water", "pot_flour");
  p.sent.menu.execute(obj("pizza_base"), 1);
  assert.equal(statementText(p.sent.statements[0]), "You need a Cooking level of 35 to make a pizza base.");
  ticks(2);
  assert.equal(p.getInventory().getAmount(obj("pizza_base")), 0);
});

test("a pie shell, then a filling: how-many menu on the product, a tick after the choice then every 2", () => {
  const p = maker(30, [[obj("pie_shell"), 3], [obj("cooking_apple"), 3]]);
  useItems(p, "cooking_apple", "pie_shell");
  assert.equal(p.sent.menu.getTitle(), "How many do you wish to make?");
  assert.deepEqual(p.sent.menu.getItems(), [obj("uncooked_apple_pie")]);
  p.sent.menu.execute(obj("uncooked_apple_pie"), 3);
  const pies = () => p.getInventory().getAmount(obj("uncooked_apple_pie"));
  ticks(1); assert.equal(pies(), 1);
  ticks(1); assert.equal(pies(), 1);
  ticks(1); assert.equal(pies(), 2);
  ticks(2); assert.equal(pies(), 3);
  assert.deepEqual(p.effects, [], "no animation");
});

test("a mud pie's part pies give the buckets back", () => {
  const p = maker(29, [[obj("pie_shell"), 1], [obj("bucket_compost"), 1], [obj("bucket_water"), 1], [obj("clay"), 1]]);
  useItems(p, "bucket_compost", "pie_shell"); ticks(1);
  useItems(p, "bucket_water", "unfinished_mud_pie_1"); ticks(1);
  useItems(p, "clay", "unfinished_mud_pie_2"); ticks(1);
  assert.equal(p.getInventory().getAmount(obj("uncooked_mud_pie")), 1);
  assert.equal(p.getInventory().getAmount(obj("bucket_empty")), 2);
});

test("the pizza steps have the captured lines; a topping gives its XP", () => {
  const p = maker(65, [[obj("pizza_base"), 1], [obj("tomato"), 1], [obj("cheese"), 1], [obj("plain_pizza"), 1], [obj("pineapple_ring"), 1]]);
  useItems(p, "tomato", "pizza_base"); ticks(1);
  useItems(p, "cheese", "incomplete_pizza"); ticks(1);
  assert.equal(p.getInventory().getAmount(obj("uncooked_pizza")), 1);
  assert.deepEqual(p.sent.spam.map(([, text]) => text), ["You add the tomato to the pizza.", "You add the cheese to the pizza."]);
  useItems(p, "pineapple_ring", "plain_pizza"); ticks(1);
  assert.equal(p.getInventory().getAmount(obj("pineapple_pizza")), 1);
  assert.deepEqual(p.xp, [45]);
});

test("wine: a jug every 2 ticks with the captured animation, graphic and sound; the line on the last", () => {
  const Wine = Cooking._test.wine;
  const p = maker(99, [[obj("grapes"), 2], [obj("jug_water"), 2]]);
  const sounds = [];
  p.getPacketSender().sendSound = (id, volume, delay) => { sounds.push([id, delay]); return p.getPacketSender(); };
  useItems(p, "grapes", "jug_water");
  assert.deepEqual(p.sent.menu.getItems(), [obj("jug_unfermented_wine")]);
  p.sent.menu.execute(obj("jug_unfermented_wine"), 2);
  const seq = core.CacheDefinitions.getSeqId("human_make_wine");
  const spotanim = core.CacheDefinitions.getSpotanimId("cooking_make_wine_spotanim");
  assert.deepEqual(p.effects, [["seq", seq], ["spotanim", spotanim]], "as the menu closes");
  const jugs = () => p.getInventory().getAmount(obj("jug_unfermented_wine"));
  ticks(1); assert.equal(jugs(), 0);
  ticks(1); assert.equal(jugs(), 1);
  assert.equal(p.effects.length, 4, "again for the second jug");
  ticks(2); assert.equal(jugs(), 2);
  assert.equal(p.effects.length, 4, "not after the last");
  assert.deepEqual(sounds, [[2489, 2], [2489, 2]]);
  assert.deepEqual(p.sent.spam.map(([, text]) => text), ["You squeeze the grapes into the jug. The wine begins to ferment."]);
  assert.equal(Wine.fermenting.get(p), Wine.FERMENT_TICKS);
  Wine.fermenting.delete(p);
});

/** maker()'s player with a real bank (every tab a native Bank), `fill` slots of it taken by other items. */
function bankedMaker(cooking, carried, banked, fill) {
  const { Bank } = require("../dist/game/model/container/impl/Bank");
  const p = maker(cooking, carried);
  const tabs = Array.from({ length: Bank.TOTAL_BANK_TABS }, () => new Bank(p));
  Object.assign(p, {
    getBanks: () => tabs,
    getBank: (tab) => tabs[tab],
    setBank: (tab, bank) => { tabs[tab] = bank; return p; },
    isSearchingBank: () => false,
    getCurrentBankTab: () => 0,
    getPacketSender: () => new Proxy({}, { get: (_t, _k) => function sender() { return this; } }),
  });
  Bank.withoutLimit(p, () => {
    for (let id = 0, added = 0; added < fill; id++) {
      if ([...banked.map(([itemId]) => itemId), obj("jug_wine"), obj("jug_bad_wine")].includes(id)) continue;
      tabs[0].add(new core.Item(id, 1), false);
      added++;
    }
    for (const [id, amount] of banked) tabs[0].add(new core.Item(id, amount), false);
  });
  return { p, tabs, Bank };
}

test("wine ferments 20 ticks after the last jug, carried and banked at once, with all its XP", () => {
  const Wine = Cooking._test.wine;
  const { p, tabs } = bankedMaker(99, [[obj("grapes"), 1], [obj("jug_water"), 1]], [[obj("jug_unfermented_wine"), 40]], 0);
  const amount = (id) => tabs.reduce((sum, tab) => sum + tab.getAmount(id), 0);
  useItems(p, "grapes", "jug_water");
  ticks(2);
  assert.equal(p.getInventory().getAmount(obj("jug_unfermented_wine")), 1);
  for (let i = 0; i < Wine.FERMENT_TICKS - 1; i++) Wine.fermentTick();
  assert.equal(p.getInventory().getAmount(obj("jug_wine")), 0);
  Wine.fermentTick();
  assert.equal(p.getInventory().getAmount(obj("jug_wine")), 1);
  assert.equal(amount(obj("jug_unfermented_wine")), 0);
  assert.equal(amount(obj("jug_wine")), 40);
  assert.deepEqual(p.xp, [41 * 200]);
});

test("a full bank's wine ferments without losing any: the outcome takes the unfermented stack's slot", () => {
  const Wine = Cooking._test.wine;
  const { Bank } = require("../dist/game/model/container/impl/Bank");
  const unfermented = obj("jug_unfermented_wine");
  // One stack of 2 and nothing else free: room for one new stack only.
  const { p, tabs } = bankedMaker(35, [], [[unfermented, 2]], Bank.getCapacity({}) - 1);
  assert.equal(Bank.freeSlots(p), 0);
  const random = Math.random;
  let roll = 0;
  Math.random = () => (roll++ === 0 ? 0 : 0.99); // one jug good, one bad
  try { Wine.ferment(p); } finally { Math.random = random; }
  const amount = (id) => tabs.reduce((sum, tab) => sum + tab.getAmount(id), 0);
  assert.equal(amount(unfermented), 2, "no room for both wine and bad wine: the jugs wait");
  assert.equal(amount(obj("jug_wine")) + amount(obj("jug_bad_wine")), 0);
  assert.deepEqual(p.xp, []);
  assert.equal(Bank.freeSlots(p), 0);
});

test("a bank with one more free slot ferments a mixed result into two new stacks", () => {
  const Wine = Cooking._test.wine;
  const { Bank } = require("../dist/game/model/container/impl/Bank");
  const unfermented = obj("jug_unfermented_wine");
  const { p, tabs } = bankedMaker(35, [], [[unfermented, 2]], Bank.getCapacity({}) - 2);
  const random = Math.random;
  let roll = 0;
  Math.random = () => (roll++ === 0 ? 0 : 0.99);
  try { Wine.ferment(p); } finally { Math.random = random; }
  const amount = (id) => tabs.reduce((sum, tab) => sum + tab.getAmount(id), 0);
  assert.equal(amount(unfermented), 0);
  assert.equal(amount(obj("jug_wine")), 1);
  assert.equal(amount(obj("jug_bad_wine")), 1);
  assert.deepEqual(p.xp, [200]);
});

test("a full bank that already holds wine and bad wine stacks onto them", () => {
  const Wine = Cooking._test.wine;
  const { Bank } = require("../dist/game/model/container/impl/Bank");
  const unfermented = obj("jug_unfermented_wine");
  const { p, tabs } = bankedMaker(35, [], [[unfermented, 2], [obj("jug_wine"), 5], [obj("jug_bad_wine"), 5]], Bank.getCapacity({}) - 3);
  assert.equal(Bank.freeSlots(p), 0);
  const random = Math.random;
  let roll = 0;
  Math.random = () => (roll++ === 0 ? 0 : 0.99);
  try { Wine.ferment(p); } finally { Math.random = random; }
  const amount = (id) => tabs.reduce((sum, tab) => sum + tab.getAmount(id), 0);
  assert.equal(amount(unfermented), 0);
  assert.equal(amount(obj("jug_wine")), 6);
  assert.equal(amount(obj("jug_bad_wine")), 6);
});

test("wine's success chance is the Wiki's: about 60% at 35, sure at 68; stacks roll in 15 batches", () => {
  const { successChance, successes } = Cooking._test.wine;
  const wine = { chance: [48, 352] };
  assert.equal(successChance(maker(35, []), wine), 154 / 256);
  assert.equal(successChance(maker(68, []), wine), 1);
  assert.equal(successChance(maker(98, []), { chance: [-125, 260] }), 1, "wine of Zamorak is sure at 98");
  let rolls = 0;
  assert.equal(successes(32, 0.5, () => (rolls++ % 2 === 0 ? 0 : 1)), 8 * 2 + 1, "15 batches of 2 and 2 jugs left over");
  assert.equal(rolls, 17);
});

// Native cache, Player/inventory, named cooker dispatch and the registered cooking
// task consume the same canonical row used by range menus and gathering plugins.
test('Brutus t-bone steaks cook on native ranges and fires with the correct level, products and XP', async t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { SkillManager } = require('../dist/game/content/skill/SkillManager');
  core.ObjectDefinition.init();
  core.RegionManager.init();
  Cooking._test.activeSessions.clear(); // legacy recording fixtures above never tick their cook sessions
  Cooking.register(PluginManager.createApi('NativeSteakCooking'));
  const cookTask = submittedCookingTasks.find(task => Number.isInteger(task.cycle));
  assert.ok(cookTask, 'the original registration submitted its actual cooking runner');
  core.TaskManager.submit(cookTask);
  t.after(() => cookTask.stop());
  const raw = obj('raw_tbone_steak'), cooked = obj('tbone_steak'), burnt = obj('tbone_steak_burned');
  assert.deepEqual([raw, cooked, burnt], [33106, 33109, 33112]);
  const rangeId = core.CacheDefinitions.getLocId('fai_varrock_range');
  const fireId = core.CacheDefinitions.getLocId('fire');
  const range = new core.GameObject(rangeId, new core.Location(3222, 3218), 10, 0);
  const fire = new core.GameObject(fireId, new core.Location(3224, 3218), 10, 0);
  assert.equal(range.getDefinition().getName(), 'Range');
  assert.ok(range.getDefinition().getActions().includes('Cook'));
  assert.equal(fire.getDefinition().getName(), 'Fire');
  for (const object of [range, fire]) core.MapObjects.add(object);
  t.after(() => { for (const object of [range, fire]) core.MapObjects.remove(object); });
  let index = 2800;
  function actor(t, level, object, item = raw, amount = 1) {
    const p = new Player(new PlayerSession({ kind: 'test', isOpen: () => true, send: () => true }))
      .setUsername(`steakcook${index}`).setIndex(index++);
    p.setRegistered(true); p.setLocation(object.getLocation().clone().add(-1, 0)); p.setNeedsPlacement(false);
    const skills = p.getSkillManager();
    skills.setCurrentLevel(core.Skill.COOKING, level, false).setMaxLevels(core.Skill.COOKING, level, false)
      .setExperience(core.Skill.COOKING, SkillManager.getExperienceForLevel(level));
    p.getInventory().adds(item, amount);
    const experience = skills.getExperience(core.Skill.COOKING);
    t.after(() => { p.setRegistered(false); Cooking._test.activeSessions.delete(p); core.TaskManager.cancelTasks(p.getIndex()); });
    return { p, experience };
  }
  const xpGained = ({ p, experience }) => p.getSkillManager().getExperience(core.Skill.COOKING) - experience;
  const successXp = 90 * core.GameConstants.EXPERIENCE_MULTIPLIER;
  function use(p, object, item = raw) {
    return PluginManager.emitItemOnObject({ player: p, object, objectId: object.getId(), itemId: item,
      item: p.getInventory().get(0), slot: 0, handled: false });
  }
  function tick(roll) {
    const previous = Math.random;
    Math.random = () => roll;
    try { for (let n = 0; n < 3; n++) core.TaskManager.process(); }
    finally { Math.random = previous; }
  }
  for (const object of [range, fire]) {
    const name = object.getDefinition().getName();
    await t.test(`${name}: level 13 succeeds for 90 XP and can also burn for 0 XP`, t => {
      const good = actor(t, 13, object);
      assert.equal(use(good.p, object), true);
      assert.equal(Cooking.isCookingActive(good.p), true, 'the raw steak reaches the ordinary cooking session');
      tick(0.99);
      assert.equal(good.p.getInventory().getAmount(raw), 0);
      assert.equal(good.p.getInventory().getAmount(cooked), 1);
      assert.equal(xpGained(good), successXp, '90 base XP passes through the real skill manager and world rate');
      const failed = actor(t, 13, object);
      assert.equal(use(failed.p, object), true); tick(0);
      assert.equal(failed.p.getInventory().getAmount(raw), 0);
      assert.equal(failed.p.getInventory().getAmount(burnt), 1);
      assert.equal(xpGained(failed), 0);
    });
  }
  await t.test('level 12 refuses without consuming raw steak or awarding XP', t => {
    const f = actor(t, 12, range), { p } = f;
    assert.equal(use(p, range), true);
    assert.equal(p.getDialogueManager().getCurrent().getText(), 'You need a Cooking level of 13 to cook a t-bone steak.');
    tick(0.99); assert.equal(p.getInventory().getAmount(raw), 1); assert.equal(xpGained(f), 0);
    assert.equal(Cooking.isCookingActive(p), false);
  });
  await t.test('49 can still burn, while 50 stops burning on either cooker', t => {
    for (const object of [range, fire]) {
      const low = actor(t, 49, object); use(low.p, object); tick(0);
      assert.equal(low.p.getInventory().getAmount(burnt), 1);
      const high = actor(t, 50, object); use(high.p, object); tick(0);
      assert.equal(high.p.getInventory().getAmount(cooked), 1);
      assert.equal(xpGained(high), successXp);
    }
  });
  await t.test('range Cook menus include steak alongside other food; noted steaks remain excluded', t => {
    const { p } = actor(t, 99, range, raw, 2);
    p.getInventory().adds(obj('raw_trout'), 1);
    const definition = range.getDefinition();
    assert.equal(PluginManager.emitObjectInteraction({ player: p, object: range, objectId: rangeId, definition,
      location: { x: 3222, y: 3218, z: 0 }, clickType: definition.getActions().indexOf('Cook') + 1, handled: false }), true);
    assert.ok(p.getCreationMenu(), 'steak and trout are both offered in the mixed-food menu');
    assert.deepEqual(p.getCreationMenu().getItems(), [cooked, obj('trout')]);
    p.getCreationMenu().execute(cooked, 1); tick(0);
    assert.equal(p.getInventory().getAmount(cooked), 1);
    const note = obj('cert_raw_tbone_steak'), noted = actor(t, 99, range, note);
    assert.equal(use(noted.p, range, note), false);
    tick(0.99); assert.equal(noted.p.getInventory().getAmount(note), 1);
    assert.equal(Cooking.isCookingActive(noted.p), false);
  });
});
