const assert=require('node:assert/strict');
const {before,test}=require('node:test');
const path=require('node:path');
const {Server}=require('../dist/Server');Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {CacheDefinitions}=require('../dist/game/cache/CacheDefinitions');
const {World}=require('../dist/game/World');
const WorldDefinition=require('../dist/game/definition/WorldDefinition');
const {GroundItemSpawnDefinitionLoader}=require('../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader');
const definitions=require('../data/definitions/ground-items.json');
const points=[[3258,2481],[3257,2477],[3259,2469],[3261,2458],[3260,2451],[3256,2449],[3261,2444],[3258,2437],[3262,2435]];
before(()=>CachePipeline.initialize(path.resolve(__dirname,'..')));
test('only the nine audited eastern Sea shell tiles are global definitions',()=>{
 assert.equal(CacheDefinitions.getItem(31395).name,'Sea shell');
 assert.equal(CacheDefinitions.getItem(31395).isMembers,true);
 const shells=definitions.filter(d=>d.id===31395);assert.equal(shells.length,9);
 assert.deepEqual(shells.map(d=>[d.location.x,d.location.y]),points);
 for(const d of shells){assert.equal(d.members,true);assert.equal(d.amt,1);assert.equal(d.respawn,50);assert.equal(d.location.z,0);}
});
for(const members of [true,false])test('actual loader keeps eastern shells in member worlds only: '+members,t=>{
 const items=World.getItems(),previous=items.splice(0);t.after(()=>items.splice(0,items.length,...previous));
 t.mock.method(WorldDefinition,'isMembersWorld',()=>members);
 assert.equal(new GroundItemSpawnDefinitionLoader().load(),true);
 const shells=items.filter(p=>p.getItem().getId()===31395);assert.equal(shells.length,members?9:0);
 for(const p of shells){assert.equal(p.getOwner(),undefined);assert.equal(p.getPrivateArea(),null);assert.equal(p.isStaticSpawn(),true);assert.equal(p.getItem().getAmount(),1);assert.equal(p.getRespawnTimer(),50);}
 for(const[x,y]of [[3161,2389],[3168,2388],[3179,2384],[3191,2383],[3190,2379],[3197,2376],[3201,2374],[3170,2537],[3300,2320]])assert.ok(!shells.some(p=>p.getPosition().getX()===x&&p.getPosition().getY()===y),'held/quest-owned tile remains absent');
});
