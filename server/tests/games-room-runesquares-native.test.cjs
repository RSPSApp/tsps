'use strict';
// Native wire packets -> ClientConnection -> production plugin, using real
// sessions, players, movement, area and PacketSender. Only the network is inert.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, beforeEach, afterEach, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
const { SERVER_PACKET_LENGTHS } = require('../dist/net/protocol/ServerPackets');
const { AreaManager } = require('../dist/game/model/areas/AreaManager');
const Room = require('../plugins/minigames/gamesroom/Runtime.GamesRoom');
const Rules = require('../plugins/minigames/gamesroom/Rules.GamesRoom');
const core = PM.getCoreApi();
const actors = [];
let serial = 0;
let hookErrors = [];
const logError = console.error;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core.RegionManager.init();
  // This earlier production hook owns option 4 in the Duel Arena and historically
  // consumed it globally. Games Room's scoped pre-walk route must win here.
  require('../plugins/minigames/DuelArena.plugin').register(PM.createApi('DuelArenaNative'));
  require('../plugins/minigames/GamesRoom.plugin').register(PM.createApi('GamesRoomNative'));
});
beforeEach(() => {
  hookErrors = [];
  console.error = (...args) => {
    if (/\[plugins\].*(?:failed|error)/i.test(String(args[0]))) hookErrors.push(args.map(String).join(' '));
    logError(...args);
  };
});
afterEach(() => {
  for (const p of actors.splice(0)) {
    if (p.getArea()) p.getArea().leave(p, false);
    else Room.leave(p);
    p.getPacketSender().sendInterfaceRemoval();
    core.World.getPlayers().remove(p);
  }
  console.error = logError;
  assert.deepEqual(hookErrors, [], 'no plugin hook failure was swallowed by dispatch');
});

