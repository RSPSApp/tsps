// Run after `yarn build`: node --test tests/food-effects.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TimerRepository } = require("../dist/util/timers/TimerRepository");
const { Location } = require("../dist/game/model/Location");
const Food = require("../plugins/items/Food.plugin");
const DATA = require("../plugins/items/data/food.json");

let core;
let eat;
const tasks = [];
let canEat = true;

/**
 * Items with an Eat option that aren't in food.json, and why. Anything else the cache lets a
 * player eat must be in the data.
 */
const NOT_FOOD = {
  "Handled by another plugin": ["Poisoned cheese", "White pearl", "Honey locust"],
  "Not plain food: a quest, event or minigame item with its own effect (Wiki)": [
    "Abyssal potato", "Araxyte venom sac", "Bologano fruit", "Bruised banana", "Cave nightshade",
    "Chocolate strawberry", "Corrupted shark", "Dwarven rock cake", "Fishlike thing", "Golovanova fruit",
    "Infernal eel", "Jar of congealed blood", "Leechfin", "Logavano fruit", "Melted easter egg", "Mint cake",
    "Mysterious jerky", "Mystery fruit", "Nightshade", "Poison karambwan", "Rations", "Rock cake",
    "Rotten apple", "Rotten potato", "Sacred eel", "Seaweed sandwich", "Shrunk ogleroot",
    "Slice of birthday cake", "Special super hot kebab", "Spicy stew", "Sweetcorn", "Tchiki nut paste",
    "Servery cooked meat", "Servery meat pie", "Servery pineapple pizza", "Servery plain pizza",
    "Servery potato", "Servery stew",
  ],
  "Event sweets and candy, not on the Wiki's food tables": [
    "Blue sweets", "Deep blue sweets", "Green sweets", "Pink sweets", "Red sweets", "White sweets",
    "Black candy", "Blue candy", "Brown candy", "Green candy", "Orange candy", "Pink candy", "Purple candy",
    "Red candy", "White candy",
  ],
  "Only eaten in one fight or area (Moons of Peril, Vampyrium)": ["Cooked bream", "Cooked moss lizard", "Stymphike tartare"],
  "Unobtainable: only in the game files (Wiki)": [
    "Equa toad's legs", "Odd batta", "Odd crunchies", "Odd gnomebowl", "Seasoned legs", "Spicy toad's legs",
    "Spicy worm", "Tangled toads' legs", "Unfinished batta", "Unfinished bowl", "Unfinished crunchy",
  ],
  "Sliced before eating (Wiki)": ["Watermelon"],
};

before(async () => {
  await CachePipeline.initialize();
  core = { ...PluginManager.getCoreApi(), TaskManager: { submit: (task) => tasks.push(task) } };
  Food.register({
    core,
    persistAttribute() {},
    onPlayerLogin() {},
    onItemAction: (handler) => { eat = handler; },
    emitCanEat: () => canEat,
    emitCustomEvent() {},
  });
});

const id = (name) => core.ItemIdentifiers[name];

/** A player with real timers and skills enough for eating, at `hp` of `maxHp` Hitpoints. */
function createPlayer({ hp = 50, maxHp = 99, at = new Location(3222, 3222, 0) } = {}) {
  const messages = [];
  const varps = new Map();
  const slots = Array.from({ length: 28 }, () => null);
  const attributes = new Map();
  const levels = new Map();
  const max = (skill) => (skill === core.Skill.HITPOINTS ? maxHp : 60);
  const level = (skill) => (skill === core.Skill.HITPOINTS ? hp : levels.get(skill) ?? max(skill));
  const timers = new TimerRepository();
  let energy = 50;
  let attackDelays = [];
  const player = {
    messages, varps, slots,
    give(slot, itemId) { slots[slot] = new core.Item(itemId, 1); },
    eat(slot) { eat({ player, itemId: slots[slot].getId(), slot, clickType: 1, item: slots[slot] }); },
    get hp() { return hp; },
    get energy() { return energy; },
    level,
    attackDelays: () => attackDelays,
    getInventory: () => ({
      capacity: () => 28,
      getItems: () => slots,
      deleteAtSlot(slot) { slots[slot] = null; },
      setItem(slot, item) { slots[slot] = item; },
      refreshItems() {},
    }),
    getTimers: () => timers,
    getCombat: () => ({
      delayAttack: (ticks) => attackDelays.push(ticks),
      getPoisonImmunityTimer: () => ({ secondsRemaining: () => 0, start() {} }),
      getTarget: () => null,
      getAttacker: () => null,
    }),
    getPacketSender: () => ({
      sendInterfaceRemoval() {}, sendRunEnergy() {}, sendPoisonType() {}, sendSoundEffect() {},
      sendConfig: (varp, value) => varps.set(varp, value),
    }),
    getSkillManager: () => ({
      stopSkillable() {},
      getCurrentLevel: level,
      getMaxLevel: max,
      increaseCurrentLevel: (skill, amount, cap) => levels.set(skill, Math.min(level(skill) + amount, cap)),
      decreaseCurrentLevel: (skill, amount, minimum) => levels.set(skill, Math.max(level(skill) - amount, minimum)),
    }),
    setHitpoints: (value) => { hp = value; },
    getHitpoints: () => hp,
    getRunEnergy: () => energy,
    setRunEnergy: (value) => { energy = value; },
    setPoisonDamage() {},
    setVenomed() {},
    getLocation: () => at,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    isPlayerBot: () => false,
    performAnimation() {},
    sendMessage: (text) => messages.push(text),
  };
  return player;
}

