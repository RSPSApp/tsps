// Run after yarn build: node --test tests/ordinary-rune-spawns.test.cjs
// Independently listed Wiki ItemSpawnLine F2P rune tiles; raw item-infobox timers are ticks.
// F2P baseline remains separate from the independently audited member rows below.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const spawns = require("../data/definitions/ground-items.json");
before(() => CachePipeline.initialize(path.resolve(__dirname, "..")));
const EXPECTED = [
  [556,3150,3247,1,100],[556,2938,3158,1,100],[556,3030,3637,5,100],
  [559,3226,9910,1,100],
  [557,3195,3515,1,100],[557,3032,3637,5,100],[557,3185,9888,6,100],
  [554,3026,3637,5,100],[554,3304,3311,3,100],
  [554,2842,9552,1,100],[554,2836,9566,1,100],[554,2843,9560,1,100],
  [554,2838,9552,1,100],[554,2833,9561,1,100],
  [558,3206,3208,1,100],[558,3023,3640,5,100],[558,3224,9910,1,100],[558,3283,3728,6,100],
  [561,3311,3853,3,200],[561,3307,3859,4,200],
  [555,3298,3316,4,100],[555,3028,3637,5,100],[555,2960,3899,5,100],
];
test("audited ordinary F2P rune spawns use real cache IDs, exact tiles, quantities and timers", () => {
  const runeIds = new Set(EXPECTED.map(row => row[0]));
  assert.equal(spawns.filter(row => runeIds.has(row.id) && row.members !== true).length, EXPECTED.length, "this audited batch is exactly23 rune spawns");
  for (const [id,x,y,amount,respawn] of EXPECTED) {
    assert.match(CacheDefinitions.getItem(id)?.name ?? "", /rune$/);
    const found = spawns.filter(s => s.id === id && s.location.x === x && s.location.y === y && s.location.z === 0);
    assert.equal(found.length,1,"exact spawn "+id+"@"+x+","+y+",0");
    assert.equal(found[0].amt,amount);
    assert.equal(found[0].respawn,respawn);
  }
});

test("audited ordinary shears and crossbow tiles retain source quantity, plane and timer", () => {
  const expected = [
    [837,3174,3663,0,1,500],[837,3284,3719,0,1,500],
    [1735,3152,3306,0,1,100],[1735,3126,3356,0,1,100],[1735,2930,3285,1,1,100],
  ];
  for (const [id,x,y,z,amount,respawn] of expected) {
    assert.equal(CacheDefinitions.getItem(id)?.name,id===837?"Crossbow":"Shears");
    const found=spawns.filter(row=>row.id===id&&row.location.x===x&&row.location.y===y&&row.location.z===z);
    assert.equal(found.length,1,"exact tool spawn "+id+"@"+x+","+y+","+z);
    assert.equal(found[0].amt,amount);assert.equal(found[0].respawn,respawn);
  }
});

const MEMBER_RUNES=[
 [554,2768,3500,1,100,2],[554,1450,10099,0,100,1],[554,1421,10096,0,100,1],
 [554,1419,10062,0,100,1],[554,1454,10063,0,100,1],
 [557,1394,3116,0,100,4],[557,1385,3119,0,100,4],
 [558,1392,3118,0,100,2],[558,1399,3123,0,100,2],[558,1388,3110,0,100,2],
];
const MEMBER_TOOLS=[
 [837,1512,3423,0,500],[1735,1653,3571,0,100],[1735,1776,3654,0,100],
];
test("audited member tool rows preserve cache identity, exact quantity/timer and source membership",()=>{
 for(const[id,x,y,z,timer]of MEMBER_TOOLS){
  const found=spawns.filter(s=>s.id===id&&s.location.x===x&&s.location.y===y&&s.location.z===z);
  assert.equal(found.length,1,"member tool "+id+"@"+x+","+y+","+z);
  assert.equal(found[0].members,true);assert.equal(found[0].amt,1);assert.equal(found[0].respawn,timer);
  assert.equal(CacheDefinitions.getItem(id).name,id===837?"Crossbow":"Shears");
  assert.equal(CacheDefinitions.getItem(id).isMembers,false,"world membership is the source row's, not the item's flag");
 }
});
for(const membersWorld of[true,false])test("actual audited member definitions load only in the correct world: "+membersWorld,t=>{
 const WorldDefinition=require("../dist/game/definition/WorldDefinition");
 const {World}=require("../dist/game/World");
 const {GroundItemSpawnDefinitionLoader}=require("../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader");
 const items=World.getItems(),previous=items.splice(0);t.after(()=>items.splice(0,items.length,...previous));
 t.mock.method(WorldDefinition,"isMembersWorld",()=>membersWorld);
 assert.equal(new GroundItemSpawnDefinitionLoader().load(),true);
 for(const[id,x,y,z,timer,amount]of[...MEMBER_TOOLS.map(r=>[...r,1]),...MEMBER_RUNES]){
  const found=items.filter(p=>p.getItem().getId()===id&&p.getPosition().getX()===x&&p.getPosition().getY()===y&&p.getPosition().getZ()===z);
  assert.equal(found.length,membersWorld?1:0,"exact member source world gate "+id+"@"+x+","+y);
  if(membersWorld){assert.equal(found[0].getRespawnTimer(),timer);assert.equal(found[0].getItem().getAmount(),amount);assert.equal(found[0].isStaticSpawn(),true);}
 }
 assert.ok(items.some(p=>p.getItem().getId()===1735&&p.getPosition().getX()===3152&&p.getPosition().getY()===3306),"existing F2P shears retained");
});

test("ten audited member rune definitions use exact native IDs/tiles/amounts without adding the held Air row",()=>{
 for(const[id,x,y,z,timer,amount]of MEMBER_RUNES){
  const found=spawns.filter(s=>s.id===id&&s.location.x===x&&s.location.y===y&&s.location.z===z);
  assert.equal(found.length,1,"member rune "+id+"@"+x+","+y);
  assert.equal(found[0].members,true);assert.equal(found[0].amt,amount);assert.equal(found[0].respawn,timer);
  assert.equal(CacheDefinitions.getItem(id).name,id===554?"Fire rune":id===557?"Earth rune":"Mind rune");
 }
 assert.equal(spawns.some(s=>s.id===556&&s.location.x===1399&&s.location.y===3158&&s.location.z===0),false);
 assert.equal(spawns.filter(s=>[556,557,558,554,561].includes(s.id)&&s.members===true).length,10,"no Air/Nature member scope expansion");
});
