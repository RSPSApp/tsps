// Run after `yarn build`: node --test tests/blueprints-inspect.test.cjs
//
// Inspect on the house blueprints. As captured on the Twisted blueprints (rsprox 2548, rev 229): a
// message box chat line, then the object box beside the item. Hosidius's words are the Wiki's.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");

const HOME = [3222, 3218];

let core;
let I;
let next = 6400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("printqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory() };
}

for (const [theme, id] of [["Twisted", () => I.TWISTED_BLUEPRINTS], ["Hosidius", () => I.HOSIDIUS_BLUEPRINTS]]) {
  test(`${theme} blueprints: Inspect shows its line in a message box, beside the item`, async (t) => {
    const f = actor(t);
    f.inv.add(new core.Item(id()), false);
    let op = -1;
    for (const candidate of [2, 3, 4, 6, 7]) {
      if (ItemActionPacketListener.resolveInventoryWidgetAction(id(), candidate)?.option === "Inspect") op = candidate;
    }
    assert.ok(op > 0, "control: the cache gives the item Inspect");
    const typed = [];
    const sender = f.p.getPacketSender();
    const original = sender.sendTypedMessage.bind(sender);
    t.mock.method(sender, "sendTypedMessage", (type, text) => { typed.push([type, text]); return original(type, text); });
    await f.c.dispatch([{
      type: "widget_action", widgetId: 149 << 16, groupId: 149, childId: 0, buttonNum: op, slot: 0, itemId: id(),
    }]);
    f.c.processTurnPackets();
    const line = `These blueprints appear to be a set of instructions for creating the ${theme} player-owned house theme. Perhaps an Estate Agent can make use of these?`;
    assert.deepEqual(typed, [[115, line]], "the message box's chat line");
    const box = f.p.getDialogueManager().getCurrent();
    assert.ok(box, "the item box is showing");
    assert.equal(box.getItemId(), id(), "beside the blueprints");
    assert.equal(box.getText().replace(/<br>/g, " "), line, "with the same words");
    assert.equal(f.inv.getAmount(id()), 1, "the blueprints are kept");
  });
}
