// Owned-house Spirit Tree build qualification; seeded prerequisites, decoded actions.
process.env.DISABLE_PLAYER_BOTS='1';
const assert=require('node:assert/strict'),path=require('node:path');
const {before,after,test}=require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {PlayerSession}=require('../dist/net/PlayerSession');
const {ClientConnection}=require('../dist/net/NetworkBuilder');
let core,House,Instance,Data; const errors=[],originalError=console.error;
before(async()=>{
  console.error=(...args)=>{errors.push(args.map(String).join(' '));originalError(...args);};
  await CachePipeline.initialize(path.resolve(__dirname,'..')); core=PM.getCoreApi(); core.RegionManager.init(); core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname,'../plugins')); PM.emitServerStartup({});
  House=require('../plugins/skills/construction/House.Construction'); Instance=require('../plugins/skills/construction/Instance.Construction'); Data=require('../plugins/skills/construction/Data.Construction');
  assert.equal(core.WorldDefinition.isMembersWorld(),true);
  const table=core.CacheDefinitions.getDbTableId('furniture'),row=core.CacheDefinitions.getDbRow(5970);
  assert.ok(row); const column=name=>core.CacheDefinitions.getDbColumn(table,name);
  assert.equal(core.Skill.CONSTRUCTION.getIndex(),21); assert.equal(core.Skill.CONSTRUCTION.getClientId(),22);
  assert.equal(core.Skill.FARMING.getIndex(),19); assert.equal(core.Skill.FARMING.getClientId(),19);
  const levels=row.column(column('level_requirement')); assert.deepEqual(levels,[core.Skill.CONSTRUCTION.getClientId(),75,core.Skill.FARMING.getClientId(),83]);
  const build=Data.BUILDABLE_BY_KEY.get('SPIRIT_TREE'); assert.equal(build.menuRowId,5970); assert.equal(build.level,75); assert.notEqual(row.int(column('hidden_in_build_menu'),0),1);
  assert.equal(build.materials.length,1); assert.equal(build.materials[0].amount,1);
  assert.match(core.ItemDefinition.forId(build.materials[0].itemId).getName(),/spirit.*sapling/i);
  assert.ok(Data.HOTSPOT_BY_KEY.get('TELEPORT_SPACE').buildables.includes('SPIRIT_TREE'));
});
after(()=>{try{PM.emitServerShutdown({});assert.deepEqual(errors,[]);}finally{console.error=originalError;}});
function actor(t,index,base,current,{key='SPIRIT_TREE',can='WATERING_CAN_8_',tools=true}={}){
  const ch={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(ch)),conn=new ClientConnection(ch);conn.player=p;
  p.setUsername('tree'+index);p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));assert.notEqual(p.getLongUsername(),0n);p.setAttribute('bot-skip-persistence',true);
  const save=Instance.createDefaultHouseSave();save.location=6;save.rooms[1][4][6]={roomKey:'SUPERIOR_GARDEN',rotation:0,furniture:{}};p.setAttribute('construction:house',save);
  assert.equal(core.World.getPlayers().add(p),true);
  const originalIndex=p.getIndex(); let house;
  t.after(()=>{try{PM.emitPlayerLogout({player:p,username:p.getUsername()});}finally{try{House.releaseHouse(p,true);}finally{core.World.getPlayers().remove(p);core.TaskManager.cancelTasks(p);core.TaskManager.cancelTasks(originalIndex);if(house)core.TaskManager.cancelTasks(house);}} if(house)assert.equal(house.isDestroyed(),true);assert.equal(House.houseFor(p),null);assert.equal(Instance.PlayerHouseInstance.isAllocationLocation(p.getLocation()),false);assert.equal(p.isRegistered(),false);assert.equal(core.TaskManager.hasActiveTask(p),false);assert.equal(core.TaskManager.hasActiveTask(originalIndex),false);if(house)assert.equal(core.TaskManager.hasActiveTask(house),false);assert.equal([...core.World.getNpcs()].some(npc=>npc?.getOwner?.()===p),false);});
  const construction=Data.BUILDABLE_BY_KEY.get(key).level;
  for(const [skill,level,now] of [[core.Skill.CONSTRUCTION,construction,construction],[core.Skill.FARMING,base,current]]) p.getSkillManager().setMaxLevels(skill,level,false).setExperiences(skill,core.SkillManager.getExperienceForLevel(level),false).setCurrentLevel(skill,now,false);
  assert.equal(House.enterHouse(p,true),true);house=House.houseFor(p);assert.ok(house instanceof Instance.PlayerHouseInstance);assert.equal(house.owner,p);assert.equal(house.buildingMode,true);
  const buildable=Data.BUILDABLE_BY_KEY.get(key), inv=p.getInventory(), sapling=Data.BUILDABLE_BY_KEY.get('SPIRIT_TREE').materials[0].itemId;
  const materials=buildable.materials.filter(m=>m.itemId!=null);
  for(const m of materials) inv.add(new core.Item(m.itemId,m.amount),false);
  if(tools) for(const id of [core.ItemIdentifiers.HAMMER,core.ItemIdentifiers.SAW]) inv.add(new core.Item(id,1),false);
  const canId=can?core.ItemIdentifiers[can]:null;
  if(can) {assert.ok(Number.isInteger(canId),can);inv.add(new core.Item(canId,1),false);}
  for(const m of materials) {assert.equal(inv.getAmount(m.itemId),m.amount);assert.equal(core.ItemDefinition.forId(m.itemId).isNoted(),false);}
  const position={plane:1,x:4,y:6}; const tiles=house.hotspotTiles(position).filter(o=>Data.hotspotIn('SUPERIOR_GARDEN',o.id)?.key==='TELEPORT_SPACE');assert.equal(tiles.length,1);
  const tile=tiles[0],loc=new core.Location(tile.x,tile.y,tile.plane),target=house.getFurnitureTarget({x:tile.x,y:tile.y,z:tile.plane},tile.id);assert.ok(target);assert.equal(target.hotspotKey,'TELEPORT_SPACE');
  const ghost=core.MapObjects.getPrivateArea(p,tile.id,loc);assert.ok(ghost);assert.equal(ghost.getPrivateArea(),house);
  const def=core.ObjectDefinition.forPlayer(tile.id,p);assert.ok(def.getInteractions().some(a=>a?.toLowerCase()==='build'));
  p.moveTo(new core.Location(tile.x-1,tile.y,tile.plane));p.setNeedsPlacement(false);
  return {p,conn,house,inv,sapling,tile,target,buildable,canId,materials};
}
function turn(f){f.p.resetUpdating();core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;core.TaskManager.process();f.conn.processTurnPackets();const q=f.p.getMovementQueue();q.beginCycle();q.processEntityPursuit();if(q.hasPendingWork())q.process();core.TaskManager.processWalkTo(f.p.getIndex());}
async function build(f,t,allowed){
  const scripts=[],sender=f.p.getPacketSender(),original=sender.sendClientScript.bind(sender);
  t.mock.method(sender,'sendClientScript',(id,...args)=>{scripts.push([id,...args]);return original(id,...args);});
  await f.conn.dispatch([{type:'object_option',id:f.tile.id,x:f.tile.x,y:f.tile.y,action:'Build'}]);
  const group=core.CacheDefinitions.getInterfaceId('poh_furniture_creation');
  let row;for(let i=0;i<30;i++){turn(f);row=scripts.find(s=>s[0]===1404&&s[2]===f.buildable.menuRowId);if(row&&f.p.getInterfaceId()===group&&!f.p.getMovementQueue().hasPendingWork())break;}
  assert.equal(f.p.getInterfaceId(),group);assert.ok(row,'actual visible Spirit Tree menu row');assert.equal(f.p.getMovementQueue().hasPendingWork(),false,'movement settled before selection');if(allowed)assert.equal(row[5],1);
  const action=row[1];assert.ok(Number.isInteger(action)&&action>0);const widgetId=(group<<16)|2;
  const seen=[],emit=PM.emitInterfaceActionClick.bind(PM);t.mock.method(PM,'emitInterfaceActionClick',event=>{const result=emit(event);if(event.player===f.p&&event.groupId===group&&event.childId===2&&event.action===action)seen.push({handled:event.handled,result});return result;});
  await f.conn.dispatch([{type:'dialogue_continue',widgetId,childIndex:action}]);for(let i=0;i<30&&!seen.length;i++)turn(f);assert.equal(seen.length,1);assert.equal(seen[0].handled,true);
}
test('Spirit Tree build requires Farming 83 and accepts boosts',async t=>{
  for(const [name,index,base,current,allowed] of [['level 83',1301,83,83,true],['level 82',1302,82,82,false],['boosted 82',1303,82,83,true]]) await t.test(name,async t=>{
    const f=actor(t,index,base,current),skills=f.p.getSkillManager();
    for(const [skill,max,now] of [[core.Skill.CONSTRUCTION,75,75],[core.Skill.FARMING,base,current]]){assert.equal(skills.getMaxLevel(skill),max);assert.equal(skills.getCurrentLevel(skill),now);assert.equal(skills.getExperience(skill),core.SkillManager.getExperienceForLevel(max));}
    assert.equal(f.house.getFurnitureAtTarget(f.target),null);const cxp=skills.getExperience(core.Skill.CONSTRUCTION),fxp=skills.getExperience(core.Skill.FARMING);
    await build(f,t,allowed);assert.equal(f.inv.getAmount(f.sapling),allowed?0:1);assert.equal(f.house.getFurnitureAtTarget(f.target)?.buildableKey??null,allowed?'SPIRIT_TREE':null);
    assert.equal(f.inv.getAmount(core.ItemIdentifiers.HAMMER),1);assert.equal(f.inv.getAmount(core.ItemIdentifiers.SAW),1);
    if(!allowed){assert.equal(skills.getExperience(core.Skill.CONSTRUCTION),cxp);assert.equal(skills.getExperience(core.Skill.FARMING),fxp);} else assert.deepEqual({construction:skills.getExperience(core.Skill.CONSTRUCTION)-cxp,farming:skills.getExperience(core.Skill.FARMING)-fxp},{construction:350,farming:350},'Wiki (Spirit tree (Construction)): 350 Construction and 350 Farming');
  });
});

