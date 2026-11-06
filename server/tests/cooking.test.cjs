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
  const ref = (entry) => Array.isArray(entry) ? entry[0] : entry;
  for (const row of data.recipes) for (const name of [ref(row.product), ...row.ingredients.map(ref), ...(row.returns ?? []).map(ref)]) names.add(name);
  for (const row of data.wines) for (const key of ["grapes", "unfermented", "wine", "bad"]) names.add(row[key]);
  for (const name of names) assert.ok(Number.isInteger(typeof name === "number" ? name : obj(name)), name);
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
    getMovementQueue: () => ({ size: () => 0 }),
    getForceMovement: () => null,
    getLocation: () => new core.Location(3221, 3218, 0),
    getPrivateArea: () => null,
    getInventory: () => inventory,
    getBanks: () => [],
    getSkillManager: () => ({ getCurrentLevel: () => cooking, addExperiences: (_skill, gained) => xp.push(gained) }),
    performAnimation: (animation) => effects.push(["seq", animation.getId()]),
    performGraphic: (graphic) => effects.push(["spotanim", graphic.getId()]),
  });
}

function useItems(p, used, usedWith) {
  const id = (value) => typeof value === "number" ? value : obj(value);
  const event = { player: p, usedItemId: id(used), usedWithItemId: id(usedWith), handled: false };
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

test("the gnome chocolate-bomb steps use the Wiki materials, XP and four-tick bakes", (t) => {
  Cooking._test.activeSessions.clear();
  core.ObjectDefinition.init();
  const range = new core.GameObject(core.CacheDefinitions.getLocId('fai_varrock_range'), new core.Location(3222, 3218), 10, 0);
  core.MapObjects.add(range);
  t.after(() => core.MapObjects.remove(range));
  const HALF_MADE = 9563, UNFINISHED = 9564;
  const p = maker(42, [
    [obj("gianne_dough"), 1], [obj("gnomebowl_mould"), 1], [obj("chocolate_bar"), 4],
    [obj("equa_leaves"), 1], [obj("chocolate_dust"), 1], [obj("pot_of_cream"), 2],
  ]);
  useItems(p, "gianne_dough", "gnomebowl_mould"); ticks(1);
  assert.equal(p.getInventory().getAmount(obj("raw_gnomebowl")), 1);
  assert.equal(p.xp.length, 0, "the raw bowl gives no XP");
  assert.equal(p.getInventory().getAmount(obj("gnomebowl_mould")), 0, "the raw bowl still holds the mould");

  const cookTask = submittedCookingTasks.find(task => Number.isInteger(task.cycle));
  cookTask.setRunning(true);
  const cookTicks = (count) => { for (let i = 0; i < count; i++) cookTask.tick(); };
  const cook = (itemId) => {
    const event = { player: p, object: range, itemId, handled: false };
    hooks.itemOnObject.find(({ filter }) => !filter.fallback).handler(event);
  };
  cook(obj("raw_gnomebowl")); cookTicks(3);
  assert.equal(p.getInventory().getAmount(obj("half_baked_bowl")), 0, "four ticks, not two");
  cookTicks(1);
  assert.equal(p.getInventory().getAmount(obj("half_baked_bowl")), 1);
  assert.equal(p.xp.at(-1), 30);

  useItems(p, obj("half_baked_bowl"), "chocolate_bar"); ticks(1);
  assert.equal(p.getInventory().getAmount(HALF_MADE), 1);
  assert.equal(p.getInventory().getAmount(obj("gnomebowl_mould")), 1, "preparing releases the reusable mould");
  assert.equal(p.xp.at(-1), 50);

  const xpBeforeBake = p.xp.length;
  cook(HALF_MADE); cookTicks(3);
  assert.equal(p.getInventory().getAmount(UNFINISHED), 0, "four ticks again");
  cookTicks(1);
  assert.equal(p.getInventory().getAmount(UNFINISHED), 1);
  assert.equal(p.xp.length, xpBeforeBake, "the second bake gives no XP");
  Cooking._test.activeSessions.clear();
  cookTask.setRunning(false);

  useItems(p, UNFINISHED, "chocolate_dust"); ticks(1);
  assert.equal(p.getInventory().getAmount(obj("chocolate_bomb")), 1);
  assert.equal(p.getInventory().getAmount(obj("pot_of_cream")), 0);
  assert.equal(p.xp.at(-1), 110);
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
  // A short route can be consumed in the player's turn, before the next global
  // cook pass. Keep the existing runner active and use the real epoch/reset
  // boundaries; an animation update alone is not evidence that cooking started.
  core.RegionManager.loadMapFiles(3222, 3218);
  const busyId = core.CacheDefinitions.getVarbitId('busy');
  assert.ok(Number.isInteger(busyId), 'the native cache defines the cooking busy varbit');
  function cookingTurn(p, input = () => {}) {
    p.resetUpdating(); // the prior turn's post-sync boundary, deferred for observation
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    const cycle = cookTask.cycle;
    core.TaskManager.process();
    assert.equal(cookTask.cycle, cycle + 1, 'one shared cook-runner step per global pass');
    input();
    const movement = p.getMovementQueue();
    movement.beginCycle();
    movement.processEntityPursuit();
    if (movement.hasPendingWork()) movement.process();
    core.TaskManager.processWalkTo(p.getIndex());
  }

  for (const walk of [false, true]) {
    await t.test(walk
      ? 'a one-step walk after the first native cook cancels the pending second item'
      : 'without movement the second native cook debits one more raw item and grants its output and XP', t => {
      const f = actor(t, 50, range, raw, 2), { p } = f;
      const inventory = p.getInventory(), movement = p.getMovementQueue();
      const sender = p.getPacketSender();
      const busy = [], messages = [], restore = [];
      function watch(target, name, capture) {
        const own = Object.getOwnPropertyDescriptor(target, name);
        const original = target[name];
        assert.equal(typeof original, 'function', 'native observer method exists: ' + name);
        target[name] = function (...args) {
          capture(args);
          return Reflect.apply(original, this, args);
        };
        restore.push(() => own
          ? Object.defineProperty(target, name, own)
          : delete target[name]);
      }
      t.after(() => { for (const reset of restore.reverse()) reset(); });
      watch(sender, 'sendVarbit', ([id, value]) => {
        if (id === busyId) {
          busy.push(value);
          if (busy.length > 8) busy.shift();
        }
      });
      const recordMessage = text => {
        if (messages.length < 8) messages.push(String(text).slice(0, 140));
      };
      watch(p, 'sendMessage', ([text]) => recordMessage(text));
      watch(sender, 'sendTypedMessage', ([, text]) => recordMessage(text));
      const position = () => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];
      const yieldState = () => ({
        raw: inventory.getAmount(raw), cooked: inventory.getAmount(cooked),
        burnt: inventory.getAmount(burnt), xp: xpGained(f),
      });
      const state = () => ({
        ...yieldState(), position: position(), queued: movement.size(),
        moving: movement.isMovings(), active: Cooking.isCookingActive(p),
        animation: p.getAnimation()?.getId(), busy: busy.at(-1),
        cookCycle: cookTask.cycle, busyCalls: busy, messages,
      });
      const diagnostic = label => label + ': ' + JSON.stringify(state());

      assert.equal(use(p, range), true, 'registered cooker handles the real raw steak');
      const menu = p.getCreationMenu();
      assert.ok(menu, 'two raw items open the native quantity menu');
      assert.deepEqual(menu.getItems(), [raw]);
      menu.execute(raw, 2);
      assert.equal(Cooking.isCookingActive(p), true, 'real menu selection admits a cook session');
      assert.equal(busy.at(-1), 1, 'the actual cook start sends busy=1');
      assert.deepEqual(yieldState(), { raw: 2, cooked: 0, burnt: 0, xp: 0 });
      cookingTurn(p);
      assert.deepEqual(yieldState(), { raw: 2, cooked: 0, burnt: 0, xp: 0 },
        diagnostic('SETUP: the first item is not cooked on the first pass'));
      cookingTurn(p);
      const first = { raw: 1, cooked: 1, burnt: 0, xp: successXp };
      assert.deepEqual(yieldState(), first, diagnostic('SETUP: first actual cook and debit'));
      assert.equal(busy.at(-1), 0, diagnostic('SETUP: first cook released busy'));
      assert.equal(Cooking.isCookingActive(p), true);
      assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.COOKING), 50,
        'no level-up or temporary boost changes the ordinary level-50 control');
      assert.equal(p.getDialogueManager().isActive(), false, 'no level-up dialogue pauses this session');

      cookingTurn(p, () => {
        if (walk) movement.requestWalk(new core.Location(3220, 3218, 0), false);
      });
      assert.deepEqual(yieldState(), first, diagnostic('SETUP: no second cook before the walk'));
      if (walk) {
        assert.deepEqual(position(), [3220, 3218, 0],
          diagnostic('SETUP: native requestWalk must actually move one tile'));
        assert.equal(movement.size(), 0, diagnostic('SETUP: the one-step route drained'));
        assert.equal(movement.isMovings(), true,
          diagnostic('SETUP: processed movement survives until the next global pass'));
        assert.equal(range.isWithinInteractionDistance(p.getLocation()), true,
          diagnostic('SETUP: this is movement cancellation, not an out-of-range stop'));
      } else {
        assert.deepEqual(position(), [3221, 3218, 0]);
        assert.equal(movement.isMovings(), false);
      }
      // The second item is due three passes after the first, not two.
      cookingTurn(p);
      assert.deepEqual(yieldState(), first, diagnostic('SETUP: ordinary second-cook cadence'));
      for (let n = 0; n < 3; n++) cookingTurn(p);
      assert.deepEqual(yieldState(), walk
        ? first
        : { raw: 0, cooked: 2, burnt: 0, xp: successXp * 2 },
      diagnostic(walk
        ? 'no further debit, output or XP after the accepted one-step walk'
        : 'the no-move control completes the second actual cook'));
    });
  }
  await t.test('outside-range item use settles before native autocook and quantity-menu cooking', t => {
    const { UseItemPacketListener } = require('../dist/net/packet/impl/UseItemPacketListener');
    const { Inventory } = require('../dist/game/model/container/impl/Inventory');
    for (const amount of [1, 2]) {
      const f = actor(t, 50, range, raw, amount), { p } = f;
      p.setLocation(new core.Location(3218, 3218, 0));
      const movement = p.getMovementQueue(), sender = p.getPacketSender();
      const messages = [], trace = [], restore = [];
      let lastBusy;
      function watch(target, name, capture) {
        const own = Object.getOwnPropertyDescriptor(target, name), original = target[name];
        assert.equal(typeof original, 'function');
        target[name] = function (...args) {
          capture(args);
          return Reflect.apply(original, this, args);
        };
        restore.push(() => own ? Object.defineProperty(target, name, own) : delete target[name]);
      }
      t.after(() => { for (const reset of restore.reverse()) reset(); });
      watch(sender, 'sendVarbit', ([id, value]) => { if (id === busyId) lastBusy = value; });
      const message = text => { if (messages.length < 8) messages.push(String(text).slice(0, 140)); };
      watch(p, 'sendMessage', ([text]) => message(text));
      watch(sender, 'sendTypedMessage', ([, text]) => message(text));
      const position = () => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];
      const yieldState = () => ({
        raw: p.getInventory().getAmount(raw), cooked: p.getInventory().getAmount(cooked),
        burnt: p.getInventory().getAmount(burnt), xp: xpGained(f),
      });
      const state = () => ({
        amount, position: position(), queued: movement.size(), moving: movement.isMovings(),
        didMove: movement.didMoveThisCycle(), active: Cooking.isCookingActive(p),
        menu: !!p.getCreationMenu(), ...yieldState(), busy: lastBusy, trace, messages,
      });
      const diagnostic = label => label + ': ' + JSON.stringify(state());
      assert.deepEqual(position(), [3218, 3218, 0]);
      assert.equal(range.isWithinInteractionDistance(p.getLocation()), false,
        'SETUP: this actor really starts outside the cooker footprint range');
      let ready = false;
      for (let turn = 1; turn <= 8 && !ready; turn++) {
        cookingTurn(p, () => {
          if (turn === 1) UseItemPacketListener.itemOnObject(p, Inventory.INTERFACE_ID,
            rangeId, raw, 0, range.getLocation().getX(), range.getLocation().getY());
        });
        trace.push({ turn, position: position(), queued: movement.size(), moving: movement.isMovings(),
          didMove: movement.didMoveThisCycle(), active: Cooking.isCookingActive(p), menu: !!p.getCreationMenu() });
        ready = amount === 1 ? Cooking.isCookingActive(p) : !!p.getCreationMenu();
      }
      assert.equal(ready, true, diagnostic('SETUP: the real route must reach autocook or its quantity menu'));
      assert.notDeepEqual(position(), [3218, 3218, 0], diagnostic('SETUP: approach actually moved'));
      assert.equal(range.isWithinInteractionDistance(p.getLocation()), true);
      assert.equal(movement.size(), 0, diagnostic('SETUP: approach route is drained'));
      assert.equal(movement.isMovings(), false, diagnostic('SETUP: native item-use admission is settled'));
      assert.equal(movement.didMoveThisCycle(), false, diagnostic('SETUP: this is not the arrival movement turn'));
      assert.deepEqual(yieldState(), { raw: amount, cooked: 0, burnt: 0, xp: 0 },
        diagnostic('SETUP: reaching the cooker has not already cooked an item'));
      if (amount === 2) {
        assert.equal(Cooking.isCookingActive(p), false, 'the menu is not an admitted cook session');
        const menu = p.getCreationMenu();
        assert.deepEqual(menu.getItems(), [raw]);
        cookingTurn(p, () => menu.execute(raw, 2)); // a real selection in the next input phase
      }
      assert.equal(Cooking.isCookingActive(p), true, diagnostic('native autocook/menu starts its session'));
      assert.equal(lastBusy, 1, diagnostic('the admitted session sent busy=1'));
      cookingTurn(p);
      assert.deepEqual(yieldState(), { raw: amount, cooked: 0, burnt: 0, xp: 0 },
        diagnostic('the first cook still waits two global passes from admission'));
      cookingTurn(p);
      const first = { raw: amount - 1, cooked: 1, burnt: 0, xp: successXp };
      assert.deepEqual(yieldState(), first, diagnostic('first legitimate approach cook completes'));
      assert.equal(lastBusy, 0);
      assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.COOKING), 50);
      assert.equal(p.getDialogueManager().isActive(), false);
      cookingTurn(p);
      assert.deepEqual(yieldState(), first);
      cookingTurn(p);
      assert.deepEqual(yieldState(), first, 'the second item is not cooked before its ordinary interval');
      cookingTurn(p);
      assert.deepEqual(yieldState(), { raw: 0, cooked: amount, burnt: 0, xp: successXp * amount },
        diagnostic('autocook and menu both complete normally after their real approach'));
    }
  });
  await t.test('manual raw karambwan re-use on each tick cooks one per tick (Wiki 1-tick Cooking)', t => {
    const rawK = obj('tbwt_raw_karambwan'), cookedK = obj('tbwt_cooked_karambwan');
    for (const object of [range, fire]) {
      const f = actor(t, 99, object, rawK, 8), { p } = f;
      p.setAttribute('quest.tai_bwo_wannai_trio.tinsay', 8);
      const inventory = p.getInventory();
      const yields = [];
      for (let turn = 0; turn < 7; turn++) {
        cookingTurn(p, () => {
          const carried = inventory.getAmount(rawK);
          assert.equal(use(p, object, rawK), true);
          if (carried > 1) p.getCreationMenu().execute(rawK, carried);
        });
        yields.push({ raw: inventory.getAmount(rawK), cooked: inventory.getAmount(cookedK), xp: xpGained(f) });
      }
      // The first karambwan keeps its ordinary two-tick delay; re-using the
      // cooker on later ticks then cooks the next one each tick.
      assert.deepEqual(yields.slice(0, 2), [
        { raw: 8, cooked: 0, xp: 0 },
        { raw: 8, cooked: 0, xp: 0 },
      ], object.getDefinition().getName());
      for (let i = 2; i < yields.length; i++) {
        assert.deepEqual(yields[i], {
          raw: 8 - (i - 1), cooked: i - 1, xp: 190 * (i - 1),
        }, object.getDefinition().getName() + ': one raw karambwan per tick from the first cook');
      }
    }
  });
  await t.test('same-tick karambwan doubleclicks preserve the first delay and never cook twice per tick', t => {
    const rawK = obj('tbwt_raw_karambwan'), cookedK = obj('tbwt_cooked_karambwan');
    const f = actor(t, 99, fire, rawK, 4), { p } = f;
    p.setAttribute('quest.tai_bwo_wannai_trio.tinsay', 8);
    const inventory = p.getInventory();
    const doubleClick = () => {
      for (let click = 0; click < 2; click++) {
        const carried = inventory.getAmount(rawK);
        if (!carried) return;
        assert.equal(use(p, fire, rawK), true);
        if (carried > 1) p.getCreationMenu().execute(rawK, carried);
      }
    };
    doubleClick();
    assert.equal(inventory.getAmount(cookedK), 0);
    for (let pass = 1; pass <= 6; pass++) {
      cookingTurn(p, doubleClick);
      const done = Math.min(4, Math.max(0, pass - 1));
      assert.equal(inventory.getAmount(cookedK), done, 'at most one cook per global tick after initial delay');
      assert.equal(inventory.getAmount(rawK), 4 - done);
      assert.equal(xpGained(f), done * 190);
    }
    assert.equal(Cooking.isCookingActive(p), false, 'depletion stops the session');
  });
  await t.test('queued karambwan retains the ordinary 2/3/4-tick cadence without manual repeats', t => {
    const rawK = obj('tbwt_raw_karambwan'), cookedK = obj('tbwt_cooked_karambwan');
    const f = actor(t, 99, range, rawK, 4), { p } = f;
    p.setAttribute('quest.tai_bwo_wannai_trio.tinsay', 8);
    assert.equal(use(p, range, rawK), true);
    p.getCreationMenu().execute(rawK, 4);
    for (const done of [0, 1, 1, 1, 2, 2, 2, 2, 3]) {
      cookingTurn(p);
      assert.equal(p.getInventory().getAmount(cookedK), done);
      assert.equal(p.getInventory().getAmount(rawK), 4 - done);
      assert.equal(xpGained(f), done * 190);
    }
  });
  for (const cancel of ['walk', 'disconnect']) {
    await t.test('manual karambwan pending cook is cancelled by ' + cancel, t => {
      const rawK = obj('tbwt_raw_karambwan'), cookedK = obj('tbwt_cooked_karambwan');
      const f = actor(t, 99, range, rawK, 4), { p } = f;
      p.setAttribute('quest.tai_bwo_wannai_trio.tinsay', 8);
      assert.equal(use(p, range, rawK), true);
      p.getCreationMenu().execute(rawK, 4);
      cookingTurn(p);
      cookingTurn(p, () => {
        assert.equal(use(p, range, rawK), true);
        p.getCreationMenu().execute(rawK, 3);
        if (cancel === 'walk') p.getMovementQueue().requestWalk(p.getLocation().clone().add(-1, 0), false);
        else PluginManager.emitPlayerDisconnect({ player: p, username: p.getUsername() });
      });
      assert.equal(p.getInventory().getAmount(cookedK), 1);
      if (cancel === 'walk') assert.equal(p.getMovementQueue().isMovings(), true, 'accepted one-step walk actually moved');
      if (cancel === 'walk') assert.equal(range.isWithinInteractionDistance(p.getLocation()), true,
        'the walk remains within cooking range so movement itself cancels');
      for (let i = 0; i < 4; i++) cookingTurn(p);
      assert.equal(p.getInventory().getAmount(cookedK), 1, 'no pending accelerated cook after cancellation');
      assert.equal(p.getInventory().getAmount(rawK), 3);
      assert.equal(xpGained(f), 190);
      assert.equal(Cooking.isCookingActive(p), false);
    });
  }
  await t.test('ordinary fish re-use keeps its queued timing, not the karambwan 1-tick slice', t => {
    const f = actor(t, 99, range, raw, 8), { p } = f;
    const inventory = p.getInventory();
    for (let turn = 0; turn < 7; turn++) {
      cookingTurn(p, () => {
        const carried = inventory.getAmount(raw);
        assert.equal(use(p, range), true);
        if (carried > 1) p.getCreationMenu().execute(raw, carried);
      });
    }
    assert.equal(inventory.getAmount(cooked), 0,
      'the supported 1-tick slice covers raw karambwan only; ordinary fish re-use is unchanged');
  });
});


