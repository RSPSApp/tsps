// Run after `yarn build`: node --test tests/scurrius.test.cjs
// Scurrius: the ids against the cache's gamevals, the lair's ways in and out, the fight's phases,
// rubble and rats, the food piles, the kill count and loot, and Historian Aldo's lamps, each
// against the captures and Wiki facts in docs/scurrius.md.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const Scurrius = require("../plugins/bosses/Scurrius.plugin");
const Common = require("../plugins/bosses/scurrius/Common.Scurrius");
const Fight = require("../plugins/bosses/scurrius/Fight.Scurrius");
const Lair = require("../plugins/bosses/scurrius/Lair.Scurrius");
const FoodPile = require("../plugins/bosses/scurrius/FoodPile.Scurrius");
const Kills = require("../plugins/bosses/scurrius/Kills.Scurrius");
const Aldo = require("../plugins/bosses/scurrius/Aldo.Scurrius");

const core = PluginManager.getCoreApi();
const objectHooks = new Map();
const npcHooks = new Map();
const events = [];
const prompts = [];
const api = new Proxy({
  core,
  onObjectInteraction: (name, actions) => objectHooks.set(name, { ...(objectHooks.get(name) ?? {}), ...actions }),
  onNpcInteraction: (name, actions) => npcHooks.set(name, { ...(npcHooks.get(name) ?? {}), ...actions }),
  emitCustomEvent: (name, payload) => {
    events.push({ name, payload });
    if (name === "combat-achievements:kill") payload.announce?.(7);
  },
  sendMultiChatboxPrompt: (player, title, ...pairs) => {
    prompts.push({ title, options: pairs.filter((value) => typeof value === "string"), pairs });
    return true;
  },
}, { get: (target, key) => target[key] ?? (() => {}) });

let gamevals = null;
const runTicks = (n = 1) => { for (let i = 0; i < n; i++) TaskManager.process(); };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  new NpcDefinitionLoader().load();
  gamevals = new Gamevals();
  Scurrius.register(api);
});

function createPlayer({ x = 3295, y = 9867, hp = 50, maxHp = 99, items = {} } = {}) {
  const log = [];
  const attributes = new Map();
  const inventory = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  let location = new Location(x, y, 0);
  let current = hp;
  const sender = new Proxy({}, {
    get: (_target, method) => (...args) => {
      if (method === "sendVarbit") log.push(`varbit ${args[0]} ${args[1]}`);
      if (method === "sendSound") log.push(`sound ${args[0]}`);
      if (method === "sendSong") log.push(`song ${args[0]}`);
      if (method === "sendSubInterface") log.push(`fade ${args[3]?.postScripts?.[0]?.args?.[1]}`);
      return sender;
    },
  });
  const player = {
    log,
    isPlayer: () => true,
    isRegistered: () => true,
    getLocation: () => location,
    moveTo: (to) => { location = to; log.push(`move ${to.getX()} ${to.getY()}`); },
    area: null,
    getArea: () => player.area,
    setArea: (area) => { player.area = area; },
    getPrivateArea: () => (player.area instanceof core.PrivateArea ? player.area : null),
    getIndex: () => 1,
    isNpc: () => false,
    getAsPlayer: () => player,
    getHitpoints: () => current,
    performAnimation: (animation) => log.push(`anim ${animation.getId?.() ?? animation.id}`),
    getMovementQueue: () => {
      const queue = { reset: () => queue, setBlockMovement: () => queue, isMovementBlocked: () => false };
      return queue;
    },
    getPacketSender: () => sender,
    sendMessage: (text) => log.push(`message ${text}`),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({
      getCurrentLevel: () => current,
      getMaxLevel: () => maxHp,
      setCurrentLevel: (_skill, level) => { current = level; },
    }),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      deleteNumber: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
      adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount),
    }),
    getDialogueManager: () => ({ startDialogues: () => log.push("dialogue") }),
    inventory,
  };
  return player;
}

// ------------------------------------------------------------------ the cache