// Real Workbench consumer, directly invoked; this is not a UI-routing test.
// Wiki (Beer barrel): Construction 7 and Cooking 5, both boostable.
test('a beer barrel flatpack needs Cooking 5, and a boost to 5 counts',async t=>{
  const Workbench=require('../plugins/skills/construction/Workbench.Construction')._test;
  const barrel=Data.BUILDABLE_BY_KEY.get('BEER_BARREL'), flatpack=Workbench.FLATPACK_OF.get('BEER_BARREL');
  const limit=require('../plugins/skills/construction/data/workbench.json').benches.WOODEN_WORKBENCH; assert.equal(limit,20); assert.ok(barrel.level<=limit);
  assert.ok(barrel); assert.ok(Number.isInteger(flatpack));
  for(const [index,current,allowed] of [[1304,4,false],[1305,5,true]]) await t.test(`Cooking ${current}`,async t=>{
    const f=actor(t,index,83,83),skills=f.p.getSkillManager(),inv=f.inv;
    skills.setMaxLevels(core.Skill.COOKING,4,false).setExperiences(core.Skill.COOKING,core.SkillManager.getExperienceForLevel(4),false).setCurrentLevel(core.Skill.COOKING,current,false);
    for(const material of barrel.materials){if(material.itemId!=null)inv.add(new core.Item(material.itemId,material.amount),false);else if(material.source==='NAILS')inv.add(new core.Item(core.ItemIdentifiers.STEEL_NAILS,material.amount),false);else assert.fail(`unexpected barrel material ${material.source}`);}
    const materials=barrel.materials.map(m=>[m.itemId??core.ItemIdentifiers.STEEL_NAILS,m.amount]);
    for(const [id,n] of materials) assert.ok(inv.getAmount(id)>=n);
    const before=materials.map(([id])=>inv.getAmount(id)), xp=skills.getExperience(core.Skill.CONSTRUCTION);
    Workbench.makeFlatpack(f.p,{house:f.house,limit},barrel);
    assert.equal(inv.getAmount(flatpack),allowed?1:0);
    for(let i=0;i<materials.length;i++) assert.equal(inv.getAmount(materials[i][0]),before[i]-(allowed?materials[i][1]:0));
    assert.equal(inv.getAmount(core.ItemIdentifiers.HAMMER),1);assert.equal(inv.getAmount(core.ItemIdentifiers.SAW),1);
    if(!allowed)assert.equal(skills.getExperience(core.Skill.CONSTRUCTION),xp);
  });
});

