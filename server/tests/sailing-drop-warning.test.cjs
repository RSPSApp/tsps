// Run after `yarn build`: node --test tests/sailing-drop-warning.test.cjs
// All Settings drop item warning on a boat (465): a drop on a boat's deck asks first with live's
// message box and four options; "don't ask again" saves the row, "this session" lasts until logout,
// off a boat nothing asks; and with the valuable item warning too, both ask in turn.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { Item } = require('../dist/game/model/Item');
const { DropItemPacketListener } = require('../dist/net/packet/impl/DropItemPacketListener');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
const { Sounds } = require('../dist/game/Sounds');
const { StatementDialogue } = require('../dist/game/model/dialogues/entries/impl/StatementDialogue');
const { ItemStatementDialogue } = require('../dist/game/model/dialogues/entries/impl/ItemStatementDialogue');
const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');
const { Dialogue } = require('../dist/game/model/dialogues/entries/Dialogue');
const BoatDrop = require('../plugins/skills/sailing/DropWarning.Sailing');
const Warnings = require('../plugins/interface/ValueWarnings.plugin');

const BRONZE_AXE = 1351;
const RUNE_PLATELEGS = 1079;
const INVENTORY = 3214;
const MESBOX = 115;

let core;
const settingsSet = [];

before(async () => {
  await CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const emitCustomEvent = (name, payload) => {
    if (name !== 'settings:set') return;
    settingsSet.push([payload.settingId, payload.value]);
    if (payload.settingId === 465) payload.player.vars[18143] = payload.value;
  };
  BoatDrop._test.setApi({ core, emitCustomEvent });
  Warnings._test.setApi({ core, emitCustomEvent });
});

function player(vars = {}, items = []) {
  const log = { messages: [], typed: [], dialogues: [] };
  const slots = [...items];
  const attributes = new Map();
  const sender = {
    getVarbit: (id) => vars[id] ?? 0,
    sendVarbit(id, value) { vars[id] = value; return sender; },
    sendTypedMessage: (type, text) => log.typed.push([type, text]),
    sendInterfaceRemoval() { return sender; },
    closeChatboxFor: () => true,
  };
  const inventory = {
    capacity: () => 28,
    getItems: () => slots,
    setItem(slot, item) { slots[slot] = item?.getId() === -1 ? null : item; return { refreshItems() {} }; },
  };
  const self = {
    log, vars, slots,
    getPacketSender: () => sender,
    getInventory: () => inventory,
    getAttribute: (k) => attributes.get(k),
    setAttribute: (k, v) => attributes.set(k, v),
    sendMessage: (m) => log.messages.push(m),
    // The box logs its own chat line as it opens, as the real one does.
    getDialogueManager: () => ({ startDialogues: (chain) => { log.dialogues.push([...chain.getDialogues().values()]); Dialogue.sendBoxChatLine(self, chain.getDialogues().get(0).getText()); } }),
    getHitpoints: () => 99,
    busy: () => false,
    getRights: () => null,
    getSkillManager: () => ({ stopSkillable() {} }),
  };
  return self;
}

/** Drops go through both warnings, as the plugins hear "item:drop-warning" in game. */
function harness(t, aboard = true) {
  const landed = [];
  t.mock.method(PluginManager, 'emitItemDropPolicy', () => false);
  t.mock.method(PluginManager, 'emitCustomEvent', (name, payload) => {
    if (name !== 'item:drop-warning') return;
    Warnings._test.dropWarning(payload);
    BoatDrop._test.dropWarning(payload);
  });
  t.mock.method(core.BoatManager, 'getBoatAboard', () => (aboard ? {} : undefined));
  t.mock.method(ItemOnGroundManager, 'registers', (_p, item) => landed.push([item.getId(), item.getAmount()]));
  t.mock.method(Wilderness, 'isIn', () => false);
  t.mock.method(Sounds, 'sendSound', () => {});
  return landed;
}

