const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
let core, next = 2000;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218); PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
function actor(t) {
  const channel = {kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('pettalk'+next);
  p.setRegistered(true); p.setLocation(new core.Location(3222,3218,0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { PM.emitPlayerLogout({player:p,username:p.getUsername()}); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex());
    for (const n of [...core.World.getNpcs()]) if (n?.getOwner?.() === p) core.World.getNpcs().remove(n); });
  return {p,c};
}
async function input(f,message) {
  await f.c.dispatch([message]); f.c.processTurnPackets();
  for(let i=0;i<4;i++){core.TaskManager.processWalkTo(f.p.getIndex());f.p.getMovementQueue().process();core.TaskManager.process();}
}
async function summon(f,id) {
  f.p.getPacketSender().sendInterfaceRemoval(); if(!f.p.getInventory().contains(id))f.p.getInventory().add(new core.Item(id),true);
  await input(f,{type:'inventory_action',itemId:id,slot:f.p.getInventory().getSlotForItemId(id),widgetId:149<<16,option:'Drop',optionIndex:5});
  const n=f.p.getAttribute('pets:current'); assert.ok(n?.isRegistered()); return n;
}
async function talk(f,n) {
  const op=n.getCurrentDefinition(f.p).getActions().findIndex(x=>x==='Talk-to')+1; assert.ok(op>0,n.getCurrentDefinition(f.p).getName());
  await input(f,{type:'npc_option',index:n.getIndex(),clickType:op});
}
const text=f=>f.p.getDialogueManager().getCurrent()?.getText?.()?.replace(/\s+/g,' ');
test('native owned Olmlet Talk-to opens its canonical menu and returns after an answer',async t=>{
  const f=actor(t),n=await summon(f,core.ItemIdentifiers.OLMLET);await talk(f,n);
  assert.equal(text(f),'Hee hee! What shall we talk about, human?');
  await input(f,{type:'dialogue_continue',widgetId:(231<<16)|5,childIndex:-1});
  assert.deepEqual(MultiChatboxPrompt.getPending(f.p)?.options,['Where do creatures like you come from?','You look like a dragon.','Can you tell me secrets about your home?','Maybe another time.']);
  await input(f,{type:'dialogue_continue',widgetId:(219<<16)|1,childIndex:1});
  assert.equal(text(f),'Where do creatures like you come from?');
  await input(f,{type:'dialogue_continue',widgetId:(217<<16)|5,childIndex:-1});
  assert.equal(text(f),"From eggs, of course! You can't make an olmlet without breaking an egg.");
  assert.equal(f.p.getAttribute('pets:current'),n);assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.OLMLET),0);
});
test('all eight physical Olmlet items select the matching form, including shared enraged and flying dialogue',async t=>{
  t.mock.method(Math,'random',()=>0);
  const expected = new Map([
    ['Olmlet','Hee hee! What shall we talk about, human?'],['Puppadile','What lovely teeth you have!'],['Tektiny','You look hot.'],
    ['Enraged Tektiny','You look hot.'],['Vanguard','Learn ye of the Judgement of the Vanguard. The form we have taken.'],
    ['Vasa Minirio','The Dark Altar! The power it has given. Xeric, you cannot comprehend!'],['Vespina','Hello'],['Flying Vespina','Hello']]);
  const pets=require('../plugins/npcs/Pets.plugin').__internals;
  const forms=pets.PETS.filter(p=>pets.petFamily(p)===`item:${core.ItemIdentifiers.OLMLET}`);assert.equal(forms.length,8);
  for(const pet of forms){const f=actor(t),n=await summon(f,pet.itemId);await talk(f,n);assert.equal(text(f),expected.get(n.getDefinition().getName()),n.getDefinition().getName());}
});
test('Puppadile random alternatives remain random conversations rather than a choice menu',async t=>{
  const f=actor(t),id=core.ItemIdentifiers.PUPPADILE,n=await summon(f,id);
  const rng=t.mock.method(Math,'random',()=>0);
  for(const [value,expected]of [[0,'What lovely teeth you have!'],[0.5,'Want to play fetch?'],[0.999,'Om nom nom good meat.']]){
    rng.mock.mockImplementation(()=>value);await talk(f,n);assert.equal(text(f),expected);assert.equal(f.p.getDialogueManager().getCurrent()?.getOptions,undefined);
  }
});
test('exact page and variant starts refuse missing flat variants and unrelated indexed pages',async t=>{
  const f=actor(t),n=await summon(f,core.ItemIdentifiers.OLMLET);
  for(const variant of [{page:'Cook',variant:'standard-dialogue'},{page:'Olmlet',variant:'does-not-exist'}]){
    const r={player:f.p,npc:n,npcId:n.getId(),variant,exact:true,handled:false};PM.emitCustomEvent('npc-dialogue:start',r);assert.equal(r.handled,false);assert.equal(f.p.getDialogueManager().isActive(),false);
  }
  const id=require('../plugins/npcs/Pets.plugin').__internals.PETS.find(p=>p.enumName==='BUTCH').petId;
  assert.ok(id>0);
  const r={player:f.p,npcId:id,variant:'does-not-exist',exact:true,handled:false};PM.emitCustomEvent('npc-dialogue:start',r);assert.equal(r.handled,false);
  r.variant={page:'Butch',variant:'standard-dialogue'};PM.emitCustomEvent('npc-dialogue:start',r);assert.equal(r.handled,true);assert.ok(text(f));
});
test('pickup, real bank transfer and fresh saved login retain physical form and restore its conversation',async t=>{
  const f=actor(t),id=core.ItemIdentifiers.TEKTINY,n=await summon(f,id);
  const pick=n.getDefinition().getActions().findIndex(x=>x==='Pick-up')+1;await input(f,{type:'npc_option',index:n.getIndex(),clickType:pick});
  f.p.getBank(0).open();core.Bank.deposit(f.p,id,f.p.getInventory().getSlotForItemId(id),1,false);core.Bank.withdraw(f.p,id,f.p.getBank(0).getSlotForItemId(id),1,0);
  PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});const g=actor(t);PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});g.p.needsPlacement=false;
  const restored=await summon(g,id);t.mock.method(Math,'random',()=>0);await talk(g,restored);assert.equal(text(g),'You look hot.');assert.equal(g.p.getInventory().getAmount(id),0);
});
test('all six Theatre physical pet forms use their own ordinary conversation',async t=>{
  t.mock.method(Math,'random',()=>0);
  const expected=new Map([["Lil' Zik","Hey Lil' Zik."],["Lil' Maiden",'Have you seen my brother?'],["Lil' Bloat",'Maaasteeer?'],["Lil' Nylo",'How are you doing little guy?'],["Lil' Sot",'Hello my angry little monster.'],["Lil' Xarp","We're not in the Theatre anymore, so no poisoning anyone, got that?"]]);
  const pets=require('../plugins/npcs/Pets.plugin').__internals;
  const forms=pets.PETS.filter(p=>pets.petFamily(p)===`item:${core.ItemIdentifiers.LIL_ZIK}`);assert.equal(forms.length,6);
  for(const pet of forms){const f=actor(t),n=await summon(f,pet.itemId);await talk(f,n);assert.equal(text(f),expected.get(n.getDefinition().getName()),n.getDefinition().getName());}
});
test('a foreign owned follower cannot fall through into generic self-owner or overhead dialogue',async t=>{
  const f=actor(t),g=actor(t),n=await summon(f,core.ItemIdentifiers.OLMLET);await talk(g,n);
  assert.equal(g.p.getDialogueManager().isActive(),false);assert.equal(MultiChatboxPrompt.getPending(g.p),null);assert.equal(f.p.getAttribute('pets:current'),n);
});
test('native metamorphosis uses the current form and cancels a pending conversation menu',async t=>{
  t.mock.method(Math,'random',()=>0);
  const f=actor(t),n=await summon(f,core.ItemIdentifiers.OLMLET);await talk(f,n);
  await input(f,{type:'dialogue_continue',widgetId:(231<<16)|5,childIndex:-1});assert.ok(MultiChatboxPrompt.getPending(f.p));
  f.p.setAttribute('pets:morph-unlocks',[`item:${core.ItemIdentifiers.OLMLET}`]);
  const op=n.getCurrentDefinition(f.p).getActions().findIndex(x=>x==='Metamorphosis')+1;assert.ok(op>0);
  await input(f,{type:'npc_option',index:n.getIndex(),clickType:op});assert.equal(n.getId(),core.NpcIdentifiers.PUPPADILE_2);
  assert.equal(MultiChatboxPrompt.getPending(f.p),null);
  await input(f,{type:'dialogue_continue',widgetId:(219<<16)|1,childIndex:1});assert.equal(f.p.getDialogueManager().isActive(),false);
  await talk(f,n);assert.equal(text(f),'What lovely teeth you have!');
});


