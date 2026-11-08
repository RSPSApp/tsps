// Run after yarn build: node --test tests/ordinary-rune-spawns.test.cjs
// Independently listed Wiki ItemSpawnLine F2P rune tiles; raw item-infobox timers are ticks.
// This batch excludes untyped tile timer overrides and member-world rows.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const spawns = require("../data/definitions/ground-items.json");
before(() => CachePipeline.initialize(path.resolve(__dirname, "..")));
const EXPECTED = [
  [556,3150,3247,1,100],[556,2938,3158,1,100],[556,3030,3637,5,100],
  [559,3226,9910,1,100],
  [557,3195,3515,1,100],[557,3032,3637,5,100],[557,3185,9888,6,100],
  [554,3026,3637,5,100],[554,3304,3311,3,100],
  [554,2842,9552,1,100],[554,2836,9566,1,100],[554,2843,9560,1,100],
  [554,2838,9552,1,100],[554,2833,9561,1,100],
  [558,3206,3208,1,100],[558,3023,3640,5,100],[558,3224,9910,1,100],[558,3283,3728,6,100],
  [561,3311,3853,3,200],[561,3307,3859,4,200],
  [555,3298,3316,4,100],[555,3028,3637,5,100],[555,2960,3899,5,100],
];
test("audited ordinary F2P rune spawns use real cache IDs, exact tiles, quantities and timers", () => {
  const runeIds = new Set(EXPECTED.map(row => row[0]));
  assert.equal(spawns.filter(row => runeIds.has(row.id)).length, EXPECTED.length, "this audited batch is exactly23 rune spawns");
  for (const [id,x,y,amount,respawn] of EXPECTED) {
    assert.match(CacheDefinitions.getItem(id)?.name ?? "", /rune$/);
    const found = spawns.filter(s => s.id === id && s.location.x === x && s.location.y === y && s.location.z === 0);
    assert.equal(found.length,1,"exact spawn "+id+"@"+x+","+y+",0");
    assert.equal(found[0].amt,amount);
    assert.equal(found[0].respawn,respawn);
  }
});

test("audited ordinary shears and crossbow tiles retain source quantity, plane and timer", () => {
  const expected = [
    [837,3174,3663,0,1,500],[837,3284,3719,0,1,500],
    [1735,3152,3306,0,1,100],[1735,3126,3356,0,1,100],[1735,2930,3285,1,1,100],
  ];
  for (const [id,x,y,z,amount,respawn] of expected) {
    assert.equal(CacheDefinitions.getItem(id)?.name,id===837?"Crossbow":"Shears");
    const found=spawns.filter(row=>row.id===id&&row.location.x===x&&row.location.y===y&&row.location.z===z);
    assert.equal(found.length,1,"exact tool spawn "+id+"@"+x+","+y+","+z);
    assert.equal(found[0].amt,amount);assert.equal(found[0].respawn,respawn);
  }
});
