// From server/: node --test tests/qh728-q018.test.cjs (after yarn build).
// Death to the Dorgeshuun: dispatches the registered NPC/object/action/zone
// handlers for the Quest Helper loadSteps route. Fixture stages are labelled;
// these prove handler contracts, not a natural playthrough.
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
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
let nextIndex = 1;
const noop = () => {};
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, '..')); new NpcDefinitionLoader().load(); });

const PAGE = 'Death to the Dorgeshuun';
const STAGE_KEY = 'quest.death_to_the_dorgeshuun.stage';
const BITS_KEY = 'quest.death_to_the_dorgeshuun.bits';
const GUARDS_KEY = 'quest.death_to_the_dorgeshuun.guards';
const START_HOOK = 'quest:death-to-the-dorgeshuun:start';
const BIT_TALKED_GUARD = 1 << 5;
const BIT_TALKED_JOHANHUS = 1 << 6;
const BIT_TRAPDOOR = 1 << 7;
const BIT_CRATE = 1 << 12;

function harness() {
  const hooks = {}, events = {}, tasks = [], zones = [], objects = [], npcs = [], removed = [];
  const objectManager = { register: object => objects.push(object), deregister: object => { const i = objects.indexOf(object); if (i >= 0) objects.splice(i, 1); } };
  const taskManager = { submit(task) { task.setRunning(true); tasks.push(task); }, cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); } };
  const api = new Proxy({
    core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: taskManager,
      MultiChatboxPrompt: { getPending: p => p.prompt }, ObjectManager: objectManager },
    getTaskManager: () => taskManager,
    registerArea: noop,
    getObjectManager: () => objectManager,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    persistAttribute: noop,
    onNpcInteraction: (name, actions) => { for (const fn of Object.values(actions)) (hooks.onNpcInteraction ??= []).push(fn); },
    onObjectInteraction: (first, actions) => {
      const list = typeof first === 'function' ? [first] : Object.values(actions ?? {});
      for (const fn of list) (hooks.onObjectInteraction ??= []).push(fn);
    },
    onZoneEnter: (zone, fn) => zones.push({ zone, fn }),
    onPlayerLogin: fn => (hooks.onPlayerLogin ??= []).push(fn),
    onPlayerLogout: fn => (hooks.onPlayerLogout ??= []).push(fn),
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z), area = null;
      const npc = { ...definition, getId: () => definition.id, index: nextIndex++, getLocation: () => location, moveTo: to => { location = to; },
        getArea: () => area, setArea: value => { area = value; }, isRegistered: () => !npc.removed, setPositionToFace: noop,
        performAnimation: noop, showHitsplat: noop, getMovementQueue: () => ({ addSteps: to => { npc.walkingTo = to; } }),
        getOwner: () => definition.owner, getCombat: () => ({ attack: player => { npc.target = player; }, reset: noop }) };
      npcs.push(npc); return npc;
    },
    removeNpc: npc => { npc.removed = true; removed.push(npc); },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require('../plugins/quests/quests/DeathToTheDorgeshuun.Quest')(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) { const answer = fn(event); if (answer !== null && answer !== undefined) return answer; }
    return null;
  };
  const h = { api, hooks, events, tasks, zones, objects, npcs, removed,
    quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    action(p, npcId, stepId) { const event = { player: p, npcId, stepId, pages: [{ page: PAGE }] }; h.emit('npc-dialogue:action', event); return event; },
    npc(p, npcId, option = 'Talk-to') { const event = { player: p, npcId, clickType: 1, definition: { getActions: () => [option] } }; (hooks.onNpcInteraction ?? []).forEach(fn => fn(event)); return event; },
    object(p, objectId) { const event = { player: p, objectId, definition: { id: objectId }, handled: false }; (hooks.onObjectInteraction ?? []).forEach(fn => fn(event)); return event; },
    zoneAt(x, y) { return zones.find(({ zone }) => x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY); },
    login(p) { (hooks.onPlayerLogin ?? []).forEach(fn => fn({ player: p })); },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
    clearChat(p) { p.manager.reset(); p.prompt = null; },
  };
  return h;
}

function container(size) {
  let items = Array.from({ length: size }, () => new core.Item(-1, 0));
  return { getItems: () => items, setItems: next => { items = next; }, refreshItems: noop,
    get: slot => items[slot],
    getAmount: id => items.filter(item => item.getId() === id).reduce((n, item) => n + item.getAmount(), 0),
    getFreeSlots: () => items.filter(item => item.getId() < 0).length,
    isFull: () => items.every(item => item.getId() >= 0), full: noop,
    adds(id, amount) { const i = items.findIndex(item => item.getId() < 0); assert.ok(i >= 0, 'inventory full'); items[i] = new core.Item(id, amount); },
    deleteNumber(id, amount) { const i = items.findIndex(item => item.getId() === id); assert.ok(i >= 0, `missing item ${id}`); items[i] = new core.Item(-1, 0); },
  };
}