test('every second skill the cache gives is checked: Smithing for the armour displays, Runecraft for the rune cases',async t=>{
  const House=require('../plugins/skills/construction/House.Construction');
  const refusal=(key,skill,level)=>{const f=actor(t,1306+level,83,83);const skills=f.p.getSkillManager();
    skills.setMaxLevels(skill,level,false).setExperiences(skill,core.SkillManager.getExperienceForLevel(level),false).setCurrentLevel(skill,level,false);
    f.inv.add(new core.Item(core.ItemIdentifiers.HAMMER,1),false);f.inv.add(new core.Item(core.ItemIdentifiers.SAW,1),false);
    const result=House.getBuildMaterials(f.p,f.house,null,Data.BUILDABLE_BY_KEY.get(key));
    return typeof result==='string'?result:null;};
  assert.equal(refusal('MITHRIL_ARMOUR',core.Skill.SMITHING,67),'You need Smithing level 68 to build that.');
  assert.notEqual(refusal('MITHRIL_ARMOUR',core.Skill.SMITHING,68),'You need Smithing level 68 to build that.');
  assert.equal(refusal('RUNE_CASE_1',core.Skill.RUNECRAFTING,13),'You need Runecrafting level 14 to build that.');
});

test('the spirit tree & fairy ring pays 885 Construction and 885 Farming (Wiki), the fairy ring alone 535 Construction',()=>{
  const both=Data.BUILDABLE_BY_KEY.get('SPIRIT_TREE_AND_FAIRY_RING'), ring=Data.BUILDABLE_BY_KEY.get('FAIRY_RING');
  assert.deepEqual([both.experience,both.farmingExperience],[885,885]);
  assert.deepEqual([ring.experience,ring.farmingExperience??0],[535,0]);
});

