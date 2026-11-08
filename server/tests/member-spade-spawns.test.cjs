const assert=require('node:assert/strict');const {before,test}=require('node:test');
const {Server}=require('../dist/Server');Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');const {CacheDefinitions}=require('../dist/game/cache/CacheDefinitions');
const {World}=require('../dist/game/World');const W=require('../dist/game/definition/WorldDefinition');
const {GroundItemSpawnDefinitionLoader}=require('../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader');
const definitions=require('../data/definitions/ground-items.json');const points=[[1641,3052],[1405,2938]];
before(()=>CachePipeline.initialize(require('node:path').resolve(__dirname,'..')));
test('exact two Spade rows use native identity and explicit member world policy',()=>{
 const item=CacheDefinitions.getItem(952);assert.equal(item.name,'Spade');assert.equal(item.isMembers,false);
 for(const[x,y]of points){const found=definitions.filter(d=>d.id===952&&d.location.x===x&&d.location.y===y&&d.location.z===0);assert.equal(found.length,1);assert.equal(found[0].members,true);assert.equal(found[0].amt,1);assert.equal(found[0].respawn,100);}
 for(const[x,y]of [[1728,3102],[3355,2758],[3338,2751],[3334,2719],[3333,2702],[2592,2291]])assert.ok(!definitions.some(d=>d.id===952&&d.location.x===x&&d.location.y===y),'unselected/scenery Spade tile '+x+','+y);
});
for(const members of [true,false])test('actual member Spade loader boundary: '+members,t=>{
 const items=World.getItems(),old=items.splice(0);t.after(()=>items.splice(0,items.length,...old));t.mock.method(W,'isMembersWorld',()=>members);assert.equal(new GroundItemSpawnDefinitionLoader().load(),true);
 for(const[x,y]of points){const found=items.filter(p=>p.getItem().getId()===952&&p.getPosition().getX()===x&&p.getPosition().getY()===y&&p.getPosition().getZ()===0);assert.equal(found.length,members?1:0);for(const p of found){assert.equal(p.getOwner(),undefined);assert.equal(p.getPrivateArea(),null);assert.equal(p.isStaticSpawn(),true);assert.equal(p.getItem().getAmount(),1);assert.equal(p.getRespawnTimer(),100);}}
 assert.ok(items.some(p=>p.getItem().getId()===952&&p.getPosition().getX()===3120&&p.getPosition().getY()===3359),'legacy F2P Draynor Spade retained');
});
