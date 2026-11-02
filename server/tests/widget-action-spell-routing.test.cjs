const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { InterfaceActionClickOpcode } = require("../dist/net/packet/impl/InterfaceActionClickOpcode");
const { EffectSpells } = require("../dist/game/content/combat/magic/EffectSpells");

let core;
let playerIndex = 800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

function createPlayer(t) {
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
  player.setIndex(playerIndex++);
  player.setUsername(`spell-routing-${playerIndex}`);
  player.setRegistered(true);
  player.needsPlacement = false;
  player.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => {
    PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
  });
  return { player, connection };
}

function addBonesSpellRunes(player) {
  for (const [id, amount] of [[526, 1], [561, 2], [555, 4], [557, 4]]) {
    player.getInventory().add(new core.Item(id, amount), false);
  }
}

async function sendWidgetAction(connection, packet) {
  await connection.dispatch([packet]);
  connection.processTurnPackets();
}

function offerWidgetAction(itemId) {
  return {
    type: "widget_action",
    widgetId: (465 << 16) | 7,
    groupId: 465,
    childId: 7,
    slot: 0,
    buttonNum: 1,
    itemId,
  };
}

test("Grand Exchange item actions cannot cast spells from colliding item ids", async (t) => {
  for (const [itemId, expectedName] of [
    [1159, "Mithril full helm"],
    [1162, "Adamant full helm"],
    [1168, "Leather cowl"],
    [1173, "Bronze sq shield"],
    [1178, "Steel sq shield"],
    [15877, "Bandos cloak"],
  ]) {
    const { player, connection } = createPlayer(t);
    addBonesSpellRunes(player);
    player.getInventory().add(new core.Item(itemId), false);
    assert.equal(core.CacheDefinitions.getItem(itemId).name, expectedName);

    await sendWidgetAction(connection, offerWidgetAction(itemId));

    assert.equal(player.getInventory().getAmount(526), 1, `${expectedName} must not cast a spell`);
    assert.equal(player.getInventory().getAmount(1963), 0);
    assert.equal(player.getInventory().getAmount(6883), 0);
  }
});

test("effect spell IDs cannot cast from non-spell widget groups", async (t) => {
  const { player, connection } = createPlayer(t);
  const effectSpellIds = [...EffectSpells.map.keys()].sort((left, right) => left - right);
  const nonSpellGroups = [465, 149, 12, 300, 30004];
  const receivedSpellIds = [];
  t.mock.method(EffectSpells, "handleSpell", (_player, spellId) => {
    receivedSpellIds.push(spellId);
    return false;
  });
  t.mock.method(InterfaceActionClickOpcode, "handle", () => true);

  assert.deepEqual(effectSpellIds, [1159, 1162, 1168, 1173, 1178, 3280, 6884, 9107, 9135, 9136, 15877]);
  for (const groupId of nonSpellGroups) {
    for (const itemId of effectSpellIds) {
      await sendWidgetAction(connection, {
        type: "widget_action",
        widgetId: (groupId << 16) | 7,
        groupId,
        childId: 7,
        slot: -1,
        buttonNum: 1,
        itemId,
      });
    }
  }

  assert.equal(receivedSpellIds.length, nonSpellGroups.length * effectSpellIds.length);
  assert.ok(receivedSpellIds.every((spellId) => spellId === -1));
});

test("a spellbook self-cast still resolves its canonical spell name", async (t) => {
  const { player, connection } = createPlayer(t);
  addBonesSpellRunes(player);
  const spell = core.CacheDefinitions.getSpellByName("Bones to Bananas");
  assert.ok(spell);

  await sendWidgetAction(connection, {
    type: "widget_action",
    widgetId: spell.widgetId,
    groupId: spell.widgetId >>> 16,
    childId: spell.widgetId & 0xffff,
    slot: -1,
    buttonNum: 1,
    itemId: spell.itemId,
  });

  assert.equal(player.getInventory().getAmount(526), 0);
  assert.equal(player.getInventory().getAmount(1963), 1);
});

test("a widget-only spellbook self-cast resolves without an item id", async (t) => {
  const { player, connection } = createPlayer(t);
  addBonesSpellRunes(player);
  const spell = core.CacheDefinitions.getSpellByName("Bones to Bananas");
  assert.ok(spell);

  await sendWidgetAction(connection, {
    type: "widget_action",
    widgetId: spell.widgetId,
    groupId: spell.widgetId >>> 16,
    childId: spell.widgetId & 0xffff,
    slot: -1,
    buttonNum: 1,
  });

  assert.equal(player.getInventory().getAmount(526), 0);
  assert.equal(player.getInventory().getAmount(1963), 1);
});

test("non-effect spell metadata cannot route a colliding item id to an effect spell", async (t) => {
  const { connection } = createPlayer(t);
  const spell = core.CacheDefinitions.getSpellByName("Ice Barrage");
  const effectSpellIds = [];
  assert.ok(spell);
  assert.equal(core.CacheDefinitions.getSpellName(spell.widgetId, -1), "Ice Barrage");
  t.mock.method(EffectSpells, "handleSpell", (_player, spellId) => {
    effectSpellIds.push(spellId);
    return false;
  });
  t.mock.method(InterfaceActionClickOpcode, "handle", () => true);

  await sendWidgetAction(connection, {
    type: "widget_action",
    widgetId: spell.widgetId,
    groupId: spell.widgetId >>> 16,
    childId: spell.widgetId & 0xffff,
    slot: -1,
    buttonNum: 1,
    itemId: 1159,
  });

  assert.deepEqual(effectSpellIds, [-1]);
});

test("spell widgets from each book remain eligible for canonical resolution", () => {
  for (const name of ["Bones to Bananas", "Ice Barrage", "Cure Me", "Resurrect Crops"]) {
    const spell = core.CacheDefinitions.getSpellByName(name);
    assert.ok(spell, `${name} must exist in the cache`);
    assert.equal(core.CacheDefinitions.isSpellWidgetGroup(spell.widgetId >>> 16), true, name);
    assert.equal(core.CacheDefinitions.getSpellName(spell.widgetId, -1), name);
  }
});

test("an unrecognized spell group still reaches the interface action handler", async (t) => {
  const { player, connection } = createPlayer(t);
  const received = [];
  t.mock.method(InterfaceActionClickOpcode, "handle", (...args) => {
    received.push(args);
    return true;
  });

  await sendWidgetAction(connection, offerWidgetAction(1159));

  assert.equal(received.length, 1);
  assert.equal(received[0][3].groupId, 465);
  assert.equal(received[0][3].itemId, 1159);
});
