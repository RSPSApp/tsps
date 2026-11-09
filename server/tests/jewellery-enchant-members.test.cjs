// Proposed native members-world control; loads a private members-world configuration before the real plugin loader.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
const fs = require('node:fs'), os = require('node:os');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'enchant-world-'));
process.env.PLAYER_SAVE_DATABASE_PATH = path.join(temp,'players.sqlite');
process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON = '0';
const worldFile = path.join(temp,'data/definitions/world.json');
fs.mkdirSync(path.dirname(worldFile),{recursive:true});
fs.writeFileSync(worldFile,JSON.stringify({...require('../data/definitions/world.json'),membersWorld:true}));
const previousCwd = process.cwd();
let world;
try { process.chdir(temp); world=require('../dist/game/definition/WorldDefinition'); }
finally { process.chdir(previousCwd); }
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, savedPersistence, next = 9400;
before(async () => {
  assert.equal(world.isMembersWorld(),true,'private configured world before plugin load');
  assert.deepEqual({...world.readWorldConfig(),membersWorld:true},JSON.parse(fs.readFileSync(worldFile,'utf8')),'effective loader configuration matches private world');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  try { PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); }
  finally { savedPersistence = core.GameConstants.PLAYER_PERSISTENCE; }
  assert.ok(PM.loadedPlugins.includes('EnchantJewellery'),'EnchantJewellery registered');
  core.GameConstants.PLAYER_PERSISTENCE = { requestSave() {}, flush: () => Promise.resolve() };
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
});
after(async () => {
  try {
    if(core && savedPersistence) core.GameConstants.PLAYER_PERSISTENCE = savedPersistence;
    PM.emitServerShutdown({}); await savedPersistence?.flush();
  } finally {
    try { const writer=savedPersistence?.writer; if(writer){savedPersistence.writer=null;await writer.terminate();} }
    finally { try { savedPersistence?.database?.close(); } finally { fs.rmSync(temp,{recursive:true,force:true}); } }
  }
});
function actor(t) {
  const channel = { kind:'test', remoteAddress:'127.0.0.1', isOpen:()=>true, send:()=>true,
    close(){}, onData(){}, onError(){}, onClose(){} };
  const p = new Player(new PlayerSession(channel));
  t.after(() => { PM.emitPlayerLogout({player:p,username:p.getUsername()});
    core.World.unregisterPlayerPosition(p); p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex()); core.TaskManager.cancelTasks(p); });
  p.setIndex(next++); p.setUsername('enchant'+p.getIndex());
  p.setLocation(new core.Location(3222,3218,0)); p.setRegistered(true); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  return {p,c,inv:p.getInventory()};
}
function turn(f) {
  f.p.resetUpdating(); core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;
  core.TaskManager.process(); f.c.processTurnPackets();
  const m=f.p.getMovementQueue(); m.beginCycle(); m.processEntityPursuit();
  if(m.hasPendingWork()) m.process(); core.TaskManager.processWalkTo(f.p.getIndex());
}
async function cast(f) {
  const w=core.CacheDefinitions.getSpellByName('Lvl-1 Enchant'); assert.ok(w);
  const id=core.ItemIdentifiers.SAPPHIRE_RING, slot=f.inv.getSlotForItemId(id);
  await f.c.dispatch([{type:'widget_target',sourceWidgetId:w.widgetId,sourceItemId:w.itemId,
    sourceSlot:-1,targetWidgetId:149<<16,targetSlot:slot,targetItemId:id}]);
  f.c.processTurnPackets();
}
test('members world accepts sapphire ring',async t=>{
  const f=actor(t),ids=core.ItemIdentifiers,s=f.p.getSkillManager();
  assert.equal(core.WorldDefinition.isMembersWorld(),true);
  s.setExperience(core.Skill.MAGIC,core.SkillManager.getExperienceForLevel(7));
  s.setMaxLevel(core.Skill.MAGIC,7);s.setCurrentLevel(core.Skill.MAGIC,7,false);
  f.inv.add(new core.Item(ids.SAPPHIRE_RING),false);
  f.inv.add(new core.Item(ids.COSMIC_RUNE,1),false);f.inv.add(new core.Item(ids.WATER_RUNE,1),false);
  const w=core.CacheDefinitions.getSpellByName('Lvl-1 Enchant');assert.ok(w);
  const slot=f.inv.getSlotForItemId(ids.SAPPHIRE_RING);assert.ok(slot>=0);
  const gains=[],add=s.addExperiences.bind(s);
  t.mock.method(s,'addExperiences',(skill,xp)=>{if(skill===core.Skill.MAGIC)gains.push(xp);return add(skill,xp)});
  await f.c.dispatch([{type:'widget_target',sourceWidgetId:w.widgetId,sourceItemId:w.itemId,sourceSlot:-1,
    targetWidgetId:149<<16,targetSlot:slot,targetItemId:ids.SAPPHIRE_RING}]);f.c.processTurnPackets();
  for(let i=0;i<8;i++)turn(f);
  assert.equal(f.inv.getAmount(ids.RING_OF_RECOIL),1);assert.equal(f.inv.getAmount(ids.SAPPHIRE_RING),0);
  assert.equal(f.inv.getAmount(ids.COSMIC_RUNE),0);assert.equal(f.inv.getAmount(ids.WATER_RUNE),0);
  assert.deepEqual(gains,[17.5]);
});
