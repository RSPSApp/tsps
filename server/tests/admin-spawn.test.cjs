// Native Admin Spawn actions, with synthetic collision and no live players or saves.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const Spawn = require('../plugins/tools/adminpanel/Spawn.AdminPanel');
const Spatial = require('../plugins/commands/Spawns.AdminCommands');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, api;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  require('../plugins/commands/AdminCommands.plugin').register(PluginManager.createApi('AdminCommands'));
  api = PluginManager.createApi('AdminPanel');
});
function fixture(t, clipping = () => 0) {
  const actor = new Player(null).setUsername('SpawnTester').setRights(core.PlayerRights.OWNER);
  actor.setLocation(new core.Location(3200, 3200, 0)); actor.setRegistered(true);
  actor.sendMessage = () => {};
  const sender = new Proxy({}, { get: () => () => sender }); actor.getPacketSender = () => sender;
  t.mock.method(core.World, 'getPlayerByName', name => name === actor.getUsername() ? actor : null);
  t.mock.method(core.World, 'isPlayerSessionConnected', () => false);
  t.mock.method(core.RegionManager, 'getRegion', () => ({}));
  t.mock.method(core.RegionManager, 'getClipping', clipping);
  const items = core.World.getItems(), originalItems = items.slice();
  const npcs = new Set(core.World.getNpcs().stream());
  t.after(() => {
    for (const npc of core.World.getNpcs().stream()) if (!npcs.has(npc)) core.World.getNpcs().remove(npc);
    items.splice(0, items.length, ...originalItems);
  });
  return actor;
}
const key = tile => `${tile.getX()},${tile.getY()},${tile.getZ()}`;
test('Spawn X uses distinct reachable tiles, excludes walls and sealed rooms, and ignores noclip', t => {
  // A continuous wall east of the actor makes the eastern half unreachable.
  const actor = fixture(t, (x, y) => x === 3202 ? 0x100 : y === 3201 && x === 3199 ? 0x100 : 0);
  actor.setAttribute('admin:noclip', true);
  const locations = Spatial.planLocations(core, actor, { size: 1, count: 20, random: true, randomSource: () => 0.4 });
  assert.equal(locations.length, 20); assert.equal(new Set(locations.map(key)).size, 20);
  assert.ok(locations.every(tile => tile.getX() < 3202));
  assert.ok(locations.every(tile => Math.max(Math.abs(tile.getX()-3200), Math.abs(tile.getY()-3200)) <= 10));
  assert.ok(locations.every(tile => !core.RegionManager.blocked(tile, null)));
});
test('under-me placement is exact and big NPC footprints cannot overlap walls or one another', t => {
  const actor = fixture(t, x => x === 3202 ? 0x100 : 0);
  assert.equal(key(Spatial.planLocations(core, actor, { size: 1, count: 1, random: false })[0]), '3200,3200,0');
  assert.throws(() => Spatial.planLocations(core, actor, { size: 3, count: 1, random: false }), /space|blocked|fit/i);
  const locations = Spatial.planLocations(core, actor, { size: 2, count: 10, random: true, randomSource: () => 0.4 });
  const occupied = new Set();
  for (const tile of locations) for (let x=0;x<2;x++) for(let y=0;y<2;y++) {
    const k=`${tile.getX()+x},${tile.getY()+y}`; assert.ok(!occupied.has(k)); occupied.add(k);
    assert.ok(tile.getX()+x < 3202);
  }
});
test('player-blocking NPC barriers constrain placement and diagonal reach like native walking', t=>{
  const actor=fixture(t);
  t.mock.method(core.World,'isPlayerBlockingNpcOnTile',tile=>Math.max(Math.abs(tile.getX()-3200),Math.abs(tile.getY()-3200))===1);
  assert.throws(()=>Spatial.planLocations(core,actor,{size:1,count:2,random:true}),/only 1/);
  assert.throws(()=>Spatial.planLocations(core,actor,{size:2,count:1,random:false}),/clear space/);
});
test('insufficient reachable space rejects the whole batch before spawning', t => {
  const actor = fixture(t, (x,y) => x===3200 && y===3200 ? 0 : 0x100);
  const before = core.World.getItems().length;
  assert.throws(() => Spawn.apply(api, actor, { kind:'item', id:core.ItemIdentifiers.COINS, count:2, random:true }), /only 1|not enough|insufficient/i);
  assert.equal(core.World.getItems().length, before);
});
test('native ground spawns have actor ownership, current instance, one item each and normal lifetime', t => {
  const actor=fixture(t), instance={ isDestroyed:()=>false, getBoundaries:()=>[], groundItemDespawnDelay:()=>null };
  actor.getPrivateArea=()=>instance;
  const result=Spawn.apply(api,actor,{kind:'item',id:core.ItemIdentifiers.COINS,count:4,random:true});
  const items=core.World.getItems(); assert.equal(items.length,4); assert.equal(result.count,4);
  assert.equal(new Set(items.map(item=>key(item.getPosition()))).size,4);
  for(const item of items) {
    assert.equal(item.getOwner(),actor.getUsername()); assert.equal(item.getPrivateArea(),instance);
    assert.equal(item.getItem().getAmount(),1); assert.equal(item.respawns(),false);
    assert.equal(item.getDespawnDelay(),core.ItemOnGroundManager.DESPAWN_DELAY);
  }
});
test('native NPC spawn is actor-only, has no default respawn, retains cap and owned cleanup', t => {
  const actor=fixture(t); const before=new Set(core.World.getNpcs().stream());
  const result=Spawn.apply(api,actor,{kind:'npc',id:core.NpcIdentifiers.GOBLIN,count:3,random:true});
  const spawned=[...core.World.getNpcs().stream()].filter(npc=>!before.has(npc));
  assert.equal(result.count,3); assert.equal(spawned.length,3);
  assert.equal(new Set(spawned.map(npc=>key(npc.getLocation()))).size,3);
  assert.ok(spawned.every(npc=>npc.__skipDefaultRespawn===true));
  assert.equal(Spawn.status(api,actor).spawned,3);
  const clear=Spawn.clearNpcs(api,actor); assert.match(clear.message,/3/);
  assert.ok(spawned.every(npc=>core.World.getRemoveNPCQueue().includes(npc)));
  const queue=core.World.getRemoveNPCQueue(); for(const npc of spawned) { const i=queue.indexOf(npc); if(i>=0)queue.splice(i,1); }
});
test('spawn actions recheck permissions, ids, counts, actor session and instance boundaries', t => {
  const actor=fixture(t);
  assert.deepEqual(Spawn.actions(),['Spawn 1 under me','Spawn X']);
  for(const count of [0,21,1.5,2147483647]) assert.throws(()=>Spawn.apply(api,actor,{kind:'item',id:core.ItemIdentifiers.COINS,count,random:true}),/count|1.*20/i);
  assert.throws(()=>Spawn.apply(api,actor,{kind:'item',id:-1,count:1,random:false}),/item|loaded/i);
  actor.setRights(core.PlayerRights.NONE);
  assert.throws(()=>Spawn.apply(api,actor,{kind:'item',id:core.ItemIdentifiers.COINS,count:1,random:false}),/access|permission|rank/i);
  actor.setRights(core.PlayerRights.OWNER); actor.setRegistered(false);
  assert.throws(()=>Spawn.apply(api,actor,{kind:'item',id:core.ItemIdentifiers.COINS,count:1,random:false}),/offline|session/i);
  actor.setRegistered(true);
  actor.getPrivateArea=()=>({isDestroyed:()=>false,getBoundaries:()=>[{inside:tile=>tile.getX()===3200&&tile.getY()===3200}]});
  assert.throws(()=>Spatial.planLocations(core,actor,{size:1,count:2,random:true}),/only 1|not enough|insufficient/i);
});
test('pictured searches return native NPC and item records with per-kind command permissions', t=>{
  const actor=fixture(t);
  assert.ok(Spawn.search(api,actor,'npc','Goblin').some(row=>row.id===core.NpcIdentifiers.GOBLIN));
  assert.ok(Spawn.search(api,actor,'item','Coins').some(row=>row.id===core.ItemIdentifiers.COINS));
  const original=core.PluginManager.playerHasCommandRights;
  t.mock.method(core.PluginManager,'playerHasCommandRights',(player,command)=>command==='npc'?false:original.call(core.PluginManager,player,command));
  assert.deepEqual(Spawn.search(api,actor,'npc','Goblin'),[]);
  assert.ok(Spawn.search(api,actor,'item','Coins').length>0);
});
test('native planned NPC spawns retain instance membership, 100-spawn cap and logout cleanup', t=>{
  const actor=fixture(t), area=new core.PrivateArea([new core.Boundary(3180,3220,3180,3220,0)]);
  actor.setArea(area);
  for(let i=0;i<5;i++) Spawn.apply(api,actor,{kind:'npc',id:core.NpcIdentifiers.GOBLIN,count:20,random:true});
  assert.equal(Spawn.status(api,actor).spawned,100);
  assert.throws(()=>Spawn.apply(api,actor,{kind:'npc',id:core.NpcIdentifiers.GOBLIN,count:1,random:false}),/100/);
  const owned=[...core.World.getNpcs().stream()].filter(Boolean); assert.equal(owned.length,100);
  assert.ok(owned.every(npc=>npc.getPrivateArea()===area&&area.entities.includes(npc)));
  core.PluginManager.emitPlayerLogout({player:actor,username:actor.getUsername()});
  const queue=core.World.getRemoveNPCQueue(); assert.ok(owned.every(npc=>queue.includes(npc)));
  for(const npc of owned) { const i=queue.indexOf(npc); if(i>=0)queue.splice(i,1); }
});
test('spawn source rejects selected-player placement and ignores untrusted coordinate arrays', t=>{
  const actor=fixture(t), other=new Player(null).setUsername('WrongTarget').setLocation(new core.Location(1000,1000,0));
  const request={actor,player:other,action:'spawn-items',id:core.ItemIdentifiers.COINS,amount:1,placement:'under-actor'};
  api.emitCustomEvent('admin:testing-tools',request); assert.equal(request.handled,undefined); assert.match(request.error,/own live/);
  const safe={...request,player:actor,locations:[new core.Location(1000,1000,0)]};
  api.emitCustomEvent('admin:testing-tools',safe); assert.equal(safe.handled,true);
  assert.equal(key(core.World.getItems().at(-1).getPosition()),key(actor.getLocation()));
});
