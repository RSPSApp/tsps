// Real cache, players, private areas, NPCs, dialogue and death containers; network only is stubbed.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const { PlayerDeathTask } = require('../dist/game/task/impl/PlayerDeath');
let core, Data, Patches, Hespori, patch, index = 1700;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(1246, 10085);
  Data = require('../plugins/skills/farming/Data.Farming');
  Patches = require('../plugins/skills/farming/Patches.Farming');
  Hespori = require('../plugins/skills/farming/Hespori.Farming');
  PM.emitServerStartup({});
  patch = Data.CACHE.patches.find(p => p.type === 'HESPORI');
});
function fixture(t, stored = true) {
  const transport = { kind:'test', remoteAddress:'127.0.0.1', isOpen:()=>true,
    send:()=>true, close(){}, onData(){}, onError(){}, onClose(){} };
  const p = new Player(new PlayerSession(transport));
  p.setIndex(index++); p.setUsername('hespreentry' + index); p.setRegistered(true);
  p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(1246, 10085, 0));
  p.getSkillManager().setMaxLevels(core.Skill.FARMING,99,false).setCurrentLevels(core.Skill.FARMING,99,false);
  const state = Patches.stateFor(p, patch);
  Object.assign(state, { crop:'HESPORI', status:'grown', stage:3, nextAt:Number.MAX_SAFE_INTEGER });
  const farm = Patches.farmFor(p);
  farm.deathbank = stored ? [{ id:core.ItemIdentifiers.COINS, amount:1234, meta:{ source:'previous-death' } }] : [];
  farm.deathbankPaid = stored;
  const old = structuredClone(farm.deathbank);
  const connection = new ClientConnection(transport); connection.player = p;
  t.after(() => { PM.emitPlayerLogout({player:p, username:p.getUsername()}); core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  return { p, state, farm, old, connection };
}

test('seedless Echo reuses flowers and vines, preserves crop/retrieval, and saves harvest through departure', t => {
  const f = fixture(t);
  const oldCrop = structuredClone(f.state);
  const oldXP = f.p.getSkillManager().getExperience(core.Skill.FARMING);
  const events = [];
  Hespori.attachEcho({
    persistAttribute() {}, onCustomEvent() {}, onPlayerLogin() {}, onServerShutdown() {},
    registerNpcCombatMethodProvider() {},
    emitCustomEvent(name, event) {
      events.push(name);
      if (name === 'echo-boss:configure') event.configured = true;
      if (name === 'echo-boss:claim') event.token = 'hespori-test';
      if (name === 'echo-boss:completed') event.deliver([{ itemId:core.ItemIdentifiers.COINS, amount:123 }]);
    },
  });
  const start = { player:f.p, boss:'hespori', handled:false };
  Hespori.startEcho(start);
  assert.equal(start.handled,true);
  const area = f.p.getArea();
  assert.ok(area instanceof core.PrivateArea);
  const boss = area.entities.find(n => n.isNpc?.() && n.getId() === core.NpcIdentifiers.HESPORI);
  assert.ok(boss);
  assert.equal(area.entities.filter(n => n.isNpc?.()).length,5,'normal four-flower shield retained');
  assert.deepEqual(f.state,oldCrop);
  assert.deepEqual(f.farm.deathbank,f.old);
  Hespori.hesporiDeathDrop({ player:f.p, dropEligible:true, item:new core.Item(core.ItemIdentifiers.COINS,1) });
  assert.deepEqual(f.farm.deathbank,f.old,'Echo never replaces Arno retrieval');
  Hespori.questHesporiDeath({npc:boss});
  Hespori.questHesporiDeath({npc:boss});
  assert.equal(events.filter(n=>n==='echo-boss:completed').length,1);
  assert.deepEqual(f.p.getAttribute('farming:echo-hespori-loot'),[{ itemId:core.ItemIdentifiers.COINS,amount:123 }]);
  Hespori.hesporiLogout({player:f.p});
  assert.deepEqual(f.state,oldCrop);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.FARMING),oldXP);
  assert.equal(events.includes('combat-achievements:kill'),false);
  // An unclaimed harvest restores separately without spawning another fight or rerolling.
  f.p.getArea()?.leave(f.p,false);
  Hespori.startEcho({player:f.p,boss:'hespori',handled:false});
  assert.equal(f.p.getArea().entities.filter(n=>n.isNpc?.()).length,0);
  f.p.getInventory().addItem(new core.Item(Data.itemId('Spade'),1));
  for (let index=0;index<27;index++) f.p.getInventory().addItem(new core.Item(core.ItemIdentifiers.RUNE_SCIMITAR,1));
  Hespori.echoPatchInteraction({player:f.p,location:{x:patch.x,y:patch.y},handled:false});
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS),0);
  assert.deepEqual(f.p.getAttribute('farming:echo-hespori-loot'),[{itemId:core.ItemIdentifiers.COINS,amount:123}],'full inventory retains the entire harvest');
  f.p.getInventory().deleteNumber(core.ItemIdentifiers.RUNE_SCIMITAR,27);
  Hespori.echoPatchInteraction({player:f.p,location:{x:patch.x,y:patch.y},handled:false});
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS),123);
  assert.deepEqual(f.p.getAttribute('farming:echo-hespori-loot'),[]);
  Hespori.echoPatchInteraction({player:f.p,location:{x:patch.x,y:patch.y},handled:false});
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS),123,'repeated harvest cannot duplicate');
  assert.deepEqual(f.state,oldCrop);
});

