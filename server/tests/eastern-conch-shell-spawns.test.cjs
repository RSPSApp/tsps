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
test('the nine eastern Sea shell tiles keep their source state; every shell is a members spawn',()=>{
 assert.equal(CacheDefinitions.getItem(31395).name,'Sea shell');
 assert.equal(CacheDefinitions.getItem(31395).isMembers,true);
 const shells=definitions.filter(d=>d.id===31395);
 assert.ok(shells.every(d=>d.members===true&&d.amt===1&&d.respawn===50),'every Sea shell spawn is a members spawn on the Wiki 50-tick timer');
 for(const[x,y]of points)assert.equal(shells.filter(d=>d.location.x===x&&d.location.y===y&&d.location.z===0).length,1,'eastern shell '+x+','+y);
});
for(const members of [true,false])test('actual loader keeps eastern shells in member worlds only: '+members,t=>{
 const items=World.getItems(),previous=items.splice(0);t.after(()=>items.splice(0,items.length,...previous));
 t.mock.method(WorldDefinition,'isMembersWorld',()=>members);
 assert.equal(new GroundItemSpawnDefinitionLoader().load(),true);
 const shells=items.filter(p=>p.getItem().getId()===31395);for(const[x,y]of points)assert.equal(shells.filter(p=>p.getPosition().getX()===x&&p.getPosition().getY()===y).length,members?1:0);
 if(!members)assert.equal(shells.length,0);
 for(const p of shells){assert.equal(p.getOwner(),undefined);assert.equal(p.getPrivateArea(),null);assert.equal(p.isStaticSpawn(),true);assert.equal(p.getItem().getAmount(),1);assert.equal(p.getRespawnTimer(),50);}
 // Troubled Tortugans owns these as stage materials; other Wiki shell rows (Summer Shore, Cape Conch) are ordinary spawns.
 for(const[x,y]of [[3161,2389],[3168,2388],[3179,2384],[3191,2383],[3190,2379],[3197,2376]])assert.ok(!shells.some(p=>p.getPosition().getX()===x&&p.getPosition().getY()===y),'quest-owned tile remains absent');
});
