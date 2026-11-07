// Cache furniture secondary requirements and shared build gate; helper-level controls.
const assert=require('node:assert/strict'),path=require('node:path');
const {before,test}=require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
let core,Data,House;
before(async()=>{
  await CachePipeline.initialize(path.resolve(__dirname,'..'));core=PluginManager.getCoreApi();
  require('../plugins/skills/construction/Core.Construction').init(PluginManager.createApi('SecondaryFurnitureTest'));
  Data=require('../plugins/skills/construction/Data.Construction');House=require('../plugins/skills/construction/House.Construction');
});
const row=values=>({column:()=>values});
test('cache requirement tuple validation retains every non-Construction pair',()=>{
  const con=core.Skill.CONSTRUCTION.getClientId(),farm=core.Skill.FARMING.getClientId();
  assert.deepEqual(Data.cacheLevels(row([farm,83,con,75])),{level:75,secondaryLevels:[{statId:farm,level:83}]});
  assert.deepEqual(Data.cacheLevels(row([con,75,farm,82,farm,83])),{level:75,secondaryLevels:[{statId:farm,level:82},{statId:farm,level:83}]});
  for(const values of [[],[con,75,farm],[farm,83],[con,75,con,80],[con,null],[con,'75'],[con,75,1.5,3]]) assert.equal(Data.cacheLevels(row(values)).invalidLevels,true,JSON.stringify(values));
});
test('active cache maps expected secondary families and preserves Construction and null-row levels',()=>{
  const expected=new Map([[5690,[13,68]],[5691,[13,88]],[5692,[13,99]],[5696,[20,14]],[5697,[20,44]],[5698,[20,90]],[5553,[7,5]],[5554,[7,14]],[5555,[7,24]],[5556,[7,29]],[5557,[7,39]],[5558,[7,44]],[5970,[19,83]],[5972,[19,83]]]);
  const table=core.CacheDefinitions.getDbTableId('furniture'),col=core.CacheDefinitions.getDbColumn(table,'level_requirement');let count=0,withRows=0,nullRows=0; assert.equal(Data.CONSTRUCTION_BUILDABLES.length,481);
  for(const b of Data.CONSTRUCTION_BUILDABLES){
    if(b.menuRowId==null){nullRows++;continue;}const r=core.CacheDefinitions.getDbRow(b.menuRowId);assert.ok(r,`missing row ${b.menuRowId}`);withRows++;assert.notEqual(b.invalidLevels,true);
    const vals=r.column(col),ci=vals.findIndex((v,i)=>i%2===0&&v===core.Skill.CONSTRUCTION.getClientId());assert.ok(ci>=0);assert.equal(b.level,vals[ci+1]);
    if(b.secondaryLevels?.length){count++;assert.ok(expected.has(b.menuRowId),String(b.menuRowId));assert.deepEqual(b.secondaryLevels,[{statId:expected.get(b.menuRowId)[0],level:expected.get(b.menuRowId)[1]}]);}
  }
  assert.equal(count,expected.size);assert.equal(withRows,478);assert.equal(nullRows,3);for(const id of expected.keys()) assert.ok(Data.CONSTRUCTION_BUILDABLES.some(b=>b.menuRowId===id&&b.secondaryLevels?.length));
  for(const [key,level] of [['SMALL_STORAGE_UNIT',30],['MEDIUM_STORAGE_UNIT',60],['LARGE_STORAGE_UNIT',90]]){const b=Data.BUILDABLE_BY_KEY.get(key);assert.equal(b.level,level);assert.equal(b.secondaryLevels,undefined);}
});
test('shared build gate checks current secondary levels with fully supplied materials',()=>{
  const cases=[['SPIRIT_TREE',core.Skill.FARMING,83],['MITHRIL_ARMOUR',core.Skill.SMITHING,68],['RUNE_CASE_2',core.Skill.RUNECRAFTING,44],['BEER_BARREL',core.Skill.COOKING,5]];
  for(const [key,skill,level] of cases){
    const p=new Player(null),skills=p.getSkillManager(),inv=p.getInventory(),b=Data.BUILDABLE_BY_KEY.get(key);
    skills.setMaxLevels(core.Skill.CONSTRUCTION,99,false).setExperiences(core.Skill.CONSTRUCTION,core.SkillManager.getExperienceForLevel(99),false).setCurrentLevel(core.Skill.CONSTRUCTION,99,false);
    skills.setMaxLevels(skill,level-1,false).setExperiences(skill,core.SkillManager.getExperienceForLevel(level-1),false).setCurrentLevel(skill,level-1,false);
    for(const [id,n] of [[core.ItemIdentifiers.HAMMER,1],[core.ItemIdentifiers.SAW,1]])inv.add(new core.Item(id,n),false);
    for(const material of b.materials){if(material.itemId!=null)inv.add(new core.Item(material.itemId,material.amount),false);else if(material.source==='NAILS')inv.add(new core.Item(core.ItemIdentifiers.STEEL_NAILS,material.amount),false);else assert.fail(`unsupported fixture material ${material.source}`);}
    const low=House.getBuildMaterials(p,null,undefined,b);
    if(skill===core.Skill.FARMING) assert.match(String(low),new RegExp(`${skill.getName()} level ${level}`,'i'));
    else assert.ok(low instanceof Map,`${key} retains existing deferred-skill behavior`);
    skills.setCurrentLevel(skill,level,false);assert.ok(House.getBuildMaterials(p,null,undefined,b) instanceof Map,`${key} current-level control`);
  }
  const p=new Player(null),skills=p.getSkillManager(),inv=p.getInventory(),b=Data.BUILDABLE_BY_KEY.get('CRUDE_WOODEN_CHAIR');
  for(const [id,n] of [[core.ItemIdentifiers.HAMMER,1],[core.ItemIdentifiers.SAW,1]])inv.add(new core.Item(id,n),false);
  for(const m of b.materials){if(m.itemId!=null)inv.add(new core.Item(m.itemId,m.amount),false);else if(m.source==='NAILS')inv.add(new core.Item(core.ItemIdentifiers.STEEL_NAILS,m.amount),false);else assert.fail(`unsupported fixture material ${m.source}`);}
  skills.setMaxLevels(core.Skill.CONSTRUCTION,1,false).setExperiences(core.Skill.CONSTRUCTION,core.SkillManager.getExperienceForLevel(1),false).setCurrentLevel(core.Skill.CONSTRUCTION,1,false);
  assert.ok(House.getBuildMaterials(p,null,undefined,b) instanceof Map);
  const higher={...b,level:2};assert.match(String(House.getBuildMaterials(p,null,undefined,higher)),/Construction level 2/i);
  skills.setCurrentLevel(core.Skill.CONSTRUCTION,2,false);assert.ok(House.getBuildMaterials(p,null,undefined,higher) instanceof Map);
  assert.match(String(House.getBuildMaterials(p,null,undefined,{...b,invalidLevels:true})),/unsupported skill requirement/i);
  assert.match(String(House.getBuildMaterials(p,null,undefined,{...b,secondaryLevels:[{statId:999,level:1}]})),/unsupported skill requirement/i);
  const duplicate={...b,secondaryLevels:[{statId:core.Skill.FARMING.getClientId(),level:82},{statId:core.Skill.FARMING.getClientId(),level:83}]};
  skills.setCurrentLevel(core.Skill.FARMING,82,false);assert.match(String(House.getBuildMaterials(p,null,undefined,duplicate)),/Farming level 83/i);
  skills.setCurrentLevel(core.Skill.FARMING,83,false);assert.ok(House.getBuildMaterials(p,null,undefined,duplicate) instanceof Map);
});
