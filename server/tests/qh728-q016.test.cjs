// From server/: node --test tests/qh728-q016.test.cjs (after yarn build).
// Death on the Isle: dispatches the plugin's NPC/object/dialogue handlers and
// follows the captured doti 0->50 stage route (RSProx 1695).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
let nextIndex = 1;
const noop = () => {};
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, '..')); ObjectDefinition.init(); new NpcDefinitionLoader().load(); });

function harness(name) {
  const hooks = {}, events = {}, tasks = [], areas = [], combatResolvers = [], npcs = [], removed = [], objects = [], ground = [];
  const objectManager = { register: object => objects.push(object), deregister: object => { const i = objects.indexOf(object); if (i >= 0) objects.splice(i, 1); } };
  const taskManager = { submit(task) { task.setRunning(true); tasks.push(task); }, cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); } };
  const api = new Proxy({ core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: taskManager,
      MultiChatboxPrompt: { getPending: p => p.prompt }, ObjectManager: objectManager },
    getTaskManager: () => taskManager,
    registerArea: area => areas.push(area),
    registerCombatMethodResolver: resolver => combatResolvers.push(resolver),
    getObjectManager: () => objectManager,
    getItemOnGroundManager: () => ({ registerLocation: (...args) => ground.push(args) }),
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    persistAttribute: noop,
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z), area = null;
      const npc = { ...definition, getId: () => definition.id, index: nextIndex++, getLocation: () => location, moveTo: to => { location = to; },
        getArea: () => area, setArea: value => { area = value; }, isRegistered: () => !npc.removed, setPositionToFace: noop,
        performAnimation: noop, showHitsplat: noop, getMovementQueue: () => ({ addSteps: to => { npc.walkingTo = to; } }),
        getOwner: () => definition.owner, getCombat: () => ({ attack: player => { npc.target = player; }, reset: noop }) };
      npcs.push(npc); return npc;
    }, removeNpc: npc => { npc.removed = true; removed.push(npc); },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) { const answer = fn(event); if (answer !== null && answer !== undefined) return answer; }
    return null;
  };
  const h = { api, hooks, events, tasks, areas, combatResolvers, npcs, removed, objects, ground,
    quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    line(p, npcId, text) { const event = { player: p, npcId, text, pages: [{ page: h.quest.name }] }; h.emit('npc-dialogue:line', event); event.before?.(); event.after?.(); return event; },
    action(p, npcId, stepId) { const event = { player: p, npcId, stepId, pages: [{ page: h.quest.name }] }; h.emit('npc-dialogue:action', event); return event; },
    npc(p, npcId, option = 'Talk-to') { const event = { player: p, npcId, clickType: 1, definition: { getActions: () => [option] } }; (hooks.onNpcInteraction ?? []).forEach(fn => fn(event)); return event; },
    object(p, objectId) { const event = { player: p, objectId, definition: { id: objectId } }; (hooks.onObjectInteraction ?? []).forEach(fn => fn(event)); return event; },
    item(p, itemId, option = 'Inspect') { (hooks.onItemAction ?? []).forEach(fn => fn({ player: p, itemId, option })); },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
    choose(p, text) { const prompt = p.prompt; assert.ok(prompt, `no menu for ${text}`); const index = prompt.options.findIndex(label => label === text); assert.ok(index >= 0, `missing ${text} in ${prompt.options}`); p.prompt = null; prompt.pairs[index * 2 + 1](); },
    continueUntil(p, predicate, limit = 100) { while (!predicate()) { assert.ok(limit-- > 0, `dialogue stalled at ${p.text}`); assert.ok(p.manager.getCurrent(), `dialogue ended at ${p.text}`); p.manager.advance(); } },
  };
  return h;
}

function container(size) {
  let items = Array.from({ length: size }, () => new core.Item(-1, 0));
  return { getItems: () => items, setItems: next => { items = next; }, refreshItems: noop,
    getAmount: id => items.filter(item => item.getId() === id).reduce((n, item) => n + item.getAmount(), 0),
    getFreeSlots: () => items.filter(item => item.getId() < 0).length,
    adds(id, amount) { const i = items.findIndex(item => item.getId() < 0); assert.ok(i >= 0, 'inventory full'); items[i] = new core.Item(id, amount); },
    deleteNumber(id, amount) { const i = items.findIndex(item => item.getId() === id); assert.ok(i >= 0, `missing item ${id}`); items[i] = new core.Item(-1, 0); },
  };
}