test("the ids are the cache's rat_boss gamevals", () => {
  const npc = gamevals.namesOf(GamevalKind.NPC);
  assert.equal(npc.get(Common.PUBLIC_ID), "rat_boss_normal");
  assert.equal(npc.get(Common.SOLO_ID), "rat_boss_instance");
  assert.equal(npc.get(Common.RAT_ID), "rat_boss_giant_rat");
  assert.equal(npc.get(Common.ALDO_ID), "rat_boss_biologist_op2");
  const seq = gamevals.namesOf(GamevalKind.SEQ);
  for (const [key, id] of Object.entries(Common.ANIM)) assert.match(seq.get(id), /^npc_rat_boss_/, key);
  assert.equal(seq.get(Common.ANIM.melee), "npc_rat_boss_attack_melee_02");
  assert.equal(seq.get(Common.ANIM.enragedSummon), "npc_rat_boss_enrage_02");
  const spotanim = gamevals.namesOf(GamevalKind.SPOTANIM);
  for (const [key, id] of Object.entries(Common.GFX)) assert.match(spotanim.get(id), /^vfx_rat_boss_/, key);
  const varbit = gamevals.namesOf(GamevalKind.VARBIT);
  assert.equal(varbit.get(Lair._test.WARNING_VARBIT), "rat_boss_enter_warning");
  assert.equal(varbit.get(FoodPile._test.COOLDOWN_VARBIT), "rat_boss_food_pile_player_eat_delay");
  const loc = gamevals.namesOf(GamevalKind.LOC);
  assert.equal(loc.get(14203), "rat_boss_entrance");
  assert.equal(loc.get(14204), "rat_boss_exit");
});

test("Scurrius' stats and the lair's locs are the cache's", () => {
  assert.equal(CacheDefinitions.getNpc(Common.PUBLIC_ID).hitpoints, 1500);
  assert.equal(CacheDefinitions.getNpc(Common.SOLO_ID).hitpoints, 500);
  assert.equal(CacheDefinitions.getNpc(Common.SOLO_ID).size, 3);
  assert.deepEqual(CacheDefinitions.getNpc(Common.ALDO_ID).actions.filter(Boolean), ["Talk-to", "Trade"]);
  assert.deepEqual(Object.keys(objectHooks.get("Broken bars")), ["Climb-through (normal)", "Climb-through (private)", "Peek (normal)"]);
  assert.deepEqual(Object.keys(objectHooks.get("Sewage water")), ["Cross", "Quick-escape"]);
  assert.deepEqual(Object.keys(objectHooks.get("Food Pile")), ["Eat"]);
  assert.ok(npcHooks.get("Historian Aldo").Trade);
  assert.equal(Scurrius.members, true);
});

test("the combat definitions use his own animations, with no block", () => {
  const defs = require("../data/definitions/npc-combat-defs.json").npcs;
  for (const id of [Common.PUBLIC_ID, Common.SOLO_ID]) {
    assert.deepEqual(defs[id].anims, { attack: Common.ANIM.melee, block: -1, death: Common.ANIM.death });
    assert.equal(defs[id].deathTicks, 5);
  }
});

test("the lair's floor, spawn, middle and feeding spots are walkable", () => {
  const free = ([x, y]) => !RegionManager.blocked(new Location(x, y, 0), null);
  assert.ok(free(Common.SPAWN_TILE));
  assert.ok(free(Common.CENTRE_TILE));
  assert.ok(free(Common.INSIDE_TILE));
  assert.ok(free(Common.OUTSIDE_TILE));
  for (const spot of Common.FEEDING_SPOTS) assert.ok(free(spot.stand), String(spot.stand));
  assert.ok(Common.inLair(new Location(...Common.INSIDE_TILE)));
  assert.ok(!Common.inLair(new Location(...Common.OUTSIDE_TILE)));
});

// ------------------------------------------------------------------ the lair

test("the bars ask first, and 'don't ask again' sets varbit 9589", () => {
  const player = createPlayer({ x: 3283, y: 9867 });
  prompts.length = 0;
  objectHooks.get("Broken bars")["Climb-through (private)"]({ player });
  assert.equal(prompts[0].title, "Are you sure you want to climb through the broken bars? (private)");
  assert.deepEqual(prompts[0].options, ["Yes.", "Yes, and don't ask again.", "No."]);
  const dontAsk = prompts[0].pairs[3];
  dontAsk();
  assert.equal(player.getAttribute(Lair._test.SKIP_WARNING_ATTRIBUTE), true);
  assert.ok(player.log.includes("varbit 9589 1"));
  // The instance claims the player with the move.
  runTicks(3);
  assert.ok(player.getArea() instanceof Lair._test.instanceClass());
  assert.equal(player.getAttribute(Lair._test.INSTANCE_ATTRIBUTE), true);
  runTicks(3);
});

