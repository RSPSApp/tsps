// Run after `yarn build`: node --test tests/settings-skilling-notices.test.cjs
// All Settings' skilling notices: the clue scroll warnings (374-379) for clues rolled by skilling
// (clue nests, geodes, bottles, the Agility dispenser, salvage and Hunter's bird houses, aerial
// fishing, implings and drift nets), and the level-up chatbox list
// (493). Real engine: every plugin loaded and a real Player.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Capacity = require("../plugins/treasuretrails/Capacity.ClueCapacity");
const ClueNests = require("../plugins/skills/woodcutting/ClueNests.Woodcutting");
const ClueGeodes = require("../plugins/skills/mining/ClueGeodes.Mining");
const ClueBottles = require("../plugins/skills/fishing/ClueBottles.Fishing");
const AgilityDispenser = require("../plugins/skills/AgilityDispenser.plugin");
const Salvaging = require("../plugins/skills/sailing/Salvaging.plugin");
const Aerial = require("../plugins/skills/hunter/Aerial.Hunter");
const Birdhouses = require("../plugins/skills/hunter/Birdhouses.Hunter");
const Catching = require("../plugins/skills/hunter/Catching.Hunter");
const DriftNets = require("../plugins/skills/hunter/DriftNets.Hunter");

let core;
let I;
let next = 9930;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("notices" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages, varbit: (id, value) => p.getPacketSender().sendVarbit(id, value) };
}

const suspicion = (clue) => `You have a sneaking suspicion that you would have received ${clue}.`;

// Each skilling source, rolled so the clue always hits (the nest and dispenser roll Math.random).
const SOURCES = {
  "a clue nest": (p) => ClueNests.rollClueNests(p, { petBase: 317647 }),
  "a clue geode": (p) => ClueGeodes.rollClueGeodes({ player: p, skill: core.Skill.MINING, petBase: 211886 }, () => 0),
  "a clue bottle": (p) => ClueBottles.rollClueBottles(p, 1000000, () => 0),
  "an Agility dispenser clue": (p) => AgilityDispenser._test.rollClue(p),
  "a salvage clue": (p) => Salvaging.rollClue(p, { tier: "medium", oneIn: 300 }, () => 0),
  // Hunter's sources roll Math.random; the bird house and jar return their loot, so it must hold no clue.
  "a bird house clue nest": (p) => assert.ok(!Birdhouses.loot(p, { tier: 0 }).some(([id]) => isClue(id))),
  "an aerial fishing clue bottle": (p) => Aerial.rollClues(p),
  "an impling jar clue": (p) => assert.ok(!Catching.rewards(p, { key: "EARTH" }).some(([id]) => isClue(id))),
  // The first draw misses the drift net's fossil roll; the medium bottle then hits and becomes pufferfish.
  "a drift net clue bottle": (p) => withDraws([0.5], () =>
    assert.deepEqual(DriftNets.rewards(p, 1), [[I.PUFFERFISH, 1]])),
};

function isClue(id) {
  return /^(Clue (scroll|bottle|nest)|Scroll box) \(/.test(core.ItemDefinition.forId(id).getName());
}

function withDraws(draws, run) {
  const random = Math.random;
  Math.random = () => draws.shift() ?? 0;
  try { return run(); } finally { Math.random = random; }
}

for (const [source, roll] of Object.entries(SOURCES)) {
  test(`${source} rolled while the medium clue is already held is mentioned only with the medium warning on`, (t) => {
    t.mock.method(core.WorldDefinition, "isMembersWorld", () => true);
    const f = actor(t);
    // Every tier held, so no source can give one; only the medium warning is on.
    for (const tier of ["beginner", "easy", "medium", "hard", "elite"]) f.inv.adds(I[`CLUE_SCROLL_${tier.toUpperCase()}_`], 1);
    const before = f.inv.getItems().map((item) => item?.getId());
    t.mock.method(Math, "random", () => 0);
    roll(f.p);
    assert.deepEqual(f.messages.filter((m) => m.includes("sneaking")), [], "off by default");
    f.varbit(Capacity.WARNING_VARBITS.medium, 1);
    roll(f.p);
    assert.deepEqual(f.messages.filter((m) => m.includes("sneaking")), [suspicion("a medium clue scroll")]);
    assert.deepEqual(f.inv.getItems().map((item) => item?.getId()), before, "nothing is given");
  });
}

test("a skilling clue missed after X Marks the Spot names the scroll box", (t) => {
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => true);
  const f = actor(t);
  const quest = PM.createApi("SkillingNoticesQuest");
  const done = (q) => { if (q.player === f.p && q.key === "x_marks_the_spot") q.complete = true; };
  quest.onCustomEvent("quest:is-complete", done);
  f.inv.adds(I.SCROLL_BOX_MEDIUM_, 2);
  f.varbit(Capacity.WARNING_VARBITS.medium, 1);
  Salvaging.rollClue(f.p, { tier: "medium", oneIn: 300 }, () => 0);
  assert.deepEqual(f.messages, [suspicion("a medium scroll box")]);
});