// These two cases create their pending jug through the real recipe listener and
// bank it before the original shared fermentation task reaches its deadline.
test("native queued wine conserves banked jugs at the output stack limit", async t => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  const { Bank } = require("../dist/game/model/container/impl/Bank");
  const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");
  const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
  const pending = Cooking._test.wine.fermenting; // observation and teardown only
  const captured = submittedCookingTasks.filter(task => !Number.isInteger(task.cycle));
  assert.equal(captured.length, 1, "SETUP: one original Wine task was captured by legacy registration");
  const wineTask = captured[0];
  assert.equal(wineTask.isRunning(), false, "SETUP: the captured Wine task has not already been submitted");
  assert.equal(wineTask.key, core.Task.DEFAULT_KEY);
  assert.equal(pending.size, 0, "SETUP: legacy Wine cases left no pending players");
  assert.equal(MAX_STACK_AMOUNT, 2147483647);
  assert.equal(core.GameConstants.EXPERIENCE_MULTIPLIER, 1, "SETUP: literal base-XP checks need the ordinary world rate");

  const execute = wineTask.execute, descriptor = Object.getOwnPropertyDescriptor(wineTask, "execute");
  let passes = 0;
  t.after(() => {
    wineTask.stop();
    if (descriptor) Object.defineProperty(wineTask, "execute", descriptor);
    else delete wineTask.execute;
    core.TaskManager.process(); // retire stopped tasks after the material observations
  });
  wineTask.execute = function (...args) {
    passes++;
    return Reflect.apply(execute, this, args);
  };
  core.TaskManager.submit(wineTask); // the actual captured task, activated exactly once
  function turn(p) {
    p.resetUpdating();
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    const before = passes;
    core.TaskManager.process();
    assert.equal(passes, before + 1, "SETUP: exactly one Wine-task execution per global pass");
  }

  const grapes = obj("grapes"), water = obj("jug_water");
  const unfermented = obj("jug_unfermented_wine"), wine = obj("jug_wine"), bad = obj("jug_bad_wine");
  assert.equal(new Set([grapes, water, unfermented, wine, bad]).size, 5);
  let index = 3000;
  for (const full of [false, true]) {
    await t.test(full
      ? "a newly banked pending jug conserves its unit and credited XP beside a saturated wine stack"
      : "a newly banked pending jug matures normally when one output-stack unit fits", t => {
      const p = new Player(new PlayerSession({ kind: "test", isOpen: () => true, send: () => true }))
        .setUsername("winebank" + index).setIndex(index++);
      p.setRegistered(true);
      p.setLocation(new core.Location(3221, 3218, 0));
      p.setNeedsPlacement(false);
      t.after(() => {
        p.getPacketSender().sendInterfaceRemoval();
        p.setRegistered(false);
        core.TaskManager.cancelTasks(p.getIndex());
        pending.delete(p);
      });
      const skills = p.getSkillManager();
      skills.setCurrentLevel(core.Skill.COOKING, 68, false).setMaxLevels(core.Skill.COOKING, 68, false)
        .setExperience(core.Skill.COOKING, SkillManager.getExperienceForLevel(68));
      const startXp = skills.getExperience(core.Skill.COOKING);
      const inventory = p.getInventory(), bank = p.getBank(0);
      const initialWine = MAX_STACK_AMOUNT - (full ? 0 : 1);
      bank.add(new core.Item(wine, initialWine), false);
      inventory.adds(grapes, 1).adds(water, 1);
      const tabs = p.getBanks().filter((tab, i) => tab && i !== Bank.BANK_SEARCH_TAB_INDEX);
      const total = id => inventory.getAmount(id) + tabs.reduce((sum, tab) => sum + tab.getAmount(id), 0);
      const state = () => ({
        grapes: total(grapes), water: total(water), pending: total(unfermented),
        wine: total(wine), delivered: total(wine) - initialWine, bad: total(bad),
        xp: skills.getExperience(core.Skill.COOKING) - startXp,
        timer: pending.get(p) ?? null, bankOpen: Bank.isOpen(p), passes,
      });
      const diagnostic = label => label + ": " + JSON.stringify(state());
      assert.equal(bank.getAmount(wine), initialWine, "SETUP: one legal plain output stack");
      assert.equal(bank.getAddableAmount(new core.Item(wine, 1)), full ? 0 : 1);
      assert.ok(Bank.freeSlots(p) > 1, "SETUP: this is a stack-amount limit, not a full-slot bank");
      assert.equal(total(unfermented), 0);
      assert.equal(total(bad), 0);

      UseItemPacketListener.itemOnItem(p, inventory.getSlotForItemId(grapes), inventory.getSlotForItemId(water));
      assert.ok(p.getCreationMenu() == null, "SETUP: one jug uses the native automatic recipe without a menu");
      turn(p);
      assert.deepEqual([total(grapes), total(water), total(unfermented), state().xp], [1, 1, 0, 0]);
      turn(p);
      assert.deepEqual([total(grapes), total(water), total(unfermented), state().xp], [0, 0, 1, 0],
        diagnostic("SETUP: actual ingredient debit produced one pending jug and no XP"));
      assert.equal(pending.get(p), 20, "SETUP: the real made callback armed the full twenty-pass timer");
      assert.equal(skills.getCurrentLevel(core.Skill.COOKING), 68);

      bank.open();
      assert.equal(Bank.isOpen(p), true, "SETUP: native bank admission");
      Bank.deposits(p, unfermented, inventory.getSlotForItemId(unfermented), 1);
      assert.equal(inventory.getAmount(unfermented), 0, "SETUP: the actual pending jug left inventory");
      assert.equal(tabs.reduce((sum, tab) => sum + tab.getAmount(unfermented), 0), 1);
      assert.equal(Bank.handleWidgetAction(p, {
        groupId: Bank.MAIN_INTERFACE_ID, childId: Bank.FRAME_CHILD, buttonNum: 1, option: "Close",
      }), true);
      assert.equal(Bank.isOpen(p), false, "SETUP: close through the real native bank interface path");
      assert.equal(pending.get(p), 20, "SETUP: no timer pass was invented during banking");
      for (let n = 0; n < 19; n++) turn(p);
      assert.deepEqual([total(unfermented), total(wine), total(bad), state().xp], [1, initialWine, 0, 0],
        diagnostic("SETUP: no fermentation or XP before the deadline"));
      assert.equal(pending.get(p), 1);
      turn(p);
      const observed = state();
      if (!full) assert.equal(observed.delivered, 1, diagnostic("the fitting-output positive control must actually mature"));
      // Count the existing Wine consumer's inventory/bank contents. A pending
      // or actually credited jug conserves the unit; no repair is selected here.
      assert.deepEqual({
        units: observed.pending + observed.delivered + observed.bad,
        bad: observed.bad, xp: observed.xp,
      }, { units: 1, bad: 0, xp: observed.delivered * 200 },
      diagnostic("pending-wine conservation and XP only for actual credited wine"));
    });
  }
});

