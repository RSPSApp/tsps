// Run after `yarn build`: node --test tests/smithing.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { Skill } = require("../dist/game/model/Skill");
const { ChatType } = require("../dist/net/protocol/ClientProtocol");
const Smithing = require("../plugins/skills/Smithing.plugin");
const Anvil = require("../plugins/skills/smithing/Anvil.Smithing");
const Superheat = require("../plugins/skills/smithing/Superheat.Smithing");

const buttons = new Map(), objects = new Map(), itemActions = new Map(), events = new Map(), tasks = [], players = [];
const successEvents = [];
let disconnect, itemOnObject, CacheDefinitions;
const extraItemOnObject = [], startups = [];
let denyAnvil = false;
function registerSmithing() {
  Smithing.register({
    core: PluginManager.getCoreApi(),
    getTaskManager: () => ({ submit(task) { task.setRunning(true); tasks.push(task); } }),
    onPlayerDisconnect: handler => { disconnect = handler; },
    onCustomEvent: (name, handler) => events.set(name, [...(events.get(name) ?? []), handler]),
    emitCustomEvent(name, request) {
      if (name === "smithing:success") successEvents.push(request);
      if (name === "smithing:anvil-access") request.denied = denyAnvil;
      if (name === "quest:is-complete") request.complete = request.player.quests?.has(request.key) ?? false;
      for (const handler of events.get(name) ?? []) handler(request);
    },
    persistAttribute() {},
    onServerStartup: handler => startups.push(handler),
    onItemAction: (name, actions) => itemActions.set(name, actions),
    onItemOnObject: (handler) => { if (!itemOnObject) itemOnObject = handler; else extraItemOnObject.push(handler); },
    onItemOnItem() {}, onSpellOnItem() {}, log() {},
    onObjectInteraction: (name, actions) => objects.set(name, actions),
    onInterfaceActionButton: (ids, handler) => { for (const id of ids) buttons.set(id, handler); },
  });
}
before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  ({ CacheDefinitions } = require("../dist/game/cache/CacheDefinitions"));
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  registerSmithing();
  for (const startup of startups) startup();
});
afterEach(() => { for (const player of players.splice(0)) disconnect({ player }); });

function playerWith(barId = I.BRONZE_BAR, bars = 27) {
  const items = new Map([[I.HAMMER, 1], [barId, bars]]);
  const player = { items, xp: 0, level: 99, moving: false, interfaceId: -1, messages: [], spam: [], sent: [], statements: [], equipped: new Map() };
  const sender = new Proxy({}, { get: (_, name) => (...args) => {
    player.sent.push([name, ...args]);
    if (name === "sendTypedMessage" && args[0] === ChatType.SPAM) player.spam.push(args[1]);
    return sender;
  } });
  Object.assign(player, {
    getInventory: () => ({
      contains: id => (items.get(id) ?? 0) > 0,
      getAmount: id => items.get(id) ?? 0,
      deleteNumber: (id, n) => items.set(id, items.get(id) - n),
      addItem: item => items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()),
    }),
    getEquipment: () => ({
      get: slot => player.equipped.has(slot) ? { getId: () => player.equipped.get(slot) } : null,
      contains: id => [...player.equipped.values()].includes(id),
      set: (slot, item) => item.getId() < 0 ? player.equipped.delete(slot) : player.equipped.set(slot, item.getId()),
      refreshItems() {},
    }),
    getAttribute: key => player.attributes?.[key],
    setAttribute: (key, value) => { (player.attributes ??= {})[key] = value; },
    getSkillManager: () => ({
      getCurrentLevel: () => player.level,
      addExperiences: (skill, xp) => { player.xpSkill = skill; player.xp += xp; },
    }),
    getDialogueManager: () => ({ startDialogues: chain => player.statements.push(chain), reset() {} }),
    getPacketSender: () => sender,
    getInterfaceId: () => player.interfaceId,
    setInterfaceId: id => { player.interfaceId = id; },
    setEnteredAmountAction: action => { player.amountAction = action; },
    getMovementQueue: () => ({ size: () => player.moving ? 1 : 0 }),
    getLocation: () => new (PluginManager.getCoreApi().Location)(0, 0, 0),
    getForceMovement: () => null, isRegistered: () => true, getHitpoints: () => 99,
    performAnimation(animation) { player.animation = animation?.getId?.(); player.animationDelay = animation?.getDelay?.(); },
    sendMessage(message) { player.messages.push(message); },
  });
  players.push(player);
  return player;
}
function click(player, component) {
  const buttonId = (312 << 16) | component;
  return buttons.get(buttonId)({ player, buttonId });
}
function open(player) { objects.get("Anvil").Smith({ player }); }
function ticks(count = 140) {
  for (let i = 0; i < count; i++) {
    for (const task of [...tasks]) if (!task.tick()) tasks.splice(tasks.indexOf(task), 1);
  }
}
const sent = (player, name) => player.sent.filter(([sentName]) => sentName === name).map(([, ...args]) => args);
const lastMenu = player => sent(player, "sendCreationMenu").at(-1)?.[0];
const statementText = player => player.statements.at(-1)?.getDialogues().get(0)?.getText();

for (const [label, component, quantity] of [["1", 3, 1], ["5", 4, 5], ["10", 5, 10], ["X", 6, 3], ["All", 7, 27]]) {
  test(`${label} remains selected after making items and reopening the anvil`, () => {
    const player = playerWith();
    open(player);
    click(player, component);
    if (label === "X") player.amountAction.execute(quantity);
    click(player, 9);
    ticks();
    assert.equal(player.items.get(I.BRONZE_DAGGER), quantity);
    player.items.set(I.BRONZE_BAR, 27);
    open(player);
    assert.equal(sent(player, "sendConfig").at(-1)[1], label === "All" ? 27 : quantity);
    click(player, 9);
    ticks();
    assert.equal(player.items.get(I.BRONZE_DAGGER), quantity * 2);
    assert.equal(player.xp, quantity * 2 * 12.5);
  });
}

test("opening the anvil preselects All, matching the quantity the server will smith", () => {
  const player = playerWith(I.BRONZE_BAR, 27);
  open(player);
  assert.deepEqual(sent(player, "sendConfig").at(-1), [CacheDefinitions.getVarpId("makexcrafting"), 27]);
  click(player, 9);
  ticks();
  assert.equal(player.items.get(I.BRONZE_DAGGER), 27);
});

