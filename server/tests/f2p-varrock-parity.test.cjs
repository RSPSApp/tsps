// From server/: node --test tests/f2p-varrock-parity.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const nativeDialogueCondition = PluginManager.emitNpcDialogueCondition;
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
let nextIndex = 1;
const noop = () => {};
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, '..')); new NpcDefinitionLoader().load(); });

function harness(name) {
  const hooks = {}, events = {}, tasks = [], npcs = [], removed = [];
  const api = new Proxy({ core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  }, ObjectManager: { register: noop, deregister: noop },
    PathFinder: { calculateWalkRoute(npc, x, y) { npc.walkingTo = new core.Location(x, y, npc.getLocation().getZ()); } } },
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z), area = null;
      const npc = { ...definition, animations: [], graphics: [], getId: () => definition.id, getIndex: () => npc.index,
        index: nextIndex++, getLocation: () => location, moveTo: to => { location = to; },
        getArea: () => area, setArea: value => { area = value; }, isNpc: () => true, isPlayer: () => false, getAsNpc: () => npc,
        isRegistered: () => !npc.removed, setPositionToFace: noop, forceChat: text => { npc.said = text; },
        performAnimation: animation => npc.animations.push(animation.getId()), performGraphic: graphic => npc.graphics.push(graphic.id),
        getMovementQueue: () => ({ addSteps: to => { npc.walkingTo = to; } }),
        setCombatXpMultiplier: value => { npc.multiplier = value; },
        getCombat: () => ({ attack: player => { npc.target = player; } }),
      }; npcs.push(npc); return npc;
    }, removeNpc: npc => { npc.removed = true; removed.push(npc); },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) { const answer = fn(event); if (answer !== null && answer !== undefined) return answer; }
    return null;
  };
  const h = { api, hooks, events, tasks, npcs, removed, quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    line(p, npcId, text) { const event = { player: p, npcId, text }; h.emit('npc-dialogue:line', event); return event; },
    action(p, npcId, stepId) { const event = { player: p, npcId, stepId }; h.emit('npc-dialogue:action', event); return event; },
    talk(p, npcId) { const choice = hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId })).find(Boolean); assert.ok(choice); runtime.startTranscript(api, p, npcId, choice.page, choice.variant); },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
    choose(p, text) { const prompt = p.prompt; assert.ok(prompt, `no menu for ${text}`); const index = prompt.options.findIndex(label => label === text); assert.ok(index >= 0, `missing ${text} in ${prompt.options}`); p.prompt = null; prompt.pairs[index * 2 + 1](); },
    continueUntil(p, predicate, limit = 160) { while (!predicate()) { assert.ok(limit-- > 0, `dialogue stalled at ${p.text}`); const current=p.manager.getCurrent();assert.ok(current, `dialogue ended at ${p.text}`);if(current instanceof core.ActionDialogue)h.tick(1);else p.manager.advance(); } },
  }; return h;
}
function player() {
  const attrs = new Map(), items = new Map(), configs = new Map(), varbits = new Map(), log = [], xp = [];
  let location = new core.Location(3210, 3220, 0), area = null;
  const inv = { getAmount: id => items.get(id) ?? 0, isFull: () => Boolean(p.full), getFreeSlots: () => p.full ? 0 : 28,
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
    getBanks: () => [{ getAmount: id => p.bank?.get(id) ?? 0 }], getEquipment: () => ({ get: () => p.amulet ? { getId: () => p.amulet } : null }),
    getPacketSender: () => packet, getDialogueManager: () => p.manager, getUpdateFlag: () => ({ flag: noop }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(),amount]), getCombatLevel: () => p.combat ?? 3 }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement(value) { p.blocked = value; return this; } }),
    setUntargetable: value => { p.untargetable = value; }, getLocation: () => location, moveTo: to => { location = to; },
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; }, getIndex: () => p.index,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getUsername: () => 'Parity', getDisplayName: () => 'Parity', getAppearance: () => ({ isMale: () => true }), setPositionToFace: noop, forceChat: noop,
    performAnimation: a => p.animations.push(a.getId()), sendMessage: text => p.messages.push(text),
  }; p.manager = new DialogueManager(p); return p;
}
const continueToMenu = (h,p) => h.continueUntil(p, () => Boolean(p.prompt));

