// From server/: node --test tests/remaining-goblin-glouphrie-parity.test.cjs (after yarn build).
// Route and stage values cross-checked against RuneLite Quest Helper pinned 06da90f9
// (LandOfTheGoblins.java and thepathofglouphrie/) and cache varbits 13599 / 15288.
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
const { createQuestScenes } = require('../plugins/quests/QuestScenes');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
let nextIndex = 1;
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  core.RegionManager.init();
});

test('shared scene controls publish and clear the cinematic marker in step with 542', () => {
  const scenes = createQuestScenes({ core });
  const varbits = new Map();
  const player = () => ({
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() {} }),
    setUntargetable() {},
    getPacketSender: () => ({ sendVarbit(id, value) { varbits.set(id, value); return this; } }),
  });
  const other = new Map();
  const otherPlayer = {
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() {} }),
    setUntargetable() {},
    getPacketSender: () => ({ sendVarbit(id, value) { other.set(id, value); return this; } }),
  };

  const p = player();
  scenes.controls(p, true, true);
  assert.equal(varbits.get(542), 1, 'cinematic sets cutscene_status');
  assert.equal(varbits.get(12139), 1, 'cinematic sets the shared QH marker');

  varbits.clear();
  scenes.controls(p, true);
  assert.equal(varbits.has(542), false, 'non-cinematic controls do not mark a cutscene');
  assert.equal(varbits.has(12139), false, 'non-cinematic controls do not mark a cutscene');

  scenes.controls(p, false);
  assert.equal(varbits.get(542), 0, 'controls off clears cutscene_status');
  assert.equal(varbits.get(12139), 0, 'controls off clears the shared QH marker');

  scenes.controls(otherPlayer, true, true);
  assert.equal(other.get(542), 1);
  assert.equal(other.get(12139), 1);
  assert.equal(varbits.get(542), 0, 'another player does not change the first marker');
  assert.equal(varbits.get(12139), 0, 'another player does not change the first marker');
});

function harness(pluginName, options = {}) {
  const pluginNames = Array.isArray(pluginName) ? pluginName : [pluginName];
  const hooks = {}, events = {}, tasks = [], npcs = [], removed = [], npcActions = new Map(), areas = [];
  const api = new Proxy(
    {
      core: {
        ...core,
        World: { ...core.World, getNpcs: () => npcs },
        TaskManager: {
          submit(task) { task.setRunning(true); tasks.push(task); },
          cancelTasks(key) { tasks.filter((task) => task.key === key).forEach((task) => task.stop()); },
        },
        ...(options.realObjects ? {} : { ObjectManager: { register: noop, deregister: noop, objectsAt: () => [] } }),
      },
      persistAttribute: noop,
      registerArea: (area) => areas.push(area),
      onNpcInteraction: (nameOrHandler, actions) => {
        if (typeof nameOrHandler === 'function') {
          (hooks.onNpcInteraction ??= []).push(nameOrHandler);
          return;
        }
        npcActions.set(nameOrHandler, actions);
        (hooks.onNpcInteraction ??= []).push(...Object.values(actions ?? {}));
      },
      onObjectInteraction: (nameOrHandler, actions) => {
        const handlers = typeof nameOrHandler === 'function' ? [nameOrHandler] : Object.values(actions ?? {});
        (hooks.onObjectInteraction ??= []).push(...handlers);
      },
      onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
      emitCustomEvent: (key, event) => (events[key] ?? []).forEach((fn) => fn(event)),
      sendMultiChatboxPrompt(p, title, ...pairs) {
        p.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
        return true;
      },
      spawnNpc(definition) {
        let location = new core.Location(definition.x, definition.y, definition.z);
        const npc = {
          ...definition,
          index: nextIndex++,
          moved: [],
          getId: () => definition.id,
          getIndex: () => npc.index,
          getLocation: () => location,
          moveTo: (to) => { location = to; },
          exactMove: (to) => { location = to; },
          getOwner: () => definition.owner,
          setAttribute: (key, value) => { npc[key] = value; },
          getAttribute: (key) => npc[key],
          isNpc: () => true,
          isRegistered: () => !npc.removed,
        };
        npcs.push(npc);
        return npc;
      },
      removeNpc: (npc) => { npc.removed = true; removed.push(npc); },
    },
    { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find((arg) => typeof arg === 'function'))) }
  );
  const registeredBefore = runtime.getRegisteredQuests().length;
  for (const name of pluginNames) require(`../plugins/quests/quests/${name}.Quest`)(api);
  const registered = runtime.getRegisteredQuests().slice(registeredBefore);
  const quest = registered.at(-1);
  const h = {
    api, hooks, events, tasks, npcs, removed, npcActions, areas, quest,
    quests: new Map(registered.map((entry) => [entry.key, entry])),
    emit: (name, event) => (events[name] ?? []).forEach((fn) => fn(event)),
    variant(p, npcId) {
      for (const fn of hooks.onNpcDialogueVariant ?? []) {
        const result = fn({ player: p, npcId });
        if (result !== null && result !== undefined) return result;
      }
      return null;
    },
    line(p, npcId, text) {
      const event = { player: p, npcId, text };
      h.emit('npc-dialogue:line', event);
      return event;
    },
    action(p, npcId, stepId) {
      const event = { player: p, npcId, stepId };
      h.emit('npc-dialogue:action', event);
      return event;
    },
    choice(p, npcId, option) {
      const event = { player: p, npcId, option };
      h.emit('npc-dialogue:choice', event);
      return event;
    },
    object(p, id, x, y, clickType = 1, labels = []) {
      const first = x !== undefined ? x : 1647;
      const second = y !== undefined ? y : 4841;
      const event = {
        player: p,
        objectId: id,
        clickType,
        definition: { getActions: () => labels, getInteractions: () => labels },
        location: new core.Location(first, second, 0),
        object: new core.GameObject(id, new core.Location(first, second, 0), 10, 0),
        handled: false,
      };
      for (const fn of hooks.onObjectInteraction ?? []) {
        fn(event);
        if (event.handled) break;
      }
      return event;
    },
    zone(p) { for (const fn of hooks.onZoneEnter ?? []) fn({ player: p }); },
    login(p) { for (const fn of hooks.onPlayerLogin ?? []) fn({ player: p }); },
    tick(count) { while (count-- > 0) [...tasks].forEach((task) => task.tick()); },
    complete(key) {
      (events['quest:is-complete'] ??= []).push((event) => {
        if (event.key === key) event.complete = true;
      });
    },
  };
  return h;
}

function player(overrides = {}) {
  const attrs = new Map(), items = new Map(), varbits = new Map(), messages = [], xp = [], equipment = [], log = [];
  let location = new core.Location(3210, 3220, 0);
  const flags = new Set();
  const movementQueue = {
    points: [],
    size() { return movementQueue.points.length; },
    reset() { movementQueue.points.length = 0; return movementQueue; },
    setBlockMovement(value) { p.blocked = value; return movementQueue; },
    addSteps(step) { movementQueue.points.length = 0; p.moveTo(step); return movementQueue; },
  };
  const p = {
    attrs, items, varbits, messages, xp, equipment, log, flags,
    skills: { 1: 99, 6: 99, 10: 99, 11: 99, 15: 99, 16: 99, 17: 99, 18: 99, 19: 99, 20: 99, 21: 99 },
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    hasFlag: (flag) => flags.has(flag),
    setFlag: (flag, enabled = true) => { if (enabled) flags.add(flag); else flags.delete(flag); return p; },
    removeFlag: (flag) => { flags.delete(flag); return p; },
    getLocation: () => location,
    moveTo: (to) => { location = to; },
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      getFreeSlots: () => 28,
      isFull: () => false,
      adds: (id, amount = 1) => items.set(id, (items.get(id) ?? 0) + amount),
      deleteNumber: (id, amount = 1) => {
        assert.ok((items.get(id) ?? 0) >= amount, `missing item ${id}`);
        items.set(id, (items.get(id) ?? 0) - amount);
      },
    }),
    getEquipment: () => ({ getItems: () => equipment, get: () => null }),
    getMovementQueue: () => movementQueue,
    setUntargetable: (value) => { p.untargetable = value; },
    setNpcTransformationId: (id) => { p.transformId = id; },
    getUpdateFlag: () => ({ flag: () => {} }),
    performGraphic: noop,
    performAnimation: noop,
    getPacketSender: () => {
      const packet = new Proxy({
        sendVarbit: (id, value) => { varbits.set(id, value); return packet; },
        sendConfig: (id, value) => { varbits.set(id, value); return packet; },
        sendSubInterface: (...args) => { log.push(['sendSubInterface', ...args]); return packet; },
        sendInterface: (...args) => { log.push(['sendInterface', ...args]); return packet; },
        closeSubInterface: (...args) => { log.push(['closeSubInterface', ...args]); return packet; },
        sendCameraMoveTo: (...args) => { log.push(['sendCameraMoveTo', ...args]); return packet; },
        sendCameraLookAt: (...args) => { log.push(['sendCameraLookAt', ...args]); return packet; },
        sendCameraReset: (...args) => { log.push(['sendCameraReset', ...args]); return packet; },
        sendInterfaceRemoval: (...args) => { log.push(['sendInterfaceRemoval', ...args]); return packet; },
      }, { get: (target, key) => target[key] ?? (() => packet) });
      return packet;
    },
    getDialogueManager: () => p.manager,
    getSkillManager: () => ({
      getMaxLevel: (skill) => p.skills[skill.getIndex?.() ?? skill] ?? 99,
      getExperience: () => 0,
      addExperiences: (skill, amount) => xp.push([skill.getIndex?.() ?? skill, amount]),
    }),
    getUsername: () => 'Parity',
    isPlayer: () => true,
    isNpc: () => false,
    isRegistered: () => true,
    sendMessage: (text) => messages.push(text),
    ...overrides,
  };
  p.attrs.set('land-of-the-goblins:migration', 2);
  p.attrs.set('the-path-of-glouphrie:migration', 2);
  p.manager = new DialogueManager(p);
  return p;
}