test('owner hatchlings select their owner branches rather than other-player or menagerie text', async t => {
  for (const [id, first] of [[core.ItemIdentifiers.PET_DAGANNOTH_SUPREME, 'Hey, so err... I kind of own you now.'], [core.ItemIdentifiers.PET_DAGANNOTH_PRIME, "So despite there being three kings, you're clearly the leader, right?"]]) {
    assert.ok(id > 0); const f = actor(t), n = await summon(f, id); await talk(f, n);
    assert.equal(text(f), first, n.getDefinition().getName());
    assert.equal(f.p.getAttribute('pets:current'), n);
  }
});

test('native Dark core metamorphosis selects the current Pet-prefixed source section', async t => {
  const f = actor(t), n = await summon(f, core.ItemIdentifiers.PET_DARK_CORE);
  await talk(f, n); assert.equal(text(f), 'Got any sigils for me?');
  const op = n.getCurrentDefinition(f.p).getActions().findIndex(x => x === 'Metamorphosis') + 1;
  assert.ok(op > 0); await input(f, {type:'npc_option',index:n.getIndex(),clickType:op});
  assert.equal(n.getCurrentDefinition(f.p).getName(), 'Corporeal Critter');
  assert.equal(f.p.getDialogueManager().isActive(), false);
  await input(f, {type:'dialogue_continue',widgetId:(217<<16)|5,childIndex:-1});
  assert.equal(f.p.getDialogueManager().isActive(), false);
  await talk(f, n); assert.equal(text(f), "I'm hungry!");
  assert.equal(f.p.getAttribute('pets:current'), n);
});