function player(stage = 0) {
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
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]), getMaxLevel: () => 99, getCurrentLevel: () => 99 }),
    getMovementQueue: () => ({ reset() { return this; }, addSteps(to) { location = to; return this; }, setBlockMovement() { return this; } }),
    getLocation: () => location, moveTo: to => { location = to; }, getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; },
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true, getUsername: () => 'q018', getIndex: () => p.index,
    setUntargetable: noop, setPositionToFace: noop, performAnimation: noop, sendMessage: value => messages.push(value),
    getCombat: () => ({ reset: noop }), getHitpoints: () => 99,
  };
  manager = new DialogueManager(p);
  Object.defineProperty(p, 'text', { get: () => text, set: value => { text = value; } });
  Object.defineProperty(p, 'prompt', { get: () => prompt, set: value => { prompt = value; } });
  Object.defineProperty(p, 'manager', { get: () => manager });
  attrs.set(STAGE_KEY, stage);
  return p;
}

function dttd(stage = 0) {
  const h = harness(), p = player(stage);
  (h.events['quest:is-complete'] ??= []).push(event => {
    if (event.key === 'the_lost_tribe') event.complete = true;
    if (event.key === 'giant_dwarf') event.complete = false;
  });
  return { h, p };
}

function giveHamSet(p, amount = 1) {
  for (const id of [I.HAM_SHIRT, I.HAM_ROBE, I.HAM_HOOD, I.HAM_CLOAK, I.HAM_LOGO, I.HAM_GLOVES, I.HAM_BOOTS]) {
    for (let n = 0; n < amount; n++) p.inventory.adds(id, 1);
  }
}

function wearHam(p) {
  const worn = [[core.Equipment.HEAD_SLOT, I.HAM_HOOD], [core.Equipment.BODY_SLOT, I.HAM_SHIRT],
    [core.Equipment.LEG_SLOT, I.HAM_ROBE], [core.Equipment.HANDS_SLOT, I.HAM_GLOVES],
    [core.Equipment.FEET_SLOT, I.HAM_BOOTS], [core.Equipment.CAPE_SLOT, I.HAM_CLOAK],
    [core.Equipment.AMULET_SLOT, I.HAM_LOGO]];
  for (const [slot, id] of worn) p.equipment.getItems()[slot] = new core.Item(id, 1);
}

test('q018 fresh stage 0 starts with The Lost Tribe alone and transmits wire 1', () => {
  const { h, p } = dttd(0);
  h.npc(p, N.MISTAG_4, 'Talk-to');
  assert.equal(p.messages.some(m => /Giant Dwarf/.test(m)), false, 'The Giant Dwarf is not a requirement');
  assert.ok(p.manager.getCurrent() || /favour|Dorgeshuun/i.test(p.text ?? ''), 'the Mistag start conversation is offered');
  h.emit('npc-dialogue:hook', { player: p, hook: START_HOOK, npcId: N.MISTAG_4 });
  assert.equal(h.quest.getStage(p), 1);
  assert.equal(p.varbits.get(2258), 1, 'dttd_main wire value for started');
});

test('q018 robe hand-in consumes one set and moves to the tour wire value 3', () => {
  const { h, p } = dttd(1);
  giveHamSet(p, 2);
  h.action(p, N.ZANIK, 'ottYm8');
  assert.equal(h.quest.getStage(p), 2, 'tour starts');
  assert.equal(p.varbits.get(2258), 3, 'Quest Helper tour stage');
  for (const id of [I.HAM_SHIRT, I.HAM_ROBE, I.HAM_HOOD, I.HAM_CLOAK, I.HAM_LOGO, I.HAM_GLOVES, I.HAM_BOOTS]) {
    assert.equal(p.inventory.getAmount(id), 1, `one ${id} remains`);
  }
  const one = dttd(1);
  giveHamSet(one.p, 1);
  one.h.action(one.p, N.ZANIK, 'ottYm8');
  assert.equal(one.h.quest.getStage(one.p), 1, 'one set is not enough');
  assert.equal(one.p.inventory.getAmount(I.HAM_SHIRT), 1, 'robes are not taken without two sets');
});

