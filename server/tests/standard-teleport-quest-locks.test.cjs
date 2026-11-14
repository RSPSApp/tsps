// Run after `yarn build`: node --test tests/standard-teleport-quest-locks.test.cjs
// Wiki (Standard spellbook): Kourend Castle Teleport needs Client of Kourend, Ardougne Teleport Plague City, Civitas illa
// Fortis Teleport Twilight's Promise and Trollheim Teleport Eadgar's Ruse. They cast without the quest. Real engine:
// every plugin loaded, a real Player, the spell cast by a native widget_action packet.
const assert=require('node:assert/strict'),path=require('node:path');
const {before,after,test}=require('node:test');
process.env.DISABLE_PLAYER_BOTS='1';
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {PlayerSession}=require('../dist/net/PlayerSession');
const {ClientConnection}=require('../dist/net/NetworkBuilder');
let core,index=4600;
before(async()=>{await CachePipeline.initialize(path.resolve(__dirname,'..'));core=PM.getCoreApi();PM.loadFromDirectory(path.resolve(__dirname,'../plugins'));core.RegionManager.init();core.RegionManager.loadMapFiles(3200,3200);core.RegionManager.loadMapFiles(2796,2798);PM.emitServerStartup({});});
after(()=>PM.emitServerShutdown({}));
function actor(t,{plagueCity}){
 const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
 const p=new Player(new PlayerSession(channel));p.setIndex(index++);p.setUsername('ardytele'+index);p.setRegistered(true);p.setLocation(new core.Location(3200,3200,0));p.needsPlacement=false;p.setAttribute('bot-skip-persistence',true);
 const conn=new ClientConnection(channel);conn.player=p;
 t.after(()=>{const fishier=require('../plugins/skills/sailing/charting/FishierStout.Charting'),area=fishier.scenes.get(p)?.area;PM.emitPlayerLogout({player:p,username:p.getUsername()});p.closeInterruptibleInterfaces();p.setRegistered(false);core.TaskManager.cancelTasks(p);core.TaskManager.cancelTasks(p.getIndex());for(const npc of [...core.World.getNpcs()])if(npc?.getOwner?.()===p)PM.removeNpc(npc);assert.equal([...core.World.getNpcs()].some(npc=>npc?.getOwner?.()===p),false);assert.equal(fishier.scenes.has(p),false);if(area)assert.equal(area.isDestroyed(),true);});
 p.setSpellbook(core.MagicSpellbook.NORMAL);p.getSkillManager().setMaxLevels(core.Skill.MAGIC,99,false);p.getSkillManager().setCurrentLevel(core.Skill.MAGIC,99,false);
 const q=require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(x=>x.key==='plague_city');assert.ok(q);q.setStage(p,plagueCity?q.completionValue:0);
 for(const [id,n] of [[563,2],[555,2]])p.getInventory().add(new core.Item(id,n),false);
 const messages=[],send=p.sendMessage.bind(p);t.mock.method(p,'sendMessage',(...args)=>{messages.push(args[0]);return send(...args);});
 return {p,conn,messages};
}
async function cast(f){const spell=core.CacheDefinitions.getSpellByName('Ardougne Teleport');assert.ok(spell);const w=spell.widgetId;await f.conn.dispatch([{type:'widget_action',widgetId:w,groupId:w>>>16,childId:w&65535,slot:-1,buttonNum:1}]);f.conn.processTurnPackets();for(let i=0;i<8;i++)core.TaskManager.process();}

test('Ardougne Teleport is refused before Plague City, and spends nothing',async t=>{
 const f=actor(t,{plagueCity:false});await cast(f);
 assert.ok(f.messages.includes('You must have completed Plague City to use this spell.'),f.messages.join(' | '));
 assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[3200,3200],'not moved');
 assert.equal(f.p.getInventory().getAmount(563),2,'no law runes spent');
});