test('owner-only sections reject a foreign player and a removal-queued current follower', async t => {
  const f = actor(t), g = actor(t), n = await summon(f, core.ItemIdentifiers.PET_DAGANNOTH_SUPREME);
  await talk(g, n); assert.equal(text(g), undefined);
  core.World.getRemoveNPCQueue().push(n); await talk(f, n); assert.equal(text(f), undefined);
  assert.equal(f.p.getAttribute('pets:current'), n);
});

test('native pickup, Bank deposit/withdraw and saved login retain the Critter conversation', async t => {
  const f = actor(t), id = core.ItemIdentifiers.PET_DARK_CORE, n = await summon(f, id);
  const morphOp = n.getCurrentDefinition(f.p).getActions().findIndex(x => x === 'Metamorphosis') + 1;
  await input(f, {type:'npc_option',index:n.getIndex(),clickType:morphOp});
  const pick = n.getCurrentDefinition(f.p).getActions().findIndex(x => x === 'Pick-up') + 1;
  await input(f, {type:'npc_option',index:n.getIndex(),clickType:pick});
  f.p.getBank(0).open(); core.Bank.deposit(f.p,id,f.p.getInventory().getSlotForItemId(id),1,false);
  core.Bank.withdraw(f.p,id,f.p.getBank(0).getSlotForItemId(id),1,0);
  PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});
  const g = actor(t); PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);
  PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false}); g.p.needsPlacement=false;
  const restored = await summon(g,id); await talk(g,restored);
  assert.equal(restored.getCurrentDefinition(g.p).getName(),'Corporeal Critter');
  assert.equal(text(g),"I'm hungry!"); assert.equal(g.p.getInventory().getAmount(id),0);
});

test('queued-removal owned pet clicks cannot fall through to generic NPC speech after another summon',async t=>{
  const f=actor(t), old=await summon(f,core.ItemIdentifiers.YAMI);
  const pick=old.getCurrentDefinition(f.p).getActions().findIndex(x=>x==='Pick-up')+1;
  await input(f,{type:'npc_option',index:old.getIndex(),clickType:pick});
  const current=await summon(f,core.ItemIdentifiers.PET_DAGANNOTH_SUPREME);
  await talk(f,old);assert.equal(f.p.getDialogueManager().isActive(),false);
  assert.equal(f.p.getAttribute('pets:current'),current);await talk(f,current);
  assert.equal(text(f),'Hey, so err... I kind of own you now.');
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.YAMI),1);
});


