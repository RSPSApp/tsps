const { Server } = require('../../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../../dist/game/cache/CachePipeline');
const { PluginManager } = require('../../dist/plugins/PluginManager');
const { NpcDefinitionLoader } = require('../../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { Player } = require('../../dist/game/entity/impl/player/Player');
let core;
async function initialize() {
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '../..'));
  new NpcDefinitionLoader().load(); core=PluginManager.getCoreApi(); core.RegionManager.init();
}
function harness(t) {
require('../../plugins/bosses/dukesucellus/Records.DukeSucellus').resetWorld();
  const C=require('../../plugins/bosses/dukesucellus/Common.DukeSucellus');
  const Site=require('../../plugins/bosses/dukesucellus/Site.DukeSucellus');
  const Prep=require('../../plugins/bosses/dukesucellus/Preparation.DukeSucellus');
  const hooks=new Map(), custom=new Map(), tasks=[], spawned=[], packets=[], messages=[], spam=[], emitted=[];
  const namedObjects = new Map(), genericObjects = [];
  const p=new Player(null); p.setUsername('duke-regression');p.setIndex(1);
  const mounted=new Map();
  const sender=new Proxy({}, {get:(_,name)=>(...args)=>{
    if(name==='isSubInterfaceOpen')return [...mounted.values()].includes(args[0]);
    if(name==='sendSubInterface')mounted.set(args[0],args[1]);
    if(name==='closeSubInterface')mounted.delete(args[0]);
    if(name==='sendTypedMessage')spam.push(args[1]);
    packets.push([name,...args]); return sender;
  }});
  p.getPacketSender=()=>sender; p.sendMessage=text=>messages.push(text);
  p.isRegistered=()=>true; p.busy=()=>false; p.performAnimation=()=>{};
  p.performGraphic=()=>{}; p.performGraphicInSlot=()=>{}; p.addTickHit=()=>{};
  p.getSkillManager().setMaxLevels(core.Skill.HITPOINTS,99);
  p.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS,99);
  p.getSkillManager().setCurrentLevel(core.Skill.PRAYER,99);
  const on=name=>fn=>{if(!hooks.has(name))hooks.set(name,[]);hooks.get(name).push(fn);};
  const dispatch=(name,event)=>{for(const fn of hooks.get(name)||[])fn(event);};
  let cycle=0;
  const api=new Proxy({core,persistAttribute(){},registerNpcCombatMethodProvider(){},
    onObjectInteraction(name, actions) {
      if (typeof name === 'function') genericObjects.push(name);
      else namedObjects.set(name, actions);
    },
    spawnNpc(def){const npc=core.NPC.create(def.id,new core.Location(def.x,def.y,def.z));
      npc.isRegistered=()=>!npc.__removed; npc.setOwner(def.owner);spawned.push(npc);return npc;},
    removeNpc(npc){npc.__removed=true;},
    onCustomEvent(name,fn){if(!custom.has(name))custom.set(name,[]);custom.get(name).push(fn);},
    emitCustomEvent(name,event){emitted.push([name,event]);for(const fn of custom.get(name)||[])fn(event);},
  },{get:(api,name)=>api[name]??on(name)});
  t.mock.method(core.World,'getProcessCycle',()=>cycle);
  t.mock.method(core.TaskManager,'submit',task=>{task.setRunning(true);tasks.push(task);});
  t.mock.method(core.TaskManager,'cancelTasks',key=>{for(const task of tasks)if(task.key===key)task.stop();});
  t.mock.method(PluginManager,'emitCombatHitRoll',event=>dispatch('onCombatHitRoll',event));
  t.mock.method(PluginManager,'emitNpcBeforeDeath',event=>{dispatch('onNpcBeforeDeath',event);return event.preventDeath;});
  t.mock.method(PluginManager,'emitNpcDeath',event=>dispatch('onNpcDeath',event));
  C.init(api); Site.attach(api); Prep.attach(api);require('../../plugins/bosses/dukesucellus/Fight.DukeSucellus').attach(api);
  function enter(){api.onCustomEvent('quest:is-complete',e=>{e.complete=true;});Site.enter(p);return C.sessionOf(p);}
  function move(tile){p.setLocation(C.sessionOf(p).tile(tile));}
  function step(n=1){for(let i=0;i<n;i++){cycle++;p.setNeedsPlacement(false);for(const task of [...tasks])if(task.isRunning())task.tick();p.getCombat().getHitQueue().process(cycle);}}
  function add(id,n=1){p.getInventory().add(new core.Item(id,n));}
  function interact(event) {
    const at = event.location;
    event.object ??= new core.GameObject(event.objectId, new core.Location(at.x, at.y, at.z ?? 0), 10, 0);
    event.definition ??= event.object.getDefinition();
    event.clickType ??= 1;
    event.option ??= event.definition?.getInteractions?.()?.[event.clickType - 1];
    for (const handler of genericObjects) {
      handler(event);
      if (event.handled) return true;
    }
    const handler = namedObjects.get(event.definition?.getName?.())?.[event.option];
    if (handler && handler(event) !== false) event.handled = true;
    return event.handled === true;
  }
  t.after(()=>{C.sessionOf(p)?.end();for(const task of tasks)task.stop();
    for(const queue of [core.World.getAddNPCQueue(),core.World.getRemoveNPCQueue()])
      for(let i=queue.length-1;i>=0;i--)if(spawned.includes(queue[i]))queue.splice(i,1);});
  return {core,C,Site,Prep,api,p,enter,move,step,add,dispatch,interact,packets,messages,spam,emitted,
    get session(){return C.sessionOf(p);},get fight(){return C.sessionOf(p)?.fight;}};
}
module.exports={initialize,harness,get core(){return core;}};
