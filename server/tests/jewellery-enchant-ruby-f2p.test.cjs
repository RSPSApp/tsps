// Proposed native F2P fixture; loads a private F2P world configuration before the real plugin loader.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test, mock } = require('node:test');
const fs = require('node:fs'), os = require('node:os');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'enchant-world-'));
process.env.PLAYER_SAVE_DATABASE_PATH = path.join(temp,'players.sqlite');
process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON = '0';
const worldFile = path.join(temp,'data/definitions/world.json');
fs.mkdirSync(path.dirname(worldFile),{recursive:true});
const shippedWorld = require('../data/definitions/world.json');
fs.writeFileSync(worldFile, JSON.stringify({ ...shippedWorld, plugins: { ...shippedWorld.plugins, FreeToPlay: true } }));
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
  assert.equal(world.isMembersWorld(),false,'private configured world before plugin load');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  const read = fs.readFileSync, exists = fs.existsSync;
  const worldPath = path.resolve('data/definitions/world.json');
  const localPath = path.resolve('data/definitions/world.local.json');
  const worldRead = mock.method(fs, 'readFileSync', (file, ...args) => read(file === worldPath ? worldFile : file, ...args));
  const localExists = mock.method(fs, 'existsSync', file => file !== localPath && exists(file));
  try {
    PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  } finally {
    worldRead.mock.restore();
    localExists.mock.restore();
    savedPersistence = core.GameConstants.PLAYER_PERSISTENCE;
  }
  assert.ok(PM.loadedPlugins.includes('EnchantJewellery'),'EnchantJewellery registered');
  assert.ok(PM.loadedPlugins.includes('FreeToPlay'),'FreeToPlay registered');
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
  const w=core.CacheDefinitions.getSpellByName('Lvl-3 Enchant'); assert.ok(w);
  const id=core.ItemIdentifiers.RUBY_RING, slot=f.inv.getSlotForItemId(id);
  await f.c.dispatch([{type:'widget_target',sourceWidgetId:w.widgetId,sourceItemId:w.itemId,
    sourceSlot:-1,targetWidgetId:149<<16,targetSlot:slot,targetItemId:id}]);
  f.c.processTurnPackets();
}
test('free world refuses ruby ring and preserves a subsequent ruby amulet cast',async t=>{
  const f=actor(t), ids=core.ItemIdentifiers, s=f.p.getSkillManager();
  assert.equal(core.WorldDefinition.isMembersWorld(),false,'the registered world must be free-to-play');
  assert.equal(core.CacheDefinitions.getItem(ids.RUBY_RING).isMembers,false);
  assert.equal(core.CacheDefinitions.getItem(ids.RING_OF_FORGING).isMembers,false);
  s.setExperience(core.Skill.MAGIC,core.SkillManager.getExperienceForLevel(49));
  s.setMaxLevel(core.Skill.MAGIC,49); s.setCurrentLevel(core.Skill.MAGIC,49,false);
  f.inv.add(new core.Item(ids.RUBY_RING),false);
  f.inv.add(new core.Item(ids.RUBY_AMULET),false);
  f.inv.add(new core.Item(ids.COSMIC_RUNE,2),false); f.inv.add(new core.Item(ids.FIRE_RUNE,10),false);
  const messages=[],send=f.p.sendMessage.bind(f.p);
  t.mock.method(f.p,'sendMessage',msg=>{messages.push(msg);return send(msg)});
  const gains=[],add=s.addExperiences.bind(s);
  t.mock.method(s,'addExperiences',(skill,xp)=>{if(skill===core.Skill.MAGIC)gains.push(xp);return add(skill,xp)});
  const click=async id=>{
    const w=core.CacheDefinitions.getSpellByName('Lvl-3 Enchant'); assert.ok(w);
    const slot=f.inv.getSlotForItemId(id); assert.ok(slot>=0);
    await f.c.dispatch([{type:'widget_target',sourceWidgetId:w.widgetId,sourceItemId:w.itemId,
      sourceSlot:-1,targetWidgetId:149<<16,targetSlot:slot,targetItemId:id}]); f.c.processTurnPackets();
  };
  const dispatches=[],emit=PM.emitSpellOnItem.bind(PM);
  t.mock.method(PM,'emitSpellOnItem',event=>{const result=emit(event); if(event.player===f.p) dispatches.push({item:event.itemId,spell:event.spellName,handled:event.handled,result}); return result});
  messages.length=0;
  await click(ids.RUBY_RING);
  assert.ok(dispatches.some(d=>d.item===ids.RUBY_RING && d.spell==='Lvl-3 Enchant' && d.handled && d.result),'registered spell route reached');
  for(let i=0;i<8;i++)turn(f);
  assert.equal(f.inv.getAmount(ids.RUBY_RING),1,'free-world ring remains');
  assert.equal(f.inv.getAmount(ids.RING_OF_FORGING),0,'free product spell refused');
  assert.equal(f.inv.getAmount(ids.COSMIC_RUNE),2); assert.equal(f.inv.getAmount(ids.FIRE_RUNE),10);
  assert.deepEqual(gains,[]); assert.ok(messages.some(message=>/members/i.test(String(message))),'refusal identifies members-only casting restriction');
  await click(ids.RUBY_AMULET); for(let i=0;i<8;i++)turn(f);
  assert.equal(f.inv.getAmount(ids.RUBY_AMULET),0); assert.equal(f.inv.getAmount(ids.AMULET_OF_STRENGTH),1);
  assert.equal(f.inv.getAmount(ids.COSMIC_RUNE),1); assert.equal(f.inv.getAmount(ids.FIRE_RUNE),5);
  assert.deepEqual(gains,[59]);
});
test('free world accepts ruby amulet independently',async t=>{
  const f=actor(t),ids=core.ItemIdentifiers,s=f.p.getSkillManager();
  assert.equal(core.WorldDefinition.isMembersWorld(),false);
  s.setExperience(core.Skill.MAGIC,core.SkillManager.getExperienceForLevel(49));
  s.setMaxLevel(core.Skill.MAGIC,49);s.setCurrentLevel(core.Skill.MAGIC,49,false);
  f.inv.add(new core.Item(ids.RUBY_AMULET),false);
  f.inv.add(new core.Item(ids.COSMIC_RUNE,1),false);f.inv.add(new core.Item(ids.FIRE_RUNE,5),false);
  const w=core.CacheDefinitions.getSpellByName('Lvl-3 Enchant');assert.ok(w);
  const slot=f.inv.getSlotForItemId(ids.RUBY_AMULET);assert.ok(slot>=0);
  const gains=[],add=s.addExperiences.bind(s);
  t.mock.method(s,'addExperiences',(skill,xp)=>{if(skill===core.Skill.MAGIC)gains.push(xp);return add(skill,xp)});
  await f.c.dispatch([{type:'widget_target',sourceWidgetId:w.widgetId,sourceItemId:w.itemId,sourceSlot:-1,
    targetWidgetId:149<<16,targetSlot:slot,targetItemId:ids.RUBY_AMULET}]);f.c.processTurnPackets();
  for(let i=0;i<8;i++)turn(f);
  assert.equal(f.inv.getAmount(ids.AMULET_OF_STRENGTH),1);assert.equal(f.inv.getAmount(ids.RUBY_AMULET),0);
  assert.equal(f.inv.getAmount(ids.COSMIC_RUNE),0);assert.equal(f.inv.getAmount(ids.FIRE_RUNE),0);
  assert.deepEqual(gains,[59]);
});

