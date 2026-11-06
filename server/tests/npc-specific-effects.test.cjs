process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { Location } = require('../dist/game/model/Location');
const { Animation } = require('../dist/game/model/Animation');
const { Graphic } = require('../dist/game/model/Graphic');
const { Flag } = require('../dist/game/model/Flag');

before(() => CachePipeline.initialize());

function viewer(index) {
  const channel = { isOpen: true, send() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session, new Location(1385, 3274));
  player.setIndex(index);
  player.setUsername(`effect${index}`);
  session.setPlayer(player);
  const packets = [];
  session.sendClientPacket = packet => { packets.push(packet); return true; };
  return { player, session, packets, channel };
}

function spirit(index = 101) {
  const npc = new NPC(1, new Location(1386, 3274));
  npc.setIndex(index);
  npc.setRegistered(true);
  return npc;
}

const effects = packets => packets.filter(p => p[0] === 24 || p[0] === 25);

test('specific effects reach only their viewer after NPC sync and leave the shared actor unchanged', () => {
  const a = viewer(1), b = viewer(2), npc = spirit();
  for (const v of [a,b]) v.player.getLocalNpcs().push(npc);
  a.player.getPacketSender().sendNpcAnimationSpecific(npc, new Animation(12207, 7));
  a.player.getPacketSender().sendNpcSpotAnimationSpecific(npc, new Graphic(3353, 44, 513), 2);
  assert.deepEqual(effects(a.packets), [], 'waits until the actor exists in this viewer sync');
  a.session.flush(1); b.session.flush(1);
  assert.deepEqual(effects(a.packets).map(p => [...p]), [
    [24,0,101,47,175,7], [25,0,101,13,25,2,2,1,0,44],
  ]);
  assert.ok(a.packets.findIndex(p => p[0] === 21) < a.packets.findIndex(p => p[0] === 24));
  assert.deepEqual(effects(b.packets), []);
  assert.equal(ncFlag(npc, Flag.ANIMATION), false);
  assert.equal(ncFlag(npc, Flag.GRAPHIC), false);
  a.packets.length = 0; a.session.flush(2);
  assert.deepEqual(effects(a.packets), [], 'one shot, never repeated by the next sync');
});

function ncFlag(npc, flag) { return npc.getUpdateFlag().flagged(flag); }

test('unknown, removed and reused indexes cannot retain a private effect for later visibility', () => {
  const a = viewer(3), npc = spirit();
  a.player.getPacketSender().sendNpcAnimationSpecific(npc, new Animation(12207));
  a.session.flush(1);
  a.player.getLocalNpcs().push(npc); a.session.flush(2);
  assert.deepEqual(effects(a.packets), [], 'offscreen event is not replayed on entry');
  a.player.getPacketSender().sendNpcAnimationSpecific(npc, new Animation(12207));
  a.player.getLocalNpcs().splice(0, 1, spirit(npc.getIndex()));
  npc.setRegistered(false); a.session.flush(3);
  assert.deepEqual(effects(a.packets), [], 'replacement actor cannot inherit a queued event');
});

test('clears preserve their slots and closed channels drop pending effects', () => {
  const a = viewer(4), npc = spirit(); a.player.getLocalNpcs().push(npc);
  a.player.getPacketSender().sendNpcAnimationSpecific(npc, new Animation(-1));
  a.player.getPacketSender().sendNpcSpotAnimationSpecific(npc, new Graphic(-1), 255);
  a.session.flush(1);
  assert.deepEqual(effects(a.packets).map(p => [...p]), [
    [24,0,101,255,255,0], [25,0,101,255,255,255,0,0,0,0],
  ]);
  a.packets.length = 0;
  a.player.getPacketSender().sendNpcAnimationSpecific(npc, new Animation(12207));
  a.channel.isOpen = false; a.session.flush(2);
  a.channel.isOpen = true; a.session.flush(3);
  assert.deepEqual(effects(a.packets), [], 'closed connection discards events');
});

test('binding a new player to a session discards the previous login one-shots', () => {
  const a = viewer(5), npc = spirit(); a.player.getLocalNpcs().push(npc);
  a.player.getPacketSender().sendNpcAnimationSpecific(npc, new Animation(12207));
  const replacement = new Player(a.session, new Location(1385, 3274));
  replacement.setIndex(5); replacement.setUsername('effectrelog');
  replacement.getLocalNpcs().push(npc);
  a.session.setPlayer(replacement); a.session.flush(1);
  assert.deepEqual(effects(a.packets), [], 'a new login cannot inherit the prior player event');
});
