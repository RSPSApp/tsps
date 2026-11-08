// Run after `yarn build`: node --test tests/spell-on-inventory-closes-dialogue.test.cjs
// A spell cast on an inventory item (the client's IF_BUTTONT, decoded as widget_target) didn't close the open dialogue,
// so an item a dialogue had just checked ("has an iron bar") could be high-alched while its menu stayed open, and the
// menu's action then paid anyway. It now closes the dialogue as an inventory click does. Native input: a real Player,
// a real ClientConnection and the widget_target packet.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PluginManager.emitServerStartup({});
  core = PluginManager.getCoreApi();
});
after(() => PluginManager.emitServerShutdown({}));

function connected(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const p = new Player(session, new core.Location(3222, 3218, 0));
  p.setUsername("alch-mid-dialogue");
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  session.setPlayer(p);
  t.after(() => p.setRegistered(false));
  const connection = new ClientConnection(channel);
  connection.player = p;
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  return { p, send };
}

test("a spell cast on an inventory item closes the open dialogue", async (t) => {
  const { p, send } = connected(t);
  p.getInventory().setItem(0, new core.Item(core.ItemIdentifiers.IRON_BAR, 1));
  p.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, "Craft a scarab emblem?")));
  assert.equal(p.getDialogueManager().isActive(), true, "a dialogue is open");
  await send({ type: "widget_target", targetWidgetId: (149 << 16), targetSlot: 0, targetItemId: core.ItemIdentifiers.IRON_BAR,
    sourceWidgetId: (218 << 16) | 44, sourceSlot: -1, sourceItemId: -1 });
  assert.equal(p.getDialogueManager().isActive(), false, "casting on the inventory closed it");
});
