const assert = require('node:assert/strict'), path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
let core, next = 1800;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..')); PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi(); core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218); PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('callpet' + next); p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p; const messages = [], configs = [];
  const sender = p.getPacketSender(), config = sender.sendConfig.bind(sender);
  t.mock.method(sender, 'sendMessage', m => { messages.push(m); return sender; });
  t.mock.method(sender, 'sendConfig', (id, value) => { configs.push([id, value]); return config(id, value); });
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex());
    for (const n of [...core.World.getNpcs()]) if (n?.getOwner?.() === p) core.World.getNpcs().remove(n); });
  return { p, c, messages, configs };
}
async function packet(f, data) { await f.c.dispatch([data]); f.c.processTurnPackets(); }
async function call(f, op = 1) {
  const id = core.CacheDefinitions.getComponentId('wornitems:call_follower');
  await packet(f, { type: 'widget_action', widgetId: id, groupId: id >>> 16, childId: id & 65535, slot: -1, buttonNum: op });
}
function pet(f, item = core.ItemIdentifiers.OLMLET, offset = 6) {
  PM.emitCustomEvent('npc-drops:roll', { player: f.p, drops: [{ itemId: item, amount: 1 }] });
  const n = f.p.getAttribute('pets:current'); assert.ok(n?.isRegistered()); n.setLocation(f.p.getLocation().clone().add(offset, 0)); return n;
}
const current = f => f.p.getAttribute('pets:current');
async function catMenu(f,n) {
  const op=n.getCurrentDefinition(f.p).getActions().findIndex(action=>action==='Interact')+1;assert.ok(op>0);
  await packet(f,{type:'npc_option',index:n.getIndex(),clickType:op});
  for(let i=0;i<4;i++){core.TaskManager.processWalkTo(f.p.getIndex());f.p.getMovementQueue().process();core.TaskManager.process();}
  assert.deepEqual(MultiChatboxPrompt.getPending(f.p)?.options,['Stroke','Chase Vermin','Guess age','Shoo away']);
}
async function catChoice(f,option) {await packet(f,{type:'dialogue_continue',widgetId:(219<<16)|1,childIndex:option});}

