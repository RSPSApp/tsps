const assert = require('node:assert/strict');
const { before, afterEach, test } = require('node:test');
const path = require('node:path');
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const core = PM.getCoreApi();
let room, api, index = 29000;
const actors = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..')); core.RegionManager.init();
  try { room = require('../plugins/minigames/gamesroom/Runtime.GamesRoom'); } catch {}
  if (room) { api = PM.createApi('GamesRoomTest'); room.attach(api); }
});
afterEach(() => { for (const p of actors.splice(0)) room?.leave(p); });
function actor(name) {
  const p = new Player(null, new core.Location(2200,4960,0));
  p.setIndex(index++); p.setUsername(name); p.setRegistered(true); p.setNeedsPlacement(false);
  p.getSession = () => ({ sendClientPacket() {}, write() {}, isConnected: () => true });
  actors.push(p); return p;
}
function present() { assert.ok(room, 'Games Room runtime exists'); }
function option(p,q) {
  for(const actor of actors)actor.resetUpdating();
  return PM.emitPlayerOption({player:p,target:q,option:4,handled:false});
}
function click(p,name,slot=-1) {
  const buttonId=core.CacheDefinitions.getComponentId(name);
  return PM.emitInterfaceActionClick({player:p,buttonId,action:1,opId:1,slot,handled:false});
}
function accept(p,q) { option(p,q); const group=p.getInterfaceId(); if(group===core.CacheDefinitions.getInterfaceId('boardgames_runelink_options'))click(p,'boardgames_runelink_options:challenge');else if(group===core.CacheDefinitions.getInterfaceId('boardgames_draughts_options'))click(p,'boardgames_draughts_options:challenge'); }
function invite(a,b,game='runelink') {
  option(a,b);
  if(a.getInterfaceId()===core.CacheDefinitions.getInterfaceId('boardgames_challenge')) {
    click(a,`boardgames_challenge:${game}`);click(a,'boardgames_challenge:select');
  }
  click(a,`boardgames_${game}_options:challenge`);
  return room.invitation(a,b);
}
test('native challenge selection and reciprocal acceptance create one shared match', () => {
  present(); const a=actor('room-a'), b=actor('room-b');
  assert.ok(invite(a,b)); accept(b,a);
  assert.ok(room.matchOf(a)); assert.equal(room.matchOf(a),room.matchOf(b));
  assert.equal(room.matchOf(a).game,'runelink');
});
test('older pair-specific invitations remain valid after another challenger', () => {
  present(); const a=actor('room-a'), b=actor('room-b'), c=actor('room-c');
  invite(a,b); invite(c,b); accept(b,a);
  assert.equal(room.matchOf(a),room.matchOf(b)); assert.equal(room.matchOf(c),undefined);
  assert.equal(room.invitation(c,b),undefined);
});
test('native columns reject wrong turns and isolate concurrent matches', () => {
  present(); const [a,b,c,d]=['a','b','c','d'].map(n=>actor(`room-${n}`));
  invite(a,b); accept(b,a); invite(c,d); accept(d,c);
  const m=room.matchOf(a), other=room.matchOf(c); const turn=m.players[m.state.turn];
  const waiting=m.players[1-m.state.turn];
  click(waiting,'boardgames_runelink:column0'); assert.equal(m.state.board.filter(Boolean).length,0);
  click(turn,'boardgames_runelink:column0'); assert.equal(m.state.board.filter(Boolean).length,1);
  assert.equal(other.state.board.filter(Boolean).length,0);
});
test('replacement, leave and stale close resolve a match once and preserve later matches', () => {
  present(); const a=actor('room-a'),b=actor('room-b'); invite(a,b); accept(b,a);
  const old=room.matchOf(a); a.getPacketSender().sendInterface(12);
  assert.ok(old.state.result); assert.equal(room.matchOf(b),undefined); a.getPacketSender().sendInterfaceRemoval();
  invite(a,b); accept(b,a); const next=room.matchOf(a); assert.ok(next);
  PM.emitCustomEvent('interface:closed',{player:a,interfaceId:12});
  assert.equal(room.matchOf(a),next); room.leave(a); assert.equal(room.matchOf(b),undefined);
});
test('leaving cancels invitations and stale acceptance cannot start a match', () => {
  present(); const a=actor('room-a'),b=actor('room-b'); invite(a,b); room.leave(a); accept(b,a);
  assert.equal(room.matchOf(a),undefined);
});
test('the player who leaves their position loses even when their opponent processes first', () => {
  present(); const a=actor('room-a'),b=actor('room-b');invite(a,b);accept(b,a);
  const m=room.matchOf(a);a.moveTo(new core.Location(2230,4960,0));room.areaOf().process(b);
  assert.equal(m.state.result.winner,1);
});
test('ranked victory changes only that game rank and can be saved with real PlayerSave', () => {
  present();const a=actor('room-a'),b=actor('room-b');invite(a,b);accept(b,a);
  const m=room.matchOf(a),first=m.state.turn;
  for(let i=0;i<7;i++)click(m.players[m.state.turn],`boardgames_runelink:column${m.state.turn===first?0:1}`);
  assert.equal(m.state.result.winner,first);
  assert.equal(m.players[first].getAttribute('games-room:runelink-rank'),1050);
  assert.equal(m.players[1-first].getAttribute('games-room:runelink-rank'),950);
  const {PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave');
  assert.equal(PlayerSave.fromPlayer(m.players[first]).attributes['games-room:runelink-rank'],1050);
  assert.equal(PlayerSave.fromPlayer(m.players[first]).attributes['games-room:draughts-rank'],undefined);
});
test('mutual draw leaves ranks unchanged and old draw offers expire after a move', () => {
  present();const a=actor('room-a'),b=actor('room-b');invite(a,b);accept(b,a);const m=room.matchOf(a);
  click(a,'boardgames_runelink:offer_draw');click(m.players[m.state.turn],'boardgames_runelink:column0');
  assert.equal(m.drawOffer,null);click(b,'boardgames_runelink:offer_draw');assert.equal(m.state.result,null);
  click(a,'boardgames_runelink:offer_draw');assert.equal(m.state.result.winner,null);
  assert.equal((a.getAttribute('games-room:runelink-rank')??1000),1000);
});
test('busy targets cannot have unrelated interfaces replaced by a retained invitation', () => {
  present();const a=actor('room-a'),b=actor('room-b');invite(a,b);b.getPacketSender().sendInterface(12);accept(b,a);
  assert.equal(room.matchOf(a),undefined);assert.equal(b.getInterfaceId(),12);
});
test('expired move timer performs a legal move, preserving the match and ranks', () => {
  present();const a=actor('room-a'),b=actor('room-b');invite(a,b);accept(b,a);const m=room.matchOf(a);
  const previous=core.World.processCycle;
  try {core.World.processCycle=m.deadline;room.areaOf().process(m.players[m.state.turn]);}
  finally {core.World.processCycle=previous;}
  assert.equal(m.state.board.filter(Boolean).length,1);assert.equal(m.state.result,null);assert.equal(room.matchOf(a),m);
  assert.equal(a.getAttribute('games-room:runelink-rank'),undefined);
});
test('normal castle-entry lobby on plane one allocates ordinary ground-floor tables', () => {
  present();const a=actor('room-a'),b=actor('room-b');
  a.moveTo(new core.Location(2205,4933,1));b.moveTo(new core.Location(2206,4933,1));
  invite(a,b);accept(b,a);const m=room.matchOf(a);assert.ok(m);
  assert.equal(m.seats[0].getZ(),0);assert.equal(m.seats[1].getZ(),0);
});
test('retained challenges cannot interrupt a real trading status or pending placement', () => {
  present();const a=actor('room-a'),b=actor('room-b');invite(a,b);
  b.setStatus(core.PlayerStatus.TRADING);
  PM.emitPlayerOption({player:b,target:a,option:4,handled:false});
  assert.equal(b.getInterfaceId(),-1);assert.equal(room.matchOf(a),undefined);
  b.setStatus(core.PlayerStatus.NONE);b.setNeedsPlacement(true);
  PM.emitPlayerOption({player:b,target:a,option:4,handled:false});
  assert.equal(b.getInterfaceId(),-1);assert.equal(room.matchOf(a),undefined);
});
// Wiki (Burthorpe Games Room): "at the end of each game, the player is placed in a room in which they can only challenge
// their opponent" to another match of the previous game.
test('after a game, the post-game room lets each player challenge only their previous opponent', () => {
  present();const a=actor('room-a'),b=actor('room-b'),c=actor('room-c');invite(a,b);accept(b,a);
  const m=room.matchOf(a),first=m.state.turn;
  for(let i=0;i<7;i++)click(m.players[m.state.turn],`boardgames_runelink:column${m.state.turn===first?0:1}`);
  assert.ok(m.state.result);
  const postGame=a.getLocation();
  assert.equal(b.getLocation().equals(postGame),true,'both in the Runelink room');
  c.moveTo(postGame.clone());
  for(const p of [a,b])p.getPacketSender().sendInterfaceRemoval();
  const said=[];a.sendMessage=text=>said.push(text);
  assert.equal(invite(a,c),undefined,'a stranger in the room cannot be challenged');
  assert.ok(said.includes('That player is unavailable for a game.'));
  assert.equal(invite(c,a),undefined,'nor challenge someone back from the room');
  assert.ok(invite(b,a),'the previous opponent can');accept(a,b);
  assert.ok(room.matchOf(a));assert.equal(room.matchOf(a),room.matchOf(b));assert.equal(room.matchOf(a).game,'runelink');
});
test('a challenge in the lobby is not limited to a previous opponent', () => {
  present();const a=actor('room-a'),b=actor('room-b'),c=actor('room-c');invite(a,b);accept(b,a);
  room.leave(b);for(const p of [a,b,c])p.moveTo(new core.Location(2200,4960,0));a.getPacketSender().sendInterfaceRemoval();
  assert.ok(invite(a,c));
});
