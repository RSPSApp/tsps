// Run after `yarn build`: node --test tests/packet-sender.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PacketSender } = require('../dist/net/packet/PacketSender');

const sender = (interfaceId, tracked) => ({
  resetInterfaceState: () => interfaceId,
  closeTrackedInterfaces: () => tracked,
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
