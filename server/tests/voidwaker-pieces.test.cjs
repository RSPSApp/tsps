// Run after `yarn build`: node --test tests/voidwaker-pieces.test.cjs
// The Voidwaker pieces' Inspect lines (Wiki: Voidwaker hilt, Voidwaker blade, Voidwaker gem) and
// the line for using one piece on another (Wiki: Voidwaker), through the real hook dispatch with
// a real Player and cache. docs/wilderness-bosses.md#voidwaker-pieces.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const { Item } = require('../dist/game/model/Item');
const VoidwakerPieces = require('../plugins/bosses/wildernessbosses/VoidwakerPieces.WildernessBosses');

let core, madam, nextPlayerIndex = 16500;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3174, 10040);
  PluginManager.emitServerStartup({});
  madam = [...core.World.getNpcs()].find((npc) => npc && npc.getId() === core.NpcIdentifiers.MADAM_SIKARO);
  assert.ok(madam, 'Madam Sikaro is spawned by the WildernessBosses plugin');
});
after(() => PluginManager.emitServerShutdown({}));

const obj = (gameval) => core.CacheDefinitions.getObjId(gameval);
const itemId = (name) => core.ItemIdentifiers[name];

// The Wiki's quoted lines, by gameval.
const INSPECT = {
  wbr_voidwaker_hilt: "A sturdy hilt. It's part of what looks to be a powerful weapon. Perhaps someone in Ferox Enclave would know what it is?",
  wbr_voidwaker_blade: 'A sharp blade. It looks to be the deadliest part of a powerful weapon. Perhaps someone in Ferox Enclave would know what it is?',
  wbr_voidwaker_gem: 'A magical gem. It looks like it could be fitted into a powerful weapon. Perhaps someone in Ferox Enclave would know what it is?',
};
const COMBINE = "You don't think you have the skills to reassemble this weapon yourself.";

/** A player holding the three pieces in slots 0-2, whose chat lines land in `messages`. */
function holder(t) {
  const player = new Player(null);
  const messages = [];
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(player, 'sendMessage', (text) => { messages.push(text); });
  Object.keys(INSPECT).forEach((gameval, slot) => player.getInventory().setItem(slot, new Item(obj(gameval), 1)));
  return { player, messages };
}

function actor(t, contents = []) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextPlayerIndex++);
  player.setUsername(`sikaro${player.getIndex()}`);
  player.setRegistered(true);
  player.setLocation(new core.Location(3174, 10040, 0));
  player.needsPlacement = false;
  for (const [slot, name, amount] of contents) player.getInventory().setItem(slot, new Item(itemId(name), amount));
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => {
    player.closeInterruptibleInterfaces();
    PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  const tick = () => {
    core.TaskManager.processWalkTo(player.getIndex());
    player.getMovementQueue().process();
    core.TaskManager.process();
    connection.processTurnPackets();
  };
  const send = async (packet) => { await connection.dispatch([packet]); for (let i = 0; i < 3; i++) tick(); };
  const group = () => player.getPacketSender().getChatboxGroupId();
  async function menu() {
    for (let i = 0; i < 30; i++) {
      const current = player.getDialogueManager().getCurrent();
      if (typeof current?.getOptions === 'function') return current.getOptions();
      const pending = MultiChatboxPrompt.getPending(player);
      if (pending) return pending.options;
      if (!player.getDialogueManager().isActive()) return null;
      const g = group();
      await send({ type: 'dialogue_continue', widgetId: (g << 16) | ([229].includes(g) ? 4 : 5), childIndex: -1 });
    }
    return null;
  }
  async function choose(option) {
    const options = await menu();
    assert.ok(options, 'a dialogue choice is open');
    const index = options.indexOf(option);
    assert.ok(index >= 0, `${option} is in ${JSON.stringify(options)}`);
    await send({ type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: index + 1 });
  }
  async function talk() {
    const action = madam.getCurrentDefinition(player).getActions().findIndex((name) => name === 'Talk-to') + 1;
    assert.ok(action > 0, 'Madam Sikaro has Talk-to');
    await send({ type: 'npc_option', index: madam.getIndex(), clickType: action });
    assert.equal(player.getDialogueManager().isActive(), true);
  }
  async function useOn(itemId) {
    const slot = player.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
    await send({ type: 'item_on_npc', targetIndex: madam.getIndex(), itemId, slot, widgetId: core.Inventory.INTERFACE_ID << 16 });
  }
  return { player, connection, send, menu, choose, talk, useOn, tick };
}

