// Run after `yarn build`: node --test tests/family-crest-perfect-gold.test.cjs
// Family Crest's perfect gold (issue #5735 item 3). Wiki, Gold rocks (raw): the gold rocks of the Witchaven Dungeon are
// ordinary gold rocks (Mining 40, 65 XP, depleting, a minute to respawn) that give 'perfect' gold ore instead of gold ore.
// They were credited on the click itself, with no mining action, roll, XP or depletion. Real engine: every plugin loaded,
// a real Player, the real Mining task run by hand.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

let core, next = 9900;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const ROCK_ID = 11371;
/** Wiki, Gold rocks, Witchaven Dungeon object locations. */
const WIKI_TILES = [[2740, 9700], [2743, 9699], [2732, 9680], [2743, 9676]];
const CRAFTING_GUILD = [2933, 3288];
const NO_PICKAXE = "You need a pickaxe to mine this rock. You do not have a pickaxe which you have the Mining level to use.";
const GATE_MESSAGE = "This gold does not look special to you.";

function actor(t, { stage = 7, level = 99, pickaxe = core.ItemIdentifiers.RUNE_PICKAXE, at = [2732, 9681] } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("fcgold" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at[0], at[1], 0)); p.needsPlacement = false;
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  p.getSkillManager().setMaxLevels(core.Skill.MINING, level, false); p.getSkillManager().setCurrentLevels(core.Skill.MINING, level, false);
  const quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === "family_crest");
  assert.ok(quest); quest.setStage(p, stage);
  if (pickaxe) p.getInventory().add(new core.Item(pickaxe, 1), false);
  const messages = [], boxes = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  // Mining's refusals are message boxes (rsprox recordings): read the box text, as tests/mining-parity does.
  t.mock.method(p, "getDialogueManager", () => new Proxy({
    startDialogues: (chain) => boxes.push(chain.getDialogues().get(0).getText().replace(/<br>/g, " ")),
  }, { get: (target, key) => target[key] ?? (() => {}) }));
  return { p, messages, boxes };
}

/** A real rock object in the world at a tile, removed again afterwards. */
function placeRock(t, [x, y]) {
  const at = new core.Location(x, y, 0);
  core.RegionManager.loadMapFiles(x, y);
  // The map's own rock on that tile goes first, so the one placed here is the only 11371 there.
  for (const object of core.MapObjects.getObjectsAt(at, null)) if (object.getId() === ROCK_ID) core.ObjectManager.deregister(object, true);
  const rock = new core.GameObject(ROCK_ID, at, 10, 0, null);
  core.ObjectManager.register(rock, true);
  t.after(() => {
    for (const object of core.MapObjects.getObjectsAt(at, null)) if (object.getOwner() == null) core.ObjectManager.deregister(object, true);
  });
  return rock;
}

function click(f, rock) {
  const definition = ObjectDefinition.forId(ROCK_ID);
  const clickType = definition.getInteractions().findIndex((s) => /mine/i.test(s ?? "")) + 1;
  assert.ok(clickType > 0);
  const at = rock.getLocation(), from = f.p.getLocation();
  return PM.emitObjectInteraction({ player: f.p, object: rock, objectId: ROCK_ID, definition, clickType,
    location: { x: at.getX(), y: at.getY(), z: at.getZ() },
    sourceLocation: { x: from.getX(), y: from.getY(), z: from.getZ() }, handled: false });
}

const count = (f, id) => f.p.getInventory().getAmount(id);
const xp = (f) => f.p.getSkillManager().getExperience(core.Skill.MINING);
const miningTask = () => core.TaskManager.activeTasks.find((task) => task.constructor.name === "MiningTask");
const mining = (f) => { core.TaskManager.process(); return miningTask()?.activeSessions.has(f.p) === true; };

/** Ticks the world until `done` or `limit` ticks; every random draw is 0.001, which misses the gem roll and hits the ore roll. */
function runTicks(t, done, limit = 40) {
  if (!t.fcRandom) { t.mock.method(Math, "random", () => 0.001); t.fcRandom = true; }
  let ticks = 0;
  while (ticks < limit && !done()) { core.TaskManager.process(); ticks++; }
  return ticks;
}

test("the gold rocks of the Witchaven Dungeon are the Wiki's four tiles (the Family Crest region predicate holds for all of them and no others)", () => {
  core.RegionManager.loadMapFiles(2698, 9674);
  const found = [];
  for (let x = 42 * 64; x < 43 * 64; x++) for (let y = 151 * 64; y < 152 * 64; y++) {
    if (core.MapObjects.getObjectsAt(new core.Location(x, y, 0), null).some((object) => object.getId() === ROCK_ID)) found.push([x, y]);
  }
  assert.deepEqual(found.sort(), [...WIKI_TILES].sort(), "every 11371 in region 42,151 is one of the Wiki's four Witchaven tiles");
});