test("climbing through fades, moves the player in on the captured tick, and plays Oh Rats!", () => {
  const player = createPlayer({ x: 3283, y: 9867 });
  player.setAttribute(Lair._test.SKIP_WARNING_ATTRIBUTE, true);
  objectHooks.get("Broken bars")["Climb-through (normal)"]({ player });
  assert.deepEqual(player.log.slice(0, 2), ["anim 828", "sound 7655"]);
  assert.ok(player.log.includes("fade 255"));
  runTicks(2);
  assert.ok(!player.log.some((line) => line.startsWith("move")));
  runTicks(1);
  assert.ok(player.log.includes("move 3290 9868"));
  runTicks(1);
  assert.ok(player.log.includes("song 777"));
  assert.ok(player.log.includes("fade 0"));
});

test("crossing the sewage water thinks first; the quick escape doesn't", () => {
  const crossing = createPlayer({ x: 3289, y: 9867 });
  objectHooks.get("Sewage water").Cross({ player: crossing });
  assert.equal(crossing.log[0], "anim 857");
  runTicks(4);
  assert.ok(crossing.log.includes("move 3279 9869"));
  assert.ok(crossing.log.includes("song 144"));
  const escaping = createPlayer({ x: 3289, y: 9867 });
  objectHooks.get("Sewage water")["Quick-escape"]({ player: escaping });
  assert.ok(!escaping.log.some((line) => line.startsWith("anim")));
  runTicks(4);
  assert.ok(escaping.log.includes("move 3279 9869"));
});

test("Peek counts the players inside", () => {
  assert.equal(Lair._test.peekText(0), "There are no adventurers through the broken bars.");
  assert.equal(Lair._test.peekText(1), "There is 1 adventurer through the broken bars.");
  assert.equal(Lair._test.peekText(3), "There are 3 adventurers through the broken bars.");
});

test("a player who logged out in a private instance logs in outside", () => {
  const player = createPlayer({ x: 3295, y: 9867 });
  player.setAttribute(Lair._test.INSTANCE_ATTRIBUTE, true);
  Lair._test.onLogin({ player });
  assert.ok(player.log.includes("move 3279 9869"));
  assert.equal(player.getAttribute(Lair._test.INSTANCE_ATTRIBUTE), false);
});

// ------------------------------------------------------------------ the fight

test("each phase picks only its captured attacks, and rats stop after twelve waves", () => {
  const { pickAction, RAT_WAVE_LIMIT } = Fight._test;
  const seen = (state) => new Set(Array.from({ length: 400 }, () => pickAction(state)));
  assert.deepEqual([...seen({ phase: "combat", ratWaves: 0 })].sort(), ["melee", "stomp"]);
  assert.deepEqual([...seen({ phase: "feeding", ratWaves: 0 })].sort(), ["magic", "ranged", "stomp", "summon"]);
  assert.deepEqual([...seen({ phase: "enraged", ratWaves: 0 })].sort(), ["magic", "ranged", "stomp", "summon"]);
  assert.ok(!seen({ phase: "enraged", ratWaves: RAT_WAVE_LIMIT }).has("summon"));
});

test("in phase one he stomps one attack in five beside his target, and only stomps out of reach", () => {
  const { pickAction, PHASE_ONE } = Fight._test;
  assert.deepEqual(PHASE_ONE, [["melee", 4], ["stomp", 1]]);
  const state = { phase: "combat", ratWaves: 0 };
  assert.deepEqual(new Set(Array.from({ length: 100 }, () => pickAction(state, 0, false))), new Set(["stomp"]));
});

