// From server/: node --test tests/misthalin-mystery-parity.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { PacketSender } = require('../dist/net/packet/PacketSender');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
let nextIndex = 1;
const noop = () => {};
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, '..')); new NpcDefinitionLoader().load(); });

function harness(name) {
  const hooks = {}, events = {}, tasks = [], npcs = [], removed = [], ground = [], objects = [], npcActions = new Map();
  const api = new Proxy({ core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  }, ObjectManager: { register: object => objects.push(object), deregister: noop }, ItemOnGroundManager: { registerLocation: (...args) => ground.push(args) } },
    persistAttribute: noop,
    onNpcInteraction: (name, actions) => npcActions.set(name, actions),
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z), area = null;
      const path = [];
      const movement = { addSteps(to) {
        npc.walkingTo = to;
        let from = path.at(-1) ?? location;
        while(!from.equals(to)) { from = new core.Location(from.getX()+Math.sign(to.getX()-from.getX()),from.getY()+Math.sign(to.getY()-from.getY()),to.getZ());path.push(from); }
      } };
      const npc = { ...definition, animations: [], graphics: [], hits: [], hitpoints: core.NpcDefinition.forId(definition.id).getHitpoints(), getId: () => definition.id, getIndex: () => npc.index,
        index: nextIndex++, getLocation: () => location, moveTo: to => { location = to; },
        getArea: () => area, setArea: value => { area = value; }, isNpc: () => true, isPlayer: () => false, getAsNpc: () => npc,
        isRegistered: () => !npc.removed, setPositionToFace: to => { npc.facing = to; }, forceChat: text => { npc.said = text; },
        setFace: direction => { npc.direction = direction; }, faceTile: to => { npc.facing = to; return npc; },
        setNpcTransformationId: id => { npc.transform = id; },
        performAnimation: animation => npc.animations.push(animation.getId()), performGraphic: graphic => npc.graphics.push(graphic.id),
        getMovementQueue: () => movement, step: () => { if(path.length&&!npc.removed)location=path.shift(); },
        setCombatXpMultiplier: value => { npc.multiplier = value; },
        getCombat: () => ({ attack: player => { npc.target = player; }, getHitQueue: () => ({addPendingDamage: hits => {for(const hit of hits){npc.hitpoints-=hit.getDamage();npc.hits.push(hit);}}}) }),
      }; npcs.push(npc); return npc;
    }, removeNpc: npc => { npc.removed = true; removed.push(npc); },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) { const answer = fn(event); if (answer !== null && answer !== undefined) return answer; }
    return null;
  };
  const h = { api, hooks, events, tasks, npcs, removed, ground, objects, npcActions, quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    line(p, npcId, text) { const event = { player: p, npcId, text }; h.emit('npc-dialogue:line', event); return event; },
    action(p, npcId, stepId) { const event = { player: p, npcId, stepId }; h.emit('npc-dialogue:action', event); return event; },
    talk(p, npcId) { const choice = hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId })).find(Boolean); assert.ok(choice); runtime.startTranscript(api, p, npcId, typeof choice === 'string' ? 'Misthalin Mystery' : choice.page, typeof choice === 'string' ? choice : choice.variant); },
    tick(count) { while (count-- > 0) { [...tasks].forEach(task => task.tick());npcs.forEach(npc=>npc.step()); } },
    choose(p, text) { const prompt = p.prompt; assert.ok(prompt, `no menu for ${text}`); const index = prompt.options.findIndex(label => label === text); assert.ok(index >= 0, `missing ${text} in ${prompt.options}`); p.prompt = null; prompt.pairs[index * 2 + 1](); },
    continueUntil(p, predicate, limit = 160) { while (!predicate()) { assert.ok(limit-- > 0, `dialogue stalled at ${p.text}`); const current=p.manager.getCurrent();assert.ok(current, `dialogue ended at ${p.text}`);if(current instanceof core.ActionDialogue)h.tick(1);else p.manager.advance(); } },
  }; return h;
}
function player() {
  const attrs = new Map(), items = new Map(), configs = new Map(), varbits = new Map(), log = [], xp = [];
  let location = new core.Location(3210, 3220, 0), area = null;
  const inv = { getAmount: id => items.get(id) ?? 0, isFull: () => Boolean(p.full), getFreeSlots: () => p.free ?? (p.full ? 0 : 28),
    adds(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount) { assert.ok((items.get(id) ?? 0) >= amount); items.set(id, items.get(id) - amount); },
  };
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; }, sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendString(text, uid) { if ([6,3,2].some(child => [217,231,229,193].some(group => uid === (group << 16 | child)))) p.text = text; log.push(['text',uid,text]); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = { attrs, items, configs, varbits, log, xp, messages: [], animations: [], prompt: null, text: '', index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), getInventory: () => inv,
    getBanks: () => [{ getAmount: id => p.bank?.get(id) ?? 0 }], getEquipment: () => ({ get: () => p.weapon ? { getId: () => p.weapon } : null, deleteNumber: () => { p.weapon = null; } }),
    getPacketSender: () => packet, getDialogueManager: () => p.manager, getUpdateFlag: () => ({ flag: noop }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(),amount]), getCombatLevel: () => p.combat ?? 3 }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement(value) { p.blocked = value; return this; } }),
    setUntargetable: value => { p.untargetable = value; }, getLocation: () => location, moveTo: to => { location = to; },
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; }, getIndex: () => p.index,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getUsername: () => 'Parity', getAppearance: () => ({ isMale: () => true }), setPositionToFace: noop, forceChat: noop,
    performAnimation: a => p.animations.push(a.getId()), sendMessage: text => p.messages.push(text),
  }; p.manager = new DialogueManager(p); return p;
}
const continueToMenu = (h,p) => h.continueUntil(p, () => Boolean(p.prompt));

