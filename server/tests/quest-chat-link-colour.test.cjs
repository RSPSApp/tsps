// From server/: node --test tests/quest-chat-link-colour.test.cjs (after yarn build).
const assert = require('node:assert/strict');
//
// The quest link in the start and completion chat messages follows the player's chatbox background (varbit
// chatbox_transparency 4608): <col=081190> opaque (the default player), <col=0ab0ff> transparent. Inferred from rsprox
// 1694/1698/1703 (081190) against 70/1718/1723/1843 (0ab0ff); see ClientProtocol CHAT_HIGHLIGHTS.blu.
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
  const hooks = {}, events = {}, tasks = [], npcs = [], removed = [], objects = [], ground = [], clicks = new Map(), itemActions = new Map();
  const objectManager = {register: object => objects.push(object), deregister: object => { const i=objects.indexOf(object); if(i>=0)objects.splice(i,1); }};
  const api = new Proxy({ core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  }, ObjectManager: { register: noop, deregister: noop } },
    getObjectManager: () => objectManager,
    getItemOnGroundManager: () => ({ registerLocation: (...args) => ground.push(args) }),
    onObjectFirstClick: (ids, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    onItemAction: (name, actions) => { if (typeof name === 'string') itemActions.set(name, { ...(itemActions.get(name) ?? {}), ...actions }); },
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
  const h = { api, hooks, events, tasks, npcs, removed, objects, ground, clicks, itemActions, quest: runtime.getRegisteredQuests().at(-1),
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
    sendConfig(id, value) { configs.set(id, value); return packet; }, sendVarbit(id, value) { varbits.set(id, value); return packet; }, getVarbit: id => varbits.get(id) ?? 0,
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

const COOK_ID = N.COOK_7, ARIS = N.ARIS;
const CHATBOX_TRANSPARENCY = 4608;
const link = (name, colour) => `<col=${colour}>${name}</col>`;
for (const [background, value, colour] of [['opaque (a default player)', undefined, '081190'], ['transparent', 1, '0ab0ff']]) {
  test(`Cook's Assistant on an ${background} chatbox: the start and completion links are ${colour}`, () => {
    const h = harness('CooksAssistant'), p = player();
    if (value !== undefined) p.varbits.set(CHATBOX_TRANSPARENCY, value);
    h.emit('npc-dialogue:hook', { player: p, npcId: COOK_ID, hook: 'quest:cook-s-assistant:start' });
    const event = h.line(p, COOK_ID, "Yes, I'll help you.");
    assert.equal(typeof event.after, 'function', 'the start is committed after the line');
    event.after();
    assert.equal(h.quest.getStage(p), 1);
    assert.deepEqual(p.messages, [`You've started a new quest: ${link("Cook's Assistant", colour)}`]);
    p.messages.length = 0;
    h.quest.complete(p);
    assert.ok(p.messages.includes(`Congratulations, you've completed a quest: ${link("Cook's Assistant", colour)}`), p.messages.join('|'));
  });

  test(`Demon Slayer on an ${background} chatbox: the start and completion links are ${colour}`, () => {
    const h = harness('DemonSlayer'), p = player();
    if (value !== undefined) p.varbits.set(CHATBOX_TRANSPARENCY, value);
    h.emit('npc-dialogue:hook', { player: p, npcId: ARIS, hook: 'quest:demon-slayer:start' });
    assert.ok(p.messages.includes(`You've started a new quest: ${link('Demon Slayer', colour)}`), p.messages.join('|'));
    p.messages.length = 0;
    h.quest.complete(p);
    assert.ok(p.messages.includes(`Congratulations, you've completed a quest: ${link('Demon Slayer', colour)}`), p.messages.join('|'));
  });
}
