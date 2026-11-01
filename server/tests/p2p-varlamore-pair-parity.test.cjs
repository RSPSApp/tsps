// From server/: node --test tests/p2p-varlamore-pair-parity.test.cjs (after yarn build).
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
  const hooks = {}, events = {}, tasks = [], areas = [], npcs = [], removed = [], objects = [], ground = [], clicks = new Map(), buttons = new Map(), namedNpcs = new Map(), namedObjects = new Map();
  const objectManager = {register: object => objects.push(object), deregister: object => { const i=objects.indexOf(object); if(i>=0)objects.splice(i,1); }};
  const api = new Proxy({ core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  }, ObjectManager: { register: object => objects.push(object), deregister: noop } },
    registerArea: area => areas.push(area),
    getObjectManager: () => objectManager,
    getItemOnGroundManager: () => ({ registerLocation: (...args) => ground.push(args) }),
    onInterfaceActionButton: (ids, fn) => [].concat(ids).forEach(id => { const callbacks=buttons.get(id) ?? []; callbacks.push(fn); buttons.set(id,callbacks); }),
    onObjectClick: (ids, click, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    onNpcInteraction: (name, actions) => namedNpcs.set(name, actions),
    onObjectInteraction: (name, actions) => { if (typeof name === 'function') (hooks.onObjectInteraction ??= []).push(name); else namedObjects.set(name, actions); },
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
  const h = { api, hooks, events, tasks, areas, npcs, removed, objects, ground, clicks, buttons, namedNpcs, namedObjects, quest: runtime.getRegisteredQuests().at(-1),
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
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = { setEnteredAmountAction: action => { p.amountAction = action; }, attrs, items, configs, varbits, log, xp, messages: [], animations: [], prompt: null, text: '', index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), getInventory: () => inv,
    getBanks: () => [{ getAmount: id => p.bank?.get(id) ?? 0 }], getEquipment: () => ({ get: () => p.amulet ? { getId: () => p.amulet } : null }),
    getSession: () => ({ sendClientPacket: frame => { log.push(['frame',Buffer.from(frame)]); return true; } }), getPacketSender: () => packet, getDialogueManager: () => p.manager, getUpdateFlag: () => ({ flag: noop }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(),amount]), getCombatLevel: () => p.combat ?? 3, getCurrentLevel: () => p.magic ?? 99, getMaxLevel: () => p.level ?? 99 }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement(value) { p.blocked = value; return this; }, addSteps(to) { location = to; return this; }, isBlockMovement: () => Boolean(p.blocked) }),
    setUntargetable: value => { p.untargetable = value; }, setForceMovement: movement => {p.forceMovement=movement;}, getLocation: () => location, moveTo: to => { location = to; },
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; }, getIndex: () => p.index,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getCombat: () => ({getHitQueue:()=>({addPendingDamage: damage=>{p.damage=damage;}})}),
    getUsername: () => 'Parity', getAppearance: () => ({ isMale: () => true }), setPositionToFace: noop, forceChat: noop,
    performAnimation: a => p.animations.push(a.getId()), sendMessage: text => p.messages.push(text),
  }; p.manager = new DialogueManager(p); return p;
}
const continueToMenu = (h,p) => h.continueUntil(p, () => Boolean(p.prompt));


