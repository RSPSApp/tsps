// Run after `yarn build`: node --test tests/tempoross-permits.test.cjs
//
// Reward permits are asked as "minigame:points" { player, minigame, points } as they are earned: with
// nothing answering they are the fight's own; an answer is what the player is credited. Real plugins, a
// real Player.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const Records = require("../plugins/minigames/tempoross/Records.Tempoross");

/** The test's answer to "minigame:points", or null for none. */
let answer = null;
const asked = [];

function probe(request) {
  if (request.minigame !== "tempoross") return;
  asked.push({ ...request });
  answer?.(request);
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.createApi("TemporossPermitsProbe").onCustomEvent("minigame:points", probe);
});

test("permits are asked as minigame:points: unanswered they are as earned, an answer is what is credited", () => {
  const player = new Player(new BotPlayerSession());
  player.setUsername("tempoross-permits");
  Records.addPermits(player, 2);
  assert.deepEqual(asked, [{ player, minigame: "tempoross", points: 2 }]);
  assert.equal(Records.permits(player), 2);
  assert.equal(Records.totalPermits(player), 2);
  answer = (request) => { request.points *= 3; };
  try {
    Records.addPermits(player, 2);
  } finally {
    answer = null;
  }
  assert.equal(Records.permits(player), 8);
  assert.equal(Records.totalPermits(player), 8);
});
