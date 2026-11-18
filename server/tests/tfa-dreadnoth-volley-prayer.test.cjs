// Run after `yarn build`: node --test tests/tfa-dreadnoth-volley-prayer.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");

let Dreadnoth;
let Shared;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  Dreadnoth = require("../plugins/minigames/tfa/Dreadnoth.FracturedArchive");
  Shared = require("../plugins/minigames/tfa/Shared.FracturedArchive");
});

after(() => PM.emitServerShutdown({}));

// Wiki (The Fractured Archive/Strategies, Dreadnoth): Protect from Melee for the landing slam, then
// Protect from Missiles for the projectiles. The two are separate attacks, so the projectile hit must
// not be made (and its prayer checked) together with the slam.
test("Dreadnoth's volley: the slam is made on landing, the ranged hit only when the projectiles land", (t) => {
  const player = { tile: { x: 10, y: 10, z: 0 } };
  let prayer = "melee";
  const struck = [];
  const queue = [];
  let tick = 0;
  const room = {
    dead: false,
    boss: { performAnimation() {} },
    area: {},
    fighters: () => [player],
    later: (ticks, action) => queue.push({ at: tick + ticks, action }),
    footprintTiles: () => [],
    addDamageTile() {},
    freeTileNear: () => null,
    strike: (npc, target, style, maxHit, delay) => struck.push({ tick, style, delay, prayer }),
  };
  for (const name of ["areaSound", "graphicAt", "projectile"]) t.mock.method(Shared, name, () => {});
  t.mock.method(Shared, "tileOf", (p) => p.tile);
  const run = (until) => {
    for (tick = 0; tick <= until; tick++) {
      for (const job of queue.filter((entry) => entry.at === tick)) job.action();
      if (tick === 1) prayer = "ranged"; // switched after the slam lands
    }
  };

  Dreadnoth.DreadnothRoom.prototype.volley.call(room, []);
  run(10);

  const slam = struck.find((hit) => hit.style === "melee");
  const volley = struck.find((hit) => hit.style === "ranged");
  assert.ok(slam && volley, "both attacks are made");
  assert.equal(slam.prayer, "melee");
  assert.ok(volley.tick > slam.tick, "the ranged hit is made after the slam, not with it");
  assert.equal(volley.delay, 0, "made as it lands, so the prayer then counts");
  assert.equal(volley.prayer, "ranged");
});
