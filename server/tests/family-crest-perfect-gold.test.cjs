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
  // As tests/leechfin-fishing.test.cjs: the region manager first, or loadMapFiles loads nothing.
  core.RegionManager.init();
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
  // Agility 99 as tests/quest-pickaxe-lookups does: Mining wields a crystal pickaxe only with 50 Agility.
  for (const [skill, at] of [[core.Skill.MINING, level], [core.Skill.AGILITY, 99]]) {
    p.getSkillManager().setMaxLevels(skill, at, false); p.getSkillManager().setCurrentLevels(skill, at, false);
  }
  const quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === "family_crest");
  assert.ok(quest); quest.setStage(p, stage);
  if (pickaxe) p.getInventory().add(new core.Item(pickaxe, 1), false);
  // Random draws miss until a test ticks the world (0.99 misses the gem and ore rolls; runTicks lowers it), so a click's
  // same-tick state is deterministic.
  if (!t.fcRandomInstalled) { t.fcRandomInstalled = true; t.fcRandom = 0.99; t.mock.method(Math, "random", () => t.fcRandom); }
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

/** Ticks the world until `done` or `limit` ticks; from here every random draw is 0.001, which misses the gem roll and hits the ore roll. */
function runTicks(t, done, limit = 40) {
  t.fcRandom = 0.001;
  let ticks = 0;
  while (ticks < limit && !done()) { core.TaskManager.process(); ticks++; }
  return ticks;
}

test("the gold rocks of the Witchaven Dungeon are the Wiki's four tiles (the Family Crest region predicate holds for all of them and no others)", () => {
  core.RegionManager.loadMapFiles(2698, 9674, false);
  const found = [], goldRockIds = new Set(), idsAtWiki = new Map(WIKI_TILES.map(([x, y]) => [`${x},${y}`, []]));
  let objects = 0, tiles = 0;
  for (let x = 42 * 64; x < 43 * 64; x++) for (let y = 151 * 64; y < 152 * 64; y++) {
    const here = core.MapObjects.getObjectsAt(new core.Location(x, y, 0), null);
    if (here.length) { tiles++; objects += here.length; }
    for (const object of here) {
      if (object.getId() === ROCK_ID) found.push([x, y]);
      let name = "?"; try { name = ObjectDefinition.forId(object.getId()).getName(); } catch (error) { /* unnamed */ }
      if (name === "Gold rocks") goldRockIds.add(object.getId());
      if (idsAtWiki.has(`${x},${y}`)) idsAtWiki.get(`${x},${y}`).push([object.getId(), name, object.getType()]);
    }
  }
  // The scan itself must have loaded the map: an empty region is a failed load, never 'no 11371 here'.
  assert.ok(objects > 0, `the scan loaded no objects at all in region 42,151 (tiles with objects ${tiles}): the map did not load, so nothing can be said about 11371`);
  // Diagnostics only on a mismatch: what the map really holds at the Wiki's tiles and how much of the region loaded.
  if (JSON.stringify(found.sort()) !== JSON.stringify([...WIKI_TILES].sort())) {
    assert.fail(`every 11371 in region 42,151 should be one of the Wiki's four Witchaven tiles; found ${JSON.stringify(found)}; region tiles with objects ${tiles}, objects ${objects}; gold-rock ids in the region ${JSON.stringify([...goldRockIds])}; objects at the Wiki tiles ${JSON.stringify([...idsAtWiki])}`);
  }
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

test("Varrock armour's extra ore from a Witchaven rock is gold ore, beside the perfect gold ore (Wiki, 'Perfect' gold ore)", (t) => {
  // Wiki: "one gold ore and one 'perfect' gold ore rather than two 'perfect' gold ore".
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => true);
  const f = actor(t), rock = placeRock(t, WIKI_TILES[2]);
  f.p.getEquipment().setItem(core.Equipment.BODY_SLOT, new core.Item(core.ItemIdentifiers.VARROCK_ARMOUR_1, 1));
  assert.equal(click(f, rock), true);
  runTicks(t, () => count(f, core.ItemIdentifiers.PERFECT_GOLD_ORE) > 0);
  assert.equal(count(f, core.ItemIdentifiers.PERFECT_GOLD_ORE), 1, "one perfect gold ore");
  assert.equal(count(f, core.ItemIdentifiers.GOLD_ORE), 1, "and the armour's extra ore is plain gold ore");
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
  click(low, rock);
  assert.deepEqual(low.boxes, ["You need a Mining level of 40 to mine this rock."]);
  assert.equal(mining(low), false);
  const none = actor(t, { pickaxe: null });
  click(none, rock);
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

test("Witchaven levers are personal and the six-pull solution permanently unlocks only that player", (t) => {
  const first = actor(t, { at: [2722, 9709] });
  const second = actor(t, { at: [2727, 9690] });
  t.after(() => {
    PM.emitPlayerLogout({ player: first.p });
    PM.emitPlayerLogout({ player: second.p });
  });
  const O = core.ObjectIdentifiers;
  const pull = (id, x, y) => {
    first.p.setLocation(new core.Location(x, y - 1, 0));
    const object = core.MapObjects.getPrivateArea(first.p, id, new core.Location(x, y, 0));
    assert.ok(object, "lever's current visible form resolves");
    const event = { player: first.p, object, objectId: id, definition: ObjectDefinition.forId(id),
      clickType: 1, location: { x, y, z: 0 }, handled: false };
    PM.emitObjectInteraction(event);
    assert.ok(event.handled);
  };
  const gate = (player) => {
    const event = { player, objectId: O.DOOR_76, handled: false };
    PM.emitCustomEvent("door:toggle", event);
    return event;
  };
  assert.ok(gate(first.p).handled, "gold door starts locked");
  pull(O.LEVER_11, 2722, 9710);
  assert.equal(first.p.getAttribute("family-crest:witchaven-levers"), 1);
  assert.equal(second.p.getAttribute("family-crest:witchaven-levers") ?? 0, 0);
  pull(O.LEVER_13, 2724, 9669);
  pull(O.LEVER_12, 2722, 9710);
  pull(O.LEVER_15, 2722, 9718);
  assert.ok(gate(first.p).handled, "north inner alone does not bypass the south lever");
  pull(O.LEVER_11, 2722, 9710);
  pull(O.LEVER_14, 2724, 9669);
  assert.equal(first.p.getAttribute("family-crest:perfect-gold-unlocked"), true);
  assert.equal(gate(first.p).handled, false);
  assert.ok(gate(second.p).handled, "another player must solve the puzzle independently");
  pull(O.LEVER_16, 2722, 9718);
  assert.equal(gate(first.p).handled, false, "later lever changes preserve the permanent unlock");
});