test('Ribbiting follows recorded stages22→24→26→28→30→32; chest needs the native NALIA response, rewards only after final reply', () => {
  const h = harness('RibbitingTale'), p = player();
  p.moveTo(new core.Location(1676, 2973, 0)); h.quest.setStage(p, 22);
  const chest = () => h.clicks.get(core.ObjectIdentifiers.CHEST_246)({ player: p });
  chest(); assert.ok(p.log.some(row => row[0] === 'sendInterface' && row[1] === 809));
  assert.deepEqual(p.log.find(row => row[0] === 'sendInterfaceScript' && row[1] === 6963)?.[2], [(809 << 16) | 1, (809 << 16) | 4, 5, 3511, 1, -1]);
  p.amountAction.execute(111111); assert.equal(h.quest.getStage(p), 22); assert.equal(p.items.get(I.PLUSHY), undefined);
  chest(); p.full = true; p.amountAction.execute(334490); assert.equal(h.quest.getStage(p), 22);
  p.full = false; chest(); p.amountAction.execute(334490); assert.equal(h.quest.getStage(p), 24);
  h.tick(1); assert.equal(p.items.get(I.PLUSHY), 1);
  p.manager.advance(); h.tick(2);
  h.clicks.get(52979)({ player: p }); assert.equal(h.quest.getStage(p), 24); h.tick(1);
  assert.equal(h.quest.getStage(p), 26); assert.equal(p.items.get(I.PLUSHY), 0);
  const cuthbert = h.npcs.find(npc => npc.id === N.CUTHBERT_LORD_OF_DREAD); assert.ok(cuthbert);
  h.hooks.onNpcDeath[0]({ npcId: N.CUTHBERT_LORD_OF_DREAD, npc: cuthbert, killer: p }); assert.equal(h.quest.getStage(p), 28);
  h.talk(p, N.MARCELLUS); assert.equal(h.quest.getStage(p), 28);
  h.continueUntil(p, () => p.text.includes('It cannot be')); p.manager.advance(); h.tick(6);
  h.continueUntil(p, () => p.text.includes('Tell them we have a deal')); assert.equal(h.quest.getStage(p), 30);
  p.manager.advance(); h.talk(p, N.SUE);
  h.continueUntil(p, () => p.text.includes('true hero')); assert.equal(h.quest.isComplete(p), false);
  assert.notEqual(p.varbits.get(9845), 1, 'the hardwood patch remains locked before the final reply');
  p.manager.advance(); assert.equal(h.quest.getStage(p), 32); assert.equal(p.attrs.get('quest.points'), 1);
  assert.deepEqual(p.xp, [[core.Skill.WOODCUTTING.getIndex(), 2000]]); assert.equal(p.varbits.get(9845), 1);
  h.talk(p, N.MARCELLUS); assert.equal(p.varbits.get(9845), 1);
});