function actor() {
  const frames = [];
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: data => { frames.push(Buffer.from(data)); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername(`nativegame${++serial}`);
  assert.equal(core.World.getPlayers().add(p), true);
  p.setRegistered(true);
  p.setLocation(new core.Location(2200 + (serial % 2), 4960, 0));
  p.setNeedsPlacement(false);
  AreaManager.process(p);
  assert.equal(p.getArea(), Room.areaOf(), 'normal area resolution enters the Games Room');
  const connection = new ClientConnection(channel);
  connection.player = p;
  p.nativeConnection = connection;
  p.nativeFrames = frames;
  actors.push(p);
  return p;
}

function received(player) {
  player.getSession().flushPackets();
  const packets = [];
  for (const frame of player.nativeFrames.splice(0)) {
    let offset = 0;
    while (offset < frame.length) {
      const id = frame[offset++];
      let length = SERVER_PACKET_LENGTHS[id];
      assert.notEqual(length, undefined, `known outgoing packet ${id}`);
      if (length === -1) length = frame[offset++];
      else if (length === -2) { length = frame.readUInt16BE(offset); offset += 2; }
      packets.push({ id, payload: frame.subarray(offset, offset + length) });
      offset += length;
    }
  }
  return packets;
}
function hiddenValue(packets, uid) {
  return packets.filter(p => p.id === 106 && p.payload.readInt32BE(0) === uid).at(-1)?.payload[4];
}
function flagValue(packets, uid) {
  return packets.filter(p => p.id === 109 && p.payload.readInt32BE(0) === uid).at(-1)?.payload.readInt32BE(8);
}
function hasButtonLabel(packets, uid, label) {
  return packets.some(p => p.id === 110 && p.payload.readInt32BE(0) === 599 &&
    p.payload.readInt32BE(6) === uid && p.payload.includes(Buffer.from(`${label}\0`)));
}
function textValue(packets, uid) {
  const packet = packets.filter(p => p.id === 105 && p.payload.readInt32BE(0) === uid).at(-1);
  return packet?.payload.subarray(4).toString('utf8').split('\0')[0];
}
function scriptInventory(packet) {
  const p=packet.payload; let offset=5;
  for(let i=0;i<p[4];i++) {
    const type=p[offset++];
    if(type===1)offset+=4;else if(type===2)offset+=8;else {while(p[offset++]!==0){}}
  }
  for(let i=0;i<2;i++) {const n=p.readUInt16BE(offset);offset+=2+n*8;}
  assert.equal(p[offset++],1);
  offset+=4;const count=p.readUInt16BE(offset);offset+=2;
  const slots=[];
  for(let i=0;i<count;i++) {
    const slot=p.readUInt16BE(offset),itemId=p.readUInt16BE(offset+2)-1,quantity=p[offset+4];
    slots.push({slot,itemId,quantity});offset+=quantity===255?9:5;
  }
  return slots;
}
function assertRuneRows(packets, game) {
  for (const [name, x] of [['airrune', 0], ['chaosrune', 64], ['soulrune', 128]]) {
    const uid = core.CacheDefinitions.getComponentId(`boardgames_${game}_options:${name}`);
    const packet = packets.filter(p => p.id === 118 && p.payload.readInt32BE(0) === uid).at(-1);
    assert.ok(packet, `${name} receives the non-overlapping fourth row`);
    assert.equal(packet.payload.readInt16BE(4), x);
    assert.equal(packet.payload.readInt16BE(6), 144);
  }
}

async function wire(player, frame) {
  const decoded = decodeClientPackets(frame);
  assert.equal(decoded.length, 1, 'one complete native wire packet');
  await player.nativeConnection.dispatch(decoded);
  player.nativeConnection.processTurnPackets();
  for (let tick = 0; tick < 12; tick++) {
    core.TaskManager.processWalkTo(player.getIndex());
    player.getMovementQueue().process();
    core.TaskManager.process();
    for (const actor of actors) {
      AreaManager.process(actor);
      actor.resetUpdating();
    }
  }
  await new Promise(resolve => setImmediate(resolve));
  return decoded[0];
}

function placementTick() {
  for (const player of actors) {
    player.getMovementQueue().process();
    AreaManager.process(player);
    player.resetUpdating();
  }
}

async function challenge(player, target) {
  const frame = Buffer.alloc(4);
  frame[0] = 73; // rev241 OPPLAYER4
  frame.writeUInt16BE(target.getIndex(), 1);
  return wire(player, frame);
}
async function click(player, name, slot = 0xffff) {
  const uid = core.CacheDefinitions.getComponentId(name);
  assert.ok(Number.isInteger(uid), `active cache component ${name}`);
  const frame = Buffer.alloc(9);
  frame[0] = 23; // rev241 IF_BUTTON1
  frame.writeInt32BE(uid, 1);
  frame.writeUInt16BE(slot, 5);
  frame.writeUInt16BE(0xffff, 7);
  return wire(player, frame);
}
async function choice(player, value, widget = (219 << 16) | 1) {
  const frame = Buffer.alloc(7);
  frame[0] = 62; // rev241 RESUME_PAUSEBUTTON
  frame[1] = value >>> 8;
  frame[2] = (value + 128) & 255;
  frame.writeInt32BE(widget, 3);
  return wire(player, frame);
}
async function invite(a, b, game = 'runelink') {
  placementTick();
  await challenge(a, b);
  if (a.getInterfaceId() === core.CacheDefinitions.getInterfaceId('boardgames_challenge')) {
    await click(a, `boardgames_challenge:${game}`);
    await click(a, 'boardgames_challenge:select');
  } else {
    assert.equal(a.getInterfaceId(), core.CacheDefinitions.getInterfaceId(`boardgames_${game}_options`),
      'a rematch in the game room opens only that game options');
    await click(a, `boardgames_challenge:${game === 'runelink' ? 'draughts' : 'runelink'}`);
  }
  assert.equal(a.getInterfaceId(), core.CacheDefinitions.getInterfaceId(`boardgames_${game}_options`));
  assertRuneRows(received(a), game);
  await click(a, `boardgames_${game}_options:challenge`);
  assert.ok(Room.invitation(a, b), 'challenge issued through native controls');
}
async function match(a, b, game) {
  await invite(a, b, game);
  await choice(b, 1);
  assert.equal(Room.matchOf(a), undefined, 'accepting the invitation first opens recipient piece selection');
  await click(b, `boardgames_${game}_options:challenge`);
  assert.ok(Room.matchOf(a), 'recipient native chat choice starts the match');
  assert.equal(Room.matchOf(a), Room.matchOf(b));
  return Room.matchOf(a);
}

test('RuneSquares native invite, immutable recipient settings, both edge targets and extra turns', async () => {
  const a=actor(),b=actor();
  await invite(a,b,'runesquares');
  await choice(b,1);
  assert.equal(b.getInterfaceId(),core.CacheDefinitions.getInterfaceId('boardgames_runesquares_options'));
  const recipient=received(b);
  assert.equal(flagValue(recipient,core.CacheDefinitions.getComponentId('boardgames_runesquares_options:15seconds')),0);
  for(const control of ['15seconds','30seconds','1minute','2minutes','ranked']) {
    const uid=core.CacheDefinitions.getComponentId(`boardgames_runesquares_options:${control}`);
    assert.ok(recipient.some(p=>p.id===110&&p.payload.readInt32BE(0)===893&&p.payload.readInt32BE(6)===uid),
      'recipient controls must also clear local cache handlers, not just suppress transmission');
  }
  await click(b,'boardgames_runesquares_options:challenge');
  const m=Room.matchOf(a); assert.ok(m); placementTick();
  const built=received(a).find(p=>p.id===110&&p.payload.readInt32BE(0)===151);
  assert.ok(built);
  assert.ok(scriptInventory(built).every(s=>s.itemId===-1&&s.quantity===0),
    'blank cells contain no invisible item/examine target above the native edge controls');
  assert.equal(m.state.board.length,64);
  const turn=m.players[m.state.turn],waiting=m.players[1-m.state.turn];
  await click(waiting,'boardgames_runesquares:h0_large');assert.equal(m.state.h[0],false);
  await click(turn,'boardgames_runesquares:h0_small');assert.equal(m.state.h[0],true);
  const next=m.players[m.state.turn],side=m.state.turn;
  await click(next,'boardgames_runesquares:v0_large');assert.equal(m.state.v[0],true);
  assert.equal(m.state.board[0],side===0?1:-1);assert.equal(m.state.turn,side);
  assert.equal(m.turns,2,'scoring move counts for completed turns despite keeping turn');
  const before=JSON.stringify(m.state);
  await click(next,'boardgames_runesquares:v0_small');assert.equal(JSON.stringify(m.state),before);
  assert.equal(m.state.scores[side],1);
  await click(next,'boardgames_runesquares:resign');assert.equal(Room.matchOf(a),undefined);
  assert.equal(m.state.result.winner,1-side);
  assert.ok(received(m.players[side]).some(p=>p.id===132&&p.payload.readUInt16BE(0)===109),'loser hears sourced defeat jingle');
  assert.ok(received(m.players[1-side]).some(p=>p.id===132&&p.payload.readUInt16BE(0)===110),'winner hears sourced victory jingle');
  for(const p of [a,b])assert.equal(p.getPacketSender().isSubInterfaceOpen(core.CacheDefinitions.getInterfaceId('boardgames_runesquares_overlay')),true,
    'returning to RuneSquares room displays independent rank overlay');
  await click(a,'boardgames_runesquares:close');await click(b,'boardgames_runesquares:close');
  assert.ok(a.getLocation());assert.ok(b.getLocation());
});

test('RuneSquares timeout chooses one legal edge and mutual draw leaves ranks unchanged',async()=>{
  const a=actor(),b=actor(),m=await match(a,b,'runesquares');placementTick();
  const before=core.World.getProcessCycle();
  try {core.World.processCycle=m.deadline;Room.areaOf().process(m.players[m.state.turn]);}
  finally {core.World.processCycle=before;}
  assert.equal(m.state.h.filter(Boolean).length+m.state.v.filter(Boolean).length,1);
  await click(a,'boardgames_runesquares:offer_draw');await click(b,'boardgames_runesquares:offer_draw');
  assert.equal(m.state.result.winner,null);
  for(const p of [a,b]) {
    assert.equal(p.getAttribute('games-room:runesquares-rank')??1000,1000);
    assert.ok(received(p).some(packet=>packet.id===132&&packet.payload.readUInt16BE(0)===108));
  }
});

test('RuneSquares overlay cleanup preserves a replacement HUD when its group moved elsewhere',()=>{
  const p=actor(),sender=p.getPacketSender(),cache=core.CacheDefinitions;
  const hud=cache.getComponentId('toplevel_osrs_stretch:overlay_hud');
  const side=cache.getComponentId('toplevel_osrs_stretch:sidemodal');
  const overlay=cache.getInterfaceId('boardgames_runesquares_overlay');
  p.setLocation(new core.Location(2188,4948,0));Room.areaOf().process(p);
  assert.equal(sender.getSubInterfaceAt(hud)?.groupId,overlay);
  sender.sendSubInterface(side,overlay,1);
  sender.sendSubInterface(hud,cache.getInterfaceId('boardgames_runelink_overlay'),1);
  const replacement=sender.getSubInterfaceAt(hud);
  Room.leave(p);
  assert.equal(sender.getSubInterfaceAt(hud),replacement,'leave cannot close another HUD owner');
});

test('RuneSquares table cannot enter an unsupported spectator adapter or disturb its players',async()=>{
  const a=actor(),b=actor(),m=await match(a,b,'runesquares'),v=actor();placementTick();
  const table=m.allocation.playingTable,at=table.getLocation();
  v.setLocation(at.clone().transform(0,-1,0));v.setNeedsPlacement(false);
  const before=JSON.stringify(m.state);
  await v.nativeConnection.dispatch([{type:'object_option',id:table.getId(),x:at.getX(),y:at.getY(),clickType:1}]);
  v.nativeConnection.processTurnPackets();
  for(let i=0;i<12;i++) {
    core.TaskManager.processWalkTo(v.getIndex());v.getMovementQueue().process();core.TaskManager.process();
    for(const p of actors){AreaManager.process(p);p.resetUpdating();}
  }
  assert.equal(require('../plugins/minigames/gamesroom/Spectator.GamesRoom').viewOf(v),undefined);
  assert.notEqual(v.getInterfaceId(),core.CacheDefinitions.getInterfaceId('boardgames_runesquares'));
  assert.equal(JSON.stringify(m.state),before);
  assert.equal(Room.matchOf(a),m);assert.equal(Room.matchOf(b),m);
});

test('RuneSquares full native edge play ranks only this game and can persist; stale edge cannot reach rematch', async () => {
  const a=actor(),b=actor();const m=await match(a,b,'runesquares');placementTick();
  const initial=a.getAttribute('games-room:draughts-rank',1000);
  for(const {axis,edge} of Rules.legalMoves(m.state)) {
    await click(m.players[m.state.turn],`boardgames_runesquares:${axis}${edge}_large`);
  }
  assert.equal(m.state.scores[0]+m.state.scores[1],64);assert.ok(m.finished);
  assert.equal(a.getAttribute('games-room:draughts-rank',1000),initial);
  const winner=m.state.result.winner;
  if(winner!==null) {
    assert.equal(m.players[winner].getAttribute('games-room:runesquares-rank',1000),1050);
    assert.equal(m.players[1-winner].getAttribute('games-room:runesquares-rank',1000),950);
  }
  const {PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const save=PlayerSave.fromPlayer(a);
  assert.ok(save,'real save object can be produced after completed game');
  await click(a,'boardgames_runesquares:close');await click(b,'boardgames_runesquares:close');
  placementTick();const next=await match(a,b,'runesquares');placementTick();
  assert.equal(next.state.h[0],false);assert.equal(next.state.v[0],false);
  await click(a,'boardgames_runelink:column0');assert.equal(next.state.board.filter(Boolean).length,0);
  core.World.getPlayers().remove(b);Room.leave(b);assert.ok(next.finished);
  assert.equal(Room.matchOf(a),undefined);
});
