// From server/: node --test tests/p2p-kourend-parity.test.cjs (after yarn build).
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
  const hooks = {}, events = {}, tasks = [], npcs = [], removed = [], objects = [], ground = [], clicks = new Map(), namedNpcs = new Map(), namedObjects = new Map();
  const objectManager = {register: object => objects.push(object), deregister: object => { const i=objects.indexOf(object); if(i>=0)objects.splice(i,1); }};
  const api = new Proxy({ core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  }, ObjectManager: { register: object => objects.push(object), deregister: object => { const at=objects.indexOf(object); if(at>=0)objects.splice(at,1); } } },
    getObjectManager: () => objectManager,
    getItemOnGroundManager: () => ({ registerLocation: (...args) => ground.push(args) }),
    onObjectClick: (ids, click, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    onNpcInteraction: (name, actions) => namedNpcs.set(name, actions),
    onNpcsInteraction: (names, actions) => names.forEach(name => namedNpcs.set(name, actions)),
    onObjectInteraction: (name, actions) => { if (typeof name === 'function') (hooks.onObjectInteraction ??= []).push(name); else namedObjects.set(name, actions); },
    onObjectFirstClick: (ids, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    persistAttribute: noop,
    registerArea: area => (hooks.registerArea ??= []).push(area),
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
        getMovementQueue: () => ({ reset() { return this; }, addSteps: to => { npc.walkingTo = to; } }),
        exactMove: (to, options) => { npc.exact = options; location = to; },
        setFollowing: target => { npc.following = target; }, setMobileInteraction: noop, setNpcTransformationId: noop,
        setPet: noop, setOwner: noop, getOwner: () => definition.owner,
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
  const h = { api, hooks, events, tasks, npcs, removed, objects, ground, clicks, namedNpcs, namedObjects, quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    line(p, npcId, text) { const event = { player: p, npcId, text }; h.emit('npc-dialogue:line', event); return event; },
    action(p, npcId, stepId) { const event = { player: p, npcId, stepId }; h.emit('npc-dialogue:action', event); return event; },
    talk(p, npcId) { const choice = (hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId })).find(Boolean); assert.ok(choice); runtime.startTranscript(api, p, npcId, typeof choice === 'string' ? h.quest.name : choice.page, typeof choice === 'string' ? choice : choice.variant); },
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
    deleteNumber(id, amount) { assert.ok((items.get(id) ?? 0) >= amount); items.set(id, items.get(id) - amount); },
  };
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; }, sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendString(text, uid) { if ([6,3,2].some(child => [217,231,229,193].some(group => uid === (group << 16 | child)))) p.text = text; log.push(['text',uid,text]); return packet; },
    sendInterface(id) { p.interfaceId=id; log.push(['sendInterface',id]); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; p.removals = (p.removals ?? 0) + 1; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = { setEnteredSyntaxAction: action => { p.syntaxAction = action; }, setEnteredAmountAction: action => { p.amountAction = action; }, attrs, items, configs, varbits, log, xp, messages: [], animations: [], prompt: null, text: '', index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), getInventory: () => inv,
    getBanks: () => [{ getAmount: id => p.bank?.get(id) ?? 0 }], getEquipment: () => ({ get: slot => { const id = slot === core.Equipment.WEAPON_SLOT ? p.weapon : slot === core.Equipment.SHIELD_SLOT ? p.shield : slot === core.Equipment.AMULET_SLOT ? p.amulet : null; return id ? { getId: () => id } : null; } }),
    getPacketSender: () => packet, getDialogueManager: () => p.manager, getUpdateFlag: () => ({ flag: noop }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(),amount]), getCombatLevel: () => p.combat ?? 3, getCurrentLevel: skill => skill === core.Skill.CONSTRUCTION ? p.level ?? 99 : p.magic ?? 99, getMaxLevel: () => p.level ?? 99 }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement(value) { p.blocked = value; return this; }, isBlockMovement: () => Boolean(p.blocked) }),
    setUntargetable: value => { p.untargetable = value; }, setForceMovement: movement => {p.forceMovement=movement;}, getLocation: () => location, moveTo: to => { location = to; },
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; }, getIndex: () => p.index,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getCombat: () => ({getHitQueue:()=>({addPendingDamage: damage=>{p.damage=damage;}})}),
    getUsername: () => 'Parity', getDisplayName: () => 'Parity', getAppearance: () => ({ isMale: () => true }), setPositionToFace: noop, forceChat: noop,
    performAnimation: a => p.animations.push(a.getId()), sendMessage: text => p.messages.push(text),
  }; p.manager = new DialogueManager(p); return p;
}
const continueToMenu = (h,p) => h.continueUntil(p, () => Boolean(p.prompt));


