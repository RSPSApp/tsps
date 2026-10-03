// Run after `yarn build`: node --test tests/mobile-gameframe.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const {
  decodeClientPackets,
  MOBILE_CLIENT_ATTRIBUTE,
  MOBILE_GAMEFRAME_ROOT,
  resolveGameframeRoot,
} = require('../dist/net/protocol/ClientProtocol');

const player = (attrs) => ({ getAttribute: (key) => attrs[key] });

test('desktop clients boot their saved layout root', () => {
  assert.equal(resolveGameframeRoot(player({ 'client-layout-root': 548 })), 548);
  assert.equal(resolveGameframeRoot(player({ 'client-layout-root': 164 })), 164);
  assert.equal(resolveGameframeRoot(player({ 'client-layout-root': 161 })), 161);
});

test('missing or unknown saved roots fall back to 161', () => {
  assert.equal(resolveGameframeRoot(player({})), 161);
  assert.equal(resolveGameframeRoot(player({ 'client-layout-root': 601 })), 161);
});

test('mobile clients are locked to the mobile gameframe', () => {
  assert.equal(MOBILE_GAMEFRAME_ROOT, 601);
  assert.equal(resolveGameframeRoot(player({ [MOBILE_CLIENT_ATTRIBUTE]: true, 'client-layout-root': 548 })), 601);
  assert.equal(resolveGameframeRoot(player({ [MOBILE_CLIENT_ATTRIBUTE]: true, 'client-layout-root': 164 })), 601);
});

test('handshake decodes the mobile client type byte', () => {
  const name = Buffer.from('Tester\0', 'latin1');
  const mobile = Buffer.concat([name, Buffer.from([0, 1])]);
  const desktop = Buffer.concat([name, Buffer.from([0, 0])]);
  const legacy = Buffer.concat([name, Buffer.from([0])]);
  const frame = (payload) => Buffer.concat([Buffer.from([202, payload.length]), payload]);

  assert.deepEqual(decodeClientPackets(frame(mobile)), [
    { type: 'handshake', name: 'Tester', clientType: 1 },
  ]);
  assert.deepEqual(decodeClientPackets(frame(desktop)), [
    { type: 'handshake', name: 'Tester', clientType: 0 },
  ]);
  assert.deepEqual(decodeClientPackets(frame(legacy)), [
    { type: 'handshake', name: 'Tester', clientType: 0 },
  ]);
});