test("walking closes the menu without clearing the selected quantity", () => {
  const player = playerWith();
  open(player);
  click(player, 7);
  player.moving = true;
  ticks(1);
  assert.equal(player.interfaceId, -1);
  player.moving = false;
  open(player);
  click(player, 9);
  ticks();
  assert.equal(player.items.get(I.BRONZE_DAGGER), 27);
});

test("disconnect clears the selection, and players do not share quantity state", () => {
  const first = playerWith(), second = playerWith();
  open(first);
  click(first, 4);
  open(second);
  click(second, 3);
  click(second, 9);
  ticks();
  assert.equal(second.items.get(I.BRONZE_DAGGER), 1);
  disconnect({ player: first });
  open(first);
  click(first, 9);
  ticks();
  assert.equal(first.items.get(I.BRONZE_DAGGER), 27, "the remembered 5 was cleared; All is the default again");
});

test("invalid X input preserves the previous selection", () => {
  const player = playerWith();
  open(player);
  click(player, 4);
  click(player, 6);
  for (const amount of [0, -1, 1.5, NaN]) player.amountAction.execute(amount);
  click(player, 9);
  ticks();
  assert.equal(player.items.get(I.BRONZE_DAGGER), 5);
});

test("anvil XP follows the metal and bars consumed, including multi-item recipes", () => {
  // OSRS Wiki Smithing tables: one bar's XP is independent of the product's output count.
  for (const [bar, xp] of [[I.BRONZE_BAR, 12.5], [I.IRON_BAR, 25], [I.STEEL_BAR, 37.5],
    [I.MITHRIL_BAR, 50], [I.ADAMANTITE_BAR, 62.5], [I.RUNITE_BAR, 75]]) {
    for (const [component, bars] of [[9, 1], [11, 2], [22, 5], [30, 1]]) {
      const player = playerWith(bar, bars);
      open(player);
      assert.equal(click(player, component), true);
      ticks(4);
      assert.equal(player.items.get(bar), 0);
      assert.equal(player.xp, xp * bars, `bar ${bar}, component ${component}`);
    }
  }
});

test("missing hammer, level, or bars preserves inventory and grants no XP", () => {
  for (const change of [p => p.items.delete(I.HAMMER), p => { p.level = 1; },
    p => p.items.set(I.BRONZE_BAR, 4)]) {
    const player = playerWith();
    change(player);
    const before = new Map(player.items);
    open(player);
    assert.equal(click(player, 22), false);
    ticks();
    assert.deepEqual(player.items, before);
    assert.equal(player.xp, 0);
  }
});

test("anvil access rules cover Smith and using bars without consuming anything", () => {
  const player = playerWith(), before = new Map(player.items);
  denyAnvil = true;
  try {
    open(player);
    assert.equal(player.interfaceId, -1);
    const event = { player, itemId: I.BRONZE_BAR, object: { getDefinition: () => ({ getName: () => "Anvil" }) } };
    itemOnObject(event);
    assert.equal(event.handled, true);
    assert.equal(player.interfaceId, -1);
    assert.deepEqual(player.items, before);
    assert.equal(player.xp, 0);
  } finally { denyAnvil = false; }
  open(player);
  assert.equal(player.interfaceId, 312);
});

test("the rusted anvil only works bronze and ignores other items", () => {
  const rusted = { getDefinition: () => ({ getName: () => "Rusted anvil" }) };
  const iron = playerWith(I.IRON_BAR);
  objects.get("Rusted anvil").Smith({ player: iron });
  assert.equal(iron.interfaceId, -1);
  const ironOnAnvil = { player: iron, itemId: I.IRON_BAR, object: rusted };
  itemOnObject(ironOnAnvil);
  assert.equal(ironOnAnvil.handled, true);
  assert.equal(iron.interfaceId, -1);
  const hammerOnAnvil = { player: iron, itemId: I.HAMMER, object: rusted };
  itemOnObject(hammerOnAnvil);
  assert.equal(hammerOnAnvil.handled, undefined);

  const bronze = playerWith();
  objects.get("Rusted anvil").Smith({ player: bronze });
  assert.equal(bronze.interfaceId, 312);
});

// Captured (rsprox, recs 1610, 3461, 1757, 96): the click closes the interface on its tick, the first
// item comes 3 ticks later and the next every 5, each with "You hammer the <metal> and make ..." on
// the spam channel and human_smithing 15 client cycles into the tick.
test("anvil timing, messages and the last-made varbits follow the captures", () => {
  const player = playerWith(I.STEEL_BAR, 3);
  player.quests = new Set(["the_tourist_trap"]);
  open(player);
  assert.deepEqual(sent(player, "sendConfig").at(-1), [CacheDefinitions.getVarpId("makexcrafting"), 3]);
  click(player, 5);
  click(player, 29);
  assert.equal(player.interfaceId, -1);
  const varbits = new Map(sent(player, "sendVarbit"));
  assert.equal(varbits.get(CacheDefinitions.getVarbitId("smithing_bar_lasttype")), 3);
  assert.equal(varbits.get(CacheDefinitions.getVarbitId("smithing_item_lasttype")), 21);
  ticks(3);
  assert.equal(player.items.get(I.STEEL_DART_TIP) ?? 0, 0);
  ticks(1);
  assert.equal(player.items.get(I.STEEL_DART_TIP), 10);
  assert.equal(player.spam.at(-1), "You hammer the steel and make ten dart tips.");
  assert.equal(player.animation, CacheDefinitions.getSeqId("human_smithing"));
  assert.equal(player.animationDelay, 15);
  ticks(4);
  assert.equal(player.items.get(I.STEEL_DART_TIP), 10);
  ticks(1);
  assert.equal(player.items.get(I.STEEL_DART_TIP), 20);
});

test("anvil smithing succeeds without station provenance when the interaction has no object", () => {
  const player = playerWith(I.BRONZE_BAR, 1);
  const before = successEvents.length;
  open(player);
  click(player, 9);
  ticks(4);
  const event = successEvents.slice(before).find(candidate => candidate.player === player);
  assert.ok(event);
  assert.equal(event.itemId, I.BRONZE_DAGGER);
  assert.equal(Object.hasOwn(event, "stationObjectId"), false);
  assert.equal(Object.hasOwn(event, "location"), false);
});

// Captured (rsprox, rec 68): a product above the player's level closes the interface with a message
// box naming it in title case.
test("a product above the player's level is refused in a message box", () => {
  const player = playerWith(I.BRONZE_BAR, 5);
  player.level = 1;
  open(player);
  assert.equal(click(player, 25), false);
  assert.equal(player.interfaceId, -1);
  const text = player.statements.at(-1).getDialogues().get(0).getText();
  assert.equal(text, "You need a Smithing level of 7 to make a Bronze Full Helm.");
  assert.equal(player.messages.length, 0);
});