function player() {
  const attrs = new Map(), configs = new Map(), varbits = new Map(), log = [], xp = [], messages = [];
  let location = new core.Location(3210, 3220, 0), area = null, text = '', prompt = null;
  const inventory = container(28), equipment = container(14);
  let manager;
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; }, sendVarbit(id, value) { varbits.set(id, value); return packet; },
    getVarbit: id => varbits.get(id) ?? 0, getVarp: id => configs.get(id) ?? 0,
    sendString(value) { text = value; log.push(['text', value]); return packet; },
    sendInterfaceRemoval() { manager.reset(); prompt = null; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = { attrs, configs, varbits, log, xp, messages, inventory, equipment, index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), getInventory: () => inventory,
    getEquipment: () => equipment, getPacketSender: () => packet, getDialogueManager: () => manager,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]), getMaxLevel: () => 99 }),
    getMovementQueue: () => ({ reset() { return this; }, addSteps(to) { location = to; return this; }, setBlockMovement() { return this; } }),
    getLocation: () => location, moveTo: to => { location = to; }, getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; },
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true, getUsername: () => 'q016', getIndex: () => p.index,
    setUntargetable: noop, setPositionToFace: noop, performAnimation: noop, sendMessage: value => messages.push(value),
    getCombat: () => ({ reset: noop }), getHitpoints: () => 99,
  };
  manager = new DialogueManager(p);
  Object.defineProperty(p, 'text', { get: () => text, set: value => { text = value; } });
  Object.defineProperty(p, 'prompt', { get: () => prompt, set: value => { prompt = value; } });
  Object.defineProperty(p, 'manager', { get: () => manager });
  return p;
}

function doti() {
  const h = harness('DeathOnTheIsle'), p = player();
  (h.events['quest:is-complete'] ??= []).push(event => { if (event.key === 'children_of_the_sun') event.complete = true; });
  p.attrs.set('death-on-the-isle:stage-version', 1);
  return { h, p };
}

const START_HOOK = 'quest:death-on-the-isle:start';