test("a click starts the mining action: nothing is credited that tick, then one perfect gold ore, 65 XP and the rock is mined out", (t) => {
  const f = actor(t), rock = placeRock(t, WIKI_TILES[2]);
  const xpBefore = xp(f);
  assert.equal(click(f, rock), true, "Mining takes the click");
  assert.equal(mining(f), true, "a mining session began");
  assert.equal(count(f, core.ItemIdentifiers.PERFECT_GOLD_ORE), 0, "no perfect gold ore on the click");
  assert.equal(count(f, core.ItemIdentifiers.GOLD_ORE), 0);
  assert.equal(xp(f), xpBefore, "no XP on the click");
  const at = rock.getLocation();
  const ticks = runTicks(t, () => count(f, core.ItemIdentifiers.PERFECT_GOLD_ORE) > 0);
  assert.ok(ticks > 0, "the ore came after the mining action's ticks");
  assert.equal(count(f, core.ItemIdentifiers.PERFECT_GOLD_ORE), 1);
  assert.equal(count(f, core.ItemIdentifiers.GOLD_ORE), 0, "'perfect' ore instead of gold ore");
  assert.equal(xp(f) - xpBefore, 65);
  assert.equal(core.MapObjects.get(ROCK_ID, at, null), null, "the rock depleted");
  const depleted = core.MapObjects.getObjectsAt(at, null).filter((object) => object.getId() !== ROCK_ID);
  assert.equal(depleted.length, 1, "a mined-out rock stands in its place");
  assert.equal(ObjectDefinition.forId(depleted[0].getId()).getName(), "Rocks");
  runTicks(t, () => core.MapObjects.get(ROCK_ID, at, null) != null, 105);
  assert.ok(core.MapObjects.get(ROCK_ID, at, null), "the rock is back after its 100-tick (one minute) respawn");
});

test("before Boot has told you about it the rock is left alone: the old message, no mining, no ore", (t) => {
  const f = actor(t, { stage: 6 }), rock = placeRock(t, WIKI_TILES[2]);
  const xpBefore = xp(f);
  assert.equal(click(f, rock), true, "Family Crest takes the click, before Mining");
  assert.ok(f.messages.includes(GATE_MESSAGE), f.messages.join(" | "));
  assert.equal(mining(f), false, "Mining did not start");
  runTicks(t, () => false, 12);
  assert.equal(count(f, core.ItemIdentifiers.PERFECT_GOLD_ORE) + count(f, core.ItemIdentifiers.GOLD_ORE), 0);
  assert.equal(xp(f), xpBefore);
});

test("Mining's own refusals stand: level 39 and no pickaxe give no ore and Mining's message", (t) => {
  const low = actor(t, { level: 39, pickaxe: core.ItemIdentifiers.BRONZE_PICKAXE }), rock = placeRock(t, WIKI_TILES[2]);
  assert.equal(click(low, rock), false);
  assert.deepEqual(low.boxes, ["You need a Mining level of 40 to mine this rock."]);
  assert.equal(mining(low), false);
  const none = actor(t, { pickaxe: null });
  assert.equal(click(none, rock), false);
  assert.deepEqual(none.boxes, [NO_PICKAXE]);
  assert.equal(mining(none), false);
  runTicks(t, () => false, 12);
  for (const f of [low, none]) assert.equal(count(f, core.ItemIdentifiers.PERFECT_GOLD_ORE) + count(f, core.ItemIdentifiers.GOLD_ORE), 0);
});

for (const name of ["CRYSTAL_PICKAXE", "INFERNAL_PICKAXE", "DRAGON_PICKAXE", "_3RD_AGE_PICKAXE"]) {
  test(`a ${name} is accepted: Mining starts its action with no refusal and no ore on the click`, (t) => {
    const f = actor(t, { pickaxe: core.ItemIdentifiers[name] }), rock = placeRock(t, WIKI_TILES[2]);
    assert.equal(click(f, rock), true);
    assert.equal(mining(f), true);
    assert.deepEqual(f.boxes, []);
    assert.equal(count(f, core.ItemIdentifiers.PERFECT_GOLD_ORE) + count(f, core.ItemIdentifiers.GOLD_ORE), 0);
  });
}

test("another gold rock of the same loc id (the Crafting Guild's) stays plain gold ore, and Family Crest does not handle it, whatever the quest stage", (t) => {
  const f = actor(t, { stage: 0, at: [CRAFTING_GUILD[0], CRAFTING_GUILD[1] + 1] }), rock = placeRock(t, CRAFTING_GUILD);
  assert.equal(click(f, rock), true, "Mining takes it");
  assert.ok(!f.messages.includes(GATE_MESSAGE), "no Family Crest gate message");
  assert.equal(mining(f), true);
  runTicks(t, () => count(f, core.ItemIdentifiers.GOLD_ORE) > 0);
  assert.equal(count(f, core.ItemIdentifiers.GOLD_ORE), 1);
  assert.equal(count(f, core.ItemIdentifiers.PERFECT_GOLD_ORE), 0);
});

test("the ore-yield listener changes only a Witchaven gold rock's gold ore, and works on a request with no rock", () => {
  const I = core.ItemIdentifiers, yieldAt = (x, y, over = {}) => {
    const request = { rock: "Gold rocks", rockObject: new core.GameObject(ROCK_ID, new core.Location(x, y, 0), 10, 0, null), oreId: I.GOLD_ORE, amount: 1, spend: null, ...over };
    PM.emitCustomEvent("mining:ore-yield", request);
    return request;
  };
  for (const [x, y] of WIKI_TILES) assert.equal(yieldAt(x, y).oreId, I.PERFECT_GOLD_ORE, `${x},${y}`);
  assert.equal(yieldAt(...CRAFTING_GUILD).oreId, I.GOLD_ORE);
  assert.equal(yieldAt(2732, 9680, { rock: "Iron rocks" }).oreId, I.GOLD_ORE);
  assert.equal(yieldAt(2732, 9680, { oreId: I.IRON_ORE }).oreId, I.IRON_ORE);
  const bare = { rock: "Gold rocks", oreId: I.GOLD_ORE, amount: 1, spend: null };
  PM.emitCustomEvent("mining:ore-yield", bare);
  assert.deepEqual([bare.oreId, bare.amount, bare.spend], [I.GOLD_ORE, 1, null], "a request without the rock changes nothing and does not throw");
});
