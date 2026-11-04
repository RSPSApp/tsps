// Run after `yarn build`: node --test tests/collection-log-activity-rewards.test.cjs
// Real reward paths in activities credit the collection log at the grant, through plugins.
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

test("a Hunter loot sack credits the logged rewards it hands over", (t) => {
  const player = character(t);
  const Rumours = require("../plugins/skills/hunter/Rumours.Hunter");
  const sack = core.ItemIdentifiers.HUNTERS_LOOT_SACK_ADEPT_;
  player.getInventory().add(new core.Item(sack, 1), true);
  const random = Math.random;
  Math.random = () => 0;
  try {
    assert.equal(Rumours.open({ player, itemId: sack }), true);
  } finally {
    Math.random = random;
  }
  const log = player.getAttribute("clog.items") ?? {};
  assert.equal(log[core.ItemIdentifiers.HUNTSMANS_KIT], 1);
  assert.equal(log[core.ItemIdentifiers.GUILD_HUNTER_HEADWEAR], 1);
});

test("a Mahogany Homes reward purchase credits the item it adds", (t) => {
  const player = character(t);
  const shop = core.CacheDefinitions.getInterfaceId("construction_contract_shop");
  player.setAttribute("construction:carpenter-points", 1000);
  const click = (childId, slot) => PM.emitInterfaceActionClick({
    player, buttonId: (shop << 16) | childId, action: 1, groupId: shop, childId, slot, handled: false,
  });
  assert.equal(click(3, 22), true, "select the Carpenter's helmet");
  assert.equal(click(6, 0), true, "confirm it");
  assert.equal(player.getInventory().getAmount(24872), 1);
  assert.equal((player.getAttribute("clog.items") ?? {})[24872], 1);
});