test('actual Yami follower uses its canonical NPC-typed ordinary conversation', async t => {
  const f=actor(t), n=await summon(f,core.ItemIdentifiers.YAMI); t.mock.method(Math,'random',()=>0);
  await talk(f,n); assert.equal(text(f),'Yes, you fool?');
  await input(f,{type:'dialogue_continue',widgetId:(231<<16)|5,childIndex:-1});
  assert.equal(text(f),'Excuse me?'); assert.equal(f.p.getAttribute('pets:current'),n);
});

test('actual Smol Heredit follower selects ordinary text without falling into the rare or overhead section', async t => {
  const f=actor(t), n=await summon(f,core.ItemIdentifiers.SMOL_HEREDIT); await talk(f,n);
  assert.equal(text(f),'How you doing, Smol Heredit?');
  await input(f,{type:'dialogue_continue',widgetId:(217<<16)|5,childIndex:-1});
  assert.match(text(f),/^I'm still disappointed that my father failed against you\./);
  assert.equal(f.p.getAttribute('pets:current'),n);
});

test('NPC-typed pet speech retains actual reward ownership through Bank and fresh login',async t=>{
  const f=actor(t), id=core.ItemIdentifiers.YAMI;
  PM.emitCustomEvent('npc-drops:roll',{player:f.p,drops:[{itemId:id,amount:1}]});
  const n=f.p.getAttribute('pets:current'); assert.ok(n?.isPet());
  const foreign=actor(t); await talk(foreign,n); assert.equal(text(foreign),undefined);
  const pick=n.getCurrentDefinition(f.p).getActions().findIndex(x=>x==='Pick-up')+1;
  await input(f,{type:'npc_option',index:n.getIndex(),clickType:pick});
  f.p.getBank(0).open(); core.Bank.deposit(f.p,id,f.p.getInventory().getSlotForItemId(id),1,false);
  core.Bank.withdraw(f.p,id,f.p.getBank(0).getSlotForItemId(id),1,0);
  PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});const g=actor(t);
  PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});g.p.needsPlacement=false;
  const restored=await summon(g,id);t.mock.method(Math,'random',()=>0);await talk(g,restored);
  assert.equal(text(g),'Yes, you fool?');assert.equal(g.p.getInventory().getAmount(id),0);
});


test('native stale Talk-to after pickup and another pet summon cannot bypass the current follower gate',async t=>{
  const f=actor(t), old=await summon(f,core.ItemIdentifiers.YAMI);t.mock.method(Math,'random',()=>0);await talk(f,old);
  const pick=old.getCurrentDefinition(f.p).getActions().findIndex(x=>x==='Pick-up')+1;
  await input(f,{type:'npc_option',index:old.getIndex(),clickType:pick});
  const current=await summon(f,core.ItemIdentifiers.SMOL_HEREDIT);
  await talk(f,old);assert.equal(f.p.getDialogueManager().isActive(),false);
  assert.equal(f.p.getAttribute('pets:current'),current);await talk(f,current);
  assert.equal(text(f),'How you doing, Smol Heredit?');
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.YAMI),1);
});


test('linked Kraken follower source opens its actual native conversation',async t=>{
  const f=actor(t),n=await summon(f,core.ItemIdentifiers.PET_KRAKEN);await talk(f,n);
  assert.equal(text(f),"What's Kraken?");
  await input(f,{type:'dialogue_continue',widgetId:(217<<16)|5,childIndex:-1});
  assert.equal(text(f),'Not heard that one before.');assert.equal(f.p.getAttribute('pets:current'),n);
});

