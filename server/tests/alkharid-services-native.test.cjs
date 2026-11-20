const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheIndexDat2 } = require("../dist/game/cache/codec/rs/cache/CacheIndex");
const { IndexType } = require("../dist/game/cache/codec/rs/cache/IndexType");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
let core, nextIndex = 9800;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function fixture(t) {
  const packets = [];
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: packet => { packets.push(packet); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++); player.setUsername(`alkharid${nextIndex}`); player.setRegistered(true);
  player.needsPlacement = false;
  player.setLocation(new core.Location(3272, 3181));
  const connection = new ClientConnection(channel); connection.player = player;
  t.after(() => { player.closeInterruptibleInterfaces(); player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, connection, packets };
}

async function resume(f, choice) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  const widgetId = choice == null ? (group << 16) | ([231, 217].includes(group) ? 5 : 0) : core.OptionDialogue.OPTIONS_WIDGET_ID;
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId, childIndex: choice ?? -1 }]);
  f.connection.processTurnPackets();
}

async function buy(f) {
  const npcId = core.NpcIdentifiers.KARIM;
  const npc = core.NPC.create(npcId, new core.Location(3272, 3181));
  PM.emitNpcInteraction({ player: f.player, npc, npcId, action: "Talk-to", clickType: 1, handled: false });
  await resume(f);
  const options = core.MultiChatboxPrompt.getPending(f.player)?.options ?? [];
  const yes = options.indexOf("Yes please.");
  assert.ok(yes >= 0, "ordinary Talk-to reaches Karim's canonical purchase option");
  await resume(f, yes + 1);
  const lines = [];
  for (let i = 0; i < 10 && f.player.getDialogueManager().getCurrent(); i++) {
    lines.push(f.player.getDialogueManager().getCurrent().getText?.());
    await resume(f);
  }
  return lines;
}

for (const [coins, full, expected] of [[2, false, 1], [0, false, 0], [2, true, 0], [1, true, 1]]) {
  test(`Karim purchase: ${coins} coins, full=${full}`, async t => {
    const f = fixture(t), inventory = f.player.getInventory(), I = core.ItemIdentifiers;
    if (coins) inventory.setItem(0, new core.Item(I.COINS, coins));
    if (full) for (let slot = 1; slot < 28; slot++) inventory.setItem(slot, new core.Item(I.COWHIDE, 1));
    const lines = await buy(f);
    assert.equal(inventory.getAmount(I.COINS), coins - expected);
    assert.equal(inventory.getAmount(I.KEBAB), expected);
    if (!coins) assert.ok(lines.includes("Oops, I forgot to bring any money with me."));
    assert.ok(f.packets.length > 0, "real PacketSender output");
    await resume(f, 2);
    assert.equal(inventory.getAmount(I.KEBAB), expected, "stale choice cannot buy again");
  });
}

test("the cache's actual IF1 tanning close button closes the modal and invalidates tanning", async t => {
  const f = fixture(t), I = core.ItemIdentifiers;
  f.player.getInventory().adds(I.COINS, 10).adds(I.COWHIDE, 1);
  const npcId = core.NpcIdentifiers.ELLIS;
  const npc = core.NPC.create(npcId, new core.Location(3277, 3191));
  f.player.setLocation(new core.Location(3277, 3191));
  const clickType = npc.getCurrentDefinition(f.player).getActions().indexOf("Trade") + 1;
  assert.ok(clickType > 0);
  PM.emitNpcInteraction({ player: f.player, npc, npcId, action: "Trade", clickType, handled: false });
  assert.equal(f.player.getInterfaceId(), 324);
  const index = CacheIndexDat2.fromStore(IndexType.DAT2.interfaces, CachePipeline.getStore());
  const close = index.getFileIds(324).find(id => Buffer.from(index.getFile(324, id).data)[1] === 3);
  assert.equal(close, 90, "active IF1 cache close is not hover layer 91");
  await f.connection.dispatch([{ type: "widget_action", widgetId: (324 << 16) | close, groupId: 324, childId: close, buttonNum: 1 }]);
  f.connection.processTurnPackets();
  assert.equal(f.player.getInterfaceId(), -1);
  await f.connection.dispatch([{ type: "widget_action", widgetId: (324 << 16) | 124, groupId: 324, childId: 124, buttonNum: 1 }]);
  f.connection.processTurnPackets();
  assert.equal(f.player.getInventory().getAmount(I.COWHIDE), 1, "stale tan cannot consume a hide");
  assert.equal(f.player.getInventory().getAmount(I.COINS), 10);
});