test('Rune Mysteries plays the real start, delivers three captured item boxes, and survives interrupted notes', () => {
  const h = harness('RuneMysteries'), p = player();
  h.talk(p,N.DUKE_HORACIO);continueToMenu(h,p);h.choose(p,'Have you any quests for me?');continueToMenu(h,p);
  h.choose(p,'Yes.');assert.equal(h.quest.getStage(p),0);p.manager.advance();assert.equal(h.quest.getStage(p),1);
  assert.equal(p.items.get(I.AIR_TALISMAN),undefined,'Duke has not handed it over yet');p.manager.advance();assert.equal(p.items.get(I.AIR_TALISMAN),1);
  assert.equal(p.varbits.get(13720),1);
  h.action(p,5034,'DvfTKd');assert.equal(p.items.get(I.AIR_TALISMAN),0);assert.equal(h.quest.getStage(p),2);
  h.line(p,5034,'Yes, certainly.').after();assert.equal(h.quest.getStage(p),3);
  assert.deepEqual(h.action(p,5034,'-N0E2K').box.items,[I.RESEARCH_PACKAGE]);
  h.action(p,2886,'44bs50');assert.equal(h.quest.getStage(p),4);
  h.line(p,2886,'Here, take these notes back to Sedridor. They should hopefully give him everything he needs.').before();
  assert.equal(h.quest.getStage(p),5);h.action(p,2886,'INsogy');
  assert.deepEqual(h.action(p,5034,'XMgO9a').box.items,[I.RESEARCH_NOTES_4]);assert.equal(p.items.get(I.RESEARCH_NOTES_4),0);
  assert.equal(h.quest.getStage(p),5);
  assert.equal(h.hooks.onNpcDialogueCondition[0]({player:p,npcId:5034,text:'If the player has the notes:'}),true);
  h.action(p,5034,'3-8qg3');assert.equal(h.quest.getStage(p),6);assert.equal(p.items.get(I.AIR_TALISMAN),1);assert.equal(p.attrs.get('quest.points'),1);
  h.action(p,5034,'3-8qg3');assert.equal(p.items.get(I.AIR_TALISMAN),1);
  assert.equal(h.hooks.onNpcInteraction,undefined,'the canonical Runecrafting plugin owns wizard teleports');
});

test('Rune interrupted package/research conversations resume instead of treating directions as dialogue', () => {
  const h=harness('RuneMysteries'),p=player();h.quest.setStage(p,2);
  h.action(p,5034,'EpfUcz');assert.match(p.text,/normal air talisman/);
  h.quest.setStage(p,4);h.action(p,2886,'134Rji');assert.equal(p.text,'Now, let\'s have a look...');
});

test('Restless Ghost warns low combat players and grants no amulet or stage on a full inventory', () => {
  const h=harness('RestlessGhost'),p=player();h.talk(p,N.FATHER_AERECK);continueToMenu(h,p);h.choose(p,"I'm looking for a quest!");
  h.continueUntil(p,()=>p.text.includes('Before starting this quest'));assert.equal(p.prompt,null);p.manager.advance();assert.match(p.prompt.title,/Start The Restless Ghost/);
  h.choose(p,'Yes');assert.equal(h.quest.getStage(p),1);p.full=true;h.action(p,N.FATHER_URHNEY,'Nn953X');assert.equal(h.quest.getStage(p),1);assert.equal(p.items.get(I.GHOSTSPEAK_AMULET),undefined);
  p.full=false;assert.deepEqual(h.action(p,N.FATHER_URHNEY,'Nn953X').box.items,[I.GHOSTSPEAK_AMULET]);assert.equal(h.quest.getStage(p),2);
  p.items.set(I.GHOSTSPEAK_AMULET,0);p.bank=new Map([[I.GHOSTSPEAK_AMULET,1]]);h.action(p,N.FATHER_URHNEY,'TkNeQZ');assert.equal(p.items.get(I.GHOSTSPEAK_AMULET),0);
  assert.equal(h.hooks.onNpcDialogueCondition[0]({player:p,npcId:N.FATHER_URHNEY,text:"If the amulet if stored in a bank, Death's Office, Item Retrieval Service:"}),true);
});