for (const [spell, level, inputName, outputName, runeName, runeCount, experience] of [
  ['Lvl-2 Enchant',27,'EMERALD_AMULET','AMULET_OF_DEFENCE','AIR_RUNE',3,37],
  ['Lvl-4 Enchant',57,'DIAMOND_AMULET','AMULET_OF_POWER','EARTH_RUNE',10,67],
]) test(`free world accepts ${spell} on its amulet`,async t=>{
  const f=actor(t),ids=core.ItemIdentifiers,s=f.p.getSkillManager();
  assert.equal(core.WorldDefinition.isMembersWorld(),false);
  s.setExperience(core.Skill.MAGIC,core.SkillManager.getExperienceForLevel(level));
  s.setMaxLevel(core.Skill.MAGIC,level);s.setCurrentLevel(core.Skill.MAGIC,level,false);
  f.inv.add(new core.Item(ids[inputName]),false);
  f.inv.add(new core.Item(ids.COSMIC_RUNE,1),false);f.inv.add(new core.Item(ids[runeName],runeCount),false);
  const w=core.CacheDefinitions.getSpellByName(spell);assert.ok(w);
  const slot=f.inv.getSlotForItemId(ids[inputName]);assert.ok(slot>=0);
  const gains=[],add=s.addExperiences.bind(s);
  t.mock.method(s,'addExperiences',(skill,xp)=>{if(skill===core.Skill.MAGIC)gains.push(xp);return add(skill,xp)});
  await f.c.dispatch([{type:'widget_target',sourceWidgetId:w.widgetId,sourceItemId:w.itemId,sourceSlot:-1,
    targetWidgetId:149<<16,targetSlot:slot,targetItemId:ids[inputName]}]);f.c.processTurnPackets();
  for(let i=0;i<8;i++)turn(f);
  assert.equal(f.inv.getAmount(ids[outputName]),1);assert.equal(f.inv.getAmount(ids[inputName]),0);
  assert.equal(f.inv.getAmount(ids.COSMIC_RUNE),0);assert.equal(f.inv.getAmount(ids[runeName]),0);
  assert.deepEqual(gains,[experience]);
});
