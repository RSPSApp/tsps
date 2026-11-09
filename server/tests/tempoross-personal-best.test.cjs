// Run after `yarn build`: node --test tests/tempoross-personal-best.test.cjs
//
// The end-of-fight points line, as recorded: a new best "Points: <col=ef1020>3,190</col> (new personal best).", else
// "Points: <col=ef1020>3,000</col>. Personal best: 3,190." (rsprox_transcripts/227/00552.txt:354893, :364796, and the
// rest of the Tempoross recordings). Real plugins, a real Player, Fight's own reward.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const { Fight } = require("../plugins/minigames/tempoross/Fight.Tempoross");
const Shared = require("../plugins/minigames/tempoross/Shared.Tempoross");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
});

function finish(t, player, points, ticks = 200, line = "Points: ") {
  player.getPacketSender().sendVarbit(Shared.VARBIT.POINTS, points);
  const messages = [];
  t.mock.method(player, "sendMessage", (m) => messages.push(m));
  Fight.prototype.reward.call({}, player, ticks);
  t.mock.restoreAll();
  return messages.find((m) => m.startsWith(line));
}

test("a new best says '(new personal best)'; otherwise the best follows", (t) => {
  const player = new Player(new BotPlayerSession());
  player.setUsername("tempoross-pb");
  assert.equal(finish(t, player, 3190), "Points: <col=ef1020>3,190</col> (new personal best).");
  assert.equal(finish(t, player, 3000), "Points: <col=ef1020>3,000</col>. Personal best: 3,190.");
});

// rsprox 227/01858.txt:65783 (and :75409, :89101, :94941; 234/03275.txt:133950): "Subdued in <col=ef1020>2:00.60</col>
// (new personal best)."; otherwise "Subdued in X. Personal best: Y.".
test("the time line: a first or faster time is a new personal best; a slower one shows the best", (t) => {
  const player = new Player(new BotPlayerSession());
  player.setUsername("tempoross-time");
  assert.equal(finish(t, player, 100, 201, "Subdued in"), "Subdued in <col=ef1020>2:00.60</col> (new personal best).", "the first");
  assert.equal(finish(t, player, 100, 174, "Subdued in"), "Subdued in <col=ef1020>1:44.40</col> (new personal best).", "faster");
  assert.equal(finish(t, player, 100, 207, "Subdued in"), "Subdued in <col=ef1020>2:04.20</col>. Personal best: 1:44.40.", "slower");
});
