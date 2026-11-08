
const assert=require("node:assert/strict"),{before,test}=require("node:test"),path=require("node:path");
require("../dist/Server").Server.installProductionPathResolver();
const {CachePipeline}=require("../dist/game/cache/CachePipeline"),{CacheDefinitions}=require("../dist/game/cache/CacheDefinitions");
const {World}=require("../dist/game/World"),WorldDefinition=require("../dist/game/definition/WorldDefinition");
const {GroundItemSpawnDefinitionLoader}=require("../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader");
const spawns=require("../data/definitions/ground-items.json"),points=[[2671,3737],[2672,3738]];
before(()=>CachePipeline.initialize(path.resolve(__dirname,"..")));
test("two island Nature rune definitions use the exact native item/source world flags and200tick timer",()=>{
 assert.equal(CacheDefinitions.getItem(561).name,"Nature rune");assert.equal(CacheDefinitions.getItem(561).isMembers,false);
 for(const[x,y]of points){const r=spawns.filter(r=>r.id===561&&r.location.x===x&&r.location.y===y&&r.location.z===0);assert.equal(r.length,1);assert.deepEqual([r[0].amt,r[0].respawn,r[0].members],[2,200,true]);assert.match(r[0].description,/telekinetic grab/i);}
 assert.equal(spawns.some(r=>r.id===556&&r.location.x===1399&&r.location.y===3158),false,"uncertain Air row remains absent");
});
for(const members of[true,false])test("actual island Nature definitions honor member world="+members,t=>{
 const items=World.getItems(),old=items.splice(0);t.after(()=>items.splice(0,items.length,...old));t.mock.method(WorldDefinition,"isMembersWorld",()=>members);
 assert.equal(new GroundItemSpawnDefinitionLoader().load(),true);
 for(const[x,y]of points){const found=items.filter(g=>g.getItem().getId()===561&&g.getPosition().getX()===x&&g.getPosition().getY()===y&&g.getPosition().getZ()===0);assert.equal(found.length,members?1:0);if(members){assert.equal(found[0].getItem().getAmount(),2);assert.equal(found[0].getRespawnTimer(),200);assert.equal(found[0].isStaticSpawn(),true);}}
});