test('Ribbiting starts the private hop-off after the invitation, replays exact camera and hops, returns to peace talks automatically', () => {
  const h = harness('RibbitingTale'), p = player(); p.moveTo(new core.Location(1693, 2995, 0)); h.quest.setStage(p, 14);
  h.talk(p, N.SUE); h.continueUntil(p, () => p.text === "Let's!"); assert.equal(p.blocked, undefined);
  p.manager.advance(); assert.equal(p.blocked, true); h.tick(3);
  assert.deepEqual(p.log.find(row => row[0] === 'sendCameraMoveTo'), ['sendCameraMoveTo', 1685, 2989, 550, { rate: 232, rate2: 100, heightRelative: false }]);
  assert.deepEqual(p.log.find(row => row[0] === 'sendCameraLookAt'), ['sendCameraLookAt', 1697, 2981, 350, { rate: 232, rate2: 100, heightRelative: false }]);
  assert.equal(p.getArea().getNpcs().length, 9); h.tick(3);
  h.continueUntil(p, () => p.text.includes("first contender")); p.manager.advance(); h.tick(1);
  const sue = h.npcs.find(npc => npc.id === 12948); assert.deepEqual(sue.exact, { startCycles: 7, endCycles: 24, angle: 512 });
  h.tick(2); assert.match(p.text, /corker/);
  h.continueUntil(p, () => p.text.includes('Next up')); p.manager.advance(); h.tick(1);
  const cuthbert = h.npcs.find(npc => npc.id === 12956); assert.deepEqual(cuthbert.exact, { startCycles: 13, endCycles: 30, angle: 512 });
  h.tick(6); assert.match(p.text, /he's dead/);
  h.continueUntil(p, () => p.text.includes('winner!')); p.manager.advance(); assert.equal(h.quest.getStage(p), 16);
  h.tick(6); assert.equal(p.getArea(), null); assert.equal(p.blocked, false); assert.match(p.text, /talks underway/);
  assert.ok(p.log.some(row => row[0] === 'sendCameraReset'));
});

test('Ribbiting logout during the camera scene cancels pending choreography and releases controls', () => {
  const h = harness('RibbitingTale'), p = player(); h.quest.setStage(p, 14); h.talk(p, N.SUE);
  h.continueUntil(p, () => p.text === "Let's!"); p.manager.advance(); h.tick(3);
  h.hooks.onPlayerLogout[0]({ player: p }); const cameras = p.log.filter(row => row[0].startsWith('sendCamera')).length;
  h.tick(40); assert.equal(p.log.filter(row => row[0].startsWith('sendCamera')).length, cameras); assert.equal(p.blocked, false);
});

test('Ribbiting tree and stone actions keep captured delays, reject duplicate actions, and cancel on logout', () => {
  const h = harness('RibbitingTale'), p = player(); p.items.set(I.BRONZE_AXE, 1); h.quest.setStage(p, 10);
  const chop = () => h.clicks.get(52977)({ player: p }); chop(); chop();
  assert.equal(h.quest.getStage(p), 10); assert.deepEqual(p.animations, [879]); h.tick(3); assert.equal(h.quest.getStage(p), 10);
  h.tick(1); assert.equal(h.quest.getStage(p), 12); assert.match(p.text, /Oranges/);
  const sabotage = () => h.clicks.get(50891)({ player: p }); sabotage(); sabotage(); h.tick(2);
  assert.deepEqual(p.animations.slice(-2), [827,385]); assert.equal(h.quest.getStage(p), 12); h.tick(2); assert.equal(h.quest.getStage(p), 14);
  h.quest.setStage(p, 10); chop(); h.hooks.onPlayerLogout[0]({ player: p }); h.tick(8); assert.equal(h.quest.getStage(p), 10); assert.equal(p.blocked, false);
});

test('Ribbiting migrates old completed saves without granting rewards again and retains new accepted-stage saves', () => {
  const h = harness('RibbitingTale'), p = player(), stageKey = 'quest.the_ribbiting_tale_of_a_lily_pad_labour_dispute.stage';
  p.attrs.set(stageKey, 30); p.attrs.set('quest.points', 7); h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(h.quest.getStage(p), 32); assert.equal(p.attrs.get('quest.points'), 7); assert.deepEqual(p.xp, []);
  const fresh = player(); h.quest.setStage(fresh, 30); h.hooks.onPlayerLogin[0]({ player: fresh }); assert.equal(h.quest.getStage(fresh), 30);
  const chest = player(); chest.attrs.set(stageKey, 22); chest.attrs.set('quest.ribbiting-tale.chest-unlocked', true);
  h.hooks.onPlayerLogin[0]({ player: chest }); assert.equal(h.quest.getStage(chest), 24);
});

test('Ribbiting starts on the captured final briefing line and first meeting uses the talkable Frog variant', () => {
  const h = harness('RibbitingTale'), p = player();
  (h.events['quest:is-complete'] ??= []).push(event => { if (event.key === 'children_of_the_sun') event.complete = true; });
  h.talk(p, N.MARCELLUS); h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, 'Yes.'); assert.equal(h.quest.getStage(p), 0);
  h.continueUntil(p, () => p.text.includes('corpse')); assert.equal(h.quest.getStage(p), 0); p.manager.advance(); assert.equal(h.quest.getStage(p), 2);
  assert.ok(p.messages.some(text => text.includes("You've started a new quest")));
  h.talk(p, N.FROG_16); assert.equal(h.quest.getStage(p), 2); h.continueUntil(p, () => p.text.includes("I'll be back shortly")); assert.equal(h.quest.getStage(p), 4);
});

test('Ribbiting locks only its hardwood patch and grants postquest permission on the actual Marcellus line', () => {
  const h = harness('RibbitingTale'), p = player();
  const request = patch => { const event = { player: p, patch: { id: patch }, allowed: true }; h.emit('farming:can-use-patch', event); return event; };
  assert.equal(request(50692).allowed, false); assert.match(p.text, /farming patch/); assert.notEqual(p.varbits.get(9845), 1);
  assert.equal(request(27116).allowed, true);
  h.quest.setStage(p, 32); assert.equal(request(50692).allowed, false); assert.equal(p.varbits.get(9845), 1); assert.equal(request(50692).allowed, true);
  h.hooks.onPlayerLogin[0]({ player: p }); assert.equal(p.varbits.get(9845), 1);
});