for(const replacement of ['recall','growth'])test(`native cat Interact Shoo removes the actual follower after ${replacement}`,async t=>{
  const f=actor(t),n=pet(f,core.CacheDefinitions.getObjId('kittenobject'),1);await catMenu(f,n);
  if(replacement==='recall'){n.setLocation(f.p.getLocation().clone().add(6,0));await call(f);}
  else{f.p.getAttribute('pets:cat').growth=119;require('../plugins/npcs/Pets.plugin').__internals.catTick(f.p);}
  const recalled=current(f);assert.notEqual(recalled,n);assert.ok(MultiChatboxPrompt.getPending(f.p));
  await catChoice(f,4);assert.equal(MultiChatboxPrompt.getPending(f.p)?.title,'Are you sure you want to shoo away the cat?');assert.equal(current(f),recalled);
  await catChoice(f,1);assert.equal(current(f),recalled,'"Shoo cat!" first; the cat runs a tick later');core.TaskManager.process();
  assert.ok(f.messages.includes('The cat has run away.'));assert.equal(current(f),null);assert.equal(f.p.getAttribute('pets:active-item'),null);assert.equal(f.p.getAttribute('pets:cat'),null);
  assert.ok(core.World.getRemoveNPCQueue().includes(recalled),'the current replacement must be removed, not left following without ownership state');
  assert.equal([...core.World.getNpcs()].filter(pet=>pet?.getOwner?.()===f.p&&!core.World.getRemoveNPCQueue().includes(pet)).length,0);
});
test('native preserved Chase vermin uses the recalled current cat and keeps its ownership',async t=>{
  const f=actor(t),n=pet(f,core.CacheDefinitions.getObjId('kittenobject'),1);await catMenu(f,n);n.setLocation(f.p.getLocation().clone().add(6,0));await call(f);const recalled=current(f);
  const rat=core.NPC.create(core.NpcIdentifiers.RAT,f.p.getLocation().clone());core.World.getNpcs().add(rat);t.after(()=>core.World.getNpcs().remove(rat));
  t.mock.method(Math,'random',()=>0);await catChoice(f,2);
  assert.ok(core.World.getRemoveNPCQueue().includes(rat),'the real current cat must catch the real nearby rat');assert.equal(current(f),recalled);assert.ok(f.p.getAttribute('pets:active-item')>0);
});
test('a preserved menu from a runaway kitten cannot release a newly awarded logical cat',async t=>{
  const f=actor(t),item=core.CacheDefinitions.getObjId('kittenobject'),n=pet(f,item,1);await catMenu(f,n);
  const state=f.p.getAttribute('pets:cat');state.hungerAt=Date.now()-1;state.hungerStage=2;
  assert.equal(require('../plugins/npcs/Pets.plugin').__internals.catTick(f.p),false);assert.equal(current(f),null);
  const replacement=pet(f,item,1),newState=f.p.getAttribute('pets:cat');assert.notEqual(newState,state);assert.ok(MultiChatboxPrompt.getPending(f.p));
  await catChoice(f,4);assert.equal(current(f),replacement);assert.equal(f.p.getAttribute('pets:cat'),newState);assert.ok(!core.World.getRemoveNPCQueue().includes(replacement));
});
test('native Call follower without an active follower matches RSProx229/2785', async t => {
  const f = actor(t); await call(f); assert.ok(f.messages.includes('You do not have a follower.'));
});
test('native boundary4 is close,5 relocates once and a duplicate click is close', async t => {
  const f = actor(t), n = pet(f, undefined, 4); await call(f); assert.equal(current(f), n); assert.ok(f.messages.includes('Your follower is already close enough.'));
  n.setLocation(f.p.getLocation().clone().add(5, 0)); await call(f); const called = current(f);
  assert.notEqual(called, n); assert.equal(called.getId(), n.getId()); assert.equal(called.getOwner(), f.p);
  assert.ok(called.getLocation().isWithinDistance(f.p.getLocation(), 1)); assert.ok(core.World.getRemoveNPCQueue().includes(n));
  assert.ok(f.configs.some(([id, v]) => id === 447 && v === ((called.getId() << 16) | called.getIndex())));
  await call(f); assert.equal(current(f), called); assert.equal(f.p.getInventory().getValidItems().length, 0);
});
test('actual static wall collision permits nearby recall while players and NPCs do not', async t => {
  const f = actor(t), n = pet(f, undefined, 2), x = n.getLocation().getX(), y = n.getLocation().getY();
  const before = core.RegionManager.getClipping(x - 1, y, 0, null), wall = 0x8;
  core.RegionManager.addClipping(x - 1, y, 0, wall, null); t.after(() => { if (!(before & wall)) core.RegionManager.removeClipping(x - 1, y, 0, wall, null); });
  assert.equal(core.RegionManager.canMovestart(n.getLocation(), f.p.getLocation(), 1, 1, null), false);
  await call(f); assert.notEqual(current(f), n);
  const called = current(f); const blocker = core.NPC.create(core.NpcIdentifiers.MAN, called.getLocation().clone()); core.World.getNpcs().add(blocker); t.after(() => core.World.getNpcs().remove(blocker));
  await call(f); assert.equal(current(f), called); assert.ok(f.messages.includes('Your follower is already close enough.'));
});
test('native recall never answers or closes an existing dialogue or cancels a player task/walk', async t => {
  const f = actor(t); pet(f); let chosen = 0, completed = 0;
  const dialogue = new core.OptionDialogue(0, { executeOption() { chosen++; } }, 'Keep working', 'Stop');
  f.p.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(dialogue));
  core.TaskManager.submit(new core.CountdownTask(f.p.getIndex(), 2, () => completed++));
  f.p.getMovementQueue().addSteps(f.p.getLocation().clone().add(0, 2)); const queued = f.p.getMovementQueue().size();
  await call(f); assert.equal(chosen, 0); assert.equal(f.p.getDialogueManager().getCurrent(), dialogue); assert.equal(f.p.getMovementQueue().size(), queued);
  for (let i = 0; i < 3; i++) core.TaskManager.process(); assert.equal(completed, 1);
});
test('hidden, stale, foreign and removed-queue NPCs cannot be recalled or granted as items', async t => {
  for (const invalidate of [(f,n) => n.setVisible(false), (f,n) => n.setRegistered(false), (f,n) => n.setOwner(actor(t).p), (f,n) => core.World.getRemoveNPCQueue().push(n)]) {
    const f = actor(t), n = pet(f); invalidate(f, n); await call(f); assert.equal(current(f), n); assert.equal(f.p.getInventory().getValidItems().length, 0);
  }
});
test('dead, placement, teleport and trading players cannot relocate their follower', async t => {
  for (const invalidate of [f => f.p.setHitpoints(0), f => { f.p.needsPlacement = true; }, f => f.p.setTeleporting(true), f => f.p.setStatus(core.PlayerStatus.TRADING)]) {
    const f = actor(t), n = pet(f); invalidate(f); await call(f); assert.equal(current(f), n);
  }
});
test('a real private-area/plane transition recalls into the owner context; prohibited area refuses', async t => {
  const f = actor(t), n = pet(f), area = new core.PrivateArea(); f.p.setArea(area); f.p.setLocation(new core.Location(3222, 3218, 1));
  await call(f); assert.notEqual(current(f), n); assert.equal(current(f).getPrivateArea(), area); assert.equal(current(f).getLocation().getZ(), 1);
  const blocked = new class extends core.PrivateArea { allowSummonPet() { return false; } }(); f.p.setArea(blocked); const before = current(f); await call(f); assert.equal(current(f), before);
});
test('the exact alternate item, ownership, full inventory and cat clock survive recall and save/fresh login', async t => {
  for (const item of [core.CacheDefinitions.getObjId('xarpuspet'), core.CacheDefinitions.getObjId('kittenobject')]) {
    const f = actor(t), n = pet(f, item); while (f.p.getInventory().getFreeSlots()) f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE), false);
    const cat = JSON.stringify(f.p.getAttribute('pets:cat')), owned = [...(f.p.getAttribute('pets.owned') || [])]; await call(f);
    assert.notEqual(current(f), n); assert.equal(f.p.getAttribute('pets:active-item'), item); assert.deepEqual(f.p.getAttribute('pets.owned') || [], owned); assert.equal(JSON.stringify(f.p.getAttribute('pets:cat')), cat);
    PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() }); const g = actor(t); PlayerSave.fromPlayer(f.p).applyToPlayer(g.p); PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername(), isNewAccount: false });
    assert.equal(g.p.getAttribute('pets:active-item'), item); assert.equal(current(g).getId(), n.getId()); assert.equal(g.p.getInventory().getAmount(item), 0);
  }
});
test('unsupported native operations are consumed without answering a dialogue', async t => {
  const f = actor(t); let chosen = 0; const dialogue = new core.OptionDialogue(0, { executeOption() { chosen++; } }, 'One', 'Two');
  f.p.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(dialogue)); await call(f, 2); assert.equal(chosen, 0); assert.equal(f.p.getDialogueManager().getCurrent(), dialogue);
});
test('actual Bank.open and native Price Checker remain open while their follower is recalled', async t => {
  for (const open of [f => f.p.getBank(0).open(), f => packet(f, { type: 'widget_action', widgetId: (387 << 16) | 3, groupId: 387, childId: 3, buttonNum: 1 })]) {
    const f = actor(t), n = pet(f); await open(f); const status = f.p.getStatus(), modal = f.p.getInterfaceId();
    assert.ok([core.PlayerStatus.BANKING, core.PlayerStatus.PRICE_CHECKING].includes(status));
    await call(f); assert.notEqual(current(f), n); assert.equal(f.p.getStatus(), status); assert.equal(f.p.getInterfaceId(), modal);
  }
});