test('a drop on a boat asks with the captured message box and options; "Don\'t drop it." keeps it', (t) => {
  const landed = harness(t);
  const p = player({}, [new Item(BRONZE_AXE, 1)]);
  DropItemPacketListener.drop(p, BRONZE_AXE, INVENTORY, 0);
  assert.deepEqual(landed, []);
  assert.deepEqual(p.log.typed, [[MESBOX, 'Are you sure you want to put that down? If you leave the boat, you may not be able to retrieve it.']]);
  const [box, options] = p.log.dialogues[0];
  assert.ok(box instanceof StatementDialogue);
  assert.equal(box.getText(), 'Are you sure you want to put that down? If you leave the boat, you<br>may not be able to retrieve it.');
  assert.ok(options instanceof OptionDialogue);
  assert.equal(options.getTitle(), 'Select an option');
  assert.deepEqual(options.getOptions(), ['Put it down.', "Put it down, and don't ask again.", "Put it down, and don't ask again this session.", "Don't drop it."]);
  options.execute(4);
  assert.deepEqual(landed, []);
  assert.ok(p.slots[0]);
  options.execute(1);
  assert.deepEqual(landed, [[BRONZE_AXE, 1]]);
  assert.equal(p.slots[0], null);
  assert.equal(p.log.dialogues.length, 1, 'the answered drop does not ask again');
});

test('"don\'t ask again" saves the row (varbit 18143 = 1); later drops on a boat no longer ask', (t) => {
  const landed = harness(t);
  settingsSet.length = 0;
  const p = player({}, [new Item(BRONZE_AXE, 1), new Item(BRONZE_AXE, 1)]);
  DropItemPacketListener.drop(p, BRONZE_AXE, INVENTORY, 0);
  p.log.dialogues[0][1].execute(2);
  assert.deepEqual(settingsSet, [[465, 1]]);
  assert.equal(p.vars[18143], 1);
  DropItemPacketListener.drop(p, BRONZE_AXE, INVENTORY, 1);
  assert.equal(p.log.dialogues.length, 1);
  assert.deepEqual(landed, [[BRONZE_AXE, 1], [BRONZE_AXE, 1]]);
});

test('"this session" sets varbit 19114 and stops asking without saving the row', (t) => {
  const landed = harness(t);
  settingsSet.length = 0;
  const p = player({}, [new Item(BRONZE_AXE, 1), new Item(BRONZE_AXE, 1)]);
  DropItemPacketListener.drop(p, BRONZE_AXE, INVENTORY, 0);
  p.log.dialogues[0][1].execute(3);
  assert.equal(p.vars[19114], 1);
  assert.equal(p.vars[18143] ?? 0, 0);
  assert.deepEqual(settingsSet, []);
  DropItemPacketListener.drop(p, BRONZE_AXE, INVENTORY, 1);
  assert.equal(p.log.dialogues.length, 1);
  assert.equal(landed.length, 2);
});

test('off a boat, a drop lands at once', (t) => {
  const landed = harness(t, false);
  const p = player({}, [new Item(BRONZE_AXE, 1)]);
  DropItemPacketListener.drop(p, BRONZE_AXE, INVENTORY, 0);
  assert.deepEqual(landed, [[BRONZE_AXE, 1]]);
  assert.equal(p.log.dialogues.length, 0);
});

test('a valuable item on a boat: the value warning asks, then the boat warning, then it drops', (t) => {
  const landed = harness(t);
  const each = ItemDefinition.forId(RUNE_PLATELEGS).getGrandExchangeValue();
  const p = player({ 5411: 1, 5412: each }, [new Item(RUNE_PLATELEGS, 1)]);
  DropItemPacketListener.drop(p, RUNE_PLATELEGS, INVENTORY, 0);
  assert.equal(p.log.dialogues.length, 1);
  assert.ok(p.log.dialogues[0][0] instanceof ItemStatementDialogue);
  p.log.dialogues[0][1].execute(1);
  assert.deepEqual(landed, []);
  assert.equal(p.log.dialogues.length, 2);
  assert.ok(p.log.dialogues[1][0] instanceof StatementDialogue);
  p.log.dialogues[1][1].execute(1);
  assert.deepEqual(landed, [[RUNE_PLATELEGS, 1]]);
  assert.equal(p.log.dialogues.length, 2);
});