async function ruff(p, h, stage) { p.attrs.set('a-ruff-situation:stage-version', 1); h.quest.setStage(p, stage); h.hooks.onPlayerLogin[0]({ player: p }); h.emit('player:bootstrap-complete',{player:p}); for(const callback of h.buttons.get((378<<16)|72) ?? []) callback({player:p}); await Promise.resolve(); }
function driveRuff(h, p) {
  for (let count = 0; count < 100 && !p.blocked; count++) {
    const dog = h.npcs.findLast(npc => !npc.removed && [16504,16505].includes(npc.id));
    assert.ok(dog); if (dog.walkingTo) { dog.moveTo(dog.walkingTo); p.moveTo(dog.walkingTo); }
    h.areas[0].process(p);
    if (h.quest.getStage(p) === 25) return;
  }
}
test('Ruff uses native5/10/15/20/25 stages, parent den scenery, and all three delayed inspection flags', async () => {
  const h = harness('ARuffSituation'), p = player();
  (h.events['quest:is-complete'] ??= []).push(event => { if (event.key === 'gertrudes_cat') event.complete = true; });
  h.namedNpcs.get('Talia')['Talk-to']({ player: p, npcId: 16486 });
  continueToMenu(h,p); h.choose(p,'Yes.'); assert.equal(h.quest.getStage(p),5);
  h.continueUntil(p,()=>p.text === 'Gertrude.'); assert.equal(h.quest.getStage(p),10);
  h.namedNpcs.get('Gertrude')['Talk-to']({ player:p, npcId:core.NpcIdentifiers.GERTRUDE }); assert.equal(h.quest.getStage(p),10); h.choose(p,'Ask about lost dogs.');
  h.continueUntil(p,()=>p.text.startsWith('Well, it would be nice')); assert.equal(h.quest.getStage(p),15);
  p.moveTo(new core.Location(3180,3425,0)); h.namedNpcs.get('Guard')['Talk-to']({player:p,npcId:16493});
  h.continueUntil(p,()=>p.text === 'Of course I can! Where did you want to go, girl?'); assert.equal(h.quest.getStage(p),20);
  h.continueUntil(p,()=>p.text.startsWith("You'd better be quick")); p.manager.advance(); driveRuff(h,p); assert.equal(h.quest.getStage(p),25);
  assert.deepEqual(h.objects,[]); h.hooks.onPlayerLogin[0]({player:p}); assert.deepEqual(h.objects,[]);
  const { getTemplateRegion } = require('../dist/game/collision/TemplateRegionData');
  assert.deepEqual(getTemplateRegion((49<<8)|53).chunks.flat().filter(o=>[62483,62486,62489].includes(o.id)).map(o=>o.id).sort(),[62483,62486,62489]);
  h.namedObjects.get('Chewed box').Inspect({player:p,objectId:62489}); assert.notEqual(p.varbits.get(15893),1); h.tick(2); assert.equal(p.varbits.get(15893),1); p.manager.advance();
  h.namedObjects.get('Torn newspaper').Inspect({player:p,objectId:62486}); h.tick(3); assert.notEqual(p.varbits.get(15891),1); h.tick(1); assert.equal(p.varbits.get(15891),1); p.manager.advance();
  h.namedObjects.get('Rough bedding').Inspect({player:p,objectId:62483}); h.tick(2); p.manager.advance(); assert.equal(h.quest.getStage(p),30);
  assert.equal(p.varbits.get(15890),1); h.continueUntil(p,()=>p.text === "What's wrong? Have you caught their scent?"); assert.equal(h.quest.getStage(p),35);
});

test('Ruff first private rescue follows captured camera/pause/pickup and resumes automatically with a real puppy', async () => {
  const h = harness('ARuffSituation'), p = player(); p.moveTo(new core.Location(3197,3414,0)); await ruff(p,h,35); driveRuff(h,p);
  assert.equal(h.quest.getStage(p),40); h.tick(3);
  assert.deepEqual(p.log.find(row=>row[0]==='sendCameraMoveTo'),['sendCameraMoveTo',3152,3451,400,{rate:232,rate2:100,heightRelative:false}]); h.tick(3);
  h.continueUntil(p,()=>p.text==='Bark bark.'); assert.ok(p.log.some(row=>row[0]==='sendCameraMoveTo'&&row[1]===3152&&row[2]===3454&&row[4].rate===3)); p.manager.advance();
  h.tick(5); assert.equal(p.text,''); h.tick(1); assert.equal(p.text,'Hey, is that one of your puppies?');
  h.continueUntil(p,()=>p.text==='Woof woof!'); p.manager.advance(); h.tick(13);
  assert.equal(p.text,'Uh oh! Big dog!'); h.continueUntil(p,()=>p.text==='Picklenose think Picklenose go now.'); p.manager.advance(); h.tick(2);
  h.continueUntil(p,()=>p.text.startsWith('Yes of course')); p.manager.advance(); assert.equal(h.quest.getStage(p),40); h.tick(1); assert.equal(p.animations.at(-1),827); h.tick(1); assert.equal(h.quest.getStage(p),50); assert.equal(p.items.get(I.STRAY_PUPPY),1);
  h.tick(4); assert.equal(p.getArea(),null); h.tick(2); assert.equal(p.blocked,false); assert.equal(p.text,'We arrived at the right time.');
  h.continueUntil(p,()=>h.quest.getStage(p)===55); assert.equal(p.varbits.get(15897),1);
});

