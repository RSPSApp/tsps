// Run after `yarn build`: node --test tests/sailing-salvage-sorting.test.cjs
// Sorting salvage at a salvaging station: Opulent salvage's shared seed, herb and gem tables
// (through NpcDrops), the Sailors' amulet duplicate rule, clues and Soup, the find line's
// format and chat type, the level refusal, and the line after the last salvage.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { Location } = require("../dist/game/model/Location");
const { Item } = require("../dist/game/model/Item");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PluginManager } = require("../dist/plugins/PluginManager");

const OPULENT = 32861;
const SMALL = 32847;
const COINS = 995;
const RING_OF_WEALTH = 2572;
const GRIMY_AVANTOE = 211;
const SAILORS_AMULET_INERT = 32398;
const FACILITY_BOTTLE = 33074;

let plugin, hooks, handlers, emitted, data;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  hooks = {};
  handlers = {};
  emitted = [];
  const core = PluginManager.getCoreApi();
  const emitCustomEvent = (name, event) => {
    emitted.push([name, event]);
    handlers[name]?.(event);
  };
  plugin = require("../plugins/skills/sailing/Salvaging.Sailing");
  plugin.register({
    core,
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
    onServerStartup: () => {},
    onPlayerLogout: () => {},
    emitCustomEvent,
  });
  // The real NpcDrops answers npc-drops:roll-shared with its shared tables.
  const drops = require("../plugins/npcs/NpcDrops.plugin");
  const noop = () => {};
  drops.register(new Proxy({ core, emitCustomEvent, getItemOnGroundManager: () => null,
    onCustomEvent: (name, handler) => { if (name === "npc-drops:roll-shared") handlers[name] = handler; } },
  { get: (target, key) => (key in target ? target[key] : noop) }));
  drops._test.loadDrops();
  data = require("../plugins/skills/sailing/data/sailing-salvage.json");
});

function player(level = 99) {
  const p = new Player(null);
  p.setUsername("salvageSort");
  p.setRegistered(true);
  p.setLocation(new Location(3000, 3000, 0));
  p.inventory = new Inventory(p);
  p.messages = [];
  p.getPacketSender = () => ({ sendSound: () => {}, sendSoundEffect: () => {}, sendClientScript: () => {},
    sendTypedMessage: (_type, text) => p.messages.push(`spam: ${text}`), sendItemContainer: () => {}, sendMessage: () => {} });
  p.sendMessage = (text) => p.messages.push(text);
  p.getSkillManager = () => ({ getCurrentLevel: () => level, addExperiences: () => {} });
  p.getMovementQueue = () => ({ size: () => 0 });
  p.getDialogueManager = () => ({ startDialogues: () => {} });
  p.performAnimation = () => {};
  return p;
}

