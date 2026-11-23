import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importSpawns } from "../scripts/import-osrs-ground-spawns.mjs";
const row = (extra={}) => ({page:"Fire rune",id:554,x:3304,y:3311,plane:0,members:false,
  quantity:3,infobox_respawn_ticks:100,tile_respawn_raw:null,location:"[[Al Kharid mine]]",
  unresolved_reasons:[],...extra});
const source=(rows)=>({schema:1,input_sha256:"f".repeat(64),rows});

test("adds exact ordinary spawn and preserves all legacy state/order",()=>{
 const legacy=[{id:995,location:{x:3000,y:3000,z:0},amt:5,respawn:45,extra:"untouched"}];
 const result=importSpawns(source([row()]),legacy);
 assert.deepEqual(result.definitions[0],legacy[0]);assert.equal(legacy.length,1);
 assert.deepEqual(result.definitions[1].location,{x:3304,y:3311,z:0});
 assert.equal(result.definitions[1].amt,3);assert.equal(result.definitions[1].respawn,100);
 assert.equal(result.report.counts.added,1);
 assert.deepEqual(importSpawns(source([row()]),result.definitions).definitions,result.definitions);
});
test("deduplicates exact source rows, not neighboring tiles",()=>{
 const result=importSpawns(source([row(),row(),row({x:3305})]),[]);
 assert.equal(result.definitions.length,2);
 assert.equal(result.report.counts["duplicate-source-exact"],1);
});
test("a single legacy entry on the exact tile takes the source amount, timer and membership, never a second stack",()=>{
 const old={id:554,location:{x:3304,y:3311,z:0},amt:1,respawn:0,description:"UNDIFINED",extra:"kept"};
 const result=importSpawns(source([row({members:true})]),[old]);
 assert.deepEqual(result.definitions,[{id:554,location:{x:3304,y:3311,z:0},amt:3,respawn:100,members:true,description:"UNDIFINED",extra:"kept"}]);
 assert.equal(result.report.counts["existing-source-state-reconciled"],1);
 assert.deepEqual(result.report.rows[0].previousState,{amt:1,respawn:0,members:undefined});
 assert.deepEqual(importSpawns(source([row({members:true})]),result.definitions).definitions,result.definitions);
 const f2p=importSpawns(source([row()]),[{...old,amt:3,respawn:100,members:true}]);
 assert.equal(Object.hasOwn(f2p.definitions[0],"members"),false,"an F2P source row drops a stale members flag");
 const two=[old,{...old,respawn:5}];
 const held=importSpawns(source([row()]),two);
 assert.deepEqual(held.definitions,two);assert.equal(held.report.counts["existing-exact-state-discrepancy"],1);
});
test("conflicting source amounts and possible replaced IDs need review",()=>{
 assert.equal(importSpawns(source([row(),row({quantity:5})]),[]).definitions.length,0);
 const result=importSpawns(source([row()]),[{id:555,location:{x:3304,y:3311,z:0},amt:1,respawn:100}]);
 assert.equal(result.definitions.length,1);assert.equal(result.report.counts["possible-replaced-id-review"],1);
});
test("a nearby different item is a visible warning; the same item nearby holds the row for placement review",()=>{
 const other={id:555,location:{x:3305,y:3311,z:0},amt:1,respawn:100};
 const warned=importSpawns(source([row()]),[other]);
 assert.equal(warned.definitions.length,2);assert.equal(warned.report.rows[0].nearbyPlacementWarnings.length,1);
 const same={id:554,location:{x:3306,y:3313,z:0},amt:1,respawn:100};
 const held=importSpawns(source([row()]),[same]);
 assert.deepEqual(held.definitions,[same]);
 assert.equal(held.report.counts["near-legacy-placement-review"],1);
 assert.deepEqual(held.report.rows[0].nearbyLegacy,[same]);
 const beyond={...same,location:{x:3307,y:3311,z:0}},upstairs={...same,location:{x:3304,y:3311,z:1}};
 assert.equal(importSpawns(source([row()]),[beyond,upstairs]).report.counts.added,1);
});
test("untyped overrides and missing or variable data remain visible; members rows import behind the world gate",()=>{
 const rows=[row({tile_respawn_raw:"50",unresolved_reasons:["untyped-tile-respawn"]}),
   row({quantity:null,unresolved_reasons:["unresolved-quantity"]}),row({page:"Air rune",id:556,members:true}),
   row({page:"Coins",id:995,x:1,members:null})];
 const result=importSpawns(source(rows),[]);
 assert.equal(result.report.rows.length,4);assert.equal(result.report.counts["unresolved-source"],3);
 assert.deepEqual(result.definitions.map(d=>[d.id,d.members]),[[556,true]]);
 assert.ok(result.report.rows[3].reasons.includes("unknown-world-membership"));
 assert.equal(importSpawns(source([row()]),[]).definitions[0].members,undefined);
});
test("rows listed under the Wiki's Scenery object spawns heading are never ground items",()=>{
 const scenery=row({page:"Bronze axe",id:1351,x:3097,y:3239,section:"Scenery object spawns"});
 const result=importSpawns(source([scenery,row({section:"Item spawns"}),row({x:1,section:"Spawns"})]),[]);
 assert.deepEqual(result.definitions.map(d=>d.id),[554,554]);
 assert.equal(result.report.counts["scenery-object-spawn"],1);
});
test("quest-owned tiles and instanced raid rows stay with their plugins",()=>{
 const owned=[row({page:"Saw",id:8794,x:1212,y:3093,members:true}),row({page:"Knife",id:946,x:1646,y:3095,members:true}),
  row({page:"Wine of Zamorak",id:245,x:3018,y:10353,members:true}),
  row({page:"Tinderbox",id:590,x:3280,y:5347,members:true,location:"[[Chambers of Xeric]]"})];
 const result=importSpawns(source(owned),[]);
 assert.equal(result.definitions.length,0);
 assert.equal(result.report.counts["area-owned-or-instance-integration"],4);
 assert.ok(result.report.rows.every(r=>typeof r.owner==="string"&&r.owner.length));
 assert.equal(importSpawns(source([row({page:"Saw",id:8794,x:2865,y:2327,members:true})]),[]).report.counts.added,1);
});
test("known owners/instances deferred without banning every quest region",()=>{
 const result=importSpawns(source([row({id:560,x:2500,y:2967,page:"Death rune"}),
  row({location:"[[Hallowed Sepulchre]] - floor1"}),row({x:3305,location:"Town beside a quest start"})]),[]);
 assert.equal(result.report.counts["area-owned-or-instance-integration"],2);assert.equal(result.report.counts.added,1);
 const contradictory=importSpawns(source([row({location:"[[Hallowed Sepulchre]] - floor1"}),
  row({location:"Town beside a quest start"})]),[]);
 assert.equal(contradictory.definitions.length,0);
 assert.equal(contradictory.report.counts["conflicting-source-alias-state"],2);
});
test("CLI rejects changed source bytes before writing any data", async()=>{
 const fs=await import("node:fs");const os=await import("node:os");const path=await import("node:path");
 const {spawnSync}=await import("node:child_process");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ground-import-pin-"));
 try {
  const input=path.join(dir,"source.json"),output=path.join(dir,"output.json");
  fs.writeFileSync(input,JSON.stringify(source([])));
  const script=new URL("../scripts/import-osrs-ground-spawns.mjs",import.meta.url);
  const result=spawnSync(process.execPath,[fileURLToPath(script),"--source",input,"--output",output],{encoding:"utf8"});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Pinned source export changed/);
  assert.equal(fs.existsSync(output),false);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test("audited member tools report conflicting world policy instead of silently globalizing a row",()=>{
 const member=row({page:"Shears",id:1735,members:true,quantity:1});
 const conflicting=importSpawns(source([member,{...member,members:false}]),[]);
 assert.equal(conflicting.definitions.length,0);
 assert.equal(conflicting.report.counts["conflicting-source-alias-state"],2);
 const old={id:1735,location:{x:3304,y:3311,z:0},amt:1,respawn:100};
 const result=importSpawns(source([member]),[old]);
 assert.deepEqual(result.definitions,[{...old,members:true}]);
 assert.equal(result.report.counts["existing-source-state-reconciled"],1);
});

const easternShellTiles=[[3258,2481],[3257,2477],[3259,2469],[3261,2458],[3260,2451],
 [3256,2449],[3261,2444],[3258,2437],[3262,2435]];
const easternShell=(extra={})=>row({page:"Sea shell",id:31395,x:3258,y:2481,plane:0,
 members:true,quantity:1,infobox_respawn_ticks:50,location:"[[The Great Conch]] - eastern coast",...extra});
test("nine pinned eastern shells preserve membership, quantity, timer and legacy order",()=>{
 const legacy=[{id:995,location:{x:3000,y:3000,z:0},amt:7,respawn:20}];
 const rows=easternShellTiles.map(([x,y])=>easternShell({x,y}));
 const result=importSpawns(source(rows),legacy);
 assert.deepEqual(result.definitions.slice(0,1),legacy);
 assert.equal(result.definitions.length,10);
 assert.deepEqual(result.definitions.slice(1).map(d=>[d.location.x,d.location.y]),easternShellTiles);
 for(const d of result.definitions.slice(1)){assert.equal(d.members,true);assert.equal(d.amt,1);assert.equal(d.respawn,50);}
 assert.deepEqual(importSpawns(source(rows),result.definitions).definitions,result.definitions);
});
const memberFire = [
 {x:2768,y:3500,plane:1,quantity:2},
 {x:1450,y:10099,plane:0,quantity:1},
 {x:1421,y:10096,plane:0,quantity:1},
 {x:1419,y:10062,plane:0,quantity:1},
 {x:1454,y:10063,plane:0,quantity:1},
].map(r=>row({...r,members:true}));

test("audited member Fire rune rows retain exact quantities, floor, timer and world policy",()=>{
 const result=importSpawns(source(memberFire),[]);
 assert.equal(result.report.counts.added,5);
 assert.deepEqual(result.definitions.map(d=>[d.id,d.location.x,d.location.y,d.location.z,d.amt,d.respawn,d.members]),
  memberFire.map(r=>[554,r.x,r.y,r.plane,r.quantity,100,true]));
 assert.deepEqual(importSpawns(source(memberFire),result.definitions).definitions,result.definitions);
 const conflicting=importSpawns(source([memberFire[0],{...memberFire[0],members:false}]),[]);
 assert.equal(conflicting.definitions.length,0);
 assert.equal(conflicting.report.counts["conflicting-source-alias-state"],2);
});

test("committed member Fire rune data matches the five audited source rows only",()=>{
 const data=JSON.parse(readFileSync(new URL("../data/definitions/ground-items.json",import.meta.url),"utf8"));
 const members=data.filter(d=>d.id===554 && d.members===true);
 assert.equal(members.length,5);
 assert.deepEqual(members.map(d=>[d.location.x,d.location.y,d.location.z,d.amt,d.respawn]).sort(),
  memberFire.map(r=>[r.x,r.y,r.plane,r.quantity,100]).sort());
});

const commonTools=[
 row({page:"Hammer",id:2347,x:1373,y:2949,members:true,quantity:1,infobox_respawn_ticks:100,location:"[[Aldarin]]"}),
 row({page:"Chisel",id:1755,x:1657,y:3142,members:true,quantity:1,infobox_respawn_ticks:100,location:"[[Civitas illa Fortis]] - on a crate in the [[Fortis Blacksmith]] store"}),
 row({page:"Tinderbox",id:590,x:1625,y:3287,members:true,quantity:1,infobox_respawn_ticks:100,location:"[[Salvager Overlook]] - General Store"}),
];
test("three pinned member common tools retain source state and legacy order",()=>{
 const legacy=[{id:995,location:{x:3000,y:3000,z:0},amt:2,respawn:30}];
 const result=importSpawns(source(commonTools),legacy);assert.equal(result.definitions.length,4);
 assert.deepEqual(result.definitions[0],legacy[0]);
 for(const [i,r]of commonTools.entries())assert.deepEqual(result.definitions[i+1],{id:r.id,location:{x:r.x,y:r.y,z:r.plane},amt:1,respawn:100,members:true,description:"OSRS Wiki: "+r.page+" — "+r.location});
 assert.deepEqual(importSpawns(source(commonTools),result.definitions).definitions,result.definitions);
});
const dwarvenCoins = [{x:3003,y:9801},{x:3001,y:9798}].map(at=>row({
 ...at,page:"Coins",id:995,plane:0,quantity:1,location:"[[Dwarven Mine]]",
}));

test("committed Dwarven Mine Coins match both audited public rows without duplicate placements",()=>{
 const data=JSON.parse(readFileSync(new URL("../data/definitions/ground-items.json",import.meta.url),"utf8"));
 for(const r of dwarvenCoins){
  const matches=data.filter(d=>d.id===995 && d.location.x===r.x && d.location.y===r.y && d.location.z===0);
  assert.equal(matches.length,1);assert.equal(matches[0].amt,1);assert.equal(matches[0].respawn,100);
  assert.notEqual(matches[0].members,true);
 }
});

const varlamoreSpades=[row({page:"Spade",id:952,x:1641,y:3052,plane:0,members:true,quantity:1,infobox_respawn_ticks:100,location:"[[Outer Fortis]]"}),
 row({page:"Spade",id:952,x:1405,y:2938,plane:0,members:true,quantity:1,infobox_respawn_ticks:100,location:"[[Aldarin]]"})];
test("two pinned Varlamore spades preserve source state and legacy order",()=>{
 const legacy=[{id:952,location:{x:3120,y:3359,z:0},amt:1,respawn:100}];const result=importSpawns(source(varlamoreSpades),legacy);assert.equal(result.definitions.length,3);assert.deepEqual(result.definitions[0],legacy[0]);
 for(const[i,r]of varlamoreSpades.entries()){const d=result.definitions[i+1];assert.equal(d.id,952);assert.deepEqual(d.location,{x:r.x,y:r.y,z:0});assert.equal(d.amt,1);assert.equal(d.respawn,100);assert.equal(d.members,true);}
 assert.deepEqual(importSpawns(source(varlamoreSpades),result.definitions).definitions,result.definitions);
});
const iceDungeonCoins=[{x:2988,y:9584},{x:2987,y:9583},{x:2988,y:9582}].map(at=>row({
 ...at,page:"Coins",id:995,plane:0,quantity:1,location:"[[Asgarnian Ice Dungeon]]",
}));

test("committed Ice Dungeon Coins match all three audited public rows without duplicates",()=>{
 const data=JSON.parse(readFileSync(new URL("../data/definitions/ground-items.json",import.meta.url),"utf8"));
 for(const r of iceDungeonCoins){
  const matches=data.filter(d=>d.id===995 && d.location.x===r.x && d.location.y===r.y && d.location.z===0);
  assert.equal(matches.length,1);assert.equal(matches[0].amt,1);assert.equal(matches[0].respawn,100);assert.notEqual(matches[0].members,true);
 }
});

const herbloreTable=[row({page:"Pestle and mortar",id:233,x:1667,y:3068,plane:0,quantity:1,members:true,infobox_respawn_ticks:100,location:"[[Outer Fortis]]"}),row({page:"Vial of water",id:227,x:1668,y:3068,plane:0,quantity:1,members:true,infobox_respawn_ticks:100,location:"[[Outer Fortis]]"})];
test("a source-proven reward projection leaves only the display spawn at that tile", () => {
 const location = "Gerrant's Fishy Business";
 const reward = row({page:"White apron", name:"White apron", id:1005, x:3016, y:3229, quantity:1, location});
 const display = {...reward, page:"Hanging White apron", id:7957, infobox_respawn_ticks:10,
  pickup_replacement:{id:1005, telegrab_denial:"The apron is on a hook."}};
 const legacy = [
  {id:1005, location:{x:3016,y:3229,z:0}, amt:1, respawn:100},
  {id:1005, location:{x:3009,y:3204,z:0}, amt:1, respawn:100},
  {id:7957, location:{x:3016,y:3229,z:0}, amt:1, respawn:10},
 ];
 const pinned = source([reward, display]);
 const first = importSpawns(pinned, legacy);
 assert.deepEqual(first.definitions, [legacy[1], {...legacy[2],
  pickupReplacement:{id:1005, telegrabDenial:"The apron is on a hook."}}]);
 assert.equal(first.report.counts["pickup-reward-projection"],1);
 assert.deepEqual(importSpawns(pinned, first.definitions).definitions, first.definitions);
 assert.deepEqual(importSpawns(source([reward, {...display, location:"Different source"}]), legacy).definitions, legacy);
});

const staffRow = (extra={}) => row({page:"Staff of Armadyl",name:"Staff of Armadyl",id:84,
 x:2638,y:9906,plane:0,members:true,quantity:1,infobox_respawn_ticks:100,
 location:"[[Temple of Ikov (dungeon)|Temple of Ikov]]",...extra});

test("audited quest stock reconciles only its exact legacy state from source and preserves neighbors",()=>{
 const legacy={id:84,location:{x:2638,y:9906,z:0},amt:1,respawn:0,description:"UNDIFINED"};
 const neighbor={id:995,location:{x:2638,y:9905,z:0},amt:7,respawn:45,extra:"untouched"};
 const input=[neighbor,legacy], before=structuredClone(input);
 const result=importSpawns(source([staffRow()]),input);
 assert.deepEqual(input,before);
 assert.equal(result.definitions.length,2);assert.deepEqual(result.definitions[0],neighbor);
 assert.deepEqual(result.definitions[1],{...legacy,respawn:100,members:true});
 assert.equal(result.report.counts["existing-audited-source-state-reconciled"],1);
 assert.deepEqual(importSpawns(source([staffRow()]),result.definitions).definitions,result.definitions);
 assert.equal(JSON.stringify(importSpawns(source([staffRow()]),input)),JSON.stringify(result));
});

test("quest stock aliases never create a second stack and conflicting alias state stays held",()=>{
 const aliases=[staffRow(),staffRow({page:"Staff of armadyl",name:"Staff of armadyl"})];
 const added=importSpawns(source(aliases),[]);
 assert.equal(added.definitions.length,1);assert.equal(added.definitions[0].respawn,100);
 assert.equal(added.report.counts.added,1);assert.equal(added.report.counts["duplicate-source-exact"],1);
 const legacy={id:84,location:{x:2638,y:9906,z:0},amt:1,respawn:0};
 const conflict=importSpawns(source([aliases[0],staffRow({page:"Staff of armadyl",infobox_respawn_ticks:50})]),[legacy]);
 assert.deepEqual(conflict.definitions,[legacy]);
 assert.equal(conflict.report.counts["conflicting-source-alias-state"],2);
 const unresolved=importSpawns(source([staffRow({unresolved_reasons:["conflicting-source-alias-state"]})]),[legacy]);
 assert.deepEqual(unresolved.definitions,[legacy]);assert.equal(unresolved.report.counts["unresolved-source"],1);
});

test("quest stock audit refuses untyped timers, other tiles and unaudited legacy discrepancies",()=>{
 const legacy={id:84,location:{x:2638,y:9906,z:0},amt:1,respawn:20};
 const result=importSpawns(source([staffRow()]),[legacy]);
 // Any single legacy entry on the tile now takes the source state, not only the audited one.
 assert.deepEqual(result.definitions,[{...legacy,respawn:100,members:true}]);
 assert.equal(result.report.counts["existing-source-state-reconciled"],1);
 const duplicate=importSpawns(source([staffRow()]),[legacy,{...legacy,respawn:0}]);
 assert.equal(duplicate.definitions.length,2);assert.deepEqual(duplicate.definitions,[legacy,{...legacy,respawn:0}]);
 const differentTile=importSpawns(source([staffRow({x:2639})]),[]);
 // Another tile is an ordinary new spawn: added, never reconciled into the audited legacy stock.
 assert.equal(differentTile.report.counts.added,1);assert.equal(differentTile.definitions[0].location.x,2639);
 assert.throws(()=>importSpawns(source([staffRow({tile_respawn_raw:"100"})]),[]),/Invalid source-complete row/);
});

test("valid quest alias cannot escape an unresolved or member-conflicting sibling before eligibility",()=>{
 const legacy={id:84,location:{x:2638,y:9906,z:0},amt:1,respawn:0};
 const alternatives=[
  staffRow({page:"Staff of armadyl",unresolved_reasons:["untyped-tile-respawn"],tile_respawn_raw:"100"}),
  staffRow({page:"Staff of armadyl",members:false}),
  staffRow({page:"Staff of armadyl",id:null,candidate_ids:[84,85],unresolved_reasons:["ambiguous-item-version"]}),
 ];
 for (const sibling of alternatives) for (const existing of [[],[legacy]]) {
  const before=structuredClone(existing), result=importSpawns(source([staffRow(),sibling]),existing);
  assert.deepEqual(existing,before);assert.deepEqual(result.definitions,before);
  assert.equal(result.report.counts["conflicting-source-alias-state"],2);
  assert.ok(result.report.rows.every(row=>row.reasons.includes("conflicting-source-alias-state")));
 }
 const distinct=importSpawns(source([staffRow(),staffRow({page:"Staff of armadyl",x:2639,members:false})]),[]);
 assert.deepEqual(distinct.definitions.map(d=>[d.location.x,d.members]),[[2638,true],[2639,undefined]]);
});

test("audited legacy reconciliation rejects unknown field representations and accepts only audited defaults",()=>{
 const canonical={id:84,location:{x:2638,y:9906,z:0},amt:1,respawn:0};
 for (const extra of [{amt:null},{amt:"1"},{amt:0},{amt:true},{members:"true"},{members:null},{members:0},{members:1}]) {
  const legacy={...canonical,...extra}, result=importSpawns(source([staffRow()]),[legacy]);
  assert.deepEqual(result.definitions,[legacy]);
  assert.equal(result.report.counts["existing-exact-state-discrepancy"],1);
 }
 for (const legacy of [canonical,{...canonical,members:false},
  {id:84,location:{x:2638,y:9906,z:0},respawn:0}]) {
  const result=importSpawns(source([staffRow()]),[legacy]);
  assert.equal(result.report.counts["existing-audited-source-state-reconciled"],1);
  assert.equal(result.definitions[0].respawn,100);assert.equal(result.definitions[0].amt,1);
  assert.equal(result.definitions[0].members,true);
 }
});

test("a capture-confirmed second spawn beside a same-item legacy spawn is added; others stay held",()=>{
 const legacy={id:1511,location:{x:2958,y:3205,z:0},amt:1,respawn:100};
 const logs=row({page:"Logs",id:1511,x:2959,y:3205});
 const result=importSpawns(source([logs]),[legacy]);
 assert.equal(result.report.counts.added,1);assert.deepEqual(result.definitions[1].location,{x:2959,y:3205,z:0});
 const other=importSpawns(source([row({page:"Logs",id:1511,x:2959,y:3206})]),[legacy]);
 assert.equal(other.report.counts["near-legacy-placement-review"],1);
});