test('native cooking on a live fire', async suite => {
  const path = require('node:path');
  const previousBots = process.env.DISABLE_PLAYER_BOTS;
  process.env.DISABLE_PLAYER_BOTS = '1';
  let started = false;
  suite.after(() => {
    if (started) PluginManager.emitServerShutdown({});
    if (previousBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = previousBots;
  });
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3226, 3218);
  started = true;
  PluginManager.emitServerStartup({});
  await suite.test('cooked chicken and cooked meat can be deliberately burned on a live fire', async t => {
    const { Player } = require('../dist/game/entity/impl/player/Player');
    const { PlayerSession } = require('../dist/net/PlayerSession');
    const { ClientConnection } = require('../dist/net/NetworkBuilder');
    const { SkillManager } = require('../dist/game/content/skill/SkillManager');
    const Firemaking = require('../plugins/skills/Firemaking.plugin');
    const I = core.ItemIdentifiers, fireId = core.ObjectIdentifiers.FIRE_23;
    assert.equal(fireId, 26185);
    assert.equal(core.WorldDefinition.isMembersWorld(), true);
    const cookTask = submittedCookingTasks.find(task => Number.isInteger(task.cycle));
    assert.ok(cookTask && cookTask.isStopped(), 'the existing native cooking runner is stopped after its earlier test');
    assert.equal(Cooking._test.activeSessions.size, 0, 'earlier cooking sessions are retired');
    core.TaskManager.submit(cookTask);
    t.after(() => { cookTask.stop(); core.TaskManager.process(); });
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
      close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel));
    p.setIndex(3190); p.setUsername('cookfire'); p.setRegistered(true);
    p.setLocation(new core.Location(3226, 3218, 0)); p.needsPlacement = false;
    const c = new ClientConnection(channel); c.player = p;
    const anchor = p.getLocation().clone(), inventory = p.getInventory(), skills = p.getSkillManager();
    for (const skill of [core.Skill.COOKING, core.Skill.FIREMAKING]) {
      skills.setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false)
        .setExperience(skill, SkillManager.getExperienceForLevel(99));
      assert.equal(skills.getCurrentLevel(skill), 99);
    }
    const fires = () => core.ObjectManager.objectsAt(anchor).filter(o =>
      o.getId() === fireId && o.getPrivateArea() === p.getPrivateArea());
    const ownedGround = () => core.World.getItems().filter(g => !g.isPendingRemoval()
      && g.getOwner() === p.getUsername() && g.getPrivateArea() === p.getPrivateArea());
    t.after(() => {
      PluginManager.emitPlayerDisconnect({ player: p, username: p.getUsername() });
      PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
      p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); core.TaskManager.cancelTasks(p);
      for (const g of ownedGround()) core.ItemOnGroundManager.deregister(g);
      for (const fire of fires()) core.ObjectManager.deregister(fire, true);
    });
    const actions = [], emitItemOnObject = PluginManager.emitItemOnObject;
    t.mock.method(PluginManager, 'emitItemOnObject', event => {
      const result = emitItemOnObject.call(PluginManager, event);
      if (event.player === p) actions.push({ itemId: event.itemId, item: event.item, object: event.object,
        slot: event.itemSlot, handled: event.handled, result });
      return result;
    });
    let turns = 0;
    const turn = () => {
      assert.ok(++turns <= 75, 'bounded native phase budget');
      p.resetUpdating(); core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
      core.TaskManager.process(); c.processTurnPackets();
      const q = p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit();
      if (q.hasPendingWork()) q.process();
      core.TaskManager.processWalkTo(p.getIndex());
    };
    for (const id of [I.LOGS, I.TINDERBOX]) inventory.add(new core.Item(id, 1), false);
    assert.equal(fires().length, 0);
    await c.dispatch([{ type: 'inventory_use_on', itemId: I.TINDERBOX, slot: inventory.getSlotForItemId(I.TINDERBOX),
      target: { kind: 'inventory', id: I.LOGS, slot: inventory.getSlotForItemId(I.LOGS) } }]);
    turn();
    assert.equal(Firemaking.isFiremakingActive(p), true, 'real tinderbox/log use starts lighting');
    assert.equal(inventory.getAmount(I.LOGS), 0);
    assert.equal(ownedGround().filter(g => g.getItem().getId() === I.LOGS).length, 1);
    for (let n = 0; n < 8; n++) turn();
    assert.equal(Firemaking.isFiremakingActive(p), false);
    assert.equal(fires().length, 1, 'lighting produced a registered fire');
    const fire = fires()[0];
    assert.equal(core.MapObjects.get(fireId, anchor, p.getPrivateArea()), fire);
    assert.equal(fire.getDefinition().getName(), 'Fire');
    assert.equal(p.getLocation().equals(anchor), false, 'real lighting stepped away');
    turn(); turn();
    assert.equal(p.getMovementQueue().size(), 0);
    assert.equal(p.getMovementQueue().isMovings(), false);
    assert.equal(fire.isWithinInteractionDistance(p.getLocation()), true);
    const useFire = async id => {
      const slot = inventory.getSlotForItemId(id);
      assert.ok(slot >= 0 && inventory.getItems()[slot].getId() === id, 'owned input slot is current');
      const selected = inventory.getItems()[slot], before = actions.length;
      assert.equal(selected.getAmount(), 1);
      assert.equal(selected.isPresetItem(), false);
      assert.equal(core.MapObjects.get(fireId, anchor, p.getPrivateArea()), fire, 'same live fire remains');
      await c.dispatch([{ type: 'item_on_object', widgetId: core.Inventory.INTERFACE_ID,
        objectId: fireId, itemId: id, slot, x: anchor.getX(), y: anchor.getY() }]);
      for (let n = 0; n < 8 && actions.length === before; n++) turn();
      assert.deepEqual(actions.slice(before), [{ itemId: id, item: selected, object: fire, slot, handled: true, result: true }],
        'decoded use reaches the registered consumer with the selected item and live fire');
    };
    const awaitOutput = id => { for (let n = 0; n < 8 && inventory.getAmount(id) === 0; n++) turn(); };
    inventory.add(new core.Item(I.RAW_BEEF, 1), false);
    await useFire(I.RAW_BEEF); assert.equal(Cooking.isCookingActive(p), true, 'raw beef admits cooking');
    awaitOutput(I.COOKED_MEAT);
    assert.equal(inventory.getAmount(I.RAW_BEEF), 0);
    assert.equal(inventory.getAmount(I.COOKED_MEAT), 1, 'native raw beef produced cooked meat');
    turn();
    const meatXp = skills.getExperience(core.Skill.COOKING);
    await useFire(I.COOKED_MEAT); assert.equal(Cooking.isCookingActive(p), true, 'cooked meat admits reburning');
    awaitOutput(I.BURNT_MEAT);
    assert.equal(inventory.getAmount(I.COOKED_MEAT), 0);
    assert.equal(inventory.getAmount(I.BURNT_MEAT), 1, 'same fire burns cooked meat');
    assert.equal(skills.getExperience(core.Skill.COOKING), meatXp, 'existing deliberate-meat path awards no XP');
    turn();
    inventory.add(new core.Item(I.RAW_CHICKEN, 1), false);
    await useFire(I.RAW_CHICKEN); assert.equal(Cooking.isCookingActive(p), true, 'raw chicken admits cooking');
    awaitOutput(I.COOKED_CHICKEN);
    assert.equal(inventory.getAmount(I.RAW_CHICKEN), 0);
    assert.equal(inventory.getAmount(I.COOKED_CHICKEN), 1, 'native raw chicken produced cooked chicken');
    assert.equal(inventory.getAmount(I.BURNT_CHICKEN), 0);
    turn();
    const chickenXp = skills.getExperience(core.Skill.COOKING);
    const sender = p.getPacketSender(), sendTypedMessage = sender.sendTypedMessage;
    const chickenMessages = [];
    t.mock.method(sender, 'sendTypedMessage', function (type, text, ...rest) {
      if (type === core.ChatType.SPAM) chickenMessages.push(text);
      return sendTypedMessage.call(this, type, text, ...rest);
    });
    await useFire(I.COOKED_CHICKEN);
    awaitOutput(I.BURNT_CHICKEN);
    assert.deepEqual([inventory.getAmount(I.COOKED_CHICKEN), inventory.getAmount(I.BURNT_CHICKEN)], [0, 1],
      'cooked chicken used on a fire becomes burnt chicken');
    assert.equal(skills.getExperience(core.Skill.COOKING), chickenXp, 'deliberately burnt chicken awards no Cooking XP');
    assert.equal(chickenMessages.filter(text => text === 'You deliberately burn the nicely cooked chicken.').length, 1,
      'the chicken burn message is sent on the spam channel');
  });
  await suite.test('ordinary seaweed used on a live fire produces soda ash', async t => {
    const { Player } = require('../dist/game/entity/impl/player/Player');
    const { PlayerSession } = require('../dist/net/PlayerSession');
    const { ClientConnection } = require('../dist/net/NetworkBuilder');
    const { SkillManager } = require('../dist/game/content/skill/SkillManager');
    const Firemaking = require('../plugins/skills/Firemaking.plugin');
    const I = core.ItemIdentifiers, fireId = core.ObjectIdentifiers.FIRE_23;
    assert.equal(fireId, 26185);
    assert.equal(core.WorldDefinition.isMembersWorld(), true);
    const cookTask = submittedCookingTasks.find(task => Number.isInteger(task.cycle));
    assert.ok(cookTask && cookTask.isStopped(), 'the existing native cooking runner is stopped after its earlier test');
    assert.equal(Cooking._test.activeSessions.size, 0, 'earlier cooking sessions are retired');
    core.TaskManager.submit(cookTask);
    t.after(() => { cookTask.stop(); core.TaskManager.process(); });
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
      close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel));
    p.setIndex(3191); p.setUsername('seaweed'); p.setRegistered(true);
    p.setLocation(new core.Location(3226, 3218, 0)); p.needsPlacement = false;
    const c = new ClientConnection(channel); c.player = p;
    const anchor = p.getLocation().clone(), inventory = p.getInventory(), skills = p.getSkillManager();
    for (const skill of [core.Skill.COOKING, core.Skill.FIREMAKING]) {
      skills.setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false)
        .setExperience(skill, SkillManager.getExperienceForLevel(99));
      assert.equal(skills.getCurrentLevel(skill), 99);
    }
    const fires = () => core.ObjectManager.objectsAt(anchor).filter(o =>
      o.getId() === fireId && o.getPrivateArea() === p.getPrivateArea());
    const ownedGround = () => core.World.getItems().filter(g => !g.isPendingRemoval()
      && g.getOwner() === p.getUsername() && g.getPrivateArea() === p.getPrivateArea());
    t.after(() => {
      PluginManager.emitPlayerDisconnect({ player: p, username: p.getUsername() });
      PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
      p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); core.TaskManager.cancelTasks(p);
      for (const g of ownedGround()) core.ItemOnGroundManager.deregister(g);
      for (const fire of fires()) core.ObjectManager.deregister(fire, true);
    });
    const actions = [], emitItemOnObject = PluginManager.emitItemOnObject;
    t.mock.method(PluginManager, 'emitItemOnObject', event => {
      const result = emitItemOnObject.call(PluginManager, event);
      if (event.player === p) actions.push({ itemId: event.itemId, item: event.item, object: event.object,
        slot: event.itemSlot, handled: event.handled, result });
      return result;
    });
    let turns = 0;
    const turn = () => {
      assert.ok(++turns <= 75, 'bounded native phase budget');
      p.resetUpdating(); core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
      core.TaskManager.process(); c.processTurnPackets();
      const q = p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit();
      if (q.hasPendingWork()) q.process();
      core.TaskManager.processWalkTo(p.getIndex());
    };
    for (const id of [I.LOGS, I.TINDERBOX]) inventory.add(new core.Item(id, 1), false);
    assert.equal(fires().length, 0);
    await c.dispatch([{ type: 'inventory_use_on', itemId: I.TINDERBOX, slot: inventory.getSlotForItemId(I.TINDERBOX),
      target: { kind: 'inventory', id: I.LOGS, slot: inventory.getSlotForItemId(I.LOGS) } }]);
    turn();
    assert.equal(Firemaking.isFiremakingActive(p), true, 'real tinderbox/log use starts lighting');
    assert.equal(inventory.getAmount(I.LOGS), 0);
    assert.equal(ownedGround().filter(g => g.getItem().getId() === I.LOGS).length, 1);
    for (let n = 0; n < 8; n++) turn();
    assert.equal(Firemaking.isFiremakingActive(p), false);
    assert.equal(fires().length, 1, 'lighting produced a registered fire');
    const fire = fires()[0];
    assert.equal(core.MapObjects.get(fireId, anchor, p.getPrivateArea()), fire);
    assert.equal(fire.getDefinition().getName(), 'Fire');
    assert.equal(p.getLocation().equals(anchor), false, 'real lighting stepped away');
    turn(); turn();
    assert.equal(p.getMovementQueue().size(), 0);
    assert.equal(p.getMovementQueue().isMovings(), false);
    assert.equal(fire.isWithinInteractionDistance(p.getLocation()), true);
    const useFire = async id => {
      const slot = inventory.getSlotForItemId(id);
      assert.ok(slot >= 0 && inventory.getItems()[slot].getId() === id, 'owned input slot is current');
      const selected = inventory.getItems()[slot], before = actions.length;
      assert.equal(selected.getAmount(), 1);
      assert.equal(selected.isPresetItem(), false);
      assert.equal(core.MapObjects.get(fireId, anchor, p.getPrivateArea()), fire, 'same live fire remains');
      await c.dispatch([{ type: 'item_on_object', widgetId: core.Inventory.INTERFACE_ID,
        objectId: fireId, itemId: id, slot, x: anchor.getX(), y: anchor.getY() }]);
      for (let n = 0; n < 8 && actions.length === before; n++) turn();
      assert.deepEqual(actions.slice(before), [{ itemId: id, item: selected, object: fire, slot, handled: true, result: true }],
        'decoded use reaches the registered consumer with the selected item and live fire');
    };
    const awaitOutput = id => { for (let n = 0; n < 8 && inventory.getAmount(id) === 0; n++) turn(); };
    inventory.add(new core.Item(I.RAW_BEEF, 1), false);
    await useFire(I.RAW_BEEF); assert.equal(Cooking.isCookingActive(p), true, 'raw beef admits cooking');
    awaitOutput(I.COOKED_MEAT);
    assert.equal(inventory.getAmount(I.RAW_BEEF), 0);
    assert.equal(inventory.getAmount(I.COOKED_MEAT), 1, 'native raw beef produced cooked meat on this fire');
    turn();
    assert.equal(I.SEAWEED, 401);
    assert.equal(I.SODA_ASH, 1781);
    for (const [id, name] of [[I.SEAWEED, 'Seaweed'], [I.SODA_ASH, 'Soda ash']]) {
      const definition = new core.Item(id, 1).getDefinition();
      assert.equal(definition.getName(), name, 'the active cache resolves the ordinary item');
      assert.equal(definition.isNoted(), false);
      assert.equal(definition.isStackable(), false);
    }
    inventory.add(new core.Item(I.SEAWEED, 1), false);
    assert.equal(inventory.getAmount(I.SEAWEED), 1);
    assert.equal(inventory.getAmount(I.SODA_ASH), 0);
    assert.ok(inventory.getAddableAmount(new core.Item(I.SODA_ASH, 1)) >= 1, 'soda ash has inventory room');
    const seaweedXp = skills.getExperience(core.Skill.COOKING);
    await useFire(I.SEAWEED);
    awaitOutput(I.SODA_ASH);
    assert.deepEqual([inventory.getAmount(I.SEAWEED), inventory.getAmount(I.SODA_ASH)], [0, 1],
      'ordinary seaweed used on a fire becomes soda ash');
    assert.equal(skills.getExperience(core.Skill.COOKING), seaweedXp, 'producing soda ash awards no Cooking XP');
  });
});
