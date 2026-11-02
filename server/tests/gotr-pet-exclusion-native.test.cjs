const assert = require('node:assert/strict'), path = require('node:path');
const {before, after, test} = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const {ClientConnection} = require('../dist/net/NetworkBuilder');
let core, PlayerSave, next = 1250;

before(async () => { await CachePipeline.initialize(path.resolve(__dirname,'..')); PM.loadFromDirectory(path.resolve(__dirname,'../plugins')); core=PM.getCoreApi(); ({PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave')); core.RegionManager.init(); core.RegionManager.loadMapFiles(3222,3218); core.RegionManager.loadMapFiles(2611,3295); PM.emitServerStartup({}); });
after(() => PM.emitServerShutdown({}));
const item = name => core.CacheDefinitions.getObjId(name);
function actor(t) {
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('gotrpet'+next); p.setRegistered(true); p.setLocation(new core.Location(3222,3218,0)); p.needsPlacement=false;
  const c=new ClientConnection(channel); c.player=p;
  t.after(()=>{PM.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());for(const n of [...core.World.getNpcs()])if(n?.getOwner?.()===p)core.World.getNpcs().remove(n);});
  return {p,c};
}
async function drain(f) { for(let i=0;i<10;i++){core.TaskManager.processWalkTo(f.p.getIndex());f.p.getMovementQueue().process();core.TaskManager.process();} }
async function send(f, packet) {await f.c.dispatch([packet]);f.c.processTurnPackets();await drain(f);}
const Game=require('../plugins/minigames/guardiansoftherift/Game.GuardiansOfTheRift');
const Shared=require('../plugins/minigames/guardiansoftherift/Shared.GuardiansOfTheRift');
const Altars=require('../plugins/minigames/guardiansoftherift/Altars.GuardiansOfTheRift');
function setupAltar(t,f,name,trip){const id=core.CacheDefinitions.getLocId(name);assert.ok(id>0);const [x,y]=trip?.arrival??[3222,3218];core.RegionManager.loadMapFiles(x,y);f.p.setLocation(new core.Location(x,y,0));f.p.needsPlacement=false;if(trip)f.p.__gotrTrip=trip;const object=new core.GameObject(id,new core.Location(x+1,y,0),10,0,null);core.ObjectManager.register(object,true);t.after(()=>{Game.leave(f.p);core.ObjectManager.deregister(object,true);});return object;}
async function craft(f,object){f.p.getPacketSender().sendInterfaceRemoval();await send(f,{type:'object_option',id:object.getId(),x:object.getLocation().getX(),y:object.getLocation().getY(),action:'Craft-rune'});}
for(const altar of Altars.ALTARS)test('native GOTR '+altar.key+' binding preserves rewards without a Rift guardian award',async t=>{
 const f=actor(t);f.p.getSkillManager().setCurrentLevel(core.Skill.RUNECRAFTING,99);f.p.getSkillManager().setMaxLevel(core.Skill.RUNECRAFTING,99);
 const object=setupAltar(t,f,altar.altar,altar);Game._game.phase=Game.PHASE.ATTACK;Game._game.elapsed=0;Game._game.altars={elemental:1,catalytic:1,changesIn:33};Game.join(f.p);assert.equal(Game.isPlaying(f.p),true);
 const essence=item(Shared.ITEM.ESSENCE),stone=item(altar.type==='elemental'?Shared.ITEM.ELEMENTAL_STONE:Shared.ITEM.CATALYTIC_STONE),rune=item(altar.key+'rune');
 const request={player:f.p,objectId:object.getId(),rune:null};PM.emitCustomEvent('runecrafting:altar-rune',request);assert.ok(request.rune);assert.equal(request.rune.runeId,rune);
 f.p.getInventory().add(new core.Item(essence,2),true);f.p.getInventory().add(new core.Item(item(Shared.ITEM.UNCHARGED_CELL)),true);
 const xp=f.p.getSkillManager().getExperience(core.Skill.RUNECRAFTING);t.mock.method(Math,'random',()=>0);
 await craft(f,object);assert.equal(Game.isPlaying(f.p),true,'real altar trip remains in the game');assert.equal(f.p.getInventory().getAmount(essence),0,'guardian essence consumed');assert.equal(f.p.getInventory().getAmount(rune),2*request.rune.amount);assert.equal(f.p.getInventory().getAmount(stone),2);assert.equal(f.p.getInventory().getAmount(item(Shared.ITEM.CELLS[altar.tier-1])),1);assert.ok(f.p.getSkillManager().getExperience(core.Skill.RUNECRAFTING)>xp);
 assert.equal(Boolean(f.p.getAttribute('pets:current')),false,'GOTR must not create a follower');assert.deepEqual(f.p.getAttribute('pets.owned')??[],[]);assert.equal(f.p.getAttribute('clog.items')?.[item('skillpetrunecrafting_fire')]??0,0);
 const earned=f.p.getSkillManager().getExperience(core.Skill.RUNECRAFTING);await craft(f,object);assert.equal(f.p.getSkillManager().getExperience(core.Skill.RUNECRAFTING),earned);assert.equal(f.p.getInventory().getAmount(stone),2);
 const saved=PlayerSave.fromPlayer(f.p);const g=actor(t);saved.applyToPlayer(g.p);assert.deepEqual(g.p.getAttribute('pets.owned')??[],[]);assert.equal(g.p.getAttribute('pets:active-item')??null,null);
});
test('the same ordinary altar outside GOTR still awards its normal per-essence pet',async t=>{const f=actor(t),object=setupAltar(t,f,'air_altar');f.p.getSkillManager().setCurrentLevel(core.Skill.RUNECRAFTING,99);f.p.getSkillManager().setMaxLevel(core.Skill.RUNECRAFTING,99);f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RUNE_ESSENCE,2),true);t.mock.method(Math,'random',()=>0);await craft(f,object);assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.RUNE_ESSENCE),0);assert.ok(f.p.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE)>0);assert.ok(f.p.getAttribute('pets:current')?.isRegistered());assert.equal(f.p.getAttribute('clog.items')?.[item('skillpetrunecrafting_fire')],1);});
test('ordinary essence fallback in the same GOTR trip keeps crafting without granting a pet',async t=>{
 const f=actor(t),altar=Altars.ALTARS.find(a=>a.key==='air'),object=setupAltar(t,f,altar.altar,altar);
 f.p.getSkillManager().setCurrentLevel(core.Skill.RUNECRAFTING,99);f.p.getSkillManager().setMaxLevel(core.Skill.RUNECRAFTING,99);
 Game._game.phase=Game.PHASE.ATTACK;Game._game.elapsed=0;Game._game.altars={elemental:1,catalytic:1,changesIn:33};Game.join(f.p);
 f.p.getInventory().add(new core.Item(item(Shared.ITEM.ESSENCE),2),true);f.p.getInventory().add(new core.Item(core.ItemIdentifiers.PURE_ESSENCE,2),true);t.mock.method(Math,'random',()=>0);
 await craft(f,object);assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.PURE_ESSENCE),2);const xp=f.p.getSkillManager().getExperience(core.Skill.RUNECRAFTING),runes=f.p.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE);
 await craft(f,object);assert.equal(Game.isPlaying(f.p),true);assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.PURE_ESSENCE),0);assert.ok(f.p.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE)>runes);assert.ok(f.p.getSkillManager().getExperience(core.Skill.RUNECRAFTING)>xp);assert.equal(Boolean(f.p.getAttribute('pets:current')),false);assert.deepEqual(f.p.getAttribute('pets.owned')??[],[]);assert.equal(f.p.getAttribute('clog.items')?.[item('skillpetrunecrafting_fire')]??0,0);
});
test('native GOTR altar exit portal returns the trip to the temple, not the ruins (whatever loads first)',async t=>{
 const f=actor(t),altar=Altars.ALTARS.find(a=>a.key==='law'),object=setupAltar(t,f,altar.exit,altar);
 Game._game.phase=Game.PHASE.ATTACK;Game._game.elapsed=0;Game._game.altars={elemental:1,catalytic:1,changesIn:33};Game.join(f.p);
 core.RegionManager.loadMapFiles(3615,9491);
 await send(f,{type:'object_option',id:object.getId(),x:object.getLocation().getX(),y:object.getLocation().getY(),action:'Use'});
 assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[3615,9491]);assert.equal(Game.isPlaying(f.p),true);
});
