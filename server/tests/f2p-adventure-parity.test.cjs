// From server/: node --test tests/f2p-adventure-parity.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
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
  const hooks = {}, events = {}, tasks = [], npcs = [], removed = [], objects = [], ground = [], clicks = new Map();
  const objectManager = {register: object => objects.push(object), deregister: object => { const i=objects.indexOf(object); if(i>=0)objects.splice(i,1); }};
  const api = new Proxy({ core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  }, ObjectManager: { register: noop, deregister: noop } },
    getObjectManager: () => objectManager,
    getItemOnGroundManager: () => ({ registerLocation: (...args) => ground.push(args) }),
    onObjectFirstClick: (ids, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z), area = null;
      const npc = { ...definition, animations: [], graphics: [], getId: () => definition.id, getIndex: () => npc.index,
        index: nextIndex++, setForceMovement: movement => {p.forceMovement=movement;}, getLocation: () => location, moveTo: to => { location = to; },
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
  const h = { api, hooks, events, tasks, npcs, removed, objects, ground, clicks, quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    line(p, npcId, text) { const event = { player: p, npcId, text }; h.emit('npc-dialogue:line', event); return event; },
    action(p, npcId, stepId) { const event = { player: p, npcId, stepId }; h.emit('npc-dialogue:action', event); return event; },
    talk(p, npcId) { const choice = hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId })).find(Boolean); assert.ok(choice); runtime.startTranscript(api, p, npcId, choice.page, choice.variant); },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
    choose(p, text) { const prompt = p.prompt; assert.ok(prompt, `no menu for ${text}`); const index = prompt.options.findIndex(label => label === text); assert.ok(index >= 0, `missing ${text} in ${prompt.options}`); p.prompt = null; prompt.pairs[index * 2 + 1](); },
    continueUntil(p, predicate, limit = 80) { while (!predicate()) { assert.ok(limit-- > 0, `dialogue stalled at ${p.text}`); assert.ok(p.manager.getCurrent(), `dialogue ended at ${p.text}`); p.manager.advance(); } },
  }; return h;
}
function player() {
  const attrs = new Map(), items = new Map(), configs = new Map(), varbits = new Map(), log = [], xp = [];
  let location = new core.Location(3210, 3220, 0), area = null;
  const inv = { getAmount: id => items.get(id) ?? 0, isFull: () => Boolean(p.full), getFreeSlots: () => p.full ? 0 : 28, contains: id => (items.get(id)??0)>0,
    adds(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); },
    getAddableAmount(item) { return item.getAmount(); },
    add(item) { this.adds(item.getId(), item.getAmount()); },
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
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(),amount]), getCombatLevel: () => p.combat ?? 3, getCurrentLevel: () => p.magic ?? 99 }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement(value) { p.blocked = value; return this; } }),
    setUntargetable: value => { p.untargetable = value; }, setForceMovement: movement => {p.forceMovement=movement;}, getForceMovement: () => p.forceMovement ?? null, getLocation: () => location, moveTo: to => { location = to; },
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; }, getIndex: () => p.index,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getCombat: () => ({getHitQueue:()=>({addPendingDamage: damage=>{p.damage=damage;}})}),
    getUsername: () => 'Parity', getDisplayName: () => 'Parity', getAppearance: () => ({ isMale: () => true }), setPositionToFace: noop, forceChat: noop,
    performAnimation: a => p.animations.push(a.getId()), sendMessage: text => p.messages.push(text),
  }; p.manager = new DialogueManager(p); return p;
}
const continueToMenu = (h,p) => h.continueUntil(p, () => Boolean(p.prompt));

test('Ernest takes the parts, transforms privately over nine ticks, then rewards after the final reply', () => {
  const h=harness('ErnestTheChicken'),p=player();p.moveTo(new core.Location(3110,3366,2));h.quest.setStage(p,2);
  for(const id of [I.PRESSURE_GAUGE,I.RUBBER_TUBE,I.OIL_CAN])p.items.set(id,1);
  h.talk(p,N.PROFESSOR_ODDENSTEIN);
  h.continueUntil(p,()=>p.text==="Let's get this fixed then.");
  assert.equal(p.varbits.get(19655),1);for(const id of [I.PRESSURE_GAUGE,I.RUBBER_TUBE,I.OIL_CAN])assert.equal(p.items.get(id),0);
  p.manager.advance();assert.equal(h.quest.getStage(p),2);assert.equal(p.blocked,true);assert.ok(p.getArea());
  h.tick(8);assert.equal(p.attrs.get('ernest-the-chicken:transformed'),undefined);assert.equal(p.items.get(I.COINS),undefined);
  h.tick(1);assert.equal(p.attrs.get('ernest-the-chicken:transformed'),1);assert.equal(p.configs.get(32),3);assert.match(p.text,/Thank you, sir/);
  assert.equal(h.quest.getStage(p),2);assert.equal(p.items.get(I.COINS),undefined);
  h.continueUntil(p,()=>h.quest.isComplete(p));assert.equal(p.items.get(I.COINS),300);assert.equal(p.attrs.get('quest.points'),4);assert.equal(p.getArea(),null);
  assert.deepEqual(h.npcs.map(npc=>npc.id),[N.PROFESSOR_ODDENSTEIN,10556,N.ERNEST]);
  assert.equal(p.log.filter(row => /sendCamera(MoveTo|LookAt)/.test(row[0])).length, 0, 'Ernest has no directed cameras in the captured route');
});