function object(h, p, id, x = 1647, y = 4841) {
  const event = { player: p, objectId: id, location: { x, y, z: 0 }, object: new core.GameObject(id, new core.Location(x, y, 0), 10, 0) };
  (h.hooks.onObjectInteraction ?? []).forEach((fn) => fn(event));
  return event;
}

function npcInteraction(h, p, npcId, clickType, definition) {
  return npcInteractionWith(h, p, h.npcs.find((n) => n.getId?.() === npcId), clickType, definition);
}

function npcInteractionWith(h, p, npc, clickType, definition) {
  const event = { player: p, npcId: npc?.getId?.(), clickType, definition, npc };
  (h.hooks.onNpcInteraction ?? []).forEach((fn) => fn(event));
  return event;
}

function actions(labels) {
  return { getActions: () => labels };
}

// --- Land of the Goblins ---------------------------------------------------

test('LOTG start requires only Another Slice of H.A.M. and Fishing Contest plus skills', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  h.complete('another_slice_of_ham');
  h.emit('npc-dialogue:hook', { player: p, npcId: N.GRUBFOOT_8, hook: 'quest:land-of-the-goblins:start' });
  assert.equal(h.quest.getStage(p), 0);
  assert.match(p.messages.at(-1), /Fishing Contest/);

  h.complete('fishing_contest');
  p.skills[16] = 37;
  h.emit('npc-dialogue:hook', { player: p, npcId: N.GRUBFOOT_8, hook: 'quest:land-of-the-goblins:start' });
  assert.equal(h.quest.getStage(p), 0);

  p.skills[16] = 38;
  h.emit('npc-dialogue:hook', { player: p, npcId: N.GRUBFOOT_8, hook: 'quest:land-of-the-goblins:start' });
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.varbits.get(13599), 2);
});

test('LOTG early route walks 2 -> 4 -> 6 -> 8 -> 10 through Zanik, Grubfoot and Oldak', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  h.quest.setStage(p, 2);

  assert.equal(h.variant(p, N.ZANIK_17), 'grubfoot-s-dream-talking-to-zanik-oldak');
  assert.equal(h.quest.getStage(p), 4);
  assert.equal(h.variant(p, N.ZANIK_17), 'grubfoot-s-dream-talking-to-zanik-oldak-after-the-cutscene');

  h.action(p, N.ZANIK_17, '5Ck1fo');
  assert.equal(h.quest.getStage(p), 6);
  h.choice(p, N.OLDAK, 'Can you teleport me to the temple again?');
  assert.equal(h.quest.getStage(p), 8);
  h.action(p, N.OLDAK, '8mebE2');
  assert.equal(h.quest.getStage(p), 10);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2617, 9797]);
  p.moveTo(new core.Location(2624, 3393, 0));
  object(h, p, 2);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2617, 9797], 'cave entrance enters the real goblin cave');
});

test('LOTG potion needs no equipment and the temple route reaches freed Zanik', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  h.quest.setStage(p, 12);
  h.line(p, N.MAKEOVER_MAGE_2, 'Can you turn me into a goblin?');
  assert.equal(h.quest.getStage(p), 14);
  h.line(p, N.MAKEOVER_MAGE_2, 'You need to add some pharmakos berries to the potion.');
  assert.equal(h.quest.getStage(p), 16);

  p.equipment.push({ getId: () => I.GOBLIN_MAIL });
  const inventory = p.getInventory();
  inventory.adds(I.GOBLIN_POTION_4_, 1);
  const drink = { player: p, itemId: I.GOBLIN_POTION_4_, option: 'Drink' };
  h.hooks.onItemAction[0](drink);
  assert.equal(h.quest.getStage(p), 16);
  assert.match(p.messages.at(-1), /remove your equipment/);

  p.equipment.length = 0;
  h.hooks.onItemAction[0]({ player: p, itemId: I.GOBLIN_POTION_4_, option: 'Drink' });
  assert.equal(h.quest.getStage(p), 16);
  assert.equal(p.varbits.get(739), undefined);
  p.varbits.clear();
  for (const fn of h.hooks.onInterfaceActionButton ?? []) fn({ player: p, buttonId: (739 << 16) | 21 });
  assert.equal(p.varbits.get(13615), 4);
  for (const fn of h.hooks.onInterfaceActionButton ?? []) fn({ player: p, buttonId: (739 << 16) | 30 });
  assert.equal(h.quest.getStage(p), 18);
  assert.equal(p.varbits.get(13612), 1);
  assert.equal(p.transformId, 11352, 'type 4 goblin appearance');
  assert.equal(p.items.get(I.GOBLIN_POTION_4_), 0, 'confirmed dose is consumed');
  assert.equal(p.items.get(I.GOBLIN_POTION_3_), 1, 'next dose is handed back');

  h.choice(p, N.GOBLIN_GUARD_2, 'Yes, me Barak.');
  assert.equal(h.quest.getStage(p), 20);
  p.moveTo(new core.Location(3744, 4306, 0));
  h.zone(p);
  assert.equal(h.quest.getStage(p), 22);

  object(h, p, core.ObjectIdentifiers.CRATE_284);
  assert.equal(h.quest.getStage(p), 22);
  const prisonVariant = h.variant(p, N.ZANIK_21);
  assert.equal(prisonVariant, 'the-temple-of-tribes-talking-to-zanik');
  assert.equal(h.quest.getStage(p), 24);
  h.action(p, N.ZANIK_21, 'EPc9qL');
  assert.equal(h.quest.getStage(p), 26);
});

test('LOTG potion ignores empty equipment placeholders but refuses a real worn item', () => {
  const h = harness('LandOfTheGoblins');
  const empty = player();
  h.quest.setStage(empty, 16);
  empty.equipment.push(...Array.from({ length: 14 }, () => new core.Item(-1, 0)));
  empty.items.set(I.GOBLIN_POTION_4_, 1);
  h.hooks.onItemAction[0]({ player: empty, itemId: I.GOBLIN_POTION_4_, option: 'Drink' });
  assert.equal(empty.prompt, undefined);
  for (const fn of h.hooks.onInterfaceActionButton ?? []) fn({ player: empty, buttonId: (739 << 16) | 30 });
  assert.equal(h.quest.getStage(empty), 18, 'placeholder equipment does not block the potion');

  const worn = player();
  h.quest.setStage(worn, 16);
  worn.equipment.push(new core.Item(I.GOBLIN_MAIL, 1));
  worn.items.set(I.GOBLIN_POTION_4_, 1);
  h.hooks.onItemAction[0]({ player: worn, itemId: I.GOBLIN_POTION_4_, option: 'Drink' });
  assert.match(worn.messages.at(-1), /remove your equipment/);
  assert.equal(h.quest.getStage(worn), 16, 'a real equipped item still refuses the potion');
});

