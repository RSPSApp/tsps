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
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
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
