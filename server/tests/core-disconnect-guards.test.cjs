// Run after `yarn build`: node --test tests/core-disconnect-guards.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { WebSocket, WebSocketServer } = require('ws');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { MobileList } = require('../dist/game/entity/impl/MobileList');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { NetworkConstants } = require('../dist/net/NetworkConstants');
const { GameConstants } = require('../dist/game/GameConstants');
const { World } = require('../dist/game/World');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
const { Location } = require('../dist/game/model/Location');
const net = require('../dist/net/NetworkBuilder');
const { WebSocketBinaryChannel, MAX_GAME_MESSAGE_BYTES } = require('../dist/net/BinaryChannel');
const { BoatManager } = require('../dist/game/content/sailing/BoatManager');

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
    closes: [],
    isOpen: () => true,
    send() { return true; },
    close(code, reason) { this.closes.push({ code, reason }); },
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

test('interaction stop cancels queued walking without routing back to an old tile', async () => {
  const connection = new net.ClientConnection(stubChannel());
  const stopped = [];
  connection.player = {
    getAttribute: () => undefined,
    getMovementQueue: () => ({
      reset: () => stopped.push('route'),
      walkToReset: () => stopped.push('walk-task'),
    }),
    getCombat: () => ({ reset() {} }),
    setFollowing() {},
    setMobileInteraction() {},
    setPositionToFace() {},
  };
  connection.inject([{ type: 'interaction_stop' }]);
  await connection.idle();
  assert.deepEqual(stopped, [], 'input waits for the player\'s turn');
  connection.processTurnPackets();
  assert.deepEqual(stopped, ['route', 'walk-task']);
});

test('player teleports clear follow-owned interaction and facing across relocation paths', () => {
  const { Mobile } = require('../dist/game/entity/impl/Mobile');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { Boundary } = require('../dist/game/model/Boundary');
  const originalBlocked = RegionManager.blocked;
  const makePlayer = () => new Player(new PlayerSession(stubChannel()));
  RegionManager.blocked = () => false;
  try {
    for (const relocate of [
      (player) => player.moveTo(new Location(3200, 3200, 0)),
      (player) => player.smartMove(new Location(3200, 3200, 0), 0),
      (player) => player.smartMoves(new Boundary(3200, 3200, 3200, 3200, 0)),
    ]) {
      const player = makePlayer();
      player.getMovementQueue().handleRegionChange = () => {};
      const leader = { getLocation: () => new Location(3201, 3201, 0) };
      player.setFollowing(leader);
      player.setMobileInteraction(leader);
      player.setPositionToFace(leader.getLocation());
      relocate(player);
      assert.equal(player.getFollowing(), null);
      assert.equal(player.getInteractingMobile(), null);
      assert.equal(player.getPositionToFace(), null);
    }
  } finally {
    RegionManager.blocked = originalBlocked;
  }

  const player = makePlayer();
  const unrelatedFace = new Location(3300, 3300, 0);
  player.setFollowing({ getLocation: () => new Location(3201, 3201, 0) });
  player.setPositionToFace(unrelatedFace);
  player.moveTo(new Location(3200, 3200, 0));
  assert.equal(player.getPositionToFace(), unrelatedFace, 'relocation preserves a face target unrelated to following');

  const mobile = new Mobile(new Location(3200, 3200, 0));
  const owner = { getLocation: () => new Location(3201, 3201, 0) };
  mobile.setFollowing(owner);
  mobile.moveTo(new Location(3202, 3202, 0));
  assert.equal(mobile.getFollowing(), owner, 'non-player follower behavior is unchanged');
});

test('follow rejects the first index outside player-list capacity before lookup', () => {
  const { FollowPlayerPacketListener } = require('../dist/net/packet/impl/FollowPlayerPacketListener');
  const originalGetPlayers = World.getPlayers;
  let lookups = 0;
  World.getPlayers = () => ({ capacityReturn: () => 2, get() { lookups++; } });
  try {
    FollowPlayerPacketListener.request({ busy: () => false, getIndex: () => 1, setFollowing() {} }, 2);
  } finally {
    World.getPlayers = originalGetPlayers;
  }
  assert.equal(lookups, 0);
});

test('invalid player-option indices leave follow state untouched', () => {
  const { PlayerOptionPacketListener } = require('../dist/net/packet/impl/PlayerOptionPacketListener');
  const originalGetPlayers = World.getPlayers;
  let cleared = false;
  let lookups = 0;
  World.getPlayers = () => ({ get() { lookups++; return { getHitpoints: () => 99 }; } });
  try {
    PlayerOptionPacketListener.executeClientOption({
      getHitpoints: () => 99,
      busy: () => false,
      setFollowing() { cleared = true; },
    }, 1, 9);
  } finally {
    World.getPlayers = originalGetPlayers;
  }
  assert.equal(cleared, false);
  assert.equal(lookups, 0, 'invalid options are rejected before target lookup');
});

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

