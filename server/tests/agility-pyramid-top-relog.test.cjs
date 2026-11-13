// Run after `yarn build`: node --test tests/agility-pyramid-top-relog.test.cjs
// The golden pyramid stays taken across a relog on the pyramid, until the player is off it. The one recording
// (rsprox_transcripts/227/01757.txt, Leagues V) shows agility_pyramid_top (1556) set at the take and cleared at the
// doorway, but no relog and no other way off: the relog keeping it, and any other way off clearing it, are inferred.
// Real engine: every plugin loaded, real Players, the save through PlayerSave.fromPlayer / applyToPlayer.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

let core, Pyramid, PYRAMID_TOP;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  core = PM.getCoreApi();
  Pyramid = require("../plugins/skills/agility/courses/AgilityPyramid.Agility");
  PYRAMID_TOP = core.ItemIdentifiers.PYRAMID_TOP;
});
after(() => PM.emitServerShutdown({}));

let next = 9860;
const SUMMIT = () => new core.Location(3043, 4697, 3); // the top floor, where the golden pyramid is taken
function player(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pyramidtop");
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  return p;
}

test("a relog on the summit doesn't give a second golden pyramid; the doorway does", (t) => {
  const api = { emitCustomEvent() {} };
  const first = player(t);
  first.setLocation(SUMMIT());
  Pyramid.takePyramidTop({ player: first, core, api });
  assert.equal(first.getInventory().getAmount(PYRAMID_TOP), 1);
  const saved = PlayerSave.fromPlayer(first);
  const again = player(t);
  saved.applyToPlayer(again);
  PM.emitPlayerLogin({ player: again, username: again.getUsername() });
  assert.equal(again.getPacketSender().getVarbit(1556), 1, "the varbit is sent again at login");
  again.getInventory().delete(PYRAMID_TOP, again.getInventory().getAmount(PYRAMID_TOP));
  assert.equal(again.getInventory().getAmount(PYRAMID_TOP), 0, "the first top sold or banked");
  Pyramid.takePyramidTop({ player: again, core, api });
  assert.equal(again.getInventory().getAmount(PYRAMID_TOP), 0, "no second top after the relog");
  Pyramid.leavePyramid(again);
  Pyramid.takePyramidTop({ player: again, core, api });
  assert.equal(again.getInventory().getAmount(PYRAMID_TOP), 1, "after the doorway the top is there again");
});

// Leaving without the doorway (a teleport, a death or fall, the stairs down) must not keep the top taken for good.
test("off the pyramid by any way but the doorway, the top can be taken again, and a relog off it clears it too", (t) => {
  const api = { emitCustomEvent() {} };
  const p = player(t);
  p.setLocation(SUMMIT());
  Pyramid.takePyramidTop({ player: p, core, api });
  PM.emitPlayerProcess({ player: p });
  assert.equal(p.getAttribute(Pyramid.PYRAMID_TOP_ATTRIBUTE), true, "still taken while on the summit");
  p.setLocation(new core.Location(3356, 2835, 2)); // down the stairs, on a lower floor
  PM.emitPlayerProcess({ player: p });
  assert.equal(p.getAttribute(Pyramid.PYRAMID_TOP_ATTRIBUTE), true, "and on the floors below");
  p.setLocation(new core.Location(3222, 3218, 0)); // a teleport away
  PM.emitPlayerProcess({ player: p });
  assert.equal(p.getAttribute(Pyramid.PYRAMID_TOP_ATTRIBUTE), false, "off the pyramid: free again");
  assert.equal(p.getPacketSender().getVarbit(1556), 0);

  // Saved with the top taken, logging in somewhere else (it was saved before the leave was noticed): cleared.
  const taken = player(t);
  taken.setLocation(SUMMIT());
  Pyramid.takePyramidTop({ player: taken, core, api });
  const saved = PlayerSave.fromPlayer(taken);
  const relogged = player(t);
  saved.applyToPlayer(relogged);
  relogged.setLocation(new core.Location(3354, 2830, 0)); // on the ground beside the pyramid
  PM.emitPlayerLogin({ player: relogged, username: relogged.getUsername() });
  assert.equal(relogged.getAttribute(Pyramid.PYRAMID_TOP_ATTRIBUTE), false, "a login off the pyramid clears it");
  relogged.getInventory().delete(PYRAMID_TOP, relogged.getInventory().getAmount(PYRAMID_TOP));
  relogged.setLocation(SUMMIT());
  Pyramid.takePyramidTop({ player: relogged, core, api });
  assert.equal(relogged.getInventory().getAmount(PYRAMID_TOP), 1, "and the next lap's top can be taken");
});

// agility_pyramid_level (1550) is in the login varbits on live (rsprox_transcripts/230/02933.txt: a login on floor 3
// at 3370,2840 sends 0 -> 3), so a relog on a floor keeps the floor's moving blocks.
test("a login on a pyramid floor sends agility_pyramid_level for that floor; one off the pyramid sends nothing", (t) => {
  for (const [location, level] of [
    [new core.Location(3370, 2840, 3), 3],
    [new core.Location(3356, 2835, 1), 1],
    [SUMMIT(), 5],
    [new core.Location(3354, 2830, 0), 0],
  ]) {
    const p = player(t);
    p.setLocation(location);
    PM.emitPlayerLogin({ player: p, username: p.getUsername() });
    assert.equal(p.getPacketSender().getVarbit(1550), level, `${location.getX()},${location.getY()},${location.getZ()}`);
  }
});
