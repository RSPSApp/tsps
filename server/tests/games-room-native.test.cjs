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

test('native OPPLAYER4 and options retain selected rune, move time and ranked setting', async () => {
  const a = actor(), b = actor();
  a.setAttribute('games-room:draughts-rank', 1100);
  b.setAttribute('games-room:draughts-rank', 1300);
  a.setAttribute('games-room:runelink-rank', 1400);
  b.setAttribute('games-room:runelink-rank', 1200);
  await challenge(a, b);
  assert.equal(a.getInterfaceId(), core.CacheDefinitions.getInterfaceId('boardgames_challenge'));
  const selection = received(a);
  assert.equal(textValue(selection, core.CacheDefinitions.getComponentId('boardgames_challenge:draughts_rank')), '1100 vs 1300');
  assert.equal(textValue(selection, core.CacheDefinitions.getComponentId('boardgames_challenge:runelink_rank')), '1400 vs 1200');
  await click(a, 'boardgames_challenge:select');
  await click(a, 'boardgames_draughts_options:soulrune');
  await click(a, 'boardgames_draughts_options:2minutes');
  await click(a, 'boardgames_draughts_options:ranked');
  await click(a, 'boardgames_draughts_options:challenge');
  assert.deepEqual(Room.invitation(a, b).settings, { piece: 12, seconds: 120, ranked: false });
  await choice(b, 1);
  assert.equal(Room.matchOf(a), undefined);
  const options = received(b);
  assertRuneRows(options, 'draughts');
  for (const name of ['15seconds', '30seconds', '1minute', '2minutes', 'ranked']) {
    assert.equal(flagValue(options, core.CacheDefinitions.getComponentId(`boardgames_draughts_options:${name}`)), 0,
      `recipient ${name} is visibly disabled`);
  }
  assert.ok(hasButtonLabel(options, core.CacheDefinitions.getComponentId('boardgames_draughts_options:challenge'), 'Accept'));
  await click(b, 'boardgames_draughts_options:15seconds');
  await click(b, 'boardgames_draughts_options:ranked');
  await click(b, 'boardgames_draughts_options:waterrune');
  await click(b, 'boardgames_draughts_options:challenge');
  assert.deepEqual(Room.matchOf(a).settings, { pieces: [12, 2], seconds: 120, ranked: false },
    'recipient chooses a piece but cannot rewrite the offered rules');
});

test('native chat decline, unrelated resume and consumed accept cannot start or replay a match', async () => {
  const a = actor(), b = actor();
  await invite(a, b);
  await choice(b, 1, (218 << 16) | 1);
  assert.equal(Room.matchOf(a), undefined);
  assert.ok(Room.invitation(a, b));
  await choice(b, 2);
  assert.equal(Room.invitation(a, b), undefined);
  await choice(b, 1);
  assert.equal(Room.matchOf(a), undefined);
  const m = await match(a, b, 'runelink');
  await choice(b, 1);
  assert.equal(Room.matchOf(a), m, 'consumed accept does not replace the live match');
});

test('Draughts native dynamic child slots select a real source and move to an empty square', async () => {
  const a = actor(), b = actor(), m = await match(a, b, 'draughts');
  const side = m.state.turn, player = m.players[side], move = Rules.legalMoves(m.state)[0];
  const before = m.state.board.slice(), piece = before[move.from];
  assert.equal(before[move.to], 0);
  received(player);
  await click(player, 'boardgames_draughts:boardinv', move.from);
  assert.deepEqual(m.state.board, before, 'selection alone does not mutate the board');
  const selection = received(player);
  assert.ok(selection.some(p => p.id === 110 && p.payload.readInt32BE(0) === 6002),
    'selected rune receives the native outline update');
  assert.ok(!selection.some(p => p.id === 114), 'selecting a source does not restart the move timer animation');
  const decoded = await click(player, 'boardgames_draughts:boardinv', move.to);
  assert.equal(decoded.slot, move.to, 'wire sub-id reaches the empty target');
  assert.equal(m.state.board[move.from], 0);
  assert.equal(m.state.board[move.to], piece);
  assert.equal(m.state.turn, 1 - side);
});

test('RuneLink native column rejects wrong turn and keeps concurrent matches separate', async () => {
  const a = actor(), b = actor(), c = actor(), d = actor();
  const m = await match(a, b, 'runelink'), other = await match(c, d, 'runelink');
  await click(m.players[1 - m.state.turn], 'boardgames_runelink:column6');
  assert.equal(m.state.board.filter(Boolean).length, 0);
  await click(m.players[m.state.turn], 'boardgames_runelink:column6');
  assert.equal(m.state.board.filter(Boolean).length, 1);
  assert.notEqual(m.state.board[41], 0, 'column six falls to its bottom cell');
  assert.equal(other.state.board.filter(Boolean).length, 0);
});

