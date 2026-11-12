const assert=require('node:assert/strict');const {before,test}=require('node:test');
const {Server}=require('../dist/Server');Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');const {CacheDefinitions}=require('../dist/game/cache/CacheDefinitions');
const {World}=require('../dist/game/World');const W=require('../dist/game/definition/WorldDefinition');
const {GroundItemSpawnDefinitionLoader}=require('../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader');
const definitions=require('../data/definitions/ground-items.json');
const expected=[[2347,'Hammer',1373,2949],[1755,'Chisel',1657,3142],[590,'Tinderbox',1625,3287]];
before(()=>CachePipeline.initialize(require('node:path').resolve(__dirname,'..')));
test('exact audited common tools have active cache identity and source world/timing state',()=>{
 for(const[id,name,x,y]of expected){assert.equal(CacheDefinitions.getItem(id).name,name);assert.equal(CacheDefinitions.getItem(id).isMembers,false);const found=definitions.filter(d=>d.id===id&&d.location.x===x&&d.location.y===y&&d.location.z===0);assert.equal(found.length,1);assert.equal(found[0].amt,1);assert.equal(found[0].respawn,100);assert.equal(found[0].members,true);}
 assert.equal(definitions.find(d=>d.id===590&&d.location.x===2431&&d.location.y===3072).respawn,2,'existing Castle Wars lifecycle preserved');
 assert.ok(!definitions.some(d=>d.id===2347&&d.location.x===1207&&d.location.y===3108),'Scrambled Egg owner hammer not globalized');
 assert.ok(!definitions.some(d=>d.id===1755&&d.location.x===2407&&d.location.y===5645),'GOTR scenery not imported');
});
for(const members of [true,false])test('actual loader gates common tool rows by world, independently of F2P item flag: '+members,t=>{
 const items=World.getItems(),old=items.splice(0);t.after(()=>items.splice(0,items.length,...old));t.mock.method(W,'isMembersWorld',()=>members);assert.equal(new GroundItemSpawnDefinitionLoader().load(),true);
 for(const[id,name,x,y]of expected){const found=items.filter(p=>p.getItem().getId()===id&&p.getPosition().getX()===x&&p.getPosition().getY()===y&&p.getPosition().getZ()===0);assert.equal(found.length,members?1:0);for(const p of found){assert.equal(p.isStaticSpawn(),true);assert.equal(p.getRespawnTimer(),100);assert.equal(p.getItem().getAmount(),1);assert.equal(p.getOwner(),undefined);assert.equal(p.getPrivateArea(),null);}}
 assert.ok(items.some(p=>p.getItem().getId()===2347&&p.getPosition().getX()===2934&&p.getPosition().getY()===3286),'legacy F2P hammer retained');
});