function object(h,p,id,x,y,option='Search') { const event={player:p,objectId:id,location:{x,y,z:0},option}; (h.hooks.onObjectInteraction??[]).forEach(fn=>fn(event)); return event; }
function close(h,p,id) { h.emit('interface:closed',{player:p,interfaceId:id}); }
function read(h,p,id) { (h.hooks.onItemAction??[]).forEach(fn=>fn({player:p,itemId:id,option:'Read'})); }
function translate(h,p,input) {
  read(h,p,I.WORD_TRANSLATIONS);
  const button={player:p,buttonId:(804<<16)|5};(h.hooks.onInterfaceActionButton??[]).forEach(fn=>fn?.(button));
  assert.ok(p.syntaxAction,'translation text input should open');p.syntaxAction.execute(input);
}

test('Garden uses native journal/tablet/translation interfaces and never auto-solves on Read',()=>{
  const h=harness('GardenOfDeath'),p=player();
  object(h,p,core.ObjectIdentifiers.TENT_19,1313,3469);h.choose(p,'Yes.');assert.equal(h.quest.getStage(p),2);assert.equal(p.items.get(I.KASONDES_JOURNAL),1);
  read(h,p,I.KASONDES_JOURNAL);assert.equal(h.quest.getStage(p),4);assert.equal(p.interfaceId,392);assert.ok(p.log.some(row=>row[0]==='text'&&row[2]==="For many years now, much"));
  object(h,p,core.ObjectIdentifiers.HOLE_64,1308,3467,'Climb-down');h.tick(1);assert.equal(h.quest.getStage(p),6);assert.deepEqual([p.getLocation().x,p.getLocation().y],[1309,9869]);
  object(h,p,core.ObjectIdentifiers.STONE_TABLE_35,1306,9885);assert.equal(h.quest.getStage(p),8);assert.equal(p.items.get(I.STONE_TABLET_6),1);
  read(h,p,I.STONE_TABLET_6);assert.equal(h.quest.getStage(p),10);assert.equal(p.interfaceId,748);assert.equal(p.items.get(I.WORD_TRANSLATIONS),undefined);
  close(h,p,748);h.continueUntil(p,()=>Boolean(p.prompt));h.choose(p,'Yes.');assert.equal(h.quest.getStage(p),12);assert.equal(p.items.get(I.WORD_TRANSLATIONS),1);
  read(h,p,I.WORD_TRANSLATIONS);assert.equal(p.interfaceId,804);assert.equal(h.quest.getStage(p),14);assert.equal(p.attrs.get('garden-of-death:translations'),undefined);
  translate(h,p,'home');assert.match(p.text,/potential/);translate(h,p,'nonsense');assert.match(p.text,/can't think/);
  for(const word of ['island','water','time','vessel']) { translate(h,p,word);assert.equal(h.quest.getStage(p),14); }
  translate(h,p,'north');assert.equal(h.quest.getStage(p),16);p.manager.advance();assert.match(p.text,/enough words/);
  assert.ok(h.objects.every(object=>object.getOwner()===p));
});

test('Garden replays all27 captured typed answers, vines, full-inventory note recovery and reward on closing warning',()=>{
  const h=harness('GardenOfDeath'),p=player();h.quest.setStage(p,14);p.items.set(I.WORD_TRANSLATIONS,1);p.items.set(I.SECATEURS,1);
  for(const word of ['island','water','time','vessel','north'])translate(h,p,word);assert.equal(h.quest.getStage(p),16);
  object(h,p,46434,1364,3637,'Climb-down');assert.equal(h.quest.getStage(p),18);h.tick(1);assert.equal(h.quest.getStage(p),20);
  object(h,p,46437,1375,10024,'Inspect');assert.equal(h.quest.getStage(p),22);assert.equal(p.items.get(I.DIRTY_NOTE_2),1);
  h.hooks.onItemOnObject[0]({player:p,objectId:46437,itemId:I.SECATEURS});h.tick(2);assert.equal(h.quest.getStage(p),22);h.tick(1);assert.equal(h.quest.getStage(p),24);assert.ok(p.animations.includes(2275));
  object(h,p,core.ObjectIdentifiers.STONE_TABLE_36,1373,10014);read(h,p,I.STONE_TABLET_7);assert.equal(h.quest.getStage(p),28);
  for(const word of ['west','poison','body','food','earth'])translate(h,p,word);assert.equal(h.quest.getStage(p),30);
  object(h,p,46435,1314,3617,'Climb-down');h.tick(1);assert.equal(h.quest.getStage(p),34);
  object(h,p,core.ObjectIdentifiers.STONE_TABLE_37,1311,10018);read(h,p,I.STONE_TABLET_8);assert.equal(h.quest.getStage(p),38);
  for(const word of ['make','yes','no','move','arrive','east','south'])translate(h,p,word);assert.equal(h.quest.getStage(p),40);
  object(h,p,46436,1450,3511,'Climb-down');h.tick(1);assert.equal(h.quest.getStage(p),44);
  object(h,p,core.ObjectIdentifiers.STONE_TABLE_38,1440,9816);read(h,p,I.STONE_TABLET_9);assert.equal(h.quest.getStage(p),48);
  for(const word of ['few','big','sun','moon','life','death','mind','home','air','fire'])translate(h,p,word);assert.equal(h.quest.getStage(p),50);
  assert.match(p.attrs.get('garden-of-death:translations'),/death/);assert.match(p.attrs.get('garden-of-death:translations'),/time/);
  p.full=true;read(h,p,I.STONE_TABLET_9);assert.equal(h.quest.getStage(p),52);close(h,p,748);assert.ok(p.messages.some(text=>text.includes("don't have enough room")));assert.equal(p.items.get(I.WARNING_NOTE),undefined);
  p.full=false;read(h,p,I.STONE_TABLET_9);close(h,p,748);h.continueUntil(p,()=>Boolean(p.prompt));h.choose(p,'Yes.');assert.equal(h.quest.getStage(p),54);
  read(h,p,I.WARNING_NOTE);assert.equal(p.interfaceId,625);assert.equal(h.quest.isComplete(p),false);close(h,p,625);assert.equal(h.quest.getStage(p),56);assert.deepEqual(p.xp,[[core.Skill.FARMING.getIndex(),10000]]);assert.equal(p.attrs.get('quest.points'),1);
  close(h,p,625);assert.equal(p.xp.length,1);assert.equal(p.log.filter(row=>/sendCamera(MoveTo|LookAt)/.test(row[0])).length,0);
});

test('Garden keeps full-inventory searches retryable and migrates old completed saves without another reward',()=>{
  const h=harness('GardenOfDeath'),p=player();h.quest.setStage(p,6);p.full=true;object(h,p,core.ObjectIdentifiers.STONE_TABLE_35,1306,9885);assert.equal(h.quest.getStage(p),6);p.full=false;object(h,p,core.ObjectIdentifiers.STONE_TABLE_35,1306,9885);assert.equal(h.quest.getStage(p),8);
  const old=player();h.quest.setStage(old,7);old.attrs.set('quest.the_garden_of_death.words',(1<<28)-1);h.hooks.onPlayerLogin[0]({player:old});assert.equal(h.quest.getStage(old),56);assert.deepEqual(old.xp,[]);
});

test('Getting Ahead stage selection is read-only; recorded judgement lines advance when reached',()=>{
  const h=harness('GettingAhead'),p=player();h.quest.setStage(p,2);h.hooks.onNpcDialogueVariant[0]({npcId:N.MARY_2,player:p});assert.equal(h.quest.getStage(p),2);
  h.talk(p,N.MARY_2);h.continueUntil(p,()=>p.text.includes('coated in flour'));assert.equal(h.quest.getStage(p),4);
  h.quest.setStage(p,14);h.hooks.onNpcDialogueVariant[0]({npcId:N.GORDON,player:p});assert.equal(h.quest.getStage(p),14);h.talk(p,N.GORDON);h.continueUntil(p,()=>p.text.includes("Until then, I can't pay"));assert.equal(h.quest.getStage(p),16);
  h.quest.setStage(p,20);p.items.set(I.CLAY_HEAD,1);h.talk(p,N.GORDON);h.continueUntil(p,()=>p.text.includes('I have bested'));assert.equal(h.quest.getStage(p),20);h.continueUntil(p,()=>p.text.includes("Quite rare because"));assert.equal(h.quest.getStage(p),22);
});

test('Getting Ahead confirms and revalidates crafting, preserves tools, shows captured models and animations',()=>{
  const h=harness('GettingAhead'),p=player();h.quest.setStage(p,18);p.items.set(I.SOFT_CLAY,1);p.items.set(I.KNIFE,1);const use=(a,b)=>h.hooks.onItemOnItem[0]({player:p,usedItemId:a,usedWithItemId:b});
  use(I.SOFT_CLAY,I.KNIFE);assert.equal(p.items.get(I.SOFT_CLAY),1);h.choose(p,'No.');assert.equal(h.quest.getStage(p),18);
  use(I.SOFT_CLAY,I.KNIFE);h.choose(p,'Yes.');assert.equal(h.quest.getStage(p),20);assert.equal(p.items.get(I.CLAY_HEAD),1);assert.equal(p.items.get(I.KNIFE),1);assert.ok(p.animations.includes(8838));assert.ok(p.log.some(row=>row[0]==='sendItemOnInterfaces'&&row[2]===25148));
  h.quest.setStage(p,22);p.items.set(I.BEAR_FUR,1);p.items.set(I.NEEDLE,1);p.items.set(I.THREAD,1);use(I.CLAY_HEAD,I.BEAR_FUR);h.choose(p,'Yes.');assert.equal(h.quest.getStage(p),24);assert.equal(p.items.get(I.THREAD),0);assert.equal(p.items.get(I.NEEDLE),1);
  h.quest.setStage(p,26);p.items.set(I.RED_DYE,1);use(I.FUR_HEAD,I.RED_DYE);p.items.set(I.RED_DYE,0);h.choose(p,'Yes.');assert.equal(h.quest.getStage(p),26);
});

test('Getting Ahead overnight flour fade advances at2 ticks and waits for Continue after4 ticks; cave beast belongs to its player',()=>{
  const h=harness('GettingAhead'),p=player();h.quest.setStage(p,4);p.items.set(I.POT_OF_FLOUR,1);h.hooks.onItemOnObject[0]({player:p,itemId:I.POT_OF_FLOUR,objectId:40427});assert.equal(h.quest.getStage(p),8);assert.equal(p.items.get(I.POT),1);
  h.continueUntil(p,()=>p.text.includes('There we go'));p.manager.advance();assert.equal(p.blocked,true);h.tick(1);assert.equal(h.quest.getStage(p),8);h.tick(1);assert.equal(h.quest.getStage(p),10);h.tick(2);assert.match(p.text,/You head off/);h.tick(3);assert.match(p.text,/You head off/);p.manager.advance();assert.match(p.text,/Looks like the beast/);assert.equal(p.blocked,false);
  h.clicks.get(core.ObjectIdentifiers.CAVE_55)({player:p,objectId:core.ObjectIdentifiers.CAVE_55,location:{x:1211,y:3646}});h.choose(p,'Yes.');h.tick(2);assert.equal(h.quest.getStage(p),12);const beast=h.npcs.find(npc=>npc.id===N.HEADLESS_BEAST_2);assert.equal(beast.owner,p);assert.equal(beast.ownerOnly,true);
  const stranger=player();h.quest.setStage(stranger,12);h.hooks.onNpcDeath[0]({npc:beast,npcId:beast.id,killer:stranger});assert.equal(h.quest.getStage(stranger),12);h.hooks.onNpcDeath[0]({npc:beast,npcId:beast.id,killer:p});assert.equal(h.quest.getStage(p),14);
});

test('Getting Ahead mounts over6 nails and rewards after24-tick private inspection with exact recorded camera rates',(t)=>{
  t.mock.method(Math,'random',()=>0.999);
  const h=harness('GettingAhead'),p=player();h.quest.setStage(p,30);p.moveTo(new core.Location(1238,3683,0));for(const [id,n]of[[I.BLOODY_HEAD,1],[I.PLANK,2],[I.IRON_NAILS,6],[I.HAMMER,1],[I.SAW,1]])p.items.set(id,n);
  h.namedObjects.get('Mounted Head Space').Build({player:p,objectId:20858});h.tick(5);assert.equal(p.items.get(I.IRON_NAILS),1);assert.equal(p.items.get(I.PLANK),2);h.tick(2);assert.equal(h.quest.getStage(p),32);assert.equal(p.items.get(I.PLANK),0);
  h.talk(p,N.GORDON);h.continueUntil(p,()=>p.text.includes("let's have a look"));p.manager.advance();h.tick(3);const scene=p.getArea();assert.ok(scene instanceof core.TemplatedInstanceArea);h.tick(1);const camera=scene.sourceTile(1238,3677),look=scene.sourceTile(1239,3683);
  assert.deepEqual(p.log.find(row=>row[0]==='sendCameraMoveTo'),['sendCameraMoveTo',camera.x,camera.y,420,{rate:232,rate2:100,heightRelative:false}]);assert.deepEqual(p.log.find(row=>row[0]==='sendCameraLookAt'),['sendCameraLookAt',look.x,look.y,40,{rate:232,rate2:100,heightRelative:false}]);
  h.tick(15);assert.equal(p.getArea(),null);assert.equal(h.quest.getStage(p),32);h.tick(4);assert.equal(h.quest.isComplete(p),false);h.tick(1);assert.equal(h.quest.getStage(p),34);assert.equal(p.items.get(I.COINS),3000);assert.equal(p.blocked,false);assert.equal(p.untargetable,false);
});

test('Getting Ahead logout cancels inspection with no premature reward or locked controls',()=>{
  const h=harness('GettingAhead'),p=player();h.quest.setStage(p,32);h.talk(p,N.GORDON);h.continueUntil(p,()=>p.text.includes("let's have a look"));p.manager.advance();h.tick(5);h.hooks.onPlayerLogout[0]({player:p});h.tick(40);assert.equal(h.quest.getStage(p),32);assert.equal(p.items.get(I.COINS),undefined);assert.equal(p.blocked,false);assert.equal(p.untargetable,false);
});

test('Getting Ahead resumes an interrupted flour night and returns logout from the instance to the farm',()=>{
  const h=harness('GettingAhead'),p=player();h.quest.setStage(p,8);h.hooks.onPlayerLogin[0]({player:p});h.tick(3);assert.equal(h.quest.getStage(p),10);h.tick(5);
  h.quest.setStage(p,32);h.talk(p,N.GORDON);h.continueUntil(p,()=>p.text.includes("let's have a look"));p.manager.advance();h.tick(5);assert.ok(p.getLocation().x>=8192);h.hooks.onPlayerLogout[0]({player:p});assert.deepEqual([p.getLocation().x,p.getLocation().y],[1249,3684]);h.tick(40);assert.equal(h.quest.getStage(p),32);
});

test('Getting Ahead defers all3000 coins with a full inventory and reclaims them exactly once',()=>{
  const h=harness('GettingAhead'),p=player();h.quest.setStage(p,32);p.full=true;h.talk(p,N.GORDON);h.continueUntil(p,()=>p.text.includes("let's have a look"));p.manager.advance();h.tick(24);assert.equal(h.quest.getStage(p),34);assert.equal(p.items.get(I.COINS),undefined);assert.equal(p.attrs.get('quest.getting_ahead.coins-pending'),1);
  p.full=false;h.action(p,N.GORDON,'eJJth4');assert.equal(p.items.get(I.COINS),3000);h.action(p,N.GORDON,'eJJth4');assert.equal(p.items.get(I.COINS),3000);assert.equal(p.varbits.get(694),1);
});

test('Garden supports contextual synonyms and the optional full-translation flag without another quest reward',()=>{
  const h=harness('GardenOfDeath'),p=player();h.quest.setStage(p,56);p.items.set(I.WORD_TRANSLATIONS,1);
  for(const word of ['little','time','soul','vessel','success','send','north','life','water','island','many','body','feed','knowledge','transfer','west','poison','land','arrive','death','create','deliver','south','east','failure','plant','dark','home','destroy','no']) { translate(h,p,word);p.manager.advance(); }
  assert.equal(p.attrs.get('garden-of-death:fully-translated'),undefined);
  translate(h,p,'forest');p.manager.advance();assert.equal(p.attrs.get('garden-of-death:fully-translated'),1);assert.equal(p.varbits.get(14675),1);assert.equal(p.xp.length,0);assert.match(p.text,/fully understand/);
});

function enterLair(h,p) {
  h.quest.setStage(p,12);p.moveTo(new core.Location(1190,10028,0));h.hooks.onPlayerLogin[0]({player:p});return h.npcs.findLast(npc=>npc.id===N.HEADLESS_BEAST_2);
}

test('Headless Beast boulder targets a fixed tile, deals12–16 after its warning, and replaces the melee hit',(t)=>{
  const rolls=[0,0.999];t.mock.method(Math,'random',()=>rolls.shift()??0);
  const h=harness('GettingAhead'),p=player(),beast=enterLair(h,p),Method=h.hooks.registerNpcCombatMethodProvider[0],method=new Method();
  method.start(beast,p);assert.deepEqual(method.hits(beast,p),[]);assert.equal(method.attackSpeed(),4);assert.ok(beast.animations.includes(8835));
  h.tick(1);assert.ok(p.log.some(row=>row[0]==='sendGraphic'&&row[1].id===317));assert.equal(p.damage,undefined);h.tick(2);assert.equal(p.damage,undefined);h.tick(1);assert.equal(p.damage[0].getDamage(),16);assert.equal(p.damage[0].getSource(),beast);p.damage=undefined;rolls.push(0,0);method.start(beast,p);h.tick(4);assert.equal(p.damage[0].getDamage(),12);
});

test('Headless Beast boulder is avoided by one tile and is cancelled when its owner leaves or the beast dies',(t)=>{
  t.mock.method(Math,'random',()=>0);
  const h=harness('GettingAhead'),p=player(),beast=enterLair(h,p),method=new h.hooks.registerNpcCombatMethodProvider[0]();
  method.start(beast,p);p.moveTo(new core.Location(1191,10028,0));h.tick(4);assert.equal(p.damage,undefined);
  method.start(beast,p);h.hooks.onPlayerLogout[0]({player:p});h.tick(4);assert.equal(p.damage,undefined);
  const other=player(),otherBeast=enterLair(h,other);method.start(otherBeast,other);h.hooks.onNpcDeath[0]({killer:other,npcId:N.HEADLESS_BEAST_2,npc:otherBeast});h.tick(4);assert.equal(other.damage,undefined);
  const lair=other.getPrivateArea();assert.ok(lair instanceof core.PrivateArea);assert.equal(lair.canAttack(p,otherBeast),false);
});

test('Getting Ahead bending consumes nails without consuming the head/planks; strongest metal and higher levels reduce failures',(t)=>{
  let random=0;t.mock.method(Math,'random',()=>random);
  const h=harness('GettingAhead'),p=player();h.quest.setStage(p,30);p.level=26;p.moveTo(new core.Location(1238,3683,0));
  for(const[id,n]of[[I.BLOODY_HEAD,1],[I.PLANK,2],[I.IRON_NAILS,6],[I.HAMMER,1],[I.SAW,1]])p.items.set(id,n);
  const build=()=>h.namedObjects.get('Mounted Head Space').Build({player:p,objectId:20858});build();h.tick(7);assert.equal(h.quest.getStage(p),30);assert.equal(p.items.get(I.IRON_NAILS),0);assert.equal(p.items.get(I.PLANK),2);assert.equal(p.items.get(I.BLOODY_HEAD),1);assert.equal(p.messages.filter(text=>text==='You bend the nail.').length,6);assert.equal(p.blocked,false);
  random=0.2;p.level=99;p.items.set(I.IRON_NAILS,6);build();h.tick(7);assert.equal(h.quest.getStage(p),32);
  const q=player();h.quest.setStage(q,30);q.level=26;q.moveTo(p.getLocation());for(const[id,n]of[[I.BLOODY_HEAD,1],[I.PLANK,2],[I.BRONZE_NAILS,10],[I.RUNE_NAILS,6],[I.HAMMER,1],[I.SAW,1]])q.items.set(id,n);
  h.namedObjects.get('Mounted Head Space').Build({player:q,objectId:20858});h.tick(7);assert.equal(h.quest.getStage(q),32);assert.equal(q.items.get(I.RUNE_NAILS),0);assert.equal(q.items.get(I.BRONZE_NAILS),10);
});

function tanningHarness(){const h=harness('GettingAhead');require('../plugins/npcs/Tanning.plugin').register(h.api);return h;}
function tanClick(h,p,child){const event={player:p,buttonId:(324<<16)|child};for(const fnof of h.hooks.onInterfaceActionButton??[])fnof?.(event);return event;}

test('Mary unlocks tanning after the postquest thanks and opens native324 through dialogue and Trade',()=>{
  const h=tanningHarness(),p=player();h.quest.setStage(p,34);h.talk(p,N.MARY_3);h.continueUntil(p,()=>Boolean(p.prompt));assert.equal(p.attrs.get('getting-ahead:tanning-unlocked'),1);assert.equal(p.varbits.get(696),1);
  h.choose(p,'Could you tan something for me?');h.continueUntil(p,()=>p.text==='Of course.');p.manager.advance();h.tick(1);assert.equal(p.interfaceId,324);assert.ok(p.log.some(row=>row[0]==='text'&&row[1]===(324<<16|116)&&row[2]==='1 coin'));
  close(h,p,324);h.namedNpcs.get('Mary').Trade({player:p,npcId:N.MARY_3});assert.equal(p.interfaceId,324);
  close(h,p,324);h.talk(p,N.MARY_3);h.continueUntil(p,()=>Boolean(p.prompt));h.choose(p,'Could you tan something for me?');h.continueUntil(p,()=>p.text==='Of course.');p.manager.advance();h.tick(1);assert.equal(p.interfaceId,324);
  const q=player();h.quest.setStage(q,32);h.namedNpcs.get('Mary').Trade({player:q,npcId:N.MARY_2});assert.notEqual(q.interfaceId,324);
});

test('Native tanning All/5/1 charges exact fees without XP, rejects noted hides, and supports full inventories',()=>{
  const h=tanningHarness(),p=player();h.api.emitCustomEvent('tanning:open',{player:p});p.items.set(I.COWHIDE,5);p.items.set(I.COINS,20);p.full=true;
  tanClick(h,p,149);assert.equal(p.items.get(I.HARD_LEATHER),1);assert.equal(p.items.get(I.COINS),17);
  h.api.emitCustomEvent('tanning:open',{player:p});tanClick(h,p,140);assert.equal(p.items.get(I.LEATHER),4);assert.equal(p.items.get(I.COWHIDE),0);assert.equal(p.items.get(I.COINS),13);assert.deepEqual(p.xp,[]);
  p.items.set(I.GREEN_DRAGONHIDE,3);p.items.set(I.COINS,45);h.api.emitCustomEvent('tanning:open',{player:p});tanClick(h,p,128);assert.equal(p.items.get(I.GREEN_DRAGON_LEATHER),2);assert.equal(p.items.get(I.GREEN_DRAGONHIDE),1);assert.equal(p.items.get(I.COINS),5);
  p.items.set(I.GREEN_DRAGONHIDE,0);p.items.set(I.GREEN_DRAGONHIDE_2,5);h.api.emitCustomEvent('tanning:open',{player:p});tanClick(h,p,128);assert.equal(p.items.get(I.GREEN_DRAGONHIDE_2),5);
});

test('Native tanning X validates its amount and becomes inert after close or moving away',()=>{
  const h=tanningHarness(),p=player();p.items.set(I.COWHIDE,10);p.items.set(I.COINS,100);h.api.emitCustomEvent('tanning:open',{player:p});tanClick(h,p,132);p.amountAction.execute(-1);p.amountAction.execute(NaN);assert.equal(p.items.get(I.COWHIDE),10);p.amountAction.execute(3);assert.equal(p.items.get(I.LEATHER),3);
  h.api.emitCustomEvent('tanning:open',{player:p});tanClick(h,p,132);close(h,p,324);p.amountAction.execute(7);assert.equal(p.items.get(I.COWHIDE),7);tanClick(h,p,124);assert.equal(p.items.get(I.COWHIDE),7);
  h.api.emitCustomEvent('tanning:open',{player:p});p.moveTo(new core.Location(3000,3000,0));tanClick(h,p,124);assert.equal(p.items.get(I.COWHIDE),7);
});


test('Ellis and the Crafting Guild tanner are free-to-play, so Tanning loads on free worlds',()=>{
  const plugin=require('../plugins/npcs/Tanning.plugin');assert.notEqual(plugin.members,true);
  const h=tanningHarness();for(const name of ['Ellis','Tanner']){const p=player();h.namedNpcs.get(name).Trade({player:p,npc:{isRegistered:()=>true},definition:{getName:()=>name}});assert.equal(p.interfaceId,324);assert.ok(p.log.some(row=>row[0]==='text'&&row[1]===(324<<16|116)&&row[2]==='1 coin'));}
});

test('A tan closes the tanner and says what was tanned, as live does; a refused tan keeps it open',()=>{
  const h=tanningHarness(),p=player();p.items.set(I.COWHIDE,3);p.items.set(I.COINS,100);
  h.api.emitCustomEvent('tanning:open',{player:p});tanClick(h,p,148);assert.deepEqual(p.messages,['The tanner tans your cowhide.']);assert.equal(p.removals,1);
  tanClick(h,p,124);assert.equal(p.items.get(I.COWHIDE),2,'closed: a second click tans nothing');
  h.api.emitCustomEvent('tanning:open',{player:p});tanClick(h,p,125);assert.equal(p.messages.at(-1),'The tanner tans 2 cowhides for you.');assert.equal(p.items.get(I.HARD_LEATHER),2);assert.equal(p.removals,2);
  p.items.set(I.BLACK_DRAGONHIDE,4);h.api.emitCustomEvent('tanning:open',{player:p});tanClick(h,p,131);assert.equal(p.messages.at(-1),'The tanner tans 4 black dragonhides for you.');assert.equal(p.removals,3);
  h.api.emitCustomEvent('tanning:open',{player:p});tanClick(h,p,124);assert.equal(p.messages.at(-1),"You don't have any suitable hides to tan.");assert.equal(p.removals,3);
  p.items.set(I.COWHIDE,5);p.items.set(I.COINS,0);tanClick(h,p,124);assert.equal(p.messages.at(-1),"You don't have enough coins to pay for tanning.");assert.equal(p.removals,3);
  p.items.set(I.COINS,2);tanClick(h,p,132);p.amountAction.execute(5);assert.equal(p.messages.at(-1),'The tanner tans 2 cowhides for you.');assert.equal(p.items.get(I.LEATHER),3);assert.equal(p.removals,4);
});

test('Garden optional notes, carvings, compass and labelled containers open native views without auto-learning',()=>{
  const h=harness('GardenOfDeath'),p=player();h.quest.setStage(p,54);p.items.set(I.WORD_TRANSLATIONS,1);
  for(const [index,id] of [I.DIRTY_NOTE,I.DIRTY_NOTE_2,I.DIRTY_NOTE_3].entries()) {p.items.set(id,1);read(h,p,id);assert.equal(p.interfaceId,625);assert.ok(p.log.some(row=>row[0]==='sendClientScript'&&row[1]===418&&row[3].includes(["This language is fascinating.","Vines! Vines everywhere!","There's something different about this place."][index])));close(h,p,625);assert.equal(h.quest.getStage(p),54);}
  assert.deepEqual(p.xp,[]);
  const groups=[105,803,800,793,797,795,801,802,792,794,799,796,791,798];for(let n=0;n<14;n++){const id=n?I[`WOOD_CARVING_${n+1}`]:I.WOOD_CARVING;p.items.set(id,1);read(h,p,id);assert.equal(p.interfaceId,groups[n]);}
  assert.equal(p.attrs.get('garden-of-death:translations'),undefined);
  p.items.set(I.COMPASS,1);read(h,p,I.COMPASS);assert.ok(p.log.some(row=>row[0]==='sendItemOnInterfaces'&&row[2]===I.COMPASS));
  object(h,p,core.ObjectIdentifiers.STONE_CHEST_26,1303,9885);assert.match(p.text,/Miki Toka/);assert.ok(p.log.some(row=>row[0]==='sendItemOnInterfaces'&&row[2]===27538));
  object(h,p,core.ObjectIdentifiers.STONE_CHEST_26,1442,9816);assert.equal(p.items.get(I.WOOD_CARVING_12),1);p.manager.advance();assert.match(p.text,/Antil/);assert.ok(p.log.some(row=>row[0]==='sendItemOnInterfaces'&&row[2]===27539));
  object(h,p,core.ObjectIdentifiers.STONE_CHEST_26,1442,9816);assert.match(p.text,/Antil/);assert.equal(p.items.get(I.WOOD_CARVING_12),1);
});

test('Garden preserves the recorded mesbox chat plus native item-dialogue pair',()=>{
  const h=harness('GardenOfDeath'),p=player();h.quest.setStage(p,6);object(h,p,core.ObjectIdentifiers.STONE_TABLE_35,1306,9885);
  assert.equal(p.messages.filter(text=>text==='You search the table and find a stone tablet. You take it.').length,1);assert.match(p.text,/You search the table/);assert.ok(p.log.some(row=>row[0]==='sendItemOnInterfaces'&&row[2]===I.STONE_TABLET_6));
});

test('Getting Ahead rejects noted/placeholder tools and accepts equipped Amy saw and Imcando hammer',(t)=>{
  t.mock.method(Math,'random',()=>0.999);const h=harness('GettingAhead'),p=player();h.quest.setStage(p,30);p.moveTo(new core.Location(1238,3683,0));for(const[id,n]of[[I.BLOODY_HEAD,1],[I.PLANK,2],[I.IRON_NAILS,6],[I.HAMMER,1],[I.SAW_2,1],[I.SAW_3,1]])p.items.set(id,n);
  const build=()=>h.namedObjects.get('Mounted Head Space').Build({player:p,objectId:20858});build();h.tick(7);assert.equal(h.quest.getStage(p),30);assert.equal(p.items.get(I.IRON_NAILS),6);
  p.items.delete(I.HAMMER);p.weapon=I.AMYS_SAW;p.shield=I.IMCANDO_HAMMER_OFF_HAND_;build();h.tick(7);assert.equal(h.quest.getStage(p),32);assert.equal(p.weapon,I.AMYS_SAW);assert.equal(p.shield,I.IMCANDO_HAMMER_OFF_HAND_);
});

test('Headless Beast cave isolates players and actors, uses the recorded spawn, and cleans up on exit',()=>{
  const h=harness('GettingAhead'),p=player(),q=player(),beast=enterLair(h,p),second=enterLair(h,q);const a=p.getPrivateArea(),b=q.getPrivateArea();assert.ok(a instanceof core.PrivateArea);assert.notEqual(a,b);assert.equal(beast.getArea(),a);assert.equal(second.getArea(),b);assert.deepEqual([beast.x,beast.y],[1187,10020]);assert.deepEqual(a.getPlayers(),[p]);assert.deepEqual(b.getPlayers(),[q]);assert.equal(beast.target,p);
  h.clicks.get(core.ObjectIdentifiers.CAVE_56)({player:p,objectId:core.ObjectIdentifiers.CAVE_56,location:{x:1189,y:10029}});assert.equal(p.getPrivateArea(),null);assert.equal(a.isDestroyed(),true);assert.equal(beast.removed,true);assert.equal(second.removed,undefined);assert.equal(q.getPrivateArea(),b);
});

test('Garden replaces lost translations at later stages without resetting learned words or progression',()=>{
  const h=harness('GardenOfDeath');
  for(const stage of [14,30,48,54,56]) {
    const p=player();h.quest.setStage(p,stage);p.items.set(I.STONE_TABLET_6,1);p.attrs.set('garden-of-death:translations','island|water|time');
    read(h,p,I.STONE_TABLET_6);close(h,p,748);h.continueUntil(p,()=>Boolean(p.prompt));h.choose(p,'Yes.');assert.equal(p.items.get(I.WORD_TRANSLATIONS),1);assert.equal(h.quest.getStage(p),stage);assert.equal(p.attrs.get('garden-of-death:translations'),'island|water|time');assert.deepEqual(p.xp,[]);
    read(h,p,I.WORD_TRANSLATIONS);assert.equal(p.interfaceId,804);
  }
});

test('Garden replaces a lost warning at54, retries with inventory space and never repeats completed rewards',()=>{
  const h=harness('GardenOfDeath'),p=player();h.quest.setStage(p,54);p.items.set(I.STONE_TABLET_9,1);p.full=true;
  read(h,p,I.STONE_TABLET_9);close(h,p,748);assert.equal(h.quest.getStage(p),54);assert.equal(p.items.get(I.WARNING_NOTE),undefined);assert.ok(p.messages.some(text=>text.includes("enough room")));
  p.full=false;read(h,p,I.STONE_TABLET_9);close(h,p,748);h.continueUntil(p,()=>Boolean(p.prompt));h.choose(p,'Yes.');assert.equal(p.items.get(I.WARNING_NOTE),1);assert.equal(h.quest.getStage(p),54);
  read(h,p,I.WARNING_NOTE);close(h,p,625);assert.equal(h.quest.getStage(p),56);assert.equal(p.xp.length,1);assert.equal(p.attrs.get('quest.points'),1);
  p.items.delete(I.WARNING_NOTE);read(h,p,I.STONE_TABLET_9);close(h,p,748);h.continueUntil(p,()=>Boolean(p.prompt));h.choose(p,'Yes.');read(h,p,I.WARNING_NOTE);close(h,p,625);assert.equal(h.quest.getStage(p),56);assert.equal(p.xp.length,1);assert.equal(p.attrs.get('quest.points'),1);
});