test('Ernest compost and poisoned fountain wait for the captured results; relog cancels pending messages', () => {
  const h=harness('ErnestTheChicken'),p=player();p.items.set(I.SPADE,1);
  const interact=event=>(h.hooks.onObjectInteraction??[]).forEach(fn=>fn({...event, clickType:1, definition:{getInteractions:()=>[event.option]}}));
  interact({player:p,objectId:core.ObjectIdentifiers.COMPOST_HEAP,option:'Search',location:{x:3087,y:3378,z:0}});
  assert.equal(p.items.get(I.KEY),undefined);h.tick(2);assert.equal(p.items.get(I.KEY),undefined);h.tick(1);assert.equal(p.items.get(I.KEY),1);
  p.items.set(I.POISONED_FISH_FOOD,1);
  h.hooks.onItemOnObject[0]({player:p,itemId:I.POISONED_FISH_FOOD,objectId:core.ObjectIdentifiers.FOUNTAIN});
  assert.equal(p.items.get(I.POISONED_FISH_FOOD),0);h.tick(4);assert.ok(!p.messages.some(t=>t.includes('float to')));h.tick(1);assert.match(p.messages.at(-1),/float to/);
  interact({player:p,objectId:core.ObjectIdentifiers.FOUNTAIN,option:'Search'});h.tick(1);assert.match(p.text,/pressure gauge/);p.manager.advance();assert.equal(p.items.get(I.PRESSURE_GAUGE),1);
  p.items.set(I.FISH_FOOD,1);h.hooks.onItemOnObject[0]({player:p,itemId:I.FISH_FOOD,objectId:core.ObjectIdentifiers.FOUNTAIN});
  h.hooks.onPlayerLogout[0]({player:p});const count=p.messages.length;h.tick(5);assert.equal(p.messages.length,count);
});

test('Dragon Slayer dialogue selection is read-only; challenge and purchase advance on the recorded NPC lines', () => {
  const h=harness('DragonSlayer'),p=player();h.quest.setStage(p,1);
  h.hooks.onNpcDialogueVariant[0]({player:p,npcId:N.OZIACH});assert.equal(h.quest.getStage(p),1);
  h.line(p,N.OZIACH,'Slay the dragon of Crandor!').before();assert.equal(h.quest.getStage(p),2);assert.equal(p.varbits.get(3742),1);
  p.items.set(I.COINS,2000);const offer=h.line(p,N.KLARENSE,"Okey-dokey! She's all yours!");assert.equal(p.items.get(I.COINS),2000);offer.before();assert.equal(p.items.get(I.COINS),0);assert.equal(h.quest.getStage(p),3);
  h.action(p,N.OZIACH,'0KEI_n');assert.equal(h.quest.getStage(p),3,'completion cannot bypass killing Elvarg');
});

test('Dragon Slayer deposits Oracle offerings individually and repairs ship only with a hammer and two-tick delay', () => {
  const h=harness('DragonSlayer'),p=player();h.quest.setStage(p,3);p.attrs.set('dragon-slayer.oracle',2);
  const object={getLocation:()=>new core.Location(3050,9839,0)};
  const put=id=>h.hooks.onItemOnObject[0]({player:p,itemId:id,objectId:core.ObjectIdentifiers.MAGIC_DOOR_6,object});
  const offerings=[I.SILK,I.UNFIRED_BOWL,I.LOBSTER_POT,I.WIZARDS_MIND_BOMB];
  for(const id of offerings)p.items.set(id,1);put(offerings[0]);assert.equal(p.items.get(offerings[0]),0);assert.equal(p.items.get(offerings[1]),1);
  for(const id of offerings.slice(1))put(id);assert.equal(p.attrs.get('dragon-slayer:offerings'),15);h.tick(1);assert.equal(p.attrs.get('dragon-slayer.oracle'),3);
  p.items.set(I.PLANK,3);p.items.set(I.STEEL_NAILS,90);
  h.clicks.get(25036)({player:p});assert.equal(p.items.get(I.PLANK),3);p.items.set(I.HAMMER,1);
  for(const stage of [4,5,7]) {h.clicks.get(25036)({player:p});h.tick(1);assert.notEqual(h.quest.getStage(p),stage);h.tick(1);assert.equal(h.quest.getStage(p),stage);}
  assert.equal(p.configs.get(176),6);assert.deepEqual([1835,1836,1837].map(id=>p.varbits.get(id)),[1,1,1]);
});