test('q018 five gated tour stops enable the mark story and move the wire to 4', () => {
  const { h, p } = dttd(2);
  for (const npcId of [N.DUKE, N.MAN, N.FATHER_AERECK, N.GOBLIN, N.SHOP_KEEPER]) { h.npc(p, npcId); h.clearChat(p); }
  assert.equal(p.attrs.get(BITS_KEY) & 0b11111, 0b11111, 'Duke, citizen, Aereck, goblin and shop bits');
  assert.equal(PluginManager.emitNpcDialogueCondition({ player: p, stepId: '1Ciw7b', pages: [{ page: PAGE }] }), true,
    'the mark story is offered once all five stops are done');
  h.emit('npc-dialogue:condition', { player: p, stepId: '1Ciw7b' });
  assert.equal(h.quest.getStage(p), 3);
  assert.equal(p.varbits.get(2258), 4, 'Quest Helper infiltrate-H.A.M. stage');

  const early = dttd(2);
  early.h.npc(early.p, N.DUKE);
  assert.equal(PluginManager.emitNpcDialogueCondition({ player: early.p, stepId: '1Ciw7b', pages: [{ page: PAGE }] }), false,
    'the mark story is withheld until every stop is done');
});

test('q018 hidden trapdoor zone is at the cache tile 3166,9622 and runs deacon then rubble', () => {
  const { h, p } = dttd(4);
  p.attrs.set(BITS_KEY, BIT_TALKED_GUARD | BIT_TALKED_JOHANHUS);
  const covering = h.zones.filter(({ zone }) => 3166 >= zone.minX && 3166 <= zone.maxX && 9622 >= zone.minY && 9622 <= zone.maxY);
  const hit = covering.find(({ zone }) => zone.minX === 3162);
  assert.ok(hit, 'the rubble zone covers the cache hidden-trapdoor tile');
  assert.equal(covering.some(({ zone, fn }) => fn === hit.fn && 3160 >= zone.minX && 3160 <= zone.maxX && 9632 >= zone.minY && 9632 <= zone.maxY), false,
    'the old off-cache tile is not the rubble trigger');
  hit.fn({ player: p });
  assert.ok(p.manager.getCurrent(), 'the H.A.M. deacon leg starts first');
  assert.equal(h.quest.getStage(p), 4, 'trapdoor is not advanced until the deacon chat ends');
  h.clearChat(p); h.tick(3);
  assert.equal(h.quest.getStage(p), 5, 'rubble is discovered after the deacon');
  assert.equal(p.varbits.get(2258), 5);
  assert.ok((p.attrs.get(BITS_KEY) & BIT_TRAPDOOR) !== 0, 'trapdoor bit set');
});

test('q018 listen-at quest doors 15757/15758 advance caught -> jailed', () => {
  const { h, p } = dttd(5);
  p.attrs.set(GUARDS_KEY, 5);
  const door = h.object(p, O.LARGE_DOOR_51);
  assert.equal(O.LARGE_DOOR_51, 15757);
  assert.equal(door.handled, true);
  assert.equal(h.quest.getStage(p), 6, 'listened and caught');
  assert.equal(p.varbits.get(2258), 5);
  h.clearChat(p); h.tick(3);
  assert.equal(h.quest.getStage(p), 7, 'moved to the jail');
  assert.equal(p.varbits.get(2258), 6);
  assert.equal(p.getLocation().getX(), 3184);
  assert.equal(p.getLocation().getY(), 9612);

  const early = dttd(4);
  early.p.attrs.set(GUARDS_KEY, 5);
  const ignored = early.h.object(early.p, O.LARGE_DOOR_52);
  assert.equal(ignored.handled, false, 'the door is not claimed before the trapdoor stage');
  assert.equal(early.h.quest.getStage(early.p), 4);
});

test('q018 scene objects and the corpse use the cache/Quest Helper tiles', () => {
  const { h, p } = dttd(7);
  h.login(p);
  const at = (id, x, y) => h.objects.some(object => object.getId() === id && object.getLocation().getX() === x && object.getLocation().getY() === y);
  assert.ok(at(15755, 3166, 9622), 'hidden trapdoor at 3166,9622');
  assert.ok(at(15753, 3230, 3286), 'mill trapdoor at 3230,3286');
  assert.ok(at(15748, 3217, 9706), 'tunnel object is registered');
  h.npc(p, N.JIMMY_THE_CHISEL, 'Talk-to');
  h.clearChat(p); h.tick(3);
  assert.equal(p.getLocation().getX(), 3160);
  assert.equal(p.getLocation().getY(), 3246);
  assert.ok(at(15711, 3161, 3246), 'Zanik corpse outside the H.A.M. base');
});

