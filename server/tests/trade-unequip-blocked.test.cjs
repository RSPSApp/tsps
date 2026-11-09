// Run after `yarn build`: node --test tests/trade-unequip-blocked.test.cjs
// While a trade is open its side panel replaces the side tabs (live opens tradeside 336 in the sidemodal,
// rsprox_transcripts/227/00548.txt), so worn items can't come off. Here they could: taking off gear filled the
// slots the offer had freed, and declining then dropped the offered items on the floor.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
const { ClientPacketId } = require("../dist/net/protocol/NativeClientPackets");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");

let core;
let next = 9800;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  require("../plugins/interface/Trading.plugin").register(PluginManager.createApi("TradeUnequip"));
});

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setIndex(next++);
  player.setUsername("tradeunequip" + player.getIndex());
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => { core.TaskManager.cancelTasks(player); player.setRegistered(false); });
  return { player, connection };
}

/** Worn Equipment tab op 1 (Remove) on a slot's component (387:15 is the head). */
function removeFrame(childId) {
  const frame = Buffer.alloc(9);
  frame[0] = ClientPacketId.IF_BUTTON1;
  frame.writeInt32BE((387 << 16) | childId, 1);
  frame.writeUInt16BE(65535, 5);
  frame.writeUInt16BE(65535, 7);
  return decodeClientPackets(frame);
}

const WORN = [
  [() => core.Equipment.HEAD_SLOT, 15, () => core.ItemIdentifiers.BRONZE_FULL_HELM],
  [() => core.Equipment.CAPE_SLOT, 16, () => core.ItemIdentifiers.RED_CAPE],
  [() => core.Equipment.AMULET_SLOT, 17, () => core.ItemIdentifiers.AMULET_OF_STRENGTH],
  [() => core.Equipment.WEAPON_SLOT, 18, () => core.ItemIdentifiers.BRONZE_SHORTSWORD],
  [() => core.Equipment.BODY_SLOT, 19, () => core.ItemIdentifiers.BRONZE_PLATEBODY],
];

test("worn items can't be taken off while trading, so declining returns every offered item", async (t) => {
  const a = actor(t), b = actor(t);
  for (const [slot, , id] of WORN) a.player.getEquipment().setItem(slot(), new core.Item(id(), 1));
  for (let i = 0; i < 28; i++) a.player.getInventory().setItem(i, new core.Item(core.ItemIdentifiers.LOBSTER, 1));
  a.player.getTrading().requestTrade(b.player);
  b.player.getTrading().requestTrade(a.player);
  assert.equal(a.player.getStatus(), PlayerStatus.TRADING);
  for (let slot = 0; slot < 5; slot++) a.player.getTrading().handleItem(core.ItemIdentifiers.LOBSTER, 1, slot, a.player.getInventory(), a.player.getTrading().getContainer());
  assert.equal(a.player.getTrading().getContainer().getValidItems().length, 5, "five lobsters offered");

  for (const [, childId] of WORN) await a.connection.dispatch(removeFrame(childId), true);
  for (const [slot, , id] of WORN) assert.equal(a.player.getEquipment().getItems()[slot()].getId(), id(), "still worn");

  const dropped = t.mock.method(ItemOnGroundManager, "registers", () => {});
  a.player.getTrading().closeTrade();
  assert.equal(dropped.mock.callCount(), 0, "nothing dropped on the floor");
  assert.equal(a.player.getInventory().getAmount(core.ItemIdentifiers.LOBSTER), 28);
});

test("outside a trade the same Remove still takes the item off", async (t) => {
  const a = actor(t);
  a.player.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(core.ItemIdentifiers.BRONZE_FULL_HELM, 1));
  await a.connection.dispatch(removeFrame(15), true);
  assert.equal(a.player.getEquipment().getItems()[core.Equipment.HEAD_SLOT]?.getId?.() ?? -1, -1);
  assert.equal(a.player.getInventory().getAmount(core.ItemIdentifiers.BRONZE_FULL_HELM), 1);
});