test('natural teleport builds use water instead of a saw and hammer',async t=>{
  let index=1320;
  for(const key of ['SPIRIT_TREE','FAIRY_RING','SPIRIT_TREE_AND_FAIRY_RING']) {
    for(const [name,can,tools,allowed] of [
      ['last water dose, no construction tools','WATERING_CAN_1_',false,true],
      ['tools but no can',null,true,false],
      ['tools but empty can','WATERING_CAN',true,false],
    ]) await t.test(`${key}: ${name}`,async t=>{
      const f=actor(t,index++,83,83,{key,can,tools}),skills=f.p.getSkillManager();
      const before=[skills.getExperience(core.Skill.CONSTRUCTION),skills.getExperience(core.Skill.FARMING)];
      await build(f,t,allowed);
      assert.equal(f.house.getFurnitureAtTarget(f.target)?.buildableKey??null,allowed?key:null);
      for(const m of f.materials) assert.equal(f.inv.getAmount(m.itemId),allowed?0:m.amount);
      assert.equal(skills.getExperience(core.Skill.CONSTRUCTION)-before[0],allowed?f.buildable.experience:0);
      assert.equal(skills.getExperience(core.Skill.FARMING)-before[1],allowed?(f.buildable.farmingExperience??0):0);
      if(allowed){assert.equal(f.inv.getAmount(f.canId),0);assert.equal(f.inv.getAmount(core.ItemIdentifiers.WATERING_CAN),1);}
      else if(can) assert.equal(f.inv.getAmount(f.canId),1);
      assert.equal(f.inv.getAmount(core.ItemIdentifiers.HAMMER),tools?1:0);
      assert.equal(f.inv.getAmount(core.ItemIdentifiers.SAW),tools?1:0);
    });
  }
});

// Ordinary furniture shares the build gate with the spirit trees above.
function chairActor(t,index,tool){
  const f=actor(t,index,83,83),I=core.ItemIdentifiers;
  f.inv.deleteNumber(I.HAMMER,1);
  f.house.save.rooms[1][4][6]={roomKey:'PARLOUR',rotation:0,furniture:{}};
  House.rebuildHouse(f.p,f.house);
  f.buildable=Data.BUILDABLE_BY_KEY.get('CRUDE_WOODEN_CHAIR');
  f.materials=f.buildable.materials.map(m=>[m.itemId??I.STEEL_NAILS,m.amount]);
  for(const [id,n] of f.materials) f.inv.add(new core.Item(id,n),false);
  if(tool!=null) f.inv.add(new core.Item(tool,1),false);
  const tile=f.house.hotspotTiles({plane:1,x:4,y:6}).find(o=>Data.hotspotIn('PARLOUR',o.id)?.key==='CHAIR_1');assert.ok(tile);
  f.tile=tile;f.target=f.house.getFurnitureTarget({x:tile.x,y:tile.y,z:tile.plane},tile.id);assert.ok(f.target);
  f.p.moveTo(new core.Location(tile.x+1,tile.y,tile.plane));f.p.setNeedsPlacement(false);
  return f;
}
async function chairMenu(f,t,enabled,usedTool){
  const scripts=[],sender=f.p.getPacketSender(),send=sender.sendClientScript.bind(sender);
  t.mock.method(sender,'sendClientScript',(id,...args)=>{scripts.push([id,...args]);return send(id,...args);});
  if(usedTool!=null) await f.conn.dispatch([{type:'inventory_use_on',slot:f.inv.getSlotForItemId(usedTool),itemId:usedTool,target:{kind:'loc',id:f.tile.id,x:f.tile.x,y:f.tile.y}}]);
  else await f.conn.dispatch([{type:'object_option',id:f.tile.id,x:f.tile.x,y:f.tile.y,action:'Build'}]);
  let row;for(let i=0;i<30;i++){turn(f);row=scripts.find(s=>s[0]===1404&&s[2]===f.buildable.menuRowId);if(row&&f.p.getInterfaceId()===458&&!f.p.getMovementQueue().hasPendingWork())break;}
  assert.equal(f.p.getInterfaceId(),458);assert.ok(row,'native chair row');assert.equal(row[5],enabled?1:0);
  return async()=>{await f.conn.dispatch([{type:'dialogue_continue',widgetId:(458<<16)|2,childIndex:row[1]}]);for(let i=0;i<10;i++)turn(f);};
}