test('LOTG temple spawns and guard mail use the capture 1694 ids and tiles', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  h.quest.setStage(p, 34);
  h.login(p);

  const tileOf = (id) => {
    const npc = h.npcs.find((entry) => entry.getId?.() === id && entry.owner === p);
    assert.ok(npc, `missing temple spawn ${id}`);
    const location = npc.getLocation();
    return [location.getX(), location.getY()];
  };
  const guards = [
    [N.GUARD_155, 3732, 4320], [N.GUARD_157, 3735, 4329], [N.GUARD_154, 3753, 4329],
    [N.GUARD_152, 3756, 4320], [N.GUARD_153, 3753, 4311], [N.GUARD_156, 3735, 4311],
  ];
  const priests = [
    [N.PRIEST_12, 3724, 4316], [N.PRIEST_16, 3724, 4332], [N.PRIEST_10, 3757, 4340],
    [N.PRIEST_6, 3760, 4319], [N.PRIEST_8, 3761, 4307], [N.PRIEST_14, 3734, 4302],
  ];
  for (const [id, x, y] of [...guards, ...priests]) assert.deepEqual(tileOf(id), [x, y]);

  const condition = h.hooks.onNpcDialogueCondition[0];
  const guardMouths = [
    [3733, 4320], [3736, 4328], [3752, 4328], [3755, 4320], [3752, 4312], [3736, 4312],
  ];
  const mailFor = (guard, mail, fromX, fromY) => {
    p.getEquipment = () => ({ get: () => ({ getId: () => mail }) });
    p.moveTo(new core.Location(fromX, fromY, 0));
    npcInteraction(h, p, guard, 2, actions(['Talk-to', 'Pass']));
    return condition({ player: p, npcId: guard, stepId: 'TTlqPM' });
  };
  const mails = [I.WHITE_GOBLIN_MAIL, I.YELLOW_GOBLIN_MAIL, I.BLACK_GOBLIN_MAIL,
    I.BLUE_GOBLIN_MAIL, I.ORANGE_GOBLIN_MAIL, I.PURPLE_GOBLIN_MAIL];
  guards.forEach(([guard], index) => {
    const [fromX, fromY] = guardMouths[index];
    assert.equal(mailFor(guard, mails[index], fromX, fromY), true, `guard ${guard} accepts its tribe's mail`);
  });
  assert.equal(mailFor(N.GUARD_155, I.BLACK_GOBLIN_MAIL, 3733, 4320), false, 'white guard rejects black mail');

  const passAt = (guard, x, y, mail) => {
    p.getEquipment = () => ({ get: () => ({ getId: () => mail }) });
    p.moveTo(new core.Location(x, y, 0));
    npcInteraction(h, p, guard, 2, actions(['Talk-to', 'Pass']));
    return [p.getLocation().getX(), p.getLocation().getY()];
  };
  const guardTos = [
    [3731, 4320], [3734, 4330], [3754, 4330], [3757, 4320], [3754, 4310], [3734, 4310],
  ];
  guards.forEach(([guard], index) => {
    const [fromX, fromY] = guardMouths[index];
    const [toX, toY] = guardTos[index];
    assert.deepEqual(passAt(guard, fromX, fromY, mails[index]), [toX, toY], `guard ${guard} pass in`);
    assert.deepEqual(passAt(guard, toX, toY, mails[index]), [fromX, fromY], `guard ${guard} pass out`);
    assert.equal(p.flags.has('movement:ignore-clipping'), false, 'scoped flag restored');
  });
  assert.deepEqual(passAt(N.GUARD_154, 3754, 4329, I.BLACK_GOBLIN_MAIL), [3752, 4328],
    'actual cardinal guard approach reverses through the black mouth');
  assert.deepEqual(passAt(N.GUARD_154, 3754, 4329, I.WHITE_GOBLIN_MAIL), [3752, 4328],
    'wrong mail from the cardinal inside approach is thrown out');
  assert.equal(condition({ player: p, npcId: N.GUARD_154, stepId: 'uDN0yd' }), true);
  assert.deepEqual(passAt(N.GUARD_154, 3752, 4329, I.WHITE_GOBLIN_MAIL), [3752, 4329],
    'wrong mail from the outside cardinal approach does not enter');
  assert.deepEqual(passAt(N.GUARD_155, 3733, 4320, I.BLACK_GOBLIN_MAIL), [3733, 4320],
    'denied entry does not move');
  assert.deepEqual(passAt(N.GUARD_155, 3731, 4320, I.BLACK_GOBLIN_MAIL), [3733, 4320],
    'wrong mail exit is thrown out');
  assert.equal(p.flags.has('movement:ignore-clipping'), false, 'scoped clipping flag is restored');

  const done = player();
  h.quest.setStage(done, 56);
  h.login(done);
  assert.ok(h.npcs.some((entry) => entry.getId?.() === N.GUARD_155 && entry.owner === done),
    'completed players still see the temple guards');
  done.getEquipment = () => ({ get: () => ({ getId: () => I.WHITE_GOBLIN_MAIL }) });
  done.moveTo(new core.Location(3733, 4320, 0));
  npcInteraction(h, done, N.GUARD_155, 2, actions(['Talk-to', 'Pass']));
  assert.deepEqual([done.getLocation().getX(), done.getLocation().getY()], [3731, 4320],
    'post-quest pass still crosses without progress');
  assert.equal(h.quest.getStage(done), 56);
});

test('LOTG guard pass restores scoped clipping on walk cancel and logout', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  h.quest.setStage(p, 34);
  h.login(p);
  p.getEquipment = () => ({ get: () => ({ getId: () => I.WHITE_GOBLIN_MAIL }) });
  const pending = { size: () => 1, reset: () => pending, addSteps: noop, setBlockMovement: () => pending };
  p.getMovementQueue = () => pending;
  p.moveTo(new core.Location(3733, 4320, 0));
  npcInteraction(h, p, N.GUARD_155, 2, actions(['Talk-to', 'Pass']));
  assert.equal(p.flags.has('movement:ignore-clipping'), true, 'flag active while queue is pending');
  for (const fn of h.hooks.onWalkRoute ?? []) fn({ player: p });
  assert.equal(p.flags.has('movement:ignore-clipping'), false, 'walk cancel restores the flag');

  p.moveTo(new core.Location(3733, 4320, 0));
  npcInteraction(h, p, N.GUARD_155, 2, actions(['Talk-to', 'Pass']));
  assert.equal(p.flags.has('movement:ignore-clipping'), true);
  for (const fn of h.hooks.onPlayerLogout ?? []) fn({ player: p });
  assert.equal(p.flags.has('movement:ignore-clipping'), false, 'logout restores the flag');
});

test('LOTG Bighead unlocks keys and the six keys open the crypt', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  h.quest.setStage(p, 26);
  assert.equal(h.variant(p, N.HIGH_PRIEST_BIGHEAD), 'the-temple-of-tribes-talking-to-high-priest-bighead');
  assert.equal(h.quest.getStage(p), 28);
  assert.equal(h.variant(p, N.HIGH_PRIEST_BIGHEAD), 'the-temple-of-tribes-talking-to-high-priest-bighead-2');
  h.action(p, N.HIGH_PRIEST_BIGHEAD, 'jarIa4');
  assert.equal(h.quest.getStage(p), 30);
  h.variant(p, N.HIGH_PRIEST_BIGHEAD);
  assert.equal(h.quest.getStage(p), 32);
  h.line(p, N.HIGH_PRIEST_BIGHEAD, 'Crypt door locked by six keys, kept by six tribal priests.');
  assert.equal(h.quest.getStage(p), 34);

  p.varbits.clear();
  h.login(p);
  assert.equal(p.varbits.get(13602), 0, 'whitefish knowledge stays false until Aggie explains it');
  h.line(p, N.AGGIE, 'Hemenster Whitefish?');
  assert.equal(p.varbits.get(13602), 0, 'an unrelated Aggie line does not publish knowledge');
  h.line(p, N.AGGIE, 'Anyway, if you do have something you want the dye removing from, just bring me a Hemenster Whitefish and five coins.');
  assert.equal(p.varbits.get(13602), 1, 'Aggie publishes the native whitefish knowledge bit');
  assert.equal(h.quest.getStage(p), 34, 'whitefish knowledge does not advance the quest');

  h.quest.setStage(p, 32);
  npcInteraction(h, p, N.PRIEST_12, 2, actions(['Talk-to', 'Pickpocket', null, null]));
  assert.equal(p.items.get(I.SARAGORGAK_KEY), undefined, 'keys are not stealable before Bighead explains the crypt');
  h.quest.setStage(p, 34);
  const priestKeys = [
    [N.PRIEST_12, I.SARAGORGAK_KEY, 'white'],
    [N.PRIEST_16, I.YURKOLGOKH_KEY, 'yellow'],
    [N.PRIEST_10, I.HUZAMOGAARB_KEY, 'black'],
    [N.PRIEST_6, I.EKELESHUUN_KEY, 'blue'],
    [N.PRIEST_8, I.NAROGOSHUUN_KEY, 'orange'],
    [N.PRIEST_14, I.HOROGOTHGAR_KEY, 'purple'],
  ];
  for (const [priest, key, tribe] of priestKeys) {
    npcInteraction(h, p, priest, 2, actions(['Talk-to', 'Pickpocket', null, null]));
    assert.equal(p.items.get(key), 1, `${tribe} priest ${priest} gives its own key`);
  }
  npcInteraction(h, p, N.PRIEST_12, 2, actions(['Talk-to', 'Pickpocket', null, null]));
  assert.match(p.messages.at(-1), /already stolen/);

  const keys = [I.SARAGORGAK_KEY, I.YURKOLGOKH_KEY, I.HUZAMOGAARB_KEY, I.EKELESHUUN_KEY, I.NAROGOSHUUN_KEY, I.HOROGOTHGAR_KEY];
  for (const key of keys) p.items.set(key, 1);
  p.attrs.set('quest.land_of_the_goblins.keys', 63);
  const gate = object(h, p, core.ObjectIdentifiers.GATE_231);
  assert.equal(gate.handled, true);
  assert.equal(p.attrs.get('quest.land_of_the_goblins.bits') & (1 << 12), 1 << 12);
  assert.equal(p.getInventory().getAmount(I.SARAGORGAK_KEY), 0);
});

test('LOTG crypt ghosts advance the priest names up to Yu\'biusk', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  h.quest.setStage(p, 38);
  p.attrs.set('quest.land_of_the_goblins.bits', 1 << 12);
  object(h, p, core.ObjectIdentifiers.GRAVE_36);
  h.line(p, N.SNOTHEAD_2, 'Snailfeet. That his name.');
  assert.equal(h.quest.getStage(p), 40);
  h.line(p, N.SNAILFEET_2, 'Mosschin.');
  assert.equal(h.quest.getStage(p), 42);
  h.line(p, N.MOSSCHIN_2, 'Redeyes.');
  assert.equal(h.quest.getStage(p), 44);
  h.line(p, N.REDEYES_2, 'Strongbones. He was a mighty high priest.');
  assert.equal(h.quest.getStage(p), 46);
  h.line(p, N.STRONGBONES_2, 'Yu\'biusk is another plane of existence.');
  assert.equal(h.quest.getStage(p), 48);
});

