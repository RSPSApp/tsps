// Run after `yarn build`: node --test tests/wield-mid-teleport.test.cjs
// A named Wield/Wear option went straight to the equip listener, past the left-click route's refusal mid-teleport,
// so gear could be swapped during a teleport's delay. Native input: a real Player, a real ClientConnection and the
// inventory_action packet the client sends.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { EquipPacketListener } = require("../dist/net/packet/impl/EquipPacketListener");
const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  PluginManager.emitServerStartup({});
});

async function wield(t, teleporting) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const p = new Player(session, new core.Location(3222, 3218, 0));
  p.setUsername(`wield_${teleporting}`);
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  session.setPlayer(p);
  t.after(() => p.setRegistered(false));
  p.getSkillManager().setLevel(core.Skill.ATTACK, 99);
  p.getInventory().setItem(0, new Item(ItemIdentifiers.ABYSSAL_WHIP));
  p.setTeleporting(teleporting);
  const connection = new ClientConnection(channel);
  connection.player = p;
  await connection.dispatch([{ type: "inventory_action", widgetId: 149 << 16, slot: 0, itemId: ItemIdentifiers.ABYSSAL_WHIP, option: "Wield", optionIndex: 2 }]);
  connection.processTurnPackets();
  return p.getEquipment().getWeapon().getId();
}

test("a named Wield mid-teleport equips nothing; otherwise it equips", async (t) => {
  assert.equal(await wield(t, true), -1, "mid-teleport: no swap");
  assert.equal(await wield(t, false), ItemIdentifiers.ABYSSAL_WHIP);
});

/** A real player at home with `setup` applied, teleporting or not, and the connection its client packets go through. */
function connected(t, name, teleporting, setup) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const p = new Player(session, new core.Location(3222, 3218, 0));
  p.setUsername(`${name}_${teleporting}`);
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  session.setPlayer(p);
  t.after(() => p.setRegistered(false));
  setup(p);
  p.setTeleporting(teleporting);
  const connection = new ClientConnection(channel);
  connection.player = p;
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  return { p, send };
}

test("Remove on the equipment tab mid-teleport takes nothing off; otherwise it does", async (t) => {
  for (const teleporting of [true, false]) {
    const { p, send } = connected(t, "remove", teleporting, (player) => {
      player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new Item(ItemIdentifiers.ABYSSAL_WHIP));
    });
    // The worn-equipment tab (387): the weapon slot's component, op1 Remove.
    const childId = 15 + EquipPacketListener.EQUIPMENT_SLOTS.indexOf(core.Equipment.WEAPON_SLOT);
    await send({ type: "widget_action", widgetId: (387 << 16) | childId, groupId: 387, childId, buttonNum: 1 });
    assert.equal(p.getEquipment().getWeapon().getId(), teleporting ? ItemIdentifiers.ABYSSAL_WHIP : -1, teleporting ? "mid-teleport: still worn" : "removed");
  }
});