function object(h,p,id,x=1647,y=4841) {
  const door=id>=core.ObjectIdentifiers.LARGE_DOOR_94&&id<=core.ObjectIdentifiers.DOOR_561;
  const event={player:p,objectId:id,definition:{id},location:{x,y,z:0},object:new core.GameObject(id,new core.Location(x,y,0),door?0:10,0)};
  h.hooks.onObjectInteraction[0](event);return event;
}
function island(h,p,stage) {
  h.quest.setStage(p,stage);p.moveTo(new core.Location(1637,4802,0));h.hooks.onPlayerLogin.at(-1)({player:p});return p.getArea();
}
for (const [name, npcId] of [['Abigale', N.ABIGALE], ['Hewey', N.HEWEY]]) {
  test(`${name}'s complete starting conversation unlocks the rowboat and survives login`, () => {
    const h=harness('MisthalinMystery'),p=player();
    h.talk(p,npcId);continueToMenu(h,p);assert.equal(h.quest.getStage(p),0);
    h.choose(p,'Yes.');assert.equal(h.quest.getStage(p),5);
    h.continueUntil(p,()=>p.text.includes('The boat we escaped on'));
    assert.equal(h.quest.getStage(p),5,'the briefing must finish before travel unlocks');
    h.continueUntil(p,()=>!p.manager.getCurrent());assert.equal(h.quest.getStage(p),10);
    // Restore only saved attributes into a fresh session; login must resend the stage.
    h.hooks.onPlayerLogout[0]({player:p});const restored=player();
    for(const [key,value] of p.attrs)restored.attrs.set(key,value);
    h.hooks.onPlayerLogin.at(-1)({player:restored});
    assert.equal(h.quest.getStage(restored),10);assert.equal(restored.varbits.get(3468),10);
    restored.moveTo(new core.Location(3240,3142,0));
    object(h,restored,core.ObjectIdentifiers.ROWBOAT_9);h.tick(2);
    assert.deepEqual([restored.getLocation().getX(),restored.getLocation().getY()],[1637,4802]);
    assert.ok(restored.getArea());h.tick(3);assert.equal(restored.blocked,false);
    h.hooks.onPlayerLogout[0]({player:restored});
  });

  test(`${name}'s refusal or cancelled introduction leaves the rowboat locked`, () => {
    for(const choice of ['No.', 'cancel', 'Yes.']){
      const h=harness('MisthalinMystery'),p=player();
      h.talk(p,npcId);continueToMenu(h,p);
      if(choice!=='cancel')h.choose(p,choice);
      if(choice==='No.')h.continueUntil(p,()=>!p.manager.getCurrent());
      else p.getPacketSender().sendInterfaceRemoval();
      assert.equal(h.quest.getStage(p),choice==='Yes.'?5:0);
      const origin=p.getLocation().clone();object(h,p,core.ObjectIdentifiers.ROWBOAT_9);h.tick(5);
      assert.ok(p.getLocation().equals(origin));assert.equal(p.getArea(),null);
      assert.notEqual(p.blocked,true);
      h.hooks.onPlayerLogout[0]({player:p});
    }
  });

  test(`${name} can recover a saved stage-five introduction and unlock the rowboat`, () => {
    const h=harness('MisthalinMystery'),p=player();
    h.talk(p,npcId);continueToMenu(h,p);h.choose(p,'Yes.');
    assert.equal(h.quest.getStage(p),5);p.getPacketSender().sendInterfaceRemoval();
    h.hooks.onPlayerLogout[0]({player:p});const restored=player();
    for(const [key,value] of p.attrs)restored.attrs.set(key,value);
    h.hooks.onPlayerLogin.at(-1)({player:restored});assert.equal(restored.varbits.get(3468),5);
    h.talk(restored,npcId);continueToMenu(h,restored);h.choose(restored,'Yes.');
    h.continueUntil(restored,()=>!restored.manager.getCurrent());assert.equal(h.quest.getStage(restored),10);
    object(h,restored,core.ObjectIdentifiers.ROWBOAT_9);h.tick(2);
    assert.deepEqual([restored.getLocation().getX(),restored.getLocation().getY()],[1637,4802]);
    h.hooks.onPlayerLogout[0]({player:restored});
  });
}

