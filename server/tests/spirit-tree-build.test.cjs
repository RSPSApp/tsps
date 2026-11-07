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
function actor(t,index,base,current){
  const ch={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(ch)),conn=new ClientConnection(ch);conn.player=p;
  p.setUsername('tree'+index);p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));assert.notEqual(p.getLongUsername(),0n);p.setAttribute('bot-skip-persistence',true);
  const save=Instance.createDefaultHouseSave();save.location=6;save.rooms[1][4][6]={roomKey:'SUPERIOR_GARDEN',rotation:0,furniture:{}};p.setAttribute('construction:house',save);
  assert.equal(core.World.getPlayers().add(p),true);
  const originalIndex=p.getIndex(); let house;
  t.after(()=>{try{PM.emitPlayerLogout({player:p,username:p.getUsername()});}finally{try{House.releaseHouse(p,true);}finally{core.World.getPlayers().remove(p);core.TaskManager.cancelTasks(p);core.TaskManager.cancelTasks(originalIndex);if(house)core.TaskManager.cancelTasks(house);}} if(house)assert.equal(house.isDestroyed(),true);assert.equal(House.houseFor(p),null);assert.equal(Instance.PlayerHouseInstance.isAllocationLocation(p.getLocation()),false);assert.equal(p.isRegistered(),false);assert.equal(core.TaskManager.hasActiveTask(p),false);assert.equal(core.TaskManager.hasActiveTask(originalIndex),false);if(house)assert.equal(core.TaskManager.hasActiveTask(house),false);assert.equal([...core.World.getNpcs()].some(npc=>npc?.getOwner?.()===p),false);});
  for(const [skill,level,now] of [[core.Skill.CONSTRUCTION,75,75],[core.Skill.FARMING,base,current]]) p.getSkillManager().setMaxLevels(skill,level,false).setExperiences(skill,core.SkillManager.getExperienceForLevel(level),false).setCurrentLevel(skill,now,false);
  assert.equal(House.enterHouse(p,true),true);house=House.houseFor(p);assert.ok(house instanceof Instance.PlayerHouseInstance);assert.equal(house.owner,p);assert.equal(house.buildingMode,true);
  const build=Data.BUILDABLE_BY_KEY.get('SPIRIT_TREE'), inv=p.getInventory(), sapling=build.materials[0].itemId;
  for(const id of [core.ItemIdentifiers.HAMMER,core.ItemIdentifiers.SAW,sapling]) inv.add(new core.Item(id,1),false);
  for(const id of [core.ItemIdentifiers.HAMMER,core.ItemIdentifiers.SAW,sapling]) {assert.equal(inv.getAmount(id),1);assert.equal(core.ItemDefinition.forId(id).isNoted(),false);}
  const position={plane:1,x:4,y:6}; const tiles=house.hotspotTiles(position).filter(o=>Data.hotspotIn('SUPERIOR_GARDEN',o.id)?.key==='TELEPORT_SPACE');assert.equal(tiles.length,1);
  const tile=tiles[0],loc=new core.Location(tile.x,tile.y,tile.plane),target=house.getFurnitureTarget({x:tile.x,y:tile.y,z:tile.plane},tile.id);assert.ok(target);assert.equal(target.hotspotKey,'TELEPORT_SPACE');
  const ghost=core.MapObjects.getPrivateArea(p,tile.id,loc);assert.ok(ghost);assert.equal(ghost.getPrivateArea(),house);
  const def=core.ObjectDefinition.forPlayer(tile.id,p);assert.ok(def.getInteractions().some(a=>a?.toLowerCase()==='build'));
  p.moveTo(new core.Location(tile.x-1,tile.y,tile.plane));p.setNeedsPlacement(false);
  return {p,conn,house,inv,sapling,tile,target};
}
function turn(f){f.p.resetUpdating();core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;core.TaskManager.process();f.conn.processTurnPackets();const q=f.p.getMovementQueue();q.beginCycle();q.processEntityPursuit();if(q.hasPendingWork())q.process();core.TaskManager.processWalkTo(f.p.getIndex());}
async function build(f,t,allowed){
  const scripts=[],sender=f.p.getPacketSender(),original=sender.sendClientScript.bind(sender);
  t.mock.method(sender,'sendClientScript',(id,...args)=>{scripts.push([id,...args]);return original(id,...args);});
  await f.conn.dispatch([{type:'object_option',id:f.tile.id,x:f.tile.x,y:f.tile.y,action:'Build'}]);
  const group=core.CacheDefinitions.getInterfaceId('poh_furniture_creation');
  let row;for(let i=0;i<30;i++){turn(f);row=scripts.find(s=>s[0]===1404&&s[2]===5970);if(row&&f.p.getInterfaceId()===group&&!f.p.getMovementQueue().hasPendingWork())break;}
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
    if(!allowed){assert.equal(skills.getExperience(core.Skill.CONSTRUCTION),cxp);assert.equal(skills.getExperience(core.Skill.FARMING),fxp);} else console.log('SPIRIT_TREE_XP_OBS '+JSON.stringify({construction:skills.getExperience(core.Skill.CONSTRUCTION)-cxp,farming:skills.getExperience(core.Skill.FARMING)-fxp}));
  });
});

// Real Workbench consumer, directly invoked; this is not a UI-routing test.
test('workbench preserves existing deferred Cooking behavior',async t=>{
  const Workbench=require('../plugins/skills/construction/Workbench.Construction')._test;
  const barrel=Data.BUILDABLE_BY_KEY.get('BEER_BARREL'), flatpack=Workbench.FLATPACK_OF.get('BEER_BARREL');
  const limit=require('../plugins/skills/construction/data/workbench.json').benches.WOODEN_WORKBENCH; assert.equal(limit,20); assert.ok(barrel.level<=limit);
  assert.ok(barrel); assert.ok(Number.isInteger(flatpack));
  for(const [index,current,allowed] of [[1304,4,true],[1305,5,true]]) await t.test(`Cooking ${current}`,async t=>{
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
