// Run after `yarn build`: node --test tests/tempoross-loot-lines.test.cjs
//
// The reward pool's loot lines, as recorded (rsprox_transcripts/227/00552.txt, 227/01858.txt, 234/03275.txt): spam
// "You found some loot: 60 x Spirit flakes" / "...: Casket", soaked pages a red game message
// "You found some loot: <col=ef1020>9 x Soaked page</col>". Real plugins, a real Player and Inventory.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const Rewards = require("../plugins/minigames/tempoross/Rewards.Tempoross");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
});

test("loot on spam (commas for thousands), soaked pages a red game message", (t) => {
  const p = new Player(new BotPlayerSession());
  p.setUsername("tempoross-loot");
  const game = [], spam = [];
  t.mock.method(p, "sendMessage", (m) => game.push(m));
  t.mock.method(p.getPacketSender(), "sendTypedMessage", (type, m) => { (type === core.ChatType.SPAM ? spam : game).push(m); return p.getPacketSender(); });
  const I = core.ItemIdentifiers;
  Rewards.giveReward(p, { id: I.SPIRIT_FLAKES, amount: 60 });
  Rewards.giveReward(p, { id: I.FEATHER, amount: 1600 });
  Rewards.giveReward(p, { id: I.SOAKED_PAGE, amount: 9 });
  assert.deepEqual(spam, ["You found some loot: 60 x Spirit flakes", "You found some loot: 1,600 x Feather"]);
  assert.deepEqual(game.filter((m) => m.startsWith("You found some loot")), ["You found some loot: <col=ef1020>9 x Soaked page</col>"]);
});
