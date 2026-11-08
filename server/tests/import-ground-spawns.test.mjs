import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
test("exact legacy discrepancy is reported and not overwritten or multiplied",()=>{
 const old={id:554,location:{x:3304,y:3311,z:0},amt:1,respawn:20};
 const result=importSpawns(source([row()]),[old]);
 assert.deepEqual(result.definitions,[old]);assert.equal(result.report.counts["existing-exact-state-discrepancy"],1);
});
test("conflicting source amounts and possible replaced IDs need review",()=>{
 assert.equal(importSpawns(source([row(),row({quantity:5})]),[]).definitions.length,0);
 const result=importSpawns(source([row()]),[{id:555,location:{x:3304,y:3311,z:0},amt:1,respawn:100}]);
 assert.equal(result.definitions.length,1);assert.equal(result.report.counts["possible-replaced-id-review"],1);
});
test("nearby legacy item is a visible warning, never two-tile dedup",()=>{
 const result=importSpawns(source([row()]),[{id:554,location:{x:3305,y:3311,z:0},amt:1,respawn:100}]);
 assert.equal(result.definitions.length,2);assert.equal(result.report.rows[0].nearbyPlacementWarnings.length,1);
});
test("untyped overrides, missing or variable data and member rows remain visible",()=>{
 const rows=[row({tile_respawn_raw:"50",unresolved_reasons:["untyped-tile-respawn"]}),
   row({quantity:null,unresolved_reasons:["unresolved-quantity"]}),row({page:"Air rune",id:556,members:true})];
 const result=importSpawns(source(rows),[]);assert.equal(result.definitions.length,0);
 assert.equal(result.report.rows.length,3);assert.equal(result.report.counts["unresolved-source"],2);
 assert.equal(result.report.counts["members-world-scope-deferred"],1);
});
test("known owners/instances deferred without banning every quest region",()=>{
 const result=importSpawns(source([row({id:560,x:2500,y:2967,page:"Death rune"}),
  row({location:"[[Hallowed Sepulchre]] - floor1"}),row({location:"Town beside a quest start"})]),[]);
 assert.equal(result.report.counts["area-owned-or-instance-integration"],2);assert.equal(result.report.counts.added,1);
});
test("unaudited pages are classified rather than silently imported",()=>{
 const result=importSpawns(source([row({page:"Coins",id:995})]),[]);
 assert.equal(result.definitions.length,0);assert.equal(result.report.counts["ordinary-page-not-yet-audited"],1);
});

