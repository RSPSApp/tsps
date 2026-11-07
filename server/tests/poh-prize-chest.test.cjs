// Run after `yarn build`: node --test tests/poh-prize-chest.test.cjs
// A POH prize chest pays its whole prize or none (a prize key is spent per take). A coin stack near the cap, or one
// with other metadata and no free slot, passed the old slot check: the prize was zeroed and the add kept part or none.
// Real engine: every plugin loaded, a real Player and inventory; the house is a stand-in from House.houseFor.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, I, House, Prizes;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  House = require("../plugins/skills/construction/House.Construction");
  Prizes = require("../plugins/skills/construction/Prizes.Construction");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9790;
function ownerInBuildingMode(t, prize) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pohprize" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const house = { owner: p, buildingMode: true, save: { prize }, getFurnitureAt: () => ({ buildableKey: "MAHOGANY_PRIZE_CHEST" }) };
  t.mock.method(House, "houseFor", (who) => (who === p ? house : null));
  t.mock.method(House, "saveHouse", () => {});
  return { p, house };
}
const open = (p) => Prizes.open({ player: p, location: new core.Location(0, 0, 0), objectId: 1, object: null });

test("a coin stack near the cap takes none of the prize, which stays in the chest", (t) => {
  const { p, house } = ownerInBuildingMode(t, 100000);
  p.getInventory().setItem(0, new core.Item(I.COINS, 2147483647 - 40000));
  open(p);
  assert.equal(house.save.prize, 100000);
  assert.equal(p.getInventory().getAmount(I.COINS), 2147483647 - 40000);
});

test("a full inventory whose coins carry other metadata takes nothing", (t) => {
  const { p, house } = ownerInBuildingMode(t, 5000);
  const tagged = new core.Item(I.COINS, 10);
  tagged.setMeta({ preset: true });
  p.getInventory().setItem(0, tagged);
  for (let slot = 1; slot < 28; slot++) p.getInventory().setItem(slot, new core.Item(I.BRONZE_SWORD, 1));
  open(p);
  assert.equal(house.save.prize, 5000);
  assert.equal(p.getInventory().getAmount(I.COINS), 10);
});

test("room for it all takes the prize", (t) => {
  const { p, house } = ownerInBuildingMode(t, 5000);
  open(p);
  assert.equal(house.save.prize, 0);
  assert.equal(p.getInventory().getAmount(I.COINS), 5000);
});
