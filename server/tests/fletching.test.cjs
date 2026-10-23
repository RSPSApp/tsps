// Run after `yarn build`: node --test tests/fletching.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const DATA = require("../plugins/skills/data/fletching.json");

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const hooks = { itemOnItem: [], itemActions: {}, events: {}, tasks: [] };
/** Answers for the events Fletching asks other plugins: quest state and Slayer unlocks. */
const answers = { started: new Set(), complete: new Set(), unlocks: new Set() };
const diaryTasks = [];
let Shared = null;

function fakeApi() {
  return {
    core,
    log() {},
    persistAttribute() {},
    onPlayerLogin() {},
    onPlayerDisconnect() {},
    getTaskManager: () => ({ submit: (task) => { task.setRunning(true); hooks.tasks.push(task); } }),
    onItemOnItem(...args) { hooks.itemOnItem.push(args); },
    onItemAction(name, actions) { hooks.itemActions[name] = actions; },
    onCustomEvent(name, handler) { (hooks.events[name] ??= []).push(handler); },
    emitCustomEvent(name, event) {
      if (name === "quest:is-started") event.started = answers.started.has(event.key);
      if (name === "quest:is-complete") event.complete = answers.complete.has(event.key);
      if (name === "slayer:has-unlock") event.unlocked = answers.unlocks.has(event.name);
      if (name === "diary:task") diaryTasks.push(`${event.diary}:${event.task}`);
      for (const handler of hooks.events[name] ?? []) handler(event);
    },
  };
}