const held = (player) => [0, 1, 2].map((slot) => player.getInventory().getItems()[slot]?.getId() ?? -1);

test('the cache names the hooks match are the three pieces, each with Inspect', () => {
  for (const gameval of Object.keys(INSPECT)) {
    const def = core.ItemDefinition.forId(obj(gameval));
    assert.ok(VoidwakerPieces._test.PIECES[def.getName()], `${gameval} (${def.getName()}) has no line`);
    assert.equal(core.CacheDefinitions.getItem(obj(gameval)).inventoryActions[0], 'Inspect', gameval);
  }
});

test("Inspect sends the piece's Wiki line to the chat and changes nothing", (t) => {
  Object.entries(INSPECT).forEach(([gameval, line], slot) => {
    const { player, messages } = holder(t);
    const item = player.getInventory().getItems()[slot];
    const handled = PluginManager.emitItemAction({ player, item, itemId: obj(gameval), slot, clickType: 1, handled: false });
    assert.equal(handled, true, gameval);
    assert.deepEqual(messages, [line], gameval);
    assert.deepEqual(held(player), Object.keys(INSPECT).map(obj), gameval);
  });
});

test('one piece on another, in either order, says the player cannot reassemble it and uses nothing up', (t) => {
  const ids = Object.keys(INSPECT).map(obj);
  for (let used = 0; used < 3; used++) {
    for (let target = 0; target < 3; target++) {
      if (used === target) continue;
      const { player, messages } = holder(t);
      const items = player.getInventory().getItems();
      const handled = PluginManager.emitItemOnItem({
        player, usedItem: items[used], usedItemId: ids[used], usedItemSlot: used,
        usedWithItem: items[target], usedWithItemId: ids[target], usedWithItemSlot: target, handled: false,
      });
      assert.equal(handled, true, `${used} on ${target}`);
      assert.deepEqual(messages, [COMBINE], `${used} on ${target}`);
      assert.deepEqual(held(player), ids, `${used} on ${target}`);
    }
  }
});

test('a piece on something else is left to other handlers', (t) => {
  const { player, messages } = holder(t);
  player.getInventory().setItem(5, new Item(obj('voidwaker'), 1));
  const items = player.getInventory().getItems();
  PluginManager.emitItemOnItem({
    player, usedItem: items[0], usedItemId: items[0].getId(), usedItemSlot: 0,
    usedWithItem: items[5], usedWithItemId: obj('voidwaker'), usedWithItemSlot: 5, handled: false,
  });
  assert.deepEqual(messages.filter((m) => m === COMBINE), []);
});

const PART_NAMES = ['VOIDWAKER_HILT', 'VOIDWAKER_BLADE', 'VOIDWAKER_GEM'];
const partsAndCoins = () => [...PART_NAMES.map((name, slot) => [slot, name, 1]), [3, 'COINS', 600000]];

test('Madam Sikaro uses the recorded spawn tile and faces west', () => {
  const at = madam.getLocation();
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [3175, 10040, 0]);
  assert.equal(madam.getFace().getDirection().getId(), core.Direction.WEST.getId());
});

test('native Talk-to packets assemble one Voidwaker for three parts and 500,000 coins', async (t) => {
  const f = actor(t, partsAndCoins());
  await f.talk();
  await f.choose('I have this part that looks like it\'s from a weapon...');
  await f.choose('Yes');
  const inventory = f.player.getInventory();
  assert.equal(inventory.getAmount(itemId('VOIDWAKER_HILT')), 0);
  assert.equal(inventory.getAmount(itemId('VOIDWAKER_BLADE')), 0);
  assert.equal(inventory.getAmount(itemId('VOIDWAKER_GEM')), 0);
  assert.equal(inventory.getAmount(itemId('COINS')), 100000);
  assert.equal(inventory.getAmount(itemId('VOIDWAKER')), 1);
  assert.equal(f.player.getAttribute('wilderness-bosses:madam-sikaro-assembled'), true);
});