test("he melees beside his target and stomps from range while closing in, but keeps his place eating", () => {
  const Method = Fight._test.defineCombatMethod();
  const flags = new Set();
  let target = null;
  const npc = {
    getSize: () => 3,
    getLocation: () => new Location(3298, 9866, 0),
    getCombat: () => ({ getTarget: () => target }),
    setFlag: (name) => flags.add(name),
    removeFlag: (name) => flags.delete(name),
  };
  const method = new Method();
  target = createPlayer({ x: 3301, y: 9867 });
  assert.equal(method.attackDistance(npc), 1);
  assert.equal(method.type(), core.CombatType.MELEE);
  assert.ok(flags.has("combat:close-in"));
  target = createPlayer({ x: 3305, y: 9867 });
  assert.equal(method.attackDistance(npc), 20);
  assert.equal(method.type(), core.CombatType.RANGED);
  Fight.stateOf(npc).phase = "feeding";
  assert.equal(method.attackDistance(npc), 20);
});

test("the rubble lands nine ticks after the stomp, on the players still on its tiles", () => {
  const players = [createPlayer({ x: 3293, y: 9864 }), createPlayer({ x: 3300, y: 9870 })];
  const hits = new Map(players.map((player) => [player, []]));
  for (const player of players) {
    player.getCombat = () => ({ getHitQueue: () => ({ addPendingDamage: (damage) => hits.get(player).push(damage[0].getDamage()) }) });
  }
  const boss = {
    getId: () => Common.SOLO_ID,
    getPrivateArea: () => null,
    getHitpoints: () => 500,
    isRegistered: () => true,
    getPlayersWithinDistance: () => players,
  };
  const rubble = new Set();
  const sender = players[0].getPacketSender();
  players[0].getPacketSender = () => new Proxy(sender, {
    get: (target, method) => (method === "sendGlobalGraphic"
      ? (_graphic, tile) => { rubble.add(`${tile.getX()},${tile.getY()}`); return target; }
      : target[method]),
  });
  Fight._test.stomp(boss);
  assert.equal(rubble.size, Fight._test.ROCKFALL_TILES);
  // The second player steps off onto a clear tile before it lands.
  let clear = null;
  for (let x = Common.FLOOR.minX; !clear && x <= Common.FLOOR.maxX; x++) {
    if (!rubble.has(`${x},9867`)) clear = new Location(x, 9867, 0);
  }
  players[1].moveTo(clear);
  runTicks(8);
  assert.deepEqual([...hits.values()].map((list) => list.length), [0, 0]);
  runTicks(1);
  assert.equal(hits.get(players[0]).length, 1);
  assert.ok(hits.get(players[0])[0] >= 15 && hits.get(players[0])[0] <= 22);
  assert.equal(hits.get(players[1]).length, 0);
});

test("the rubble covers twelve floor tiles, one under each player", () => {
  const boss = { getPrivateArea: () => null };
  const players = [createPlayer({ x: 3293, y: 9864 }), createPlayer({ x: 3300, y: 9870 })];
  const tiles = Fight._test.rockfallTiles(boss, players);
  assert.equal(tiles.length, Fight._test.ROCKFALL_TILES);
  assert.equal(new Set(tiles.map((tile) => `${tile.getX()},${tile.getY()}`)).size, tiles.length);
  for (const player of players) assert.ok(tiles.some((tile) => tile.equals(player.getLocation())));
  for (const tile of tiles) assert.ok(Common.within(Common.FLOOR, tile));
});

test("max hits follow the Wiki for each version", () => {
  assert.deepEqual(Fight._test.maxHitsFor({ getId: () => Common.SOLO_ID }), { melee: 13, magic: 8, ranged: 7, rockfall: 22 });
  assert.deepEqual(Fight._test.maxHitsFor({ getId: () => Common.PUBLIC_ID }), { melee: 13, magic: 14, ranged: 13, rockfall: 24 });
});

test("any player's hit kills a summoned rat", () => {
  const hits = [{ damage: 0, setDamage(value) { this.damage = value; } }];
  let updated = false;
  const hit = { getAttacker: () => ({ isPlayer: () => true }), getHits: () => hits, updateTotalDamage: () => { updated = true; } };
  Fight._test.oneShotRat({ npc: { getId: () => Common.RAT_ID, getHitpoints: () => 15 }, hit });
  assert.equal(hits[0].damage, 15);
  assert.ok(updated);
});

