// Run after `yarn build`: node --test tests/agility-pyramid-top-relog.test.cjs
// The golden pyramid stays taken across a relog until the player leaves by the doorway: on live the varbit
// agility_pyramid_top (1556) is the server's and clears only at the doorway (rsprox_transcripts/227/01757.txt).
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