test('Restless Ghost progresses after explaining the skull, then summons the captured optional skeleton', () => {
  const h=harness('RestlessGhost'),p=player();h.quest.setStage(p,2);
  assert.equal(h.line(p,N.RESTLESS_GHOST,'Ok. I will try and get the skull back for you, then you can rest in peace.').after,undefined);
  h.line(p,N.RESTLESS_GHOST,'Ooh, thank you. That would be such a great relief!').after();assert.equal(h.quest.getStage(p),3);
  h.hooks.onObjectFirstClick.at(-1)({player:p});assert.equal(h.quest.getStage(p),4);assert.equal(p.items.get(I.GHOSTS_SKULL),1);
  const skeleton=h.npcs.at(-1);assert.equal(skeleton.id,924);assert.equal(skeleton.multiplier,0.025);assert.deepEqual(skeleton.animations,[4017]);
  h.tick(2);assert.equal(skeleton.target,p);assert.equal(p.varbits.get(2130),1);assert.equal(p.varbits.get(2128),1);
  h.tick(98);assert.equal(skeleton.removed,true);
});

function coffin(core,id=15061) { return new core.GameObject(id,new core.Location(3249,3192,0),10,0); }
test('Restless river scene has three captured projectiles, delayed reward and safe recovery', () => {
  const h=harness('RestlessGhost'),p=player();h.quest.setStage(p,4);p.items.set(I.GHOSTS_SKULL,1);
  h.hooks.onItemOnObject[0]({player:p,itemId:I.GHOSTS_SKULL,objectId:15061,object:coffin(core)});
  assert.equal(p.items.get(I.GHOSTS_SKULL),0);assert.equal(p.configs.get(107),5);assert.equal(p.xp.length,0);
  h.tick(3);assert.ok(p.getArea() instanceof core.TemplatedInstanceArea);assert.equal(p.blocked,true);
  const release=p.getArea(),first=release.sourceTile(3252,3193);
  assert.deepEqual(p.log.find(row=>row[0]==='sendCameraMoveTo'),['sendCameraMoveTo',first.getX(),first.getY(),350,{rate:100,rate2:100,heightRelative:false}]);
  h.tick(14);assert.equal(p.log.filter(row=>row[0]==='sendProjectile').length,3);assert.equal(p.xp.length,0);
  assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraLookAt').at(-1).slice(3),[25,{rate:5,rate2:5,heightRelative:false}]);
  h.tick(6);assert.equal(h.quest.getStage(p),5);assert.deepEqual(p.xp,[[core.Skill.PRAYER.getIndex(),1125]]);assert.equal(p.getArea(),null);
  assert.deepEqual([p.getLocation().getX(),p.getLocation().getY()],[3247,3193]);
  const q=player();h.quest.setStage(q,4);q.attrs.set('restless-ghost:release-pending',1);h.hooks.onPlayerLogin.at(-1)({player:q});h.hooks.onPlayerLogin.at(-1)({player:q});assert.equal(q.xp.length,1);
});

