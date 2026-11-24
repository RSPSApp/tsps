// Focused controller reuse: real normal combat classes, isolated instance lifecycle,
// and the Echo service protocol. No server, save mutation, or invented Echo mechanics.
const assert = require('node:assert/strict');
const { test, before, afterEach } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const base = require('../dist/plugins/PluginManager').PluginManager.getCoreApi();
const Cerberus = require('../plugins/bosses/cerberus/Echo.Cerberus');
const Queen = require('../plugins/bosses/kalphitequeen/Echo.KalphiteQueen');
const Kings = require('../plugins/bosses/dagannothkings/Echo.DagannothKings');
const CommonCerberus = require('../plugins/bosses/cerberus/Common.Cerberus');
const Lair = require('../plugins/bosses/cerberus/Lair.Cerberus');
const CommonKings = require('../plugins/bosses/dagannothkings/Common.DagannothKings');
const controllers = { cerberus: Cerberus, 'kalphite-queen': Queen, 'dagannoth-kings': Kings };
const starts = { cerberus: [1292, 1254, 0], 'kalphite-queen': [3508, 9497, 2], 'dagannoth-kings': [1910, 4367, 0] };
const hooks = new Map(), providers = new Map(), configured = [], events = [], tasks = [], spawned = [], objects = [];
const CerberusCombat = require('../plugins/bosses/cerberus/Combat.Cerberus');
const KingMethods = { rex: require('../plugins/bosses/dagannothkings/Fight.Rex.DagannothKings'),
  prime: require('../plugins/bosses/dagannothkings/Fight.Prime.DagannothKings'), supreme: require('../plugins/bosses/dagannothkings/Fight.Supreme.DagannothKings') };
/** The normal ids each Echo encounter spawns, and the normal controller each runs. */
const normal = {
  cerberus: { ids: () => [CommonCerberus.ids.npcs.attacking], method: () => CerberusCombat.combatClass() },
  'kalphite-queen': { ids: () => [base.NpcIdentifiers.KALPHITE_QUEEN_2], method: npc => providers.get(npc.id) },
  'dagannoth-kings': { ids: () => [CommonKings.REX_ID, CommonKings.PRIME_ID, CommonKings.SUPREME_ID], method: npc => KingMethods[npc.__echoKingRole].methodClass() },
};
let denied = false, spawnFailure = false, token = 0;
class Area extends base.PrivateArea {
  constructor() { super(); this.entities = []; this.destroyed = false; }
  add(actor) { this.entities.push(actor); actor.area = this; actor.setArea?.(this); }
  enter(actor) { this.add(actor); }
  getPlayers() { return this.entities.filter(actor => actor.isPlayer?.()); }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; for (const actor of this.entities) if (actor.isNpc?.()) actor.registered = false; this.entities = []; }
  postLeave(actor) { this.entities = this.entities.filter(other => other !== actor); actor.area = null; }
}
function actor(id, x, y, z) {
  const npc = { id, transform: -1, at: new base.Location(x,y,z), hp: 10, profile: { hp: 10, speed: 4, max: 1 }, area: null, registered: true,
    isNpc:()=>true,isPlayer:()=>false,getAsNpc:()=>npc,getId:()=>npc.transform>=0?npc.transform:id,getRealId:()=>id,
    getLocation:()=>npc.at,getPrivateArea:()=>npc.area,isRegistered:()=>npc.registered,getHitpoints:()=>npc.hp,
    getMaxHitpoints:()=>npc.profile.hp,getBaseAttackSpeed:()=>npc.profile.speed,getCurrentDefinition:()=>({getAttackSpeed:()=>npc.profile.speed,getMaxHit:()=>npc.profile.max,getHitpoints:()=>npc.profile.hp}),
    getCombat:()=>({reset(){},attack(target){npc.target=target},getTarget:()=>npc.target,getHitQueue:()=>({clear(){}})}),
    getSize:()=>3,setFlag(){},setUntargetable(value){npc.untargetable=value},setHitpoints(value){npc.hp=value},
    setNpcTransformationId(value){npc.transform=value},getNpcTransformationId:()=>npc.transform,performAnimation(){},performGraphic(){},
    getMovementQueue:()=>({setBlockMovement(){}}),isDyingFunction:()=>false,getPlayersWithinDistance:()=>[] };
  return npc;
}
function player(boss) {
  const attrs = new Map(), p={area:null, at:new base.Location(...starts[boss]),messages:[],
    isPlayer:()=>true,isNpc:()=>false,getAsPlayer:()=>p,getLocation:()=>p.at,getPrivateArea:()=>p.area,
    getAttribute:key=>attrs.get(key),setAttribute:(key,value)=>attrs.set(key,value),moveTo:at=>p.at=at,setLocation:at=>p.at=at,
    getHitpoints:()=>99,isRegistered:()=>true,sendMessage:text=>p.messages.push(text),getPacketSender:()=>({sendConfig(){}}),
    slayer:99,getSkillManager:()=>({getMaxLevel:()=>p.slayer})};
  return p;
}
function emit(name, event) {
  events.push({name,event});
  if(name==='echo-boss:claim') { if(!denied) event.token=`token-${++token}`; return; }
  // Stands in for EchoBosses dressing the normal boss: per-instance HP, speed and max hit.
  // As Sessions does, only the first dressing sets the hitpoints; a form change keeps the damage.
  if(name==='echo-boss:configure') { configured.push({boss:event.boss,role:event.role,id:event.npc.getId()});
    const fresh=!event.npc.dressed;event.npc.dressed=true;event.npc.profile={hp:event.boss==='dagannoth-kings'?1800:900,speed:7,max:61};if(fresh)event.npc.hp=event.npc.profile.hp;
    event.maxHits=[{label:'melee',maxHit:38},{label:'ranged',maxHit:35},{label:'magic',maxHit:49}];event.configured=true;return; }
  for(const fn of hooks.get(name)??[])fn(event);
}
const attach = (name,fn) => hooks.set(name,[...(hooks.get(name)??[]),fn]);
const core={...base,PrivateArea:Area,TaskManager:{submit:task=>tasks.push(task)},
  World:{getNpcsNear:()=>[]},ObjectManager:{register:obj=>objects.push(obj),deregister:obj=>objects.splice(objects.indexOf(obj),1)}};