test('an Echo Hespori\'s normal table roll joins its saved harvest, never the crop', t => {
  const f = fixture(t);
  const oldCrop = structuredClone(f.state);
  Hespori.attachEcho({
    persistAttribute() {}, onCustomEvent() {}, onPlayerLogin() {}, onServerShutdown() {},
    emitCustomEvent(name, event) {
      if (name === 'echo-boss:configure') event.configured = true;
      if (name === 'echo-boss:claim') event.token = 'hespori-roll';
    },
  });
  Hespori.startEcho({ player:f.p, boss:'hespori', handled:false });
  const boss = f.p.getArea().entities.find(n => n.isNpc?.() && n.getId() === core.NpcIdentifiers.HESPORI);
  const generated = { player:f.p, npc:boss, drops:[{ itemId:core.ItemIdentifiers.COINS, amount:40 }], handled:false };
  Hespori.hesporiLoot(generated);
  assert.equal(generated.handled,true,'no ground drop');
  const anima = ['Attas seed','Iasor seed','Kronos seed'].map(Data.itemId);
  const saved = f.p.getAttribute('farming:echo-hespori-loot');
  assert.deepEqual(saved[0],{ itemId:core.ItemIdentifiers.COINS, amount:40 });
  assert.equal(saved.length,2);
  assert.ok(anima.includes(saved[1].itemId),'the one guaranteed anima roll, as for a grown Hespori');
  assert.deepEqual(f.state,oldCrop);
  Hespori.hesporiLogout({ player:f.p });
});
async function packet(f, value) {
  await f.connection.dispatch([value]); f.connection.processTurnPackets();
}
async function speech(f) {
  const current = f.p.getDialogueManager().getCurrent();
  assert.ok(current, 'canonical speech is open');
  const group = current.groupId ?? current.constructor.GROUP_ID;
  await packet(f, {type:'dialogue_continue',widgetId:(group << 16) | 5,childIndex:0});
}
async function warning(f) {
  Hespori.harvestHespori(f.p, patch); Patches.tick();
  await speech(f);
  const menu = MultiChatboxPrompt.getPending(f.p);
  assert.deepEqual(menu?.options, ["I'll come and collect them from you.", "No, I don't care if I lose that stuff."]);
}
async function choice(f, number) {
  await packet(f, {type:'dialogue_continue',widgetId:MultiChatboxPrompt.OPTIONS_WIDGET_ID,childIndex:number});
}
test('canonical collect choice exits the cave without consuming stored items', async t => {
  const f = fixture(t); await warning(f); await choice(f,1); await speech(f);
  assert.equal(f.p.getLocation().equals(new core.Location(1230,3730,0)),true);
  assert.deepEqual(f.farm.deathbank,f.old); assert.equal(f.state.hesporiFight,undefined);
});
test('canonical fight choice starts one private fight and preserves retrieval until death', async t => {
  const f = fixture(t); await warning(f); await choice(f,2); await speech(f);
  assert.equal(f.state.hesporiFight,true);
  const area = f.p.getArea(); assert.ok(area instanceof core.PrivateArea);
  assert.deepEqual(f.farm.deathbank,f.old); assert.equal(f.farm.deathbankPaid,true);
  await choice(f,2); assert.equal(f.p.getArea(),area);
  Hespori.hesporiLogout({player:f.p}); assert.deepEqual(f.farm.deathbank,f.old);
});
test('walking, teleporting, replacement UI, logout and death invalidate a pending choice', async t => {
  for (const transition of ['walk','teleport','bank','logout','dead']) {
    const f = fixture(t); await warning(f);
    if (transition === 'walk') await packet(f,{type:'move',x:1245,y:10085,run:false});
    if (transition === 'teleport') f.p.moveTo(new core.Location(1232,3728,0));
    if (transition === 'bank') f.p.getBank(0).open();
    if (transition === 'logout') PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});
    if (transition === 'dead') f.p.setHitpoints(0);
    await choice(f,2);
    if (f.p.getDialogueManager().getCurrent()) await speech(f);
    assert.notEqual(f.state.hesporiFight,true,transition);
    assert.deepEqual(f.farm.deathbank,f.old,transition);
  }
});
test('unsafe empty death destroys the old retrieval, while new drops replace it', async t => {
  for (const drops of [false,true]) {
    const f = fixture(t); await warning(f); await choice(f,2); await speech(f);
    if (drops) for (let i=0;i<5;i++) f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RUNE_SCIMITAR,1));
    PlayerDeathTask.dropItems(f.p,null,f.p.getLocation());
    PM.emitPlayerDeath({player:f.p,killer:null,itemsLost:true,handled:false});
    assert.equal(f.farm.deathbankPaid,false);
    if (!drops) assert.deepEqual(f.farm.deathbank,[]);
    else { assert.ok(f.farm.deathbank.length); assert.ok(f.farm.deathbank.every(item=>item.id===core.ItemIdentifiers.RUNE_SCIMITAR)); }
  }
});
test('without a previous retrieval the existing immediate fight remains available', t => {
  const f = fixture(t,false); Hespori.harvestHespori(f.p,patch); Patches.tick();
  assert.equal(f.state.hesporiFight,true); assert.equal(MultiChatboxPrompt.getPending(f.p),null);
});
test('Hespori awards pending planting XP when the harvested patch is cleared', t => {
  const f = fixture(t, false), xp = [];
  t.mock.method(f.p.getSkillManager(), 'addExperiences', (skill, amount) => xp.push([skill, amount]));
  f.p.getInventory().add(new core.Item(Data.itemId('Spade')), false);
  f.state.hesporiLoot = [{ itemId: core.ItemIdentifiers.COINS, amount: 1 }];
  f.state.plantExperiencePending = true;
  Hespori.harvestHespori(f.p, patch);
  for (let tick = 0; tick < 5; tick++) Patches.tick();
  assert.deepEqual(xp.map(([, amount]) => amount), [Data.CROPS.get('HESPORI').harvest, Data.CROPS.get('HESPORI').plant]);
  assert.equal(Patches.stateFor(f.p, patch).crop, undefined);
});
test('teleport or logout before the delayed harvest cannot open a remote warning or start a fight', async t => {
  for (const transition of ['teleport','logout']) {
    const f = fixture(t); Hespori.harvestHespori(f.p,patch);
    if (transition === 'teleport') {
      f.p.moveTo(new core.Location(3200,3200,0)); f.p.setNeedsPlacement(false);
    } else PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});
    Patches.tick(); await choice(f,2);
    assert.equal(MultiChatboxPrompt.getPending(f.p),null);
    assert.equal(f.p.getDialogueManager().getCurrent(),undefined);
    assert.notEqual(f.state.hesporiFight,true);
    assert.deepEqual(f.farm.deathbank,f.old);
    if (transition === 'teleport') assert.equal(f.p.getLocation().getX(),3200);
  }
});
