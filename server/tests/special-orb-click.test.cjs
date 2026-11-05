// Run after `yarn build`: node --test tests/special-orb-click.test.cjs
// The orb's native widget operation is the input. Its CS2 varp301 prediction must never
// activate separately, including when a previous web bundle still forwards that prediction.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
const { ClientPacketId: NativeClientPacket } = require("../dist/net/protocol/NativeClientPackets");
const { DuelRule, DuelState } = require("../dist/game/content/Duelling");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");

const core = PluginManager.getCoreApi();
const WEAPON_ID = ItemIdentifiers.DRAGON_WARHAMMER;
const SPECIAL_ORB_COMPONENTS = [
  "orbs:specbutton", "orbs_nomap:specbutton", "orbs_osm:specbutton", "orbs_osm_nomap:specbutton",
];

require("../plugins/combat/specials/DragonWarhammer.SpecialAttack")({
  core,
  registerCombatSpecial: CombatSpecial.register,
});
require("../plugins/combat/specials/GraniteMaul.SpecialAttack")({
  core,
  registerCombatSpecial: CombatSpecial.register,
});

require("../plugins/combat/specials/DragonAxe.SpecialAttack")({
  core,
  registerCombatSpecial: CombatSpecial.register,
});

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({
    log() {}, onPlayerLogin() {}, registerContentEndpoint() {},
  });
});

let nextIndex = 9450;

/** A real PlayerSession player with the active cache's item definitions. */
function realPlayer(t, weaponId = WEAPON_ID) {
  const channel = {
    kind: "test",
    remoteAddress: "127.0.0.1",
    isOpen: () => true,
    send: () => true,
    close() {},
    onData() {},
    onError() {},
    onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername(`orbnative${player.getIndex()}`);
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  if (weaponId != null) {
    player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weaponId, 1));
    WeaponInterfaceManager.assign(player);
  }
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => {
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, connection };
}

/** A native widget operation with no slot or item. */
function buttonFrame(widgetId, buttonNum = 1) {
  const frame = Buffer.alloc(9);
  frame[0] = buttonNum === 1 ? NativeClientPacket.IF_BUTTON1 : NativeClientPacket.IF_BUTTON2;
  frame.writeInt32BE(widgetId | 0, 1);
  frame.writeUInt16BE(65535, 5);
  frame.writeUInt16BE(65535, 7);
  return frame;
}

test("a forwarded special-state prediction is not a separate activation command", async (t) => {
  const { player, connection } = realPlayer(t);
  for (const active of [false, true]) {
    player.setSpecialActivated(active);
    for (const value of [0, 1]) {
      await connection.dispatch([{ type: "varp_transmit", varpId: 301, value }], true);
      assert.equal(player.isSpecialActivated(), active, "only the native operation decides");
    }
  }
  await connection.dispatch([{ type: "varp_transmit", varpId: 173, value: 0 }], true);
  assert.equal(player.isRunningReturn(), false, "other varp input retains its behavior");
});

test("every cache special-attack orb button activates and cancels the real weapon special", async (t) => {
  for (const name of SPECIAL_ORB_COMPONENTS) {
    const widgetId = core.CacheDefinitions.getComponentId(name);
    assert.ok(widgetId, `the active cache names ${name}`);
    const { player, connection } = realPlayer(t);
    const messages = decodeClientPackets(buttonFrame(widgetId));
    assert.equal(messages.length, 1, `${name} decodes one native button`);
    assert.equal(messages[0].type, "widget_action");
    assert.equal(messages[0].widgetId, widgetId, `${name} widget id`);
    assert.equal(messages[0].groupId, widgetId >>> 16, `${name} group id`);
    assert.equal(messages[0].childId, widgetId & 0xffff, `${name} child id`);
    assert.equal(messages[0].buttonNum, 1, `${name} uses op 1`);

    const offhand = decodeClientPackets(buttonFrame(widgetId, 2));
    await connection.dispatch(offhand, true);
    assert.equal(player.isSpecialActivated(), false, `${name} op2 cannot arm mainhand`);
    await connection.dispatch(messages, true);
    assert.equal(player.isSpecialActivated(), true, `${name} arms the special`);
    await connection.dispatch(offhand, true);
    assert.equal(player.isSpecialActivated(), true, `${name} op2 cannot cancel mainhand`);
    await connection.dispatch(messages, true);
    assert.equal(player.isSpecialActivated(), false, `${name} cancels on the next click`);
    await connection.dispatch(messages, true);
    assert.equal(player.isSpecialActivated(), true, `${name} can be armed again`);
  }
});

