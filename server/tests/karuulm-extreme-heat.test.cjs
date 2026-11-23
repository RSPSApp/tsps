// Karuulm Slayer Dungeon extreme heat (Wiki: Extreme heat): 4 damage every tick beyond the
// entrance chamber, unless the player wears boots of stone, Boots of Brimstone or granite boots,
// or has the elite Kourend & Kebos Diary reward.
//
// Run after `yarn build`: node --test tests/karuulm-extreme-heat.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Karuulm = require("../plugins/areas/KaruulmSlayerDungeon.plugin");

const core = PluginManager.getCoreApi();
let area;
/** Diary claims the fake diary plugin answers with, by player. */
const eliteClaimed = new Set();

before(async () => {
  await CachePipeline.initialize();
  Karuulm.register({
    core,
    registerArea: (registered) => { area = registered; },
    emitCustomEvent(name, request) {
      if (name === "diary:is-reward-claimed" && request.diary === "kourend" && request.tier === "elite") {
        request.claimed = eliteClaimed.has(request.player);
      }
    },
  });
});

function player(x, y, z, { feet = null, elite = false } = {}) {
  const p = new Player(null);
  p.setUsername("karuulm-heat");
  const sender = new Proxy({}, { get: (object, key) => object[key] ?? (() => sender) });
  p.getPacketSender = () => sender;
  p.setLocation(new core.Location(x, y, z));
  p.setRegistered(true);
  p.setHitpoints(99);
  if (feet) p.getEquipment().setItem(core.Equipment.FEET_SLOT, new core.Item(core.ItemIdentifiers[feet], 1));
  if (elite) eliteClaimed.add(p);
  return p;
}

function covers(x, y, z) {
  const location = new core.Location(x, y, z);
  return area.getBoundaries().some((boundary) => boundary.inside(location));
}

function heatAfterTicks(p, ticks) {
  for (let i = 0; i < ticks; i++) area.process(p);
  return p.getCombat().getHitQueue().getQueuedDamage();
}

test("the area covers every level of the dungeon around the chamber", () => {
  for (const [x, y, z] of [
    [1311, 10188, 0], // the elevator landing
    [1322, 10205, 0], // past the east stepover
    [1312, 10216, 0], // past the north stepover, the hydras' level
    [1260, 10170, 0], // the wyrms
    [1334, 10205, 1], // the sulphur lizards' level
    [1356, 10239, 1], // level 1's drakes, east of x 1355
    [1360, 10241, 1], // the east end of level 1's cave floor
    [1318, 10189, 2], // the fire giants' and hellhounds' level
  ]) {
    assert.equal(covers(x, y, z), true, `${x},${y},${z}`);
  }
  assert.equal(covers(1364, 10265, 0), false, "the Alchemical Hydra's chamber is its own area");
  assert.equal(covers(1356, 10265, 0), false, "the Hydra's chamber starts at x 1356 on level 0");
  assert.equal(covers(1311, 3807, 0), false, "Mount Karuulm's summit");
});

test("barefoot beyond the entrance chamber, the floor burns 4 a tick", () => {
  for (const [x, y, z] of [[1322, 10205, 0], [1301, 10205, 0], [1312, 10216, 0], [1334, 10205, 1], [1356, 10239, 1], [1318, 10189, 2]]) {
    const p = player(x, y, z);
    assert.equal(heatAfterTicks(p, 1), 4, `${x},${y},${z}`);
    assert.equal(heatAfterTicks(p, 2), 12, `${x},${y},${z} after three ticks`);
  }
});

test("the Tasakaal's entrance chamber stays cool", () => {
  for (const [x, y] of [[1311, 10188], [1310, 10205], [1303, 10210], [1320, 10205], [1312, 10214]]) {
    assert.equal(heatAfterTicks(player(x, y, 0), 5), 0, `${x},${y}`);
  }
});

test("boots of stone, Boots of Brimstone and granite boots keep the heat off", () => {
  for (const feet of ["BOOTS_OF_STONE", "BOOTS_OF_BRIMSTONE", "GRANITE_BOOTS"]) {
    assert.equal(heatAfterTicks(player(1312, 10216, 0, { feet }), 5), 0, feet);
  }
  assert.equal(heatAfterTicks(player(1312, 10216, 0, { feet: "DRAGON_BOOTS" }), 1), 4, "other boots burn");
});

test("the elite Kourend & Kebos Diary reward protects with any footwear or none", () => {
  assert.equal(heatAfterTicks(player(1312, 10216, 0, { elite: true }), 5), 0);
  assert.equal(heatAfterTicks(player(1312, 10216, 0, { feet: "DRAGON_BOOTS", elite: true }), 5), 0);
});

test("a dead or unregistered player takes no more heat", () => {
  const dead = player(1312, 10216, 0);
  dead.setHitpoints(0);
  assert.equal(heatAfterTicks(dead, 3), 0);
  const gone = player(1312, 10216, 0);
  gone.setRegistered(false);
  assert.equal(heatAfterTicks(gone, 3), 0);
});

test("the heat lands as real damage through the hit queue", () => {
  const p = player(1312, 10216, 0);
  area.process(p);
  p.getCombat().getHitQueue().process(core.World.getProcessCycle());
  assert.equal(p.getHitpoints(), 95);
});

test("the real diary plugin's claimed elite Kourend & Kebos reward protects; a hard one doesn't", () => {
  const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
  const api = PluginManager.createApi("KaruulmExtremeHeatTest");
  Diaries.register(api);
  Karuulm.register({ ...api, core, registerArea() {}, emitCustomEvent: api.emitCustomEvent.bind(api) });
  const { isProtected } = Karuulm._test;
  const elite = player(1312, 10216, 0);
  elite.setAttribute("achievement-diaries:rewards", { kourend: ["easy", "medium", "hard", "elite"] });
  assert.equal(isProtected(elite), true);
  const hard = player(1312, 10216, 0);
  hard.setAttribute("achievement-diaries:rewards", { kourend: ["easy", "medium", "hard"] });
  assert.equal(isProtected(hard), false);
});
