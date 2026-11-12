// Run after `yarn build`: node --test tests/torn-whistle-blueprints.test.cjs
// Hunter loot sacks hand over the torn quetzal whistle blueprints from the Wiki's sack tiers, through the real plugins.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
let next = 2400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function character(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(`clogactivity${next}`);
  player.setRegistered(true);
  player.setLocation(new core.Location(3000, 3000, 0));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  PM.emitPlayerLogin({ player, username: player.getUsername(), isNewAccount: true });
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  player.getInventory().resetItems();
  player.getPacketSender().sendInterfaceRemoval();
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return player;
}

// Wiki (Hunters' Rumours): the torn enhanced quetzal whistle blueprint at 100 rumours comes "from any hunters' loot sack"
// (the Novice sack too); the torn perfected one at 250 "from any expert or master hunters' loot sack" (not an adept one).
test("torn whistle blueprints come from the Wiki's sack tiers", (t) => {
  const Rumours = require("../plugins/skills/hunter/Rumours.Hunter");
  const I = core.ItemIdentifiers;
  const rewards = (tier, completed) => {
    const player = character(t);
    Rumours.state(player).completed = completed;
    return Rumours.sackRewards(player, tier).map(([id]) => id);
  };
  assert.ok(rewards("basic", 100).includes(I.TORN_ENHANCED_QUETZAL_WHISTLE_BLUEPRINT), "a basic sack at 100");
  assert.ok(!rewards("adept", 250).includes(I.TORN_PERFECTED_QUETZAL_WHISTLE_BLUEPRINT), "not an adept sack");
  assert.ok(rewards("expert", 250).includes(I.TORN_PERFECTED_QUETZAL_WHISTLE_BLUEPRINT), "an expert sack at 250");
  assert.ok(rewards("master", 250).includes(I.TORN_PERFECTED_QUETZAL_WHISTLE_BLUEPRINT), "a master sack at 250");
});