test("CLI rejects changed source bytes before writing any data", async()=>{
 const fs=await import("node:fs");const os=await import("node:os");const path=await import("node:path");
 const {spawnSync}=await import("node:child_process");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ground-import-pin-"));
 try {
  const input=path.join(dir,"source.json"),output=path.join(dir,"output.json");
  fs.writeFileSync(input,JSON.stringify(source([])));
  const script=new URL("../scripts/import-osrs-ground-spawns.mjs",import.meta.url);
  const result=spawnSync(process.execPath,[script.pathname,"--source",input,"--output",output],{encoding:"utf8"});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Pinned source export changed/);
  assert.equal(fs.existsSync(output),false);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test("small fishing net scenery rows remain excluded from the audited ordinary scope",()=>{
 const rows=[row({page:"Small fishing net",id:303,x:3244,y:3159}),
   row({page:"Small fishing net",id:303,x:3245,y:3156})];
 const result=importSpawns(source(rows),[]);
 assert.equal(result.definitions.length,0);
 assert.equal(result.report.counts["ordinary-page-not-yet-audited"],2);
 // Raw source headings call these Scenery object spawns; the export does not carry headings.
 // Any future net-page scope extension must resolve that distinction rather than adding this page.
});

test("audited member tools retain source world policy and cannot widen unaudited rune or scenery scope",()=>{
 const member=row({page:"Crossbow",id:837,x:1512,y:3423,members:true,quantity:1,infobox_respawn_ticks:500});
 const result=importSpawns(source([member]),[]);
 assert.equal(result.definitions.length,1);assert.equal(result.definitions[0].members,true);
 assert.equal(result.definitions[0].respawn,500);
 assert.deepEqual(importSpawns(source([member]),result.definitions).definitions,result.definitions);
 const pages=[["Air rune",556],["Body rune",559],
  ["Water rune",555],["Small fishing net",303]];
 const rejected=importSpawns(source(pages.map(([page,id])=>row({page,id,members:true}))),[]);
 assert.equal(rejected.definitions.length,0);
 assert.equal(rejected.report.counts["members-world-scope-deferred"],4);
});
test("audited member tools report conflicting world policy instead of silently globalizing a row",()=>{
 const member=row({page:"Shears",id:1735,members:true,quantity:1});
 const conflicting=importSpawns(source([member,{...member,members:false}]),[]);
 assert.equal(conflicting.definitions.length,0);
 assert.equal(conflicting.report.counts["conflicting-source-quantity-timer-or-membership"],2);
 const old={id:1735,location:{x:3304,y:3311,z:0},amt:1,respawn:100};
 const result=importSpawns(source([member]),[old]);
 assert.deepEqual(result.definitions,[old]);
 assert.equal(result.report.counts["existing-exact-state-discrepancy"],1);
});

test("audited member Earth/Mind runes retain quantities/world policy while the uncertain Air row stays held",()=>{
 const earth=row({page:"Earth rune",id:557,x:1394,y:3116,quantity:4,members:true});
 const mind=row({page:"Mind rune",id:558,x:1392,y:3118,quantity:2,members:true});
 const air=row({page:"Air rune",id:556,x:1399,y:3158,quantity:1,members:true});
 const result=importSpawns(source([earth,mind,air]),[]);
 assert.deepEqual(result.definitions.map(r=>[r.id,r.amt,r.respawn,r.members]),[[557,4,100,true],[558,2,100,true]]);
 assert.equal(result.report.counts["members-world-scope-deferred"],1);
 assert.deepEqual(importSpawns(source([earth,mind]),result.definitions).definitions,result.definitions);
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
test("eastern selection cannot admit other coasts, altered identities or unverified source state",()=>{
 const rows=[easternShell({x:3201,y:2374}),easternShell({x:3170,y:2537}),
 easternShell({x:3300,y:2320}),easternShell({location:"[[The Summer Shore]]"}),
 easternShell({plane:1}),easternShell({id:31394}),easternShell({members:false}),
 easternShell({quantity:2}),easternShell({infobox_respawn_ticks:51}),
 easternShell({unresolved_reasons:["unresolved-version"]}),easternShell({tile_respawn_raw:"50"})];
 assert.throws(()=>importSpawns(source([rows.pop()]),[]),/Invalid source-complete row/);
 assert.equal(importSpawns(source(rows),[]).definitions.length,0);
 const owned=[[3161,2389],[3168,2388],[3179,2384],[3191,2383],[3190,2379],[3197,2376]];
 const result=importSpawns(source(owned.map(([x,y])=>easternShell({x,y,location:"[[The Summer Shore]]"}))),[]);
 assert.equal(result.definitions.length,0);assert.equal(result.report.counts["area-owned-or-instance-integration"],6);
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
 assert.equal(conflicting.report.counts["conflicting-source-quantity-timer-or-membership"],2);
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
test("common tool audit cannot widen pages, world policy, timers or quest/scenery identities",()=>{
 const rows=commonTools.flatMap(r=>[{...r,x:r.x+1},{...r,location:"unverified"},{...r,plane:1},{...r,members:false},{...r,quantity:2},{...r,infobox_respawn_ticks:99}]);
 rows.push({...commonTools[0],x:0,location:undefined}, {...commonTools[0],x:1207,y:3108,location:"[[Tal Teklan]]"},
 {...commonTools[1],x:2407,y:5645,location:"[[Guardians of the Rift]]"},
 {...commonTools[2],x:2543,y:2862,plane:1,members:false,location:"[[Corsair Cove]]"},
 {...commonTools[2],x:2431,y:3072,members:false,location:"[[Castle Wars]] - Saradominist's base"});
 assert.equal(importSpawns(source(rows),[]).definitions.length,0);
 assert.equal(importSpawns(source([{...commonTools[0],unresolved_reasons:["conditional"]}]),[]).definitions.length,0);
 assert.throws(()=>importSpawns(source([{...commonTools[0],tile_respawn_raw:"100"}]),[]),/Invalid source-complete row/);
});

test("audited member Nature rune rows preserve telegrab location text/quantity/timer while Air stays held",()=>{
 const nature=row({page:"Nature rune",id:561,x:2671,y:3737,quantity:2,infobox_respawn_ticks:200,members:true,location:"Rellekka island (requires Telekinetic Grab)"});
 const result=importSpawns(source([nature,row({page:"Air rune",id:556,members:true})]),[]);
 assert.equal(result.definitions.length,1);assert.deepEqual([result.definitions[0].id,result.definitions[0].amt,result.definitions[0].respawn,result.definitions[0].members],[561,2,200,true]);
 assert.match(result.definitions[0].description,/Telekinetic Grab/);assert.equal(result.report.counts["members-world-scope-deferred"],1);
 assert.deepEqual(importSpawns(source([nature]),result.definitions).definitions,result.definitions);
});

const dwarvenCoins = [{x:3003,y:9801},{x:3001,y:9798}].map(at=>row({
 ...at,page:"Coins",id:995,plane:0,quantity:1,location:"[[Dwarven Mine]]",
}));

test("audited Dwarven Mine Coins preserve quantities and remain exact tuple/location selections",()=>{
 const result=importSpawns(source(dwarvenCoins),[]);
 assert.equal(result.report.counts.added,2);
 assert.deepEqual(result.definitions.map(d=>[d.id,d.location.x,d.location.y,d.location.z,d.amt,d.respawn,d.members===true]),
  [[995,3003,9801,0,1,100,false],[995,3001,9798,0,1,100,false]]);
 assert.deepEqual(importSpawns(source(dwarvenCoins),result.definitions).definitions,result.definitions);
 const base=dwarvenCoins[0];
 const held=[{...base,x:3002},{...base,x:3002,location:undefined},
  {...base,plane:1},{...base,id:996},
  {...base,page:"Coins (Shilo Village)"},{...base,location:"[[Edgeville Dungeon]]"},
  {...base,members:true},{...base,x:3188,y:9820,location:"[[Varrock]] - west bank basement"}];
 assert.equal(importSpawns(source(held),[]).definitions.length,0);
 const occupied={id:554,location:{x:3003,y:9801,z:0},amt:1,respawn:100};
 const replaced=importSpawns(source([base]),[occupied]);
 assert.deepEqual(replaced.definitions,[occupied]);
 assert.equal(replaced.report.counts["possible-replaced-id-review"],1);
});

test("committed Dwarven Mine Coins match both audited public rows without duplicate placements",()=>{
 const data=JSON.parse(readFileSync(new URL("../data/definitions/ground-items.json",import.meta.url),"utf8"));
 for(const r of dwarvenCoins){
  const matches=data.filter(d=>d.id===995 && d.location.x===r.x && d.location.y===r.y && d.location.z===0);
  assert.equal(matches.length,1);assert.equal(matches[0].amt,1);assert.equal(matches[0].respawn,100);
  assert.notEqual(matches[0].members,true);
 }
});

test("only exact Civitas surface bucket/pot rows qualify; scenery, phase-owned pot and unaudited F2P bucket stay held",()=>{
 const base=row({page:"Bucket",id:1925,x:1667,y:3124,quantity:1,members:true,location:"[[Civitas illa Fortis]]"});
 const other={...base,x:1644,y:3093},pot={...base,page:"Pot",id:1931,x:1666};
 const rejected=[{...base,x:1621,y:9566,location:"[[Civitas illa Fortis]] - tunnel"},
  {...base,x:3359,y:4777,members:false,location:"[[Clan Wars]] - Free for all"},
  {...pot,x:3086,y:3408,location:"Tassie quest pot"},
  {...base,page:"Spade",id:952,x:1728,y:3102}];
 const result=importSpawns(source([base,other,pot,...rejected]),[]);
 assert.deepEqual(result.definitions.map(r=>[r.id,r.location.x,r.location.y,r.amt,r.respawn,r.members]),[[1925,1667,3124,1,100,true],[1925,1644,3093,1,100,true],[1931,1666,3124,1,100,true]]);
 assert.equal(result.report.rows.filter(r=>r.status==="added").length,3);
 assert.deepEqual(importSpawns(source([base,other,pot]),result.definitions).definitions,result.definitions);
});

const varlamoreSpades=[row({page:"Spade",id:952,x:1641,y:3052,plane:0,members:true,quantity:1,infobox_respawn_ticks:100,location:"[[Outer Fortis]]"}),
 row({page:"Spade",id:952,x:1405,y:2938,plane:0,members:true,quantity:1,infobox_respawn_ticks:100,location:"[[Aldarin]]"})];
test("two pinned Varlamore spades preserve source state and legacy order",()=>{
 const legacy=[{id:952,location:{x:3120,y:3359,z:0},amt:1,respawn:100}];const result=importSpawns(source(varlamoreSpades),legacy);assert.equal(result.definitions.length,3);assert.deepEqual(result.definitions[0],legacy[0]);
 for(const[i,r]of varlamoreSpades.entries()){const d=result.definitions[i+1];assert.equal(d.id,952);assert.deepEqual(d.location,{x:r.x,y:r.y,z:0});assert.equal(d.amt,1);assert.equal(d.respawn,100);assert.equal(d.members,true);}
 assert.deepEqual(importSpawns(source(varlamoreSpades),result.definitions).definitions,result.definitions);
});
test("Spade selection excludes scenery and other regions, identities, quantities and world variants",()=>{
 const rows=varlamoreSpades.flatMap(r=>[{...r,x:r.x+1},{...r,location:"unverified"},{...r,plane:1},{...r,members:false},{...r,quantity:2},{...r,infobox_respawn_ticks:99},{...r,id:953}]);
 for(const[x,y,location]of [[1728,3102,"[[Civitas illa Fortis]]"],[3355,2758,"[[Necropolis]]"],[3338,2751,"[[Necropolis]]"],[3334,2719,"[[Necropolis]]"],[3333,2702,"[[Necropolis]]"],[2592,2291,"[[Wyrmscraig]]"]])rows.push({...varlamoreSpades[0],x,y,location});
 assert.equal(importSpawns(source(rows),[]).definitions.length,0);
 assert.equal(importSpawns(source([{...varlamoreSpades[0],unresolved_reasons:["conditional"]}]),[]).definitions.length,0);
 assert.throws(()=>importSpawns(source([{...varlamoreSpades[0],tile_respawn_raw:"100"}]),[]),/Invalid source-complete row/);
});

const herbloreTable=[row({page:"Pestle and mortar",id:233,x:1667,y:3068,plane:0,quantity:1,members:true,infobox_respawn_ticks:100,location:"[[Outer Fortis]]"}),row({page:"Vial of water",id:227,x:1668,y:3068,plane:0,quantity:1,members:true,infobox_respawn_ticks:100,location:"[[Outer Fortis]]"})];
test("Outer Fortis Herblore table imports only its exact ordinary pair and preserves legacy order",()=>{
 const legacy=[{id:995,location:{x:3000,y:3000,z:0},amt:2,respawn:30}];const r=importSpawns(source(herbloreTable),legacy);assert.deepEqual(r.definitions.slice(0,1),legacy);assert.deepEqual(r.definitions.slice(1).map(d=>[d.id,d.location.x,d.location.y,d.location.z,d.amt,d.respawn,d.members]),[[233,1667,3068,0,1,100,true],[227,1668,3068,0,1,100,true]]);assert.deepEqual(importSpawns(source(herbloreTable),r.definitions).definitions,r.definitions);
 const held=herbloreTable.flatMap(r=>[{...r,x:r.x+1},{...r,id:r.id+1},{...r,plane:1},{...r,members:false},{...r,quantity:2},{...r,infobox_respawn_ticks:99},{...r,location:"unknown"},{...r,unresolved_reasons:["conditional"]}]);assert.equal(importSpawns(source(held),[]).definitions.length,0);assert.throws(()=>importSpawns(source([{...herbloreTable[0],tile_respawn_raw:"100"}]),[]),/Invalid source-complete row/);
});