/** A random source that plays back `values`, then repeats the last. */
function sequence(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** Sorts one salvage with Math.random playing `values` (the first is the sort's sound). */
function sortOne(p, salvage, values) {
  p.getInventory().add(new Item(salvage, 1), true);
  const random = Math.random;
  Math.random = sequence(values);
  try {
    hooks["Salvaging station"]["Sort-salvage"]({ player: p });
    for (let i = 0; i < 3; i++) TaskManager.process();
  } finally {
    Math.random = random;
    TaskManager.process();
  }
}

test("Opulent salvage's table fills its 424 with the four shared tables, 10/424 each", () => {
  const opulent = data.salvage[OPULENT];
  assert.equal(opulent.table.reduce((sum, line) => sum + line.weight, 0), opulent.total);
  assert.deepEqual(opulent.table.filter((line) => line.table).map((line) => [line.table, line.weight]),
    [["rareSeed", 10], ["usefulHerb", 10], ["combatHerb", 10], ["gem", 10]]);
  for (const salvage of Object.values(data.salvage)) {
    assert.equal(salvage.table.reduce((sum, line) => sum + line.weight, 0), salvage.total, `${salvage.name} has no empty slot`);
  }
});

test("a shared-table roll on Opulent salvage gives that table's item", () => {
  const p = player();
  // Skip the five pre-rolls, land on the useful herb table (394/424), then its first row.
  sortOne(p, OPULENT, [0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 395 / 424, 0, 0]);
  assert.equal(p.getInventory().getAmount(GRIMY_AVANTOE), 1);
  assert.ok(p.messages.includes("spam: You sort through the opulent salvage and find: 1 x Grimy avantoe."));
});

test("the gem table's empty slot gives one coin, with or without a ring of wealth", () => {
  const p = player();
  sortOne(p, OPULENT, [0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.99, 0]);
  assert.equal(p.getInventory().getAmount(COINS), 1);
  assert.ok(p.messages.includes("spam: You sort through the opulent salvage and find: 1 x Coins."));

  // The salvage variant has no "nothing" slot, so a worn ring of wealth leaves its pool alone.
  const q = player();
  const ring = new Item(RING_OF_WEALTH, 1);
  q.getEquipment = () => ({ get: () => ring, getAmount: () => 0 });
  sortOne(q, OPULENT, [0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.99, 0]);
  assert.equal(q.getInventory().getAmount(COINS), 1);
});

test("the last salvage sorted is followed by \"You have no more salvage to sort.\"", () => {
  const p = player();
  sortOne(p, SMALL, [0.999, 0.999, 0.999, 0.999, 0.15, 0.999]);
  assert.match(p.messages.at(-2), /^spam: You sort through the small salvage and find: /);
  assert.equal(p.messages.at(-1), "You have no more salvage to sort.");
});

test("Sailors' amulet isn't rolled while the player owns one", () => {
  const opulent = data.salvage[OPULENT];
  assert.deepEqual(plugin.rollLoot(opulent, () => 0), { item: SAILORS_AMULET_INERT, amount: 1, collectionLog: true });
  assert.deepEqual(plugin.rollLoot(opulent, () => 0, () => true), { item: FACILITY_BOTTLE, amount: 1, collectionLog: true }, "the next pre-roll");

  const p = player();
  p.getInventory().add(new Item(32399, 1), true);
  sortOne(p, OPULENT, [0.999, 0]);
  assert.equal(p.getInventory().getAmount(SAILORS_AMULET_INERT), 0);
  assert.equal(p.getInventory().getAmount(FACILITY_BOTTLE), 1);
});

test("sorting rolls Soup at 1/800,000 for every salvage", () => {
  emitted.length = 0;
  sortOne(player(), SMALL, [0.999]);
  const pet = emitted.filter(([name]) => name === "sailing:success");
  assert.equal(pet.length, 1);
  assert.equal(pet[0][1].petChance, 800000);
});

test("salvage clues: 1/300 medium from Barracuda salvage, 1/285 with the medium combat achievements", () => {
  const barracuda = data.salvage[32851];
  assert.deepEqual(barracuda.clue, { tier: "medium", oneIn: 300 });
  assert.deepEqual(data.salvage[SMALL].clue, { tier: "beginner", oneIn: 300 });
  assert.deepEqual(data.salvage[32849].clue, { tier: "easy", oneIn: 300, preRoll: true });
  assert.deepEqual(data.salvage[32857].clue, { tier: "hard", oneIn: 500, preRoll: true });

  const roll = (achievements, value) => {
    const p = player();
    handlers["combat-achievements:tier"] = (event) => { event.currentThresholdMet = achievements; };
    handlers["treasure-trails:can-receive"] = (event) => { event.allowed = true; };
    try {
      plugin.rollClue(p, barracuda.clue, () => value);
    } finally {
      delete handlers["combat-achievements:tier"];
      delete handlers["treasure-trails:can-receive"];
    }
    return p.getInventory().getAmount(2801);
  };
  assert.equal(roll(false, 0), 1, "a hit gives a medium clue scroll");
  assert.equal(roll(false, 1 / 290), 0, "1/290 misses 1/300");
  assert.equal(roll(true, 1 / 290), 1, "but hits 1/285");

  // No clue while the player can't hold another of the tier.
  const p = player();
  handlers["treasure-trails:can-receive"] = (event) => { event.allowed = false; };
  try {
    plugin.rollClue(p, barracuda.clue, () => 0);
  } finally {
    delete handlers["treasure-trails:can-receive"];
  }
  assert.equal(p.getInventory().getAmount(2801), 0);
});

test("pre-roll clues: a Fishy or Martial salvage clue replaces the sort's loot", () => {
  const FISHY = 32849;
  const MARTIAL = 32857;
  assert.equal(data.salvage[FISHY].clue.preRoll, true);
  assert.equal(data.salvage[MARTIAL].clue.preRoll, true);
  assert.equal(data.salvage[SMALL].clue.preRoll, undefined);
  assert.equal(data.salvage[32851].clue.preRoll, undefined);
  // Rolled ahead of the other pre-rolls, and only with a chance.
  assert.deepEqual(plugin.rollLoot(data.salvage[FISHY], () => 0, undefined, 285), { clue: true });
  assert.deepEqual(plugin.rollLoot(data.salvage[FISHY], () => 0), { item: 31989, amount: 1, collectionLog: true });

  const sort = (salvage, scroll, allowed) => {
    const p = player();
    handlers["treasure-trails:can-receive"] = (event) => { event.allowed = allowed; };
    try {
      sortOne(p, salvage, [0.999, 0, 0]);
    } finally {
      delete handlers["treasure-trails:can-receive"];
    }
    return p;
  };
  const easy = PluginManager.getCoreApi().ItemIdentifiers.CLUE_SCROLL_EASY_;
  const p = sort(FISHY, easy, true);
  assert.equal(p.getInventory().getAmount(easy), 1);
  assert.equal(p.getInventory().getAmount(31989), 0, "no boat bottle from the same sort");
  assert.ok(p.messages.includes("spam: You sort through the fishy salvage and find: 1 x Clue scroll (easy)."), "a clue isn't a collection log find");

  const hard = PluginManager.getCoreApi().ItemIdentifiers.CLUE_SCROLL_HARD_;
  const q = sort(MARTIAL, hard, true);
  assert.equal(q.getInventory().getAmount(hard), 1);
  assert.equal(q.getInventory().getAmount(SAILORS_AMULET_INERT), 0, "no amulet from the same sort");

  // Without room for another easy clue the pre-roll is skipped and the loot rolls as usual.
  const r = sort(FISHY, easy, false);
  assert.equal(r.getInventory().getAmount(easy), 0);
  assert.equal(r.getInventory().getAmount(31989), 1);
});

/** The table roll that lands on `name` in a salvage's table. */
function tableRoll(salvage, name) {
  let before = 0;
  for (const line of salvage.table) {
    if (line.name === name) return (before + 0.5) / salvage.total;
    before += line.weight;
  }
  throw new Error(`${name} isn't in ${salvage.name}'s table`);
}

test("the find line writes 1,000 or more with a thousands separator", () => {
  const opulent = data.salvage[OPULENT];
  const p = player();
  // Skip the five pre-rolls, land on Coins (1,000-5,000), then 3,504 of them.
  sortOne(p, OPULENT, [0.999, 0.999, 0.999, 0.999, 0.999, 0.999, tableRoll(opulent, "Coins"), 2504.5 / 4001]);
  assert.equal(p.getInventory().getAmount(COINS), 3504);
  assert.ok(p.messages.includes("spam: You sort through the opulent salvage and find: 3,504 x Coins."), p.messages.join(" | "));
});

test("a collection log find is a game message, every other find spam", () => {
  // Every pre-roll is one of its salvage's collection log items; of the tables, only Opulent
  // salvage's Dragon cannonball is.
  for (const salvage of Object.values(data.salvage)) {
    for (const line of salvage.preRolls) assert.equal(line.collectionLog, true, `${salvage.name}: ${line.name}`);
  }
  const logged = Object.values(data.salvage).flatMap((salvage) => salvage.table.filter((line) => line.collectionLog).map((line) => `${salvage.name}: ${line.name}`));
  assert.deepEqual(logged, ["Opulent salvage: Dragon cannonball"]);

  // Opulent salvage's Dragon nails (its third pre-roll), 2 of them.
  const p = player();
  sortOne(p, OPULENT, [0.999, 0.999, 0.999, 0, 0.5]);
  assert.equal(p.getInventory().getAmount(31406), 2);
  assert.ok(p.messages.includes("You sort through the opulent salvage and find: 2 x Dragon nails."), p.messages.join(" | "));

  // Its table's Dragon cannonball.
  const opulent = data.salvage[OPULENT];
  const q = player();
  sortOne(q, OPULENT, [0.999, 0.999, 0.999, 0.999, 0.999, 0.999, tableRoll(opulent, "Dragon cannonball"), 0]);
  assert.equal(q.getInventory().getAmount(31916), 2);
  assert.ok(q.messages.includes("You sort through the opulent salvage and find: 2 x Dragon cannonball."), q.messages.join(" | "));

  // A table find next to it stays spam.
  const r = player();
  sortOne(r, OPULENT, [0.999, 0.999, 0.999, 0.999, 0.999, 0.999, tableRoll(opulent, "Rune cannonball"), 0]);
  assert.ok(r.messages.includes("spam: You sort through the opulent salvage and find: 2 x Rune cannonball."), r.messages.join(" | "));
});

test("salvage above the player's level is left, and sorting ends with the level line", () => {
  const LARGE = 32853;
  // Only Large salvage (53) at level 40: nothing is sorted.
  const p = player(40);
  sortOne(p, LARGE, [0.999]);
  assert.equal(p.getInventory().getAmount(LARGE), 1);
  assert.deepEqual(p.messages, ["You do not have a high enough Sailing level to sort through any more salvage."]);

  // With Small salvage too, the Small one is sorted, then the line.
  const q = player(40);
  q.getInventory().add(new Item(LARGE, 1), true);
  sortOne(q, SMALL, [0.999, 0.999, 0.999, 0.999, 0.15, 0.999]);
  assert.equal(q.getInventory().getAmount(SMALL), 0);
  assert.equal(q.getInventory().getAmount(LARGE), 1);
  assert.equal(q.messages[0], "You begin sorting through your salvage...");
  assert.match(q.messages[1], /^spam: You sort through the small salvage and find: /);
  assert.equal(q.messages.at(-1), "You do not have a high enough Sailing level to sort through any more salvage.");
});