test('Ruff outlaw cameras preserve cycle/easing packets, actual combat pair, third puppy and all final shelter cameras/reward timing', async () => {
  const h = harness('ARuffSituation'), p = player(); p.items.set(I.STRAY_PUPPY,1); p.items.set(I.STRAY_PUPPY_2,1);
  p.moveTo(new core.Location(3132,3436,0)); await ruff(p,h,80); driveRuff(h,p); assert.equal(h.quest.getStage(p),85); h.tick(6);
  assert.equal(p.text,"Look what we got 'ere."); assert.ok(p.log.some(row=>row[0]==='sendCameraMoveTo'&&row[4].cycles===210&&row[4].easing==='ease_in_out_sine'));
  p.manager.advance(); assert.equal(p.text,"A little mangy mutt. Can we keep 'em?"); p.manager.advance(); h.tick(1);
  assert.ok(p.log.some(row=>row[0]==='sendCameraMoveTo'&&row[4].cycles===60));
  h.continueUntil(p,()=>p.text==="What do they use 'em for?"); p.manager.advance(); h.tick(1);
  h.continueUntil(p,()=>p.text==='Oi, leave that puppy alone!'); p.manager.advance(); h.tick(8);
  assert.ok(p.log.some(row=>row[0]==='sendCameraLookAt'&&row[4].cycles===150&&row[4].trackTarget===false));
  h.continueUntil(p,()=>p.text==="You'll 'av to take 'em from us."); p.manager.advance(); assert.equal(h.quest.getStage(p),90); assert.equal(p.blocked,false);
  const outlaws=h.npcs.filter(n=>!n.removed&&[16527,16528].includes(n.id)); assert.equal(outlaws.length,2);
  for(const npc of outlaws)h.hooks.onNpcDeath[0]({npc,npcId:npc.id}); assert.equal(h.quest.getStage(p),95); h.tick(1);
  assert.equal(p.text,'Are you okay, little guy? Did they hurt you?'); h.continueUntil(p,()=>p.text.startsWith("Looks like you're all")); p.manager.advance(); h.tick(2);
  assert.equal(h.quest.getStage(p),105); assert.equal(p.items.get(I.STRAY_PUPPY_3),1); h.tick(6);
  assert.equal(p.text,'Is that all of them?'); h.continueUntil(p,()=>p.text==="You seem enthusiastic enough. Let's head out."); p.manager.advance(); assert.equal(h.quest.getStage(p),110); h.tick(7);
  assert.equal(h.quest.getStage(p),115); assert.equal(p.text,'Talia, Chase! I have returned.');
  h.continueUntil(p,()=>p.text==='But we managed to save them all!'); p.manager.advance(); assert.equal(p.items.get(I.STRAY_PUPPY),0); assert.equal(h.quest.isComplete(p),false); h.tick(7);
  h.continueUntil(p,()=>p.text==='Wonderful, you will all be happy and safe here!'); p.manager.advance();
  assert.ok(p.log.some(row=>row[0]==='sendCameraMoveTo'&&row[1]===3034&&row[2]===3450));
  h.continueUntil(p,()=>p.text==="What's the matter, girl?"); p.manager.advance(); h.tick(4);
  h.continueUntil(p,()=>p.text.startsWith('What kind of shelter would we be')); p.manager.advance(); assert.equal(h.quest.isComplete(p),false); h.tick(4);
  h.continueUntil(p,()=>p.text==='Business is business.'); assert.equal(h.quest.isComplete(p),false); p.manager.advance(); assert.equal(h.quest.getStage(p),120);
  assert.deepEqual(p.xp,[[core.Skill.CRAFTING.getIndex(),1000]]); assert.equal(p.attrs.get('quest.points'),1); h.tick(2); assert.equal(p.blocked,false);
});