test('rowboat fades before its message and uses the captured two-tick crossing in both directions',()=>{
  for(const toIsland of [true,false]){
    const h=harness('MisthalinMystery'),p=player();
    if(toIsland){h.quest.setStage(p,10);p.moveTo(new core.Location(3240,3142,0));}else island(h,p,10);
    const origin=p.getLocation().clone(),destination=toIsland?[1637,4802]:[3240,3142];p.log.length=0;
    object(h,p,toIsland?core.ObjectIdentifiers.ROWBOAT_9:core.ObjectIdentifiers.ROWBOAT_10);
    assert.equal(p.blocked,true);assert.equal(p.messages.length,0);
    const fades=()=>p.log.filter(row=>row[0]==='sendSubInterface');
    assert.deepEqual(fades()[0].slice(1),[(161<<16)|1,174,1,{postScripts:[{scriptId:948,args:[0,255,0,0,50]}]}]);
    const click={player:p,handled:false};h.emit('player:world-input',click);assert.equal(click.handled,true);
    h.tick(1);assert.ok(p.getLocation().equals(origin));assert.equal(p.messages.length,0);
    h.tick(1);assert.deepEqual([p.getLocation().getX(),p.getLocation().getY()],destination);assert.equal(p.messages.length,1);
    assert.equal(p.blocked,true,'returning area cleanup must not release control before fade-in');
    h.tick(1);assert.equal(p.blocked,false);assert.equal(p.varbits.get(12393),0);
    assert.deepEqual(fades().at(-1).at(-1),{postScripts:[{scriptId:948,args:[0,0,0,255,50]}]});
    h.tick(2);assert.deepEqual(p.log.at(-1),['closeSubInterface',(161<<16)|1]);
    h.hooks.onPlayerLogout[0]({player:p});
  }
});
test('logging out during rowboat fade cancels travel and releases movement',()=>{
  const h=harness('MisthalinMystery'),p=player();h.quest.setStage(p,10);
  const origin=p.getLocation().clone();object(h,p,core.ObjectIdentifiers.ROWBOAT_9);h.tick(1);
  h.hooks.onPlayerLogout[0]({player:p});h.tick(10);
  assert.ok(p.getLocation().equals(origin));assert.equal(p.getArea(),null);assert.equal(p.blocked,false);assert.equal(p.varbits.get(12393),0);
});
test('Misthalin writes only its stage varbit and restores partial candles independently',()=>{
  const h=harness('MisthalinMystery'),p=player();h.quest.setStage(p,50);assert.equal(p.varbits.get(3468),50);assert.equal(p.configs.get(1535),undefined);
  p.attrs.set('misthalin-mystery:candles',5);h.hooks.onPlayerLogin.at(-1)({player:p});assert.equal(p.varbits.get(4039),1);assert.equal(p.varbits.get(4041),1);
  h.quest.setStage(p,55);assert.equal(p.varbits.get(4039),1);assert.equal(p.varbits.get(4041),1);
});
test('the actual fourteen-key piano accepts four-note attempts and unlocks only DEAD',()=>{
  const h=harness('MisthalinMystery'),p=player();h.quest.setStage(p,75);object(h,p,core.ObjectIdentifiers.PIANO_9);
  assert.ok(p.log.some(row=>row[0]==='sendInterface'&&row[1]===554));
  const press=child=>h.hooks.onInterfaceActionButton.at(-1)({player:p,buttonId:(554<<16)|child});
  press(20);press(21);press(22);assert.equal(h.quest.getStage(p),75);assert.equal(p.varbits.get(4049),3);
  press(25);assert.equal(h.quest.getStage(p),75);assert.ok(p.messages.some(text=>text.includes('resets')));
  object(h,p,core.ObjectIdentifiers.PIANO_9);for(const child of [21,22,25,21])press(child);
  assert.equal(h.quest.getStage(p),80);assert.equal(p.items.get(I.EMERALD_KEY_2),undefined,'solving does not search the compartment');
  object(h,p,core.ObjectIdentifiers.PIANO_9);h.continueUntil(p,()=>!p.manager.getCurrent());assert.equal(p.items.get(I.EMERALD_KEY_2),1);
});
test('the native gemstone panel waits for six switches and gives the key only on a later search',()=>{
  const h=harness('MisthalinMystery'),p=player();h.quest.setStage(p,100);object(h,p,core.ObjectIdentifiers.FIREPLACE_24);
  assert.ok(p.log.some(row=>row[0]==='sendInterface'&&row[1]===555));
  const press=child=>h.hooks.onInterfaceActionButton.at(-1)({player:p,buttonId:(555<<16)|child});
  for(const child of [3,15,7,19,11])press(child);assert.equal(h.quest.getStage(p),100);press(23);assert.equal(h.quest.getStage(p),100);
  object(h,p,core.ObjectIdentifiers.FIREPLACE_24);for(const child of [19,3,11,23,7,15])press(child);assert.equal(h.quest.getStage(p),105);assert.equal(p.items.get(I.SAPPHIRE_KEY_2),undefined);
  object(h,p,core.ObjectIdentifiers.FIREPLACE_24);h.continueUntil(p,()=>!p.manager.getCurrent());assert.equal(p.items.get(I.SAPPHIRE_KEY_2),1);
});
test('riddle notes open the captured parchment rather than chat spam',()=>{
  const h=harness('MisthalinMystery'),p=player();h.quest.setStage(p,35);h.hooks.onItemAction[0]({player:p,itemId:I.NOTES_5,option:'Read'});
  assert.equal(h.quest.getStage(p),40);assert.ok(p.log.some(row=>row[0]==='sendInterface'&&row[1]===70));assert.ok(p.log.some(row=>row[0]==='text'&&row[1]===((70<<16)|3)&&row[2].includes('work of art')));assert.equal(p.messages.length,0);
});
test('the owner island runs the complete Sid and Tayten murders before changing stages',()=>{
  const h=harness('MisthalinMystery'),p=player();const area=island(h,p,10);p.moveTo(new core.Location(1615,4828,0));area.process(p);assert.equal(h.quest.getStage(p),15);assert.equal(p.blocked,true);
  h.continueUntil(p,()=>h.quest.getStage(p)===20&&area.scene===null,120);assert.equal(p.blocked,false);assert.ok(h.npcs.some(npc=>npc.animations.includes(7328)));
  assert.equal(p.log.filter(row=>row[0]==='sendCameraReset').length,0);h.tick(2);assert.equal(p.log.filter(row=>row[0]==='sendCameraReset').length,0);h.tick(1);assert.equal(p.log.filter(row=>row[0]==='sendCameraReset').length,1);
  assert.deepEqual(p.log.filter(row=>/^sendCamera(MoveTo|LookAt)$/.test(row[0])),[
    ['sendCameraMoveTo',1614,4826,300,{rate:232,rate2:232,heightRelative:false}],['sendCameraLookAt',1616,4831,275,{rate:232,rate2:232,heightRelative:false}],
    ['sendCameraMoveTo',1614,4826,300,{rate:10,rate2:15,heightRelative:false}],['sendCameraLookAt',1616,4831,275,{rate:20,rate2:20,heightRelative:false}],
    ['sendCameraMoveTo',1618,4836,500,{rate:10,rate2:10,heightRelative:false}],['sendCameraLookAt',1615,4832,500,{rate:10,rate2:10,heightRelative:false}],
  ]);
  h.quest.setStage(p,30);object(h,p,core.ObjectIdentifiers.DOOR_554,1635,4838);h.continueUntil(p,()=>h.quest.getStage(p)===35&&area.scene===null);
  assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraMoveTo').at(-1),['sendCameraMoveTo',1634,4841,1250,{rate:232,rate2:232,heightRelative:false}]);
  assert.ok(h.npcs.every(npc=>npc.owner===p&&npc.ownerOnly));
});
test('Sid is approached and faced before the stab, collapses at the barrel and the killer leaves before key recovery',()=>{
  const h=harness('MisthalinMystery'),p=player(),area=island(h,p,10);p.moveTo(new core.Location(1615,4828,0));area.process(p);h.tick(1);
  const killer=area.actors.get(N.KILLER),sid=area.actors.get(N.SID);
  assert.equal(p.manager.getCurrent().getNpcId(),N.SID);
  assert.equal(killer.id,N.KILLER_2);assert.deepEqual([killer.getLocation().getX(),killer.getLocation().getY()],[1619,4835]);
  p.manager.advance();assert.equal(p.text,'');h.tick(6);
  assert.deepEqual([killer.getLocation().getX(),killer.getLocation().getY()],[1615,4833]);assert.ok(killer.facing.equals(sid.getLocation()));
  h.tick(1);assert.match(p.text,/breathing on my neck/);assert.equal(p.manager.getCurrent().getNpcId(),N.SID);p.manager.advance();h.tick(1);assert.equal(sid.transform,N.SID_2);assert.deepEqual(sid.animations,[]);assert.equal(p.manager.getCurrent().getNpcId(),N.SID_2);
  h.continueUntil(p,()=>p.manager.getCurrent()?.getNpcId?.()===N.KILLER_2);
  h.continueUntil(p,()=>p.text==='...glargh...help...me...');assert.deepEqual([sid.getLocation().getX(),sid.getLocation().getY()],[1615,4830]);
  h.continueUntil(p,()=>sid.animations.includes(836));assert.match(p.text,/Sid collapses/);
  h.continueUntil(p,()=>h.quest.getStage(p)===20);assert.equal(killer.removed,true);assert.equal(area.actors.has(N.KILLER),false);assert.match(p.text,/Gah!/);assert.equal(sid.removed,undefined);
  h.continueUntil(p,()=>area.scene===null);h.tick(3);assert.equal(sid.removed,true);assert.equal(p.blocked,false);
});
test('Tayten is stabbed at close range and the killer drops the note and disappears into the wardrobe',()=>{
  const h=harness('MisthalinMystery'),p=player(),area=island(h,p,30);object(h,p,core.ObjectIdentifiers.DOOR_554,1635,4838);
  assert.equal(area.actors.has(N.KILLER),false);h.tick(4);const killer=area.actors.get(N.KILLER),tayten=area.actors.get(N.TAYTEN);
  assert.equal(killer.id,N.KILLER_2);assert.ok(killer.facing.equals(new core.Location(1637,4837,0)));
  h.tick(6);assert.deepEqual([killer.getLocation().getX(),killer.getLocation().getY()],[1638,4838]);assert.ok(killer.facing.equals(tayten.getLocation()));assert.deepEqual(killer.animations,[7328]);assert.deepEqual(tayten.animations,[]);
  h.tick(2);assert.equal(p.text,'Gurgle...');p.manager.advance();assert.equal(p.text,'Nooooo!');assert.deepEqual(tayten.animations,[836]);
  p.manager.advance();h.tick(6);assert.deepEqual([killer.getLocation().getX(),killer.getLocation().getY()],[1636,4838]);assert.ok(killer.animations.includes(827));
  h.tick(7);assert.deepEqual([killer.getLocation().getX(),killer.getLocation().getY()],[1637,4836]);assert.ok(killer.facing.equals(new core.Location(1637,4835,0)));assert.ok(killer.animations.includes(828));
  h.tick(1);assert.equal(killer.removed,true);assert.equal(h.quest.getStage(p),30);h.tick(2);assert.equal(h.quest.getStage(p),35);assert.match(p.text,/A note/);
  p.manager.advance();h.tick(2);assert.equal(area.scene,null);assert.equal(p.blocked,false);assert.equal(tayten.removed,true);
  assert.equal(h.objects.at(-1).getId(),core.ObjectIdentifiers.WARDROBE_4);
});
test('world clicks and interface closes cannot erase an active scene dialogue or its timed continuation',()=>{
  const h=harness('MisthalinMystery'),p=player(),area=island(h,p,30);object(h,p,core.ObjectIdentifiers.DOOR_554,1635,4838);
  for(const ticks of [0,12]){
    h.tick(ticks);const current=p.manager.getCurrent();
    for(const name of ['player:world-input','interface:close']){const event={player:p,handled:false};h.emit(name,event);assert.equal(event.handled,true,name);assert.equal(p.manager.getCurrent(),current);}
  }
  assert.equal(p.text,'Gurgle...');h.continueUntil(p,()=>area.scene===null);
  for(const name of ['player:world-input','interface:close']){const event={player:p,handled:false};h.emit(name,event);assert.equal(event.handled,false,name);}
  assert.equal(h.quest.getStage(p),35);assert.equal(p.blocked,false);
});
test('logging out during Tayten\'s opening hold cancels actor tasks and the door can restart after login',()=>{
  const h=harness('MisthalinMystery'),p=player(),area=island(h,p,30);object(h,p,core.ObjectIdentifiers.DOOR_554,1635,4838);h.tick(3);
  h.hooks.onPlayerLogout[0]({player:p});h.tick(20);assert.equal(area.isDestroyed(),true);assert.ok(h.npcs.every(npc=>npc.removed));assert.equal(p.blocked,false);assert.equal(p.manager.getCurrent(),undefined);
  h.hooks.onPlayerLogin.at(-1)({player:p});const restored=p.getArea();assert.notEqual(restored,area);object(h,p,core.ObjectIdentifiers.DOOR_554,1635,4838);
  h.tick(12);assert.equal(p.text,'Gurgle...');h.continueUntil(p,()=>restored.scene===null);assert.equal(h.quest.getStage(p),35);assert.equal(p.blocked,false);
});
test('Mandy kitchen directions do not abort the scene at imported unavailable markers',()=>{
  const h=harness('MisthalinMystery'),p=player();const area=island(h,p,85);object(h,p,core.ObjectIdentifiers.DOOR_560,1630,4840);h.continueUntil(p,()=>h.quest.getStage(p)===90);assert.equal(area.scene,null);assert.ok(p.log.some(row=>row[0]==='text'&&String(row[2]).includes('Another note')));
  assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraMoveTo'),[
    ['sendCameraMoveTo',1634,4848,1400,{rate:232,rate2:232,heightRelative:false}],
    ['sendCameraMoveTo',1622,4837,1400,{rate:10,rate2:10,heightRelative:false}],
    ['sendCameraMoveTo',1634,4848,1400,{rate:10,rate2:10,heightRelative:false}],
  ]);
});
test('Mandy camera pans wait for the actual continued scene actions and retain their captured gaps',()=>{
  const h=harness('MisthalinMystery'),p=player();island(h,p,85);object(h,p,core.ObjectIdentifiers.DOOR_560,1630,4840);
  h.tick(3);assert.equal(p.text,'');h.tick(1);assert.match(p.text,/clearing up/);
  h.continueUntil(p,()=>p.text==='Ok, well, here I go!');const count=p.log.filter(row=>row[0]==='sendCameraMoveTo').length;
  h.tick(20);assert.equal(p.log.filter(row=>row[0]==='sendCameraMoveTo').length,count,'reading time cannot advance the next camera');
  p.manager.advance();assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[1622,4837,1400]);
  h.tick(7);assert.equal(p.text,'');h.tick(1);assert.equal(p.text,'Hello, anyone out here?');
  h.continueUntil(p,()=>p.text==='That psycho! He was just toying with her!');p.manager.advance();
  h.tick(13);assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[1622,4837,1400]);
  h.tick(1);assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[1634,4848,1400]);
  h.tick(2);assert.match(p.text,/Another note/);
});
test('mirror pushing, shadow warnings and three correctly faced reflections unlock the actual confrontation',()=>{
  const h=harness('MisthalinMystery'),p=player(),area=island(h,p,110);object(h,p,core.ObjectIdentifiers.DOOR_561,1628,4827);h.continueUntil(p,()=>h.quest.getStage(p)===111);assert.equal(area.fighting,true);
  h.tick(21);
  object(h,p,core.ObjectIdentifiers.DOOR_561,1628,4827);assert.equal(h.quest.getStage(p),111,'the door cannot bypass the mirror encounter');
  const mirror=area.actors.get(7436);p.moveTo(new core.Location(1621,4828,0));h.npcActions.get('<col=00ffff>Mirror</col>').Push({player:p,npc:mirror});h.tick(2);assert.equal(mirror.getLocation().getX(),1623);p.moveTo(new core.Location(1624,4828,0));h.npcActions.get('<col=00ffff>Mirror</col>').Push({player:p,npc:mirror});h.tick(2);assert.equal(mirror.getLocation().getX(),1622);
  area.warning=[1619,4828,0];const original=Math.random;Math.random=()=>0.99;
  try{h.tick(54);}finally{Math.random=original;}
  assert.equal(area.reflections,3);assert.equal(h.quest.getStage(p),115);assert.equal(area.fighting,false);assert.equal(area.scene,'reveal');h.tick(2);const reaction=h.npcs.find(n=>n.id===7639);assert.equal(reaction.hitpoints,10);assert.equal(reaction.hits.length,3);assert.equal(mirror.transform,7640);
  assert.equal(h.ground.length,0,'the weapon only drops after the killers reveal themselves');
  h.continueUntil(p,()=>h.quest.getStage(p)===120,150);assert.equal(h.ground.length,1);assert.equal(h.ground[0][1].getId(),I.KILLERS_KNIFE_2);
  assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraMoveTo').at(-1),['sendCameraMoveTo',1622,4828,300,{rate:5,rate2:5,heightRelative:false}]);
  assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraLookAt').slice(-2),[
    ['sendCameraLookAt',1627,4831,275,{rate:5,rate2:5,heightRelative:false}],['sendCameraLookAt',1624,4831,275,{rate:5,rate2:5,heightRelative:false}],
  ]);
});
test('Abigale requires the equipped dropped knife, then Mandy rescues the player and rewards exactly once',()=>{
  const h=harness('MisthalinMystery'),p=player(),area=island(h,p,120);
  h.npcActions.get('Abigale').Fight({player:p});h.continueUntil(p,()=>!p.manager.getCurrent());assert.equal(h.quest.getStage(p),120);
  p.items.set(I.KILLERS_KNIFE_2,1);h.npcActions.get('Abigale').Fight({player:p});h.continueUntil(p,()=>!p.manager.getCurrent());assert.equal(h.quest.getStage(p),120,'carrying it is not wielding it');
  p.items.set(I.KILLERS_KNIFE_2,0);p.weapon=I.KILLERS_KNIFE_2;h.npcActions.get('Abigale').Fight({player:p});h.continueUntil(p,()=>h.quest.getStage(p)===125);
  object(h,p,core.ObjectIdentifiers.DOOR_561,1628,4827);h.continueUntil(p,()=>h.quest.getStage(p)===130,120);assert.equal(p.weapon,null);assert.equal(area.scene,null);assert.ok(h.npcs.some(npc=>npc.animations.includes(7642)));h.tick(2);assert.ok(h.npcs.some(npc=>npc.transform===N.MANDY_3));
  assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraMoveTo').at(-1),['sendCameraMoveTo',1620,4826,1300,{rate:232,rate2:232,heightRelative:false}]);
  assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraLookAt').at(-1),['sendCameraLookAt',1626,4833,150,{rate:232,rate2:232,heightRelative:false}]);
  h.talk(p,N.MANDY_2);h.continueUntil(p,()=>h.quest.isComplete(p));assert.equal(p.attrs.get('quest.points'),1);assert.deepEqual(p.xp,[[core.Skill.CRAFTING.getIndex(),600]]);for(const id of [I.UNCUT_RUBY,I.UNCUT_EMERALD,I.UNCUT_SAPPHIRE])assert.equal(p.items.get(id),1);
});
test('all four Lacey answers continue through her murder and the next note',()=>{
  for(const answer of ['Count Draynor','Count Check','Lord Drakan','Say nothing']){
    const h=harness('MisthalinMystery'),p=player(),area=island(h,p,65);p.moveTo(new core.Location(1631,4849,0));area.process(p);continueToMenu(h,p);h.choose(p,answer);h.continueUntil(p,()=>h.quest.getStage(p)===70,100);assert.equal(area.scene,null,answer);
  }
});
test('the mirror cannot move below its captured south boundary or score on a wrong-facing reflection',()=>{
  const h=harness('MisthalinMystery'),p=player(),area=island(h,p,110);object(h,p,core.ObjectIdentifiers.DOOR_561,1628,4827);h.continueUntil(p,()=>h.quest.getStage(p)===111);
  h.tick(21);
  const mirror=area.actors.get(7436);p.moveTo(new core.Location(1622,4829,0));h.npcActions.get('<col=00ffff>Mirror</col>').Push({player:p,npc:mirror});h.tick(2);assert.equal(mirror.getLocation().getY(),4828);assert.ok(p.messages.includes("The mirror can't go any further in that direction."));
  area.warning=[1619,4828,0];h.tick(16);assert.equal(area.reflections,0);assert.equal(h.quest.getStage(p),111);assert.ok(p.log.some(row=>row[0]==='sendProjectile'));
});
test('mirror pushes retain their direction and encoded knife routes use captured heights and wardrobe endpoints', (t) => {
  const wardrobes = [[1622,4834,1],[1627,4831,2],[1624,4825,3],[1619,4828,0]];
  const destinations = [[1622,4831],[1624,4831],[1624,4830],[1623,4828]];
  let choice = 0;
  t.mock.method(Math, 'random', () => (choice + 0.5) / 4);
  for (choice = 0; choice < 4; choice++) {
    const h=harness('MisthalinMystery'),p=player(),area=island(h,p,110),sent=[];
    const sender=new PacketSender({getSession:()=>({sendClientPacket:packet=>{sent.push(packet);return true;}})});
    const packets=p.getPacketSender();
    packets.sendProjectile=(...args)=>sender.sendProjectile(...args);
    packets.sendGraphic=(...args)=>sender.sendGraphic(...args);
    object(h,p,core.ObjectIdentifiers.DOOR_561,1628,4827);
    h.continueUntil(p,()=>h.quest.getStage(p)===111);
    assert.equal(sent.length,0,'no warning under the intro camera');
    h.tick(20);assert.equal(sent.length,0);
    h.tick(1);
    const warning=sent[0].subarray(-11),where=wardrobes[choice];
    assert.equal(warning.readUInt16BE(0),483);
    assert.deepEqual([warning.readUInt16BE(3),warning.readUInt16BE(5),warning[8]],[where[0],where[1],1]);
    const [x,y]=destinations[choice],dx=Math.sign(where[0]-x),dy=Math.sign(where[1]-y);
    const mirror=area.actors.get(7436);
    mirror.moveTo(new core.Location(x-dx,y-dy,0));p.moveTo(new core.Location(x-2*dx,y-2*dy,0));
    h.npcActions.get('<col=00ffff>Mirror</col>').Push({player:p,npc:mirror});h.tick(2);
    assert.equal(mirror.direction,core.Direction.fromDeltas(dx,dy));
    assert.ok(mirror.facing.equals(new core.Location(x+dx,y+dy,0)));
    h.tick(12);
    const outward=sent[1].subarray(-29),returned=sent[2].subarray(-29);
    for(const packet of [outward,returned]){
      assert.equal(packet.readUInt16BE(0),214);
      assert.equal(packet.readUInt16BE(7),163,'native V2 start height is not multiplied twice');
      assert.equal(packet.readUInt16BE(14),146);
    }
    const endpoints=packet=>[packet.readUInt16BE(2),packet.readUInt16BE(4),packet.readUInt16BE(9),packet.readUInt16BE(11)];
    assert.deepEqual(endpoints(outward),[where[0],where[1],x,y]);
    assert.deepEqual(endpoints(returned),[x,y,where[0],where[1]]);
    assert.equal(outward.readUInt16BE(19),41);assert.equal(returned.readUInt16BE(19),82);
    h.hooks.onPlayerLogout[0]({player:p});
  }
});
test('colored door handover consumes its own key when old keys have been recovered',()=>{
  const h=harness('MisthalinMystery'),p=player();h.quest.setStage(p,80);p.items.set(I.RUBY_KEY_2,1);p.items.set(I.EMERALD_KEY_2,1);
  const obstacle=require('../plugins/skills/agility/ObstacleRunner.Agility'),run=obstacle.run;obstacle.run=noop;
  try{object(h,p,core.ObjectIdentifiers.DOOR_559,1633,4833);h.continueUntil(p,()=>h.quest.getStage(p)===85);}finally{obstacle.run=run;}
  assert.equal(p.items.get(I.EMERALD_KEY_2),0);assert.equal(p.items.get(I.RUBY_KEY_2),1);
});
test('leaving and re-entering the private island replaces Mandy and cancels owned tasks',()=>{
  const h=harness('MisthalinMystery'),p=player(),area=island(h,p,130),old=h.npcs.find(n=>n.id===N.MANDY_2);area.leave(p,false);assert.equal(old.removed,true);assert.equal(area.isDestroyed(),true);
  h.hooks.onPlayerLogin.at(-1)({player:p});const current=h.npcs.filter(n=>n.id===N.MANDY_2&&!n.removed);assert.equal(current.length,1);assert.notEqual(current[0],old);assert.equal(current[0].getArea(),p.getArea());
});
test('Mandy needs three slots and awards ruby, emerald, sapphire once with the captured scroll rows',()=>{
  const h=harness('MisthalinMystery'),p=player();island(h,p,130);p.free=2;h.talk(p,N.MANDY_2);h.continueUntil(p,()=>!p.manager.getCurrent());assert.equal(h.quest.getStage(p),130);assert.ok(p.text.includes('another space'));assert.equal(p.xp.length,0);
  p.free=3;h.talk(p,N.MANDY_2);h.continueUntil(p,()=>h.quest.isComplete(p));assert.deepEqual([...p.items.keys()],[I.UNCUT_RUBY,I.UNCUT_EMERALD,I.UNCUT_SAPPHIRE]);assert.deepEqual(h.quest.otherRewards,['An Uncut Emerald','An Uncut Sapphire']);assert.equal(h.quest.scrollItemId,I.KILLERS_KNIFE_2);
  h.talk(p,N.MANDY_2);h.continueUntil(p,()=>!p.manager.getCurrent());assert.equal(p.xp.length,1);assert.equal(p.attrs.get('quest.points'),1);
});
test('leaving the explosives room at the door tile triggers the captured four-tick explosion',()=>{
  const h=harness('MisthalinMystery'),p=player(),area=island(h,p,60);p.moveTo(new core.Location(1641,4828,0));area.process(p);h.tick(5);assert.equal(h.quest.getStage(p),60);
  p.moveTo(new core.Location(1640,4828,0));area.process(p);h.tick(3);assert.equal(h.quest.getStage(p),60);assert.equal(p.blocked,true);h.tick(1);assert.equal(h.quest.getStage(p),65);assert.ok(p.log.some(row=>row[0]==='sendSoundEffect'&&row[1]===1487));h.tick(1);assert.equal(p.blocked,false);
});
