// Run after `yarn build`: node --test tests/core-disconnect-guards.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { MobileList } = require('../dist/game/entity/impl/MobileList');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { NetworkConstants } = require('../dist/net/NetworkConstants');
const { GameConstants } = require('../dist/game/GameConstants');
const { World } = require('../dist/game/World');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
const { Location } = require('../dist/game/model/Location');
const net = require('../dist/net/NetworkBuilder');
const { WebSocketBinaryChannel } = require('../dist/net/BinaryChannel');

const REVISION = 435;

test('only a loopback WebSocket proxy can supply a validated player IP', () => {
  const channel = (address, realIp) => new WebSocketBinaryChannel({}, {
    socket: { remoteAddress: address }, headers: { 'x-real-ip': realIp },
  });
  assert.equal(channel('127.0.0.1', '203.0.113.4').remoteAddress, '203.0.113.4');
  assert.equal(channel('::ffff:127.0.0.1', '2001:db8::1').remoteAddress, '2001:db8::1');
  assert.equal(channel('203.0.113.5', '203.0.113.4').remoteAddress, '203.0.113.5');
  assert.equal(channel('127.0.0.1', 'invalid').remoteAddress, '127.0.0.1');
  assert.equal(channel('127.0.0.1', ['203.0.113.4']).remoteAddress, '127.0.0.1');
});

function stubMobile(overrides = {}) {
  return {
    registered: false,
    index: -1,
    isRegistered() { return this.registered; },
    setRegistered(value) { this.registered = value; },
    getIndex() { return this.index; },
    setIndex(value) { this.index = value; },
    onAdd() {},
    onRemove() {},
    ...overrides,
  };
}

function stubChannel() {
  return {
    kind: 'test',
    remoteAddress: '127.0.0.1',
    data: null,
    closeCb: null,
    isOpen: () => true,
    send() { return true; },
    close() {},
    onData(callback) { this.data = callback; },
    onError() {},
    onClose(callback) { this.closeCb = callback; },
  };
}

function stubPersistence(overrides = {}) {
  return {
    load: () => null,
    exists: () => false,
    save: () => {},
    flush: async () => {},
    checkPassword: async () => true,
    encryptPassword: async () => 'hash',
    ...overrides,
  };
}

test('a throwing removal hook cannot corrupt list size or leak its slot', () => {
  const list = new MobileList(4);
  const doomed = stubMobile({ onRemove() { throw new Error('save failed'); } });
  assert.equal(list.add(doomed), true);
  assert.equal(list.sizeReturn(), 1);

  assert.throws(() => list.remove(doomed), /save failed/);
  assert.equal(list.sizeReturn(), 0, 'size still decremented after the hook threw');

  const next = stubMobile();
  assert.equal(list.add(next), true);
  assert.equal(next.getIndex(), 1, 'the freed slot is reused');
});

test('a critically backpressured socket is closed instead of buffering', () => {
  let closed = null;
  const channel = {
    isOpen: () => true,
    bufferedAmount: NetworkConstants.OUTBOUND_WS_BUFFER_CRITICAL_BYTES,
    send() { throw new Error('must not send on a backpressured socket'); },
    close(code, reason) { closed = { code, reason }; },
  };
  const session = new PlayerSession(channel);
  assert.equal(session.sendClientPacket(Buffer.from([1, 2, 3])), false);
  assert.deepEqual(closed, { code: 1013, reason: 'backpressure' });
});