test("Smith with no bar opens a message box instead of the interface", () => {
  const player = playerWith(I.COAL, 1);
  open(player);
  assert.equal(player.interfaceId, -1);
  assert.equal(player.statements.length, 1);
});

test("quest-gated products need their quest", () => {
  const player = playerWith(I.BRONZE_BAR, 4);
  open(player);
  assert.equal(click(player, 18), false);
  assert.match(player.messages.at(-1), /Death Plateau/);
  player.quests = new Set(["death_plateau"]);
  open(player);
  assert.equal(click(player, 18), true);
  ticks(4);
  assert.equal(player.items.get(I.BRONZE_CLAWS), 1);
});

test("a wielded Imcando hammer works the anvil", () => {
  const player = playerWith();
  player.items.delete(I.HAMMER);
  player.equipped.set(3, I.IMCANDO_HAMMER);
  open(player);
  assert.equal(click(player, 9), true);
  ticks(4);
  assert.equal(player.items.get(I.BRONZE_DAGGER), 1);
});

// Smelting: the shared CreationMenu lists every bar; captured timing is 4 ticks to the bar,
// 5 between bars, with "You smelt ..." on the choosing tick.
function furnaceWith(entries) {
  const player = playerWith(I.HAMMER, 1);
  for (const [id, amount] of entries) player.items.set(id, amount);
  return player;
}
const furnace = { getDefinition: () => ({ getName: () => "Furnace" }) };

test("Smelt lists every bar, and smelts on the captured timing", () => {
  const player = furnaceWith([[I.COPPER_ORE, 2], [I.TIN_ORE, 2]]);
  objects.get("Furnace").Smelt({ player });
  const menu = lastMenu(player);
  assert.equal(menu.getTitle(), "What would you like to smelt?");
  assert.deepEqual(menu.getItems(), [I.BRONZE_BAR, I.BLURITE_BAR, I.IRON_BAR, I.SILVER_BAR, I.LEAD_BAR, I.STEEL_BAR,
    I.GOLD_BAR, I.MITHRIL_BAR, I.ADAMANTITE_BAR, I.CUPRONICKEL_BAR, I.RUNITE_BAR]);
  menu.execute(I.BRONZE_BAR, 2);
  ticks(1);
  assert.equal(player.spam.at(-1), "You smelt the copper and tin together in the furnace.");
  assert.equal(player.animation, CacheDefinitions.getSeqId("human_furnace"));
  ticks(3);
  assert.equal(player.items.get(I.BRONZE_BAR) ?? 0, 0);
  player.animation = null;
  ticks(1);
  assert.equal(player.items.get(I.BRONZE_BAR), 1);
  assert.equal(player.spam.at(-1), "You retrieve a bar of bronze.");
  assert.equal(player.animation, CacheDefinitions.getSeqId("human_furnace"), "the bar comes out with human_furnace again");
  assert.equal(player.xp, 6.2);
  ticks(5);
  assert.equal(player.items.get(I.BRONZE_BAR), 2);
});

test("lead and cupronickel stay out of F2P furnace menus and direct starts", (t) => {
  t.mock.method(PluginManager.getCoreApi().WorldDefinition, "isMembersWorld", () => false);
  const player = furnaceWith([[I.LEAD_ORE, 2], [I.NICKEL_ORE, 1], [I.COPPER_ORE, 2]]);
  objects.get("Furnace").Smelt({ player });
  const listed = lastMenu(player).getItems();
  assert.ok(!listed.includes(I.LEAD_BAR) && !listed.includes(I.CUPRONICKEL_BAR));
  const Smelting = require("../plugins/skills/smithing/Smelting.Smithing");
  const Data = require("../plugins/skills/smithing/Data.Smithing");
  for (const id of [I.LEAD_BAR, I.CUPRONICKEL_BAR]) {
    assert.equal(Smelting.startSmelting(player, Data.SMELTING_RECIPES.find((r) => r.barId === id), 1), false);
  }
  assert.equal(player.items.get(I.LEAD_ORE), 2);
  assert.equal(player.xp, 0);
});

test("Smelt with no ore says so in a message box", () => {
  const player = furnaceWith([[I.COAL, 5]]);
  objects.get("Furnace").Smelt({ player });
  assert.equal(lastMenu(player), undefined);
  assert.equal(player.statements.length, 1);
});

test("too low a level is a message box; impure iron is lost", (t) => {
  const low = furnaceWith([[I.GOLD_ORE, 1]]);
  low.level = 39;
  objects.get("Furnace").Smelt({ player: low });
  lastMenu(low).execute(I.GOLD_BAR, 1);
  ticks(6);
  assert.equal(low.items.get(I.GOLD_ORE), 1);
  assert.equal(low.statements.length, 1);

  t.mock.method(Math, "random", () => 0.9);
  const player = furnaceWith([[I.IRON_ORE, 1]]);
  objects.get("Furnace").Smelt({ player });
  lastMenu(player).execute(I.IRON_BAR, 1);
  ticks(6);
  assert.equal(player.items.get(I.IRON_ORE), 0);
  assert.equal(player.items.get(I.IRON_BAR) ?? 0, 0);
  assert.equal(player.spam.at(-1), "The ore is too impure and you fail to refine it.");
  assert.equal(player.xp, 0);
});

test("ore used on a furnace opens the Smelt menu; sand opens molten glass", () => {
  const player = furnaceWith([[I.IRON_ORE, 2]]);
  const event = { player, itemId: I.IRON_ORE, object: furnace };
  itemOnObject(event);
  assert.equal(event.handled, true);
  assert.equal(lastMenu(player).getTitle(), "What would you like to smelt?");
  assert.equal(player.items.get(I.IRON_ORE), 2);

  const glass = furnaceWith([[I.BUCKET_OF_SAND, 1], [I.SODA_ASH, 1]]);
  itemOnObject({ player: glass, itemId: I.BUCKET_OF_SAND, object: furnace });
  assert.deepEqual(lastMenu(glass).getItems(), [I.MOLTEN_GLASS]);
  lastMenu(glass).execute(I.MOLTEN_GLASS, 1);
  ticks(6);
  assert.equal(glass.items.get(I.MOLTEN_GLASS), 1);
  assert.equal(glass.items.get(I.BUCKET), 1);
  assert.equal(glass.xpSkill, Skill.CRAFTING);
});