test('outbound batches stay bounded and close if backpressure builds before the microtask flush', async () => {
  const channel = stubChannel();
  const frames = [];
  channel.bufferedAmount = 0;
  channel.send = (frame) => frames.push(frame);
  const session = new PlayerSession(channel);
  session.sendClientPacket(Buffer.alloc(MAX_GAME_MESSAGE_BYTES - 1, 1));
  session.sendClientPacket(Buffer.from([2, 3]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(frames.map((frame) => frame.length), [MAX_GAME_MESSAGE_BYTES - 1, 2]);
  assert.deepEqual([...frames[1]], [2, 3], 'batch boundaries preserve packet order');

  frames.length = 0;
  session.sendClientPacket(Buffer.from([4]));
  channel.bufferedAmount = NetworkConstants.OUTBOUND_WS_BUFFER_CRITICAL_BYTES;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(frames, [], 'queued data is discarded when the channel becomes slow');
  assert.deepEqual(channel.closes, [{ code: 1013, reason: 'backpressure' }]);
  assert.equal(session.pendingPacketBytes, 0);
});

test('WebSocket fragments reassemble and coalesced packets wait for earlier input', { timeout: 5000 }, async (t) => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const accepted = new Promise((resolve) => server.once('connection', (socket, request) => {
    resolve({ socket, connection: new net.ClientConnection(new WebSocketBinaryChannel(socket, request)) });
  }));
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  t.after(async () => {
    client.terminate();
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  await once(client, 'open');
  const { socket, connection } = await accepted;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const calls = [];
  connection.dispatch = async (packets) => {
    calls.push(...packets);
    if (calls.length === 1) await held;
  };
  const received = new Promise((resolve) => {
    let count = 0;
    socket.on('message', () => { if (++count === 2) resolve(); });
  });
  // PING has a fixed four-byte payload; HELLO contains two null-terminated strings.
  const ping = Buffer.from([201, 0, 0, 0, 1]);
  client.send(ping.subarray(0, 1), { fin: false });
  client.send(ping.subarray(1, 3), { fin: false });
  client.send(ping.subarray(3), { fin: true });
  client.send(Buffer.concat([ping, Buffer.from([200, 2, 0, 0])]));
  await received;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [{ type: 'ping' }], 'the second message waits for the slow handler');
  release();
  await connection.idle();
  assert.deepEqual(calls, [{ type: 'ping' }, { type: 'ping' }, { type: 'hello' }]);
  assert.equal(connection.closed, false);
});

test('an input backlog is bounded while an earlier handler is awaiting persistence', async () => {
  const channel = stubChannel();
  const connection = new net.ClientConnection(channel);
  let release;
  let dispatched = 0;
  connection.dispatch = async () => {
    dispatched++;
    await new Promise((resolve) => { release = resolve; });
  };
  const ping = Buffer.from([201, 0, 0, 0, 1]);
  channel.data(ping);
  await new Promise((resolve) => setImmediate(resolve));
  for (let index = 0; index < NetworkConstants.PACKET_QUEUE_LIMIT + 10; index++) channel.data(ping);
  assert.equal(connection.queuedInputFrames, NetworkConstants.PACKET_QUEUE_LIMIT);
  assert.deepEqual(channel.closes, [{ code: 1008, reason: 'input limit' }]);
  release();
  await connection.idle();
  assert.equal(dispatched, 1, 'queued packets cannot act after the disconnect');
  assert.equal(connection.queuedInputFrames, 0);
});

test('oversized and truncated game messages cannot continue into later actions', async () => {
  for (const frame of [Buffer.alloc(MAX_GAME_MESSAGE_BYTES + 1), Buffer.from([201, 0])]) {
    const channel = stubChannel();
    const connection = new net.ClientConnection(channel);
    let dispatched = 0;
    connection.dispatch = async () => { dispatched++; };
    channel.data(frame);
    channel.data(Buffer.from([203])); // A later valid LOGOUT must not be dispatched.
    await connection.idle();
    assert.equal(dispatched, 0);
    assert.equal(channel.closes.length, 1);
    assert.equal(connection.closed, true);
  }
});

test('input overflow releases a name reserved by an unfinished login', async (t) => {
  t.mock.method(CachePipeline, 'getActive', () => ({ revision: REVISION }));
  const originalPersistence = GameConstants.PLAYER_PERSISTENCE;
  t.after(() => { GameConstants.PLAYER_PERSISTENCE = originalPersistence; });
  let release;
  GameConstants.PLAYER_PERSISTENCE = stubPersistence({
    encryptPassword: () => new Promise((resolve) => { release = resolve; }),
  });
  const channel = stubChannel();
  const connection = new net.ClientConnection(channel);
  const credentials = Buffer.from('backlogguard\0secret\0');
  const revision = Buffer.alloc(5);
  revision.writeInt32BE(REVISION);
  const header = Buffer.from([204, 0, credentials.length + revision.length]);
  channel.data(Buffer.concat([header, credentials, revision]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof release, 'function');
  assert.ok(net.ClientConnection.pendingNames.has('backlogguard'));
  for (let index = 0; index < NetworkConstants.PACKET_QUEUE_LIMIT; index++) channel.data(Buffer.from([201, 0, 0, 0, 0]));
  assert.equal(net.ClientConnection.pendingNames.has('backlogguard'), false);
  release('hash');
  await connection.idle();
  connection.inject([{ type: 'handshake', name: 'backlogguard', clientType: 0 }]);
  await connection.idle();
  assert.equal(connection.getPlayer(), undefined);
  assert.deepEqual(channel.closes, [{ code: 1008, reason: 'input limit' }]);
});

test('a malformed logged-in session is removed even when trade cleanup or saving throws', async (t) => {
  const originalPersistence = GameConstants.PLAYER_PERSISTENCE;
  t.after(() => { GameConstants.PLAYER_PERSISTENCE = originalPersistence; });
  for (const failure of ['trade', 'save']) {
    let saveRequested = false;
    GameConstants.PLAYER_PERSISTENCE = stubPersistence({
      requestSave() {
        saveRequested = true;
        if (failure === 'save') throw new Error('save request failed');
      },
    });
    const channel = stubChannel();
    const connection = new net.ClientConnection(channel);
    const { player } = stubLoggedInPlayer('badpacket', {
      getTrading: () => ({ closeTrade() { if (failure === 'trade') throw new Error('trade cleanup failed'); } }),
    });
    connection.player = player;
    channel.data(Buffer.from([0]));
    await connection.idle();
    channel.closeCb();
    assert.equal(player.getDisconnectSource(), 'malformed_packet');
    assert.equal(World.getRemovePlayerQueue().filter((entry) => entry === player).length, 1);
    assert.equal(saveRequested, true);
    assert.deepEqual(channel.closes, [{ code: 1002, reason: 'malformed packet' }]);
    World.getRemovePlayerQueue().splice(World.getRemovePlayerQueue().indexOf(player), 1);
  }
});

test('an accepted logout first sets clicks back to walking, then logs out', () => {
  const frames = [];
  const channel = {
    isOpen: () => true,
    bufferedAmount: 0,
    send(frame) { frames.push(frame); return true; },
    close() {},
  };
  new PlayerSession(channel).logout();
  const bytes = [...Buffer.concat(frames)];
  // SET_INTERACTION_MODE (145): default world (-2), walk, all entities (rsprox: before every
  // logout_withreason), then LOGOUT_RESPONSE (4).
  assert.deepEqual(bytes.slice(0, 5), [145, 0xff, 0xfe, 1, 1]);
  assert.equal(bytes[5], 4);
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
  assert.deepEqual(channel.closes, [{ code: 1002, reason: 'malformed packet' }]);
  assert.equal(connection.closed, true, 'later frames cannot continue a malformed session');
});

function stubNpc(index, overrides = {}) {
  return stubMobile({
    index,
    isVisible: () => true,
    isNeedsPlacement: () => false,
    getLocation: () => new Location(3201, 3200, 0),
    getPrivateArea: () => null,
    getArea: () => undefined,
    ...overrides,
  });
}

function registerVisibilityActors(t, players = [], npcs = []) {
  const playerList = new MobileList(2048);
  const npcList = new MobileList(65534);
  for (const player of players) assert.equal(playerList.add(player), true);
  for (const npc of npcs) assert.equal(npcList.add(npc), true);
  t.mock.method(World, 'getPlayers', () => playerList);
  t.mock.method(World, 'getNpcs', () => npcList);
  return { playerList, npcList };
}

function visibilityPlayer(overrides = {}) {
  return stubMobile({
    getLocation: () => new Location(3200, 3200, 0),
    getPrivateArea: () => null,
    getArea: () => undefined,
    isNeedsPlacement: () => false,
    resizeViewDistance() {},
    getViewDistance: () => 16,
    getLocalPlayers: () => [],
    getLocalNpcs: () => [],
    getAttribute: () => undefined,
    ...overrides,
  });
}

test('NPC visibility honours the cap, private areas and owner-only actors', (t) => {
  const makePlayer = (localNpcs) => ({
    getIndex: () => 1,
    getLocation: () => new Location(3200, 3200, 0),
    getPrivateArea: () => null,
    getArea: () => undefined,
    getLocalNpcs: () => localNpcs,
    getAttribute: () => undefined,
  });

  const crowdView = [];
  const crowd = Array.from({ length: 300 }, (_, index) => stubNpc(index + 10));
  const { npcList } = registerVisibilityActors(t, [], crowd);
  World.updateLocalNpcs(makePlayer(crowdView), crowd);
  assert.equal(crowdView.length, 255, 'the list never exceeds MAX_LOCAL_NPCS');

  const otherArea = { countsAsMainWorld: () => false };
  const outsider = stubNpc(400, { getPrivateArea: () => otherArea });
  const foreignOwner = stubNpc(401, { isOwnerOnly: () => true, getOwner: () => ({}) });
  const filteredView = [];
  const owner = makePlayer(filteredView);
  const ownedPet = stubNpc(402, { isOwnerOnly: () => true, getOwner: () => owner });
  for (const npc of [outsider, foreignOwner, ownedPet]) assert.equal(npcList.add(npc), true);
  World.updateLocalNpcs(owner, [outsider, foreignOwner, ownedPet]);
  assert.deepEqual(filteredView, [ownedPet],
    'only same-area, player-owned actors are added');
});

test('player visibility caps every tick and retains adaptive view distance', (t) => {
  const registered = Array.from({ length: 300 }, () => visibilityPlayer());
  registerVisibilityActors(t, registered);
  World.playerUpdateBuckets.set('0:400:400', registered);
  t.after(() => World.playerUpdateBuckets.clear());

  const localPlayers = [];
  const player = visibilityPlayer({
    getLocalPlayers: () => localPlayers,
    resizeViewDistance: Player.prototype.resizeViewDistance,
    viewDistance: 16,
    viewDistanceQuietCycles: 0,
  });
  World.updateLocalPlayers(player);
  assert.equal(localPlayers.length, 25, 'one tick adds at most the new-player budget');
  for (let tick = 0; tick < 15; tick++) {
    const previous = localPlayers.length;
    World.updateLocalPlayers(player);
    assert.ok(localPlayers.length <= 255);
    assert.ok(localPlayers.length - previous <= 25);
  }
  assert.equal(localPlayers.length, 255);
  assert.ok(player.viewDistance < 16, 'crowding reduces the view distance');
  const crowdedDistance = player.viewDistance;
  World.playerUpdateBuckets.clear();
  localPlayers.length = 0;
  for (let tick = 0; tick < 10; tick++) World.updateLocalPlayers(player);
  assert.equal(player.viewDistance, crowdedDistance + 1, 'a quiet view regrows after ten ticks');
});

test('foreign instances cannot consume the nearby-player candidate budget', (t) => {
  const instance = { countsAsMainWorld: () => false };
  const outsiders = Array.from({ length: 300 }, () => visibilityPlayer({ getPrivateArea: () => instance }));
  const local = visibilityPlayer();
  registerVisibilityActors(t, [...outsiders, local]);
  World.playerUpdateBuckets.set('0:400:400', [...outsiders, local]);
  t.after(() => World.playerUpdateBuckets.clear());
  const localPlayers = [];
  World.updateLocalPlayers(visibilityPlayer({ getLocalPlayers: () => localPlayers }));
  assert.deepEqual(localPlayers, [local]);
});

test('player views discard duplicates, departed instances and reused world slots', (t) => {
  const stale = visibilityPlayer();
  const replaced = visibilityPlayer();
  let area = null;
  const leaving = visibilityPlayer({ getPrivateArea: () => area });
  const { playerList } = registerVisibilityActors(t, [stale, leaving]);
  playerList.remove(stale);
  playerList.add(replaced);
  assert.equal(stale.getIndex(), replaced.getIndex());
  area = { countsAsMainWorld: () => false };
  const locals = [stale, leaving, replaced, replaced];
  World.updateLocalPlayers(visibilityPlayer({ getLocalPlayers: () => locals }));
  assert.deepEqual(locals, [replaced]);
});

test('NPC views discard stale, duplicate and hidden actors and always reserve the owner pet', (t) => {
  const crowd = Array.from({ length: 300 }, (_, index) => stubNpc(index));
  const stale = stubNpc(400);
  const hidden = stubNpc(401);
  const { npcList } = registerVisibilityActors(t, [], [stale, hidden, ...crowd]);
  npcList.remove(stale);
  const pet = stubNpc(402);
  npcList.add(pet);
  assert.equal(stale.getIndex(), pet.getIndex(), 'the stale slot was reused');
  const localNpcs = [stale, hidden, crowd[0], ...crowd];
  const owner = visibilityPlayer({ getLocalNpcs: () => localNpcs, getAttribute: () => pet });
  pet.getOwner = () => owner;
  t.mock.method(BoatManager, 'canSeeAboard', (_viewer, actor) => actor !== hidden);
  World.updateLocalNpcs(owner, [stale, hidden, ...crowd]);
  assert.equal(localNpcs.length, 255);
  assert.equal(new Set(localNpcs).size, 255);
  assert.ok(localNpcs.includes(pet), 'the pet replaces the last ordinary actor in a full view');
  assert.ok(!localNpcs.includes(stale));
  assert.ok(!localNpcs.includes(hidden));
  World.updateLocalNpcs(owner, [hidden, ...crowd]);
  assert.equal(localNpcs.length, 255);
  assert.ok(localNpcs.includes(pet), 'the pet survives later crowded ticks');
});

test('a pet in another instance is not moved or exposed by visibility updates', (t) => {
  const instance = { countsAsMainWorld: () => false };
  const pet = stubNpc(1, { getPrivateArea: () => instance, setArea() { throw new Error('visibility must not move actors'); } });
  registerVisibilityActors(t, [], [pet]);
  const locals = [];
  const owner = visibilityPlayer({ getLocalNpcs: () => locals, getAttribute: () => pet });
  pet.getOwner = () => owner;
  World.updateLocalNpcs(owner, [pet]);
  assert.deepEqual(locals, []);
});

test('a throwing player removal cannot abort the world remove phase', () => {
  const player = stubMobile({
    getUsername: () => 'edgeboom',
    readyToLeaveWorld: () => true,
    getDisconnectSource: () => 'socket_close',
    isPlayerBot: () => false,
    onRemove() { throw new Error('save failed'); },
  });
  assert.equal(World.getPlayers().add(player), true);
  World.getRemovePlayerQueue().push(player);

  assert.doesNotThrow(() => World.process());
  assert.equal(World.getRemovePlayerQueue().length, 0, 'the queue entry is not retained forever');
  assert.equal(World.getPlayers().get(player.getIndex()), null, 'the player is deregistered');
});

function stubLoggedInPlayer(name, overrides = {}) {
  const sent = [];
  const player = stubMobile({
    getUsername: () => name,
    isPlayerBot: () => false,
    disconnectSource: null,
    setDisconnectSource(source) { if (this.disconnectSource === null) this.disconnectSource = source; },
    getDisconnectSource() { return this.disconnectSource; },
    readyToLeaveWorld: () => true,
    logoutRefusal: () => null,
    session: {
      getChannel: () => ({ readyState: 1 }),
      refuseLogout: (reason) => sent.push(['refused', reason]),
      logout: () => sent.push(['logout']),
    },
    getSession() { return this.session; },
    ...overrides,
  });
  return { player, sent };
}

function withDisconnectEvents(run) {
  const events = [];
  const original = PluginManager.emitPlayerDisconnect;
  PluginManager.emitPlayerDisconnect = (event) => events.push(event);
  try {
    run(events);
  } finally {
    PluginManager.emitPlayerDisconnect = original;
  }
}

// These players are registered but kept out of the world list, so the tick's other
// phases (movement, sync, sailing) never see the stubs.
test('the logout button is answered on the tick and refused in combat', () => {
  const { player, sent } = stubLoggedInPlayer('edgefighter', {
    logoutRefusal: () => "You can't log out until 10 seconds after the end of combat.",
  });
  player.setRegistered(true);
  World.queueLogoutRequest(player);
  assert.deepEqual(sent, [], 'nothing is answered before the tick');
  World.process();
  assert.deepEqual(sent, [['refused', "You can't log out until 10 seconds after the end of combat."]]);
  assert.equal(World.getRemovePlayerQueue().includes(player), false, 'a refused player stays logged in');
});

test('an accepted logout leaves the world on the same tick with the logout source', () => {
  const { player, sent } = stubLoggedInPlayer('edgeleaver');
  player.setRegistered(true);
  withDisconnectEvents((events) => {
    World.queueLogoutRequest(player);
    World.process();
    assert.deepEqual(sent, [['logout']]);
    assert.equal(World.getRemovePlayerQueue().includes(player), false, 'removed this tick');
    assert.deepEqual(events.map((event) => event.source), ['logout']);
  });
});

test('a player removed in combat stays in the world and fires disconnect only on leaving', () => {
  let ready = false;
  const { player } = stubLoggedInPlayer('edgexlog', { readyToLeaveWorld: () => ready });
  player.setRegistered(true);
  withDisconnectEvents((events) => {
    player.setDisconnectSource('socket_close');
    World.getRemovePlayerQueue().push(player);
    World.process();
    assert.equal(World.getRemovePlayerQueue().includes(player), true, 'held while in combat');
    assert.deepEqual(events, [], 'disconnect hooks wait for the player to leave');
    ready = true;
    World.process();
    assert.equal(World.getRemovePlayerQueue().includes(player), false);
    assert.deepEqual(events.map((event) => event.source), ['socket_close']);
  });
});

test('a disconnected player leaves out of combat, after 16 ticks of no hits, or after 60 seconds', () => {
  let cycle = 1000;
  const originalCycle = World.getProcessCycle;
  World.getProcessCycle = () => cycle;
  try {
    const removing = (ticksSinceAttacked) => ({
      forcedLogoutTimer: { isRunning: () => false },
      logoutHoldCycle: -1,
      inLogoutCombat: Player.prototype.inLogoutCombat,
      getCombat: () => ({ ticksSinceAttacked: () => ticksSinceAttacked }),
    });
    const leaves = (player) => Player.prototype.readyToLeaveWorld.call(player);
    assert.equal(leaves(removing(Infinity)), true, 'never hit');
    assert.equal(leaves(removing(16)), true, '16 ticks after the last hit');
    const fighting = removing(15);
    assert.equal(leaves(fighting), false, 'hit 15 ticks ago');
    cycle += 99;
    assert.equal(leaves(fighting), false, 'still inside the 60 second hold');
    cycle += 1;
    assert.equal(leaves(fighting), true, 'forced out after 100 ticks');
  } finally {
    World.getProcessCycle = originalCycle;
  }
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


test('inventory Drop and Release reach item action hooks before the ground/drop fallback', () => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { DropItemPacketListener } = require('../dist/net/packet/impl/DropItemPacketListener');
  const originalDefinition = CacheDefinitions.getItem;
  const originalAction = PluginManager.emitItemAction;
  const originalCanUse = PluginManager.emitCanUseItem;
  const originalDrop = DropItemPacketListener.drop;
  const calls = [];
  const item = { getId: () => 29519 };
  const inventory = { getItems: () => [item], capacity: () => 28 };
  const connection = new net.ClientConnection(stubChannel());
  connection.player = { getInventory: () => inventory, clearPendingAction() {} };
  CacheDefinitions.getItem = () => ({ inventoryActions: [null,null,null,'Drop','Release'] });
  PluginManager.emitCanUseItem = () => true;
  DropItemPacketListener.drop = () => calls.push('fallback');
  try {
    PluginManager.emitItemAction = event => { calls.push(event.option); return true; };
    connection.inventoryAction({ slot:0,itemId:29519,widgetId:3214,option:'Drop' });
    connection.inventoryAction({ slot:0,itemId:29519,widgetId:3214,option:'Release' });
    assert.deepEqual(calls,['Drop','Release']);
    PluginManager.emitItemAction = () => false;
    connection.inventoryAction({ slot:0,itemId:29519,widgetId:3214,option:'Drop' });
    assert.equal(calls.at(-1),'fallback');
  } finally {
    CacheDefinitions.getItem = originalDefinition;
    PluginManager.emitItemAction = originalAction;
    PluginManager.emitCanUseItem = originalCanUse;
    DropItemPacketListener.drop = originalDrop;
  }
});


test('alchemy policy keeps rune and spellbook checks before neutralising a permitted item', () => {
  const {PluginManager}=require('../dist/plugins/PluginManager');
  const {MagicOnItemPacketListener}=require('../dist/net/packet/impl/MagicOnItemPacketListener');
  const {MagicSpellbook}=require('../dist/game/model/MagicSpellbook');
  const original=PluginManager.emitCustomEvent, events=[];
  const amounts=new Map([[29573,1],[561,1],[554,5]]), item={getId:()=>29573,isTradeable:()=>false,isSellable:()=>false,
    getDefinition:()=>({getHighAlchValue:()=>0,getLowAlchValue:()=>0})};
  const inventory={capacity:()=>28,getItems:()=>[item],contains:id=>(amounts.get(id)||0)>0,getAmount:id=>amounts.get(id)||0,
    deleteNumber:(id,n)=>amounts.set(id,(amounts.get(id)||0)-n),adds:(id,n)=>amounts.set(id,(amounts.get(id)||0)+n)};
  const player={getInventory:()=>inventory,getEquipment:()=>({getWeapon:()=>null}),getSkillManager:()=>({getCurrentLevel:()=>99,addExperiences(){}}),
    getSpellbook:()=>MagicSpellbook.NORMAL,sendMessage(){},performAnimation(){},performGraphic(){},
    getPacketSender:()=>({sendTab(){}})};
  try {
    PluginManager.emitCustomEvent=(name,event)=>{events.push(name);if(name==='magic:alchemy-policy'){event.allowed=true;event.coins=0;}};
    const listener=new MagicOnItemPacketListener();
    amounts.set(561,0);listener.castOnItem(player,1178,29573,0);assert.equal(amounts.get(29573),1);
    assert.ok(!events.includes('magic:alchemy-completed'));
    amounts.set(561,1);listener.castOnItem(player,1178,29573,0);
    assert.equal(amounts.get(29573),0);assert.equal(amounts.get(561),0);assert.equal(amounts.get(554),0);
    assert.ok(events.includes('magic:alchemy-completed'));assert.ok(!amounts.has(995),'zero-value neutralisation creates no coins');
  } finally {PluginManager.emitCustomEvent=original;}
});

test('blood ancient spells heal one quarter of damage unless the target suppresses spell effects', () => {
  const {PluginManager}=require('../dist/plugins/PluginManager'),{CombatSpells}=require('../dist/game/content/combat/magic/CombatSpells');
  const original=PluginManager.emitCustomEvent;let healed=0,currentHp=10;
  const attacker={heal:n=>{healed+=Math.min(n,12-currentHp);currentHp=Math.min(12,currentHp+n);}};
  const hit={isAccurate:()=>true,getAttacker:()=>attacker,getTarget:()=>({}),getTotalDamage:()=>39};
  const bloodSpells=[CombatSpells.BLOOD_RUSH,CombatSpells.BLOOD_BURST,CombatSpells.BLOOD_BLITZ,CombatSpells.BLOOD_BARRAGE];
  try {
    PluginManager.emitCustomEvent=(name,e)=>{if(name==='magic:hit-effects')e.allowed=false;};
    for(const spell of bloodSpells){spell.onHitCalc(hit);assert.equal(healed,0);assert.equal(hit.getTotalDamage(),39);}
    PluginManager.emitCustomEvent=()=>{};
    for(const spell of bloodSpells){spell.onHitCalc({...hit,isAccurate:()=>false});assert.equal(healed,0,`${spell.spellId()} does not heal on a miss`);}
    for(const spell of bloodSpells){spell.onHitCalc(hit);assert.equal(healed,2,`${spell.spellId()} heals floor(39 × 25%), capped at max HP`);healed=0;currentHp=10;}
  } finally {PluginManager.emitCustomEvent=original;}
});


test('Casting a utility spell cannot immediately select its newly opened choice dialogue', async () => {
 const {LunarSpells}=require('../dist/game/content/combat/magic/LunarSpells');
 const {SpellTeleports}=require('../dist/game/content/combat/magic/SpellTeleports');
 const {PlayerStatus}=require('../dist/game/model/PlayerStatus');
 const original=LunarSpells.handleSelf,teleport=SpellTeleports.handleSelf;let active=false,selected=0;
 const connection=new net.ClientConnection(stubChannel());
 connection.resolveSpellName=()=> 'Astral Contact';
 connection.player={getAttribute(){},getInterfaceId:()=>-1,getStatus:()=>PlayerStatus.NONE,
  getQuickPrayers:()=>({handleWidgetAction:()=>false}),getDialogueManager:()=>({isActive:()=>active,getCurrent:()=>active?{}:null,handleOption:()=>selected++})};
 try {
  SpellTeleports.handleSelf=()=>false;LunarSpells.handleSelf=()=>{active=true;return true;};
  await connection.dispatch([{type:'widget_action',widgetId:(218<<16)|113,groupId:218,childId:113,buttonNum:1,itemId:9109}]);
  connection.processTurnPackets();
  assert.equal(active,true);assert.equal(selected,0);
 }finally{LunarSpells.handleSelf=original;SpellTeleports.handleSelf=teleport;}
});
test('changing floors in one map region refreshes ground items, including Draynor fish food', () => {
  const { State } = require('../dist/game/entity/impl/grounditem/ItemOnGround');
  const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
  const { MapRegionReplacementManager } = require('../dist/game/collision/MapRegionReplacementManager');
  const oldItems = World.getItems;
  const oldReplacements = MapRegionReplacementManager.sendVisibleReplacementsToPlayer;
  const snapshots = [];
  let location = new Location(3109, 3357, 0);
  const fish = {
    getPosition: () => new Location(3109, 3357, 1),
    isPendingRemoval: () => false,
    getPrivateArea: () => null,
    getState: () => State.SEEN_BY_EVERYONE,
    getOwner: () => undefined,
    isStaticSpawn: () => true,
    getItem: () => ({ getId: () => ItemIdentifiers.FISH_FOOD }),
  };
  World.getItems = () => [fish];
  MapRegionReplacementManager.sendVisibleReplacementsToPlayer = () => {};
  const channel = { isOpen: true };
  const session = new PlayerSession(channel);
  session.sendRebuildNormal = () => false; // Stop after the actual region/plane bookkeeping.
  session.lastMusicRegion = ((3109 >> 6) << 8) | (3357 >> 6);
  session.lastMusicMode = 1;
  const player = {
    getUsername: () => 'fish537',
    getLocation: () => location,
    getArea: () => null,
    getPrivateArea: () => null,
    getAudioSettings: () => ({ 18: 1 }),
    getPacketSender: () => ({ sendGroundItems: (items) => snapshots.push(items) }),
  };
  session.setPlayer(player);
  try {
    session.flush();
    assert.deepEqual(snapshots, [[]]);
    location = new Location(3109, 3357, 1);
    session.flush();
    assert.deepEqual(snapshots, [[], [fish]], 'upper-floor spawns are sent without changing map square');
    session.flush();
    assert.equal(snapshots.length, 2, 'standing still does not resend');
    location = new Location(3109, 3357, 0);
    session.flush();
    assert.deepEqual(snapshots.at(-1), [], 'upper-floor items clear on returning downstairs');
  } finally {
    World.getItems = oldItems;
    MapRegionReplacementManager.sendVisibleReplacementsToPlayer = oldReplacements;
  }
});


test('generic object hooks receive the actual clicked cache action', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const hooks = [...PluginManager.objectInteractionHooks], order = PluginManager.nextObjectHookOrder;
  const seen = [];
  try {
    PluginManager.createApi('ObjectActionTest').onObjectInteraction(event => {
      seen.push(event.option); event.handled = true;
    });
    const definition = { getName: () => 'Statue Space', getInteractions: () => ['Inspect', 'Build'] };
    for (const clickType of [2, 1]) {
      const event = { player: {}, object: {}, definition, objectId: 37308, clickType,
        location: { x: 0, y: 0, z: 0 }, handled: false };
      assert.equal(PluginManager.emitObjectInteraction(event), true);
    }
    assert.deepEqual(seen, ['Build', 'Inspect']);
  } finally {
    PluginManager.objectInteractionHooks = hooks; PluginManager.nextObjectHookOrder = order;
  }
});

test('NPC spell targeting requires explicit area permission for actionless puzzle NPCs', () => {
  const {NPCOptionPacketListener}=require('../dist/net/packet/impl/NPCOptionPacketListener');
  const {CombatSpells}=require('../dist/game/content/combat/magic/CombatSpells');
  const originalNpc=World.getNpcs, originalSpell=CombatSpells.getCombatSpell;
  let permission=null, attackable=false, valid=true, casts=0;
  const privateArea={canCastOnNpc:()=>permission};
  const npc={getHitpoints:()=>10,getLocation:()=>({getX:()=>1,getY:()=>1,getZ:()=>0}),getArea:()=>null,
    getCurrentDefinition:()=>({isAttackable:()=>attackable}),isPlayer:()=>false,getSize:()=>1,
    getPrivateArea:()=>privateArea,getOwner:()=>null,getContentId:()=>1};
  const spell={canCastOnTarget:()=>valid,canCast:()=>true,spellId:()=>1,castSound:()=>null,
    startCast(){},baseExperience:()=>0};
  const player={getHitpoints:()=>99,busy:()=>false,getArea:()=>null,getPrivateArea:()=>privateArea,
    getLocation:()=>({getX:()=>1,getY:()=>1,getZ:()=>0,isWithinDistance:()=>true}),isPlayer:()=>true,getSize:()=>1,
    getMovementQueue:()=>({reset(){}}),getCombat:()=>({castSpellOn:(target,chosen)=>{assert.equal(target,npc);assert.equal(chosen,spell);casts++;}})};
  World.getNpcs=()=>({capacityReturn:()=>10,get:()=>npc});CombatSpells.getCombatSpell=()=>spell;
  try {
    assert.equal(NPCOptionPacketListener.castSpell(player,1,1),false);
    permission=true;assert.equal(NPCOptionPacketListener.castSpell(player,1,1),true);assert.equal(casts,1);
    valid=false;assert.equal(NPCOptionPacketListener.castSpell(player,1,1),false,'normal spell requirements remain enforced');
    valid=true;attackable=true;permission=false;assert.equal(NPCOptionPacketListener.castSpell(player,1,1),false);
    permission=null;assert.equal(NPCOptionPacketListener.castSpell(player,1,1),true,'ordinary combat NPC targeting is unchanged');
  } finally {World.getNpcs=originalNpc;CombatSpells.getCombatSpell=originalSpell;}
});


test('player healing preserves existing overheal and still caps ordinary health restoration', () => {
  const {Player}=require('../dist/game/entity/impl/player/Player');
  let hp=121;
  const player={getSkillManager:()=>({getCurrentLevel:()=>hp,getMaxLevel:()=>99}),setHitpoints:v=>hp=v};
  Player.prototype.heal.call(player,0);assert.equal(hp,121,'a zero-damage Blood heal cannot remove overheal');
  Player.prototype.heal.call(player,6);assert.equal(hp,121,'healing neither removes nor extends existing overheal');
  hp=98;Player.prototype.heal.call(player,6);assert.equal(hp,99);
  hp=30;Player.prototype.heal.call(player,6);assert.equal(hp,36);
});

test('a logged-in player\'s input waits for their turn; upkeep and plugin traffic do not', async () => {
  const channel = stubChannel();
  const connection = new net.ClientConnection(channel);
  const stopped = [];
  const pluginReplies = [];
  connection.player = {
    getAttribute: () => undefined,
    getSession: () => ({ sendClientPacket: (frame) => pluginReplies.push(frame) }),
    getMovementQueue: () => ({ reset: () => stopped.push('route'), walkToReset() {} }),
    getCombat: () => ({ reset() {} }),
    setFollowing() {},
    setMobileInteraction() {},
    setPositionToFace() {},
  };
  await connection.dispatch([
    { type: 'ping' },
    { type: 'plugin_message', channel: 'test', data: '' },
    { type: 'interaction_stop' },
  ]);
  assert.deepEqual(connection.turnPackets.map((packet) => packet.type), ['interaction_stop']);
  assert.equal(pluginReplies.length, 1, 'plugin traffic is answered as it arrives');
  assert.deepEqual(stopped, []);

  // Input that arrived before a disconnect still counts while the player is held in the world.
  connection.closed = true;
  connection.processTurnPackets();
  assert.deepEqual(stopped, ['route']);
  assert.equal(connection.turnPackets.length, 0);
  connection.processTurnPackets();
  assert.deepEqual(stopped, ['route'], 'each packet acts once');
});

test('a client flooding one turn with input is disconnected', async () => {
  const channel = stubChannel();
  const connection = new net.ClientConnection(channel);
  connection.player = { getAttribute: () => undefined, setDisconnectSource() {}, getTrading: () => ({ closeTrade() {} }) };
  const originalSave = GameConstants.PLAYER_PERSISTENCE?.requestSave;
  if (GameConstants.PLAYER_PERSISTENCE) GameConstants.PLAYER_PERSISTENCE.requestSave = () => {};
  const removeQueue = World.getRemovePlayerQueue();
  try {
    const flood = Array.from({ length: NetworkConstants.PACKET_QUEUE_LIMIT + 1 }, () => ({ type: 'interaction_stop' }));
    await connection.dispatch(flood);
    assert.deepEqual(channel.closes, [{ code: 1008, reason: 'input limit' }]);
  } finally {
    if (GameConstants.PLAYER_PERSISTENCE) GameConstants.PLAYER_PERSISTENCE.requestSave = originalSave;
    const index = removeQueue.indexOf(connection.player);
    if (index >= 0) removeQueue.splice(index, 1);
  }
});
