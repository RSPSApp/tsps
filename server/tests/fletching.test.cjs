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
  const attrs = new Map(), varbits = new Map(), messages = [], spam = [], sounds = [], animations = [];
  let menu = null, xp = 0;
  const inventory = {
    contains: (id) => (counts.get(id) ?? 0) > 0,
    getAmount: (id) => counts.get(id) ?? 0,
    deleteNumber(id, n) { const left = (counts.get(id) ?? 0) - n; if (left > 0) counts.set(id, left); else counts.delete(id); },
    addItem(item) { counts.set(item.getId(), (counts.get(item.getId()) ?? 0) + item.getAmount()); },
    getFreeSlots: () => 28 - counts.size,
    getAddableAmount: (item) => item.getAmount(),
    getItems: () => [...counts].map(([id, n]) => new core.Item(id, n)),
    deleteAtSlot(slot, n) { inventory.deleteNumber([...counts.keys()][slot], n); },
  };
  const sender = new Proxy({
    sendCreationMenu(value) { menu = value; return sender; },
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendTypedMessage(type, message) { messages.push(message); if (type === core.ChatType.SPAM) spam.push(message); return sender; },
    sendSoundEffect(id) { sounds.push(id); return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  return {
    counts, messages, spam, sounds, animations, varbits, menu: () => menu, xp: () => xp,
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
    getUsername: () => "tester",
    isPlayerBot: () => false,
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

// Wiki: Gryphon_feather, Stymphike_feather and Feather, retrieved 2026-10-27.
for (const feather of ["GRYPHON_FEATHER", "STYMPHIKE_FEATHER"]) {
  for (const [material, output, amount, feathers, xp] of [
    ["RUNE_DART_TIP", "RUNE_DART", 10, 10, 188],
    ["MITHRIL_BOLTS_UNF_", "MITHRIL_BOLTS", 10, 10, 50],
    ["ARROW_SHAFT", "HEADLESS_ARROW", 15, 15, 15],
    ["ATLATL_DART_SHAFT", "HEADLESS_ATLATL_DART", 20, 20, 20],
    ["OGRE_ARROW_SHAFT", "FLIGHTED_OGRE_ARROW", 6, 24, 5.4],
  ]) {
    test(`${feather} feathers ${output} with normal quantities and XP`, () => {
      answers.started.add("big_chompy_bird_hunting");
      const p = player({ items: { [feather]: feathers, [material]: amount } });
      assert.equal(use(p, feather, material), true);
      if (!["RUNE_DART", "MITHRIL_BOLTS"].includes(output)) {
        assert.equal(p.count(output), 0);
        runTask();
      }
      assert.equal(p.count(output), amount);
      assert.equal(p.count(feather), 0);
      assert.equal(p.count(material), 0);
      assert.equal(p.xp(), xp);
    });
  }
}

test("gryphon feather use is directional; stymphike feather use is reversible", () => {
  for (const [material, output, amount] of [["RUNE_DART_TIP", "RUNE_DART", 10], ["MITHRIL_BOLTS_UNF_", "MITHRIL_BOLTS", 10], ["ARROW_SHAFT", "HEADLESS_ARROW", 15]]) {
    const p = player({ items: { GRYPHON_FEATHER: amount, [material]: amount } });
    assert.equal(use(p, material, "GRYPHON_FEATHER"), true);
    assert.deepEqual(p.messages, ["Nothing interesting happens."]);
    assert.equal(p.count(output), 0);
    assert.equal(p.count("GRYPHON_FEATHER"), amount);
    const q = player({ items: { STYMPHIKE_FEATHER: amount, [material]: amount } });
    assert.equal(use(q, material, "STYMPHIKE_FEATHER"), true);
    if (hooks.tasks.length) runTask();
    assert.equal(q.count(output), amount);
  }
});

test("new feathers respect levels and Make-X and spend the selected feather first", () => {
  const p = player({ level: 80, items: { GRYPHON_FEATHER: 10, RUNE_DART_TIP: 10 } });
  use(p, "GRYPHON_FEATHER", "RUNE_DART_TIP");
  assert.equal(p.count("RUNE_DART"), 0);
  assert.deepEqual(p.messages, ["You need a Fletching level of at least 81 to do this."]);
  for (const feather of ["GRYPHON_FEATHER", "STYMPHIKE_FEATHER"]) {
    const q = player({ items: { [feather]: 20, FEATHER: 20, RUNE_DART_TIP: 20 } });
    q.getPacketSender().sendVarbit(CacheDefinitions.getVarbitId("option_fletch_dart_or_bolt_makex"), 1);
    use(q, feather, "RUNE_DART_TIP");
    assert.deepEqual(q.menu().getItems(), [I.RUNE_DART]);
    q.menu().execute(I.RUNE_DART, 28);
    runTask();
    assert.equal(q.count("RUNE_DART"), 20);
    assert.equal(q.count(feather), 0);
    assert.equal(q.count("FEATHER"), 20);
    assert.equal(q.xp(), 376);
  }
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

/** Runs the newest task and records the execute (capture tick) of each change it makes to `name`. */
function ticksOf(p, name) {
  const task = hooks.tasks.at(-1);
  const made = [];
  for (let tick = 1; tick < 100 && task.isRunning(); tick++) {
    const before = p.count(name);
    task.execute();
    if (p.count(name) !== before) made.push(tick);
  }
  return made;
}

test("knife cuts: 2 ticks after the choice then every 3, each with its spam line (rsprox captures)", () => {
  const p = player({ items: { KNIFE: 1, OAK_LOGS: 3 } });
  use(p, "KNIFE", "OAK_LOGS");
  p.menu().execute(I.ARROW_SHAFT, 28);
  assert.deepEqual(ticksOf(p, "ARROW_SHAFT"), [2, 5, 8]);
  assert.deepEqual(p.spam, Array(3).fill("You carefully cut the wood into 30 arrow shafts."));

  for (const [log, output, line] of [
    ["LOGS", "JAVELIN_SHAFT", "You carefully cut the wood into some javelin shafts."],
    ["MAPLE_LOGS", "MAPLE_SHORTBOW_U_", "You carefully cut the wood into a shortbow."],
    ["YEW_LOGS", "YEW_LONGBOW_U_", "You carefully cut the wood into a longbow."],
    ["MAGIC_LOGS", "MAGIC_STOCK", "You carefully cut the wood into a crossbow stock."],
  ]) {
    const q = player({ items: { KNIFE: 1, [log]: 2 } });
    use(q, "KNIFE", log);
    q.menu().execute(I[output], 1);
    runTask();
    assert.deepEqual(q.spam, [line], output);
  }
});

test("shields: the animation a tick after the choice, the shield 6 ticks after it, then every 7", () => {
  const p = player({ items: { KNIFE: 1, MAPLE_LOGS: 4 } });
  use(p, "KNIFE", "MAPLE_LOGS");
  p.menu().execute(I.MAPLE_SHIELD, 28);
  assert.deepEqual(p.animations, [], "nothing on the choice's tick");
  hooks.tasks.at(-1).execute();
  assert.equal(p.animations.length, 1, "the animation on tick 1");
  assert.deepEqual([1, ...ticksOf(p, "MAPLE_SHIELD").map((tick) => tick + 1)].slice(1), [6, 13]);
  assert.deepEqual(p.spam, Array(2).fill("You carefully cut the pieces of wood into a shield."));
});

test("stringing from the menu: no opening animation, a bow and its line every 2 ticks from tick 1", () => {
  const p = player({ items: { OAK_SHORTBOW_U_: 3, BOW_STRING: 3 } });
  use(p, "BOW_STRING", "OAK_SHORTBOW_U_");
  assert.equal(p.menu().getTitle(), "How many would you like to string?");
  p.menu().execute(I.OAK_SHORTBOW, 28);
  assert.deepEqual(p.animations, []);
  assert.deepEqual(ticksOf(p, "OAK_SHORTBOW"), [1, 3, 5]);
  assert.equal(p.animations.length, 3);
  assert.deepEqual(p.spam, Array(3).fill("You add a string to the bow."));

  const one = player({ items: { YEW_LONGBOW_U_: 1, BOW_STRING: 1 } });
  use(one, "YEW_LONGBOW_U_", "BOW_STRING");
  assert.equal(one.menu(), null, "a single bow is strung without a menu");
  assert.deepEqual(ticksOf(one, "YEW_LONGBOW"), [1]);
});

test("arrows: sound 2605 and a spam line with every set; arrowtips use the complete menu", () => {
  const p = player({ items: { ARROW_SHAFT: 30, FEATHER: 30 } });
  use(p, "FEATHER", "ARROW_SHAFT");
  assert.equal(p.menu().getTitle(), "How many sets of 15 do you wish to feather?");
  p.menu().execute(I.HEADLESS_ARROW, 28);
  assert.deepEqual(ticksOf(p, "HEADLESS_ARROW"), [1, 3]);
  assert.deepEqual(p.spam, Array(2).fill("You attach feathers to 15 arrow shafts."));
  assert.deepEqual(p.sounds, [2605, 2605]);

  const q = player({ items: { HEADLESS_ARROW: 30, BROAD_ARROWHEADS: 30 } });
  answers.unlocks.add("Broader Fletching");
  use(q, "BROAD_ARROWHEADS", "HEADLESS_ARROW");
  assert.equal(q.menu().getTitle(), "How many sets of 15 do you wish to complete?");
  q.menu().execute(I.BROAD_ARROWS, 28);
  runTask();
  assert.deepEqual(q.spam, Array(2).fill("You attach broad arrowheads to 15 headless arrows."));
});

test("gem bolt tips: the sets menu, animation and sound on the choice, tips at 4 then every 5", () => {
  const p = player({ items: { CHISEL: 1, RUBY: 2 } });
  use(p, "CHISEL", "RUBY");
  assert.equal(p.menu().getTitle(), "How many sets of 12 will you make?");
  assert.equal(p.menu().getOptions().mode, 2);
  p.menu().execute(I.RUBY_BOLT_TIPS, 28);
  assert.equal(p.animations.length, 1);
  assert.deepEqual(p.sounds, [2586]);
  assert.deepEqual(ticksOf(p, "RUBY_BOLT_TIPS"), [4, 9]);
  assert.deepEqual(p.sounds, [2586, 2586, 2586]);
  assert.deepEqual(p.spam, Array(2).fill("You use your chisel to fletch small bolt tips."));

  const pearls = player({ items: { CHISEL: 1, OYSTER_PEARL: 2 } });
  use(pearls, "CHISEL", "OYSTER_PEARL");
  assert.equal(pearls.menu().getTitle(), "How many sets of 6 will you make?");
});

test("tipping bolts: sound 2605 and \"You fletch 10 bolts.\"; javelins use their own sets title", () => {
  const p = player({ items: { RUBY_BOLT_TIPS: 20, ADAMANT_BOLTS: 20 } });
  use(p, "RUBY_BOLT_TIPS", "ADAMANT_BOLTS");
  p.menu().execute(I.RUBY_BOLTS, 28);
  assert.deepEqual(ticksOf(p, "RUBY_BOLTS"), [1, 3]);
  assert.deepEqual(p.spam, Array(2).fill("You fletch 10 bolts."));
  assert.deepEqual(p.sounds, [2605, 2605]);

  const j = player({ items: { JAVELIN_SHAFT: 30, DRAGON_JAVELIN_TIPS: 30 } });
  use(j, "DRAGON_JAVELIN_TIPS", "JAVELIN_SHAFT");
  assert.equal(j.menu().getTitle(), "How many sets of 15 do you wish to make?");
});