test('q018 corpse/body/tears item operations are gated by free slots and consume the body', () => {
  const { h, p } = dttd(7);
  for (const item of p.inventory.getItems()) void item;
  for (let slot = 0; slot < 28; slot++) p.inventory.getItems()[slot] = new core.Item(995, 1);
  h.action(p, N.ZANIK, '8TfJKO');
  assert.equal(p.inventory.getAmount(I.ZANIK), 0, 'no body into a full bag');
  assert.equal(h.quest.getStage(p), 7, 'stage unchanged when the body cannot be taken');
  p.inventory.getItems()[0] = new core.Item(-1, 0);
  h.action(p, N.ZANIK, '8TfJKO');
  assert.equal(p.inventory.getAmount(I.ZANIK), 1);
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(p.varbits.get(2258), 6);
  h.action(p, N.JUNA, 'wton67');
  assert.equal(p.inventory.getAmount(I.ZANIK), 0, 'body laid before Juna');
  assert.equal(h.quest.getStage(p), 9);
  assert.equal(p.varbits.get(2258), 7);
  h.action(p, N.JUNA, '4x-Og3');
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(p.varbits.get(2258), 8);
});

test('q018 mill crate route, Sigmund, machine and tunnel complete once', () => {
  const { h, p } = dttd(10);
  h.login(p);
  h.npc(p, N.ZANIK);
  assert.ok(p.manager.getCurrent(), 'Zanik is talked to after the revival');
  h.clearChat(p);
  wearHam(p);
  p.inventory.adds(I.CRATE_WITH_ZANIK, 1);
  p.attrs.set(BITS_KEY, p.attrs.get(BITS_KEY) | BIT_CRATE);
  h.object(p, O.TRAPDOOR_65);
  assert.equal(h.quest.getStage(p), 11);
  assert.equal(p.varbits.get(2258), 10);
  assert.equal(p.inventory.getAmount(I.CRATE_WITH_ZANIK), 0, 'crate consumed in the cellar');
  assert.ok(h.npcs.some(npc => npc.id === N.SIGMUND_2 && !npc.removed), 'cellar Sigmund spawns');
  h.clearChat(p); h.tick(2);
  h.hooks.onNpcDeath[0]({ npcId: N.SIGMUND_2, killer: p });
  assert.equal(h.quest.getStage(p), 12);
  assert.equal(p.varbits.get(2258), 11);
  h.object(p, O.DRILLING_MACHINE);
  assert.equal(h.quest.getStage(p), 13);
  assert.equal(p.varbits.get(2258), 12);
  h.object(p, O.TUNNEL_17);
  h.action(p, N.ZANIK, 'WqL2SU');
  assert.equal(h.quest.getStage(p), 14);
  assert.equal(p.varbits.get(2258), 13, 'dttd_main completion value');
  assert.deepEqual(p.xp, [[core.Skill.THIEVING.getIndex(), 2000], [core.Skill.RANGED.getIndex(), 2000]]);
  assert.equal(p.attrs.get('quest.points'), 1);
  h.action(p, N.ZANIK, 'WqL2SU');
  assert.equal(p.xp.length, 2, 'no duplicate reward');
  assert.equal(p.attrs.get('quest.points'), 1);
});

test('q018 persisted stages keep their saves and replay the mapped dttd_main wire value', () => {
  const { h, p } = dttd(0);
  const wire = [0, 1, 3, 4, 4, 5, 5, 6, 6, 7, 8, 10, 11, 12, 13];
  for (let stage = 0; stage < wire.length; stage++) {
    h.quest.setStage(p, stage);
    assert.equal(h.quest.getStage(p), stage, `saved stage ${stage} unchanged`);
    assert.equal(p.varbits.get(2258), wire[stage], `wire value for stage ${stage}`);
  }
  h.quest.setStage(p, 11);
  p.varbits.clear();
  runtime.sendQuestVarps({ player: p });
  assert.equal(h.quest.getStage(p), 11, 'relogin keeps the durable stage');
  assert.equal(p.varbits.get(2258), 10, 'relogin replays the mapped wire value');
});

test('q018 registration dispatch covers the shared NPC boundary and early talks', () => {
  const { h, p } = dttd(4);
  p.moveTo(new core.Location(3218, 9620, 0));
  wearHam(p);
  h.npc(p, N.ZANIK_6, 'Talk-to');
  assert.ok(p.manager.getCurrent() || /H.A.M.|hideout|planning/i.test(p.text ?? ''), 'cellar Zanik is owned while infiltrating');
  h.clearChat(p);
  const outside = dttd(4);
  outside.p.moveTo(new core.Location(3220, 3220, 0));
  outside.h.npc(outside.p, N.ZANIK_6, 'Talk-to');
  assert.ok(!outside.p.manager.getCurrent(), 'out-of-zone 4506 is left to other quests');
  assert.equal(outside.h.quest.getStage(outside.p), 4);
});
