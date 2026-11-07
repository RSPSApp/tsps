const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const Access = require('../plugins/minigames/gamesroom/Access.GamesRoom');
let core, next=9100;
test.before(async()=>{
  await CachePipeline.initialize(path.resolve(__dirname,'..'));
  core=PM.getCoreApi();
  core.RegionManager.init();
  require('../plugins/objects/Ladders.plugin').register(PM.createApi('Ladders'));
  require('../plugins/objects/Doors.plugin').register(PM.createApi('Doors'));
  require('../plugins/minigames/gamesroom/Runtime.GamesRoom').attach(PM.createApi('GamesRoom'));
});

function actor(t,at,rank=1000) {
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const player=new Player(new PlayerSession(channel));
  player.setIndex(next++);player.setUsername('gamesaccess'+player.getIndex());
  player.setRegistered(true);player.setLocation(new core.Location(...at));player.needsPlacement=false;
  player.setAttribute('gamesqa:rank',rank);
  player.setAttribute('games-room:draughts-rank',rank);
  player.setAttribute('games-room:runelink-rank',rank);
  const connection=new ClientConnection(channel);connection.player=player;
  const messages=[];
  t.mock.method(player.getPacketSender(),'sendMessage',message=>{messages.push(message);return player.getPacketSender();});
  t.after(()=>{core.TaskManager.cancelTasks(player.getIndex());core.TaskManager.cancelTasks(player);player.setRegistered(false);});
  return {player,connection,messages};
}

function loc(player) {const at=player.getLocation();return [at.getX(),at.getY(),at.getZ()];}
function map(name,x,y,z) {
  core.RegionManager.loadMapFiles(x,y);
  const id=core.CacheDefinitions.getLocId(name);
  const object=core.MapObjects.get(id,new core.Location(x,y,z),null);
  assert.ok(object,`${name} at ${x},${y},${z}`);
  return object;
}
async function click(actor,object) {
  const at=object.getLocation();
  await actor.connection.dispatch([{type:'object_option',id:object.getId(),x:at.getX(),y:at.getY(),clickType:1}]);
  actor.connection.processTurnPackets();
  for(let i=0;i<8;i++) {
    core.TaskManager.processWalkTo(actor.player.getIndex());
    actor.player.getMovementQueue().process();core.TaskManager.process();
  }
}

test('castle staircase enters Games Room through native object input and shared climb task',async t=>{
  const entry=map('board_game_stairs_grey_all',2899,3566,0);
  const a=actor(t,[2899,3565,0]);
  await click(a,entry);
  assert.deepEqual(loc(a.player),[2205,4933,1]);
});
test('Games Room exit staircase returns to castle through native input',async t=>{
  const exit=map('board_game_stairs_grey_base2',2205,4935,1);
  const a=actor(t,[2205,4934,1]);
  await click(a,exit);
  assert.deepEqual(loc(a.player),[2899,3564,0]);
});
test('ordinary internal Games Room stairs keep their shared map-derived transport',async t=>{
  const object=map('board_game_stairs_base',2207,4935,0);
  const a=actor(t,[2207,4938,0]);
  await click(a,object);
  assert.deepEqual(loc(a.player),[2207,4934,1]);
});
for(const [game,x,name] of [['draughts',2199,'boardgames_draughts_ladderup_experienced'],['runelink',2216,'boardgames_runelink_ladderup_experienced']]) {
  test(`${game} ladder refuses1499 and admits1500 through shared native climb`,async t=>{
    const object=map(name,x,4936,0),a=actor(t,[x,4937,0],1499);
    await click(a,object);
    assert.deepEqual(loc(a.player),[x,4937,0]);
    assert.ok(a.messages.some(m=>m.includes('1500')));
    a.player.setAttribute('gamesqa:rank',1500);
    a.player.setAttribute(`games-room:${game}-rank`,1500);
    await click(a,object);
    assert.deepEqual(loc(a.player),[x,4937,1]);
  });
}
for(const [game,x] of [['draughts',2198],['runelink',2217]]) {
  test(`${game} experienced door rejects rank1499 before shared door mutation`,async t=>{
    const object=map(`boardgames_${game}_door_experienced`,x,4943,1);
    const a=actor(t,[x,4944,1],1499);
    await click(a,object);
    assert.ok(a.messages.some(m=>m.includes('1500')));
    assert.equal(core.MapObjects.get(object.getId(),object.getLocation(),null),object);
  });
}
test('room helper distinguishes exact challenge-room rectangles and returns cloned locations',()=>{
  for(const plane of [0,1]) {
    assert.equal(Access.roomGame(new core.Location(2192,4936,plane)),'draughts');
    assert.equal(Access.roomGame(new core.Location(2199,4943,plane)),'draughts');
    assert.equal(Access.roomGame(new core.Location(2216,4936,plane)),'runelink');
    assert.equal(Access.roomGame(new core.Location(2223,4943,plane)),'runelink');
    assert.equal(Access.roomGame(new core.Location(2200,4943,plane)),null);
    const d=Access.gameRoom('draughts',plane),r=Access.gameRoom('runelink',plane);
    assert.deepEqual([d.getX(),d.getY(),d.getZ()],[2196,4940,plane]);
    assert.deepEqual([r.getX(),r.getY(),r.getZ()],[2219,4940,plane]);
    assert.notEqual(Access.gameRoom('draughts',plane),d);
  }
  assert.equal(Access.roomGame(new core.Location(2196,4940,2)),null);
});

