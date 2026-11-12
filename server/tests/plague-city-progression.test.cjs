const assert = require('node:assert/strict');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, quest, hooks, itemOnObject, variant, line, action, named;
before(async () => {
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  hooks = new Map(); named = new Map();
  const dispatch = (name, event) => { for (const fn of hooks.get(name) ?? []) fn(event); };
  const api = new Proxy({core, persistAttribute() {}, emitCustomEvent: dispatch,
    onCustomEvent(name, fn) { hooks.set(name, [...hooks.get(name) ?? [], fn]); },
    onNpcDialogueVariant(fn) { variant = fn; },
    onItemOnObject(fn) { itemOnObject = fn; },
    onObjectInteraction(name, map) { named.set(name, map); },
  }, {get: (target, key) => key in target ? target[key] : () => {}});
  require('../plugins/quests/quests/PlagueCity.Quest')(api);
  quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'plague_city');
  action = event => dispatch('npc-dialogue:action', event);
  line = event => dispatch('npc-dialogue:line', event);
});
function fixture(stage) {
  const player = new Player(null), vars = new Map(), messages = [];
  const sender = new Proxy({}, {get: (_, key) => ['getVarbit', 'getVarp'].includes(key) ? () => 0 : key === 'sendVarbit' ? (id, value) => { vars.set(id, value); return sender; } : () => sender});
  player.getPacketSender = () => sender;
  player.sendMessage = text => messages.push(text);
  player.setAttribute('quest.plague_city.stage', stage);
  player.setLocation(new core.Location(2566, 3332, 0));
  return {player, vars, messages, inv: player.getInventory()};
}
function give(inv, id, n = 1) { inv.add(new core.Item(id, n), false); }
function act(player, npcId, stepId) { action({player, npcId, stepId}); }
test('Alrena handover is atomic, repeat safe, and a cancelled talk spends nothing', () => {
  const {player, inv} = fixture(1), I = core.ItemIdentifiers, npcId = core.NpcIdentifiers.ALRENA;
  give(inv, I.DWELLBERRIES);
  variant({player, npcId});
  assert.equal(inv.getAmount(I.DWELLBERRIES), 1);
  assert.equal(quest.getStage(player), 1);
  act(player, npcId, 'Br9tOd');
  assert.equal(inv.getAmount(I.DWELLBERRIES), 0);
  assert.equal(inv.getAmount(I.GAS_MASK), 1);
  assert.equal(quest.getStage(player), 2);
  act(player, npcId, 'Br9tOd');
  assert.equal(inv.getAmount(I.GAS_MASK), 1);
});
test('Edmond instruction unlocks exactly four conserved bucket exchanges', () => {
  const {player, inv} = fixture(2), I = core.ItemIdentifiers;
  give(inv, I.BUCKET_OF_WATER, 5);
  const water = () => itemOnObject({player, itemId: I.BUCKET_OF_WATER, objectId: core.ObjectIdentifiers.MUD_PATCH_2, location: {x:2566,y:3331,z:0}});
  water(); assert.equal(inv.getAmount(I.BUCKET_OF_WATER), 5);
  line({player, npcId:core.NpcIdentifiers.EDMOND_2, text:"I've already tried digging down to them but the soil is rock hard. You'll need to pour on several buckets of water to soften it up. I reckon four buckets should do it."});
  assert.equal(quest.getStage(player), 3);
  for (let n = 1; n <= 4; n++) { water(); assert.equal(quest.getStage(player), 3+n); }
  water();
  assert.equal(inv.getAmount(I.BUCKET_OF_WATER), 1);
  assert.equal(inv.getAmount(I.BUCKET), 4);
});
test('book action consumes once and rejects absent books', () => {
  const {player, inv} = fixture(20), I = core.ItemIdentifiers, npc = core.NpcIdentifiers.TED_REHNISON;
  act(player,npc,'zQse1w'); assert.equal(quest.getStage(player),20);
  give(inv,I.BOOK_2); act(player,npc,'zQse1w');
  assert.equal(quest.getStage(player),21); assert.equal(inv.getAmount(I.BOOK_2),0);
  act(player,npc,'zQse1w'); assert.equal(quest.getStage(player),21);
});
test('Bravek only consumes cure and grants warrant at the actual transcript handovers', () => {
  const {player, inv} = fixture(26), I=core.ItemIdentifiers, npc=core.NpcIdentifiers.BRAVEK;
  give(inv,I.HANGOVER_CURE);
  variant({player,npcId:npc}); assert.equal(inv.getAmount(I.HANGOVER_CURE),1); assert.equal(quest.getStage(player),26);
  act(player,npc,'nxSgWb'); assert.equal(inv.getAmount(I.A_SCRUFFY_NOTE),1);
  act(player,npc,'Pn2ogc'); assert.equal(inv.getAmount(I.WARRANT),0,'no warrant before the cure');
  // Capture 20261110T113734-5ab63b4 tick 672: the stage moves as Bravek drinks the cure.
  act(player,npc,'Z2OftI'); assert.equal(inv.getAmount(I.HANGOVER_CURE),0); assert.equal(quest.getStage(player),27);
  act(player,npc,'Pn2ogc'); assert.equal(inv.getAmount(I.WARRANT),1); assert.equal(quest.getStage(player),27);
  act(player,npc,'Pn2ogc'); assert.equal(inv.getAmount(I.WARRANT),1);
});
test('barrel is location scoped, and Elena requires the cell unlock with its key', () => {
  const {player, inv}=fixture(27), I=core.ItemIdentifiers, O=core.ObjectIdentifiers, npc=core.NpcIdentifiers.ELENA_2;
  // Talk-to only reaches Elena in the open cell (capture tick 775: "I can't reach that!" through the door).
  assert.match(variant({player,npcId:npc}),/after-unlocking/);
  assert.equal(quest.getStage(player),27);
  const locked = {player,npcId:npc,stepId:'Gtrtgc',kind:'message',handled:false};
  action(locked);assert.equal(locked.handled,false);assert.deepEqual(locked.box,{statement:true});
  const barrel=named.get('Barrel').Search;
  assert.equal(barrel({player,objectId:O.BARREL_11,location:{x:3221,y:9910,z:0}}),false);
  barrel({player,objectId:O.BARREL_11,location:{x:2534,y:3268,z:0}}); assert.equal(inv.getAmount(I.A_SMALL_KEY),1);
  const key={player,itemId:I.A_SMALL_KEY,objectId:O.DOOR_78,location:{x:2539,y:9672,z:0}};
  itemOnObject(key); assert.equal(key.handled,true);
  assert.equal(quest.getStage(player),27,'Elena is freed by her conversation, not the key');
  assert.equal(inv.getAmount(I.A_SMALL_KEY),1);
});
test('water and barrel handlers leave unrelated objects and missing supplies alone', () => {
 const {player,inv}=fixture(3),I=core.ItemIdentifiers,O=core.ObjectIdentifiers;
 give(inv,I.BUCKET_OF_WATER);
 const e={player,itemId:I.BUCKET_OF_WATER,objectId:O.MUD_PATCH_2,location:{x:3000,y:3331,z:0}};
 itemOnObject(e);assert.equal(e.handled,undefined);assert.equal(inv.getAmount(I.BUCKET_OF_WATER),1);
 itemOnObject({...e,location:{x:2566,y:3331,z:0}});
 assert.equal(quest.getStage(player),4);
 itemOnObject({...e,location:{x:2566,y:3331,z:0}});assert.equal(quest.getStage(player),4);
});
test('grill requires attempted opening before accepting one rope and publishes native rope/removed morphs', () => {
 const {player,inv,vars}=fixture(8),I=core.ItemIdentifiers,O=core.ObjectIdentifiers,location={x:2514,y:9739,z:0};
 give(inv,I.ROPE);
 // The pre-attempt branch starts the existing transcript; isolate the actual opening and accepted handover here.
 named.get('Grill').Open({player,objectId:11422,location});
 assert.equal(vars.get(1786),1);
 itemOnObject({player,itemId:I.ROPE,objectId:11422,location});
 assert.equal(quest.getStage(player),9);assert.equal(inv.getAmount(I.ROPE),0);assert.equal(vars.get(1787),1);
 itemOnObject({player,itemId:I.ROPE,objectId:11422,location});assert.equal(quest.getStage(player),9);
 // The pull is Edmond's scene now (capture ticks 268-301); the stage moves at its end.
 const pull={player,npcId:core.NpcIdentifiers.EDMOND_2,stepId:'oCU2uO',handled:false};
 action(pull);assert.equal(pull.handled,true);assert.equal(pull.end,true);assert.equal(quest.getStage(player),9);
});
test('mask replacement has capacity and repeat guards, including an equipped mask', () => {
 const {player,inv}=fixture(2),I=core.ItemIdentifiers,npc=core.NpcIdentifiers.ALRENA;
 for(let n=0;n<28;n++)give(inv,I.BUCKET);
 act(player,npc,'jG6mG3');assert.equal(inv.getAmount(I.GAS_MASK),0);
 inv.deleteNumber(I.BUCKET,1);act(player,npc,'jG6mG3');assert.equal(inv.getAmount(I.GAS_MASK),1);
 act(player,npc,'jG6mG3');assert.equal(inv.getAmount(I.GAS_MASK),1);
 inv.deleteNumber(I.GAS_MASK,1);player.getEquipment().setItem(core.Equipment.HEAD_SLOT,new core.Item(I.GAS_MASK));
 act(player,npc,'jG6mG3');assert.equal(inv.getAmount(I.GAS_MASK),0);
});
test('full inventory can exchange its dwellberry for a mask without dropping either item', () => {
 const {player,inv}=fixture(1),I=core.ItemIdentifiers;
 give(inv,I.DWELLBERRIES);for(let n=0;n<27;n++)give(inv,I.BUCKET);
 act(player,core.NpcIdentifiers.ALRENA,'Br9tOd');
 assert.equal(inv.getAmount(I.DWELLBERRIES),0);assert.equal(inv.getAmount(I.GAS_MASK),1);assert.equal(inv.getFreeSlots(),0);
});
test('clerk permission waits for the actual permission line', () => {
 const {player}=fixture(24),npcId=core.NpcIdentifiers.CLERK;
 variant({player,npcId});assert.equal(quest.getStage(player),24);
 line({player,npcId,text:'I suppose they can come in then. If they keep it short.'});assert.equal(quest.getStage(player),25);
});
test('warrant entry: the mourner speaks first, then the sneak-in opens the door through Doors', () => {
 const runtime=require('../plugins/quests/QuestRuntime'), original=runtime.startTranscript, events=new Map(), operations=[], transcripts=[];
 const dispatch=(name,event)=>{ for(const fn of events.get(name)??[])fn(event); };
 const doorCore={...core,
  ObjectManager:{register:o=>operations.push(['register',o.getId()]),deregister:o=>operations.push(['deregister',o.getId()])},
  TaskManager:{submit(){}},Sounds:{...core.Sounds,sendSound(){}},
 };
 core.ObjectDefinition.init();
 let handover;
 const api=new Proxy({core:doorCore,persistAttribute(){},emitCustomEvent:dispatch,
  onCustomEvent(name,fn){events.set(name,[...events.get(name)??[],fn]);if(name==='npc-dialogue:action')handover=fn;},
 },{get:(target,key)=>key in target?target[key]:()=>{}});
 try{
  runtime.startTranscript=(_api,_player,_npc,_page,variant)=>{transcripts.push(variant);return true;};
  require('../plugins/quests/quests/PlagueCity.Quest')(api);
 }finally{runtime.startTranscript=original;}
 require('../plugins/objects/Doors.plugin').register(api);
 const {player,inv}=fixture(27);
 give(inv,core.ItemIdentifiers.WARRANT);
 player.setLocation(new core.Location(2533,3273,0));
 const object=new core.GameObject(37321,new core.Location(2533,3272,0),0,3);
 const click={player,object,objectId:37321,location:{x:2533,y:3272,z:0},handled:false};
 dispatch('door:toggle',click);
 assert.equal(click.handled,true,'from outside, the mourner answers the door (capture ticks 716-722)');
 assert.deepEqual(transcripts,['freeing-elena-attempting-to-enter-the-plague-house-with-the-warrant']);
 player.setLocation(new core.Location(2533,3272,0));
 dispatch('door:open',{player,object,handled:false});
 assert.equal(transcripts.length,1,'door:open must not restart the warrant dialogue');
 assert.ok(operations.some(([op,id])=>op==='register'&&id===37322),'the pass-through door opens');
 assert.equal(quest.getStage(player),27);
 assert.equal(inv.getAmount(core.ItemIdentifiers.WARRANT),1);
});

test('the locked-cell plea does not take over Elena outside Plague City', () => {
  const {player}=fixture(0);
  assert.equal(variant({player,npcId:core.NpcIdentifiers.ELENA_2}),null);
  player.setAttribute('quest.plague_city.stage',27);
  assert.equal(variant({player,npcId:core.NpcIdentifiers.ELENA}),null);
});
