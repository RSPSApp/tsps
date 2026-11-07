// Run after `yarn build`: node --test tests/colosseum-doom-lobby-grave.test.cjs
// A death in a Fortis Colosseum or Doom of Mokhaiotl run is dangerous, and "Their grave is also located there [the
// lobby]. All unprotected items are moved to the grave" (Wiki). Tradeables went to the lobby floor instead and
// untradeables to a grave at the world spawn. Real engine: every plugin loaded, the real gravestone location request.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
});

const CASES = [
  ["Fortis Colosseum", "../plugins/minigames/colosseum/Run.Colosseum", { x: 1804, y: 9508, z: 0 }],
  ["Doom of Mokhaiotl", "../plugins/bosses/doom/Run.DoomOfMokhaiotl", { x: 1313, y: 9555, z: 0 }],
];

for (const [name, runModule, lobby] of CASES) {
  test(`${name}: a run's death puts its grave in the lobby, and its items aren't dropped one by one`, (t) => {
    const p = new Player(null);
    p.setUsername(`grave-${name.length}`);
    const Run = require(runModule);
    const real = Run.runOf;
    t.mock.method(Run, "runOf", (player) => (player === p ? {} : real(player)));
    const request = { player: p, location: p.getLocation(), tile: null, feeMultiplier: 1 };
    PM.emitCustomEvent("gravestones:grave-location", request);
    assert.deepEqual(request.tile, lobby, "the grave stands in the lobby");
    const drop = { player: p, item: new (PM.getCoreApi().Item)(4151, 1), dropEligible: true, shouldDropItems: true,
      location: p.getLocation(), handled: false, killer: null };
    PM.emitPlayerDeathItemDrop(drop);
    assert.equal(drop.handled, false, "the whip goes to the grave with the rest, not the lobby floor");
  });
}