const api=new Proxy({core,emitCustomEvent:emit,persistAttribute(){},registerArea(){},registerNpcCombatMethodProvider:(list,ctor)=>list.forEach(id=>providers.set(id,ctor)),
  spawnNpc:def=>{if(spawnFailure)return null;const npc=actor(def.id,def.x,def.y,def.z);spawned.push(npc);return npc;},removeNpc:npc=>npc.registered=false,
  onCustomEvent:attach,onNpcDeath:fn=>attach('death',fn),onNpcBeforeDeath:fn=>attach('beforeDeath',fn),onPlayerLogin:fn=>attach('login',fn),onServerShutdown:fn=>attach('shutdown',fn)},
  {get:(target,key)=>target[key]??(()=>{})});
before(async()=>{
  await CachePipeline.initialize(process.cwd());
  CommonCerberus.init(api);Lair.attach(api);Cerberus(api);CommonKings.init(api);Kings(api);
  require('../plugins/bosses/kalphitequeen/Encounter.KalphiteQueen')(api);Queen(api);
});
afterEach(()=>{
  for(const [boss,module] of Object.entries(controllers)) for(const session of [...module._test.sessions.values()]) {
    if(boss==='cerberus') module._test.release(session);else module._test.end(session);
  }
  denied=false;spawnFailure=false;events.length=0;spawned.length=0;tasks.length=0;objects.length=0;configured.length=0;
});
for(const boss of Object.keys(controllers))test(`${boss}: spawns the normal boss privately, dressed with Echo stats, on the normal method`,()=>{
  const p=player(boss),request={player:p,boss,handled:false};emit('echo-boss:start',request);
  const session=controllers[boss]._test.sessions.get(p);assert.ok(session);assert.equal(request.handled,true);
  assert.equal(p.area,session.area);assert.deepEqual(spawned.map(npc=>npc.id),normal[boss].ids(),'the normal boss ids');
  assert.deepEqual(configured.map(row=>row.id),normal[boss].ids(),'each actor configured once as it spawns');
  for(const npc of spawned) {assert.equal(npc.area,p.area);assert.equal(npc.__skipDefaultRespawn,true);assert.equal(npc.hp,boss==='dagannoth-kings'?1800:900);
    const Method=normal[boss].method(npc);assert.ok(Method);assert.equal(new Method().attackSpeed(npc),7,'the per-instance Echo attack speed');}
  if(boss==='cerberus') {
    const fight=session.arena.fight;assert.equal(fight.nextSpecial(()=>.99),'triple','the normal first attack is retained');
    fight.summonSouls(p);assert.equal(spawned.length,4);assert.ok(spawned.every(npc=>npc.area===session.area),'summoned souls stay private');
    assert.ok(objects.every(object=>object.getPrivateArea()===session.area),'firewall belongs to the instance');
  }
});
for(const boss of Object.keys(controllers))test(`${boss}: rejection/spawn failure releases safely without completion`,()=>{
  const p=player(boss);denied=true;emit('echo-boss:start',{player:p,boss});assert.equal(spawned.length,0);assert.equal(p.area,null);
  denied=false;spawnFailure=true;emit('echo-boss:start',{player:p,boss});
  assert.equal(controllers[boss]._test.sessions.size,0);assert.equal(p.area,null);
  assert.equal(events.filter(row=>row.name==='echo-boss:release').length,1);
  assert.equal(events.some(row=>row.name==='echo-boss:completed'),false);
});
test('Echo Cerberus needs 91 Slayer (the cache\'s leagues_echo_cerberus row) but no task',()=>{
  const p=player('cerberus');p.slayer=90;emit('echo-boss:start',{player:p,boss:'cerberus'});
  assert.equal(spawned.length,0);assert.equal(events.some(row=>row.name==='echo-boss:claim'),false,'refused before claiming a session');
  assert.deepEqual(p.messages,['You need a Slayer level of 91 to fight the Echo of Cerberus.']);
  p.slayer=91;emit('echo-boss:start',{player:p,boss:'cerberus'});assert.equal(spawned.length,1);
});
test('Cerberus completes only once and retains normal-task exemption only for its Echo actor',()=>{
  const p=player('cerberus');emit('echo-boss:start',{player:p,boss:'cerberus'});const session=Cerberus._test.sessions.get(p),npc=session.arena.cerberus;
  assert.equal(CommonCerberus.onTask(p,npc),true);assert.equal(CommonCerberus.isCerberus(npc),true);
  emit('death',{npc,killer:p});emit('death',{npc,killer:p});assert.equal(events.filter(row=>row.name==='echo-boss:completed').length,1);
});
test('Kalphite Queen molts into her normal airborne form, re-dressed, and completes only after it',()=>{
  const p=player('kalphite-queen');emit('echo-boss:start',{player:p,boss:'kalphite-queen'});const session=Queen._test.sessions.get(p),npc=session.npc;
  Queen._test.died({npc,killer:p});assert.equal(events.some(row=>row.name==='echo-boss:completed'),false);
  const death={npc,preventDeath:false};emit('beforeDeath',death);assert.equal(death.preventDeath,true);
  assert.notEqual(npc.transform,base.NpcIdentifiers.KALPHITE_QUEEN_3,'she stands in the first form until the molt starts');assert.equal(npc.hp,1);
  assert.equal(tasks.length,1);tasks.shift().execute();
  assert.equal(npc.transform,base.NpcIdentifiers.KALPHITE_QUEEN_3,'the normal airborne form');
  assert.equal(configured.at(-1).role,'air','dressed as the Echo airborne form');
  assert.equal(tasks.length,1);tasks.shift().execute();assert.equal(npc.hp,900,'air form restores its own profile health');assert.equal(npc.untargetable,false);
  emit('death',{npc,killer:p});emit('death',{npc,killer:p});assert.equal(events.filter(row=>row.name==='echo-boss:completed').length,1);
});
test('all three Kings have independent HP and one encounter completion after the last king',()=>{
  const p=player('dagannoth-kings');emit('echo-boss:start',{player:p,boss:'dagannoth-kings'});const session=Kings._test.sessions.get(p),[rex,prime,supreme]=session.npcs;
  rex.hp=1;assert.equal(prime.hp,1800);assert.equal(supreme.hp,1800);
  for(const npc of [rex,prime]){emit('death',{npc,killer:p});emit('death',{npc,killer:p});}
  assert.equal(events.some(row=>row.name==='echo-boss:completed'),false);
  emit('death',{npc:supreme,killer:p});emit('death',{npc:supreme,killer:p});
  const completed=events.filter(row=>row.name==='echo-boss:completed');assert.equal(completed.length,1);assert.equal(completed[0].event.npcs.length,3);
});
test('Echo Queen uses canonical style maxima while retaining ordinary PendingHit processing',()=>{
  const p=player('kalphite-queen');emit('echo-boss:start',{player:p,boss:'kalphite-queen'});const npc=Queen._test.sessions.get(p).npc;
  const originalHit=core.PendingHit,originalMisc=core.Misc;
  try {
    core.PendingHit=class {constructor(attacker,target,method,config){this.config=config;}};
    core.Misc={...originalMisc,randomInclusive:(min,max)=>max};
    const {createHit}=require('../plugins/bosses/kalphitequeen/Encounter.KalphiteQueen')._test;
    for(const [style,max] of [[core.CombatType.MELEE,38],[core.CombatType.RANGED,35],[core.CombatType.MAGIC,49]]) {
      const hit=createHit(npc,p,{type:()=>style},3);
      assert.deepEqual(hit.config,{delay:3,damage:max});
      assert.equal(hit.config.rollAccuracy,undefined,'normal accuracy/protection processing remains enabled');
    }
    const hit=createHit({},p,{type:()=>core.CombatType.MELEE},3);assert.equal(hit.config,3,'ordinary Queen remains unchanged');
  } finally {core.PendingHit=originalHit;core.Misc=originalMisc;}
});
for(const boss of Object.keys(controllers))test(`${boss}: logout destroys hazards and allows safe reconnect outside`,()=>{
  const p=player(boss);emit('echo-boss:start',{player:p,boss});const session=controllers[boss]._test.sessions.get(p);
  session.area.postLeave(p,true);assert.equal(session.area.isDestroyed(),true);assert.equal(controllers[boss]._test.sessions.has(p),false);
  assert.equal(events.filter(row=>row.name==='echo-boss:release').length,1);assert.equal(events.some(row=>row.name==='echo-boss:completed'),false);
  assert.equal(objects.length,0);
});