for(const [game,x,plane] of [['draughts',2198,1],['runelink',2217,1],['ordinary',2198,0]]) {
  test(`${game} challenge-room door opens and closes through the existing door owner`,async t=>{
    const name=game==='ordinary'?'elfdoor_reverse':`boardgames_${game}_door_experienced`;
    const object=map(name,x,4943,plane),a=actor(t,[x,4944,plane],1500);
    await click(a,object);
    const state={objects:[object]};PM.emitCustomEvent('door:state',state);
    assert.equal(state.objects.length,1);
    const opened=state.objects[0];
    assert.notEqual(opened.getId(),object.getId(),'shared door must actually open');
    assert.ok(opened.getLocation().equals(object.getLocation()),'reverse door opens on its tile');
    await click(a,opened);
    const closed={objects:[object]};PM.emitCustomEvent('door:state',closed);
    assert.equal(closed.objects[0].getId(),object.getId());
  });
}

test('simultaneous doors sharing an open leaf restore their own variants independently',async t=>{
  const fixtures=[];
  for(const [name,x,z] of [['boardgames_draughts_door_experienced',2198,1],
    ['boardgames_runelink_door_experienced',2217,1],['elfdoor_reverse',2198,0]]) {
    const original=map(name,x,4943,z),a=actor(t,[x,4944,z],1500);
    await click(a,original);
    const state={objects:[original]};PM.emitCustomEvent('door:state',state);
    assert.equal(state.objects[0].getId(),core.CacheDefinitions.getLocId('elfdooropen_reverse'));
    fixtures.push({original,a,opened:state.objects[0]});
  }
  for(const {original,a,opened} of fixtures.reverse()) {
    await click(a,opened);
    const restored=core.MapObjects.get(original.getId(),original.getLocation(),null);
    assert.ok(restored);
    assert.equal(restored.getFace(),original.getFace());
    assert.equal(restored.getType(),original.getType());
  }
});

test('same-coordinate shared-open doors in two real private areas retain separate originals',async t=>{
  const {PrivateArea}=require('../dist/game/model/areas/impl/PrivateArea');
  const fixtures=[];
  for(const name of ['boardgames_draughts_door_experienced','elfdoor_reverse']) {
    const area=new PrivateArea(),a=actor(t,[2198,4944,1],1500);
    area.add(a.player);
    const source=map('boardgames_draughts_door_experienced',2198,4943,1);
    const original=new core.GameObject(core.CacheDefinitions.getLocId(name),source.getLocation().clone(),source.getType(),source.getFace(),area);
    core.ObjectManager.register(original,true);
    t.after(()=>area.destroy());
    await click(a,original);
    const opened=area.getObjects().find(object=>object.getId()===core.CacheDefinitions.getLocId('elfdooropen_reverse'));
    assert.ok(opened);
    fixtures.push({a,area,original,opened});
  }
  for(const {a,area,original,opened} of fixtures.reverse()) {
    await click(a,opened);
    assert.equal(area.getObjects().filter(object=>object.getId()===original.getId()).length,1);
    assert.equal(area.getObjects().some(object=>object.getId()===core.CacheDefinitions.getLocId('elfdooropen_reverse')),false);
  }
});

for(const [game,x] of [['draughts',2198],['runelink',2217]]) {
  test(`${game} open gate cannot bypass rank checks on actual area entry or an internal move`,async t=>{
    const {AreaManager}=require('../dist/game/model/areas/AreaManager');
    const object=map(`boardgames_${game}_door_experienced`,x,4943,1);
    const qualified=actor(t,[x,4944,1],1500);
    await click(qualified,object);
    const low=actor(t,[x,4944,1],1499);
    assert.equal(core.RegionManager.blocked(new core.Location(x,4944,1),null),false,'denial destination is walkable in active map');
    AreaManager.process(low.player);
    low.player.moveTo(new core.Location(x,4942,1));
    AreaManager.process(low.player);
    assert.deepEqual(loc(low.player),[x,4944,1]);
    assert.ok(low.messages.some(m=>m.includes('1500')));
    const entering=actor(t,[x,4942,1],1499);
    AreaManager.process(entering.player);
    assert.deepEqual(loc(entering.player),[x,4944,1],'initial area entry also enforces the gate');
    low.player.setAttribute(`games-room:${game}-rank`,1500);
    low.player.setAttribute('gamesqa:rank',1500);
    low.player.moveTo(new core.Location(x,4942,1));
    AreaManager.process(low.player);
    assert.deepEqual(loc(low.player),[x,4942,1]);
    const state={objects:[object]};PM.emitCustomEvent('door:state',state);
    await click(qualified,state.objects[0]);
  });
}