test('PacketSender close forfeits once and cannot end a later native match', async () => {
  const a = actor(), b = actor(), old = await match(a, b, 'runelink');
  a.getPacketSender().sendInterfaceRemoval();
  assert.equal(old.state.result.winner, 1);
  assert.equal(Room.matchOf(b), undefined);
  const ended = received(b);
  for (let col = 0; col < 7; col++) assert.equal(flagValue(ended,
    core.CacheDefinitions.getComponentId(`boardgames_runelink:column${col}`)), 0, 'ended column disabled');
  received(b);
  const fresh = await match(a, b, 'runelink');
  const packets = received(b);
  for (const name of ['offer_draw', 'turn', 'turn_name']) {
    assert.equal(hiddenValue(packets, core.CacheDefinitions.getComponentId(`boardgames_runelink:${name}`)), 0,
      `${name} restored after the previous result screen`);
  }
  for (let col = 0; col < 7; col++) assert.equal(flagValue(packets,
    core.CacheDefinitions.getComponentId(`boardgames_runelink:column${col}`)), 2, 'rematch column enabled');
  await choice(b, 1);
  assert.equal(Room.matchOf(a), fresh);
  a.getPacketSender().sendInterface(12);
  assert.equal(fresh.state.result.winner, 1, 'real modal replacement also forfeits');
  assert.equal(Room.matchOf(a), undefined);
});

test('challenge, decline messages and board names show display names, never login names', async () => {
  const a = actor(), b = actor();
  a.setDisplayName('Alice Disp');
  b.setDisplayName('Bob Disp');
  const said = new Map([[a, []], [b, []]]);
  for (const p of [a, b]) {
    const send = p.sendMessage.bind(p);
    p.sendMessage = text => { said.get(p).push(String(text)); return send(text); };
  }
  await invite(a, b, 'runelink');
  assert.ok(said.get(a).includes('You challenge Bob Disp to Runelink.'));
  assert.ok(said.get(b).includes('Alice Disp challenges you to Runelink. Choose Challenge on that player to accept.'));
  await choice(b, 2);
  assert.ok(said.get(a).includes('Bob Disp declined your challenge.'));
  const m = await match(a, b, 'runelink');
  const board = received(m.players[0]);
  const name = key => textValue(board, core.CacheDefinitions.getComponentId(`boardgames_runelink:${key}`));
  assert.equal(name('p1_name'), m.players[0].getDisplayName());
  assert.equal(name('p2_name'), m.players[1].getDisplayName());
  assert.equal(name('turn_name'), m.players[m.state.turn].getDisplayName());
  for (const text of [...said.get(a), ...said.get(b), name('p1_name'), name('p2_name'), name('turn_name')]) {
    assert.ok(!text.includes(a.getUsername()) && !text.includes(b.getUsername()), `no login name in "${text}"`);
  }
});

test('Runeversi native challenge/options choose independent rank and fixed offered settings', async () => {
  const a=actor(), b=actor();
  a.setAttribute('games-room:runeversi-rank',1200); b.setAttribute('games-room:runeversi-rank',1600);
  await challenge(a,b);
  assert.equal(textValue(received(a),core.CacheDefinitions.getComponentId('boardgames_challenge:runeversi_rank')),'1200 vs 1600');
  await click(a,'boardgames_challenge:runeversi');await click(a,'boardgames_challenge:select');
  assert.equal(a.getInterfaceId(),core.CacheDefinitions.getInterfaceId('boardgames_runeversi_options'));
  assertRuneRows(received(a),'runeversi');
  await click(a,'boardgames_runeversi_options:bloodrune');await click(a,'boardgames_runeversi_options:15seconds');
  await click(a,'boardgames_runeversi_options:ranked');await click(a,'boardgames_runeversi_options:challenge');
  assert.deepEqual(Room.invitation(a,b).settings,{piece:11,seconds:15,ranked:false});
  await choice(b,1);const options=received(b);
  assert.ok(hasButtonLabel(options,core.CacheDefinitions.getComponentId('boardgames_runeversi_options:challenge'),'Accept'));
  for (const name of ['15seconds','30seconds','1minute','2minutes','ranked']) assert.equal(flagValue(options,core.CacheDefinitions.getComponentId(`boardgames_runeversi_options:${name}`)),0);
  await click(b,'boardgames_runeversi_options:2minutes');await click(b,'boardgames_runeversi_options:ranked');
  await click(b,'boardgames_runeversi_options:soulrune');await click(b,'boardgames_runeversi_options:challenge');
  assert.deepEqual(Room.matchOf(a).settings,{seconds:15,ranked:false,pieces:[11,12]});
});