test('using the only ore on a furnace smelts an unambiguous single bar without a quantity menu', t => {
  t.mock.method(Math, 'random', () => 0);
  for (const [ore, bar] of [[I.IRON_ORE, I.IRON_BAR], [I.SILVER_ORE, I.SILVER_BAR], [I.GOLD_ORE, I.GOLD_BAR]]) {
    const player = furnaceWith([[ore, 1]]);
    const event = { player, itemId: ore, object: furnace };
    itemOnObject(event);
    assert.equal(event.handled, true);
    assert.equal(lastMenu(player), undefined);
    assert.equal(player.items.get(ore), 1, 'the normal smelting delay is preserved');
    ticks(6);
    assert.equal(player.items.get(ore), 0);
    assert.equal(player.items.get(bar), 1);
    ticks(6);
    assert.equal(player.items.get(bar), 1);
  }
});

test('single-ore shortcuts preserve ordinary Smelt, mixed ores, coal bags and level requirements', () => {
  const ordinary = furnaceWith([[I.IRON_ORE, 1]]);
  objects.get('Furnace').Smelt({ player: ordinary });
  assert.ok(lastMenu(ordinary), 'left-click Smelt retains its menu');
  for (const ingredients of [[[I.IRON_ORE, 1], [I.COAL, 2]], [[I.GOLD_ORE, 1], [I.SILVER_ORE, 1]]]) {
    const player = furnaceWith(ingredients);
    itemOnObject({ player, itemId: ingredients[0][0], object: furnace });
    assert.ok(lastMenu(player), 'multiple ores retain their menu');
  }
  const extras = furnaceWith([[I.IRON_ORE, 1], [I.STEEL_BAR, 1], [I.AMMO_MOULD, 1]]);
  itemOnObject({ player: extras, itemId: I.IRON_ORE, object: furnace });
  assert.ok(lastMenu(extras).getItems().includes(I.STEEL_CANNONBALL), 'other furnace products remain a choice');
  const perfect = furnaceWith([[I.PERFECT_GOLD_ORE, 1]]);
  itemOnObject({ player: perfect, itemId: I.PERFECT_GOLD_ORE, object: furnace });
  assert.deepEqual(lastMenu(perfect).getItems(), [I.PERFECT_GOLD_BAR], 'quest-specific off-menu recipes retain their path');
  const bag = furnaceWith([[I.IRON_ORE, 1]]);
  const api = require('../plugins/skills/smithing/Core.Smithing').api;
  const emit = api.emitCustomEvent;
  api.emitCustomEvent = (name, event) => {
    if (name === 'storage:amount' && event.itemId === I.COAL) event.amount = 2;
    else emit(name, event);
  };
  try {
    itemOnObject({ player: bag, itemId: I.IRON_ORE, object: furnace });
    assert.ok(lastMenu(bag), 'stored coal keeps the iron/steel choice');
  } finally { api.emitCustomEvent = emit; }
  const low = furnaceWith([[I.GOLD_ORE, 1]]);
  low.level = 1;
  itemOnObject({ player: low, itemId: I.GOLD_ORE, object: furnace });
  ticks(6);
  assert.equal(low.items.get(I.GOLD_ORE), 1);
  assert.equal(low.items.get(I.GOLD_BAR) ?? 0, 0);
  assert.match(statementText(low), /Smithing level of 40/);
});

test("blurite needs The Knight's Sword", () => {
  const player = furnaceWith([[I.BLURITE_ORE, 1]]);
  objects.get("Furnace").Smelt({ player });
  lastMenu(player).execute(I.BLURITE_BAR, 1);
  ticks(6);
  assert.equal(player.items.get(I.BLURITE_BAR) ?? 0, 0);
  player.quests = new Set(["the_knights_sword"]);
  lastMenu(player).execute(I.BLURITE_BAR, 1);
  ticks(6);
  assert.equal(player.items.get(I.BLURITE_BAR), 1);
  assert.equal(player.xp, 8);
});

// Cannonballs (Wiki): 4 a bar in an ammo mould, 8 for two bars in a double mould, 8 ticks then 10.
test("cannonballs pour from bars in an ammo mould after Dwarf Cannon", () => {
  const player = furnaceWith([[I.STEEL_BAR, 3], [I.AMMO_MOULD, 1]]);
  objects.get("Furnace").Smelt({ player });
  assert.ok(lastMenu(player).getItems().includes(I.STEEL_CANNONBALL));
  lastMenu(player).execute(I.STEEL_CANNONBALL, 2);
  ticks(10);
  assert.equal(player.items.get(I.STEEL_CANNONBALL) ?? 0, 0);
  assert.match(player.messages.at(-1), /Dwarf Cannon/);

  player.quests = new Set(["dwarf_cannon"]);
  itemOnObject({ player, itemId: I.STEEL_BAR, object: furnace });
  assert.deepEqual(lastMenu(player).getItems(), [I.STEEL_CANNONBALL]);
  lastMenu(player).execute(I.STEEL_CANNONBALL, 2);
  ticks(8);
  assert.equal(player.items.get(I.STEEL_CANNONBALL) ?? 0, 0);
  ticks(1);
  assert.equal(player.items.get(I.STEEL_CANNONBALL), 4);
  assert.equal(player.xp, 25.6);
  ticks(10);
  assert.equal(player.items.get(I.STEEL_CANNONBALL), 8);
  assert.equal(player.items.get(I.STEEL_BAR), 1);

  const double = furnaceWith([[I.MITHRIL_BAR, 3], [I.DOUBLE_AMMO_MOULD, 1]]);
  double.quests = new Set(["dwarf_cannon"]);
  itemOnObject({ player: double, itemId: I.MITHRIL_BAR, object: furnace });
  lastMenu(double).execute(I.MITHRIL_CANNONBALL, 5);
  ticks(40);
  assert.equal(double.items.get(I.MITHRIL_CANNONBALL), 12);
  assert.equal(double.items.get(I.MITHRIL_BAR), 0);
  assert.equal(double.xp, 34 * 3);
});

test("Shayzien armour from lovakite and keel parts after Pandemonium use the Wiki experience", () => {
  const lovakite = playerWith(I.LOVAKITE_BAR, 4);
  open(lovakite);
  assert.equal(click(lovakite, 13), true); // Platebody (1): 4 bars, 240 XP
  ticks(4);
  assert.equal(lovakite.items.get(I.SHAYZIEN_PLATEBODY_1_), 1);
  assert.equal(lovakite.xp, 240);

  const keel = playerWith(I.STEEL_BAR, 5);
  keel.quests = new Set(["pandemonium"]);
  open(keel);
  assert.equal(click(keel, 36), true);
  ticks(4);
  assert.equal(keel.items.get(I.STEEL_BAR), 0);
  assert.equal(keel.xp, 187.5);
  assert.equal(keel.spam.at(-1), "You hammer the steel and make some keel parts.");
});