test('Runeversi native ladder and west-facing experienced gate enforce only its independent rank', async t => {
  const ladder = map('boardgames_runeversi_ladderup_experienced',2231,4951,0);
  const a = actor(t,[2230,4951,0],60000);
  a.player.setAttribute('games-room:runeversi-rank',1499);
  await click(a,ladder);
  assert.deepEqual(loc(a.player),[2230,4951,0]);
  assert.ok(a.messages.some(m=>m.includes('Runeversi')&&m.includes('1500')));
  a.player.setAttribute('games-room:runeversi-rank',1500);
  await click(a,ladder);
  assert.equal(a.player.getLocation().getZ(),1);
  const gate = map('boardgames_runeversi_door_experienced',2224,4950,1);
  const low = actor(t,[2223,4950,1],60000);
  low.player.setAttribute('games-room:runeversi-rank',1499);
  await click(low,gate);
  assert.ok(low.messages.some(m=>m.includes('Runeversi')&&m.includes('1500')));
  assert.equal(core.MapObjects.get(gate.getId(),gate.getLocation(),null),gate);
  // Rankless players may always exit toward the west through a closed gate.
  low.player.setLocation(new core.Location(2225,4950,1));low.player.setNeedsPlacement(false);
  await click(low,gate);
  const state={objects:[gate]};PM.emitCustomEvent('door:state',state);
  assert.notEqual(state.objects[0].getId(),gate.getId());
  await click(low,state.objects[0]);
});

test('Runeversi room bounds, return landing and open-gate area entry use the east room', t => {
  const {AreaManager}=require('../dist/game/model/areas/AreaManager');
  for (const z of [0,1]) {
    assert.equal(Access.roomGame(new core.Location(2224,4944,z)),'runeversi');
    assert.equal(Access.roomGame(new core.Location(2231,4951,z)),'runeversi');
    assert.equal(Access.roomGame(new core.Location(2223,4950,z)),null);
    assert.deepEqual(loc({getLocation:()=>Access.gameRoom('runeversi',z)}),[2228,4948,z]);
  }
  const low=actor(t,[2226,4948,1]);low.player.setAttribute('games-room:runeversi-rank',1499);
  AreaManager.process(low.player);
  assert.deepEqual(loc(low.player),[2223,4950,1]);
  low.player.setAttribute('games-room:runeversi-rank',1500);
  low.player.setLocation(new core.Location(2226,4948,1));AreaManager.process(low.player);
  assert.deepEqual(loc(low.player),[2226,4948,1]);
});

test('RuneSquares west-room ladder/door enforce independent rank and eject east',async t=>{
  const up=map('boardgames_runesquares_ladderup_experienced',2184,4951,0);
  const a=actor(t,[2185,4951,0],1499);
  a.player.setAttribute('games-room:runesquares-rank',1499);
  await click(a,up);assert.deepEqual(loc(a.player),[2185,4951,0]);
  assert.ok(a.messages.some(m=>m.includes('1500')));
  a.player.setAttribute('games-room:runesquares-rank',1500);
  await click(a,up);assert.equal(a.player.getLocation().getZ(),1);
  const door=map('boardgames_runesquares_door_experienced',2191,4950,1);
  a.player.setLocation(new core.Location(2192,4950,1));a.player.setNeedsPlacement(false);
  a.player.setAttribute('games-room:runesquares-rank',1499);
  await click(a,door);assert.equal(core.MapObjects.get(door.getId(),door.getLocation(),null),door);
  a.player.setLocation(new core.Location(2188,4948,1));
  assert.equal(Access.enforce(a.player),true);assert.deepEqual(loc(a.player),[2192,4950,1]);
  assert.equal(Access.roomGame(new core.Location(2188,4948,0)),'runesquares');
  assert.deepEqual(loc({getLocation:()=>Access.gameRoom('runesquares',0)}),[2188,4948,0]);
});

test('RuneSquares experienced gate opens as close-only leaf on its own tile and restores the original',async t=>{
  const door=map('boardgames_runesquares_door_experienced',2191,4950,1);
  const a=actor(t,[2192,4950,1],1500);a.player.setAttribute('games-room:runesquares-rank',1500);
  await click(a,door);
  const leaf=core.MapObjects.get(core.ObjectIdentifiers.DOOR_132,new core.Location(2191,4950,1),null);
  assert.ok(leaf,'experienced gate uses the cache close-only open leaf on the original anchor');
  assert.equal(core.MapObjects.get(door.getId(),door.getLocation(),null),null);
  a.player.setLocation(new core.Location(2192,4950,1));a.player.setNeedsPlacement(false);
  await click(a,leaf);
  const restored=core.MapObjects.get(door.getId(),door.getLocation(),null);
  assert.ok(restored);assert.equal(restored.getFace(),door.getFace());
});
