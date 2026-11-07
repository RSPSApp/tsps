// Run after `yarn build`: node --test tests/nightmare-zone-barrel-take.test.cjs
// A Nightmare Zone barrel's Take asks how many doses, then takes them from what the barrel holds when the answer
// comes: doses stored while the prompt was open stay in the barrel. Real engine: every plugin loaded, a real
// Player and Inventory, and the barrel's own Take and Store handlers.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let next = 9850;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("nmz" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
}
const Barrels = require("../plugins/minigames/nightmarezone/Potions.NightmareZone");
const Common = require("../plugins/minigames/nightmarezone/Common.NightmareZone");

const potion = () => Object.values(Common.data.potions).find((entry) => Array.isArray(entry?.doses) && entry.barrelName);
const barrel = () => ({ getDefinition: () => ({ getName: () => `${potion().barrelName} potion` }) });

test("doses stored while the Take prompt is open stay in the barrel", (t) => {
  const f = actor(t);
  Barrels.setStored(f.p, potion(), 8);
  Barrels.take({ player: f.p, object: barrel() });
  const answer = f.p.getEnteredAmountAction();
  assert.ok(answer, "the Take prompt is open");
  f.inv.setItem(0, new core.Item(potion().doses[0], 1)); // a full (4-dose) potion
  f.inv.setItem(1, new core.Item(potion().doses[0], 1));
  Barrels.store({ player: f.p, object: barrel() });
  assert.equal(Barrels.stored(f.p, potion()), 16, "the Store went in");
  answer.execute(8);
  assert.equal(Barrels.stored(f.p, potion()), 8, "only the 8 taken leave the barrel");
  assert.equal(f.inv.getAmount(potion().doses[0]), 2, "two full potions taken");
});

test("Take still gives what the barrel holds when nothing else changes", (t) => {
  const f = actor(t);
  Barrels.setStored(f.p, potion(), 6);
  Barrels.take({ player: f.p, object: barrel() });
  f.p.getEnteredAmountAction().execute(10);
  assert.equal(Barrels.stored(f.p, potion()), 0);
  assert.equal(f.inv.getAmount(potion().doses[0]), 1, "one 4-dose potion");
  assert.equal(f.inv.getAmount(potion().doses[2]), 1, "and one 2-dose potion");
});