test("the Lovakite furnace smelts lovakite, which other furnaces don't offer", () => {
  const player = furnaceWith([[I.LOVAKITE_ORE, 1], [I.COAL, 2]]);
  objects.get("Lovakite furnace").Smelt({ player });
  assert.deepEqual(lastMenu(player).getItems(), [I.LOVAKITE_BAR]);
  lastMenu(player).execute(I.LOVAKITE_BAR, 1);
  ticks(6);
  assert.equal(player.items.get(I.LOVAKITE_BAR), 1);
  assert.equal(player.xp, 20);
  assert.ok(!Smithing.SMELTING_RECIPES.filter((r) => !r.notInMenu).some((r) => r.barId === I.LOVAKITE_BAR));
});

test("a blurite bar on an anvil opens blurite bolts and limbs", () => {
  const player = playerWith(I.BLURITE_BAR, 2);
  player.quests = new Set(["the_knights_sword"]);
  itemOnObject({ player, itemId: I.BLURITE_BAR, object: { getDefinition: () => ({ getName: () => "Anvil" }) } });
  assert.deepEqual(lastMenu(player).getItems(), [I.BLURITE_BOLTS_UNF_, I.BLURITE_LIMBS]);
  lastMenu(player).execute(I.BLURITE_LIMBS, 1);
  ticks(4);
  assert.equal(player.items.get(I.BLURITE_LIMBS), 1);
  assert.equal(player.xp, 17.5);
});

// Wiki: a worn ring of forging makes iron certain, a charge an ore, 140 charges; Varrock armour
// smelts two bars 10% of the time at the Edgeville furnace.
test("a ring of forging makes iron certain and melts after its charges", (t) => {
  t.mock.method(Math, "random", () => 0.9);
  const player = furnaceWith([[I.IRON_ORE, 3]]);
  player.equipped.set(12, I.RING_OF_FORGING);
  player.attributes = { "smithing:ring-of-forging-charges": 2 };
  objects.get("Furnace").Smelt({ player, objectId: 1 });
  lastMenu(player).execute(I.IRON_BAR, 3);
  ticks(20);
  assert.equal(player.items.get(I.IRON_BAR), 2);
  assert.equal(player.equipped.has(12), false);
  assert.match(player.messages.join("\n"), /Ring of Forging has melted/);
  assert.equal(player.attributes["smithing:ring-of-forging-charges"], 140);
  assert.equal(player.spam.at(-1), "The ore is too impure and you fail to refine it.");
});

test("Varrock armour smelts two bars at the Edgeville furnace", (t) => {
  t.mock.method(Math, "random", () => 0.05);
  const edgeville = CacheDefinitions.getLocId("varrock_diary_furnace");
  const player = furnaceWith([[I.MITHRIL_ORE, 2], [I.COAL, 8]]);
  player.equipped.set(4, I.VARROCK_ARMOUR_2);
  objects.get("Furnace").Smelt({ player, objectId: edgeville });
  lastMenu(player).execute(I.MITHRIL_BAR, 1);
  ticks(6);
  assert.equal(player.items.get(I.MITHRIL_BAR), 2);
  assert.equal(player.items.get(I.MITHRIL_ORE), 0);
  assert.equal(player.xp, 60);

  const elsewhere = furnaceWith([[I.MITHRIL_ORE, 2], [I.COAL, 8]]);
  elsewhere.equipped.set(4, I.VARROCK_ARMOUR_1);
  objects.get("Furnace").Smelt({ player: elsewhere, objectId: edgeville });
  lastMenu(elsewhere).execute(I.MITHRIL_BAR, 1);
  ticks(6);
  assert.equal(elsewhere.items.get(I.MITHRIL_BAR), 1);
});

const anvil = { getDefinition: () => ({ getName: () => "Anvil" }) };
const dialogueTexts = (player) => player.statements.map((chain) => [...chain.getDialogues().values()].map((d) => d.getText?.() ?? "").join(" "));
/** Presses continue on the last dialogue chain: runs its ActionDialogue, if any. */
const continueDialogue = (player) => {
  for (const dialogue of player.statements.at(-1).getDialogues().values()) dialogue.action?.execute?.();
};

// Captured (rsprox recs 1515, 1517): the message box and hammering at once, the result 6 ticks in.
test("two godsword shards forge into a pair, then the blade, 100 XP each", () => {
  const player = playerWith(I.GODSWORD_SHARD_1, 1);
  player.items.set(I.GODSWORD_SHARD_3, 1);
  player.items.set(I.GODSWORD_SHARD_2, 1);
  open(player);
  assert.equal(player.interfaceId, -1);
  ticks(6);
  assert.equal(player.items.get(I.GODSWORD_SHARDS_1_2) ?? 0, 0);
  ticks(1);
  assert.equal(player.items.get(I.GODSWORD_SHARDS_1_2), 1);
  assert.equal(player.xp, 100);
  itemOnObject({ player, itemId: I.GODSWORD_SHARD_3, object: anvil });
  ticks(7);
  assert.equal(player.items.get(I.GODSWORD_BLADE), 1);
  assert.equal(player.xp, 200);

  const one = playerWith(I.GODSWORD_SHARD_1, 1);
  itemOnObject({ player: one, itemId: I.GODSWORD_SHARD_1, object: anvil });
  assert.match(dialogueTexts(one).join(), /at least two different Godsword blade pieces/);
});

test("dragon sq shield halves are repaired at an anvil after the message boxes", () => {
  const player = playerWith(I.SHIELD_LEFT_HALF, 1);
  itemOnObject({ player, itemId: I.SHIELD_LEFT_HALF, object: anvil });
  assert.match(dialogueTexts(player).join(), /other half/);
  player.items.set(I.SHIELD_RIGHT_HALF, 1);
  itemOnObject({ player, itemId: I.SHIELD_LEFT_HALF, object: anvil });
  assert.match(dialogueTexts(player).at(-1), /You set to work trying to fix the ancient shield/);
  continueDialogue(player);
  ticks(7);
  assert.match(dialogueTexts(player).at(-1), /restored the dragon square shield/);
  assert.equal(player.items.get(I.DRAGON_SQ_SHIELD) ?? 0, 0);
  continueDialogue(player);
  assert.equal(player.items.get(I.DRAGON_SQ_SHIELD), 1);
  assert.equal(player.items.get(I.SHIELD_LEFT_HALF), 0);
  assert.equal(player.xp, 75);
});