test('Romeo message and potion changes occur on the captured lines and handover boxes', () => {
  const h=harness('RomeoAndJuliet'),p=player();h.emit('npc-dialogue:hook',{player:p,npcId:N.ROMEO,hook:'quest:romeo-juliet:start'});
  assert.equal(h.quest.getStage(p),0);h.line(p,N.ROMEO,'Oh great! And tell her that I want to kiss her a give.').after();assert.equal(h.quest.getStage(p),10);
  h.action(p,N.JULIET,'2xqCe8');assert.equal(h.quest.getStage(p),20);assert.equal(p.items.get(I.MESSAGE),1);
  h.action(p,N.ROMEO,'azqQuD');assert.equal(h.quest.getStage(p),20);assert.equal(p.items.get(I.MESSAGE),0);
  h.line(p,N.ROMEO,'Father Lawrence?').before();assert.equal(h.quest.getStage(p),30);
  h.line(p,N.FATHER_LAWRENCE,"Then Romeo can collect her from the crypt! Go to the Apothecary, tell him I sent you and that you'll need a 'Cadava' potion.").before();assert.equal(h.quest.getStage(p),40);
  h.line(p,N.APOTHECARY,'I have all that, but I need some Cadava berries.').before();assert.equal(h.quest.getStage(p),50);
  p.items.set(I.CADAVA_BERRIES,1);assert.deepEqual(h.action(p,N.APOTHECARY,'3oxHI6').box.items,[I.CADAVA_BERRIES]);assert.equal(p.items.get(I.CADAVA_BERRIES),0);
  h.action(p,N.APOTHECARY,'eeTqTE');assert.equal(p.items.get(I.CADAVA_BERRIES),0);assert.equal(p.items.get(I.CADAVA_POTION),1);
  assert.deepEqual(h.action(p,N.JULIET,'9YlDKS').box.items,[I.CADAVA_POTION]);assert.equal(h.quest.getStage(p),50);assert.equal(p.items.get(I.CADAVA_POTION),1);
});

test('Romeo berries handed over in a closed conversation still make one potion after a relog', () => {
  const h=harness('RomeoAndJuliet'),p=player(),cond=text=>h.hooks.onNpcDialogueCondition.map(fn=>fn({player:p,npcId:N.APOTHECARY,text})).find(a=>a!==null&&a!==undefined);
  h.quest.setStage(p,50);p.items.set(I.CADAVA_BERRIES,1);h.action(p,N.APOTHECARY,'Be9l32');
  assert.equal(p.items.get(I.CADAVA_BERRIES),0);assert.equal(p.attrs.get('romeo-and-juliet:berries-handed-over'),1);
  h.hooks.onPlayerLogout.at(-1)({player:p});assert.equal(cond('With some cadava berries:'),true);
  p.full=true;h.action(p,N.APOTHECARY,'Be9l32');assert.equal(h.action(p,N.APOTHECARY,'Cw477j').end,true);
  assert.equal(p.items.get(I.CADAVA_POTION)??0,0);assert.equal(p.attrs.get('romeo-and-juliet:berries-handed-over'),1);
  p.full=false;h.action(p,N.APOTHECARY,'Be9l32');assert.equal(p.items.get(I.CADAVA_BERRIES),0);
  h.action(p,N.APOTHECARY,'Cw477j');assert.equal(p.items.get(I.CADAVA_POTION),1);assert.equal(p.attrs.get('romeo-and-juliet:berries-handed-over'),0);
  p.items.set(I.CADAVA_POTION,0);assert.equal(cond('Without any cadava berries:'),true);
  h.action(p,N.APOTHECARY,'Cw477j');assert.equal(p.items.get(I.CADAVA_POTION),0);
});

test('Juliet and crypt scenes use separate copied maps, retain potion until the last line, and clean up', () => {
  const h=harness('RomeoAndJuliet'),p=player();h.quest.setStage(p,50);p.items.set(I.CADAVA_POTION,1);p.moveTo(new core.Location(3158,3426,1));
  h.action(p,N.JULIET,'LEub3y');h.tick(3);const room=p.getArea();assert.ok(room instanceof core.TemplatedInstanceArea);assert.equal(room.getChunk(1,0,0).sourceChunkX,393);
  for(let x=0;x<4;x++)for(let y=0;y<4;y++)assert.deepEqual(room.getChunk(0,x,y),{...room.getChunk(1,x,y),sourcePlane:0},'the balcony retains the ground floor beneath every copied upper-floor chunk');
  const chunkCounts=scene=>scene.buildScenePalette(scene.baseChunkX,scene.baseChunkY).palette.map(plane=>plane.flat().filter(chunk=>chunk!==-1).length);
  assert.deepEqual(chunkCounts(room),[16,16,0,0]);
  h.line(p,N.JULIET,'Poor Juliet...make preparations for her body to be placed in the Crypt...').after();assert.equal(h.quest.getStage(p),60);assert.equal(p.items.get(I.CADAVA_POTION),0);h.tick(3);assert.equal(p.getArea(),null);
  p.moveTo(new core.Location(3215,3418,0));h.action(p,N.ROMEO,'UCaOJi');h.tick(3);assert.equal(p.getArea().getChunk(0,0,0).sourceChunkX,290);
  assert.deepEqual(chunkCounts(p.getArea()),[16,0,0,0],'the crypt still copies only its original ground-floor map');
  h.action(p,N.ROMEO,'PO2Wli');assert.equal(h.quest.getStage(p),60);h.tick(5);assert.equal(h.quest.getStage(p),100);assert.equal(p.attrs.get('quest.points'),5);assert.equal(p.varbits.get(1838),2);assert.equal(p.items.get(I.CADAVA_POTION),0);
  assert.deepEqual([p.getLocation().getX(),p.getLocation().getY()],[3215,3418]);
});