// ------------------------------------------------------------------ the food piles

test("a food pile heals to full once every ten minutes, out of combat", () => {
  const { MESSAGES, ATE_AT_ATTRIBUTE, minutesLeft } = FoodPile._test;
  const player = createPlayer({ hp: 20 });
  player.getCombat = () => ({});
  const eat = objectHooks.get("Food Pile").Eat;
  core.CombatFactory.inCombat = ((original) => (mobile) => (mobile === player ? false : original(mobile)))(core.CombatFactory.inCombat);
  eat({ player });
  assert.equal(player.log[0], "anim 827");
  runTicks(1);
  assert.ok(player.log.includes("anim 829"));
  assert.ok(player.log.includes(`message ${MESSAGES.eat}`));
  assert.equal(player.getHitpoints(), 99);
  assert.ok(player.log.includes("varbit 9581 10"));
  assert.equal(minutesLeft(player), 10);
  player.getSkillManager().setCurrentLevel(null, 50);
  eat({ player });
  assert.ok(player.log.includes(`message ${MESSAGES.cooldown(10)}`));
  player.setAttribute(ATE_AT_ATTRIBUTE, Date.now() - 10 * 60_000);
  assert.equal(minutesLeft(player), 0);
});

// ------------------------------------------------------------------ kills and loot

test("everyone who helped gets the kill count message", () => {
  events.length = 0;
  const killer = createPlayer();
  const helper = createPlayer();
  Kills._test.onDeath({ npc: { getId: () => Common.PUBLIC_ID }, killer, damagers: [helper, killer] });
  const kills = events.filter((event) => event.name === "combat-achievements:kill");
  assert.equal(kills.length, 2);
  assert.ok(kills.every((event) => event.payload.monster === "Scurrius"));
  assert.ok(killer.log.includes("message Your Scurrius kill count is: <col=ff0000>7</col>."));
  const monsters = require("../plugins/achievements/combatachievements/data/monsters.json");
  assert.ok(monsters.countedByEvent.includes("Scurrius"), "counted here, not by Combat Achievements' own death hook");
});

test("the loot lands on his middle tile", () => {
  const npc = { getId: () => Common.SOLO_ID, getLocation: () => new Location(3298, 9867, 0), getSize: () => 3 };
  const where = { npc, location: npc.getLocation() };
  Kills._test.onLocation(where);
  assert.equal(where.location.getX(), 3299);
  assert.equal(where.location.getY(), 9868);
});

// ------------------------------------------------------------------ Historian Aldo

test("Aldo swaps every spine for an antique lamp", () => {
  const { ItemIdentifiers } = core;
  const player = createPlayer({ items: { [ItemIdentifiers.SCURRIUS_SPINE]: 3 } });
  prompts.length = 0;
  npcHooks.get("Historian Aldo").Trade({ player, npc: { getId: () => Common.ALDO_ID } });
  assert.equal(prompts[0].title, "Trade ALL your Scurrius spines for combat lamps?");
  prompts[0].pairs[1]();
  assert.equal(player.inventory.get(ItemIdentifiers.SCURRIUS_SPINE), 0);
  assert.equal(player.inventory.get(ItemIdentifiers.ANTIQUE_LAMP_35), 3);
  const single = createPlayer({ items: { [ItemIdentifiers.SCURRIUS_SPINE]: 1 } });
  prompts.length = 0;
  npcHooks.get("Historian Aldo").Trade({ player: single, npc: { getId: () => Common.ALDO_ID } });
  assert.equal(prompts[0].title, "Trade Scurrius' spine for a combat lamp?");
});

test("the lamp offers its seven skills over two pages", () => {
  const pages = Aldo._test.lampSkills().map((page) => page.map(([name]) => name));
  assert.deepEqual(pages, [["Attack", "Strength", "Defence", "Prayer"], ["Ranged", "Magic", "Hitpoints"]]);
  assert.equal(Aldo._test.LAMP_XP, 5000);
  assert.equal(Aldo._test.PRAYER_LAMP_XP, 3500);
});

// ------------------------------------------------------------------ follow-ups