test("a barbarian anvil makes spears and hastas from a bar and a log", () => {
  const player = playerWith(I.STEEL_BAR, 2);
  player.items.set(I.WILLOW_LOGS, 2);
  const barbarian = { getDefinition: () => ({ getName: () => "Barbarian anvil" }) };
  for (const handler of extraItemOnObject) handler({ player, itemId: I.STEEL_BAR, object: barbarian });
  assert.deepEqual(lastMenu(player).getItems(), [I.STEEL_SPEAR, I.STEEL_HASTA]);
  lastMenu(player).execute(I.STEEL_HASTA, 2);
  ticks(10);
  assert.equal(player.items.get(I.STEEL_HASTA), 2);
  assert.equal(player.items.get(I.WILLOW_LOGS), 0);
  assert.equal(player.xp, 150);
});

test("Smith with a draconic visage and anti-dragon shield makes an uncharged dragonfire shield", () => {
  const player = playerWith(I.DRACONIC_VISAGE, 1);
  player.items.set(I.ANTI_DRAGON_SHIELD, 1);
  open(player);
  assert.equal(player.interfaceId, -1);
  assert.match(dialogueTexts(player).at(-1), /attach the ancient draconic visage/);
  continueDialogue(player);
  ticks(9);
  assert.equal(player.items.get(CacheDefinitions.getObjId("dragonfire_shield_uncharged")), 1);
  assert.equal(player.items.get(I.DRACONIC_VISAGE), 0);
  assert.equal(player.xp, 2000);
  assert.match(dialogueTexts(player).at(-1), /into a dragonfire shield/);
});

test("All stops at the bars held, without an out-of-bars message", () => {
  const player = playerWith(I.BRONZE_BAR, 3);
  open(player);
  click(player, 7);
  click(player, 9);
  ticks();
  assert.equal(player.items.get(I.BRONZE_DAGGER), 3);
  assert.ok(!player.messages.some((message) => /enough bars/.test(message)));
});

test("lovakite ore alone isn't ore for a normal furnace", () => {
  const player = furnaceWith([[I.LOVAKITE_ORE, 1], [I.COAL, 2]]);
  objects.get("Furnace").Smelt({ player });
  assert.equal(lastMenu(player), undefined);
  assert.equal(player.statements.length, 1);
});

// Smithing catalyst (Wiki): a bar that uses coal takes half the coal and one catalyst, for double XP.
test("a smithing catalyst halves a bar's coal and doubles its XP, one per bar", () => {
  const player = furnaceWith([[I.IRON_ORE, 2], [I.COAL, 2], [I.SMITHING_CATALYST, 2]]);
  objects.get("Furnace").Smelt({ player });
  lastMenu(player).execute(I.STEEL_BAR, 2);
  ticks(11);
  assert.equal(player.items.get(I.STEEL_BAR), 2);
  assert.equal(player.items.get(I.COAL), 0);
  assert.equal(player.items.get(I.SMITHING_CATALYST), 0);
  assert.equal(player.xp, 2 * 17.5 * 2);
});

test("out of catalysts, the next bar takes the full coal; bars without coal leave the catalyst", () => {
  const player = furnaceWith([[I.IRON_ORE, 2], [I.COAL, 3], [I.SMITHING_CATALYST, 1]]);
  objects.get("Furnace").Smelt({ player });
  lastMenu(player).execute(I.STEEL_BAR, 2);
  ticks(11);
  assert.equal(player.items.get(I.STEEL_BAR), 2);
  assert.equal(player.items.get(I.COAL), 0);
  assert.equal(player.xp, 35 + 17.5);

  const bronze = furnaceWith([[I.COPPER_ORE, 1], [I.TIN_ORE, 1], [I.SMITHING_CATALYST, 1]]);
  objects.get("Furnace").Smelt({ player: bronze });
  lastMenu(bronze).execute(I.BRONZE_BAR, 1);
  ticks(6);
  assert.equal(bronze.items.get(I.BRONZE_BAR), 1);
  assert.equal(bronze.items.get(I.SMITHING_CATALYST), 1);
  assert.equal(bronze.xp, 6.2);
});

test("with a catalyst, half the coal is enough to choose the bar", () => {
  const player = furnaceWith([[I.MITHRIL_ORE, 1], [I.COAL, 2], [I.SMITHING_CATALYST, 1]]);
  objects.get("Furnace").Smelt({ player });
  lastMenu(player).execute(I.MITHRIL_BAR, 1);
  ticks(6);
  assert.equal(player.items.get(I.MITHRIL_BAR), 1);
  assert.equal(player.xp, 60);
});

test("Varrock armour's second bar takes a second catalyst", (t) => {
  t.mock.method(Math, "random", () => 0.05);
  const player = furnaceWith([[I.MITHRIL_ORE, 2], [I.COAL, 4], [I.SMITHING_CATALYST, 2]]);
  player.equipped.set(4, I.VARROCK_ARMOUR_2);
  objects.get("Furnace").Smelt({ player, objectId: CacheDefinitions.getLocId("varrock_diary_furnace") });
  lastMenu(player).execute(I.MITHRIL_BAR, 1);
  ticks(6);
  assert.equal(player.items.get(I.MITHRIL_BAR), 2);
  assert.equal(player.items.get(I.COAL), 0);
  assert.equal(player.items.get(I.SMITHING_CATALYST), 0);
  assert.equal(player.xp, 2 * 60);
});

test("Superheat Item makes steel from iron and one coal with a catalyst, at double Smithing XP", () => {
  const player = furnaceWith([[I.IRON_ORE, 1], [I.COAL, 1], [I.SMITHING_CATALYST, 1]]);
  const recipe = Superheat.recipeFor(player, I.IRON_ORE);
  assert.equal(recipe.barId, I.STEEL_BAR);
  assert.equal(Smithing.smeltingXp(player, recipe), 35);
  Smithing.consumeIngredients(player, recipe);
  assert.equal(player.items.get(I.COAL), 0);
  assert.equal(player.items.get(I.SMITHING_CATALYST), 0);
  player.items.set(I.IRON_ORE, 1);
  assert.equal(Superheat.recipeFor(player, I.IRON_ORE).barId, I.IRON_BAR, "no coal left");
});