test("a missed roll, or a clue with room for it, says nothing", (t) => {
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => true);
  const f = actor(t);
  f.varbit(Capacity.WARNING_VARBITS.medium, 1);
  Salvaging.rollClue(f.p, { tier: "medium", oneIn: 300 }, () => 0.5);
  assert.equal(f.inv.getAmount(I.CLUE_SCROLL_MEDIUM_), 0, "the roll missed");
  Salvaging.rollClue(f.p, { tier: "medium", oneIn: 300 }, () => 0);
  assert.equal(f.inv.getAmount(I.CLUE_SCROLL_MEDIUM_), 1, "the clue is given");
  assert.deepEqual(f.messages, []);
});

test("free worlds never warn about a members clue", (t) => {
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => false);
  const f = actor(t);
  f.varbit(Capacity.WARNING_VARBITS.medium, 1);
  f.varbit(Capacity.WARNING_VARBITS.beginner, 1);
  PM.emitCustomEvent("treasure-trails:missed-clue", { player: f.p, tier: "medium" });
  assert.deepEqual(f.messages, []);
  PM.emitCustomEvent("treasure-trails:missed-clue", { player: f.p, tier: "beginner" });
  assert.deepEqual(f.messages, [suspicion("a beginner clue scroll")]);
});

test("a bird house mentions each missed tier once, though several of its nests roll", (t) => {
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => true);
  const f = actor(t);
  for (const tier of ["beginner", "easy", "medium", "hard", "elite"]) f.inv.adds(I[`CLUE_SCROLL_${tier.toUpperCase()}_`], 1);
  f.varbit(Capacity.WARNING_VARBITS.elite, 1);
  f.varbit(Capacity.WARNING_VARBITS.medium, 1);
  t.mock.method(Math, "random", () => 0);
  Birdhouses.loot(f.p, { tier: 0 });
  assert.deepEqual(f.messages, [suspicion("an elite clue scroll"), suspicion("a medium clue scroll")]);
});

test("Hunter clues with room for them are still given", (t) => {
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => true);
  const f = actor(t);
  for (const tier of ["beginner", "easy", "medium", "hard", "elite"]) f.varbit(Capacity.WARNING_VARBITS[tier], 1);
  t.mock.method(Math, "random", () => 0);
  assert.ok(Birdhouses.loot(f.p, { tier: 0 }).some(([id]) => id === I.CLUE_NEST_ELITE_));
  assert.ok(Catching.rewards(f.p, { key: "EARTH" }).some(([id]) => id === I.CLUE_SCROLL_MEDIUM_));
  withDraws([0.5], () => assert.deepEqual(DriftNets.rewards(f.p, 1), [[I.CLUE_BOTTLE_MEDIUM_, 1]]));
  Aerial.rollClues(f.p);
  assert.equal(f.inv.getAmount(I.CLUE_BOTTLE_BEGINNER_), 1, "the aerial catch's bottle is given");
  assert.deepEqual(f.messages, []);
});