test('ordinary furniture accepts repaired carried and natively wielded Imcando hammers',async t=>{
  const I=core.ItemIdentifiers;
  let index=1350;
  for(const [name,tool,wearSlot,allowed] of [
    ['ordinary hammer',I.HAMMER,null,true],
    ['carried main-hand',I.IMCANDO_HAMMER,null,true],
    ['carried off-hand',I.IMCANDO_HAMMER_OFF_HAND_,null,true],
    ['wielded main-hand',I.IMCANDO_HAMMER,core.Equipment.WEAPON_SLOT,true],
    ['wielded off-hand',I.IMCANDO_HAMMER_OFF_HAND_,core.Equipment.SHIELD_SLOT,true],
    ['missing hammer',null,null,false],
    ['broken hammer',I.IMCANDO_HAMMER_BROKEN_,null,false],
    ['main-hand placeholder',I.IMCANDO_HAMMER_2,null,false],
    ['off-hand placeholder',I.IMCANDO_HAMMER_OFF_HAND__2,null,false],
  ]) await t.test(name,async t=>{
    const f=chairActor(t,index++,tool),xp=f.p.getSkillManager().getExperience(core.Skill.CONSTRUCTION);
    if(wearSlot!=null){await f.conn.dispatch([{type:'inventory_action',widgetId:149<<16,slot:f.inv.getSlotForItemId(tool),itemId:tool,option:'Wield'}]);turn(f);assert.equal(f.p.getEquipment().get(wearSlot)?.getId(),tool);assert.equal(f.inv.getAmount(tool),0);}
    const select=await chairMenu(f,t,allowed);await select();
    assert.equal(f.house.getFurnitureAtTarget(f.target)?.buildableKey??null,allowed?f.buildable.key:null);
    for(const [id,n] of f.materials) assert.equal(f.inv.getAmount(id),allowed?0:n);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.CONSTRUCTION)-xp,allowed?f.buildable.experience:0);
    if(tool!=null) assert.equal(wearSlot==null?f.inv.getAmount(tool):f.p.getEquipment().get(wearSlot)?.getId(),wearSlot==null?1:tool);
    assert.equal(f.inv.getAmount(I.SAW),1);
  });
});

test('using a carried Imcando hammer on a hotspot opens its native build menu',async t=>{
  for(const tool of [core.ItemIdentifiers.IMCANDO_HAMMER,core.ItemIdentifiers.IMCANDO_HAMMER_OFF_HAND_]) await t.test(String(tool),async t=>{
    const f=chairActor(t,1380+(tool===core.ItemIdentifiers.IMCANDO_HAMMER?0:1),tool);
    const select=await chairMenu(f,t,true,tool);await select();
    assert.equal(f.house.getFurnitureAtTarget(f.target)?.buildableKey,f.buildable.key);assert.equal(f.inv.getAmount(tool),1);
  });
});