test('LOTG machine only runs at stage 50 and completes once through the box', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  h.quest.setStage(p, 48);
  object(h, p, core.ObjectIdentifiers.MACHINE_20);
  assert.match(p.messages.at(-1), /not ready/);

  h.line(p, N.OLDAK, 'meet us by the fungus ring');
  assert.equal(h.quest.getStage(p), 50);
  p.varbits.clear();
  h.login(p);
  assert.equal(p.varbits.get(13618), 0, 'machine explanation is false before Oldak explains it');
  assert.equal(p.varbits.get(13611), 0, 'fairy ring is idle before activation');
  h.line(p, N.OLDAK_3, 'Ah, the machine is nearly ready.');
  assert.equal(p.varbits.get(13618), 0, 'the intro line does not publish the explanation');
  h.line(p, N.OLDAK_3, 'The inner circle has a radius of one zurg, the middle circle has a radius of two zurgs, and the outer circle has a radius of three zurgs. You will need to distribute the power in proportion to the area of each circle.');
  assert.equal(p.varbits.get(13618), 1, 'Oldak publishes the machine explanation bit');
  assert.equal(h.quest.getStage(p), 50, 'the explanation does not advance the quest');
  object(h, p, core.ObjectIdentifiers.MACHINE_20);
  assert.ok(p.log.some((row) => row[0] === 'sendSubInterface' && row[1] === ((161 << 16) | 16) && row[2] === 738), 'opens the real 738 relay');
  const press = (child) => {
    for (const fn of h.hooks.onInterfaceActionButton ?? []) fn({ player: p, buttonId: (738 << 16) | child });
  };
  for (let i = 0; i < 9; i++) press(21);
  for (let i = 0; i < 4; i++) press(23);
  press(25);
  assert.deepEqual([p.varbits.get(13603), p.varbits.get(13604), p.varbits.get(13605)], [9, 4, 1]);
  assert.deepEqual([
    p.attrs.get('land-of-the-goblins:machine-1'),
    p.attrs.get('land-of-the-goblins:machine-2'),
    p.attrs.get('land-of-the-goblins:machine-3'),
  ], [9, 4, 1], 'relay values persist for relog');
  press(38);
  assert.ok(p.log.some((row) => row[0] === 'closeSubInterface' && row[1] === ((161 << 16) | 16)));
  assert.equal(p.varbits.get(13611), 1, 'correct relay publishes the animating flag');
  assert.equal(h.quest.getStage(p), 50, 'activation does not advance the stage before arrival');
  h.action(p, N.OLDAK_3, 'UszKmx');
  assert.equal(h.quest.getStage(p), 52);
  assert.equal(p.varbits.get(13611), 2, 'arrival publishes the captured cutscene value');
  assert.ok(p.log.some((row) => row[0] === 'sendCameraMoveTo' && row[1] === 3568 && row[2] === 4366 && row[3] === 450), 'Yu\'biusk camera track');
  h.tick(10);
  assert.equal(p.varbits.get(13611), 0, 'the animating flag clears when the cutscene ends');
  assert.equal(h.quest.getStage(p), 52, 'cutscene cleanup does not advance the quest');
  h.action(p, N.ZANIK_7, 'Eh5lL0');
  assert.equal(h.quest.getStage(p), 54);
  assert.ok(p.log.some((row) => row[0] === 'sendCameraMoveTo' && row[1] === 3546 && row[2] === 4389 && row[3] === 580), 'strange-box camera track');
  h.action(p, N.OLDAK, 'dfkFWY');
  assert.equal(h.quest.getStage(p), 56);
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(h.quest.complete(p), false);
  assert.deepEqual(p.xp.map((entry) => entry[1]), [8000, 8000, 8000, 8000]);
});

test('LOTG dream cutscene drives camera, fade, minimap and interruption cleanup', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  h.quest.setStage(p, 4);
  h.action(p, N.ZANIK_17, 'zSUlVq');
  assert.ok(p.log.some((row) => row[0] === 'sendCameraMoveTo' && row[1] === 3864 && row[2] === 4369 && row[3] === 520));
  assert.ok(p.log.some((row) => row[0] === 'sendSubInterface' && row[2] === 174), 'fade overlay');
  assert.equal(p.varbits.get(6719), 2);
  assert.equal(p.varbits.get(542), 1);
  assert.equal(p.varbits.get(12139), 1, 'shared cinematic marker matches 542');
  assert.equal(h.quest.getStage(p), 4, 'the cinematic marker does not advance the quest');
  assert.equal(p.blocked, true);
  h.tick(5);
  assert.ok(p.log.some((row) => row[0] === 'sendCameraMoveTo' && row[1] === 3868 && row[2] === 4391));
  h.action(p, N.ZANIK_17, 'YUdQ2P');
  assert.ok(p.log.some((row) => row[0] === 'sendCameraReset'));
  assert.equal(p.varbits.get(6719), 0);
  assert.equal(p.varbits.get(542), 0);
  assert.equal(p.varbits.get(12139), 0, 'shared cinematic marker clears with 542');
  assert.equal(h.quest.getStage(p), 4, 'cleanup does not advance the quest');
  assert.equal(p.blocked, false);

  // Logging out mid-scene cancels the camera and re-enables controls.
  h.action(p, N.ZANIK_17, 'zSUlVq');
  for (const fn of h.hooks.onPlayerLogout ?? []) fn({ player: p });
  assert.equal(p.varbits.get(6719), 0);
  assert.equal(p.varbits.get(542), 0);
  assert.equal(p.varbits.get(12139), 0, 'logout clears the shared cinematic marker');
  assert.equal(h.quest.getStage(p), 4, 'logout cleanup does not advance the quest');
  assert.equal(p.blocked, false);
  const before = p.log.length;
  h.tick(8);
  assert.equal(p.log.length, before, 'cutscene timers stop on logout');
});

// --- The Path of Glouphrie ------------------------------------------------

const MONOLITH_INITIAL = [
  { size: 2, x: 2788, y: 4245 },
  { size: 2, x: 2787, y: 4253 },
  { size: 2, x: 2790, y: 4253 },
  { size: 2, x: 2787, y: 4256 },
  { size: 1, x: 2791, y: 4257 },
];

function storeroom(h, p) {
  const byIndex = (index) => h.npcs.find((entry) => entry.owner === p
    && entry.getAttribute?.('the-path-of-glouphrie:monolith') === index);
  const positions = MONOLITH_INITIAL.map((spot, index) => {
    const entry = byIndex(index);
    return entry ? [entry.getLocation().getX(), entry.getLocation().getY()] : [spot.x, spot.y];
  });
  const npc = (index) => {
    const [x, y] = positions[index];
    const entry = byIndex(index);
    return entry && entry.getLocation().getX() === x && entry.getLocation().getY() === y ? entry : undefined;
  };
  return {
    positions,
    npc,
    push(index, playerX, playerY) {
      const entry = npc(index);
      assert.ok(entry, `monolith ${index} at ${positions[index]}`);
      p.moveTo(new core.Location(playerX, playerY, 0));
      npcInteractionWith(h, p, entry, 2, actions(['Talk-to', 'Push', 'Reset']));
      const location = entry.getLocation();
      positions[index] = [location.getX(), location.getY()];
      return entry;
    },
    reset(index = 0) {
      const entry = npc(index);
      assert.ok(entry, 'monolith available for reset');
      npcInteractionWith(h, p, entry, 3, actions(['Talk-to', 'Push', 'Reset']));
      assert.ok(p.prompt?.pairs, 'reset prompt');
      p.prompt.pairs[1]();
      MONOLITH_INITIAL.forEach((spot, position) => { positions[position] = [spot.x, spot.y]; });
    },
  };
}

function chest(h, p, id, x, y) {
  const event = { player: p, objectId: id, location: { x, y, z: 0 } };
  (h.hooks.onObjectInteraction ?? []).forEach((fn) => fn(event));
}

const openShapes = (h, p, x, y) => chest(h, p, core.ObjectIdentifiers.CHEST_235, x, y);
const openKey = (h, p) => chest(h, p, core.ObjectIdentifiers.CHEST_233, 2785, 4261);
const openGolden = (h, p) => chest(h, p, core.ObjectIdentifiers.CHEST_230, 2789, 4258);

function pushQuestSequence(h, p) {
  const monoliths = storeroom(h, p);
  monoliths.push(0, 2789, 4244);
  monoliths.push(1, 2788, 4252);
  monoliths.push(3, 2786, 4255);
  monoliths.push(4, 2791, 4258);
  monoliths.push(3, 2790, 4257);
  monoliths.push(2, 2792, 4254);
  return monoliths;
}

