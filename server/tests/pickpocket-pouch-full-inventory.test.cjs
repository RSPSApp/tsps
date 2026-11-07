// Run after `yarn build`: node --test tests/pickpocket-pouch-full-inventory.test.cjs
// Pickpocketing checks for a free slot at the click and resolves a tick later; giveLoot's own comment says what the
// inventory has no room for falls to the floor, but the coin pouch itself went through a bare `adds`, so a slot filled
// in between (worn gear taken off) lost the pouch. Real engine: every plugin loaded, a real Player with a real full
// Inventory, the plugin's own giveLoot for a target with a coin pouch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");

let core;
let I;
let Pickpocket;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Pickpocket = require("../plugins/skills/thieving/Pickpocket.Thieving");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("a coin pouch with no slot to go to lands under the player", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9020); p.setUsername("thief9020"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0));
  t.after(() => p.setRegistered(false));
  for (let slot = 0; slot < 28; slot++) p.getInventory().setItem(slot, new core.Item(I.LOGS, 1));
  const dropped = [];
  t.mock.method(ItemOnGroundManager, "registers", (player, item) => { dropped.push(item.getId()); return null; });
  const target = Pickpocket._test.targetFor("Man");
  assert.ok(target?.coinPouch, "the man's loot is a coin pouch");
  Pickpocket._test.giveLoot(p, target, [{ id: I.COINS, amount: 3 }], () => 0.99);
  assert.deepEqual(dropped, [target.coinPouch.id], "the pouch, not nothing");
});
