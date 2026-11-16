// Run after `yarn build`: node --test tests/forthos-spider-den.test.cjs
//
// Forthos Dungeon's Spider's Den (#5233). Wiki (Forthos Dungeon): "The Spider's Den, formerly a
// ritual circle for worshippers, is a multi-combat area containing 21 Temple Spiders". The area
// must hold every one of those 21 spawns and none of the neighbouring content (the undead druids,
// the Sarachnis tomb or the grubby gate).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");

const plugin = require("../plugins/areas/ForthosDungeon.plugin");
const SPAWNS = require("../data/definitions/npc-spawns.json");

const TEMPLE_SPIDER = 8703;
const UNDEAD_DRUID = 2145;

let core, area;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  plugin.register(new Proxy({
    core,
    registerArea(registered) { area = registered; },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

const spawns = SPAWNS.spawns ?? SPAWNS;
const inside = (x, y, z = 0) => area.getBoundaries().some((b) => b.inside(new core.Location(x, y, z)));

test("the Spider's Den is a multi-combat Area holding all 21 temple spiders", () => {
  assert.equal(area.isMulti(), true);
  const spiders = spawns.filter((spawn) => spawn.id === TEMPLE_SPIDER);
  assert.equal(spiders.length, 21);
  for (const spider of spiders) {
    assert.ok(inside(spider.x, spider.y), `temple spider at ${spider.x},${spider.y} is in the den`);
  }
});

test("the den stops before the undead druids, the tomb and the grubby gate", () => {
  for (const druid of spawns.filter((spawn) => spawn.id === UNDEAD_DRUID)) {
    assert.equal(inside(druid.x, druid.y), false, `undead druid at ${druid.x},${druid.y} stays outside`);
  }
  assert.equal(inside(1840, 9900), false, "Sarachnis' tomb is not multi-combat");
  assert.equal(inside(1798, 9925), false, "the grubby gate is not in the den");
});