test('POG starts at stage 2 and the storeroom puzzle reaches the machine-ready stage', () => {
  const h = harness('PathOfGlouphrie');
  const p = player();
  ['the_eyes_of_glouphrie', 'waterfall_quest', 'tree_gnome_village'].forEach((key) => h.complete(key));
  h.emit('npc-dialogue:hook', { player: p, npcId: N.KING_BOLREN, hook: 'quest:the-path-of-glouphrie:start' });
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.varbits.get(15288), 2);

  h.line(p, N.KING_BOLREN, 'Did you have a look down in the caves?');
  assert.equal(h.quest.getStage(p), 4);
  h.choice(p, N.GOLRIE, 'I need your help with a device.');
  assert.equal(h.quest.getStage(p), 6);
  assert.equal(h.npcs.filter((entry) => entry.owner === p && [N.COL_00FFFF_BIG_MONOLITH_COL, N.COL_00FFFF_SMALL_MONOLITH_COL].includes(entry.getId?.())).length, 5);
  assert.equal(core.NpcDefinition.forId(N.COL_00FFFF_BIG_MONOLITH_COL).getSize(), 2, 'cache big monolith is 2x2');
  assert.equal(core.NpcDefinition.forId(N.COL_00FFFF_SMALL_MONOLITH_COL).getSize(), 1, 'cache small monolith is 1x1');

  object(h, p, core.ObjectIdentifiers.TUNNEL_59);
  assert.equal(h.quest.getStage(p), 8);
  object(h, p, core.ObjectIdentifiers.LECTERN_16);
  assert.equal(h.quest.getStage(p), 8);
  assert.match(p.messages.at(-1), /blocked by the monoliths/);

  const monoliths = pushQuestSequence(h, p);
  assert.deepEqual(monoliths.positions, [[2788, 4246], [2787, 4254], [2789, 4253], [2787, 4256], [2791, 4256]]);
  assert.equal(h.quest.getStage(p), 12, 'the full captured push sequence completes the puzzle');

  // The chime is made before the diary in the real route; it cannot reach 16 alone.
  p.items.set(I.CRYSTAL_CHIME_SEED, 1);
  for (const fn of h.hooks.onItemOnObject ?? []) fn({ player: p, itemId: I.CRYSTAL_CHIME_SEED, objectId: 49910 });
  assert.ok(p.items.get(I.CRYSTAL_CHIME) >= 1);
  assert.equal(h.quest.getStage(p), 12, 'chime alone does not skip the mandatory diary');

  object(h, p, core.ObjectIdentifiers.LECTERN_16);
  assert.equal(h.quest.getStage(p), 12, 'lectern opens the chapter interface first');
  assert.ok(p.log.some((row) => row[0] === 'sendInterface' && row[1] === 854), 'interface 854 opens');
  const chapter = (child) => {
    for (const fn of h.hooks.onInterfaceActionButton ?? []) fn({ player: p, buttonId: (854 << 16) | child, handled: false });
  };
  chapter(9);
  assert.equal(h.quest.getStage(p), 12, 'chapter 2 is rejected before chapter 1');
  assert.match(p.messages.at(-1), /earlier chapters/);
  chapter(5);
  assert.equal(h.quest.getStage(p), 14);
  assert.equal(p.varbits.get(15291), 1);
  assert.ok(p.log.some((row) => row[0] === 'sendCameraMoveTo' && row[1] === 2528 && row[2] === 3166 && row[3] === 480), 'diary vision camera');
  chapter(5);
  assert.match(p.messages.at(-1), /already read/);
  chapter(9);
  assert.equal(p.varbits.get(15292), 1);
  assert.equal(h.quest.getStage(p), 14, 'chime is ready but the third chapter is still missing');
  chapter(13);
  assert.equal(p.varbits.get(15293), 1);
  assert.equal(h.quest.getStage(p), 16, 'machine-ready only after all three chapters');

  openShapes(h, p, 2791, 4249);
  assert.equal(p.items.get(I.RED_SQUARE), 1);
  p.messages.length = 0;
  openShapes(h, p, 2791, 4249);
  assert.match(p.messages.at(-1), /empty/);
});

