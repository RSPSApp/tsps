// Run after `yarn build`: node --test tests/ge-bonds-banked-stack.test.cjs
// A bond bought on the Grand Exchange arrives untradeable, even when collected onto bonds already banked (a bank
// stacks them), as GrandExchange.collect raises "ge:offer-collected" with that bank tab. Real engine: every plugin
// loaded, a real Player, bank and inventory, and the event as the Grand Exchange plugin emits it.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const TRADEABLE_BOND = 13190;
const UNTRADEABLE_BOND = 13192;
let core;
let I;
let next = 9760;
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
  p.setUsername("bond" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, c, inv: p.getInventory(), messages };
}




test("a bond bought on the GE and collected onto banked bonds arrives untradeable", (t) => {
  const f = actor(t);
  const tab = f.p.getBank(0);
  tab.add(new core.Item(TRADEABLE_BOND, 1), false);
  tab.add(new core.Item(TRADEABLE_BOND, 1), false); // the collection lands on the banked stack
  PM.emitCustomEvent("ge:offer-collected", { player: f.p, itemId: TRADEABLE_BOND, amount: 1, destination: "bank", container: tab });
  assert.equal(tab.getAmount(TRADEABLE_BOND), 1, "the bond already owned stays tradeable");
  assert.equal(tab.getAmount(UNTRADEABLE_BOND), 1, "the bought one arrives untradeable");
});

test("a bond collected into the inventory still arrives untradeable", (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(TRADEABLE_BOND, 1));
  PM.emitCustomEvent("ge:offer-collected", { player: f.p, itemId: TRADEABLE_BOND, amount: 1, destination: "inventory", container: f.inv });
  assert.equal(f.inv.getAmount(TRADEABLE_BOND), 0);
  assert.equal(f.inv.getAmount(UNTRADEABLE_BOND), 1);
});

test("the split joins the untradeable bonds already banked in another tab", (t) => {
  const f = actor(t);
  f.p.getBank(1).add(new core.Item(UNTRADEABLE_BOND, 3), false);
  const tab = f.p.getBank(0);
  tab.add(new core.Item(TRADEABLE_BOND, 2), false); // one owned, one just collected
  PM.emitCustomEvent("ge:offer-collected", { player: f.p, itemId: TRADEABLE_BOND, amount: 1, destination: "bank", container: tab });
  assert.equal(tab.getAmount(TRADEABLE_BOND), 1);
  assert.equal(tab.getAmount(UNTRADEABLE_BOND), 0, "no second untradeable stack");
  assert.equal(f.p.getBank(1).getAmount(UNTRADEABLE_BOND), 4);
});

test("a full bank still splits the bought bond off as untradeable", (t) => {
  const f = actor(t);
  const tab = f.p.getBank(0);
  tab.add(new core.Item(TRADEABLE_BOND, 2), false);
  for (let id = 1000; core.Bank.freeSlots(f.p) > 0; id += 2) tab.add(new core.Item(id, 1), false);
  assert.equal(core.Bank.freeSlots(f.p), 0, "the bank is full");
  PM.emitCustomEvent("ge:offer-collected", { player: f.p, itemId: TRADEABLE_BOND, amount: 1, destination: "bank", container: tab });
  assert.equal(tab.getAmount(TRADEABLE_BOND), 1);
  assert.equal(tab.getAmount(UNTRADEABLE_BOND), 1);
});

// The real GE collect path: an offer waiting in the slot, the main Collect button (465:6), op 1 to the inventory, op 2 to the bank.
const GE = 465;
async function collectOffer(f, offer, op) {
  f.p.setAttribute("grand-exchange-offers", { 0: { slot: 0, price: 10, total: 10, finished: true, completesAt: null, ...offer } });
  PM.emitCommand({ player: f.p, raw: "ge", base: "ge", parts: ["ge"], handled: false });
  assert.equal(f.p.getInterfaceId(), GE, "the GE opened");
  await f.c.dispatch([{ type: "widget_action", widgetId: (GE << 16) | 6, groupId: GE, childId: 6, buttonNum: op, slot: 0, itemId: -1 }]);
  f.c.processTurnPackets();
  assert.equal(Object.keys(f.p.getAttribute("grand-exchange-offers") ?? {}).length, 0, "the offer was collected");
}
const abortedSell = { itemId: TRADEABLE_BOND, sell: true, aborted: true, quantity: 1 };

test("a bond returned by a cancelled sell, collected onto banked bonds, stays tradeable", async (t) => {
  const f = actor(t);
  f.p.getBank(0).add(new core.Item(TRADEABLE_BOND, 3), false);
  await collectOffer(f, abortedSell, 2);
  assert.equal(f.p.getBank(0).getAmount(TRADEABLE_BOND), 4);
  assert.equal(f.p.getBank(0).getAmount(UNTRADEABLE_BOND), 0);
});

test("a bond returned by a cancelled sell, collected to the inventory, stays tradeable", async (t) => {
  const f = actor(t);
  await collectOffer(f, abortedSell, 1);
  assert.equal(f.inv.getAmount(TRADEABLE_BOND), 1);
  assert.equal(f.inv.getAmount(UNTRADEABLE_BOND), 0);
});

test("a bond bought on the GE, collected through the real path onto banked bonds, still arrives untradeable", async (t) => {
  const f = actor(t);
  f.p.getBank(0).add(new core.Item(TRADEABLE_BOND, 3), false);
  await collectOffer(f, { itemId: TRADEABLE_BOND, sell: false, quantity: 1 }, 2);
  assert.equal(f.p.getBank(0).getAmount(TRADEABLE_BOND), 3);
  assert.equal(f.p.getBank(0).getAmount(UNTRADEABLE_BOND), 1);
});

test("a whole bought stack joins the untradeable bonds already banked", (t) => {
  const f = actor(t);
  f.p.getBank(1).add(new core.Item(UNTRADEABLE_BOND, 3), false);
  const tab = f.p.getBank(0);
  tab.add(new core.Item(TRADEABLE_BOND, 2), false);
  PM.emitCustomEvent("ge:offer-collected", { player: f.p, itemId: TRADEABLE_BOND, amount: 2, destination: "bank", container: tab });
  assert.equal(tab.getAmount(TRADEABLE_BOND), 0);
  assert.equal(tab.getAmount(UNTRADEABLE_BOND), 0, "no second untradeable stack");
  assert.equal(f.p.getBank(1).getAmount(UNTRADEABLE_BOND), 5);
});