test('Ruff goblin bargain retains needle/thread, grants real second puppy after fade and two-tick827 pickup', async () => {
  const h=harness('ARuffSituation'), p=player(); p.moveTo(new core.Location(3131,3436,0)); p.items.set(I.STRAY_PUPPY,1); await ruff(p,h,60);
  for(const id of [I.GRAIN,I.FUR,I.NEEDLE,I.THREAD])p.items.set(id,1);
  h.hooks.onItemOnItem[0]({player:p,usedItemId:I.GRAIN,usedWithItemId:I.FUR}); h.choose(p,'Yes.');
  assert.equal(h.quest.getStage(p),65); assert.equal(p.items.get(I.FUR),0); assert.equal(p.items.get(I.GRAIN),0); assert.equal(p.items.get(I.NEEDLE),1); assert.equal(p.items.get(I.THREAD),1); assert.equal(p.animations.at(-1),8839);
  h.namedNpcs.get('Picklenose')['Talk-to']({player:p,npcId:16523});
  h.continueUntil(p,()=>h.quest.getStage(p)===66); assert.equal(p.items.get(I.STUFFED_DOG),0);
  h.continueUntil(p,()=>p.text==="Oh, that's very kind of you. Thank you."); p.manager.advance(); assert.equal(h.quest.getStage(p),66); h.tick(3); assert.equal(h.quest.getStage(p),66); h.tick(1); assert.equal(h.quest.getStage(p),70); h.tick(2);
  assert.ok(p.text.startsWith("They're finally gone")); p.manager.advance(); assert.equal(h.quest.getStage(p),70); h.tick(1); assert.equal(p.animations.at(-1),827); h.tick(1);
  assert.equal(h.quest.getStage(p),75); assert.equal(p.items.get(I.STRAY_PUPPY_2),1); assert.equal(p.blocked,false);
});

test('Ruff old completed saves migrate to120 without reward duplication; lost quest puppies return to den and can be recovered', async () => {
  const h=harness('ARuffSituation'), p=player(); p.attrs.set('quest.a_ruff_situation.stage',10); p.attrs.set('quest.points',9); h.hooks.onPlayerLogin[0]({player:p});
  assert.equal(h.quest.getStage(p),120); assert.equal(p.attrs.get('quest.points'),9); assert.deepEqual(p.xp,[]);
  const q=player(); q.items.set(I.STRAY_PUPPY,1); await ruff(q,h,55);
  const drop={player:q,itemId:I.STRAY_PUPPY,handled:false}; h.hooks.onItemDropPolicy[0](drop);
  assert.equal(drop.handled,true); assert.equal(q.items.get(I.STRAY_PUPPY),0); assert.equal(q.varbits.get(15894),1);
  const puppy=h.npcs.findLast(n=>!n.removed&&n.id===16515); assert.ok(puppy);
  h.namedNpcs.get('Stray puppy')['Pick-up']({player:q,npc:puppy,npcId:16515}); assert.equal(q.items.get(I.STRAY_PUPPY),1); assert.equal(q.varbits.get(15894),0);
});

test('Ruff logout cancels delayed puppy award/camera movement and relog restarts the earned scene safely', async () => {
  const h=harness('ARuffSituation'), p=player(); p.moveTo(new core.Location(3148,3455,0)); await ruff(p,h,40); h.tick(6);
  const event={player:p,npcId:16504,stepId:'sZmmAX',pages:[{page:'A Ruff Situation'}]}; h.emit('npc-dialogue:action',event); h.tick(1);
  h.hooks.onPlayerLogout.forEach(fn=>fn({player:p})); const cameraCount=p.log.filter(r=>r[0].startsWith('sendCamera')).length;
  h.tick(30); assert.equal(p.items.get(I.STRAY_PUPPY),undefined); assert.equal(p.blocked,false); assert.equal(p.log.filter(r=>r[0].startsWith('sendCamera')).length,cameraCount);
  h.hooks.onPlayerLogin[0]({player:p}); h.emit('player:bootstrap-complete',{player:p}); for(const callback of h.buttons.get((378<<16)|72) ?? []) callback({player:p}); await Promise.resolve(); h.tick(6); assert.equal(p.text,'Grrrrr...'); assert.equal(h.quest.getStage(p),40);
});

