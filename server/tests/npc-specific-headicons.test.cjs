process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { Location } = require('../dist/game/model/Location');
const { encodeNpcHeadIconSpecific } = require('../dist/net/protocol/ClientProtocol');

before(() => CachePipeline.initialize());
function viewer(index) {
  const channel = { isOpen: true, send() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session, new Location(1385, 3274));
  player.setIndex(index); player.setUsername(`icon${index}`); session.setPlayer(player);
  const packets = [];
  session.sendClientPacket = packet => { packets.push(packet); return true; };
  return { player, session, packets, channel };
}
function actor(index = 101) {
  const npc = new NPC(1, new Location(1386, 3274));
  npc.setIndex(index); npc.setRegistered(true); return npc;
}
const icons = v => v.packets.filter(p => p[0] === 26);

test('private icons follow NPC sync, preserve the shared prayer icon, and isolate two viewers', () => {
  const a = viewer(1), b = viewer(2), npc = actor();
  npc.setHeadIcon(2);
  for (const v of [a, b]) v.player.getLocalNpcs().push(npc);
  const archive = CacheDefinitions.getSpriteId('headicons_et');
  assert.equal(archive, 6405, 'active cache identifies the captured leaf archive');
  a.player.getPacketSender().sendNpcHeadIconSpecific(npc, 0, archive, 5);
  a.session.flush(1); b.session.flush(1);
  assert.deepEqual(icons(a).map(p => [...p]), [[26,0,101,0,25,5,0,5]]);
  assert.ok(a.packets.findIndex(p => p[0] === 21) < a.packets.findIndex(p => p[0] === 26));
  assert.deepEqual(icons(b), []); assert.equal(npc.getHeadIcon(), 2);
  a.packets.length = 0; a.session.flush(2); assert.deepEqual(icons(a), []);
});

test('offscreen, removed, replaced, disconnected and rebound actors never replay a queued icon', () => {
  const a = viewer(3), npc = actor();
  const send = () => a.player.getPacketSender().sendNpcHeadIconSpecific(npc, 7, -1, -1);
  send(); a.session.flush(1);
  a.player.getLocalNpcs().push(npc); a.session.flush(2);
  assert.deepEqual(icons(a), []);
  send(); a.player.getLocalNpcs().splice(0, 1, actor()); npc.setRegistered(false); a.session.flush(3);
  assert.deepEqual(icons(a), []);
  npc.setRegistered(true); a.player.getLocalNpcs().splice(0, 1, npc);
  send(); a.channel.isOpen = false; a.session.flush(4); a.channel.isOpen = true; a.session.flush(5);
  assert.deepEqual(icons(a), []);
  send(); const replacement = viewer(4).player; replacement.getLocalNpcs().push(npc);
  a.session.setPlayer(replacement); a.session.flush(6); assert.deepEqual(icons(a), []);
});

test('slot clears and boundary values survive encoding; invalid slots cannot wrap', () => {
  assert.deepEqual([...encodeNpcHeadIconSpecific(32874, 7, -1, -1)], [26,128,106,7,255,255,255,255]);
  assert.deepEqual([...encodeNpcHeadIconSpecific(1, 0, 65535, 32767)], [26,0,1,0,255,255,127,255]);
  for (const slot of [-1, 8, 1.5]) assert.throws(() => encodeNpcHeadIconSpecific(1, slot, 440, 0), RangeError);
  assert.throws(() => encodeNpcHeadIconSpecific(1, 0, 440, 32768), RangeError);
});
