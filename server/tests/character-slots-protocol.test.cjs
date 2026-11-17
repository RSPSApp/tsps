// Run after `yarn build`: node --test tests/character-slots-protocol.test.cjs
const assert = require('node:assert/strict'); const { test } = require('node:test');
const { Server } = require('../dist/Server'); Server.installProductionPathResolver();
const proto = require('../dist/net/protocol/ClientProtocol');
const { SERVER_PACKET_LENGTHS } = require('../dist/net/protocol/ServerPackets');
const { LOGIN_FLAG_CHARACTER_SELECT } = require('../dist/net/login/LoginTokens');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { WebSocketBinaryChannel } = require('../dist/net/BinaryChannel');
const { WebSocketServer, WebSocket } = require('ws');
const fs = require('node:fs');
const path = require('node:path');

test('separate client and server builds declare the same explicit positive wire version', () => {
  const { WIRE_PROTOCOL_VERSION } = require('../dist/net/protocol/WireProtocolVersion');
  const client = fs.readFileSync(path.resolve(__dirname, '../../client/network/serverConnection/protocolCompatibility.ts'), 'utf8');
  const declared = /export const WIRE_PROTOCOL_VERSION = (\d+);/.exec(client);
  assert.ok(declared, 'client declares a literal version independently of source hashes');
  assert.equal(Number.isSafeInteger(WIRE_PROTOCOL_VERSION) && WIRE_PROTOCOL_VERSION > 0, true);
  assert.equal(WIRE_PROTOCOL_VERSION, Number(declared[1]));
});

test('the real WebSocket opening advertises the wire version before the unchanged welcome', async (t) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  let connection;
  server.on('connection', socket => { connection = new ClientConnection(new WebSocketBinaryChannel(socket)); });
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  t.after(async () => {
    socket.terminate();
    for (const client of server.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  const frames = [];
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('opening greeting timed out')), 5000);
    socket.on('error', error => { clearTimeout(timeout); reject(error); });
    socket.on('message', (data, binary) => {
      try {
        assert.equal(binary, true);
        frames.push(Buffer.from(data));
        if (data[0] === 0) { clearTimeout(timeout); resolve(); }
      } catch (error) { clearTimeout(timeout); reject(error); }
    });
  });
  assert.equal(connection.getPlayer(), undefined, 'opening announcement needs no authentication');
  assert.deepEqual(frames.map(frame => frame[0]), [6, 0]);
  assert.equal(frames[0].readUInt16BE(1), frames[0].length - 3);
  assert.deepEqual(JSON.parse(frames[0].subarray(3).toString('utf8')), {
    channel: 'protocol:version', data: { version: 1 },
  });
  assert.equal(frames[1].length, 9, 'legacy welcome framing is unchanged');
  assert.equal(frames[1].readInt32BE(1), 600);
});

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