test("the data: every food and bite is an Eat item in the cache, and every Eat item is food or listed", () => {
  const eatNames = new Set();
  const { items } = core.CacheDefinitions.getCounts();
  for (let itemId = 0; itemId < items; itemId++) {
    if (!core.CacheDefinitions.hasItem(itemId)) continue;
    const definition = core.CacheDefinitions.getItem(itemId);
    if (definition.noteTemplate >= 0 || definition.placeholderTemplate >= 0) continue;
    if ((definition.inventoryActions ?? []).includes("Eat")) eatNames.add(definition.name);
  }
  const foodNames = new Set();
  for (const food of DATA.foods) {
    for (const name of Array.isArray(food.bites) ? food.bites : [food.name]) {
      assert.ok(eatNames.has(name), `${name} is an Eat item`);
      foodNames.add(name);
    }
    if (food.leaves) {
      const count = Array.isArray(food.bites) ? food.bites.length : food.bites ?? 1;
      assert.ok(Food._test.leftover(food, count - 1) > 0, `${food.name} leaves a ${food.leaves}`);
    }
  }
  const listed = new Set(Object.values(NOT_FOOD).flat());
  for (const name of listed) assert.ok(!foodNames.has(name), `${name} is both food and not food`);
  const missing = [...eatNames].filter((name) => !foodNames.has(name) && !listed.has(name));
  assert.deepEqual(missing, [], "Eat items with no food entry and no reason");
});

test("food lookup rejects missing and invalid ids, notes and non-food items", () => {
  for (const itemId of [undefined, null, NaN, {}, -1, String(id("SHARK")), 385.5, id("SHARK_2"), id("COINS"),
    id("STALE_BAGUETTE")]) {
    assert.equal(Food.isFoodItem(itemId), false, `not food: ${String(itemId)}`);
  }
  assert.equal(Food.isFoodItem(id("SHARK")), true);
  assert.ok(Food.foodItemIds().includes(id("SHARK")));
});

test("heals and combo foods follow the Wiki (the issue's corrections included)", () => {
  const heal = (name) => Food._test.foodBite(id(name)).food.heal;
  assert.equal(heal("CAKE"), 4);
  assert.equal(heal("CHEESE"), 2);
  assert.equal(heal("TUNA_POTATO"), 22);
  assert.equal(heal("MEAT_PIZZA"), 8);
  assert.equal(heal("_1_2_MEAT_PIZZA"), 8);
  assert.equal(heal("BREAD"), 5);
  assert.equal(heal("RAINBOW_FISH"), 11);
  assert.equal(heal("LAVA_EEL"), 11);
  assert.deepEqual(heal("CAVE_EEL"), { min: 8, max: 12 });
  for (const name of ["BAGUETTE", "TRIANGLE_SANDWICH", "SQUARE_SANDWICH", "ROLL"]) assert.equal(heal(name), 6);
  for (const [name, value] of [["WORM_CRUNCHIES", 8], ["CHOCCHIP_CRUNCHIES", 7], ["TOAD_BATTA", 11],
    ["CHOCOLATE_BOMB", 15], ["COOKED_KARAMBWAN", 18], ["HALIBUT", 20]]) {
    const { food } = Food._test.foodBite(id(name));
    assert.equal(food.heal, value, name);
    assert.equal(food.combo, true, `${name} is a combo food`);
  }
  assert.equal(Food._test.healAmount({ flat: 1, percent: 6 }, 99), 6, "strawberry at 99");
  assert.equal(Food._test.healAmount({ flat: 1, percent: 10 }, 99), 10, "sweetcorn at 99");
  assert.equal(Food._test.healAmount({ min: 8, max: 12 }, 99, () => 0.999), 12);
});

