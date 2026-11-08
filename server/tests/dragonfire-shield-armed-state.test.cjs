// Run after `yarn build`: node --test tests/dragonfire-shield-armed-state.test.cjs
// The shield's Activate shares sa_attack (varp 301) with the weapon special: arming the special, or equipping a weapon,
// leaves the shield disarmed. A blast must not fire afterwards from a stale "armed" flag.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
const { ClientPacketId } = require("../dist/net/protocol/NativeClientPackets");
const { EquipPacketListener } = require("../dist/net/packet/impl/EquipPacketListener");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const DragonfireShield = require("../plugins/items/DragonfireShield.plugin");

const core = PluginManager.getCoreApi();
const SHIELDS = [ItemIdentifiers.DRAGONFIRE_SHIELD, ItemIdentifiers.DRAGONFIRE_WARD, ItemIdentifiers.ANCIENT_WYVERN_SHIELD];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  require("../plugins/combat/specials/DragonWarhammer.SpecialAttack")({ core, registerCombatSpecial: CombatSpecial.register });
  DragonfireShield.register(PluginManager.createApi("DragonfireShield"));
});

let nextIndex = 9650;
function armedPlayer(t, shieldId) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername(`dfsarmed${player.getIndex()}`);
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(ItemIdentifiers.DRAGON_WARHAMMER, 1));
  const shield = new core.Item(shieldId, 1);
  DragonfireShield._test.setCharges(shield, 50);
  player.getEquipment().setItem(core.Equipment.SHIELD_SLOT, shield);
  WeaponInterfaceManager.assign(player);
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  DragonfireShield._test.activate({ player, item: shield });
  assert.equal(player.getPacketSender().getVarp(301), 2, "worn Activate arms the blast");
  assert.equal(CombatFactory.getMethod(player)?.constructor?.name, "DragonfireShieldBlast");
  return { player, connection };
}

function orbClick() {
  const frame = Buffer.alloc(9);
  frame[0] = ClientPacketId.IF_BUTTON1;
  frame.writeInt32BE(core.CacheDefinitions.getComponentId("orbs:specbutton") | 0, 1);
  frame.writeUInt16BE(65535, 5);
  frame.writeUInt16BE(65535, 7);
  return decodeClientPackets(frame);
}

test("arming and cancelling the weapon special disarms the shield blast", async (t) => {
  for (const shieldId of SHIELDS) {
    const { player, connection } = armedPlayer(t, shieldId);
    await connection.dispatch(orbClick(), true);
    assert.equal(player.isSpecialActivated(), true);
    await connection.dispatch(orbClick(), true);
    assert.equal(player.isSpecialActivated(), false);
    assert.equal(player.getPacketSender().getVarp(301), 0);
    assert.notEqual(CombatFactory.getMethod(player)?.constructor?.name, "DragonfireShieldBlast", `shield ${shieldId}`);
  }
});

test("equipping a weapon disarms the shield blast", async (t) => {
  for (const shieldId of SHIELDS) {
    const { player } = armedPlayer(t, shieldId);
    player.getInventory().setItem(0, new core.Item(ItemIdentifiers.BRONZE_SCIMITAR, 1));
    EquipPacketListener.equip(player, ItemIdentifiers.BRONZE_SCIMITAR, 0, Inventory.INTERFACE_ID);
    assert.equal(player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getId(), ItemIdentifiers.BRONZE_SCIMITAR);
    assert.notEqual(CombatFactory.getMethod(player)?.constructor?.name, "DragonfireShieldBlast", `shield ${shieldId}`);
  }
});