test('DOTI stage 0 to 50: every captured leg dispatches through the plugin handlers', () => {
  const { h, p } = doti();
  h.emit('npc-dialogue:hook', { player: p, hook: START_HOOK, npcId: N.PATZI });
  assert.equal(h.quest.getStage(p), 2, 'start hook');
  h.line(p, N.PATZI, "Right... I guess I'm off to find a uniform then.");
  assert.equal(h.quest.getStage(p), 4, 'uniform instruction');
  h.object(p, O.HOUSE_WINDOW);
  assert.equal(h.quest.getStage(p), 6, 'window');
  h.object(p, O.WARDROBE_59);
  assert.equal(p.inventory.getAmount(I.BUTLERS_UNIFORM_3), 1, 'stolen top 29916');
  assert.equal(p.inventory.getAmount(I.BUTLERS_UNIFORM_5), 1, 'stolen bottom 29918');
  assert.equal(p.inventory.getAmount(I.BUTLERS_UNIFORM), 0, 'no villa top from the wardrobe');
  h.action(p, N.PATZI, 'VOULZt'); h.tick(3);
  assert.equal(h.quest.getStage(p), 8, 'Adala heads inside');
  h.line(p, N.PATZI, "I'll bet Adala went through it. You should've followed her! I think she headed somewhere along that hedgerow.");
  assert.equal(h.quest.getStage(p), 10, 'staff entrance');
  h.line(p, N.HEAD_BUTLER, 'Right, I think that covers everything. Are you ready to enter?');
  assert.equal(h.quest.getStage(p), 12, 'uniform ready');
  assert.equal(p.varbits.get(11231) >= 1 && p.varbits.get(11231) <= 5, true, 'mask assignment');
  h.action(p, N.HEAD_BUTLER, '9kVMFj'); h.tick(4);
  assert.equal(h.quest.getStage(p), 14, 'inside villa');
  assert.equal(p.equipment.getItems()[core.Equipment.BODY_SLOT].getId(), I.BUTLERS_UNIFORM, 'villa top 29914');
  assert.equal(p.equipment.getItems()[core.Equipment.LEG_SLOT].getId(), I.BUTLERS_UNIFORM_2, 'villa bottom 29915');
  assert.equal(p.equipment.getItems()[core.Equipment.WEAPON_SLOT].getId(), I.BUTLERS_TRAY_3, 'party tray 30156');
  h.line(p, N.PATZI, 'No, no. I think you\'re doing more than enough right now, thank you.');
  assert.equal(h.quest.getStage(p), 15, 'met Patzi');
  for (const [npcId, text] of [
    [N.CONSTANTINIUS, "Anyway, perhaps you'll see him tonight on stage!"],
    [N.COZYAC, "I am, yes. Though I am far more excited for tonight's performance. Constantinius says he's hired some of the finest actors for this one!"],
    [N.PAVO, "Alcoholic? I'll have you know that I, Pavo, am most certainly not an alcoholic. Now scram."],
    [N.XOCOTLA, "I run something of a shipping company. If you need it moving, Xocotla's Got Ya!"],
  ]) h.line(p, npcId, text);
  h.line(p, N.PATZI, 'Alright, one glass of wine coming right up.');
  assert.equal(h.quest.getStage(p), 16, 'wine request');
  h.object(p, O.CELLAR_ENTRANCE);
  assert.equal(h.quest.getStage(p), 18, 'cellar');
  h.action(p, N.STRADIUS, 'wNdlW9');
  assert.equal(h.quest.getStage(p), 19, 'wine spilled');
  h.action(p, N.STRADIUS, 'GTGWOB');
  assert.equal(h.quest.getStage(p), 20, 'arrested');
  h.line(p, N.STRADIUS, 'Stradius...');
  assert.equal(h.quest.getStage(p), 21, 'interrogated');
  h.action(p, N.STRADIUS, 'YgkOvV');
  assert.equal(h.quest.getStage(p), 22, 'released with case file');
  assert.equal(p.inventory.getAmount(I.CASE_FILE), 1);
  for (const objectId of [O.JUG, O.BROKEN_POTTERY, O.WINE_STORAGE, O.SMALL_BOX, O.BROKEN_STOOL_3]) h.object(p, objectId);
  h.npc(p, N.COL_00FFFF_LIVIUS_COL, 'Inspect');
  h.line(p, N.STRADIUS, 'What if they hired someone to do it for them?');
  assert.equal(h.quest.getStage(p), 24, 'clues reported');
  h.line(p, N.STRADIUS, 'Hutza!');
  assert.equal(h.quest.getStage(p), 26, 'pickpocketing');
  h.npc(p, N.ADALA_4, 'Pickpocket');
  h.action(p, N.ADALA_4, '5z2Lhi');
  h.npc(p, N.COZYAC_2, 'Pickpocket');
  h.action(p, N.COZYAC_2, 'SsD2Fw');
  h.npc(p, N.PAVO_2, 'Pickpocket');
  h.action(p, N.PAVO_2, 'Adb65_');
  h.npc(p, N.XOCOTLA_2, 'Pickpocket');
  h.action(p, N.XOCOTLA_2, 'XXxTM6');
  for (const itemId of [I.WINE_LABELS, I.THREATENING_NOTE, I.DRINKING_FLASK, I.SHIPPING_CONTRACT]) h.item(p, itemId);
  h.action(p, N.STRADIUS, 'JwtSTS');
  assert.equal(p.varbits.get(11233), 1, 'evidence handed over');
  h.line(p, N.STRADIUS, 'Alright, [player name], just let us know when you want everyone gathered and we\'ll take them upstairs for you.');
  assert.equal(h.quest.getStage(p), 27, 'ready to accuse');
  h.action(p, N.STRADIUS, 'saoG_F');
  assert.equal(h.quest.getStage(p), 28, 'accusations');
  h.line(p, N.ADALA, "Murder! What a ridiculous assertion! I may be a thief, but I'd never kill someone!");
  assert.equal(h.quest.getStage(p), 30, 'Adala accused');
  h.action(p, N.ADALA, 'fAjuOG');
  h.hooks.onNpcDeath[0]({ npcId: N.ADALA_5, killer: p });
  assert.equal(h.quest.getStage(p), 32, 'Adala fight won');
  assert.equal(p.varbits.get(11229), 1, 'fight outcome');
  h.action(p, N.ADALA, 'k5CJTB');
  assert.equal(h.quest.getStage(p), 33, 'Adala escorted away');
  h.action(p, N.ADALA, 'QJgNYI');
  assert.equal(h.quest.getStage(p), 34, 'theatre transition');
  h.object(p, O.LOOSE_ROCKS_2);
  assert.equal(h.quest.getStage(p), 36, 'cliff path');
  h.line(p, N.COSTUMER, 'Go ahead.');
  assert.equal(h.quest.getStage(p), 38, 'backstage');
  h.object(p, O.BOOKSHELF_397);
  h.object(p, O.COSTUME_RACK);
  h.object(p, O.CRATE_341);
  h.action(p, N.COSTUMER, 'SAM47H');
  for (const text of [
    "I don't think so. I suppose I do get quite engrossed in my work sometimes, so it's not impossible. But I'm sure I'd have spotted someone going up the stairs...",
    'Ah, that was a gift from Constantinius. We were having a bit of a rat problem, so he gave us the poison to deal with them.',
    'Interesting...',
    'This is an old villa. Apparently it once played a role in some smuggling operations a long time ago. I could see them having a few secrets to help them with that.',
  ]) h.line(p, N.COSTUMER, text);
  assert.equal(h.quest.getStage(p), 40, 'backstage clues');
  h.line(p, N.HUTZA, 'But did you find anything that could tell us who did it?');
  assert.equal(p.varbits.get(11257), 1, 'final accusation intro');
  h.line(p, N.STRADIUS, "Well then we'll have to just speed things along a bit. I'm going out there!");
  assert.equal(h.quest.getStage(p), 42, 'on stage');
  h.action(p, N.STRADIUS, 'lPk2UZ');
  const naiatli = h.npcs.find(npc => npc.id === N.NAIATLI && !npc.removed);
  const clodius = h.npcs.find(npc => npc.id === N.CLODIUS && !npc.removed);
  assert.ok(naiatli && clodius, 'stage actors spawn');
  assert.equal(naiatli.owner, p); assert.equal(naiatli.ownerOnly, true, 'Naiatli is owner-scoped');
  assert.equal(clodius.owner, p); assert.equal(clodius.ownerOnly, true, 'Clodius is owner-scoped');
  h.line(p, N.NAIATLI, "Argh! You're stronger than I thought... I need to regroup!");
  assert.equal(h.quest.getStage(p), 45, 'Naiatli regroups');
  h.line(p, N.CLODIUS, 'Aha, villain! This is where you fall!');
  assert.equal(p.varbits.get(11258), 2, 'trap');
  h.action(p, N.CLODIUS, '-7LlHY');
  h.action(p, N.NAIATLI, 'Ek_VQn');
  h.action(p, N.NAIATLI, 'SWcdkt');
  h.line(p, N.CONSTANTINIUS, 'Bravo!');
  assert.equal(p.varbits.get(11258), 6, 'final blow');
  h.action(p, N.NAIATLI, 'wdaiPu');
  assert.equal(h.quest.getStage(p), 49, 'case closed');
  assert.equal(h.npcs.some(npc => npc.id === N.NAIATLI && !npc.removed), false, 'stage actors are released at the handoff');
  assert.equal(h.npcs.some(npc => npc.id === N.CLODIUS && !npc.removed), false, 'Clodius is released at the handoff');
  h.line(p, N.HUTZA, 'You win some and you lose some I guess. All the best, [player name]!');
  assert.equal(h.quest.getStage(p), 50, 'complete');
  assert.deepEqual(p.xp.map(([, amount]) => amount), [10000, 7500, 5000]);
});