test('POG storeroom chests require the actual monolith positions and reset does not reloot', () => {
  const h = harness('PathOfGlouphrie');
  const p = player();
  h.quest.setStage(p, 6);
  h.login(p);
  const monoliths = storeroom(h, p);

  openShapes(h, p, 2791, 4249);
  assert.match(p.messages.at(-1), /monoliths block/, 'first chest needs the southern move');
  assert.equal(p.items.get(I.RED_CIRCLE), undefined);

  // Wrong side: stepping west of the southern 2x2 pushes it east, not south.
  monoliths.push(0, 2787, 4246);
  assert.deepEqual(monoliths.positions[0], [2789, 4245], 'player-side push moves it away');
  openShapes(h, p, 2791, 4249);
  assert.match(p.messages.at(-1), /monoliths block/, 'wrong position does not open the chest');
  monoliths.reset();
  assert.deepEqual(monoliths.positions, MONOLITH_INITIAL.map((spot) => [spot.x, spot.y]), 'reset restores anchors');
  openShapes(h, p, 2791, 4249);
  assert.match(p.messages.at(-1), /monoliths block/, 'reset re-locks the unlooted chest');

  monoliths.push(0, 2789, 4244);
  openShapes(h, p, 2791, 4249);
  assert.equal(p.items.get(I.RED_CIRCLE), 1, 'first chest opens after the southern move');

  openShapes(h, p, 2788, 4262);
  assert.match(p.messages.at(-1), /monoliths block/, 'second chest needs both next moves');
  monoliths.push(1, 2788, 4252);
  monoliths.push(3, 2786, 4255);
  openShapes(h, p, 2788, 4262);
  assert.equal(p.items.get(I.GREEN_SQUARE), 1, 'second chest opens after south-west and north-west east');
  openKey(h, p);
  assert.equal(p.items.get(I.CHEST_KEY_9), 1, 'first key chest follows the second shapes chest');

  openGolden(h, p);
  assert.match(p.messages.at(-1), /monoliths block/, 'golden chest still needs the small and north-west west moves');
  monoliths.push(4, 2791, 4258);
  monoliths.push(3, 2790, 4257);
  openGolden(h, p);
  assert.equal(p.items.get(I.STRONGROOM_KEY), 1, 'golden chest opens after small north and north-west west');
  assert.equal(p.items.get(I.CRYSTAL_CHIME_SEED), 1);
  openShapes(h, p, 2793, 4253);
  assert.equal(p.items.get(I.BLUE_CIRCLE), 1, 'third shapes chest follows the golden chest');
  assert.equal(h.quest.getStage(p), 10, 'third chest does not complete the gate push');

  // Blocking the north-west monolith with the south-west 2x2 must refuse the move.
  const before = [...monoliths.positions[3]];
  monoliths.push(3, 2788, 4258);
  assert.deepEqual(monoliths.positions[3], before, 'blocked push leaves the monolith in place');
  assert.match(p.messages.at(-1), /won't budge/);

  // Reset must not duplicate a looted chest or leave a stale puzzle bit behind.
  p.messages.length = 0;
  p.attrs.set('quest.the_path_of_glouphrie.bits', Number(p.attrs.get('quest.the_path_of_glouphrie.bits')) | (0b1111 << 15));
  monoliths.reset();
  const firstChestBefore = p.items.get(I.RED_CIRCLE);
  openShapes(h, p, 2791, 4249);
  assert.match(p.messages.at(-1), /empty/);
  assert.equal(p.items.get(I.RED_CIRCLE), firstChestBefore, 'reset does not re-grant a looted chest');
  assert.equal(p.attrs.get('quest.the_path_of_glouphrie.bits') & (0b1111 << 15), 0, 'no stale monolith bits');
});

test('POG monolith positions persist across relog and stay owner-local with blocking', () => {
  const h = harness('PathOfGlouphrie');
  const a = player();
  const b = player();
  h.quest.setStage(a, 6);
  h.quest.setStage(b, 6);
  h.login(a);
  h.login(b);
  const first = storeroom(h, a);
  first.push(0, 2789, 4244);
  assert.deepEqual(first.positions[0], [2788, 4246]);

  openShapes(h, a, 2791, 4249);
  assert.equal(a.items.get(I.RED_CIRCLE), 1, 'player A opens after their own push');
  openShapes(h, b, 2791, 4249);
  assert.match(b.messages.at(-1), /monoliths block/, 'player B is unaffected by A');

  for (const fn of h.hooks.onPlayerLogout ?? []) fn({ player: a });
  assert.ok(h.npcs.some((npc) => npc.removed && npc.owner === a), 'owner monoliths despawn on logout');
  h.login(a);
  const relog = storeroom(h, a);
  assert.deepEqual(relog.positions[0], [2788, 4246], 'saved position is restored');
  assert.equal(h.quest.getStage(a), 10);
  openShapes(h, a, 2791, 4249);
  assert.equal(a.items.get(I.RED_CIRCLE), 1, 'first chest still open after relog');

  const area = h.areas.find((candidate) => candidate.constructor.name === 'StoreroomMonolithArea');
  assert.ok(area, 'storeroom collision area registered');
  a.moveTo(new core.Location(2785, 4244, 0));
  area.postEnter(a);
  area.process(a);
  assert.deepEqual([a.getLocation().getX(), a.getLocation().getY()], [2785, 4244]);
  a.moveTo(new core.Location(2788, 4246, 0));
  area.process(a);
  assert.deepEqual([a.getLocation().getX(), a.getLocation().getY()], [2785, 4244], 'A is returned off the monolith tile');
  b.moveTo(new core.Location(2786, 4244, 0));
  area.postEnter(b);
  area.process(b);
  assert.deepEqual([b.getLocation().getX(), b.getLocation().getY()], [2786, 4244], 'B free position is untouched');
});

test('POG machine, creature and Longramble route uses the real stage values', () => {
  const h = harness('PathOfGlouphrie');
  const p = player();
  h.quest.setStage(p, 14);
  object(h, p, core.ObjectIdentifiers.YEWNOCKS_MACHINE_2);
  assert.match(p.messages.at(-1), /dormant/);

  h.quest.setStage(p, 16);
  h.action(p, N.KING_BOLRIE, 'Lv5xyo');
  assert.equal(h.quest.getStage(p), 16, 'completion cutscene needs the birds stage');

  // Open the real machine interface, read its two targets and solve with three discs.
  object(h, p, core.ObjectIdentifiers.YEWNOCKS_MACHINE_2);
  const shown = p.messages.at(-1).match(/shows (\d+) for the first slot and (\d+) for the other two/);
  assert.ok(shown, p.messages.at(-1));
  const target1 = Number(shown[1]);
  const target2 = Number(shown[2]);
  const values = [1, 3, 4, 8, 9, 16];
  let pair = null;
  for (const a of values) for (const b of values) {
    if (a !== b && a !== target1 && b !== target1 && a + b === target2) pair = [a, b];
  }
  assert.ok(pair, `no reachable disc split for ${target2}`);
  const itemByValue = new Map([[1, I.RED_CIRCLE], [3, I.RED_TRIANGLE], [4, I.RED_SQUARE], [8, I.ORANGE_SQUARE], [9, I.YELLOW_TRIANGLE], [16, I.GREEN_SQUARE]]);
  p.items.clear();
  for (const value of [target1, ...pair]) p.items.set(itemByValue.get(value), 1);
  const use = (itemId) => (h.hooks.onItemOnObject ?? []).forEach((fn) => fn({ player: p, itemId, objectId: core.ObjectIdentifiers.YEWNOCKS_MACHINE_2 }));
  for (const value of [target1, ...pair]) use(itemByValue.get(value));
  assert.equal(h.quest.getStage(p), 16, 'inserting discs does not auto-complete the puzzle');
  for (const fn of h.hooks.onInterfaceActionButton ?? []) fn({ player: p, buttonId: (848 << 16) | 26 });
  assert.equal(h.quest.getStage(p), 18);
  assert.ok(p.log.some((row) => row[0] === 'sendCameraMoveTo' && row[1] === 2390 && row[2] === 9819 && row[3] === 370), 'Dumpling reveal camera');
  const evil = h.npcs.find((npc) => npc.getId?.() === N.EVIL_CREATURE_7);
  assert.ok(evil);
  h.api.core.World.getNpcs = () => h.npcs;
  (h.hooks.onNpcDeath ?? []).forEach((fn) => fn({ npc: evil, killer: p }));
  assert.equal(h.quest.getStage(p), 20);
  h.line(p, N.KING_BOLREN, 'Thank you for dealing with that');
  assert.equal(h.quest.getStage(p), 22);
  h.choice(p, N.GIANNE_JNR_, 'I need your help finding a certain gnome.');
  assert.equal(h.quest.getStage(p), 24);
  h.line(p, N.LONGRAMBLE, 'Mr Longramble, I presume?');
  assert.equal(h.quest.getStage(p), 26);
  p.items.set(I.TANGLED_TOADS_LEGS, 1);
  h.action(p, N.LONGRAMBLE, 'fVX5us');
  assert.equal(h.quest.getStage(p), 28);
});

test('POG tree, sewer, birds and final cutscene complete at 50', () => {
  const h = harness('PathOfGlouphrie');
  const p = player();
  p.items.set(I.CRYSTAL_CHIME, 1);
  h.quest.setStage(p, 26);
  const tree = core.ObjectIdentifiers.SPIRIT_TREE_24;
  (h.hooks.onObjectInteraction ?? []).forEach((fn) => fn({ player: p, objectId: tree, location: { x: 2339, y: 3111, z: 0 } }));
  assert.equal(h.quest.getStage(p), 30);
  (h.hooks.onObjectInteraction ?? []).forEach((fn) => fn({ player: p, objectId: tree, location: { x: 2339, y: 3111, z: 0 } }));
  assert.equal(h.quest.getStage(p), 32);
  (h.hooks.onObjectInteraction ?? []).forEach((fn) => fn({ player: p, objectId: tree, location: { x: 2339, y: 3111, z: 0 } }));
  assert.equal(h.quest.getStage(p), 34);
  const useChime = () => (h.hooks.onItemOnObject ?? []).forEach((fn) => fn({ player: p, itemId: I.CRYSTAL_CHIME, objectId: tree }));
  useChime();
  assert.equal(h.quest.getStage(p), 34, 'early chime does not heal');
  assert.match(p.messages.at(-1), /hasn't finished speaking/);
  (h.hooks.onObjectInteraction ?? []).forEach((fn) => fn({ player: p, objectId: tree, location: { x: 2339, y: 3111, z: 0 } }));
  assert.equal(h.quest.getStage(p), 36);
  useChime();
  assert.equal(h.quest.getStage(p), 38, 'the chime heals the tree through its transcript');
  assert.equal(p.manager.isActive(), true, 'chime on the spirit tree starts its transcript');
  h.action(p, N.HAZELMERE, 'QJ5K9p');
  assert.equal(h.quest.getStage(p), 38);
  assert.ok(p.log.some((row) => row[0] === 'sendCameraMoveTo' && row[1] === 2339 && row[2] === 3101 && row[3] === 620), 'spirit tree scene camera');
  (h.hooks.onObjectInteraction ?? []).forEach((fn) => fn({ player: p, objectId: core.ObjectIdentifiers.SPIRIT_TREE_27, location: { x: 2339, y: 3111, z: 0 } }));
  assert.equal(h.quest.getStage(p), 40);
  (h.hooks.onObjectInteraction ?? []).forEach((fn) => fn({ player: p, objectId: core.ObjectIdentifiers.SEWER_ENTRANCE, location: { x: 2322, y: 3101, z: 0 } }));
  assert.equal(h.quest.getStage(p), 42);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1472, 4238, 0], 'sewer entrance lands at the first chamber');
  const ladder = (objectId, x, y, z) => (h.hooks.onObjectInteraction ?? []).forEach((fn) => fn({ player: p, objectId, location: { x, y, z } }));
  ladder(49700, 1479, 4239, 0);
  h.tick(1);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1479, 4239, 1], 'sewer ladder climbs in place');
  ladder(49701, 1479, 4239, 1);
  h.tick(1);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1479, 4239, 0], 'sewer ladder descends in place');
  p.moveTo(new core.Location(1506, 4319, 1));
  h.zone(p);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1507, 4324, 1], 'metal gate leads into the boss room');
  h.zone(p);
  assert.equal(h.quest.getStage(p), 44);
  for (const npc of h.npcs.filter((entry) => entry.owner === p && [N.WARPED_TERRORBIRD, N.WARPED_TERRORBIRD_2, N.WARPED_TERRORBIRD_3].includes(entry.getId?.()))) {
    (h.hooks.onNpcDeath ?? []).forEach((fn) => fn({ npc, killer: p }));
  }
  assert.equal(h.quest.getStage(p), 46);
  (h.hooks.onObjectInteraction ?? []).forEach((fn) => fn({ player: p, objectId: core.ObjectIdentifiers.HEAVY_DOOR_10, location: { x: 1521, y: 4319, z: 1 } }));
  assert.equal(h.quest.getStage(p), 46);
  assert.ok(p.log.some((row) => row[0] === 'sendCameraMoveTo' && row[1] === 1392 && row[2] === 4381 && row[3] === 420), 'final cutscene camera');
  h.action(p, N.HAZELMERE, '5N6PuB');
  assert.equal(h.quest.getStage(p), 48);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [2678, 3086, 1], 'final action arrives at Hazelmere');
  assert.ok(p.log.some((row) => row[0] === 'sendCameraReset'), 'final cutscene camera reset');
  h.action(p, N.HAZELMERE, 'Lv5xyo');
  assert.equal(h.quest.getStage(p), 50);
  assert.equal(h.quest.isComplete(p), true);
  assert.deepEqual(p.xp, []);
  // Four lamps are awarded once by the completion reward.
  for (const lamp of [I.MAGIC_LAMP_STRENGTH_, I.MAGIC_LAMP_SLAYER_, I.MAGIC_LAMP_THIEVING_, I.MAGIC_LAMP_MAGIC_]) {
    assert.equal(p.items.get(lamp), 1);
  }
  assert.equal(h.quest.complete(p), false);
});

test('LOTG relog restores goblin form and does not duplicate quest pickups', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  h.quest.setStage(p, 20);
  p.attrs.set('quest.land_of_the_goblins.bits', (1 << 6) | (1 << 8) | (1 << 14) | (1 << 15));
  p.varbits.clear();
  h.login(p);
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.varbits.get(13599), 20);
  assert.equal(p.varbits.get(13612), 1);
  assert.equal(p.varbits.get(13602), 1, 'relog restores native whitefish knowledge');
  assert.equal(p.varbits.get(13618), 1, 'relog restores the native machine explanation');
  assert.equal(p.varbits.get(13611), 0, 'relog never restores a stale cutscene animation');

  object(h, p, core.ObjectIdentifiers.CRATE_284);
  assert.equal(p.items.get(I.DORGESH_KAAN_SPHERE), undefined, 'already-found sphere is not re-granted');
  p.messages.length = 0;
  object(h, p, core.ObjectIdentifiers.CRATE_284);
  assert.match(p.messages.at(-1), /empty/);
});