// Smiths' uniform (Wiki): each piece a 20% chance, the full set 100%, of a 4-tick item instead of 5.
test("the Smiths' uniform speeds anvil items from 5 ticks to 4 by chance", (t) => {
  const player = playerWith();
  let roll = 0.1;
  t.mock.method(Math, "random", () => roll);
  assert.equal(Anvil.smithingInterval(player), 5, "no uniform");
  player.equipped.set(4, I.SMITHS_TUNIC);
  assert.equal(Anvil.smithingInterval(player), 4);
  roll = 0.3;
  assert.equal(Anvil.smithingInterval(player), 5, "one piece is 20%");
  player.equipped.set(7, I.SMITHS_TROUSERS);
  assert.equal(Anvil.smithingInterval(player), 4, "two pieces are 40%");
  roll = 0.99;
  player.equipped.set(10, I.SMITHS_BOOTS);
  assert.equal(Anvil.smithingInterval(player), 5, "three pieces are 60%");
  player.equipped.set(9, I.SMITHS_GLOVES_I_);
  assert.equal(Anvil.smithingInterval(player), 4, "the full set is 100%");
});

test("with the full uniform each anvil item comes 4 ticks after the last", () => {
  const player = playerWith(I.BRONZE_BAR, 3);
  for (const [slot, id] of [[4, I.SMITHS_TUNIC], [7, I.SMITHS_TROUSERS], [10, I.SMITHS_BOOTS], [9, I.SMITHS_GLOVES]]) player.equipped.set(slot, id);
  open(player);
  click(player, 9);
  ticks(4);
  assert.equal(player.items.get(I.BRONZE_DAGGER), 1);
  ticks(3);
  assert.equal(player.items.get(I.BRONZE_DAGGER), 1);
  ticks(1);
  assert.equal(player.items.get(I.BRONZE_DAGGER), 2);
});

test("the Smelt menu counts the catalysed bars, then the bars the coal left covers", () => {
  const Smelting = require("../plugins/skills/smithing/Smelting.Smithing");
  const steel = Smithing.SMELTING_RECIPES.find((recipe) => recipe.barId === I.STEEL_BAR);
  assert.equal(Smelting.batches(furnaceWith([[I.IRON_ORE, 2], [I.COAL, 3], [I.SMITHING_CATALYST, 1]]), steel), 2);
  assert.equal(Smelting.batches(furnaceWith([[I.IRON_ORE, 5], [I.COAL, 4], [I.SMITHING_CATALYST, 9]]), steel), 4);
  assert.equal(Smelting.batches(furnaceWith([[I.IRON_ORE, 5], [I.COAL, 4]]), steel), 2);
});

test("Varrock armour's second bar takes the full coal once the catalysts are gone", (t) => {
  t.mock.method(Math, "random", () => 0.05);
  const player = furnaceWith([[I.MITHRIL_ORE, 2], [I.COAL, 6], [I.SMITHING_CATALYST, 1]]);
  player.equipped.set(4, I.VARROCK_ARMOUR_2);
  objects.get("Furnace").Smelt({ player, objectId: CacheDefinitions.getLocId("varrock_diary_furnace") });
  lastMenu(player).execute(I.MITHRIL_BAR, 1);
  ticks(6);
  assert.equal(player.items.get(I.MITHRIL_BAR), 2);
  assert.equal(player.items.get(I.COAL), 0);
  assert.equal(player.xp, 60 + 30);
});

