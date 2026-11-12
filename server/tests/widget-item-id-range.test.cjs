const assert = require('node:assert/strict');
const { test } = require('node:test');
const { decodeClientPacket } = require('../dist/net/protocol/ClientProtocol');

// Native IF_BUTTON opcodes, matching NativeClientPackets and the client sender.
const BUTTONS = [23, 25, 31, 63, 69, 11, 14, 19, 20, 84];
const WIDGET = 149 << 16;
function frame(opcode, itemId, extra = []) {
  const bytes = Buffer.alloc(9 + extra.length);
  bytes[0] = opcode;
  bytes.writeInt32BE(WIDGET, 1);
  bytes.writeUInt16BE(2, 5);
  bytes.writeUInt16BE(itemId, 7);
  Buffer.from(extra).copy(bytes, 9);
  return bytes;
}

test('all ten native widget operations preserve unsigned item IDs and the no-item sentinel', () => {
  for (const [index, opcode] of BUTTONS.entries()) {
    for (const itemId of [0, 32767, 32768, 32926, 65534, 65535]) {
      const actual = decodeClientPacket(frame(opcode, itemId));
      assert.equal(actual.type, 'widget_action');
      assert.equal(actual.widgetId, WIDGET);
      assert.equal(actual.slot, 2);
      assert.equal(actual.buttonNum, index + 1);
      assert.equal(actual.itemId, itemId === 65535 ? undefined : itemId,
        `operation ${index + 1}, item ${itemId}`);
    }
  }
});

test('extended native widget operations retain high item IDs and their operation', () => {
  for (const itemId of [32767, 32768, 32926, 65534, 65535]) {
    const actual = decodeClientPacket(frame(91, itemId, [11]));
    assert.equal(actual.type, 'widget_action');
    assert.equal(actual.buttonNum, 11);
    assert.equal(actual.slot, 2);
    assert.equal(actual.itemId, itemId === 65535 ? undefined : itemId);
  }
});

test('native widget suboperations preserve high item IDs and the existing empty-item value', () => {
  for (const itemId of [32767, 32768, 32926, 65534, 65535]) {
    const actual = decodeClientPacket(frame(89, itemId, [2, 0]));
    assert.equal(actual.type, 'widget_action');
    assert.equal(actual.buttonNum, 2);
    assert.equal(actual.subOpId, 1);
    assert.equal(actual.slot, 2);
    assert.equal(actual.itemId, itemId === 65535 ? -1 : itemId);
  }
});

test('a matching unresolved backpack action reports once, while stale slots and other widgets stay quiet', async t => {
  require('../dist/Server').Server.installProductionPathResolver();
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { Item } = require('../dist/game/model/Item');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  await CachePipeline.initialize(process.cwd());

  const player = new Player(null);
  player.getInventory().setItem(2, new Item(952)); // Spade.
  const messages = [];
  const warnings = [];
  t.mock.method(player, 'sendMessage', text => messages.push(text));
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const channel = { send: () => true, isOpen: () => true, close() {}, onData() {}, onClose() {}, onError() {} };
  const connection = new ClientConnection(channel);
  connection.player = player;
  const click = async bytes => {
    await connection.dispatch([decodeClientPacket(bytes)]);
    connection.processTurnPackets();
  };
  const invalid = frame(BUTTONS[7], 952); // Backpack op 8 has no cache action.
  const moved = Buffer.from(invalid);
  moved.writeUInt16BE(3, 5);
  const otherWidget = Buffer.from(invalid);
  otherWidget.writeInt32BE(WIDGET | 1, 1);

  await click(moved);
  await click(frame(BUTTONS[7], 995));
  await click(otherWidget);
  assert.deepEqual(messages, []);
  assert.deepEqual(warnings, []);

  await click(invalid);
  await click(invalid);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /reload/i);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /unresolved inventory/i);
  assert.deepEqual(warnings[0][1], { itemId: 952, slot: 2, op: 8 });

  await click(frame(BUTTONS[9], 952)); // Examine still succeeds.
  assert.equal(messages.length, 2);
  assert.doesNotMatch(messages[1], /reload/i);
  assert.equal(warnings.length, 1);
});