test('synchronous packets coalesce into a single browser frame', async () => {
  const frames = [];
  const channel = {
    isOpen: () => true,
    bufferedAmount: 0,
    send(frame) { frames.push(frame); return true; },
    close() {},
  };
  const session = new PlayerSession(channel);
  assert.equal(session.sendClientPacket(Buffer.from([1])), true);
  assert.equal(session.sendClientPacket(Buffer.from([2])), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(frames.length, 1, 'both packets share one frame');
  assert.deepEqual([...frames[0]], [1, 2]);
});

test('malformed client frames are rejected at the boundary without a throw downstream', async () => {
  assert.throws(() => decodeClientPackets(Buffer.from([0])), /Unsupported client opcode 0/);
  assert.throws(() => decodeClientPackets(Buffer.from([255])), /Truncated client opcode 255/);
  assert.throws(() => decodeClientPackets(Buffer.from([16])), /Truncated client opcode 16/);

  const channel = stubChannel();
  const connection = new net.ClientConnection(channel);
  channel.data(Buffer.from([0]));
  channel.data(Buffer.from([255, 0, 8]));
  await connection.idle();
  assert.equal(connection.getPlayer(), undefined, 'no session was desynced by the bad frames');
});

function stubNpc(index, overrides = {}) {
  return {
    getIndex: () => index,
    isRegistered: () => true,
    isVisible: () => true,
    isNeedsPlacement: () => false,
    getLocation: () => new Location(3201, 3200, 0),
    getPrivateArea: () => null,
    getArea: () => undefined,
    ...overrides,
  };
}

test('NPC visibility honours the cap, private areas and owner-only actors', () => {
  const makePlayer = (localNpcs) => ({
    getIndex: () => 1,
    getLocation: () => new Location(3200, 3200, 0),
    getPrivateArea: () => null,
    getArea: () => undefined,
    getLocalNpcs: () => localNpcs,
    getAttribute: () => undefined,
  });

  const crowdView = [];
  World.updateLocalNpcs(makePlayer(crowdView), Array.from({ length: 300 }, (_, index) => stubNpc(index + 10)));
  assert.equal(crowdView.length, 255, 'the list never exceeds MAX_LOCAL_NPCS');

  const otherArea = { countsAsMainWorld: () => false };
  const outsider = stubNpc(400, { getPrivateArea: () => otherArea });
  const foreignOwner = stubNpc(401, { isOwnerOnly: () => true, getOwner: () => ({}) });
  const filteredView = [];
  const owner = makePlayer(filteredView);
  const ownedPet = stubNpc(402, { isOwnerOnly: () => true, getOwner: () => owner });
  World.updateLocalNpcs(owner, [outsider, foreignOwner, ownedPet]);
  assert.deepEqual(filteredView.map((npc) => npc.getIndex()), [402],
    'only same-area, player-owned actors are added');
});

test('player visibility adds at most MAX_NEW_LOCAL_PLAYERS_PER_CYCLE per tick', () => {
  const candidate = (index) => ({
    getIndex: () => index,
    getLocation: () => new Location(3200, 3200, 0),
    getPrivateArea: () => null,
    getArea: () => undefined,
    isNeedsPlacement: () => false,
    resizeViewDistance() {},
    getViewDistance: () => 16,
  });
  const registered = Array.from({ length: 300 }, (_, index) => candidate(index + 1000));
  World.playerUpdateBuckets.set('0:400:400', registered);

  const localPlayers = [];
  World.updateLocalPlayers({ ...candidate(99), getLocalPlayers: () => localPlayers });
  assert.equal(localPlayers.length, 25, 'one tick adds at most the new-player budget');

  World.playerUpdateBuckets.clear();
});

test('a throwing player removal cannot abort the world remove phase', () => {
  const player = stubMobile({
    getUsername: () => 'edgeboom',
    canLogout: () => true,
    forcedLogoutTimer: { finished: () => false },
    isPlayerBot: () => false,
    onRemove() { throw new Error('save failed'); },
  });
  assert.equal(World.getPlayers().add(player), true);
  World.getRemovePlayerQueue().push(player);

  assert.doesNotThrow(() => World.process());
  assert.equal(World.getRemovePlayerQueue().length, 0, 'the queue entry is not retained forever');
  assert.equal(World.getPlayers().get(player.getIndex()), null, 'the player is deregistered');
});

test('a disconnect during login cannot build a half-logged-in player', async () => {
  CachePipeline.getActive = () => ({ revision: REVISION });

  let releaseEncrypt;
  GameConstants.PLAYER_PERSISTENCE = stubPersistence({
    encryptPassword: () => new Promise((resolve) => { releaseEncrypt = resolve; }),
  });

  const channel = stubChannel();
  const connection = new net.ClientConnection(channel);
  connection.inject([{ type: 'login', username: 'edgeguard', password: 'secret', revision: REVISION }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof releaseEncrypt, 'function', 'login reached the async password hash');

  channel.closeCb();
  releaseEncrypt('hash');
  await connection.idle();
  connection.inject([{ type: 'handshake', name: 'edgeguard', clientType: 0 }]);
  await connection.idle();

  assert.equal(connection.getPlayer(), undefined, 'no player for a closed socket');
  assert.equal(net.ClientConnection.pendingNames.has('edgeguard'), false, 'the name is released');

  // A fresh socket must be able to claim the name the aborted login released.
  let releaseSecond;
  GameConstants.PLAYER_PERSISTENCE = stubPersistence({
    encryptPassword: () => new Promise((resolve) => { releaseSecond = resolve; }),
  });
  const second = new net.ClientConnection(stubChannel());
  second.inject([{ type: 'login', username: 'edgeguard', password: 'secret', revision: REVISION }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(net.ClientConnection.pendingNames.has('edgeguard'), true, 'the released name is claimable');
  releaseSecond('hash');
  await second.idle();
});