test('Ruff full-inventory rescue retries without losing the puppy; interrupted completed barter still exposes the second puppy', async () => {
  const h=harness('ARuffSituation'), p=player(); p.moveTo(new core.Location(3148,3455,0)); await ruff(p,h,40); h.tick(6); p.full=true;
  h.emit('npc-dialogue:action',{player:p,npcId:16504,stepId:'sZmmAX',pages:[{page:'A Ruff Situation'}]}); h.tick(2);
  assert.equal(h.quest.getStage(p),40); assert.equal(p.blocked,false); assert.equal(p.items.get(I.STRAY_PUPPY),undefined);
  p.full=false; h.namedNpcs.get('Stray dog').Interact({player:p,npcId:16504}); h.tick(6); assert.equal(p.text,'Grrrrr...');
  const q=player(); await ruff(q,h,66); assert.equal(h.quest.getStage(q),70);
  const second=h.npcs.findLast(n=>!n.removed&&n.id===16516); assert.ok(second); h.namedNpcs.get('Stray puppy')['Pick-up']({player:q,npc:second,npcId:16516});
  assert.equal(h.quest.getStage(q),75); assert.equal(q.items.get(I.STRAY_PUPPY_2),1);
});

test('Ruff desktop recovery waits for the real Welcome Play root swap before mounting fade, actors, camera and dialogue', async () => {
  const h=harness('ARuffSituation'), p=player();
  require('../plugins/interface/WelcomeScreen.plugin').register(h.api);
  p.attrs.set('a-ruff-situation:stage-version',1); h.quest.setStage(p,85);
  h.hooks.onPlayerLogin.forEach(fn=>fn({player:p,isNewAccount:false}));
  p.getSession().sendClientPacket(Buffer.alloc(0));
  h.emit('player:bootstrap-complete',{player:p});
  await Promise.resolve(); h.tick(12);
  assert.ok(p.log.some(row=>row[0]==='sendRootInterface'&&row[1]===378));
  assert.equal(p.getArea(),null); assert.equal(p.manager.getCurrent(),undefined);
  assert.equal(p.log.some(row=>row[0]==='sendCameraMoveTo'),false);
  assert.equal(p.log.some(row=>row[0]==='sendSubInterface'&&row[2]===174),false);
  for(const callback of h.buttons.get((378<<16)|72)) callback({player:p});
  const finalGameframePacket=p.log.findLastIndex(row=>row[0]==='frame');
  assert.ok(finalGameframePacket>=0); assert.equal(p.getArea(),null);
  await Promise.resolve();
  assert.ok(p.log.findIndex(row=>row[0]==='sendSubInterface'&&row[2]===174)>finalGameframePacket);
  h.tick(6); assert.equal(p.getArea().getNpcs().length,4); assert.equal(p.text,"Look what we got 'ere.");
  assert.ok(p.manager.getCurrent());
  assert.ok(p.log.some(row=>row[0]==='sendCameraMoveTo'&&row[4].cycles===210));
});

test('Ruff skip-Welcome accounts resume after bootstrap, while logout cancels queued recovery', async () => {
  for(const kind of ['mobile','new','bot','wilderness']) {
    const h=harness('ARuffSituation'), p=player(); require('../plugins/interface/WelcomeScreen.plugin').register(h.api);
    if(kind==='mobile')p.attrs.set('mobile-client',true);
    if(kind==='bot')p.isPlayerBot=()=>true;
    if(kind==='wilderness')p.moveTo(new core.Location(3200,3600,0));
    p.attrs.set('a-ruff-situation:stage-version',1); h.quest.setStage(p,85);
    h.hooks.onPlayerLogin.forEach(fn=>fn({player:p,isNewAccount:kind==='new'}));
    assert.equal(p.log.some(row=>row[0]==='sendSubInterface'&&row[2]===174),false);
    h.emit('player:bootstrap-complete',{player:p}); await Promise.resolve(); h.tick(6);
    assert.equal(p.text,"Look what we got 'ere.",kind); assert.equal(p.log.some(row=>row[0]==='sendRootInterface'&&row[1]===378),false);
  }
  const h=harness('ARuffSituation'), p=player(); p.attrs.set('mobile-client',true); p.attrs.set('a-ruff-situation:stage-version',1); h.quest.setStage(p,85);
  h.hooks.onPlayerLogin[0]({player:p}); h.emit('player:bootstrap-complete',{player:p});
  h.hooks.onPlayerLogout.forEach(fn=>fn({player:p})); await Promise.resolve(); h.tick(12);
  assert.equal(p.getArea(),null); assert.equal(p.log.some(row=>row[0]==='sendCameraMoveTo'),false); assert.equal(p.blocked,false);
});