// Private append to the existing smithing.test.cjs; selected native phases, not full World.step.
test("native furnace smelting admission and one-step cancellation", async t => {
  process.env.DISABLE_PLAYER_BOTS = "1"; // excludes bot startup and dependent bot coverage
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const Sessions = require("../plugins/skills/smithing/Sessions.Smithing");
  const Smelting = require("../plugins/skills/smithing/Smelting.Smithing");
  // This runs after the legacy registered-callback cases, whose captured tasks never enter TaskManager.
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  const core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PluginManager.emitServerStartup({});
  t.after(() => PluginManager.emitServerShutdown({}));
  let index = 1710;
  for (const mode of ["stationary", "approach", "interrupt", "ore-approach"]) await t.test(mode, async t => {
    const channel = {kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
    const p = new Player(new PlayerSession(channel));
    p.setIndex(index++); p.setUsername("smithcancel" + index); p.setRegistered(true);
    p.setLocation(new core.Location(mode === "approach" || mode === "ore-approach" ? 3219 : 3226, 3218, 0));
    p.needsPlacement = false;
    const c = new ClientConnection(channel); c.player = p;
    t.after(() => {
      PluginManager.emitPlayerDisconnect({player:p,username:p.getUsername()});
      PluginManager.emitPlayerLogout({player:p,username:p.getUsername()});
      p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex());
      assert.equal(Sessions.typeOf(p), null, "native disconnect clears the private session");
    });
    assert.equal(p.getEquipment().getItems().some(i => i && i.getId() > 0), false);
    for (const id of mode === "ore-approach" ? [I.SILVER_ORE] : [I.COPPER_ORE,I.TIN_ORE]) p.getInventory().add(new core.Item(id,1), false);
    const recipe = Smithing.SMELTING_RECIPES.find(r => r.barId === I.BRONZE_BAR);
    assert.deepEqual(recipe.ingredients, [[I.COPPER_ORE,1],[I.TIN_ORE,1]]);
    assert.equal(recipe.xp, 6.2);
    const furnaceId = [...Smelting.FURNACE_OBJECT_IDS].find(id => {
      const d = core.ObjectDefinition.forPlayer(id,p);
      return d?.getName() === "Furnace" && d.getActions()?.includes("Smelt");
    });
    assert.ok(Number.isInteger(furnaceId), "active cache supplies a Furnace with Smelt");
    const furnace = new core.GameObject(furnaceId,new core.Location(3223,3218,0),10,0,null);
    core.ObjectManager.register(furnace,true); t.after(() => core.ObjectManager.deregister(furnace,true));
    const pos = () => [p.getLocation().getX(),p.getLocation().getY(),p.getLocation().getZ()];
    const initial = pos();
    const gains = [], snapshots = [];
    const skills = p.getSkillManager(), add = skills.addExperiences.bind(skills);
    t.mock.method(skills,"addExperiences",(skill,amount) => {
      if(skill === core.Skill.SMITHING) gains.push(amount);
      return add(skill,amount);
    });
    const total = id => p.getInventory().getAmount(id) + p.getEquipment().getAmount(id) +
      core.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === p.getUsername() && g.getItem().getId() === id && g.getPrivateArea() === p.getPrivateArea()).reduce((n,g) => n+g.getItem().getAmount(),0);
    let turns=0, openings=0;
    const openingStates=[];
    const animate=p.performAnimation.bind(p), furnaceAnimation=core.CacheDefinitions.getSeqId("human_furnace");
    t.mock.method(p,"performAnimation",(...args) => {
      const result=animate(...args);
      if(args[0]?.getId()===furnaceAnimation) {
        openings++; openingStates.push({turns,pos:pos(),accepted:p.getAnimation()?.getId()===furnaceAnimation,gains:[...gains],copper:total(I.COPPER_ORE),tin:total(I.TIN_ORE),bars:total(I.BRONZE_BAR)});
      }
      return result;
    });
    const snapshot = label => {
      const q=p.getMovementQueue();
      const row={label,mode,turns,epoch:core.World.getProcessCycle(),pos:pos(),queue:q.size(),moving:q.isMovings(),didMove:q.didMoveThisCycle(),session:Sessions.typeOf(p),copper:total(I.COPPER_ORE),tin:total(I.TIN_ORE),bars:total(I.BRONZE_BAR),gains:[...gains],openings};
      snapshots.push(row); return row;
    };
    const turn=()=>{
      assert.ok(++turns <= 24,"bounded native turns");
      p.resetUpdating(); core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;
      core.TaskManager.process(); c.processTurnPackets();
      const q=p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit(); if(q.hasPendingWork())q.process();
      core.TaskManager.processWalkTo(p.getIndex());
    };
    const untouched = () => { assert.equal(total(I.COPPER_ORE),1); assert.equal(total(I.TIN_ORE),1); assert.equal(total(I.BRONZE_BAR),0); assert.deepEqual(gains,[]); };
    if(mode === "ore-approach") {
      skills.setCurrentLevel(core.Skill.SMITHING, 99, false).setMaxLevels(core.Skill.SMITHING, 99, false);
      const silver = Smithing.SMELTING_RECIPES.find(r => r.barId === I.SILVER_BAR);
      assert.deepEqual(silver.ingredients, [[I.SILVER_ORE,1]]);
      assert.equal(furnace.isWithinInteractionDistance(p.getLocation()),false);
      const slot = p.getInventory().getSlotForItemId(I.SILVER_ORE);
      assert.ok(slot >= 0);
      await c.dispatch([{type:"item_on_object",objectId:furnaceId,x:3223,y:3218,itemId:I.SILVER_ORE,slot,widgetId:149<<16}]);
      for(let i=0;i<10 && Sessions.typeOf(p)!=="smelt";i++)turn();
      assert.notDeepEqual(pos(),initial,"real item-on-furnace interaction approached");
      assert.equal(Sessions.typeOf(p),"smelt","lone ore automatically admits a session");
      assert.equal(p.getCreationMenu(),null);
      assert.equal(total(I.SILVER_ORE),1);
      assert.equal(total(I.SILVER_BAR),0);
      console.log("SMITHING_ORE_APPROACH_ADMISSION "+JSON.stringify(snapshot("ore-admission")));
      for(let i=0;i<7;i++)turn();
      assert.equal(total(I.SILVER_ORE),0);
      assert.equal(total(I.SILVER_BAR),1);
      assert.deepEqual(gains,[silver.xp]);
      assert.equal(Sessions.typeOf(p),null);
      return;
    }
    if(mode === "approach") assert.equal(furnace.isWithinInteractionDistance(p.getLocation()),false,"genuine approach begins outside reach");
    await c.dispatch([{type:"object_option",id:furnaceId,x:3223,y:3218,action:"Smelt"}]);
    for(let i=0;i<10 && !p.getCreationMenu();i++)turn();
    const menu=p.getCreationMenu();
    assert.ok(menu,"native furnace reach must open CreationMenu");
    if(mode === "approach") assert.notDeepEqual(pos(),initial,"object interaction actually approached");
    else assert.deepEqual(pos(),initial,"stationary control begins at the observed reachable furnace side");
    const admission=pos();
    assert.deepEqual(admission,[3226,3218,0],"anchor actual settled furnace admission, not original spawn");
    console.log("SMITHING_CANCELLATION_PRECONDITION "+JSON.stringify(snapshot("admitted-menu")));
    assert.ok(furnace.isWithinInteractionDistance(p.getLocation()));
    assert.equal(p.getMovementQueue().size(),0);
    untouched();
    const slot=menu.getItems().indexOf(I.BRONZE_BAR); assert.ok(slot>=0);
    // Native skillmulti producer/consumer constants: dialogue_continue, literal quantity 1.
    const { CREATION_MENU_GROUP_ID, CREATION_MENU_FIRST_ITEM_COMPONENT } = require("../dist/net/packet/PacketSender");
    assert.ok(Number.isInteger(CREATION_MENU_GROUP_ID)); assert.ok(Number.isInteger(CREATION_MENU_FIRST_ITEM_COMPONENT));
    await c.dispatch([{type:"dialogue_continue",widgetId:(CREATION_MENU_GROUP_ID<<16)|(CREATION_MENU_FIRST_ITEM_COMPONENT+slot),childIndex:1}]);
    turn();
    assert.equal(Sessions.typeOf(p),"smelt","native selection admits pending smelt");
    assert.equal(p.getCreationMenu(),null);
    assert.equal(openings,0,"global task precedes queued menu input");
    if(mode === "interrupt") await c.dispatch([{type:"move",worldX:3225,worldY:3217,modifierFlags:0,run:false}]);
    turn(); // The pending cycle opens before this turn's actual walk.
    assert.equal(openings,1); assert.equal(openingStates[0].accepted,true);
    assert.deepEqual(openingStates[0].pos,admission,"cycle opens at the settled admission before native walk");
    untouched();
    console.log("SMITHING_CANCELLATION_PRECONDITION "+JSON.stringify(snapshot("pending-after-input")));
    if(mode === "interrupt") {
      assert.deepEqual(pos(),[3225,3217,0],"actual native one-step walk must reach destination");
      assert.equal(p.getMovementQueue().size(),0,"route drains before next global task");
      assert.equal(p.getMovementQueue().didMoveThisCycle(),true);
      assert.equal(p.getMovementQueue().isMovings(),true);
    }
    for(let i=0;i<7;i++)turn();
    const end=snapshot("completion-window");
    console.log("SMITHING_CANCELLATION_OBSERVATION "+JSON.stringify({snapshots,openingStates}));
    const cancelled=mode==="interrupt";
    assert.deepEqual(gains,cancelled?[]:[6.2],"pending smelt XP cancellation: "+JSON.stringify(end));
    assert.equal(total(I.COPPER_ORE),cancelled?1:0,"copper conservation");
    assert.equal(total(I.TIN_ORE),cancelled?1:0,"tin conservation");
    assert.equal(total(I.BRONZE_BAR),cancelled?0:1,"bronze conservation");
    assert.equal(Sessions.typeOf(p),null);
  });
});