test('both current Smoke Devil forms select current text rather than its dated archival section',async t=>{
  const f=actor(t),n=await summon(f,core.ItemIdentifiers.PET_SMOKE_DEVIL);
  for(let i=0;i<2;i++){
    await talk(f,n);assert.equal(text(f),'Are you safe to keep as a pet?');
    await input(f,{type:'dialogue_continue',widgetId:(217<<16)|5,childIndex:-1});assert.equal(text(f),'Yes, human.');
    await input(f,{type:'dialogue_continue',widgetId:(231<<16)|5,childIndex:-1});
    const choices=MultiChatboxPrompt.getPending(f.p)?.options;assert.ok(choices?.includes("So where's the fire?"));
    await input(f,{type:'dialogue_continue',widgetId:(219<<16)|1,childIndex:choices.indexOf("So where's the fire?")+1});
    assert.equal(text(f),"So where's the fire?");
    await input(f,{type:'dialogue_continue',widgetId:(217<<16)|5,childIndex:-1});assert.equal(text(f),"I don't have a fire.");
    const morph=n.getCurrentDefinition(f.p).getActions().findIndex(x=>x==='Metamorphosis')+1;assert.ok(morph>0);
    await input(f,{type:'npc_option',index:n.getIndex(),clickType:morph});assert.equal(f.p.getDialogueManager().isActive(),false);
  }
  assert.equal(f.p.getAttribute('pets:current'),n);
});

test('all three real Snakeling forms retain canonical speech through native metamorphosis',async t=>{
  const f=actor(t),n=await summon(f,core.ItemIdentifiers.PET_SNAKELING),seen=new Set();
  for(let i=0;i<3;i++){
    seen.add(n.getCurrentDefinition(f.p).getId());await talk(f,n);assert.equal(text(f),'Hey little snake!');
    await input(f,{type:'dialogue_continue',widgetId:(217<<16)|5,childIndex:-1});
    assert.equal(text(f),'Soon, Zulrah shall establish dominion over this plane.');
    const morph=n.getCurrentDefinition(f.p).getActions().findIndex(x=>x==='Metamorphosis')+1;assert.ok(morph>0);
    await input(f,{type:'npc_option',index:n.getIndex(),clickType:morph});assert.equal(f.p.getDialogueManager().isActive(),false);
  }
  assert.equal(seen.size,3);assert.equal(f.p.getAttribute('pets:current'),n);
});

for(const [mobile,phrase] of [[false,'high gamble'],[true,'lucky dip']])test(`Penance native Talk-to selects ${mobile?'mobile':'desktop'} current platform conversation`,async t=>{
  const {MOBILE_CLIENT_ATTRIBUTE}=require('../dist/net/protocol/ClientProtocol');
  const f=actor(t);f.p.setAttribute(MOBILE_CLIENT_ATTRIBUTE,mobile);
  const n=await summon(f,core.ItemIdentifiers.PET_PENANCE_QUEEN);await talk(f,n);
  assert.equal(text(f),`Of all the ${phrase} rewards I could have won, I won you...`);
  await input(f,{type:'dialogue_continue',widgetId:(217<<16)|5,childIndex:-1});
  assert.equal(text(f),"Keep trying, human. You'll never win that Dragon Chainbody.");
  await input(f,{type:'dialogue_continue',widgetId:(231<<16)|5,childIndex:-1});assert.equal(f.p.getDialogueManager().isActive(),false);
});

test('Penance dialogue follows fresh platform across actual saved logins without persisting mobile preference',async t=>{
  const {MOBILE_CLIENT_ATTRIBUTE}=require('../dist/net/protocol/ClientProtocol');
  const f=actor(t);f.p.setAttribute(MOBILE_CLIENT_ATTRIBUTE,true);const n=await summon(f,core.ItemIdentifiers.PET_PENANCE_QUEEN);await talk(f,n);
  assert.equal(text(f),'Of all the lucky dip rewards I could have won, I won you...');
  const save=PlayerSave.fromPlayer(f.p);PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});
  const g=actor(t);save.applyToPlayer(g.p);assert.notEqual(g.p.getAttribute(MOBILE_CLIENT_ATTRIBUTE),true);
  PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});g.p.needsPlacement=false;
  const current=g.p.getAttribute('pets:current');assert.ok(current?.isRegistered());await talk(g,current);
  assert.equal(text(g),'Of all the high gamble rewards I could have won, I won you...');
  assert.equal(g.p.getInventory().getAmount(core.ItemIdentifiers.PET_PENANCE_QUEEN),0);
  const desktopSave=PlayerSave.fromPlayer(g.p);PM.emitPlayerLogout({player:g.p,username:g.p.getUsername()});
  const h=actor(t);h.p.setAttribute(MOBILE_CLIENT_ATTRIBUTE,true);desktopSave.applyToPlayer(h.p);
  PM.emitPlayerLogin({player:h.p,username:h.p.getUsername(),isNewAccount:false});h.p.needsPlacement=false;
  await talk(h,h.p.getAttribute('pets:current'));assert.equal(text(h),'Of all the lucky dip rewards I could have won, I won you...');
});

