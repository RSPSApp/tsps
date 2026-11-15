// Run after `yarn build`: node --test tests/shantay-unkah-guard.test.cjs
// The Ruins of Unkah Shantay Guard (NPC 10634) sells passes: Buy-pass and "I want to buy a
// Shantay pass" take 5 coins and show "You purchase a Shantay Pass." (rsprox.net recs 327, 1437).
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const path = require("node:path");

process.env.DISABLE_PLAYER_BOTS = "1";
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");

const GUARD = 10634;
const COINS = 995;
const SHANTAY_PASS = 1854;
const PURCHASE = "You purchase a Shantay Pass.";
const NO_MONEY = "Sorry friend, the Shantay Pass is 5 gold coins. You don't seem to have enough money!";
// An open Lumbridge tile, as tests/shantay-pass.test.cjs uses: the guard's desk is not the point here.
const AT = [3226, 3218];

let native;
let nextIndex = 1960;

before(async () => {
  await CachePipeline.initialize();
  native = PluginManager.getCoreApi();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  native.RegionManager.init();
  native.RegionManager.loadMapFiles(AT[0], AT[1]);
  PluginManager.emitServerStartup({});
});
after(() => PluginManager.emitServerShutdown({}));

function setUp(t, { coins = 10, fill = false } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername("unkahbuyer" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new native.Location(AT[0], AT[1], 0));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  const npc = native.NPC.create(GUARD, new native.Location(AT[0] + 1, AT[1], 0));
  assert.equal(native.World.getNpcs().add(npc), true);
  t.after(() => {
    player.closeInterruptibleInterfaces();
    PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    native.TaskManager.cancelTasks(player.getIndex());
    native.TaskManager.cancelTasks(player);
    native.World.getNpcs().remove(npc);
  });
  const inv = player.getInventory();
  if (coins) inv.add(new native.Item(COINS, coins), false);
  if (fill) while (inv.getFreeSlots() > 0) inv.add(new native.Item(native.ItemIdentifiers.LOGS), false);
  const messages = [];
  const sendMessage = player.sendMessage.bind(player);
  t.mock.method(player, "sendMessage", (message) => { messages.push(message); return sendMessage(message); });
  const turn = () => {
    player.resetUpdating();
    native.World.processCycle = (native.World.processCycle + 1) & 0x7fffffff;
    native.TaskManager.process();
    connection.processTurnPackets();
    const queue = player.getMovementQueue();
    queue.beginCycle();
    queue.processEntityPursuit();
    if (queue.hasPendingWork()) queue.process();
    native.TaskManager.processWalkTo(player.getIndex());
  };
  const click = async (option) => {
    const op = npc.getCurrentDefinition(player).getActions().indexOf(option) + 1;
    assert.ok(op > 0, option);
    await connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: op }]);
    turn();
    for (let n = 0; n < 6 && !player.getDialogueManager().getCurrent(); n++) turn();
    return player.getDialogueManager().getCurrent();
  };
  return { player, npc, inv, messages, click, turn };
}

test("the guard is the Ruins of Unkah Shantay Guard with Buy-pass", (t) => {
  const { npc, player } = setUp(t);
  const definition = npc.getCurrentDefinition(player);
  assert.equal(definition.getName(), "Shantay Guard");
  assert.ok(definition.getActions().includes("Buy-pass"));
});

test("Buy-pass takes 5 coins and shows the pass in an item box at once", async (t) => {
  const { inv, click } = setUp(t);
  const current = await click("Buy-pass");
  assert.ok(current instanceof native.ItemStatementDialogue, current?.constructor.name);
  assert.equal(current.getText(), PURCHASE);
  assert.equal(inv.getAmount(COINS), 5);
  assert.equal(inv.getAmount(SHANTAY_PASS), 1);
});

test("Buy-pass with fewer than 5 coins gets the guard's refusal and costs nothing", async (t) => {
  const { inv, click } = setUp(t, { coins: 4 });
  const current = await click("Buy-pass");
  assert.ok(current, "a refusal line");
  assert.equal(current.getText?.(), NO_MONEY);
  assert.equal(inv.getAmount(COINS), 4);
  assert.equal(inv.getAmount(SHANTAY_PASS), 0);
});

test("Buy-pass with no room for a pass keeps the coins", async (t) => {
  const { inv, click, messages, turn } = setUp(t, { fill: true });
  await click("Buy-pass");
  turn();
  assert.equal(inv.getAmount(COINS), 10);
  assert.equal(inv.getAmount(SHANTAY_PASS), 0);
  assert.ok(messages.includes("You cannot hold any more Shantay passes."), JSON.stringify(messages));
});

test("Talk-to's \"I want to buy a Shantay pass\" buys one after the guard's answer", async (t) => {
  const { player, inv, click } = setUp(t);
  await click("Talk-to");
  const menu = MultiChatboxPrompt.getPending(player);
  assert.ok(menu?.options.includes("I want to buy a Shantay pass for 5 gold coins."), JSON.stringify(menu));
  const slot = menu.options.indexOf("I want to buy a Shantay pass for 5 gold coins.") + 1;
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player, groupId: 219, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot, action: slot }), true);
  const dialogue = player.getDialogueManager();
  const seen = [];
  for (let n = 0; n < 6 && !(dialogue.getCurrent() instanceof native.ItemStatementDialogue); n++) {
    seen.push(dialogue.getCurrent()?.getText?.());
    dialogue.advance();
  }
  assert.ok(seen.includes("Absolutely, friend."), JSON.stringify(seen));
  assert.equal(dialogue.getCurrent()?.getText?.(), PURCHASE, JSON.stringify(seen));
  assert.equal(inv.getAmount(COINS), 5);
  assert.equal(inv.getAmount(SHANTAY_PASS), 1);
});