test('DOTI wardrobe gives the captured stolen uniform (29916/29918) and its box matches', () => {
  const { h, p } = doti();
  h.quest.setStage(p, 6);
  const event = h.object(p, O.WARDROBE_59);
  assert.equal(event.handled, true);
  assert.equal(p.inventory.getAmount(I.BUTLERS_UNIFORM_3), 1, 'top 29916');
  assert.equal(p.inventory.getAmount(I.BUTLERS_UNIFORM_5), 1, 'bottom 29918');
  assert.equal(p.inventory.getAmount(I.BUTLERS_UNIFORM), 0, 'not the villa top 29914');
  assert.equal(p.inventory.getAmount(I.BUTLERS_UNIFORM_2), 0, 'not the villa bottom 29915');
  const box = h.action(p, N.PATZI, '0NeKgL');
  assert.deepEqual(box.box.items, [I.BUTLERS_UNIFORM_3, I.BUTLERS_UNIFORM_5]);

  const full = doti();
  full.h.quest.setStage(full.p, 6);
  for (let slot = 0; slot < 28; slot++) full.p.inventory.getItems()[slot] = new core.Item(995, 100);
  assert.equal(full.p.inventory.getFreeSlots(), 0);
  const blocked = full.h.object(full.p, O.WARDROBE_59);
  assert.equal(blocked.handled, true);
  assert.ok(full.p.messages.includes('You need two free inventory spaces.'));
  assert.equal(full.p.inventory.getAmount(I.BUTLERS_UNIFORM_3), 0, 'does not mint a uniform into a full bag');
});

