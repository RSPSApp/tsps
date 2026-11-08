
const assert=require("node:assert/strict"),{before,test}=require("node:test"),path=require("node:path");
require("../dist/Server").Server.installProductionPathResolver();
const {CachePipeline}=require("../dist/game/cache/CachePipeline"),{CacheDefinitions}=require("../dist/game/cache/CacheDefinitions");
const {World}=require("../dist/game/World"),WD=require("../dist/game/definition/WorldDefinition");
const {GroundItemSpawnDefinitionLoader}=require("../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader");
const rows=require("../data/definitions/ground-items.json"),expected=[[1925,1667,3124],[1925,1644,3093],[1931,1666,3124]];
before(()=>CachePipeline.initialize(path.resolve(__dirname,"..")));
test("Civitas empty-container IDs/source rows retain quantity, plane, timer and explicit world membership",()=>{
 for(const[id,x,y]of expected){assert.equal(CacheDefinitions.getItem(id).name,id===1925?"Bucket":"Pot");assert.equal(CacheDefinitions.getItem(id).isMembers,false);const found=rows.filter(r=>r.id===id&&r.location.x===x&&r.location.y===y&&r.location.z===0);assert.equal(found.length,1);assert.deepEqual([found[0].amt,found[0].respawn,found[0].members],[1,100,true]);}
});
for(const members of[true,false])test("actual Civitas definitions load only on the source world: "+members,t=>{
 const items=World.getItems(),old=items.splice(0);t.after(()=>items.splice(0,items.length,...old));t.mock.method(WD,"isMembersWorld",()=>members);assert.equal(new GroundItemSpawnDefinitionLoader().load(),true);
 for(const[id,x,y]of expected){const found=items.filter(g=>g.getItem().getId()===id&&g.getPosition().getX()===x&&g.getPosition().getY()===y&&g.getPosition().getZ()===0);assert.equal(found.length,members?1:0);if(members){assert.equal(found[0].getItem().getAmount(),1);assert.equal(found[0].getRespawnTimer(),100);assert.equal(found[0].isStaticSpawn(),true);}}
});

const outerFortis=[[233,1667,3068,"Pestle and mortar",true],[227,1668,3068,"Vial of water",false]];
test("Outer Fortis Herblore table has both exact ordinary IDs with source timing/world state",()=>{
 for(const[id,x,y,name,members]of outerFortis){assert.equal(CacheDefinitions.getItem(id).name,name);assert.equal(CacheDefinitions.getItem(id).isMembers,members);const found=rows.filter(r=>r.id===id&&r.location.x===x&&r.location.y===y&&r.location.z===0);assert.equal(found.length,1);assert.deepEqual([found[0].amt,found[0].respawn,found[0].members],[1,100,true]);}
});
for(const members of[true,false])test("Outer Fortis table source membership loads independently of item membership: "+members,t=>{
 const items=World.getItems(),old=items.splice(0);t.after(()=>items.splice(0,items.length,...old));t.mock.method(WD,"isMembersWorld",()=>members);assert.equal(new GroundItemSpawnDefinitionLoader().load(),true);
 for(const[id,x,y]of outerFortis){const found=items.filter(g=>g.getItem().getId()===id&&g.getPosition().getX()===x&&g.getPosition().getY()===y&&g.getPosition().getZ()===0);assert.equal(found.length,members?1:0);if(members){assert.equal(found[0].getItem().getAmount(),1);assert.equal(found[0].getRespawnTimer(),100);assert.equal(found[0].isStaticSpawn(),true);}}
});
