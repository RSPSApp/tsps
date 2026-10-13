// Run after `yarn build`: node --test tests/packet-sender.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PacketSender } = require('../dist/net/packet/PacketSender');

const sender = (interfaceId, tracked) => ({
  resetInterfaceState: () => interfaceId,
  closeTrackedInterfaces: () => tracked,
  endBankSearch() {},
  emitInterfaceClosed() {},
  sendSubInterface() {},
  player: { getSession: () => ({ sendClientPacket: () => true }) },
});

test('sendInterfaceRemoval keeps its `this` contract when nothing is open', () => {
  // The Slayer assignment chain calls .sendMessage() on this result; an
  // undefined return used to crash the right-click path with no interface open.
  const none = sender(-1, false);
  assert.equal(PacketSender.prototype.sendInterfaceRemoval.call(none), none);
  const tracked = sender(1, true);
  assert.equal(PacketSender.prototype.sendInterfaceRemoval.call(tracked), tracked);
});

test('sendSystemUpdate emits the SYSTEM_UPDATE packet (opcode 220, big-endian seconds)', () => {
  // The legacy implementation wrote opcode 114 (WIDGET_SET_ANIMATION) with a
  // little-endian short, which the web client misparsed and stalled the batch.
  const frames = [];
  const fake = {
    resetInterfaceState: () => -1,
    closeTrackedInterfaces: () => false,
    sendSubInterface() {},
    player: { getSession: () => ({ sendClientPacket: (frame) => { frames.push(frame); return true; } }) },
  };
  const result = PacketSender.prototype.sendSystemUpdate.call(fake, 125);
  assert.equal(result, fake);
  assert.equal(frames.length, 1);
  assert.deepEqual(Buffer.from(frames[0]), Buffer.from([220, 0, 0, 0, 125]));
});

test('sendCollectionLogSnapshot emits opcode 190 with the owned collection_log items', () => {
  let frame;
  const fake = {
    player: { getSession: () => ({ sendClientPacket: (bytes) => { frame = bytes; return true; } }) },
  };
  const result = PacketSender.prototype.sendCollectionLogSnapshot.call(fake, [
    { slot: 0, itemId: 13247, quantity: 1 },
    { slot: 1, itemId: 20659, quantity: 1 },
  ]);
  assert.equal(result, fake);
  const buf = Buffer.from(frame);
  assert.equal(buf[0], 190);
  assert.equal(buf.readUInt16BE(1), 18);
  assert.equal(buf.readUInt16BE(3), 2);
  assert.equal(buf.readUInt16BE(5), 0);
  assert.equal(buf.readUInt16BE(7), 13247);
  assert.equal(buf.readInt32BE(9), 1);
  assert.equal(buf.readUInt16BE(13), 1);
  assert.equal(buf.readUInt16BE(15), 20659);
  assert.equal(buf.readInt32BE(17), 1);
});

test("a dialogue box opened again resends its texts: the client turns 'Click here to continue' into 'Please wait...' on its own", () => {
  // Two NPC lines in a row (Gee): the second line's "Click here to continue" was skipped as
  // unchanged, so the client kept the "Please wait..." it shows after a continue click.
  const { FrameUpdater } = require('../dist/util/FrameUpdater');
  const frames = [];
  const updater = new FrameUpdater();
  const fake = {
    chatboxGroupId: -1,
    player: {
      getSession: () => ({ sendClientPacket: (frame) => { frames.push(Buffer.from(frame)); return true; } }),
      getFrameUpdater: () => updater,
    },
  };
  const CONTINUE = (231 << 16) | 5;
  const sent = () => frames.filter((frame) => frame.includes('Click here to continue')).length;
  for (let line = 0; line < 2; line++) {
    PacketSender.prototype.sendChatboxInterface.call(fake, 231);
    PacketSender.prototype.sendString.call(fake, 'Click here to continue', CONTINUE);
  }
  assert.equal(sent(), 2, 'sent with every line');
  // Without reopening, an unchanged text is still skipped.
  PacketSender.prototype.sendString.call(fake, 'Click here to continue', CONTINUE);
  assert.equal(sent(), 2);
});


test('interface script packets preserve 64-bit price totals', () => {
  const { encodeWidgetRunScript } = require('../dist/net/protocol/ClientProtocol');
  const frame = encodeWidgetRunScript(785, [12345678901n]);
  assert.equal(frame[8], 2, 'long argument tag');
  assert.equal(frame.readBigInt64BE(9), 12345678901n);
});

test('replacing a main interface emits its close event before changing its id', () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const original = PluginManager.emitCustomEvent;
  const events = [];
  PluginManager.emitCustomEvent = (name, event) => events.push([name, event.interfaceId, event.player.interfaceId]);
  try {
    const player = { interfaceId: 464 };
    Player.prototype.setInterfaceId.call(player, 465);
    Player.prototype.setInterfaceId.call(player, 465);
    Player.prototype.setInterfaceId.call(player, -1);
    assert.deepEqual(events, [['interface:closed', 464, 464]]);
    assert.equal(player.interfaceId, -1);
  } finally { PluginManager.emitCustomEvent = original; }
});