test('the optional Cadava drink preserves Hitpoints, swaps only the potion for a vial, and restores camera', () => {
  const h=harness('RomeoAndJuliet'),p=player();p.items.set(I.CADAVA_POTION,1);p.moveTo(new core.Location(3193,3403,0));
  h.hooks.onItemAction[0]({player:p,itemId:I.CADAVA_POTION,option:'Drink'});h.choose(p,"Yes, I'll drink it all down.");assert.match(p.text,/defiance/);p.manager.advance();
  h.tick(2);assert.equal(p.items.get(I.CADAVA_POTION),0);assert.equal(p.items.get(I.VIAL),1);h.tick(18);assert.equal(p.blocked,false);assert.equal(p.untargetable,false);assert.match(p.text,/out for hours/);assert.deepEqual(p.animations,[829,836,65535]);assert.equal(h.quest.getStage(p),0);
});
test('the crypt tour restores every captured camera shot and waits for each timed pan before continuing',()=>{
  const h=harness('RomeoAndJuliet'),p=player();h.quest.setStage(p,60);h.action(p,N.ROMEO,'UCaOJi');h.tick(3);
  const scene=p.getArea(),tile=(x,y)=>{const p=scene.sourceTile(x,y);return [p.getX(),p.getY()];};
  h.continueUntil(p,()=>p.text==="We're here. Look, Juliet is over there!");
  assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraMoveTo').at(-1),['sendCameraMoveTo',...tile(2330,4641),400,{rate:100,rate2:100,heightRelative:false}]);
  const start=p.log.length;p.manager.advance();
  assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[...tile(2334,4647),375]);
  h.tick(4);assert.equal(p.log.slice(start).filter(row=>row[0]==='sendCameraMoveTo').length,1);
  h.tick(1);assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[...tile(2330,4647),375]);
  h.tick(3);assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[...tile(2324,4644),250]);
  h.tick(7);assert.deepEqual(p.log.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[...tile(2330,4641),400]);
  h.tick(1);assert.match(p.text,/You go over to her/);
  assert.deepEqual(p.log.slice(start).filter(row=>/^sendCamera(MoveTo|LookAt)$/.test(row[0])),[
    ['sendCameraMoveTo',...tile(2334,4647),375,{rate:10,rate2:10,heightRelative:false}],['sendCameraLookAt',...tile(2322,4639),250,{rate:10,rate2:10,heightRelative:false}],
    ['sendCameraMoveTo',...tile(2330,4647),375,{rate:5,rate2:5,heightRelative:false}],['sendCameraLookAt',...tile(2320,4639),250,{rate:5,rate2:5,heightRelative:false}],
    ['sendCameraMoveTo',...tile(2324,4644),250,{rate:5,rate2:5,heightRelative:false}],['sendCameraLookAt',...tile(2320,4639),200,{rate:5,rate2:5,heightRelative:false}],
    ['sendCameraMoveTo',...tile(2330,4641),400,{rate:100,rate2:100,heightRelative:false}],['sendCameraLookAt',...tile(2342,4655),25,{rate:100,rate2:100,heightRelative:false}],
  ]);
  h.continueUntil(p,()=>!p.manager.getCurrent());h.tick(5);assert.equal(h.quest.getStage(p),100);
  assert.ok(p.log.some(row=>row[0]==='sendCameraUnlock'&&row[1]===false));
});