test('Runeversi static native squares flip bracketed runes and reject forged/stale controls', async () => {
  const a=actor(),b=actor(),m=await match(a,b,'runeversi');
  const side=m.state.turn,active=m.players[side],waiting=m.players[1-side],move=Rules.legalMoves(m.state)[0];
  const snapshot=m.state.board.slice();
  const packets=received(active),waitPackets=received(waiting);
  const legal=new Set(Rules.legalMoves(m.state).map(x=>x.to));
  for(let to=0;to<64;to++) {
    const uid=core.CacheDefinitions.getComponentId(`boardgames_runeversi:square_${to}`);
    assert.equal(flagValue(packets,uid),legal.has(to)?2:0);assert.equal(flagValue(waitPackets,uid),0);
  }
  await click(waiting,`boardgames_runeversi:square_${move.to}`);
  await click(active,'boardgames_runeversi:square_27');await click(active,'boardgames_runeversi:square_0');
  await click(active,'boardgames_runeversi:boardinv',move.to);
  assert.deepEqual(m.state.board,snapshot);
  await click(active,`boardgames_runeversi:square_${move.to}`);
  assert.equal(m.state.board.filter(Boolean).length,5);
  assert.equal(m.state.board.filter(x=>x===(side===0?1:-1)).length,4);
  assert.equal(m.turns,1);assert.equal(m.state.turn,1-side);
  const after=m.state.board.slice();await click(active,`boardgames_runeversi:square_${move.to}`);
  assert.deepEqual(m.state.board,after);
});

test('Runeversi mandatory pass counts a completed move, resets clock and auto-moves legally', async () => {
  const a=actor(),b=actor(),m=await match(a,b,'runeversi');
  // Controlled near-end fixture, played through the actual native square packet.
  m.state.board.fill(1);m.state.board[0]=m.state.board[56]=0;m.state.board[1]=m.state.board[57]=-1;m.state.turn=0;
  const Screen=require('../plugins/minigames/gamesroom/Interface.GamesRoom');
  for(const p of m.players)Screen.refreshMatch(p,m);
  const cycle=core.World.processCycle;
  try {
    core.World.processCycle=m.deadline-1;
    await click(a,'boardgames_runeversi:square_0');
    assert.equal(m.state.turn,0);assert.equal(m.state.passed,1);assert.equal(m.turns,1);
    const passStatus=core.CacheDefinitions.getComponentId('boardgames_runeversi:status2');
    assert.equal(textValue(received(a),passStatus),'Opponent has no legal move.');
    assert.equal(textValue(received(b),passStatus),'You have no legal move.');
    assert.ok(m.deadline>core.World.getProcessCycle());
    core.World.processCycle=m.deadline-1;Room.areaOf().process(a);assert.equal(m.state.board[56],0);
    core.World.processCycle=m.deadline;Room.areaOf().process(a);assert.equal(m.state.board[56],1);
    assert.equal(m.state.result.winner,0);assert.equal(m.turns,2);assert.equal(Room.matchOf(a),undefined);
  } finally {core.World.processCycle=cycle;}
});

