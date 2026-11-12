const assert = require('node:assert/strict');
const { before, afterEach, test } = require('node:test');
const path = require('node:path');
process.env.DISABLE_PLAYER_BOTS='1';
require('../dist/Server').Server.installProductionPathResolver();
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {Player}=require('../dist/game/entity/impl/player/Player');
const core=PM.getCoreApi(), actors=[];
let room, viewers, next=30000;
before(async()=>{
 await CachePipeline.initialize(path.resolve(__dirname,'..'));core.RegionManager.init();
 room=require('../plugins/minigames/gamesroom/Runtime.GamesRoom');
 room.attach(PM.createApi('GamesRoomSpectatorTest'));
 try {viewers=require('../plugins/minigames/gamesroom/Spectator.GamesRoom');} catch {}
});
afterEach(()=>{for(const p of actors.splice(0))room.leave(p);});
function actor(name){const p=new Player(null,new core.Location(2200,4960,0));p.setIndex(next++);p.setUsername(name);p.setDisplayName(`Display ${name}`);p.setRegistered(true);p.setNeedsPlacement(false);p.getSession=()=>({sendClientPacket(){},write(){},isConnected:()=>true});actors.push(p);return p;}
function click(p,name,slot=-1){PM.emitInterfaceActionClick({player:p,buttonId:core.CacheDefinitions.getComponentId(name),opId:1,action:1,slot,handled:false});}
function option(p,q){for(const a of actors)a.resetUpdating();PM.emitPlayerOption({player:p,target:q,option:4,handled:false});}
function start(game='runelink'){const a=actor('a'),b=actor('b');option(a,b);click(a,`boardgames_challenge:${game}`);click(a,'boardgames_challenge:select');click(a,`boardgames_${game}_options:challenge`);option(b,a);click(b,`boardgames_${game}_options:challenge`);const m=room.matchOf(a);assert.ok(m);return m;}
function table(m){return core.MapObjects.get(core.CacheDefinitions.getLocId(`boardgames_table_${m.game}`),m.allocation.table.getLocation(),null);}
function watch(m,p=actor('viewer')){const obj=table(m);p.moveTo(obj.getLocation().clone().transform(0,-1,0));p.setNeedsPlacement(false);p.resetUpdating();PM.emitObjectInteraction({player:p,object:obj,definition:core.ObjectDefinition.forId(obj.getId()),clickType:1,option:'view-game',handled:false});return p;}
function viewOf(p){assert.ok(viewers,'spectator state owner exists');return viewers.viewOf(p);}
test('real occupied table opens third-player read-only native board and preserves seats',()=>{const m=start(),v=watch(m);assert.equal(viewOf(v),m);assert.equal(room.matchOf(v),undefined);assert.equal(v.getInterfaceId(),core.CacheDefinitions.getInterfaceId('boardgames_runelink'));assert.ok(m.players.every((p,i)=>p.getLocation().equals(m.seats[i])));});
test('spectator forged board, resign, draw and option actions cannot mutate a match or ranks',()=>{for(const game of ['runelink','draughts','runeversi']){const m=start(game),v=watch(m),before=JSON.stringify(m.state);for(const name of ['resign','offer_draw',game==='runelink'?'column0':game==='runeversi'?'square_19':'boardinv'])click(v,`boardgames_${game}:${name}`,0);click(v,`boardgames_${game}_options:challenge`);assert.equal(JSON.stringify(m.state),before);assert.equal(m.drawOffer,null);assert.equal(viewOf(v),m);assert.equal(v.getAttribute(`games-room:${game}-rank`),undefined);}});
test('viewer Close and modal replacement leave both players active',()=>{const m=start(),v=watch(m);click(v,'boardgames_runelink:close');assert.equal(viewOf(v),undefined);assert.equal(room.matchOf(m.players[0]),m);assert.equal(m.state.result,null);watch(m,v);v.getPacketSender().sendInterface(12);assert.equal(viewOf(v),undefined);assert.equal(room.matchOf(m.players[1]),m);});
test('viewer leaving and logout clean only viewer state',()=>{const m=start(),v=watch(m);room.leave(v);assert.equal(viewOf(v),undefined);assert.equal(room.matchOf(m.players[0]),m);watch(m,v);PM.emitPlayerLogout({player:v,username:v.getUsername()});assert.equal(viewOf(v),undefined);assert.equal(m.finished,undefined);});
test('moves refresh all viewers; viewer state is detached from player selection',()=>{const m=start(),v=watch(m),w=watch(m,actor('second'));const writes=[];const original=v.getPacketSender().sendInterfaceScript.bind(v.getPacketSender());v.getPacketSender().sendInterfaceScript=(id,args,...rest)=>{writes.push([id,args]);return original(id,args,...rest);};click(m.players[m.state.turn],'boardgames_runelink:column0');assert.equal(m.state.board.filter(Boolean).length,1);assert.ok(writes.some(([id])=>id===719));assert.equal(viewOf(v),m);assert.equal(viewOf(w),m);});
test('result remains read-only and table reuse cannot retarget old viewers',()=>{const m=start(),v=watch(m),first=m.state.turn;for(let i=0;i<7;i++)click(m.players[m.state.turn],`boardgames_runelink:column${m.state.turn===first?0:1}`);assert.equal(m.finished,true);assert.equal(viewOf(v),m);click(v,'boardgames_runelink:column2');assert.equal(m.state.board.filter(Boolean).length,7);click(v,'boardgames_runelink:close');assert.equal(viewOf(v),undefined);assert.equal(m.players[first].getAttribute('games-room:runelink-rank'),1050);});
test('players and busy viewers cannot seize an occupied seat or replace unrelated modals',()=>{const m=start();watch(m,m.players[0]);assert.equal(viewOf(m.players[0]),undefined);const v=actor('busy');v.getPacketSender().sendInterface(12);watch(m,v);assert.equal(viewOf(v),undefined);assert.equal(v.getInterfaceId(),12);});



test('moving a viewer removes only its view; a restored empty table cannot retain viewers',()=>{
 const m=start(),v=watch(m);v.moveTo(v.getLocation().clone().transform(0,-1));room.areaOf().process(v);
 assert.equal(viewOf(v),undefined);assert.equal(room.matchOf(m.players[0]),m);
 const occupied=table(m);room.leave(m.players[0]);v.setNeedsPlacement(false);
 PM.emitObjectInteraction({player:v,object:occupied,definition:core.ObjectDefinition.forId(occupied.getId()),clickType:1,option:'view-game',handled:false});
 assert.equal(viewOf(v),undefined);
});