test('POG relog keeps progress bits and rebuilds the storeroom without duplicate monoliths', () => {
  const h = harness('PathOfGlouphrie');
  const p = player();
  h.quest.setStage(p, 16);
  p.attrs.set('quest.the_path_of_glouphrie.bits', (1 << 1) | (1 << 10));
  p.varbits.clear();
  h.login(p);
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.varbits.get(15288), 16);
  assert.equal(p.varbits.get(15290), 1, 'chime bowl varbit');
  assert.equal(p.varbits.get(15293), 1, 'third diary chapter varbit');
  const monolithCount = h.npcs.filter((npc) => [N.COL_00FFFF_BIG_MONOLITH_COL, N.COL_00FFFF_SMALL_MONOLITH_COL].includes(npc.getId?.())).length;
  assert.equal(monolithCount, 5);
  h.login(p);
  assert.equal(h.npcs.filter((npc) => [N.COL_00FFFF_BIG_MONOLITH_COL, N.COL_00FFFF_SMALL_MONOLITH_COL].includes(npc.getId?.())).length, 5);
});


test('LOTG migrates pre-capture stage saves without regressing or double-rewarding', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  p.attrs.delete('land-of-the-goblins:migration');
  p.attrs.set('quest.land_of_the_goblins.stage', 15);
  h.login(p);
  assert.equal(h.quest.getStage(p), 4, 'old city stage maps to the captured Zanik-talk stage');
  assert.equal(p.attrs.get('land-of-the-goblins:migration'), 2);

  const q = player();
  q.attrs.delete('land-of-the-goblins:migration');
  q.attrs.set('quest.land_of_the_goblins.stage', 40);
  q.attrs.set('quest.land_of_the_goblins.bits', 1 << 12);
  h.login(q);
  assert.equal(h.quest.getStage(q), 38);
  assert.equal(q.attrs.get('land-of-the-goblins:migration'), 2);

  const done = player();
  done.attrs.delete('land-of-the-goblins:migration');
  done.attrs.set('quest.land_of_the_goblins.stage', 60);
  h.login(done);
  assert.equal(h.quest.getStage(done), 56);
  assert.equal(h.quest.isComplete(done), true);
  assert.deepEqual(done.xp, [], 'migration does not replay rewards');
});


const STRONGROOM_GATE = {
  id: core.ObjectIdentifiers.GATE_283,
  tile: new core.Location(2782, 4255, 0),
};

function reloadStrongroomRegion() {
  const regionId = core.RegionManager.regionIdForTile(STRONGROOM_GATE.tile.getX(), STRONGROOM_GATE.tile.getY());
  core.World.getRemovedObjects().splice(0);
  core.RegionManager.reloadRegion(regionId);
  core.RegionManager.loadMapFiles(STRONGROOM_GATE.tile.getX(), STRONGROOM_GATE.tile.getY());
  return regionId;
}

function strongroomGate() {
  return core.MapObjects.get(STRONGROOM_GATE.id, STRONGROOM_GATE.tile.clone(), null);
}

function gateBlocksMovement() {
  return !core.RegionManager.canMove(2781, 4255, 2782, 4255, 0, 1, 1, null);
}

test('POG strongroom gate opens the real map clipping for earned players after relog and restart', () => {
  let regionId = reloadStrongroomRegion();
  assert.ok(strongroomGate(), 'the shipped map has the solid gate');
  assert.equal(gateBlocksMovement(), true, 'gate blocks before it is earned');

  const h = harness('PathOfGlouphrie', { realObjects: true });
  const locked = player();
  locked.attrs.set('quest.the_path_of_glouphrie.bits', 0);
  h.quest.setStage(locked, 14);
  h.login(locked);
  assert.ok(strongroomGate(), 'a player without the gate bit does not open the shared gate');
  assert.equal(gateBlocksMovement(), true);

  const earned = player();
  earned.attrs.set('quest.the_path_of_glouphrie.bits', 1 << 2);
  h.quest.setStage(earned, 14);
  h.login(earned);
  assert.equal(strongroomGate(), null, 'earned relog removes the base-map gate');
  assert.equal(gateBlocksMovement(), false, 'actual gate clipping is gone');
  assert.ok(core.World.getRemovedObjects().some((entry) => entry.getId?.() === STRONGROOM_GATE.id));

  // Restart: the runtime map is rebuilt from cache and a fresh plugin instance starts.
  regionId = reloadStrongroomRegion();
  assert.ok(strongroomGate(), 'restart restores the base-map gate');
  assert.equal(gateBlocksMovement(), true);
  const restarted = harness('PathOfGlouphrie', { realObjects: true });
  const earnedAgain = player();
  earnedAgain.attrs.set('quest.the_path_of_glouphrie.bits', 1 << 2);
  restarted.quest.setStage(earnedAgain, 14);
  restarted.login(earnedAgain);
  assert.equal(strongroomGate(), null, 'earned login reconciles after restart');
  assert.equal(gateBlocksMovement(), false);

  // A later region reload must not put the earned-open gate back.
  regionId = reloadStrongroomRegion();
  assert.ok(strongroomGate());
  const absX = (regionId >> 8) * 64, absY = (regionId & 0xff) * 64;
  for (const fn of restarted.hooks.onRegionLoaded ?? []) fn({ regionId, absX, absY });
  assert.equal(strongroomGate(), null, 'region load reconciles the shared gate');
  assert.equal(gateBlocksMovement(), false);
});

test('POG migrates pre-capture stage saves without replaying rewards', () => {
  const h = harness('PathOfGlouphrie');
  const p = player();
  p.attrs.delete('the-path-of-glouphrie:migration');
  p.attrs.set('quest.the_path_of_glouphrie.stage', 4);
  h.login(p);
  assert.equal(h.quest.getStage(p), 14);
  assert.equal(p.attrs.get('the-path-of-glouphrie:migration'), 2);

  const q = player();
  q.attrs.delete('the-path-of-glouphrie:migration');
  q.attrs.set('quest.the_path_of_glouphrie.stage', 5);
  h.login(q);
  assert.equal(h.quest.getStage(q), 18);

  const done = player();
  done.attrs.delete('the-path-of-glouphrie:migration');
  done.attrs.set('quest.the_path_of_glouphrie.stage', 12);
  h.login(done);
  assert.equal(h.quest.getStage(done), 50);
  assert.equal(h.quest.isComplete(done), true);
  assert.equal(done.items.size, 0);
});


test('POG machine rejects wrong discs and reset returns every inserted disc', () => {
  const h = harness('PathOfGlouphrie');
  const p = player();
  h.quest.setStage(p, 16);
  p.items.set(I.RED_CIRCLE, 3);
  object(h, p, core.ObjectIdentifiers.YEWNOCKS_MACHINE_2);
  const use = () => (h.hooks.onItemOnObject ?? []).forEach((fn) => fn({ player: p, itemId: I.RED_CIRCLE, objectId: core.ObjectIdentifiers.YEWNOCKS_MACHINE_2 }));
  use(); use(); use();
  assert.equal(p.items.get(I.RED_CIRCLE), 0);
  for (const fn of h.hooks.onInterfaceActionButton ?? []) fn({ player: p, buttonId: (848 << 16) | 26 });
  assert.equal(h.quest.getStage(p), 16, 'wrong discs do not activate the machine');
  assert.match(p.messages.at(-1), /clunk/);
  for (const fn of h.hooks.onInterfaceActionButton ?? []) fn({ player: p, buttonId: (848 << 16) | 25 });
  assert.equal(p.items.get(I.RED_CIRCLE), 3, 'reset returns the inserted discs');
  assert.equal(h.quest.getStage(p), 16);
});


test('black mushrooms dispatch to LOTG only inside its cave and leave other placements to The Golem', () => {
  const h = harness(['LandOfTheGoblins', 'TheGolem']);
  const lotg = h.quests.get('land_of_the_goblins');
  assert.ok(lotg, 'LOTG registered alongside The Golem');
  assert.ok(h.quests.get('the_golem'), 'The Golem registered alongside LOTG');
  const p = player();

  // Inactive LOTG: the Uzer placement is handled by The Golem, not claimed by LOTG.
  const uzer = h.object(p, 6311, 3495, 3088, 1, ['Pick']);
  assert.equal(uzer.handled, true);
  assert.equal(p.items.get(I.BLACK_MUSHROOM), 1);
  assert.match(p.messages.at(-1), /pick a mushroom/);

  // Active LOTG outside its cave still leaves the object to The Golem.
  lotg.setStage(p, 16);
  p.items.clear();
  h.object(p, 6311, 2728, 4888, 1, ['Pick']);
  assert.equal(p.items.get(I.BLACK_MUSHROOM), 1);

  // Active LOTG inside the Goblin Cave claims its own mushrooms.
  p.items.clear();
  const cave = h.object(p, 6311, 2577, 9845, 1, ['Pick']);
  assert.equal(cave.handled, true);
  assert.equal(p.items.get(I.BLACK_MUSHROOM), 1);

  // Completed LOTG no longer owns the object; normal picking still works.
  lotg.setStage(p, 56);
  p.items.clear();
  h.object(p, 6311, 3495, 3088, 1, ['Pick']);
  assert.equal(p.items.get(I.BLACK_MUSHROOM), 1);
  assert.match(p.messages.at(-1), /pick a mushroom/);
});