function evidenceFlags(p) {
  for (const key of ['pickpocket.adala', 'pickpocket.cozyac', 'pickpocket.pavo', 'pickpocket.xocotla',
    'inspected.labels', 'inspected.letter', 'inspected.flask', 'inspected.contract']) {
    p.attrs.set('quest.death_on_the_isle.' + key, true);
  }
}

test('DOTI player-scoped bookshelf resolves 54734 to the cache Search locs 54726/54727', () => {
  const { h, p } = doti();
  h.quest.setStage(p, 36);
  const shelf = h.objects.find(object => object.getId() === 54734);
  assert.ok(shelf, 'the 54734 player-scoped bookshelf is registered');
  assert.equal(shelf.getOwner(), p);
  const closed = ObjectDefinition.forPlayer(54734, p);
  assert.equal(closed.id, 54726, 'clue varbit 0 resolves the closed Search bookshelf');
  assert.equal(closed.getName(), 'Bookshelf');
  assert.equal(closed.getInteractions()[0], 'Search');
  (h.hooks.onObjectInteraction ?? []).forEach(fn => fn({
    player: p, object: shelf, definition: closed, objectId: shelf.getId(), clickType: 1, option: 'search',
  }));
  assert.equal(p.attrs.get('quest.death_on_the_isle.backstage.bookshelf'), true);
  assert.equal(p.varbits.get(11250), 1);
  const open = ObjectDefinition.forPlayer(54734, p);
  assert.equal(open.id, 54727, 'clue varbit 1 resolves the open Search bookshelf');
  assert.equal(open.getInteractions()[0], 'Search');
});

test('DOTI evidence hand-in is safe in a full bag and the box shows labels + flask', () => {
  const { h, p } = doti();
  h.quest.setStage(p, 26);
  for (const id of [I.WINE_LABELS, I.THREATENING_NOTE, I.DRINKING_FLASK, I.SHIPPING_CONTRACT]) p.inventory.adds(id, 1);
  for (let slot = 4; slot < 28; slot++) p.inventory.getItems()[slot] = new core.Item(995, 100);
  assert.equal(p.inventory.getFreeSlots(), 0);
  const event = h.action(p, N.STRADIUS, 'JwtSTS');
  assert.deepEqual(event.box.items, [I.WINE_LABELS, I.DRINKING_FLASK]);
  assert.equal(p.varbits.get(11233), 1, 'given items flag');
  for (const id of [I.WINE_LABELS, I.THREATENING_NOTE, I.DRINKING_FLASK, I.SHIPPING_CONTRACT]) {
    assert.equal(p.inventory.getAmount(id), 0, `evidence ${id} delivered`);
  }

  const missing = doti();
  missing.h.quest.setStage(missing.p, 26);
  for (const id of [I.WINE_LABELS, I.THREATENING_NOTE, I.DRINKING_FLASK]) missing.p.inventory.adds(id, 1);
  missing.h.action(missing.p, N.STRADIUS, 'JwtSTS');
  assert.equal(missing.p.varbits.get(11233), undefined, 'no hand-in with a missing item');
  assert.equal(missing.p.inventory.getAmount(I.WINE_LABELS), 1, 'remaining evidence is not removed');
  assert.equal(missing.p.inventory.getAmount(I.THREATENING_NOTE), 1);
  assert.equal(missing.p.inventory.getAmount(I.DRINKING_FLASK), 1);
});

test('DOTI guards only offer the hand-in menu while all four evidence items are held', () => {
  const { h, p } = doti();
  h.quest.setStage(p, 26);
  evidenceFlags(p);
  h.npc(p, N.STRADIUS, 'Talk-to');
  assert.ok(p.log.some(row => row[0] === 'text' && row[1].includes('How is your pocket checking going?')),
    'a destroyed item routes back to the pocket-check line');
  for (const id of [I.WINE_LABELS, I.THREATENING_NOTE, I.DRINKING_FLASK, I.SHIPPING_CONTRACT]) p.inventory.adds(id, 1);
  p.manager.reset(); p.log.length = 0;
  h.npc(p, N.STRADIUS, 'Talk-to');
  assert.ok(p.log.some(row => row[0] === 'text' && row[1].includes("I've had a little look through some pockets")),
    'all four held opens the hand-in conversation');

  const handed = doti();
  handed.h.quest.setStage(handed.p, 26);
  evidenceFlags(handed.p);
  handed.p.attrs.set('quest.death_on_the_isle.given', true);
  handed.h.npc(handed.p, N.STRADIUS, 'Talk-to');
  assert.ok(handed.p.log.some(row => row[0] === 'text' && row[1].includes("I've had a little look through some pockets")),
    'an interrupted hand-in still resumes the hand-over conversation without the items');
});