test("bites: cakes, pies and pizzas go bite by bite with their eat delays, and leave the dish", () => {
  const bite = (name) => Food._test.foodBite(id(name));
  const cake = bite("CAKE");
  assert.deepEqual([0, 1, 2].map((n) => Food._test.eatDelay(cake.food, n)), [2, 2, 3]);
  assert.equal(Food._test.leftover(cake.food, 0), id("_2_3_CAKE"));
  assert.equal(Food._test.leftover(cake.food, 2), undefined, "the slice is the last bite");
  const pie = bite("HALF_A_MEAT_PIE");
  assert.equal(pie.bite, 1);
  assert.equal(Food._test.eatDelay(pie.food, 0), 1);
  assert.equal(Food._test.eatDelay(pie.food, 1), 2);
  assert.equal(Food._test.leftover(pie.food, 1), id("PIE_DISH"));
  assert.equal(Food._test.leftover(bite("STEW").food, 0), id("BOWL"));
  // Giant crab meat: five bites under one name, its ids lowest first.
  const crab = Food._test.foodBite(7521);
  assert.equal(crab.bite, 0);
  assert.equal(Food._test.leftover(crab.food, 0), 7523);
  assert.equal(Food._test.foodBite(7526).bite, 4);
  assert.equal(Food._test.leftover(crab.food, 4), undefined);
});

test("eating a shark: animation, the messages, the food-eaten varp, 3 ticks on both timers (rsprox, Wiki)", () => {
  const player = createPlayer();
  player.give(0, id("SHARK"));
  player.eat(0);
  assert.equal(player.hp, 70);
  assert.equal(player.slots[0], null);
  assert.deepEqual(player.messages, ["You eat the shark.", "It heals some health."]);
  assert.equal(player.varps.get(4518), 1, "tracking_food_eaten");
  assert.deepEqual(player.attackDelays(), [3]);
  player.give(1, id("SHARK"));
  player.eat(1);
  assert.ok(player.slots[1], "the eat delay blocks the next bite");

  const full = createPlayer({ hp: 99 });
  full.give(0, id("SHARK"));
  full.eat(0);
  assert.deepEqual(full.messages, ["You eat the shark."], "no heal line at full Hitpoints");
});

test("a karambwan follows food in the same tick; a fast pie's 1-tick delay ends sooner", () => {
  const player = createPlayer({ hp: 10 });
  player.give(0, id("SHARK"));
  player.give(1, id("COOKED_KARAMBWAN"));
  player.eat(0);
  player.eat(1);
  assert.equal(player.hp, 48);
  assert.deepEqual(player.attackDelays(), [3, 2]);
  assert.deepEqual(player.messages.filter((m) => m.startsWith("You eat")), ["You eat the shark.", "You eat the Karambwan."]);

  const pie = createPlayer({ hp: 10 });
  pie.give(0, id("MEAT_PIE"));
  pie.eat(0);
  assert.equal(pie.slots[0].getId(), id("HALF_A_MEAT_PIE"));
  assert.equal(pie.getTimers().left(core.TimerKey.FOOD), 1);
  assert.deepEqual(pie.messages, ["You eat half the meat pie.", "It heals some health."]);
});

test("boosts and effects: wild pie, summer pie, jangerberries", () => {
  const player = createPlayer();
  player.give(0, id("WILD_PIE"));
  player.eat(0);
  assert.equal(player.level(core.Skill.SLAYER), 65);
  assert.equal(player.level(core.Skill.RANGED), 64);
  assert.equal(player.slots[0].getId(), id("HALF_A_WILD_PIE"));
  assert.equal(player.messages[0], "You eat half the Wild pie.");

  const summer = createPlayer();
  summer.give(0, id("SUMMER_PIE"));
  summer.eat(0);
  assert.equal(summer.level(core.Skill.AGILITY), 65);
  assert.equal(summer.energy, 60);

  const berries = createPlayer();
  berries.give(0, id("JANGERBERRIES"));
  berries.eat(0);
  assert.equal(berries.level(core.Skill.ATTACK), 62);
  assert.equal(berries.level(core.Skill.DEFENCE), 59);
});

