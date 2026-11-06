// Run after `yarn build`: node --test tests/character-slots-protocol.test.cjs
const assert = require('node:assert/strict'); const { test } = require('node:test');
const { Server } = require('../dist/Server'); Server.installProductionPathResolver();
const proto = require('../dist/net/protocol/ClientProtocol');
const { SERVER_PACKET_LENGTHS } = require('../dist/net/protocol/ServerPackets');
const { LOGIN_FLAG_CHARACTER_SELECT } = require('../dist/net/login/LoginTokens');

test('ids, lengths and the login flag', () => {
  // ServerPacketId is a const enum (erased from dist); the ids are pinned here and by the encoders' opcodes below.
  assert.equal(SERVER_PACKET_LENGTHS[7], -2);
  assert.equal(SERVER_PACKET_LENGTHS[8], -1);
  assert.equal(LOGIN_FLAG_CHARACTER_SELECT, 4);
});

test('CHARACTER_LIST encodes max, default and entries', () => {
  const b = proto.encodeCharacterList(3, 1, [
    { name: 'Zezima', combatLevel: 126, totalLevel: 2277, lastPlayedAt: 1700000000000, primary: true, hasSave: true },
    { name: 'Alt', combatLevel: 3, totalLevel: 32, lastPlayedAt: 0, primary: false, hasSave: false },
  ]);
  assert.equal(b[0], 7); assert.equal(b.readUInt16BE(1), b.length - 3);
  let o = 3; assert.deepEqual([b[o], b[o + 1], b[o + 2]], [3, 1, 2]); o += 3;
  const end = b.indexOf(0, o); assert.equal(b.toString('latin1', o, end), 'Zezima'); o = end + 1;
  assert.equal(b[o], 126); assert.equal(b.readUInt16BE(o + 1), 2277);
  assert.equal(b.readBigInt64BE(o + 3), 1700000000000n); assert.equal(b[o + 11], 0b11);
});

test('CHARACTER_RESULT and the three client packets round-trip', () => {
  const r = proto.encodeCharacterResult(false, 3, 'Slot limit reached.');
  assert.equal(r[0], 8); assert.equal(r[2], 0); assert.equal(r[3], 3);
  const str = (s) => Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]);
  const frame = (op, payload) => Buffer.concat([Buffer.from([op, payload.length]), payload]);
  assert.deepEqual(proto.decodeClientPacket(frame(206, str('Alt'))), { type: 'character_select', name: 'Alt' });
  assert.deepEqual(proto.decodeClientPacket(frame(208, str('New Guy'))), { type: 'character_create', name: 'New Guy' });
  assert.deepEqual(proto.decodeClientPacket(frame(209, Buffer.concat([str('Alt'), str('alt')]))), { type: 'character_delete', name: 'Alt', confirmName: 'alt' });
});