test('Imp Catcher fast-start plays the check, timed ritual, separate stage/reward ticks and one spare exchange', () => {
  const h=harness('ImpCatcher'),p=player();for(const id of [I.RED_BEAD,I.BLACK_BEAD,I.WHITE_BEAD,I.YELLOW_BEAD])p.items.set(id,2);
  h.talk(p,5005);continueToMenu(h,p);h.choose(p,'Give me a quest please.');continueToMenu(h,p);h.choose(p,'Yes.');assert.equal(h.quest.getStage(p),1);
  h.continueUntil(p,()=>p.text.includes('four coloured beads'));assert.equal(p.xp.length,0);assert.equal(p.items.get(I.RED_BEAD),2);
  h.tick(7);assert.equal(p.items.get(I.RED_BEAD),1);assert.equal(p.configs.get(160),2);assert.equal(p.items.get(I.AMULET_OF_ACCURACY),undefined);
  assert.deepEqual(p.log.filter(row=>/^sendCamera(MoveTo|LookAt)$/.test(row[0])),[
    ['sendCameraLookAt',3103,3162,350,{rate:232,rate2:100,heightRelative:false}],['sendCameraMoveTo',3103,3161,775,{rate:232,rate2:100,heightRelative:false}],
  ]);
  h.tick(10);assert.equal(p.items.get(I.AMULET_OF_ACCURACY),1);assert.deepEqual(p.xp,[[core.Skill.MAGIC.getIndex(),875]]);assert.equal(p.attrs.get('quest.points'),undefined);
  h.tick(2);assert.equal(p.attrs.get('quest.points'),1);assert.equal(h.quest.getStage(p),2);
  h.action(p,5005,'jxPdQz');assert.equal(p.items.get(I.AMULET_OF_ACCURACY),2);assert.equal(p.xp.length,1);
});

test('Imp Catcher journal follows the wiki journal transcript at every stage', () => {
  const h = harness('ImpCatcher'), p = player(), quest = h.quest;
  assert.deepEqual(quest.buildJournal(p, quest), [
    "I can start this quest by talking to",
    "<col=800000>Wizard Mizgog</col> in the",
    "<col=800000>Wizards' Tower</col>.",
    "",
    "There aren't any requirements for this quest.",
  ]);
  quest.setStage(p, 1);
  const collecting = quest.buildJournal(p, quest);
  assert.equal(collecting[0], "<str>I have spoken to Wizard Mizgog.</str>");
  assert.equal(collecting[2], "I need to collect some items by killing <col=800000>Imps</col>, I can");
  assert.equal(collecting[3], "find Imps all over the kingdom.");
  assert.ok(collecting.includes("<col=800000>1 Black Bead.</col>"));
  for (const id of [I.RED_BEAD, I.BLACK_BEAD, I.WHITE_BEAD, I.YELLOW_BEAD]) p.items.set(id, 1);
  const ready = quest.buildJournal(p, quest);
  assert.deepEqual(ready.slice(2), [
    "I have collected all the missing beads and need to return",
    "them to <col=800000>Wizard Mizgog</col>.",
  ]);
  quest.setStage(p, 2);
  assert.deepEqual(quest.buildJournal(p, quest).slice(-3), [
    "<str>Wizard Mizgog thanked me for finding his beads and gave me an</str>",
    "<str>Amulet of Accuracy.</str>",
    "<col=ff0000>QUEST COMPLETE!</col>",
  ]);
});