test('native Yes rechecks the fee and parts after opening the offer', async (t) => {
  const f = actor(t, partsAndCoins());
  await f.talk();
  await f.choose('I have this part that looks like it\'s from a weapon...');
  const options = await f.menu();
  assert.ok(options?.includes('Yes'), 'the confirmation is open before inventory changes');
  f.player.getInventory().deleteNumber(itemId('COINS'), 101000);
  await f.choose('Yes');
  assert.equal(f.player.getInventory().getAmount(itemId('COINS')), 499000);
  assert.equal(f.player.getInventory().getAmount(itemId('VOIDWAKER_HILT')), 1);
  assert.equal(f.player.getInventory().getAmount(itemId('VOIDWAKER')), 0);
  assert.equal(f.player.getAttribute('wilderness-bosses:madam-sikaro-assembled'), undefined);
});

test('native Yes rechecks that every part is still held after opening the offer', async (t) => {
  const f = actor(t, partsAndCoins());
  await f.talk();
  await f.choose('I have this part that looks like it\'s from a weapon...');
  assert.ok((await f.menu())?.includes('Yes'));
  f.player.getInventory().deleteNumber(itemId('VOIDWAKER_GEM'), 1);
  await f.choose('Yes');
  assert.equal(f.player.getInventory().getAmount(itemId('COINS')), 600000);
  assert.equal(f.player.getInventory().getAmount(itemId('VOIDWAKER_HILT')), 1);
  assert.equal(f.player.getInventory().getAmount(itemId('VOIDWAKER_BLADE')), 1);
  assert.equal(f.player.getInventory().getAmount(itemId('VOIDWAKER')), 0);
  assert.equal(f.player.getAttribute('wilderness-bosses:madam-sikaro-assembled'), undefined);
});

test('noted Voidwaker parts do not unlock the assembly dialogue', async (t) => {
  const notedParts = PART_NAMES.map((name) => core.ItemDefinition.forId(itemId(name)).getNoteId());
  assert.ok(notedParts.every((id) => id > 0), 'each piece has a noted form');
  const f = actor(t, [[3, 'COINS', 600000]]);
  notedParts.forEach((id, slot) => f.player.getInventory().setItem(slot, new Item(id, 1)));
  await f.talk();
  const options = await f.menu();
  assert.ok(options);
  assert.equal(options.includes('I have this part that looks like it\'s from a weapon...'), false);
});

test('native No keeps the parts and coins while shifting inventory slots', async (t) => {
  const f = actor(t, [...partsAndCoins(), [4, 'LOGS', 1], [5, 'BRONZE_ARROW', 1]]);
  const before = f.player.getInventory().getItems().map((item) => item.getId());
  await f.talk();
  await f.choose('I have this part that looks like it\'s from a weapon...');
  await f.choose('No');
  await f.menu(); // Advance the transcript's refusal banter to its inventory-shift message step.
  const inventory = f.player.getInventory();
  const after = inventory.getItems().map((item) => item.getId());
  assert.notDeepEqual(after, before);
  assert.equal(inventory.getAmount(itemId('COINS')), 600000);
  for (const name of PART_NAMES) assert.equal(inventory.getAmount(itemId(name)), 1);
  assert.equal(inventory.getAmount(itemId('VOIDWAKER')), 0);
});

test('item-on-NPC packets start Madam Sikaro’s transcript variants', async (t) => {
  const f = actor(t, [[0, 'VOIDWAKER', 1], [1, 'LOGS', 1]]);
  await f.useOn(itemId('VOIDWAKER'));
  assert.equal(f.player.getDialogueManager().getCurrent()?.getText(), 'So what exactly is this sword, anyway?');
  f.player.closeInterruptibleInterfaces();
  await f.useOn(itemId('LOGS'));
  assert.equal(f.player.getDialogueManager().getCurrent()?.getText(), "No thank you, I'm currently on a diet.");
});

test('the assembled attribute survives the actual PlayerSave round trip', (t) => {
  const original = actor(t, []);
  original.player.setAttribute('wilderness-bosses:madam-sikaro-assembled', true);
  const saved = PlayerSave.fromPlayer(original.player);
  const restored = actor(t, []);
  saved.applyToPlayer(restored.player);
  assert.equal(restored.player.getAttribute('wilderness-bosses:madam-sikaro-assembled'), true);
});