test('Dragon Slayer sails through the private fire and crash sequence, then collects the head before returning to Oziach', () => {
  const h=harness('DragonSlayer'),p=player();h.quest.setStage(p,8);p.moveTo(new core.Location(3048,3207,1));
  h.action(p,N.CAPTAIN_NED,'1nn6tK');h.tick(20);assert.ok(p.getArea() instanceof core.TemplatedInstanceArea);assert.match(p.text,/salt spray/);
  h.continueUntil(p,()=>p.text==='Clouds surround the ship.');
  assert.ok(p.log.some(entry=>entry[0]==='sendSubInterface'&&entry[2]===543));
  const stormShotCount = p.log.filter(row => /sendCamera(MoveTo|LookAt)/.test(row[0])).length;
  h.tick(4); assert.equal(p.text, 'Clouds surround the ship.');
  assert.equal(p.log.filter(row => /sendCamera(MoveTo|LookAt)/.test(row[0])).length, stormShotCount);
  h.tick(1); assert.match(p.text, /Looks like there's a storm/);
  assert.equal(p.log.filter(row => /sendCamera(MoveTo|LookAt)/.test(row[0])).length, stormShotCount + 3);
  p.manager.advance(); assert.equal(p.text, 'Oh, well. The weather had been so good up until now.');
  p.manager.advance();assert.ok(p.log.some(entry=>entry[0]==='sendSubInterface'&&entry[2]===545));h.tick(1);assert.equal(p.text,'Did you see that?');
  p.manager.advance();p.manager.advance();p.manager.advance();h.tick(4);assert.equal(p.text,"It's the dragon!");
  p.manager.advance();assert.ok(p.log.some(entry=>entry[0]==='sendSubInterface'&&entry[2]===546));h.tick(9);assert.equal(p.text,"We're going to sink!");p.manager.advance();p.manager.advance();p.manager.advance();h.tick(4);assert.equal(h.quest.getStage(p),9);assert.equal(p.configs.get(176),8);h.tick(5);assert.equal(p.blocked,false);
  assert.deepEqual([p.getLocation().getX(),p.getLocation().getY()],[2852,3238]);assert.equal(p.getArea(),null);
  const npc={getLocation:()=>new core.Location(2853,9637,0)};h.hooks.onNpcDeath[0]({killer:p,npcId:8033,npc});
  h.tick(1);assert.equal(p.configs.get(176),9);assert.equal(p.items.get(I.ELVARGS_HEAD),undefined);assert.equal(h.quest.isComplete(p),false);
  h.tick(10);assert.equal(p.items.get(I.ELVARGS_HEAD),1);assert.ok(p.animations.includes(6654));assert.ok(p.animations.includes(6655));h.tick(3);
  // seq 6655 is 10.0 ticks in the cache (sum of its frame delays, 300 client ticks), so the player stays held to its end: free at tick 21, not 14 (cache length, ours)
  assert.equal(p.blocked,true,'still in the head-cut animation 3 ticks after it started');h.tick(6);assert.equal(p.blocked,true);h.tick(1);assert.equal(p.blocked,false);
  h.talk(p,N.OZIACH);h.continueUntil(p,()=>h.quest.isComplete(p));assert.equal(p.items.get(I.ELVARGS_HEAD),0);assert.equal(p.attrs.get('quest.points'),2);assert.deepEqual(p.xp,[[core.Skill.STRENGTH.getIndex(),18650],[core.Skill.DEFENCE.getIndex(),18650]]);
});


test('Dragon Slayer completion removes carried and every bank-tab head, but preserves optional-head completion and rewards', () => {
  for (const withHead of [true, false]) {
    const h=harness('DragonSlayer'),p=player();
    h.quest.setStage(p,9);p.attrs.set('dragon-slayer:elvarg-killed',1);
    if (withHead) p.items.set(I.ELVARGS_HEAD,2);
    p.items.set(I.COINS,123);
    const tabs=Array.from({length:core.Bank.TOTAL_BANK_TABS},()=>new Map([[I.ELVARGS_HEAD,withHead?2:0],[I.COINS,456]]));
    p.getBanks=()=>tabs.map(items=>({
      getAmount:id=>items.get(id)??0,
      deleteNumber(id,amount){assert.ok(amount>0);items.set(id,(items.get(id)??0)-amount);},
    }));
    h.talk(p,N.OZIACH);h.continueUntil(p,()=>h.quest.isComplete(p));
    assert.equal(p.items.get(I.ELVARGS_HEAD)??0,0);
    assert.ok(tabs.every(items=>items.get(I.ELVARGS_HEAD)===0));
    assert.equal(p.items.get(I.COINS),123);
    assert.ok(tabs.every(items=>items.get(I.COINS)===456));
    assert.equal(p.attrs.get('quest.points'),2);
    assert.deepEqual(p.xp,[[core.Skill.STRENGTH.getIndex(),18650],[core.Skill.DEFENCE.getIndex(),18650]]);
    h.action(p,N.OZIACH,'0KEI_n');
    assert.equal(h.quest.complete(p),false);
    assert.equal(p.attrs.get('quest.points'),2);assert.equal(p.xp.length,2);
  }
});

test('Ernest lever changes reproduce every recorded door bitset, including repeated toggles', () => {
  const h=harness('ErnestTheChicken'),p=player();
  const recorded=[[2,0],[0,0],[1,4],[0,0],[1,4],[3,132],[7,0],[3,132],[11,396],[3,132],[11,396],[9,332],[11,396],[9,332],[8,328],[40,290],[8,328],[24,64],[56,3],[40,290],[56,3],[60,19],[44,306]];
  let previous=0;
  for(const [bits,doors]of recorded){
    const changed=previous^bits,lever=Math.log2(changed);
    assert.ok(Number.isInteger(lever));
    h.hooks.onObjectInteraction[0]({player:p,objectId:146+lever});
    assert.equal(p.configs.get(33),bits<<1);assert.equal(p.configs.get(668),doors,`lever bits${bits}`);previous=bits;
  }
});

test('canonical Blurite mining checks level/pickaxe, rolls at pickaxe intervals, grants17.5XP and respawns after42ticks', () => {
  const Mining=require('../plugins/skills/Mining.plugin');
  const {MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
  const {ItemIds}=require('../dist/util/IdEnums');
  const oldGet=MapObjects.get,oldRandom=Math.random,tasks=[],interactions=new Map(),registered=[],removed=[];
  const position=new core.Location(3050,9570,0),object=new core.GameObject(core.ObjectIdentifiers.BLURITE_ROCKS,position,10,0,null);
  let present=object,level=9;const p=player();p.moveTo(new core.Location(3050,9571,0));p.getHitpoints=()=>10;
  p.getEquipment=()=>({getItems:()=>[]});p.getInventory().getItems=()=>[];p.getInventory().full=()=>{};
  const xp=[];p.getSkillManager=()=>({getCurrentLevel:()=>level,addExperiences:(skill,amount)=>xp.push([skill,amount])});
  p.getMovementQueue=()=>({size:()=>0});p.getForceMovement=()=>null;
  const api=new Proxy({core,
    getTaskManager:()=>({submit(task){task.setRunning(true);tasks.push(task);}}),
    getObjectManager:()=>({register(value){registered.push(value);present=value;},deregister(value){removed.push(value);present=null;}}),
    onObjectInteraction:(name,actions)=>interactions.set(name,actions),emitCustomEvent(){},
  },{get:(target,key)=>target[key]??noop});
  try{
    MapObjects.get=(id)=>present?.getId()===id?present:null;Math.random=()=>0.99;Mining.register(api);
    const mine=()=>interactions.get('Blurite rocks').Mine({player:p,object,definition:{getName:()=> 'Blurite rocks'}});
    p.items.set(ItemIds.BRONZE_PICKAXE,1);mine();assert.ok(p.log.some(row=>row[0]==='text'&&/Mining level of 10 to mine this rock/.test(row[2])));assert.equal(Mining.isMiningActive(p),false);
    level=10;mine();const ticks=n=>{while(n-->0)[...tasks].forEach(task=>task.tick());};
    // Bronze rolls the tick after the swing (+2), then every 8 ticks (+10): the +2 roll fails at 0.99.
    ticks(8);assert.equal(p.items.get(I.BLURITE_ORE),undefined,'failed probability roll is not guaranteed ore');
    Math.random=()=>0;ticks(1);assert.equal(p.items.get(I.BLURITE_ORE),undefined,'no roll between pickaxe intervals');ticks(1);
    assert.equal(p.items.get(I.BLURITE_ORE),1);assert.deepEqual(xp,[[core.Skill.MINING,17.5]]);assert.equal(present.getId(),core.CacheDefinitions.getLocId('rocks1'));
    ticks(41);assert.notEqual(present,object);ticks(1);assert.equal(present,object);
  }finally{MapObjects.get=oldGet;Math.random=oldRandom;}
});


test('Dragon Slayer start warns and changes stage when Guildmaster actually sets the task', () => {
  const h=harness('DragonSlayer'),p=player();p.attrs.set('quest.points',32);
  h.talk(p,N.GUILDMASTER);continueToMenu(h,p);h.choose(p,'Can I have a quest?');h.continueUntil(p,()=>p.text.startsWith('Before starting'));
  assert.match(p.text,/recommended level of 45/);assert.ok(!p.text.includes('skill levels'));p.manager.advance();assert.equal(p.prompt.title,'Start the Dragon Slayer I quest?');
  h.choose(p,'Yes.');assert.equal(h.quest.getStage(p),0);p.manager.advance();assert.equal(h.quest.getStage(p),1);assert.match(p.text,/speak to Oziach/);
});


test('Dragon Slayer logout releases an interrupted wall crossing without a stale exact move', () => {
  const h=harness('DragonSlayer'),p=player();h.quest.setStage(p,9);p.moveTo(new core.Location(2845,9636));
  h.clicks.get(core.ObjectIdentifiers.WALL_161)({player:p});assert.ok(p.forceMovement);assert.equal(p.blocked,true);
  h.hooks.onPlayerLogout[0]({player:p});assert.equal(p.forceMovement,null);assert.equal(p.blocked,false);h.tick(5);assert.equal(p.getLocation().getX(),2845);
});


test('Dragon Slayer interrupted repairs retain supplies and an interrupted head scene retains the kill', () => {
  const h=harness('DragonSlayer'),p=player();h.quest.setStage(p,3);
  for(const [id,n]of [[I.PLANK,1],[I.STEEL_NAILS,30],[I.HAMMER,1]])p.items.set(id,n);
  h.clicks.get(25036)({player:p});assert.equal(p.items.get(I.PLANK),1);h.hooks.onPlayerLogout[0]({player:p});h.tick(3);
  assert.equal(p.items.get(I.PLANK),1);assert.equal(p.items.get(I.STEEL_NAILS),30);assert.equal(h.quest.getStage(p),3);
  h.quest.setStage(p,9);h.hooks.onNpcDeath[0]({killer:p,npcId:8033,npc:{getLocation:()=>new core.Location(2853,9637)}});
  h.hooks.onPlayerLogout[0]({player:p});h.tick(12);assert.equal(h.quest.varpValue(9,p),9);assert.equal(h.quest.isComplete(p),false);
});


test('legacy completed Dragon Slayer saves finish Oziach congratulations without receiving another reward', () => {
  const h=harness('DragonSlayer'),p=player();h.quest.setStage(p,10);
  assert.match(h.hooks.onNpcDialogueVariant[0]({player:p,npcId:N.OZIACH}).variant,/after-slaying-elvarg/);
  h.action(p,N.OZIACH,'0KEI_n');assert.equal(p.attrs.get('dragon-slayer.oziach-congrats'),true);assert.equal(p.xp.length,0);
  assert.equal(h.hooks.onNpcDialogueVariant[0]({player:p,npcId:N.OZIACH}).page,'Oziach');
});


test('Wormbrain cannot take10000coins when a full backpack cannot receive the map', () => {
  const h=harness('DragonSlayer'),p=player();h.quest.setStage(p,2);p.full=true;p.items.set(I.COINS,10001);
  const action=h.action(p,N.WORMBRAIN,'I8YYjs');assert.equal(p.items.get(I.COINS),10001);assert.equal(p.items.get(I.MAP_PART_2),undefined);assert.equal(action.end,true);
  p.full=false;h.action(p,N.WORMBRAIN,'I8YYjs');assert.equal(p.items.get(I.COINS),1);assert.equal(p.items.get(I.MAP_PART_2),1);
});


test('Dragon Slayer replays captured camera commands in order, with dialogue-triggered pans and timed fire shots', () => {
  const h = harness('DragonSlayer'), p = player();
  h.quest.setStage(p, 8); p.moveTo(new core.Location(3048, 3207, 1));
  h.action(p, N.CAPTAIN_NED, '1nn6tK'); h.tick(19);
  assert.equal(p.log.filter(row => /sendCamera(MoveTo|LookAt)/.test(row[0])).length, 0);
  h.tick(1);
  const area = p.getArea(), origin = area.sourceTile(2056, 5504);
  const directed = () => p.log.filter(row => /sendCamera(MoveTo|LookAt)/.test(row[0])).map(([kind, x, y, height, options]) =>
    [kind, x - origin.getX() + 2056, y - origin.getY() + 5504, height, options]);
  const shot = (kind, x, y, height, rate) => [kind, x, y, height, { rate, rate2: rate, heightRelative: false }];
  assert.deepEqual(directed(), [shot('sendCameraLookAt', 2069, 5517, 25, 232), shot('sendCameraMoveTo', 2077, 5518, 100, 232), shot('sendCameraMoveTo', 2074, 5516, 100, 1)]);
  assert.deepEqual(p.log.filter(row => row[0] === 'sendCameraShake').slice(0, 5), [0, 1, 2, 3, 4].map(axis => ['sendCameraShake', axis, 0]));
  const line = text => { p.log.length = 0; h.line(p, N.CAPTAIN_NED, text).before(); return directed(); };
  assert.deepEqual(line('And this is a mighty fine ship.'), [shot('sendCameraMoveTo', 2073, 5516, 100, 1), shot('sendCameraLookAt', 2066, 5517, 25, 1)]);
  h.tick(30); assert.equal(directed().length, 2, 'waiting on a reply must not advance the next shot');
  assert.deepEqual(line('How much longer until we reach Crandor?'), [shot('sendCameraMoveTo', 2069, 5513, 300, 1), shot('sendCameraLookAt', 2066, 5517, 100, 1)]);
  assert.deepEqual(line("Looks like there's a storm coming up, cap'n."), [shot('sendCameraLookAt', 2064, 5520, 300, 232), shot('sendCameraMoveTo', 2074, 5525, 1500, 232), shot('sendCameraMoveTo', 2064, 5525, 1500, 1)]);
  p.log.length = 0; h.action(p, N.CAPTAIN_NED, '1XD38w');
  assert.deepEqual(directed(), [shot('sendCameraMoveTo', 2072, 5517, 300, 232), shot('sendCameraLookAt', 2062, 5515, 100, 232), shot('sendCameraMoveTo', 2072, 5520, 300, 1)]);
  h.tick(4); p.log.length = 0; h.action(p, N.CAPTAIN_NED, '07qPBA'); h.tick(2); assert.equal(directed().length, 0);
  h.tick(1); assert.deepEqual(directed(), [shot('sendCameraMoveTo', 2068, 5518, 300, 232), shot('sendCameraLookAt', 2062, 5518, 100, 232), shot('sendCameraMoveTo', 2074, 5526, 300, 1)]);
  h.tick(6); assert.deepEqual(directed().slice(3), [shot('sendCameraMoveTo', 2074, 5526, 600, 232), shot('sendCameraLookAt', 2066, 5517, 100, 232), shot('sendCameraMoveTo', 2064, 5518, 400, 1)]);
  assert.deepEqual(line("We're going to crash!"), [shot('sendCameraMoveTo', 2064, 5518, 400, 2)]);
  p.log.length = 0; h.action(p, N.CAPTAIN_NED, '9r5-VW'); h.tick(2); assert.ok(!p.log.some(row => row[0] === 'sendCameraReset'));
  h.tick(1); assert.equal(p.log.filter(row => row[0] === 'sendCameraReset').length, 1);
  h.tick(1); assert.deepEqual(p.log.filter(row => /sendCamera(MoveTo|LookAt)/.test(row[0])), [shot('sendCameraMoveTo', 2854, 3241, 300, 232), shot('sendCameraLookAt', 2849, 3238, 200, 232)]);
  h.tick(5); assert.deepEqual(p.log.filter(row => row[0] === 'sendCameraUnlock'), [['sendCameraUnlock', false]]);
});

test('Elvarg introduction uses both recorded shots and releases the camera only at tick twenty', () => {
  const h = harness('DragonSlayer'), p = player(); h.quest.setStage(p, 9);
  h.clicks.get(core.ObjectIdentifiers.HOLE_40)({ player: p });
  h.tick(3); assert.equal(p.log.filter(row => /sendCamera(MoveTo|LookAt)/.test(row[0])).length, 0);
  h.tick(1); const area = p.getArea(), origin = area.sourceTile(2816, 9600);
  const directed = () => p.log.filter(row => /sendCamera(MoveTo|LookAt)/.test(row[0])).map(([kind, x, y, height, options]) =>
    [kind, x - origin.getX() + 2816, y - origin.getY() + 9600, height, options]);
  assert.deepEqual(directed(), [
    ['sendCameraLookAt', 2856, 9650, 150, { rate: 232, rate2: 232, heightRelative: false }],
    ['sendCameraMoveTo', 2848, 9639, 475, { rate: 232, rate2: 232, heightRelative: false }],
  ]);
  h.tick(3); assert.deepEqual(directed().slice(2), [
    ['sendCameraLookAt', 2866, 9640, 150, { rate: 2, rate2: 2, heightRelative: false }],
    ['sendCameraMoveTo', 2848, 9639, 250, { rate: 2, rate2: 2, heightRelative: false }],
  ]);
  h.tick(8); assert.ok(p.getArea(), 'private scene remains active through tick fifteen');
  h.tick(1); assert.equal(p.getArea(), null, 'return teleport stays at captured tick sixteen');
  assert.deepEqual(p.log.filter(row => row[0] === 'sendCameraTranslate'), [['sendCameraTranslate', 2816 - origin.getX(), 9600 - origin.getY()]]);
  assert.equal(p.blocked, true);
  const returnedAt = p.getLocation();
  h.clicks.get(core.ObjectIdentifiers.HOLE_40)({ player: p });
  h.clicks.get(core.ObjectIdentifiers.CLIMBING_ROPE_13)({ player: p });
  h.clicks.get(core.ObjectIdentifiers.WALL_161)({ player: p });
  assert.equal(p.getLocation(), returnedAt, 'repeat entrance/rope/wall clicks cannot replace the deferred release');
  assert.equal(p.forceMovement, undefined);
  assert.equal(p.attrs.get('dragon-slayer.shortcut'), undefined);
  h.tick(3); assert.ok(!p.log.some(row => row[0] === 'sendCameraReset'));
  h.tick(1); assert.deepEqual(p.log.filter(row => /sendCamera(Unlock|Reset)/.test(row[0])), [['sendCameraUnlock', false], ['sendCameraReset']]);
  assert.equal(p.getArea(), null); assert.equal(p.blocked, false);
});


test('interrupting Elvarg introduction after the return cancels its delayed shot release and clears the camera', () => {
  const h = harness('DragonSlayer'), p = player(); h.quest.setStage(p, 9);
  h.clicks.get(core.ObjectIdentifiers.HOLE_40)({ player: p }); h.tick(16);
  assert.equal(p.getArea(), null); assert.equal(p.blocked, true);
  h.hooks.onPlayerLogout[0]({ player: p }); assert.equal(p.blocked, false);
  const resetCount = p.log.filter(row => row[0] === 'sendCameraReset').length;
  assert.equal(resetCount, 1); assert.deepEqual(p.log.filter(row => row[0] === 'sendCameraUnlock'), [['sendCameraUnlock', false]]);
  h.tick(5); assert.equal(p.log.filter(row => row[0] === 'sendCameraReset').length, resetCount);
});

// Regression: use the production Player's lazy bank array and container methods.
const { Player: ProductionPlayer } = require('../dist/game/entity/impl/player/Player');
for (const scenario of ['carried-head-lazy-tabs', 'no-head-lazy-tabs', 'banked-head-null-search-tab']) {
  test(`Dragon Slayer ${scenario}: normal Oziach completion grants both XP rewards`, () => {
    const h = harness('DragonSlayer'), p = player();
    const productionPlayer = new ProductionPlayer(null);
    p.banks = productionPlayer.getBanks();
    p.getBanks = ProductionPlayer.prototype.getBanks.bind(p);
    p.getBank = ProductionPlayer.prototype.getBank.bind(p);
    p.setBank = ProductionPlayer.prototype.setBank.bind(p);
    p.isSearchingBank = () => false;
    p.getCurrentBankTab = () => 0;
    p.getInterfaceId = () => -1;
    const inventory = new core.Inventory(p);
    p.getInventory = () => inventory;
    inventory.adds(I.COINS, 123);
    if (scenario === 'carried-head-lazy-tabs') inventory.adds(I.ELVARGS_HEAD, 1);
    if (scenario === 'banked-head-null-search-tab') {
      for (let tab = 0; tab < core.Bank.BANK_SEARCH_TAB_INDEX; tab++) p.getBank(tab);
      p.getBank(0).adds(I.ELVARGS_HEAD, 1);
      // A normal login never restores the ephemeral search tab.
      p.setBank(core.Bank.BANK_SEARCH_TAB_INDEX, null);
    }
    h.quest.setStage(p, 9);
    p.attrs.set('dragon-slayer:elvarg-killed', 1);
    const nullTabs = p.getBanks().flatMap((bank, tab) => bank === null ? [tab] : []);
    let failure;
    try {
      h.talk(p, N.OZIACH);
      h.continueUntil(p, () => h.quest.isComplete(p));
    } catch (error) { failure = error; }
    const receipt = {
      scenario, nullTabs,
      failure: failure ? { name: failure.name, message: failure.message, stack: failure.stack } : null,
      stage: h.quest.getStage(p), questPoints: p.attrs.get('quest.points'), xp: p.xp,
      inventoryHead: inventory.getAmount(I.ELVARGS_HEAD), coins: inventory.getAmount(I.COINS),
      repeatCompletion: h.quest.complete(p),
    };
    assert.equal(failure, undefined, 'normal completion must not throw on production lazy banks');
    assert.deepEqual(p.xp, [[core.Skill.STRENGTH.getIndex(),18650],[core.Skill.DEFENCE.getIndex(),18650]]);
    assert.equal(receipt.stage, 10);
    assert.equal(receipt.questPoints, 2);
    assert.equal(receipt.inventoryHead, 0);
    assert.equal(receipt.coins, 123);
    assert.equal(receipt.repeatCompletion, false);
  });
}

// Melzar's Maze doors and the Oracle's riddle door are walked through (ForceMovement, as Doors.plugin's pass-through gates),
// never teleported. The player stays put until the walk lands; keys and offerings are never lost to a walk that did not happen.
const doorObject = (x, y, face = 0) => ({ getFace: () => face, getLocation: () => new core.Location(x, y, 0), getId: () => 0 });
const toggleDoor = (h, p, objectId, object) => {
  const request = { player: p, objectId, object, location: { x: object.getLocation().getX(), y: object.getLocation().getY(), z: 0 },
    clickType: 1, handled: false, definition: { getInteractions: () => ['Open'] } };
  h.emit('door:toggle', request); return request;
};
const at = p => [p.getLocation().getX(), p.getLocation().getY()];

test('Melzar maze door: unlocking walks the player across and spends the key on arrival', () => {
  const h = harness('DragonSlayer'), p = player(); h.quest.setStage(p, 2);
  const door = doorObject(2931, 9640); p.items.set(I.KEY_3, 1); p.moveTo(new core.Location(2932, 9640, 0));
  assert.equal(toggleDoor(h, p, core.ObjectIdentifiers.RED_DOOR, door).handled, true);
  assert.deepEqual(at(p), [2932, 9640], 'the player is not teleported');
  assert.ok(p.forceMovement, 'a walk is under way');
  assert.equal(p.items.get(I.KEY_3), 1, 'the key is only spent when the walk lands');
  assert.equal(p.forceMovement.getReverseSpeed(), 60, 'two tiles take two ticks (30 client cycles per tile), as the gate crossing paces them');
  assert.equal(p.forceMovement.getAnimation(), 819);
  h.tick(1);
  assert.deepEqual(at(p), [2932, 9640], 'one tile per tick: halfway is not across'); assert.equal(p.items.get(I.KEY_3), 1);
  h.tick(1);
  assert.deepEqual(at(p), [2930, 9640]); assert.equal(p.forceMovement, null);
  assert.equal(p.items.get(I.KEY_3), 0); assert.match(p.messages.at(-1), /disintegrates/);
});

test('Melzar maze door: a walk cancelled by logout keeps the key and leaves the player free to retry', () => {
  const h = harness('DragonSlayer'), p = player(); h.quest.setStage(p, 2);
  const door = doorObject(2931, 9640); p.items.set(I.KEY_3, 1); p.moveTo(new core.Location(2932, 9640, 0));
  toggleDoor(h, p, core.ObjectIdentifiers.RED_DOOR, door);
  h.hooks.onPlayerLogout[0]({ player: p }); h.tick(2);
  assert.deepEqual(at(p), [2932, 9640]); assert.equal(p.forceMovement, null);
  assert.equal(p.items.get(I.KEY_3), 1, 'no key lost for a crossing that never happened');
  toggleDoor(h, p, core.ObjectIdentifiers.RED_DOOR, door); h.tick(2);
  assert.deepEqual(at(p), [2930, 9640]); assert.equal(p.items.get(I.KEY_3), 0);
});

test('Melzar maze door: clicking again mid-walk does not spend a second key', () => {
  const h = harness('DragonSlayer'), p = player(); h.quest.setStage(p, 2);
  const door = doorObject(2931, 9640); p.items.set(I.KEY_3, 2); p.moveTo(new core.Location(2932, 9640, 0));
  toggleDoor(h, p, core.ObjectIdentifiers.RED_DOOR, door); toggleDoor(h, p, core.ObjectIdentifiers.RED_DOOR, door); h.tick(3);
  assert.deepEqual(at(p), [2930, 9640]); assert.equal(p.items.get(I.KEY_3), 1);
});

test('Melzar brown exit door walks the player out instead of teleporting', () => {
  const h = harness('DragonSlayer'), p = player(); p.moveTo(new core.Location(2928, 9649, 0));
  const door = doorObject(2927, 9649), event = { player: p, object: door, objectId: core.ObjectIdentifiers.EXIT_DOOR, location: door.getLocation(), handled: false };
  h.clicks.get(core.ObjectIdentifiers.EXIT_DOOR)(event);
  assert.equal(event.handled, true); assert.deepEqual(at(p), [2928, 9649]); assert.ok(p.forceMovement);
  h.tick(1); assert.deepEqual(at(p), [2928, 9649]); h.tick(1);
  assert.deepEqual(at(p), [2926, 9649]); assert.equal(p.forceMovement, null);
});

test('Riddle door: the offerings are spent first, the door opens a tick later, and only then does the player walk through', () => {
  const O = core.ObjectIdentifiers, h = harness('DragonSlayer'), p = player(); h.quest.setStage(p, 3);
  p.attrs.set('dragon-slayer.oracle', 2); p.moveTo(new core.Location(3049, 9839, 0));
  const object = doorObject(3050, 9839), offerings = [I.SILK, I.UNFIRED_BOWL, I.LOBSTER_POT, I.WIZARDS_MIND_BOMB];
  for (const id of offerings) p.items.set(id, 1);
  for (const id of offerings) h.hooks.onItemOnObject[0]({ player: p, itemId: id, objectId: O.MAGIC_DOOR_6, object });
  for (const id of offerings) assert.equal(p.items.get(id), 0);
  assert.deepEqual(at(p), [3049, 9839]); assert.ok(!p.messages.includes('The door opens...')); assert.equal(p.forceMovement ?? null, null);
  h.tick(1);
  assert.equal(p.messages.at(-1), 'The door opens...'); assert.ok(p.log.some(row => row[0] === 'sendObjectAnimation'));
  assert.deepEqual(at(p), [3049, 9839], 'the door has opened but the player has not been moved yet'); assert.ok(p.forceMovement, 'now walking through');
  assert.equal(p.forceMovement.getReverseSpeed(), 60);
  h.tick(1); assert.deepEqual(at(p), [3049, 9839]);
  h.tick(1);
  assert.deepEqual(at(p), [3051, 9839]); assert.equal(p.forceMovement, null);
});

test('Riddle door: a walk cancelled mid-way keeps the offerings, and the opened door can be walked through again', () => {
  const O = core.ObjectIdentifiers, h = harness('DragonSlayer'), p = player(); h.quest.setStage(p, 3);
  p.attrs.set('dragon-slayer.oracle', 3); p.attrs.set('dragon-slayer:offerings', 15); p.moveTo(new core.Location(3049, 9839, 0));
  const object = doorObject(3050, 9839);
  h.clicks.get(O.MAGIC_DOOR_6)({ player: p, object, location: object.getLocation(), handled: false });
  assert.ok(p.forceMovement); assert.deepEqual(at(p), [3049, 9839]);
  h.hooks.onPlayerDisconnect[0]({ player: p }); h.tick(2);
  assert.deepEqual(at(p), [3049, 9839]); assert.equal(p.forceMovement, null); assert.equal(p.attrs.get('dragon-slayer:offerings'), 15);
  h.clicks.get(O.MAGIC_DOOR_6)({ player: p, object, location: object.getLocation(), handled: false }); h.tick(2);
  assert.deepEqual(at(p), [3051, 9839]);
});

test('Melzar maze door: dying mid-walk (death clears the force movement) keeps the key and strands nothing', () => {
  const h = harness('DragonSlayer'), p = player(); h.quest.setStage(p, 2);
  const door = doorObject(2931, 9640); p.items.set(I.KEY_3, 1); p.moveTo(new core.Location(2932, 9640, 0));
  toggleDoor(h, p, core.ObjectIdentifiers.RED_DOOR, door); h.tick(1);
  p.setForceMovement(null); h.tick(3);
  assert.deepEqual(at(p), [2932, 9640]); assert.equal(p.items.get(I.KEY_3), 1);
  toggleDoor(h, p, core.ObjectIdentifiers.RED_DOOR, door); h.tick(2);
  assert.deepEqual(at(p), [2930, 9640], 'the door can be tried again: no walk token was left behind'); assert.equal(p.items.get(I.KEY_3), 0);
});

test('A door walk does not hold the quest action token, so a ship repair clicked during it still starts', () => {
  const h = harness('DragonSlayer'), p = player(); h.quest.setStage(p, 4);
  const door = doorObject(2931, 9640); p.items.set(I.KEY_3, 1); p.moveTo(new core.Location(2932, 9640, 0));
  p.items.set(I.PLANK, 3); p.items.set(I.STEEL_NAILS, 90); p.items.set(I.HAMMER, 1);
  toggleDoor(h, p, core.ObjectIdentifiers.RED_DOOR, door); assert.ok(p.forceMovement);
  h.clicks.get(25036)({ player: p });
  assert.ok(p.animations.includes(3676), 'the repair began while the door walk was under way');
});