async function readScroll(f){const id=core.ItemIdentifiers.ARDOUGNE_TELEPORT_SCROLL;await f.conn.dispatch([{type:'inventory_action',slot:f.p.getInventory().getSlotForItemId(id),itemId:id,widgetId:3214,option:'Read'}]);f.conn.processTurnPackets();}

test("after Plague City the spell waits for Edmond's scroll; reading it teaches the spell (Wiki)",async t=>{
 const f=actor(t,{plagueCity:true});await cast(f);
 assert.ok(f.messages.includes("You need to read Edmond's magic scroll to cast this spell."),f.messages.join(' | '));
 assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[3200,3200],'not moved before reading');
 const scroll=core.ItemIdentifiers.ARDOUGNE_TELEPORT_SCROLL;
 f.p.getInventory().add(new core.Item(scroll,2),false);
 await readScroll(f);
 assert.ok(f.messages.includes('You memorise what is written on the scroll. You can now use the Ardougne Teleport Spell.'));
 assert.equal(f.p.getInventory().getAmount(scroll),1,'the read scroll is used up');
 await readScroll(f);
 assert.equal(f.p.getInventory().getAmount(scroll),0,'a further scroll explodes');
 assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.ASHES),1,'into ashes');
 await cast(f);
 assert.notDeepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[3200,3200],'teleported');
});

test("Edmond gives a replacement scroll after the quest when none is carried (Wiki), and needs a free slot", async t => {
 const f=actor(t,{plagueCity:true}),scroll=core.ItemIdentifiers.ARDOUGNE_TELEPORT_SCROLL,edmond=core.NpcIdentifiers.EDMOND_2;
 const step={type:'line',speaker:'Edmond',text:'Yes, here you go.'};
 const line=()=>PM.emitCustomEvent('npc-dialogue:line',{player:f.p,npcId:edmond,step,text:step.text,skip:false});
 line();
 assert.equal(f.p.getInventory().getAmount(scroll),1,'a new scroll');
 line();
 assert.equal(f.p.getInventory().getAmount(scroll),1,'not a second while one is carried');
 const inv=f.p.getInventory();
 inv.resetItems();
 for(let slot=0;slot<inv.capacity();slot++)inv.setItem(slot,new core.Item(1511,1));
 line();
 assert.equal(inv.getAmount(scroll),0,'no room: none given');
});

test("a real Talk-to with Edmond after Plague City reaches his scroll offer, ahead of Song of the Elves", async t => {
 const f=actor(t,{plagueCity:true}),scroll=core.ItemIdentifiers.ARDOUGNE_TELEPORT_SCROLL,id=core.NpcIdentifiers.EDMOND_2;
 const npc=PM.spawnNpc({id,x:3201,y:3200,z:0,wanderRadius:0},'EdmondScrollTest');
 assert.ok(npc);
 t.after(()=>PM.removeNpc(npc));
 assert.equal(PM.emitNpcInteraction({player:f.p,npc,npcId:id,clickType:1,handled:false}),true);
 const sender=f.p.getPacketSender(),send=async packet=>{await f.conn.dispatch([packet]);f.conn.processTurnPackets();};
 let asked=false;
 for(let i=0;i<40;i++){
  const menu=core.MultiChatboxPrompt.getPending(f.p);
  if(menu){
   const option=menu.options.indexOf('Do you have any more of those scrolls?');
   assert.ok(option>=0,menu.options.join(', '));
   asked=true;
   await send({type:'dialogue_continue',widgetId:core.MultiChatboxPrompt.OPTIONS_WIDGET_ID,childIndex:option+1});
  } else if(f.p.getDialogueManager().isActive()){
   const group=sender.getChatboxGroupId();
   await send({type:'dialogue_continue',widgetId:(group<<16)|(group===229?4:5),childIndex:-1});
  } else break;
 }
 assert.ok(asked,"Edmond's Plague City dialogue offered the scroll");
 assert.ok(!f.messages.some(m=>/to start this quest/.test(m)),'not Song of the Elves');
 assert.equal(f.p.getInventory().getAmount(scroll),1,'a new scroll from his dialogue');
});
