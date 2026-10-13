const assert = require('node:assert/strict');
const { test } = require('node:test');
const { encodePluginMessage, decodeClientPackets, decodePluginMessagePayload } = require('../dist/net/protocol/ClientProtocol');

test('plugin messages enforce the wire limit and envelope', () => {
  const packet = encodePluginMessage('voice', { text: 'héllo 🎤' });
  assert.equal(packet[0], 6);
  assert.deepEqual(decodePluginMessagePayload(packet.subarray(3)), { channel: 'voice', data: { text: 'héllo 🎤' } });
  const clientPacket = Buffer.from(packet);
  clientPacket[0] = 205;
  assert.deepEqual(decodeClientPackets(clientPacket), [{ type: 'plugin_message', channel: 'voice', data: { text: 'héllo 🎤' } }]);
  for (const value of [null, [], { channel: '../voice', data: {} }, { channel: 'voice', data: [] }, { channel: 'voice', data: null }]) {
    assert.throws(() => decodePluginMessagePayload(Buffer.from(JSON.stringify(value))));
  }
  assert.throws(() => encodePluginMessage('voice', { text: 'a'.repeat(16384) }));
  assert.throws(() => decodePluginMessagePayload(Buffer.from([0xff])));
});

test('voice peers and signalling are scoped to participation, distance, plane and instance', () => {
  const handlers = {};
  const players = new Map();
  const participant = (id, x = 3200, z = 0, area = null) => {
    const player = { id, x, y: 3200, z, area, packets: [],
      getIndex() { return this.id; }, getUsername() { return `Player${id}`; },
      getPrivateArea() { return this.area; },
      getLocation() { return { getX: () => this.x, getY: () => this.y, getZ: () => this.z }; },
      getLocalPlayers() { return [...players.values()].filter(other => other !== this); },
      getSession() { return { sendClientPacket: packet => this.packets.push(packet) }; },
    };
    players.set(id, player);
    return player;
  };
  const a = participant(1), b = participant(2, 3201), far = participant(3, 3215), upstairs = participant(4, 3200, 1), instance = participant(5, 3200, 0, {});
  const core = { World: { getPlayers: () => players }, encodePluginMessage: (channel, data) => ({ channel, data }) };
  require('../plugins/interface/VoiceChat.plugin').register({ core,
    onCustomEvent: (name, handler) => { handlers.message = handler; },
    onPlayerProcess: handler => { handlers.process = handler; },
    onPlayerLogout: handler => { handlers.logout = handler; },
    onPlayerDisconnect: handler => { handlers.disconnect = handler; },
    onServerShutdown: handler => { handlers.shutdown = handler; },
  });
  const receive = (player, data) => {
    const event = { player, channel: 'voice', data, handled: false };
    handlers.message(event);
    assert.equal(event.handled, true);
  };
  receive(a, { type: 'voice-state', enabled: true, broadcasting: false });
  receive(b, { type: 'voice-state', enabled: true, broadcasting: false });
  assert.deepEqual(a.packets.at(-1).data.peers, [], 'two listeners need no connection');
  receive(a, { type: 'voice-state', enabled: true, broadcasting: true });
  assert.deepEqual(b.packets.at(-1).data.peers, [{ id: 1, name: 'Player1', broadcasting: true }],
    'a listener receives nearby speakers without enabling its microphone');
  receive(b, { type: 'voice-state', enabled: true, broadcasting: true });
  receive(b, { type: 'voice-state', enabled: true, broadcasting: false });
  assert.deepEqual(a.packets.at(-1).data.peers, [{ id: 2, name: 'Player2', broadcasting: false }],
    'disabling the microphone retains participation and updates peers for renegotiation');
  const listenerOffer = { type: 'offer', target: 2, connectionId: 'listener-pair', description: { type: 'offer', sdp: 'test' } };
  receive(a, listenerOffer);
  assert.equal(b.packets.at(-1).data.type, 'offer', 'receive-only participants can receive signalling');
  for (const player of players.values()) receive(player, { type: 'voice-state', enabled: true, broadcasting: true });
  assert.deepEqual(a.packets.at(-1).data.peers, [{ id: 2, name: 'Player2', broadcasting: true }]);
  assert.deepEqual(b.packets.at(-1).data.peers, [{ id: 1, name: 'Player1', broadcasting: true }, { id: 3, name: 'Player3', broadcasting: true }]);
  const offer = { type: 'offer', target: 2, connectionId: 'pair-1', from: 999, description: { type: 'offer', sdp: 'test' } };
  receive(a, offer);
  assert.equal(b.packets.at(-1).data.from, 1, 'sender is always the authenticated player');
  const before = b.packets.length;
  receive(a, { ...offer, description: { type: 'answer', sdp: 'invalid' } });
  receive(a, { ...offer, type: 'ice-candidate', candidate: { candidate: 'x', sdpMLineIndex: -1 } });
  assert.equal(b.packets.length, before, 'invalid SDP and ICE are not forwarded');
  for (const target of [far, upstairs, instance]) {
    const count = target.packets.length;
    receive(a, { ...offer, target: target.id });
    assert.equal(target.packets.length, count);
  }
  b.x = 3215;
  receive(a, offer);
  assert.equal(b.packets.length, before, 'moving away blocks signalling immediately, before the next tick');
  handlers.process({ player: a });
  assert.deepEqual(a.packets.at(-1).data.peers, []);
  b.x = 3201;
  handlers.process({ player: a });
  receive(b, { type: 'voice-state', enabled: false });
  assert.deepEqual(a.packets.at(-1).data.peers, []);
  receive(a, offer);
  assert.equal(b.packets.length, before, 'disabled participants cannot receive signalling');
  receive(b, { type: 'voice-state', enabled: true, broadcasting: true });
  handlers.logout({ player: b });
  assert.deepEqual(a.packets.at(-1).data.peers, []);
  handlers.shutdown();
});