test('Rune Mysteries complete short-route dialogue round trip gives the package, tea and final talisman once', () => {
  const h=harness('RuneMysteries'),p=player();h.quest.setStage(p,1);p.items.set(I.AIR_TALISMAN,1);
  h.talk(p,5034);continueToMenu(h,p);h.choose(p,'Okay, here you are.');continueToMenu(h,p);h.choose(p,"Actually, I'm not interested.");continueToMenu(h,p);h.choose(p,'Yes, certainly.');
  h.continueUntil(p,()=>!p.manager.getCurrent());assert.equal(p.items.get(I.RESEARCH_PACKAGE),1);assert.equal(h.quest.getStage(p),3);assert.ok(p.log.some(row=>row[0]==='text'&&String(row[2]).includes("don't remember telling")));
  h.talk(p,2886);continueToMenu(h,p);h.choose(p,"I've been sent here with a package for you.");continueToMenu(h,p);assert.equal(h.quest.getStage(p),5);assert.equal(p.items.get(I.RESEARCH_NOTES_4),1);h.choose(p,"I'd love a cup of tea.");h.continueUntil(p,()=>!p.manager.getCurrent());assert.ok(p.messages.includes('Aubury hands you a cup of tea.'));
  h.talk(p,5034);h.continueUntil(p,()=>h.quest.isComplete(p));assert.equal(p.items.get(I.RESEARCH_NOTES_4),0);assert.equal(p.items.get(I.AIR_TALISMAN),1);
  assert.ok(p.prompt?.options?.includes("Can you teleport me to the Rune Essence Mine?"), "completion keeps Sedridor's follow-up menu");
  assert.ok(p.prompt?.options?.includes("I'd better get going."));
});

test('Juliet potion and Romeo crypt round trip renders each speaker and completes after returning', () => {
  const h=harness('RomeoAndJuliet'),p=player();h.quest.setStage(p,50);p.items.set(I.CADAVA_POTION,1);p.moveTo(new core.Location(3158,3426,1));
  h.talk(p,N.JULIET);h.continueUntil(p,()=>p.blocked===true);h.tick(3);h.continueUntil(p,()=>h.quest.getStage(p)===60);h.tick(3);
  assert.equal(p.items.get(I.CADAVA_POTION),0);assert.equal(p.getArea(),null);assert.ok(p.log.some(row=>row[0]==='text'&&String(row[2]).includes('quite the actress')));
  h.talk(p,N.ROMEO);h.continueUntil(p,()=>p.blocked===true);h.tick(3);h.continueUntil(p,()=>!p.manager.getCurrent());h.tick(5);assert.equal(h.quest.getStage(p),100);assert.equal(p.attrs.get('quest.points'),5);
});

test('the ghost amulet dialogue reaches the complete skull explanation before advancing', () => {
  const h=harness('RestlessGhost'),p=player();h.quest.setStage(p,2);p.amulet=I.GHOSTSPEAK_AMULET;
  h.talk(p,N.RESTLESS_GHOST);continueToMenu(h,p);h.choose(p,'Wow, this amulet works!');continueToMenu(h,p);h.choose(p,"Yes, ok. Do you know why you're a ghost?");
  h.continueUntil(p,()=>h.quest.getStage(p)===3);assert.ok(p.log.some(row=>row[0]==='text'&&String(row[2]).includes('stolen my skull')));assert.equal(p.text,'It is so dull being a ghost...');
});