test('POG final cutscene logout clears camera, controls and pending timer work', () => {
  const h = harness('PathOfGlouphrie');
  const p = player();
  h.quest.setStage(p, 46);
  (h.hooks.onObjectInteraction ?? []).forEach((fn) => fn({ player: p, objectId: core.ObjectIdentifiers.HEAVY_DOOR_10, location: { x: 1521, y: 4319, z: 1 } }));
  assert.ok(p.log.some((row) => row[0] === 'sendCameraMoveTo' && row[1] === 1392 && row[2] === 4381));
  assert.equal(p.blocked, true);
  for (const fn of h.hooks.onPlayerLogout ?? []) fn({ player: p });
  assert.equal(p.blocked, false);
  assert.ok(p.log.some((row) => row[0] === 'sendCameraReset'));
  const before = p.log.length;
  h.tick(12);
  assert.equal(p.log.length, before, 'final cutscene timers stop on logout');
  // Progress survives the relog and the scene can be started again.
  h.quest.setStage(p, 46);
  h.login(p);
  assert.equal(h.quest.getStage(p), 46);
});


test('POG terrorbirds require the crystal chime to be attacked, not equipped or used', () => {
  const h = harness('PathOfGlouphrie');
  const p = player();
  assert.equal(h.hooks.onCanAttack, undefined, 'no global attack hook');
  const area = h.areas.find((candidate) => candidate.constructor.name === 'TerrorbirdArea');
  assert.ok(area, 'terrorbird rule is registered as an Area');
  const bird = { isNpc: () => true, getId: () => N.WARPED_TERRORBIRD, getOwner: () => p };
  const attack = () => area.canAttack(p, bird);
  assert.equal(attack(), false);
  assert.match(p.messages.at(-1), /crystal chime/);
  p.items.set(I.CRYSTAL_CHIME, 1);
  assert.equal(attack(), null, 'carrying the chime allows the attack');
  const otherOwnersBird = { isNpc: () => true, getId: () => N.WARPED_TERRORBIRD, getOwner: () => player() };
  assert.equal(area.canAttack(p, otherOwnersBird), null, 'another player-owned bird is not denied');
});


test('stage-2 city arrival spawns canonical Zanik in the lab and Talk-to plays the shipped opening', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  h.quest.setStage(p, 2);
  p.moveTo(new core.Location(2747, 5374, 0));
  h.login(p);
  h.zone(p);
  const zanik = h.npcs.find((npc) => npc.getOwner?.() === p && npc.getId?.() === N.ZANIK_17);
  assert.ok(zanik, 'Zanik is spawned at stage 2 after city entry/login');
  assert.deepEqual([zanik.getLocation().getX(), zanik.getLocation().getY()], [2703, 5366]);
  h.zone(p);
  assert.equal(h.npcs.filter((npc) => npc.getOwner?.() === p && npc.getId?.() === N.ZANIK_17).length, 1,
    'login plus city-entry hooks do not duplicate Zanik');

  npcInteractionWith(h, p, zanik, 1, actions(['Talk-to']));
  const current = p.manager.getCurrent();
  assert.ok(current, 'Talk-to starts the shipped Zanik dialogue');
  assert.match(String(current.getText?.() ?? ''), /Hello, Parity!/);
  assert.equal(h.quest.getStage(p), 4, 'talking to Zanik advances stage 2 -> 4');
});


test('stage-32 Bighead uses the shipped questions instead of the wiki unavailable marker', () => {
  const h = harness('LandOfTheGoblins');
  const p = player();
  h.quest.setStage(p, 32);
  p.attrs.set('quest.land_of_the_goblins.bits', 0);
  const bighead = { getId: () => N.HIGH_PRIEST_BIGHEAD, getLocation: () => p.getLocation() };
  const talk = () => npcInteractionWith(h, p, bighead, 1, actions(['Talk-to']));

  talk();
  assert.ok(p.prompt, 'Bighead opens the real question menu');
  assert.ok(p.prompt.options.includes("Me want to know about Yu'biusk."));

  for (let i = 0; i < 100 && h.quest.getStage(p) < 34; i++) {
    if (p.prompt) {
      const options = p.prompt.options;
      const wanted = ["Me want to know about Yu'biusk.", "Where is Yu'biusk?", "Can I talk to old high priests?"]
        .find((text) => options.includes(text));
      assert.ok(wanted, `unexpected options: ${options.join(' | ')}`);
      const pair = p.prompt.pairs[options.indexOf(wanted) * 2 + 1];
      p.prompt = null;
      pair();
    } else if (p.manager.isActive()) {
      p.manager.advance();
    } else {
      break;
    }
  }
  assert.equal(h.quest.getStage(p), 34, 'normal options reach the six-key crypt stage');
  assert.ok(!p.messages.some((text) => /conversation isn't available/.test(text)));

  p.manager.reset();
  p.prompt = null;
  h.login(p);
  talk();
  assert.ok(p.prompt, 'post-relog Bighead still opens options');
  assert.ok(!p.messages.some((text) => /conversation isn't available/.test(text)));
});


test('LOTG lost or full-bag priest keys can be re-earned without a permanent key bit', () => {
  const h = harness('LandOfTheGoblins');
  const priest = (id) => ({ getId: () => id, getLocation: () => new core.Location(3727, 4319, 0) });
  const p = player();
  h.quest.setStage(p, 34);
  p.attrs.set('quest.land_of_the_goblins.keys', 1 << 0); // key previously stolen, item lost
  npcInteractionWith(h, p, priest(N.PRIEST_12), 2, actions(['Talk-to', 'Pickpocket']));
  assert.equal(p.items.get(I.SARAGORGAK_KEY), 1, 'lost key is pickpocketed again');

  const full = player();
  h.quest.setStage(full, 34);
  const base = full.getInventory();
  full.getInventory = () => ({ ...base, getFreeSlots: () => 0, isFull: () => true });
  npcInteractionWith(h, full, priest(N.PRIEST_12), 2, actions(['Talk-to', 'Pickpocket']));
  assert.equal(full.items.get(I.SARAGORGAK_KEY), undefined, 'full bag gives no key');
  assert.equal(full.attrs.get('quest.land_of_the_goblins.keys') ?? 0, 0, 'full bag does not set the key bit');
  assert.match(full.messages.at(-1), /inventory space/);

  const banked = player();
  h.quest.setStage(banked, 34);
  banked.getBanks = () => [{ getAmount: (id) => (id === I.SARAGORGAK_KEY ? 1 : 0) }];
  npcInteractionWith(h, banked, priest(N.PRIEST_12), 2, actions(['Talk-to', 'Pickpocket']));
  assert.equal(banked.items.get(I.SARAGORGAK_KEY), undefined, 'banked key is not duplicated');
  assert.equal(banked.attrs.get('quest.land_of_the_goblins.keys') & 1, 1, 'bank ownership still credits the mask');
});

test('POG lost crystal chime seed is recoverable from the golden chest, respecting capacity and bank', () => {
  const h = harness('PathOfGlouphrie');
  const p = player();
  h.quest.setStage(p, 16);
  p.attrs.set('quest.the_path_of_glouphrie.bits', (1 << 11) | (1 << 24));
  p.attrs.set('the-path-of-glouphrie:monoliths', JSON.stringify([[2788,4246],[2787,4254],[2789,4253],[2787,4256],[2791,4256]]));
  openGolden(h, p);
  assert.equal(p.items.get(I.CRYSTAL_CHIME_SEED), 1, 'lost seed is recoverable from the storeroom chest');

  p.items.clear();
  const base = p.getInventory();
  p.getInventory = () => ({ ...base, getFreeSlots: () => 0, isFull: () => true });
  p.messages.length = 0;
  openGolden(h, p);
  assert.equal(p.items.get(I.CRYSTAL_CHIME_SEED), undefined, 'full bag refuses before granting');
  assert.match(p.messages.at(-1), /inventory space/);

  const banked = player();
  h.quest.setStage(banked, 16);
  banked.attrs.set('quest.the_path_of_glouphrie.bits', (1 << 11) | (1 << 24));
  banked.attrs.set('the-path-of-glouphrie:monoliths', JSON.stringify([[2788,4246],[2787,4254],[2789,4253],[2787,4256],[2791,4256]]));
  banked.getBanks = () => [{ getAmount: (id) => (id === I.CRYSTAL_CHIME ? 1 : 0) }];
  openGolden(h, banked);
  assert.equal(banked.items.get(I.CRYSTAL_CHIME_SEED), undefined, 'banked chime prevents duplicate seed');

  const held = player();
  h.quest.setStage(held, 16);
  held.attrs.set('quest.the_path_of_glouphrie.bits', (1 << 11) | (1 << 24));
  held.attrs.set('the-path-of-glouphrie:monoliths', JSON.stringify([[2788,4246],[2787,4254],[2789,4253],[2787,4256],[2791,4256]]));
  held.items.set(I.CRYSTAL_CHIME, 1);
  openGolden(h, held);
  assert.equal(held.items.get(I.CRYSTAL_CHIME_SEED), undefined, 'held chime prevents duplicate seed');
});