test("kebab: one outcome of the Wiki's table, by weight", () => {
  const { food } = Food._test.foodBite(id("KEBAB"));
  assert.equal(food.outcomes.reduce((sum, outcome) => sum + outcome.weight, 0), 32);
  assert.match(Food._test.rollOutcome(food.outcomes, () => 0).message, /amazing kebab/);
  assert.equal(Food._test.rollOutcome(food.outcomes, () => 0.5).message, "It heals some health.");
  const player = createPlayer();
  const after = Food._test.applyFood(player, food, () => 0.5);
  assert.equal(player.hp, 50 + 3 + 6, "3 + 7% of 99");
  assert.deepEqual(after, ["It heals some health."]);
});

test("hunter meat heals again 7 ticks later, and a newer one replaces the pending heal", () => {
  tasks.length = 0;
  const player = createPlayer({ hp: 10 });
  player.give(0, id("COOKED_DASHING_KEBBIT"));
  player.eat(0);
  assert.equal(player.hp, 23);
  assert.equal(tasks.length, 1);
  tasks[0].execute();
  assert.equal(player.hp, 33);
  assert.equal(player.energy, 60, "and 10 run energy");

  tasks.length = 0;
  const twice = createPlayer({ hp: 10 });
  twice.give(0, id("COOKED_WILD_KEBBIT"));
  twice.give(1, id("COOKED_GRAAHK"));
  twice.eat(0);
  twice.getTimers().cancel(core.TimerKey.FOOD);
  twice.eat(1);
  assert.equal(twice.hp, 22, "4 then 8");
  tasks[0].execute();
  assert.equal(twice.hp, 22, "the kebbit's second heal was replaced");
  tasks[1].execute();
  assert.equal(twice.hp, 28, "the graahk's 6");
});

test("refusals: whole pineapple, blighted food outside the Wilderness, and where food is barred", () => {
  const player = createPlayer();
  player.give(0, id("PINEAPPLE"));
  eat({ player, itemId: id("PINEAPPLE"), slot: 0, clickType: 4, item: player.slots[0] });
  assert.deepEqual(player.messages, ["You can't eat it whole; maybe you should cut it up."]);
  assert.ok(player.slots[0]);

  const blighted = createPlayer();
  blighted.give(0, id("BLIGHTED_MANTA_RAY"));
  blighted.eat(0);
  assert.deepEqual(blighted.messages, ["The blighted manta ray can be eaten only in the Wilderness."]);
  const wild = createPlayer({ at: new Location(3100, 3600, 0) });
  wild.give(0, id("BLIGHTED_MANTA_RAY"));
  wild.eat(0);
  assert.equal(wild.slots[0], null);

  canEat = false;
  const barred = createPlayer();
  barred.give(0, id("SHARK"));
  barred.eat(0);
  canEat = true;
  assert.deepEqual(barred.messages, ["You cannot eat here."]);
});

function inCombatAt(x, y, target = null, attacker = null) {
  return {
    getLocation: () => new Location(x, y, 0),
    getCombat: () => ({ getTarget: () => target, getAttacker: () => attacker }),
  };
}

test("anglerfish cannot over-heal while in combat in a PvP area", () => {
  assert.equal(Food._test.canAnglerfishOverheal(inCombatAt(3200, 3600)), true, "idle in the Wilderness");
  assert.equal(Food._test.canAnglerfishOverheal(inCombatAt(3200, 3600, {})), false, "fighting an NPC");
  assert.equal(Food._test.canAnglerfishOverheal(inCombatAt(3200, 3600, null, {})), false, "being attacked");
  assert.equal(Food._test.canAnglerfishOverheal(inCombatAt(3222, 3222, {})), true, "Edgeville is not a PvP area");
  assert.equal(Food._test.getAnglerfishHeal(99), 22);
});

test("anglerfish heals off the Hitpoints level levelled up to, not the health left", () => {
  const low = createPlayer({ hp: 20, maxHp: 99 });
  low.give(0, id("ANGLERFISH"));
  low.eat(0);
  assert.equal(low.hp, 42, "the level-99 heal of 22, at 20 health");

  const shallow = createPlayer({ hp: 20, maxHp: 40 });
  shallow.give(0, id("ANGLERFISH"));
  shallow.eat(0);
  assert.equal(shallow.hp, 28, "a level-40 eater gets the level-40 heal of 8");
});

test("strange fruit restores energy and cures poison, without healing", () => {
  const player = createPlayer({ hp: 40 });
  player.give(0, id("STRANGE_FRUIT"));
  player.eat(0);
  assert.equal(player.hp, 40);
  assert.equal(player.energy, 80);
  assert.deepEqual(player.messages, ["You eat the fruit. It tastes great, some of your energy is restored!"]);
});
