// Run after `yarn build`: node --test tests/poh-servant-money-bag.test.cjs
// The servant's money bag (Wiki: Servant's moneybag): a withdrawal gives only what the inventory can hold and keeps
// the rest in the bag. A coin stack near the cap took the bag's full amount off and the overflow was lost. Real
// engine: every plugin loaded, a real Player and inventory; the house is a PlayerHouseInstance stand-in.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, I, Servants, Instance;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Servants = require("../plugins/skills/construction/Servants.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9760;
function owner(t, servantMoney) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pohowner" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const save = { rooms: [[[{ roomKey: "STUDY", furniture: { bag: "SERVANTS_MONEYBAG" } }]]], servantMoney };
  const house = Object.assign(Object.create(Instance.PlayerHouseInstance.prototype), { owner: p, save });
  t.mock.method(p, "getPrivateArea", () => house);
  return { p, save };
}

test("a withdrawal onto a stack near the cap takes only what fits; the rest stays in the bag", (t) => {
  const { p, save } = owner(t, 3000000);
  p.getInventory().setItem(0, new core.Item(I.COINS, 2147483647 - 500000));
  assert.equal(Servants.changeServantMoney(p, -3000000), true);
  assert.equal(p.getInventory().getAmount(I.COINS), 2147483647);
  assert.equal(save.servantMoney, 2500000, "nothing is lost");
});

test("a full inventory without coins takes nothing", (t) => {
  const { p, save } = owner(t, 1000);
  for (let slot = 0; slot < 28; slot++) p.getInventory().setItem(slot, new core.Item(I.BRONZE_SWORD, 1));
  assert.equal(Servants.changeServantMoney(p, -1000), false);
  assert.equal(save.servantMoney, 1000);
});

test("room for it all withdraws it all", (t) => {
  const { p, save } = owner(t, 1000);
  assert.equal(Servants.changeServantMoney(p, -1000), true);
  assert.equal(p.getInventory().getAmount(I.COINS), 1000);
  assert.equal(save.servantMoney, 0);
});
