// Run after yarn build: node --test tests/crafting-guild-entry-native.test.cjs
// Decoded object packets and real force movement; seeded skill levels, not potion consumption.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { SkillManager } = require('../dist/game/content/skill/SkillManager');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
let core, next = 7600;
const errors=[], originalError=console.error;
console.error=(...args)=>{ errors.push(args); originalError(...args); };
const X=2933, Y=3289, DOOR=14910;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(X, Y);
  PM.emitServerStartup({});
});
after(() => { try { PM.emitServerShutdown({}); } finally { console.error=originalError; assert.deepEqual(errors,[],'no caught startup, runtime or shutdown errors'); } });
async function attempt(t, base, current, apron, inside=false, cancelAfterOneTick=false) {
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel)); const name=`guild${next++}`;
  t.after(() => { try { try { p.closeInterruptibleInterfaces(); } finally { core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); } } finally { try { if(p.isRegistered()) core.World.getPlayers().remove(p); } finally { assert.ok(!p.isRegistered()); assert.ok(p.getForceMovement()==null); assert.equal(core.TaskManager.hasActiveTask(p),false); assert.equal(core.TaskManager.hasActiveTask(p.getIndex()),false); assert.equal(MultiChatboxPrompt.getPending(p),null); assert.deepEqual(errors,[]); } } });
  p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name)); assert.notEqual(p.getLongUsername(),0n);
  p.setAttribute('bot-skip-persistence',true); assert.equal(core.World.getPlayers().add(p),true); p.moveTo(new core.Location(X,inside?Y-1:Y+1,0)); p.setNeedsPlacement(false); assert.ok(p.getHitpoints()>0); assert.equal(p.busy(),false);
  const c=new ClientConnection(channel); c.player=p; p.getSession().setPlayer(p); p.getSession().setTurnPacketProcessor(()=>c.processTurnPackets());
  const skills=p.getSkillManager(), skill=core.Skill.CRAFTING;
  skills.setMaxLevels(skill,base,false).setExperience(skill,SkillManager.getExperienceForLevel(base)).setCurrentLevels(skill,current,false);
  assert.equal(skills.getMaxLevel(skill),base); assert.equal(skills.getCurrentLevel(skill),current);
  if(apron) p.getEquipment().setItem(core.Equipment.BODY_SLOT,new core.Item(1757,1));
  assert.equal(core.CacheDefinitions.getLocId('craftingguilddoor'),DOOR);
  const object=core.World.findCacheObject(p,DOOR,new core.Location(X,Y,0));
  assert.ok(object,'active cache has guild door at expected position');
  const def=ObjectDefinition.forPlayer(DOOR,p); assert.equal(def.getName(),'Guild Door'); assert.equal(def.getInteractions()[0].toLowerCase(),'open');
  assert.ok(Number.isInteger(object.getFace())); const type=object.getType(), rect=type===10||type===11||type===22;
  const footprint=type===22?def:(ObjectDefinition.forId(DOOR)??def);
  const candidates=inside?[[X,Y-1]]:[[X,Y+1],[X-1,Y],[X+1,Y],[X,Y]];
  let standing=null;
  for(const [x,y] of candidates) {
    const loc=new core.Location(x,y,0);
    if(core.RegionManager.blocked(loc,p.getPrivateArea())) continue;
    p.moveTo(loc); p.setNeedsPlacement(false);
    if(PathFinder.reachedObject(p,X,Y,rect?footprint.getSizeX():1,rect?footprint.getSizeY():1,object.getFace(),rect?10:type,rect?def.getBlockingMask():0)) { standing=loc; break; }
  }
  assert.ok(standing,'active map provides a walkable reachable tile on the requested side');
  assert.equal(inside ? standing.getY()<Y : standing.getY()>=Y,true,'standing tile matches entry or exit branch');
  const observed=[], originalGet=skills.getCurrentLevel.bind(skills);
  t.mock.method(skills,'getCurrentLevel',(which)=>{ const value=originalGet(which); if(which===skill && new Error().stack.includes('openDoor')) observed.push(value); return value; });
  await c.dispatch([{type:'object_option',id:DOOR,x:X,y:Y,clickType:1}]);
  let forced=false;
  for(let i=0;i<20;i++) { core.World.process(); forced ||= !!p.getForceMovement(); if(cancelAfterOneTick&&i===0) core.TaskManager.cancelTasks(p); }
  assert.ok(p.getForceMovement()==null,'force movement is inactive');
  assert.equal(skills.getCurrentLevel(skill),current,'visible level preserved through route');
  return {p,forced,observed};
}
test('ordinary qualifying player enters through registered door',async t=>{const f=await attempt(t,40,40,true); assert.ok(f.forced); assert.equal(f.p.getLocation().getY(),Y-1);});
test('base 39 with visible level 40 enters',async t=>{const f=await attempt(t,39,40,true); assert.ok(f.forced); assert.deepEqual(f.observed,[40]); assert.equal(f.p.getLocation().getY(),Y-1);});
test('base and current 39 remain outside',async t=>{const f=await attempt(t,39,39,true); assert.equal(f.forced,false); assert.ok(f.p.getLocation().getY()>=Y);});
test('qualifying player without apron remains outside',async t=>{const f=await attempt(t,40,40,false); assert.equal(f.forced,false); assert.ok(f.p.getLocation().getY()>=Y);});
test('previously qualified drained level still enters',async t=>{const f=await attempt(t,40,39,true); assert.ok(f.forced); assert.equal(f.p.getLocation().getY(),Y-1);});
test('exit remains available without qualification',async t=>{const f=await attempt(t,1,1,false,true); assert.ok(f.forced); assert.equal(f.p.getLocation().getY(),Y);});
// #4647 review: the door swap is world state, so a player-wide task cancel (logging out, a quest) within its two ticks
// must not leave the doorway blocked for everyone.
test('a task cancel for the player mid-swap still puts the guild door back',async t=>{
  const f=await attempt(t,40,40,true,false,true); assert.ok(f.forced);
  const ids=(x,y)=>core.ObjectManager.objectsAt(new core.Location(x,y,0)).map(o=>o.getId());
  assert.equal(ids(X,Y).includes(38848),false,'inviswall gone from the doorway');
  assert.equal(ids(X,Y-1).includes(1539),false,'open door gone from inside');
  assert.ok(core.World.findCacheObject(f.p,DOOR,new core.Location(X,Y,0)),'guild door back');
});