test('Runeversi complete native game updates only its independent persisted rank', async () => {
  const a=actor(),b=actor(),m=await match(a,b,'runeversi');
  for(let n=0;n<61&&!m.finished;n++) {
    const move=Rules.legalMoves(m.state)[0];assert.ok(move);
    await click(m.players[m.state.turn],`boardgames_runeversi:square_${move.to}`);
  }
  assert.equal(m.finished,true);assert.ok(m.turns>=4);
  const balance=m.state.board.reduce((sum,x)=>sum+x,0);
  assert.equal(m.state.result.winner,balance===0?null:balance>0?0:1);
  const {PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave');
  for(const [side,p] of m.players.entries()) {
    const save=PlayerSave.fromPlayer(p);
    assert.equal(save.attributes['games-room:runeversi-rank'],m.state.result.winner==null?undefined:side===m.state.result.winner?1050:950);
    assert.equal(save.attributes['games-room:draughts-rank'],undefined);assert.equal(save.attributes['games-room:runelink-rank'],undefined);
    const ended=received(p);
    assert.equal(textValue(ended,core.CacheDefinitions.getComponentId('boardgames_runeversi:status2')),
      `${m.state.board.filter(p=>p>0).length} vs ${m.state.board.filter(p=>p<0).length}`);
    assert.equal(hiddenValue(ended,core.CacheDefinitions.getComponentId('boardgames_runeversi:close')),0);
    for(let to=0;to<64;to++)assert.equal(flagValue(ended,core.CacheDefinitions.getComponentId(`boardgames_runeversi:square_${to}`)),0);
  }
});

test('Runeversi draw, rematch, resign, modal replacement and logout clean up exactly once', async () => {
  const a=actor(),b=actor();let m=await match(a,b,'runeversi');
  await click(a,'boardgames_runeversi:offer_draw');await click(b,'boardgames_runeversi:offer_draw');
  assert.equal(m.state.result.winner,null);
  for(const p of [a,b]) {assert.equal(p.getAttribute('games-room:runeversi-rank'),undefined);await click(p,'boardgames_runeversi:close');}
  m=await match(a,b,'runeversi');assert.equal(m.state.board.filter(Boolean).length,4);
  await click(a,'boardgames_runeversi:resign');assert.equal(m.state.result.winner,1);
  const next=await match(a,b,'runeversi');
  PM.emitCustomEvent('interface:closed',{player:a,interfaceId:12});assert.equal(Room.matchOf(a),next);
  a.getPacketSender().sendInterface(12);assert.equal(next.state.result.winner,1);a.getPacketSender().sendInterfaceRemoval();
  m=await match(a,b,'runeversi');PM.emitPlayerLogout({player:b,username:b.getUsername()});assert.equal(m.state.result.winner,0);
  assert.equal(Room.matchOf(a),undefined);assert.equal(Room.matchOf(b),undefined);
});

for (const game of ['runelink','runeversi']) test(`native ${game} occupied-table View-game is read-only and viewer Close cannot forfeit either player`, async () => {
  const a=actor(), b=actor(), v=actor();
  a.setDisplayName('Board One'); b.setDisplayName('Board Two');
  const m=await match(a,b,game);
  const table=m.allocation.playingTable, at=table.getLocation();
  v.moveTo(at.clone().transform(0,-1));placementTick();received(v);
  const frame=Buffer.alloc(8);frame[0]=96;
  frame[1]=(at.getX()+128)&255;frame[2]=at.getX()>>>8;
  frame.writeUInt16LE(at.getY(),3);frame[5]=0;
  frame[6]=table.getId()>>>8;frame[7]=(table.getId()+128)&255;
  await wire(v,frame);
  const Viewer=require('../plugins/minigames/gamesroom/Spectator.GamesRoom');
  assert.ok(Viewer.viewOf(v)===m, JSON.stringify({position:v.getLocation(),interface:v.getInterfaceId(),table:table.getId(),decoded:require('../dist/net/protocol/ClientProtocol').decodeClientPackets(frame)}));
  const packets=received(v), uid=name=>core.CacheDefinitions.getComponentId(`boardgames_${game}:${name}`);
  for(const name of ['resign','offer_draw','turn','turn_name','sandtimer'])assert.equal(hiddenValue(packets,uid(name)),1,name);
  assert.equal(hiddenValue(packets,uid('close')),0);
  if (game === 'runelink') for(let column=0;column<7;column++)assert.equal(flagValue(packets,uid(`column${column}`)),0);
  else for(let to=0;to<64;to++)assert.equal(flagValue(packets,uid(`square_${to}`)),0);
  assert.equal(textValue(packets,uid('p1_name')),'Board One');
  assert.equal(textValue(packets,uid('p2_name')),'Board Two');
  const count=m.state.board.filter(Boolean).length, move=Rules.legalMoves(m.state)[0];
  const control=`boardgames_${game}:${game === 'runelink' ? `column${move.column}` : `square_${move.to}`}`;
  await click(v,control);await click(v,`boardgames_${game}:resign`);await click(v,`boardgames_${game}:offer_draw`);
  assert.equal(m.state.board.filter(Boolean).length,count);assert.equal(m.finished,undefined);assert.equal(m.drawOffer,null);
  await click(m.players[m.state.turn],control);
  assert.equal(m.state.board.filter(Boolean).length,count+1);assert.ok(received(v).some(p=>p.id===110));
  await click(v,`boardgames_${game}:close`);
  assert.equal(Viewer.viewOf(v),undefined);assert.equal(Room.matchOf(a),m);assert.equal(Room.matchOf(b),m);
});