test('Imcando hammers also qualify flatpack creation and installation',async t=>{
  const W=require('../plugins/skills/construction/Workbench.Construction')._test,I=core.ItemIdentifiers;
  for(const tool of [I.IMCANDO_HAMMER,I.IMCANDO_HAMMER_OFF_HAND_]) await t.test(String(tool),async t=>{
    const f=chairActor(t,1390+(tool===I.IMCANDO_HAMMER?0:1),tool),flatpack=W.FLATPACK_OF.get(f.buildable.key),xp=f.p.getSkillManager().getExperience(core.Skill.CONSTRUCTION);
    W.makeFlatpack(f.p,{house:f.house,limit:20},f.buildable);
    assert.equal(f.inv.getAmount(flatpack),1);assert.equal(f.p.getSkillManager().getExperience(core.Skill.CONSTRUCTION)-xp,f.buildable.experience);
    await f.conn.dispatch([{type:'inventory_use_on',slot:f.inv.getSlotForItemId(flatpack),itemId:flatpack,target:{kind:'loc',id:f.tile.id,x:f.tile.x,y:f.tile.y}}]);for(let i=0;i<10;i++)turn(f);
    assert.equal(f.house.getFurnitureAtTarget(f.target)?.buildableKey,f.buildable.key);assert.equal(f.inv.getAmount(flatpack),0);assert.equal(f.inv.getAmount(tool),1);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.CONSTRUCTION)-xp,f.buildable.experience,'installation adds no XP');
  });
});

// Captured (rsprox_transcripts/229/02812.txt ticks 1315 and 1464): an upgrade tier's flatpack installs on its empty space.
// It may also go straight onto its previous tier, and is refused on other built furniture (229/02605.txt tick 5416).
test('an upgrade-tier flatpack installs on an empty space or on its previous tier, not on other built furniture',async t=>{
  const W=require('../plugins/skills/construction/Workbench.Construction')._test,I=core.ItemIdentifiers;
  const f=actor(t,1395,83,83);
  f.house.save.rooms[1][4][6]={roomKey:'COSTUME_ROOM',rotation:0,furniture:{}};
  House.rebuildHouse(f.p,f.house);
  const tile=f.house.hotspotTiles({plane:1,x:4,y:6}).find(o=>Data.hotspotIn('COSTUME_ROOM',o.id)?.key==='CAPE_RACK');assert.ok(tile,'a cape rack space');
  const target=f.house.getFurnitureTarget({x:tile.x,y:tile.y,z:tile.plane},tile.id);assert.ok(target);
  f.p.getSkillManager().setMaxLevels(core.Skill.CONSTRUCTION,99,false).setCurrentLevel(core.Skill.CONSTRUCTION,99,false);
  f.p.moveTo(new core.Location(tile.x+1,tile.y,tile.plane));f.p.setNeedsPlacement(false);
  const teak=W.FLATPACK_OF.get('TEAK_CAPE_RACK');assert.ok(Number.isInteger(teak));
  f.inv.add(new core.Item(teak,1),false);
  const install=async()=>{await f.conn.dispatch([{type:'inventory_use_on',slot:f.inv.getSlotForItemId(teak),itemId:teak,target:{kind:'loc',id:tile.id,x:tile.x,y:tile.y}}]);for(let i=0;i<10;i++)turn(f);};
  await install();
  assert.equal(f.house.getFurnitureAtTarget(target)?.buildableKey,'TEAK_CAPE_RACK','an empty space takes the teak rack');
  assert.equal(f.inv.getAmount(teak),0,'the flatpack is used');
  f.inv.add(new core.Item(teak,1),false);
  f.house.setFurniture(target,Data.BUILDABLE_BY_KEY.get('OAK_CAPE_RACK'));House.rebuildHouse(f.p,f.house);
  const oak=Data.BUILDABLE_BY_KEY.get('OAK_CAPE_RACK').objectIds[0];
  await f.conn.dispatch([{type:'inventory_use_on',slot:f.inv.getSlotForItemId(teak),itemId:teak,target:{kind:'loc',id:oak,x:tile.x,y:tile.y}}]);for(let i=0;i<10;i++)turn(f);
  assert.equal(f.house.getFurnitureAtTarget(target)?.buildableKey,'TEAK_CAPE_RACK','on the oak rack it upgrades');
  assert.equal(f.inv.getAmount(teak),0);
  // On the teak rack itself (not its previous tier) another teak flatpack is refused, and kept.
  f.inv.add(new core.Item(teak,1),false);
  const teakRack=Data.BUILDABLE_BY_KEY.get('TEAK_CAPE_RACK').objectIds[0];
  await f.conn.dispatch([{type:'inventory_use_on',slot:f.inv.getSlotForItemId(teak),itemId:teak,target:{kind:'loc',id:teakRack,x:tile.x,y:tile.y}}]);for(let i=0;i<10;i++)turn(f);
  assert.equal(f.inv.getAmount(teak),1,'refused on built furniture other than its previous tier');
  assert.equal(f.house.getFurnitureAtTarget(target)?.buildableKey,'TEAK_CAPE_RACK');
});
