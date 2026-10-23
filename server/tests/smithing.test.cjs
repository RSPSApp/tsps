// Run after `yarn build`: node --test tests/smithing.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { Skill } = require("../dist/game/model/Skill");
const Smithing = require("../plugins/skills/Smithing.plugin");

const buttons = new Map(), objects = new Map(), itemActions = new Map(), events = new Map(), tasks = [], players = [];
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
  const player = { items, xp: 0, level: 99, moving: false, interfaceId: -1, messages: [], sent: [], statements: [], equipped: new Map() };
  const sender = new Proxy({}, { get: (_, name) => (...args) => { player.sent.push([name, ...args]); return sender; } });
  Object.assign(player, {
    getInventory: () => ({
      contains: id => (items.get(id) ?? 0) > 0,
      getAmount: id => items.get(id) ?? 0,
      deleteNumber: (id, n) => items.set(id, items.get(id) - n),
      addItem: item => items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()),
    }),
    getEquipment: () => ({
      get: slot => player.equipped.has(slot) ? { getId: () => player.equipped.get(slot) } : null,
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
    getForceMovement: () => null, isRegistered: () => true, getHitpoints: () => 99,
    performAnimation(animation) { player.animation = animation?.getId?.(); },
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
const statementText = player => player.statements.at(-1)?.getDialogues?.()?.[0]?.text ?? player.statements.at(-1)?.dialogues?.[0]?.text;

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

// Captured (rsprox, recs 1610, 3461): the click closes the interface on its tick, the first item
// comes 3 ticks later and the next every 5, each with "You hammer the <metal> and make ...".
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
  assert.equal(player.messages.at(-1), "You hammer the steel and make ten dart tips.");
  ticks(4);
  assert.equal(player.items.get(I.STEEL_DART_TIP), 10);
  ticks(1);
  assert.equal(player.items.get(I.STEEL_DART_TIP), 20);
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
  assert.deepEqual(menu.getItems(), [I.BRONZE_BAR, I.BLURITE_BAR, I.IRON_BAR, I.SILVER_BAR, I.STEEL_BAR,
    I.GOLD_BAR, I.MITHRIL_BAR, I.ADAMANTITE_BAR, I.RUNITE_BAR]);
  menu.execute(I.BRONZE_BAR, 2);
  ticks(1);
  assert.equal(player.messages.at(-1), "You smelt the copper and tin together in the furnace.");
  assert.equal(player.animation, CacheDefinitions.getSeqId("human_furnace"));
  ticks(3);
  assert.equal(player.items.get(I.BRONZE_BAR) ?? 0, 0);
  ticks(1);
  assert.equal(player.items.get(I.BRONZE_BAR), 1);
  assert.equal(player.messages.at(-1), "You retrieve a bar of bronze.");
  assert.equal(player.xp, 6.2);
  ticks(5);
  assert.equal(player.items.get(I.BRONZE_BAR), 2);
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
  assert.equal(player.messages.at(-1), "The ore is too impure and you fail to refine it.");
  assert.equal(player.xp, 0);
});

test("ore used on a furnace opens the Smelt menu; sand opens molten glass", () => {
  const player = furnaceWith([[I.IRON_ORE, 1]]);
  const event = { player, itemId: I.IRON_ORE, object: furnace };
  itemOnObject(event);
  assert.equal(event.handled, true);
  assert.equal(lastMenu(player).getTitle(), "What would you like to smelt?");
  assert.equal(player.items.get(I.IRON_ORE), 1);

  const glass = furnaceWith([[I.BUCKET_OF_SAND, 1], [I.SODA_ASH, 1]]);
  itemOnObject({ player: glass, itemId: I.BUCKET_OF_SAND, object: furnace });
  assert.deepEqual(lastMenu(glass).getItems(), [I.MOLTEN_GLASS]);
  lastMenu(glass).execute(I.MOLTEN_GLASS, 1);
  ticks(6);
  assert.equal(glass.items.get(I.MOLTEN_GLASS), 1);
  assert.equal(glass.items.get(I.BUCKET), 1);
  assert.equal(glass.xpSkill, Skill.CRAFTING);
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
  assert.equal(keel.messages.at(-1), "You hammer the steel and make some keel parts.");
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
  assert.equal(player.messages.at(-1), "The ore is too impure and you fail to refine it.");
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