test('DOTI destroyed evidence is re-stolen from the same suspect (inventory check, not flags)', () => {
  const { h, p } = doti();
  h.quest.setStage(p, 26);
  evidenceFlags(p);
  h.npc(p, N.ADALA_4, 'Pickpocket');
  assert.equal(p.text, "You pull some wine labels out of Adala's pocket.");
  p.manager.reset(); p.messages.length = 0;
  p.inventory.adds(I.WINE_LABELS, 1);
  h.npc(p, N.ADALA_4, 'Pickpocket');
  assert.ok(p.messages.includes("There doesn't seem to be anything of note in Adala's pocket."),
    'holding the item selects the again variant');
});

test('DOTI stage 33 interruption: a guard re-talk replays the departure and reaches the theatre', () => {
  const { h, p } = doti();
  h.quest.setStage(p, 33);
  h.npc(p, N.HUTZA, 'Talk-to');
  h.continueUntil(p, () => h.quest.getStage(p) === 34);
  assert.equal(h.quest.getStage(p), 34, 'the interrupted escort resumes at the departure message');
  assert.ok(p.messages.includes('The others depart for the theatre.'), 'the departure message is sent');
});

test('DOTI stage 49 interruption: a guard re-talk replays the wrap-up and completes the quest', () => {
  const { h, p } = doti();
  h.quest.setStage(p, 49);
  h.npc(p, N.HUTZA, 'Talk-to');
  h.continueUntil(p, () => h.quest.getStage(p) === 50);
  assert.equal(h.quest.getStage(p), 50, 'the interrupted wrap-up completes the quest');
});

test('DOTI post-quest Head Butler replacement gives another mask and tray', () => {
  const { h, p } = doti();
  h.quest.setStage(p, 50);
  h.npc(p, N.HEAD_BUTLER, 'Talk-to');
  assert.ok(p.log.some(row => row[0] === 'text' && row[1].includes('After all that')),
    'the post-quest equipment menu is offered');
  h.action(p, N.HEAD_BUTLER, 'pn24Ai');
  h.action(p, N.HEAD_BUTLER, 'pn24Ai');
  assert.equal(p.inventory.getAmount(I.RAM_MASK), 2, 'a second mask can be claimed');
  h.action(p, N.HEAD_BUTLER, '82ODj5');
  h.action(p, N.HEAD_BUTLER, '82ODj5');
  assert.equal(p.inventory.getAmount(I.BUTLERS_TRAY), 2, 'multiple canonical trays can be claimed');
});

test('DOTI doti multi-NPC parents hand off to the handler ids at their stages', () => {
  const { h, p } = doti();
  const cases = [
    [14065, 2, N.PATZI], [14066, 14, N.PATZI], [14066, 26, N.PATZI_2], [14066, 27, N.PATZI],
    [14069, 0, N.ADALA_3], [14070, 20, N.ADALA], [14070, 26, N.ADALA_4], [14070, 27, N.ADALA],
    [14071, 28, N.ADALA], [14086, 10, N.HEAD_BUTLER], [14087, 20, N.HEAD_BUTLER],
    [14089, 20, N.STRADIUS], [14090, 22, N.STRADIUS], [14091, 28, N.STRADIUS], [14092, 34, N.STRADIUS],
    [14093, 20, N.HUTZA], [14094, 22, N.HUTZA], [14095, 28, N.HUTZA], [14096, 34, N.HUTZA],
    [14097, 38, N.COSTUMER], [14098, 19, N.MAN_41], [14098, 21, N.COL_00FFFF_LIVIUS_COL],
  ];
  for (const [parent, stage, expected] of cases) {
    p.varbits.set(11210, stage);
    const resolved = core.CacheDefinitions.resolveNpc(parent, p.getPacketSender());
    assert.equal(resolved?.id, expected, `parent ${parent} at doti stage ${stage}`);
  }
  void h;
});