test('the native crypt actors route around cache collision and finish walking before the unchanged scene continues', async (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  t.mock.method(PluginManager, 'emitNpcDialogueCondition', nativeDialogueCondition);
  core.ObjectDefinition.init(); core.RegionManager.init(); core.RegionManager.loadMapFiles(3210, 3420);
  const api = PluginManager.createApi('CryptNativeRegression');
  require('../plugins/npcs/NpcDialogues.plugin').register(api);
  require('../plugins/quests/quests/RomeoAndJuliet.Quest')(api);
  const quest = runtime.getRegisteredQuests().find(entry => entry.key === 'romeo_and_juliet');
  const frames = [], views = [], actors = new Map(), arrivals = new Map(), removals = new Map();
  const channel = { kind: 'test', binaryTransport: true, isOpen: () => true,
    send: frame => { frames.push(Buffer.from(frame)); return true; }, close() {}, onData() {}, onClose() {}, onError() {} };
  const session = new PlayerSession(channel), p = new Player(session); session.setPlayer(p);
  p.setUsername('crypt-native-regression'); p.setLocation(new core.Location(3210, 3422, 0));
  assert.equal(core.World.getPlayers().add(p), true); p.setRegistered(true); p.setNeedsPlacement(false);
  p.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, 99).setCurrentLevels(core.Skill.HITPOINTS, 99);
  quest.setStage(p, 60);
  const spawnNpc = api.spawnNpc, removeNpc = api.removeNpc;
  t.mock.method(api, 'spawnNpc', function(definition) {
    const npc = spawnNpc.call(this, definition);
    if (npc && definition.owner === p) actors.set(npc.getId(), npc);
    return npc;
  });
  t.mock.method(api, 'removeNpc', function(npc) {
    if (actors.get(npc.getId()) === npc) removals.set(npc.getId(), core.World.getProcessCycle());
    return removeNpc.call(this, npc);
  });
  let continuationTick;
  api.onCustomEvent('npc-dialogue:line', event => {
    if (event.player !== p || event.text !== 'Hey...Juliet...') return;
    const before = event.before;
    event.before = () => { continuationTick = core.World.getProcessCycle(); before?.(); };
  });
  api.onCustomEvent('network:sync-views', event => {
    if (event.player === p) views.push(...event.npcs);
  });
  const romeo = api.spawnNpc({ id: N.ROMEO, x: 3210, y: 3421, z: 0, wanderRadius: 0 });
  assert.ok(romeo);
  t.mock.method(p, 'onRemove', () => {});
  t.after(() => {
    PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
    for (const npc of [romeo, ...actors.values()]) if (npc.isRegistered()) api.removeNpc(npc);
    core.World.getPlayers().remove(p);
    assert.equal(p.isRegistered(), false);
    assert.equal(core.World.getPlayers().contains(p), false);
  });
  const connection = new ClientConnection(channel); connection.player = p;
  session.setTurnPacketProcessor(() => connection.processTurnPackets());
  const tick = async () => {
    core.World.process(); session.flushPackets();
    for (const [id, npc] of actors) {
      const area = npc.getPrivateArea();
      if (!area || !npc.isRegistered()) continue;
      const goal = area.sourceTile(id === N.ROMEO ? 2323 : 2325, id === N.ROMEO ? 4643 : 4644);
      if (npc.getLocation().equals(goal) && !arrivals.has(id)) arrivals.set(id, core.World.getProcessCycle());
    }
    await Promise.resolve();
  };
  for (let step = 0; step < 4; step++) await tick();
  connection.inject([{ type: 'npc_option', index: romeo.getIndex(), clickType: 1 }]); await connection.idle();
  for (let step = 0; step < 220 && quest.getStage(p) !== 100; step++) {
    const current = p.getDialogueManager().getCurrent();
    if (current && !current.isSelfAdvancing?.()) {
      const group = current instanceof core.PlayerDialogue ? 217 : current instanceof core.StatementDialogue ? 229 : 231;
      connection.inject([{ type: 'dialogue_continue', widgetId: (group << 16) | 5, childIndex: -1 }]);
      await connection.idle();
    }
    await tick();
  }
  assert.equal(quest.getStage(p), 100, 'native dialogue, timed cameras and return still complete the quest');
  for (const id of [N.ROMEO, N.PHILLIPA]) {
    assert.ok(arrivals.has(id), `${id} reaches its unchanged scripted destination`);
    assert.ok(arrivals.get(id) < removals.get(id), `${id} arrives before scene cleanup`);
    const npc = actors.get(id);
    assert.ok(views.filter(view => view.index === npc.getIndex() && view.walkDirection >= 0).length > 2,
      `${id} publishes the full walk through native NPC sync`);
  }
  assert.ok(arrivals.get(N.ROMEO) < continuationTick, 'Romeo arrives before the existing timed continuation');
  assert.equal(p.getPrivateArea(), null);
  assert.ok(p.getLocation().equals(new core.Location(3210, 3422, 0)));
  assert.ok(frames.length > 0, 'the native PlayerSession flushed binary packets');
});