function player({ level = 99, items = {}, at = [3000, 3000] } = {}) {
  const counts = new Map(Object.entries(items).map(([name, n]) => [I[name], n]));
  const attrs = new Map(), varbits = new Map(), messages = [], animations = [];
  let menu = null, xp = 0;
  const inventory = {
    contains: (id) => (counts.get(id) ?? 0) > 0,
    getAmount: (id) => counts.get(id) ?? 0,
    deleteNumber(id, n) { const left = (counts.get(id) ?? 0) - n; if (left > 0) counts.set(id, left); else counts.delete(id); },
    addItem(item) { counts.set(item.getId(), (counts.get(item.getId()) ?? 0) + item.getAmount()); },
    getFreeSlots: () => 28 - counts.size,
  };
  const sender = new Proxy({
    sendCreationMenu(value) { menu = value; return sender; },
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  return {
    counts, messages, animations, varbits, menu: () => menu, xp: () => xp,
    count: (name) => counts.get(I[name]) ?? 0,
    getInventory: () => inventory,
    getEquipment: () => ({ contains: () => false }),
    getPacketSender: () => sender,
    getSkillManager: () => ({ getCurrentLevel: () => level, addExperiences: (skill, amount) => { xp += amount; } }),
    getLocation: () => new core.Location(at[0], at[1], 0),
    getForceMovement: () => null,
    isRegistered: () => true,
    getHitpoints: () => 99,
    getIndex: () => 1,
    performAnimation: (animation) => animations.push(animation.getId()),
    sendMessage: (message) => messages.push(message),
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
  };
}

function use(p, a, b) {
  const event = { player: p, usedItemId: I[a], usedWithItemId: I[b], handled: false };
  for (const [handlerOrName, otherOrFilter, maybeHandler] of hooks.itemOnItem) {
    if (typeof handlerOrName === "function") handlerOrName(event);
    else if ([I[a], I[b]].every((id) => [handlerOrName, otherOrFilter].includes(CacheDefinitions.getItem(id).name))) maybeHandler(event);
    if (event.handled) break;
  }
  return event.handled;
}

/** Runs the newest task until it stops. */
function runTask() {
  const task = hooks.tasks.at(-1);
  for (let tick = 0; tick < 200 && task.isRunning(); tick++) task.execute();
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/skills/Fletching.plugin").register(fakeApi());
  Shared = require("../plugins/skills/fletching/Shared.Fletching");
});

beforeEach(() => {
  hooks.tasks.length = 0;
  answers.started.clear();
  answers.complete.clear();
  answers.unlocks.clear();
  diaryTasks.length = 0;
});

test("every recipe resolves to cache items, animations and varbits", () => {
  for (const recipe of Shared.getRecipes()) {
    assert.ok(CacheDefinitions.getItem(recipe.outputId), `output ${recipe.outputId}`);
    assert.ok(Shared.animationOf(recipe).getId() >= 0);
    if (recipe.instantVarbit) assert.ok(Shared.varbitId(recipe.instantVarbit) > 0);
  }
  assert.equal(Shared.getRecipes().length, DATA.recipes.length);
});

test("no item pair offers the same product twice", () => {
  for (const recipe of Shared.getRecipes()) {
    const pairs = Shared.recipesFor(recipe.materials[0].ids[0], recipe.tool ? I[DATA.tools[recipe.tool][0]] : recipe.materials[1].ids[0]);
    const outputs = pairs.map((entry) => entry.outputId);
    assert.equal(new Set(outputs).size, outputs.length, CacheDefinitions.getItem(recipe.outputId).name);
  }
});

test("crossbow limbs: iron on a willow stock and steel on a teak stock, Wiki XP, a hammer carried", () => {
  const p = player({ items: { WILLOW_STOCK: 1, IRON_LIMBS: 1 } });
  assert.equal(use(p, "WILLOW_STOCK", "IRON_LIMBS"), true);
  assert.deepEqual(p.messages, ["You'll need a hammer to do that."]);
  assert.equal(use(player({ items: { OAK_STOCK: 1, IRON_LIMBS: 1, HAMMER: 1 } }), "OAK_STOCK", "IRON_LIMBS"), false);

  const q = player({ items: { TEAK_STOCK: 1, STEEL_LIMBS: 1, HAMMER: 1 } });
  use(q, "TEAK_STOCK", "STEEL_LIMBS");
  runTask();
  assert.equal(q.count("STEEL_CROSSBOW_U_"), 1);
  assert.equal(q.xp(), 54);
  assert.ok(q.messages.includes("You attach the stock to the limbs and create an unstrung crossbow."));
});

test("knife on logs offers shields from two logs, and redwood makes shafts, a shield and a hiking staff", () => {
  const p = player({ items: { KNIFE: 1, OAK_LOGS: 4 } });
  use(p, "KNIFE", "OAK_LOGS");
  assert.ok(p.menu().getItems().includes(I.OAK_SHIELD));
  p.menu().execute(I.OAK_SHIELD, 28);
  runTask();
  assert.equal(p.count("OAK_SHIELD"), 2);
  assert.equal(p.xp(), 100);

  const r = player({ items: { KNIFE: 1, REDWOOD_LOGS: 2 } });
  use(r, "REDWOOD_LOGS", "KNIFE");
  assert.deepEqual(r.menu().getItems(), [I.ARROW_SHAFT, I.REDWOOD_SHIELD, I.REDWOOD_HIKING_STAFF]);
});

test("darts: one set per click while Make-X is off, a menu of up to 10 sets while it is on", () => {
  const p = player({ items: { RUNE_DART_TIP: 30, FEATHER: 30 } });
  use(p, "RUNE_DART_TIP", "FEATHER");
  assert.equal(p.count("RUNE_DART"), 10);
  assert.equal(p.xp(), 188);
  assert.deepEqual(p.messages, ["You finish making 10 darts."]);
  assert.equal(hooks.tasks.length, 0);

  p.getPacketSender().sendVarbit(CacheDefinitions.getVarbitId("option_fletch_dart_or_bolt_makex"), 1);
  use(p, "FEATHER", "RUNE_DART_TIP");
  assert.deepEqual(p.menu().getItems(), [I.RUNE_DART]);
  p.menu().execute(I.RUNE_DART, 28);
  runTask();
  assert.equal(p.count("RUNE_DART"), 30);
});

test("coloured feathers fletch bolts, and the clicked feather is used first", () => {
  const p = player({ items: { MITHRIL_BOLTS_UNF_: 10, FEATHER: 10, RED_FEATHER: 10 } });
  use(p, "RED_FEATHER", "MITHRIL_BOLTS_UNF_");
  assert.equal(p.count("MITHRIL_BOLTS"), 10);
  assert.equal(p.count("RED_FEATHER"), 0);
  assert.equal(p.count("FEATHER"), 10);
  assert.deepEqual(p.messages, ["You fletch 10 bolts."]);
});

test("gem bolt tips: 12 per gem, 24 per onyx, and tipping bolts in sets of 10", () => {
  const p = player({ items: { CHISEL: 1, ONYX: 1, RUNITE_BOLTS: 20 } });
  use(p, "CHISEL", "ONYX");
  runTask();
  assert.equal(p.count("ONYX_BOLT_TIPS"), 24);
  use(p, "ONYX_BOLT_TIPS", "RUNITE_BOLTS");
  assert.equal(p.menu().getTitle(), "How many sets of 10 would you like to tip?");
  p.menu().execute(I.ONYX_BOLTS, 28);
  runTask();
  assert.equal(p.count("ONYX_BOLTS"), 20);
  assert.equal(p.count("ONYX_BOLT_TIPS"), 4);
});

test("broad ammunition needs the Broader Fletching unlock", () => {
  const p = player({ items: { UNFINISHED_BROAD_BOLTS: 10, FEATHER: 10 } });
  use(p, "FEATHER", "UNFINISHED_BROAD_BOLTS");
  assert.equal(p.count("BROAD_BOLTS"), 0);
  answers.unlocks.add("Broader Fletching");
  use(p, "FEATHER", "UNFINISHED_BROAD_BOLTS");
  assert.equal(p.count("BROAD_BOLTS"), 10);
});

test("ogre arrows need Big Chompy Bird Hunting started; brutal arrows need a hammer", () => {
  const p = player({ items: { KNIFE: 1, ACHEY_TREE_LOGS: 1 } });
  use(p, "KNIFE", "ACHEY_TREE_LOGS");
  assert.equal(p.count("OGRE_ARROW_SHAFT"), 0);
  answers.started.add("big_chompy_bird_hunting");
  use(p, "KNIFE", "ACHEY_TREE_LOGS");
  runTask();
  const shafts = p.count("OGRE_ARROW_SHAFT");
  assert.ok(shafts >= 2 && shafts <= 6, `${shafts} shafts`);

  answers.started.add("zogre_flesh_eaters");
  const q = player({ items: { FLIGHTED_OGRE_ARROW: 6, BRONZE_NAILS: 6 } });
  use(q, "FLIGHTED_OGRE_ARROW", "BRONZE_NAILS");
  assert.deepEqual(q.messages, ["You'll need a hammer to do that."]);
});

test("the bow string spool stores strings on the account and strings bows from them", () => {
  const Spool = require("../plugins/skills/fletching/Spool.Fletching");
  const p = player({ items: { BOW_STRING_SPOOL: 1, BOW_STRING: 3, MAGIC_LONGBOW_U_: 2 } });
  use(p, "BOW_STRING", "BOW_STRING_SPOOL");
  assert.equal(p.count("BOW_STRING"), 0);
  assert.equal(p.getAttribute(Spool.CHARGES_ATTRIBUTE), 3);

  use(p, "BOW_STRING_SPOOL", "MAGIC_LONGBOW_U_");
  p.menu().execute(I.MAGIC_LONGBOW, 28);
  runTask();
  assert.equal(p.count("MAGIC_LONGBOW"), 2);
  assert.equal(p.getAttribute(Spool.CHARGES_ATTRIBUTE), 1);

  hooks.events["crafting:spun"].forEach((handler) => handler({ player: p, itemId: I.BOW_STRING, amount: 1 }));
  assert.equal(p.getAttribute(Spool.CHARGES_ATTRIBUTE), 1, "nothing spun into the inventory, nothing stored");
  p.getInventory().addItem(new core.Item(I.BOW_STRING, 1));
  hooks.events["crafting:spun"].forEach((handler) => handler({ player: p, itemId: I.BOW_STRING, amount: 1 }));
  assert.equal(p.getAttribute(Spool.CHARGES_ATTRIBUTE), 2);
});

test("an empty spool on an unstrung bow does nothing", () => {
  const p = player({ items: { BOW_STRING_SPOOL: 1, YEW_LONGBOW_U_: 1 } });
  assert.equal(use(p, "BOW_STRING_SPOOL", "YEW_LONGBOW_U_"), true);
  assert.equal(p.menu(), null);
  assert.deepEqual(p.messages, []);
});

test("a fletching knife takes a tick off each log after the first", () => {
  const plain = player({ items: { KNIFE: 1, LOGS: 3 } });
  use(plain, "KNIFE", "LOGS");
  plain.menu().execute(I.SHORTBOW_U_, 28);
  const task = hooks.tasks.at(-1);
  let ticks = 0;
  while (task.isRunning()) { task.execute(); ticks++; }
  assert.equal(ticks, 2 + 3 + 3);

  const fast = player({ items: { FLETCHING_KNIFE: 1, LOGS: 3 } });
  use(fast, "FLETCHING_KNIFE", "LOGS");
  fast.menu().execute(I.SHORTBOW_U_, 28);
  const quick = hooks.tasks.at(-1);
  ticks = 0;
  while (quick.isRunning()) { quick.execute(); ticks++; }
  assert.equal(ticks, 2 + 2 + 2);
});

test("the Gnome Stronghold diary task counts stringing an oak shortbow there, not cutting it", () => {
  const p = player({ at: [2440, 3430], items: { KNIFE: 1, OAK_LOGS: 1, BOW_STRING: 1 } });
  use(p, "KNIFE", "OAK_LOGS");
  p.menu().execute(I.OAK_SHORTBOW_U_, 1);
  runTask();
  assert.deepEqual(diaryTasks, []);
  use(p, "BOW_STRING", "OAK_SHORTBOW_U_");
  runTask();
  assert.equal(p.count("OAK_SHORTBOW"), 1);
  assert.deepEqual(diaryTasks, ["western:fletch-an-oak-shortbow-in-the-gnome-stronghold"]);

  const away = player({ items: { OAK_SHORTBOW_U_: 1, BOW_STRING: 1 } });
  use(away, "BOW_STRING", "OAK_SHORTBOW_U_");
  runTask();
  assert.equal(diaryTasks.length, 1);
});