test("leaving keeps the player out for 26 ticks, counted down as captured", () => {
  const { exhaustedText, LEFT_AT_ATTRIBUTE, REENTRY_TICKS } = Lair._test;
  assert.equal(REENTRY_TICKS, 26);
  // Recording 83: 14, 9, 4 and 1 ticks left gave 8, 5, 2 seconds and "another second".
  assert.equal(exhaustedText(14), "You are exhausted after climbing over the broken bars. Please wait for another 8 seconds.");
  assert.equal(exhaustedText(9), "You are exhausted after climbing over the broken bars. Please wait for another 5 seconds.");
  assert.equal(exhaustedText(4), "You are exhausted after climbing over the broken bars. Please wait for another 2 seconds.");
  assert.equal(exhaustedText(1), "You are exhausted after climbing over the broken bars. Please wait for another second.");
  const player = createPlayer({ x: 3279, y: 9869 });
  player.setAttribute(LEFT_AT_ATTRIBUTE, core.World.getProcessCycle());
  prompts.length = 0;
  objectHooks.get("Broken bars")["Climb-through (normal)"]({ player });
  assert.equal(prompts.length, 0);
  assert.ok(player.log.some((line) => line.startsWith("message You are exhausted")));
});

test("no fires in the lair, and its deaths' graves go beside Aldo", () => {
  const fire = { location: new Location(3295, 9867, 0), allowed: true, message: null };
  Lair._test.refuseFire(fire);
  assert.equal(fire.allowed, false);
  assert.equal(fire.message, "It's far too damp for you to light a fire here.");
  const outside = { location: new Location(3279, 9869, 0), allowed: true, message: null };
  Lair._test.refuseFire(outside);
  assert.equal(outside.allowed, true);
  const grave = { location: new Location(3300, 9866, 0), tile: null };
  Lair._test.graveBesideAldo(grave);
  assert.deepEqual(grave.tile, { x: 3276, y: 9871, z: 0 });
});

test("only one player gets a spine per kill", () => {
  const spine = core.ItemIdentifiers.SCURRIUS_SPINE;
  const killer = [{ itemId: 532, amount: 1 }, { itemId: spine, amount: 1 }];
  const helper = [{ itemId: spine, amount: 1 }, { itemId: 532, amount: 1 }];
  Kills._test.oneSpine([killer, helper]);
  assert.ok(killer.some((drop) => drop.itemId === spine));
  assert.ok(!helper.some((drop) => drop.itemId === spine));
});

test("Ironmen keep only medium clues from a group kill", () => {
  const Loot = require("../plugins/modes/ironman/Loot.Ironman");
  const IronCommon = require("../plugins/modes/ironman/Common.Ironman");
  const handlers = new Map();
  const ironApi = new Proxy({
    core,
    onCustomEvent: (name, handler) => handlers.set(name, handler),
    emitCustomEvent: (name, payload) => { if (name === "ironman:shared-kill-keeps") Kills._test.ironmanKeeps(payload); },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  IronCommon.init(ironApi);
  Loot(ironApi);
  const iron = createPlayer();
  iron.setAttribute(IronCommon.MODE_ATTRIBUTE, "ironman");
  const drops = [{ itemId: 532, amount: 1 }, { itemId: core.ItemIdentifiers.CLUE_SCROLL_MEDIUM_, amount: 1 }];
  handlers.get("npc-drops:roll")({ player: iron, npc: { getId: () => Common.PUBLIC_ID }, npcId: Common.PUBLIC_ID, drops, damagers: [iron, createPlayer()] });
  assert.deepEqual(drops.map((drop) => drop.itemId), [core.ItemIdentifiers.CLUE_SCROLL_MEDIUM_]);
});

test("rat calls are at least 41 ticks apart, as captured", () => {
  const { pickAction, RAT_CALL_COOLDOWN_TICKS } = Fight._test;
  assert.equal(RAT_CALL_COOLDOWN_TICKS, 41);
  const seen = (state, now) => new Set(Array.from({ length: 300 }, () => pickAction(state, now)));
  assert.ok(!seen({ phase: "enraged", ratWaves: 1, lastCallAt: 100 }, 140).has("summon"));
  assert.ok(seen({ phase: "enraged", ratWaves: 1, lastCallAt: 100 }, 141).has("summon"));
});