test("the combat tab's special bar keeps using the same native activation", async (t) => {
  const { player, connection } = realPlayer(t);
  for (const childId of [41, 57]) {
    player.setSpecialActivated(false);
    const messages = decodeClientPackets(buttonFrame((593 << 16) | childId));
    await connection.dispatch(messages, true);
    assert.equal(player.isSpecialActivated(), true, `combat_interface:${childId} arms the special`);
    await connection.dispatch(messages, true);
    assert.equal(player.isSpecialActivated(), false, `combat_interface:${childId} cancels it`);
  }
});

test("the orb does nothing without a special weapon", async (t) => {
  const { player, connection } = realPlayer(t, null);
  const widgetId = core.CacheDefinitions.getComponentId("orbs:specbutton");
  assert.equal(player.getCombatSpecial(), undefined);
  await connection.dispatch(decodeClientPackets(buttonFrame(widgetId)), true);
  assert.equal(player.isSpecialActivated(), false);
});

test("a duel rule that forbids specials refuses the orb", async (t) => {
  const { player, connection } = realPlayer(t);
  const dueling = player.getDueling();
  dueling.setState(DuelState.IN_DUEL);
  dueling.getRules()[DuelRule.NO_SPECIAL_ATTACKS.getButtonId()] = true;
  const widgetId = core.CacheDefinitions.getComponentId("orbs:specbutton");
  await connection.dispatch(decodeClientPackets(buttonFrame(widgetId)), true);
  assert.equal(player.isSpecialActivated(), false, "the duel rule still gates the orb");
});

test("a content refusal through the existing plugin hook stops the orb", async (t) => {
  const { player, connection } = realPlayer(t);
  const hook = {
    pluginName: "special-orb-click-test",
    handler: (event) => {
      if (event.player === player) {
        event.disabled = true;
        event.message = "You cannot use special attacks here.";
      }
    },
  };
  PluginManager.specialAttackDisabledHooks.push(hook);
  t.after(() => {
    const index = PluginManager.specialAttackDisabledHooks.indexOf(hook);
    if (index >= 0) PluginManager.specialAttackDisabledHooks.splice(index, 1);
  });
  const widgetId = core.CacheDefinitions.getComponentId("orbs:specbutton");
  await connection.dispatch(decodeClientPackets(buttonFrame(widgetId)), true);
  assert.equal(player.isSpecialActivated(), false, "the shared CombatSpecial.activate hook still decides");
});

test("a queued special without enough energy is refused through the orb", async (t) => {
  const { player, connection } = realPlayer(t, ItemIdentifiers.GRANITE_MAUL);
  player.setSpecialPercentage(0);
  const widgetId = core.CacheDefinitions.getComponentId("orbs:specbutton");
  await connection.dispatch(decodeClientPackets(buttonFrame(widgetId)), true);
  assert.equal(player.isSpecialActivated(), false, "the existing energy gate is not bypassed");
});

test("the orb remains usable in the Wilderness", async (t) => {
  const { player, connection } = realPlayer(t);
  player.setLocation(new core.Location(3222, 3555, 0));
  assert.equal(core.Wilderness.isIn(player), true);
  await connection.dispatch(decodeClientPackets(buttonFrame(core.CacheDefinitions.getComponentId("orbs:specbutton"))), true);
  assert.equal(player.isSpecialActivated(), true);
});

test("a utility special executes immediately and spends energy once through the orb", async (t) => {
  const { player, connection } = realPlayer(t, ItemIdentifiers.DRAGON_AXE);
  const woodcutting = player.getSkillManager().getMaxLevel(core.Skill.WOODCUTTING);
  await connection.dispatch(decodeClientPackets(buttonFrame(core.CacheDefinitions.getComponentId("orbs:specbutton"))), true);
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.WOODCUTTING), woodcutting + 3);
  assert.equal(player.getSpecialPercentage(), 0);
  assert.equal(player.isSpecialActivated(), false);
});