test('normal Beaver native Talk-to runs its ordinary form question and reply',async t=>{
  const f=actor(t),n=await summon(f,core.ItemIdentifiers.BEAVER);await talk(f,n);
  assert.equal(text(f),'How much wood would a woodchuck chuck if a woodchuck could chuck wood?');
  await input(f,{type:'dialogue_continue',widgetId:(217<<16)|5,childIndex:-1});
  assert.equal(text(f),'Approximately 32,768 depending on his woodcutting level.');
  await input(f,{type:'dialogue_continue',widgetId:(231<<16)|5,childIndex:-1});
  assert.equal(f.p.getDialogueManager().isActive(),false);await talk(f,n);
  assert.equal(text(f),'How much wood would a woodchuck chuck if a woodchuck could chuck wood?');
});

test('normal Beaver selector survives native Pickup, real Bank and saved login without authorizing foreign or queued pets',async t=>{
  const f=actor(t),n=await summon(f,core.ItemIdentifiers.BEAVER);await talk(f,n);
  const pick=n.getCurrentDefinition(f.p).getActions().findIndex(x=>x==='Pick-up')+1;
  await input(f,{type:'npc_option',index:n.getIndex(),clickType:pick});assert.equal(f.p.getDialogueManager().isActive(),false);
  f.p.getBank(0).open();core.Bank.deposit(f.p,core.ItemIdentifiers.BEAVER,f.p.getInventory().getSlotForItemId(core.ItemIdentifiers.BEAVER),1,false);
  core.Bank.withdraw(f.p,core.ItemIdentifiers.BEAVER,f.p.getBank(0).getSlotForItemId(core.ItemIdentifiers.BEAVER),1,0);
  PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});const g=actor(t);PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});g.p.needsPlacement=false;
  const restored=await summon(g,core.ItemIdentifiers.BEAVER);await talk(g,restored);
  assert.equal(text(g),'How much wood would a woodchuck chuck if a woodchuck could chuck wood?');
  const stranger=actor(t);await talk(stranger,restored);assert.equal(text(stranger),undefined);
  g.p.getPacketSender().sendInterfaceRemoval();core.World.getRemoveNPCQueue().push(restored);await talk(g,restored);assert.equal(text(g),undefined);
});

test('an invalid explicit ordinary selector cannot fall back to another form or generic conversation',async t=>{
  const pets=require('../plugins/npcs/Pets.plugin').__internals;
  const row=pets.PETS.find(p=>p.enumName==='BEAVER'),previous=row.dialogueVariant;
  t.after(()=>{row.dialogueVariant=previous;});
  const f=actor(t),n=await summon(f,core.ItemIdentifiers.BEAVER);
  row.dialogueVariant='nonexistent-ordinary-variant';await talk(f,n);
  assert.equal(text(f),undefined);assert.equal(f.p.getDialogueManager().isActive(),false);
  row.dialogueVariant=previous;await talk(f,n);
  assert.equal(text(f),'How much wood would a woodchuck chuck if a woodchuck could chuck wood?');
});

// Transcript:Rocky also has tanuki and red panda sections; the Rocky follower opens its own (issue #4183).
test('Rocky native Talk-to opens its standard conversation rather than nothing',async t=>{
  const f=actor(t),n=await summon(f,core.ItemIdentifiers.ROCKY);t.mock.method(Math,'random',()=>0.3);
  await talk(f,n);assert.equal(text(f),'Is there much competition between you raccoons and the magpies?');
  await input(f,{type:'dialogue_continue',widgetId:(217<<16)|5,childIndex:-1});
  assert.equal(text(f),"Magpies have nothing on us! They're just interested in shinies.");
});
