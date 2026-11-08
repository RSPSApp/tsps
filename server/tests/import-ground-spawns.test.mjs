import test from "node:test";
import assert from "node:assert/strict";
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
   row({quantity:null,unresolved_reasons:["unresolved-quantity"]}),row({members:true})];
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
