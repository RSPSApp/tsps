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
