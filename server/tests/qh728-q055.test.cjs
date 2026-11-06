// Hazeel Cult (Quest Helper 06da90f) route, recovery and cache-wire regressions.
// Run from server/: node --test tests/qh728-q055.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
let nextIndex = 1;
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  ObjectDefinition.init();
  RegionManager.init();
  RegionManager.loadMapFiles(2587, 3235);
  RegionManager.loadMapFiles(2570, 9682);
});

function harness({ realNpcs = false, withNorth = false, northFirst = false } = {}) {
  const hooks = {}, events = {}, tasks = [], npcs = [];
  let northQuest;
  const namedNpcHooks = [], queries = [];
  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  };
  const api = new Proxy({
    core: { ...core, World: { ...core.World, getNpcs: () => npcs, getNpcsNear: () => npcs }, TaskManager: taskManager,
      MultiChatboxPrompt: { getPending: p => p.prompt } },
    getTaskManager: () => taskManager,
    getWorld: () => ({ getNpcs: () => npcs }),
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    onNpcInteraction(name, actions) {
      const start = PluginManager.npcInteractionHooks.length;
      PluginManager.createApi('q055-shared-actor').onNpcInteraction(name, actions);
      namedNpcHooks.push(...PluginManager.npcInteractionHooks.splice(start));
    },
    emitCustomEvent(key, event) {
      (events[key] ?? []).forEach(fn => fn(event));
      // Each fixture API models QuestRuntime's process-wide public stage query.
      if (key === 'quest:get-stage' && event.key === 'secrets_of_the_north' && northQuest) {
        event.stage = northQuest.getStage(event.player);queries.push(event.stage);
      }
    },
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    spawnNpc(definition) {
      if (realNpcs) {
        const npc = new NPC(definition.id, new core.Location(definition.x, definition.y, definition.z));
        npc.setOwner(definition.owner);npc.setOwnerOnly(definition.ownerOnly === true);
        npc.removed = false;npc.isRegistered = () => !npc.removed;
        npcs.push(npc);return npc;
      }
      const npc = { ...definition, removed: false, getId: () => definition.id, getIndex: () => npc.index,
        index: nextIndex++, getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        isRegistered: () => !npc.removed, performAnimation: noop, forceChat: noop };
      npcs.push(npc); return npc;
    },
    removeNpc: npc => { npc.removed = true; },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  const registerNorth = () => {
    require('../plugins/quests/quests/SecretsOfTheNorth.Quest')(api);
    northQuest = runtime.getRegisteredQuests().findLast(quest => quest.key === 'secrets_of_the_north');
  };
  if (withNorth && northFirst) registerNorth();
  require('../plugins/quests/quests/HazeelCult.Quest')(api);
  if (withNorth && !northFirst) registerNorth();
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) {
      const answer = fn(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  const h = {
    api, hooks, events, tasks, npcs,
    quest: runtime.getRegisteredQuests().findLast(quest => quest.key === 'hazeel_cult'),
    northQuest, queries,
    dispatchNpc(p, npc) {
      const event = { player: p, npc, npcId: npc.getId(), definition: npc.getCurrentDefinition(p), clickType: 1, handled: false };
      PluginManager.npcInteractionHooks.push(...namedNpcHooks);
      try { PluginManager.emitNpcInteraction(event); } finally {
        for (const hook of namedNpcHooks) PluginManager.npcInteractionHooks.splice(PluginManager.npcInteractionHooks.indexOf(hook), 1);
      }
      return event;
    },
    emit(key, event) { (events[key] ?? []).forEach(fn => fn(event)); },
    talk(p, npcId) {
      const choice = (hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId })).find(Boolean);
      assert.ok(choice, `no variant for ${npcId} at stage ${h.quest.getStage(p)}`);
      runtime.startTranscript(api, p, npcId, typeof choice === 'string' ? h.quest.name : choice.page,
        typeof choice === 'string' ? choice : choice.variant);
      return choice;
    },
    object(p, objectId, option, objectLocation = p.getLocation()) {
      const x = typeof objectLocation.getX === 'function' ? objectLocation.getX() : objectLocation.x;
      const y = typeof objectLocation.getY === 'function' ? objectLocation.getY() : objectLocation.y;
      const z = typeof objectLocation.getZ === 'function' ? objectLocation.getZ() : objectLocation.z;
      const event = { player: p, objectId, clickType: 1, location: new core.Location(x, y, z),
        object: { getLocation: () => new core.Location(x, y, z) },
        definition: { getActions: () => [option], getInteractions: () => [option] } };
      for (const fn of hooks.onObjectInteraction ?? []) fn(event);
      return event;
    },
    itemOnObject(p, objectId, itemId) {
      for (const fn of hooks.onItemOnObject ?? []) {
        fn({ player: p, objectId, itemId, clickType: 1, definition: { getActions: () => [], getInteractions: () => [] } });
      }
    },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
    choose(p, text) {
      const prompt = p.prompt;
      assert.ok(prompt, `no menu for ${text}`);
      const index = prompt.options.indexOf(text);
      assert.ok(index >= 0, `missing ${text} in ${prompt.options}`);
      p.prompt = null;
      prompt.pairs[index * 2 + 1]();
    },
    continueUntil(p, predicate, limit = 300) {
      while (!predicate()) {
        assert.ok(limit-- > 0, `dialogue stalled at ${JSON.stringify(p.text)}`);
        assert.ok(p.manager.getCurrent(), `dialogue ended at ${JSON.stringify(p.text)}`);
        p.manager.advance();
      }
    },
    toPrompt(p, text) { h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, text); },
    finish(p) { h.continueUntil(p, () => !p.manager.getCurrent() && !p.prompt); },
    login(p) { for (const fn of hooks.onPlayerLogin ?? []) fn({ player: p }); },
  };
  return h;
}

function player() {
  const attrs = new Map(), items = new Map(), varps = new Map(), varbits = new Map(), log = [], xp = [];
  const inv = {
    getAmount: id => items.get(id) ?? 0,
    getFreeSlots: () => p.freeSlots ?? (28 - items.size),
    isFull: () => inv.getFreeSlots() === 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds(id, amount) {
      const before = items.get(id) ?? 0;
      if (before === 0 && typeof p.freeSlots === 'number') p.freeSlots = Math.max(0, p.freeSlots - 1);
      items.set(id, before + amount);
    },
    forceAdd(owner, item) { items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()); },
    deleteNumber(id, amount) {
      assert.ok((items.get(id) ?? 0) >= amount, `delete ${id} x${amount} from ${items.get(id) ?? 0}`);
      const after = items.get(id) - amount;
      if (after === 0 && typeof p.freeSlots === 'number') p.freeSlots += 1;
      items.set(id, after);
    },
  };
  const packet = new Proxy({
    sendVarbit(id, value) {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const mask = (2 ** (endBit - startBit + 1) - 1) << startBit;
      varps.set(baseVar, ((varps.get(baseVar) ?? 0) & ~mask) | ((value << startBit) & mask));
      varbits.set(id, value); return packet;
    },
    sendConfig(id, value) { varps.set(id, value); return packet; },
    getVarbit: id => varbits.get(id) ?? 0,
    getVarp: id => varps.get(id) ?? 0,
    sendString(text, uid) { p.text = text; log.push(['text', uid, text]); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (target, key) => target[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = {
    attrs, items, varps, varbits, log, xp, messages: [], prompt: null, text: '',
    loc: new core.Location(2569, 3275, 0), levels: {}, eq: {},
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inv,
    getBanks: () => [],
    getEquipment: () => ({ get: slot => p.eq[slot] ? { getId: () => p.eq[slot] } : null }),
    getPacketSender: () => packet,
    getDialogueManager: () => p.manager,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
      getCombatLevel: () => 3, getCurrentLevel: () => 99, getMaxLevel: skill => p.levels[skill.getIndex()] ?? 99 }),
    getLocation: () => p.loc, moveTo: loc => { p.loc = loc; }, getUsername: () => 'Q055', getDisplayName: () => 'Q055',
    sendMessage: text => p.messages.push(text), isRegistered: () => true, isPlayerBot: () => false,
  };
  p.manager = new DialogueManager(p);
  return p;
}

test('Hazeel Cult exposes its saved side through the public quest query', () => {
  const h = harness();
  const p = player();
  p.setAttribute('quest.hazeel_cult.side', 1);
  const request = { player: p, side: null };
  const eventName = 'hazeel-cult:get-side';
  const hooks = PluginManager.customEventHooks.get(eventName) ?? [];
  const handler = h.events[eventName][0];
  PluginManager.customEventHooks.set(eventName, [...hooks, { pluginName: 'HazeelCultPublicQueryTest', handler }]);
  try {
    PluginManager.emitCustomEvent(eventName, request);
    assert.equal(request.side, 1);
  } finally {
    if (hooks.length) PluginManager.customEventHooks.set(eventName, hooks);
    else PluginManager.customEventHooks.delete(eventName);
  }
});

function startQuest(h, p) {
  h.talk(p, N.CERIL_CARNILLEAN);
  h.toPrompt(p, "What's wrong?");
  h.toPrompt(p, 'Yes.');
  h.finish(p);
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.varps.get(223), 2);
  h.object(p, O.CAVE_ENTRANCE_14, 'Enter');
  assert.equal(p.loc.getX(), 2570);
  h.talk(p, N.CLIVET);
}

function sideHazeel(h, p) {
  startQuest(h, p);
  h.toPrompt(p, "Alright, I've made my decision.");
  h.toPrompt(p, "I'll help you.");
  h.toPrompt(p, 'Alright, how do I do it?');
  h.finish(p);
}

function turnValve(h, p, id, direction) {
  h.object(p, id, 'Turn');
  assert.ok(p.prompt, `valve ${id} opens its left/right prompt`);
  assert.match(p.prompt.title, new RegExp(`turned to the ${direction === 'right' ? 'left' : 'right'}`));
  h.choose(p, `Turn it to the ${direction}.`);
}

function solveValves(h, p) {
  // Native start: sewervalve3 right, the rest left (the plugin persists this default).
  p.setAttribute('quest.hazeel_cult.valve-directions', 1 << 2);
  // Native gameval order and target: sewervalve1/2/4/5 right, sewervalve3 left.
  turnValve(h, p, O.SEWER_VALVE, 'right');
  turnValve(h, p, O.SEWER_VALVE_2, 'right');
  turnValve(h, p, O.SEWER_VALVE_3, 'left');
  turnValve(h, p, O.SEWER_VALVE_4, 'right');
  turnValve(h, p, O.SEWER_VALVE_5, 'right');
  assert.equal(p.attrs.get('quest.hazeel_cult.valve-directions'), 27);
}

test('Hazeel side: poison, mark, raft, crate key, hidden wall, ladder, scroll chest and Alomone hand-in', () => {
  const h = harness();
  const p = player();
  sideHazeel(h, p);
  assert.equal(h.quest.getStage(p), 4);
  assert.equal(p.attrs.get('quest.hazeel_cult.side'), 1);
  assert.equal(p.items.get(I.POISON), 1, 'the dialogue handout gives the poison');

  h.itemOnObject(p, O.RANGE, I.POISON);
  assert.equal(h.quest.getStage(p), 5);
  assert.equal(p.items.get(I.POISON) ?? 0, 0, 'poison is consumed on the range');

  h.talk(p, N.CERIL_CARNILLEAN); h.finish(p);
  assert.equal(h.quest.getStage(p), 5);

  h.talk(p, N.CLIVET); h.finish(p);
  assert.equal(p.items.get(I.HAZEELS_MARK), 1, 'Clivet hands over the mark after the poisoning');

  solveValves(h, p);
  h.object(p, O.RAFT, 'Board', { x: 2567, y: 9679, z: 0 });
  assert.equal(p.loc.getX(), 2606);
  h.talk(p, N.ALOMONE); h.finish(p);
  assert.equal(h.quest.getStage(p), 6);

  h.object(p, O.RAFT, 'Board');
  assert.equal(p.loc.getX(), 2568);

  p.freeSlots = 0;
  h.object(p, O.CRATE_21, 'Search');
  assert.equal(p.items.get(I.CHEST_KEY_3) ?? 0, 0, 'a full bag leaves the key in the crate');
  p.freeSlots = 1;
  h.object(p, O.CRATE_21, 'Search');
  assert.equal(p.items.get(I.CHEST_KEY_3), 1);

  h.object(p, 46902, 'Knock-at');
  h.toPrompt(p, 'Yes.');
  h.finish(p);
  assert.deepEqual([p.loc.getX(), p.loc.getY(), p.loc.getZ()], [2572, 3271, 1]);

  h.object(p, 16683, 'Climb-up', { x: 2573, y: 3271, z: 1 });
  assert.equal(p.loc.getZ(), 2);
  h.object(p, 16679, 'Climb-down', { x: 2573, y: 3271, z: 2 });
  assert.deepEqual([p.loc.getX(), p.loc.getY(), p.loc.getZ()], [2573, 3271, 1]);
  h.object(p, 16683, 'Climb-up', { x: 2573, y: 3271, z: 1 });
  assert.equal(p.loc.getZ(), 2);

  p.freeSlots = 0;
  h.itemOnObject(p, 46903, I.CHEST_KEY_3);
  assert.equal(p.items.get(I.HAZEEL_SCROLL) ?? 0, 0, 'a full bag leaves the scroll in the chest');
  assert.equal(h.quest.getStage(p), 6);
  p.freeSlots = 1;
  h.itemOnObject(p, 46903, I.CHEST_KEY_3);
  assert.equal(p.items.get(I.HAZEEL_SCROLL), 1);
  assert.equal(h.quest.getStage(p), 7);

  h.talk(p, N.ALOMONE); h.finish(p);
  assert.equal(h.quest.getStage(p), 9);
  assert.equal(p.varps.get(223), 9, 'completion sends the canonical varp 223 value 9');
  assert.equal(p.items.get(I.HAZEEL_SCROLL) ?? 0, 0, 'the scroll is handed to Alomone');
  assert.equal(p.xp.at(-1)[1], 1500);
  assert.equal(p.items.get(I.COINS), 2000);
  assert.equal(p.varbits.get(14780), 1);
  assert.equal(p.varbits.get(14776), 1);
  assert.equal(p.varbits.get(14775), 1);

  h.login(p);
  assert.equal(p.varps.get(223), 9, 'login resends the persisted completed stage');
  assert.equal(h.quest.getStage(p), 9);
});

test('Hazeel valves prompt both directions, keep state on Do nothing, and drive the raft by leading-correct count', () => {
  const h = harness();
  const p = player();
  h.quest.setStage(p, 4);
  const ATTR = 'quest.hazeel_cult.valve-directions';
  p.setAttribute(ATTR, 1 << 2); // native start: sewervalve3 right, the rest left

  h.object(p, O.SEWER_VALVE, 'Turn');
  assert.equal(p.prompt.title, 'The valve is currently turned to the left.');
  assert.deepEqual(p.prompt.options, ['Turn it to the right.', 'Do nothing.']);
  h.choose(p, 'Do nothing.');
  assert.equal(p.attrs.get(ATTR), 1 << 2, 'Do nothing leaves the valve orientation alone');
  assert.equal(p.messages.at(-1), 'You leave the valve alone.');

  h.object(p, O.SEWER_VALVE, 'Turn');
  h.choose(p, 'Turn it to the right.');
  assert.equal(p.attrs.get(ATTR), (1 << 2) | 1);
  assert.equal(p.messages.at(-1), 'You turn the valve to the right. Beneath your feet you hear the sudden sound of rushing water.');

  h.object(p, O.SEWER_VALVE_3, 'Turn');
  assert.equal(p.prompt.title, 'The valve is currently turned to the right.');
  assert.deepEqual(p.prompt.options, ['Turn it to the left.', 'Do nothing.']);
  h.choose(p, 'Turn it to the left.');
  assert.equal(p.attrs.get(ATTR), 1, 'sewervalve3 changes from right to left');

  const board = (value) => {
    p.setAttribute(ATTR, value);
    p.loc = new core.Location(2570, 9682, 0);
    p.messages = [];
    h.object(p, O.RAFT, 'Board', { x: 2567, y: 9679, z: 0 });
  };
  board(0);
  assert.deepEqual([p.loc.getX(), p.loc.getY()], [2570, 9682], 'no correct leading valves leaves the raft on the shore');
  assert.equal(p.messages.at(-1), "The current is flowing against the raft. It won't move.");
  board(1);
  assert.deepEqual([p.loc.getX(), p.loc.getY()], [2578, 9687]);
  assert.match(p.messages.at(-1), /stops at the first island\./);
  board(7);
  assert.deepEqual([p.loc.getX(), p.loc.getY()], [2593, 9694]);
  assert.match(p.messages.at(-1), /stops at the second island\./);
  board(3);
  assert.deepEqual([p.loc.getX(), p.loc.getY()], [2616, 9725]);
  assert.match(p.messages.at(-1), /stops at the fourth island\./);
  board(11);
  assert.deepEqual([p.loc.getX(), p.loc.getY()], [2600, 9711]);
  assert.match(p.messages.at(-1), /stops at the third island\./);
  board(27);
  assert.deepEqual([p.loc.getX(), p.loc.getY()], [2606, 9692]);
  assert.equal(p.messages.at(-1), 'The raft washes up the sewer until it reaches the end of the passage.');

  p.messages = [];
  h.object(p, O.RAFT, 'Board', { x: 2606, y: 9693, z: 0 });
  assert.deepEqual([p.loc.getX(), p.loc.getY()], [2568, 9681]);
  assert.equal(p.messages.at(-1), 'The raft flows back to the cave entrance.');

  for (const [x, y] of [[2578, 9687], [2593, 9694], [2616, 9725], [2600, 9711], [2606, 9692], [2568, 9681]]) {
    assert.equal(RegionManager.blocked(new core.Location(x, y, 0), null), false, `raft landing ${x},${y} is walkable`);
  }
});

test('Hazeel side: full-bag poison handout is recoverable from Clivet', () => {
  const h = harness();
  const p = player();
  startQuest(h, p);
  p.freeSlots = 0;
  h.toPrompt(p, "Alright, I've made my decision.");
  h.toPrompt(p, "I'll help you.");
  h.toPrompt(p, 'Alright, how do I do it?');
  h.finish(p);
  assert.equal(h.quest.getStage(p), 4);
  assert.equal(p.items.get(I.POISON) ?? 0, 0, 'no poison is forced into a full bag');

  p.freeSlots = 1;
  h.talk(p, N.CLIVET); h.finish(p);
  assert.equal(p.items.get(I.POISON), 1, 'talking again after freeing a slot hands over the poison');
});

test('Ceril side: Alomone death, armour chest, Ceril hand-in, cupboard accusation and completion', () => {
  const h = harness();
  const p = player();
  startQuest(h, p);
  assert.equal(h.quest.getStage(p), 3);
  h.toPrompt(p, "Alright, I've made my decision.");
  h.toPrompt(p, "I won't help you.");
  h.finish(p);
  assert.equal(h.quest.getStage(p), 4);
  assert.equal(p.attrs.get('quest.hazeel_cult.side'), 0);

  const npc = { transformed: null, setNpcTransformationId(id) { this.transformed = id; } };
  h.emit('npc-dialogue:line', { player: p, npc, npcId: N.ALOMONE, text: 'Well you won\'t live long enough to tell anyone! Die!' });
  assert.equal(npc.transformed, N.ALOMONE_2);
  assert.equal(p.varbits.get(14770), 1, 'threat line exposes the attackable Alomone');
  p.varbits.clear();
  h.login(p);
  assert.equal(p.varbits.get(14770), 1, 'interrupted combat is replayed on login');

  solveValves(h, p);
  h.object(p, O.RAFT, 'Board', { x: 2567, y: 9679, z: 0 });
  h.talk(p, N.ALOMONE); h.finish(p);
  assert.equal(h.quest.getStage(p), 4);

  const trackedAlomone = h.npcs.find(npc => npc.getId() === N.ALOMONE && npc.owner === p && !npc.removed);
  assert.ok(trackedAlomone);
  const other = player(); h.login(other);
  const foreignAlomone = h.npcs.find(npc => npc.getId() === N.ALOMONE && npc.owner === other);
  for (const npc of [undefined, foreignAlomone]) {
    for (const fn of h.hooks.onNpcDeath ?? []) fn({ killer: p, npcId: N.ALOMONE_2, npc });
    assert.equal(h.quest.getStage(p), 4, 'missing/foreign same-ID deaths cannot advance the quest');
  }
  const death = { player: p, killer: p, npcId: N.ALOMONE_2, npc: trackedAlomone };
  for (const fn of h.hooks.onNpcDeath ?? []) fn(death);
  assert.equal(h.quest.getStage(p), 6);

  p.freeSlots = 0;
  h.object(p, O.CHEST_178, 'Search');
  assert.equal(p.items.get(I.CARNILLEAN_ARMOUR) ?? 0, 0, 'a full bag leaves the armour in the chest');
  p.freeSlots = 1;
  h.object(p, O.CHEST_178, 'Search');
  assert.equal(p.items.get(I.CARNILLEAN_ARMOUR), 1);

  h.talk(p, N.CERIL_CARNILLEAN); h.finish(p);
  assert.equal(h.quest.getStage(p), 7, 'the fake hand-in advances to the evidence step');
  assert.equal(p.items.get(I.CARNILLEAN_ARMOUR) ?? 0, 0);
  assert.equal(p.items.get(I.COINS), 5);
  h.tick(3);
  assert.ok(p.log.some(([kind, group]) => kind === 'sendInterface' && group === 153), 'the fake reward scroll opens');

  h.object(p, O.CUPBOARD_22, 'Search');
  h.finish(p);
  assert.equal(h.quest.getStage(p), 9);
  assert.equal(p.varps.get(223), 9);
  assert.equal(p.xp.at(-1)[1], 1500);
  assert.equal(p.items.get(I.COINS), 2005);
  assert.equal(p.varbits.get(14769), 1);
  assert.equal(p.varbits.get(14770), 2);
  assert.equal(p.varbits.get(14772), 1);
  assert.equal(p.varbits.get(14773), 1);
  assert.equal(p.varbits.get(14775), 0);
  h.login(p);
  assert.equal(p.varbits.get(14770), 2);
});

test('hidden ladders only act on the verified Hazeel tile and Hazeel-side quest state', () => {
  const h = harness();
  const p = player();
  p.attrs.set('quest.hazeel_cult.stage', 6);
  p.attrs.set('quest.hazeel_cult.side', 1);

  p.loc = new core.Location(3200, 3200, 0);
  const genericUp = h.object(p, 16683, 'Climb-up', { x: 1708, y: 6134, z: 1 });
  assert.equal(genericUp.handled, undefined, 'a generic 16683 ladder is not claimed');
  assert.deepEqual([p.loc.getX(), p.loc.getY(), p.loc.getZ()], [3200, 3200, 0]);

  const genericDown = h.object(p, 16679, 'Climb-down', { x: 1708, y: 6134, z: 1 });
  assert.equal(genericDown.handled, undefined, 'a generic 16679 ladder is not claimed');
  assert.deepEqual([p.loc.getX(), p.loc.getY(), p.loc.getZ()], [3200, 3200, 0]);

  const wrongStage = h.object(p, 16683, 'Climb-up', { x: 2573, y: 3271, z: 1 });
  assert.equal(wrongStage.handled, true, 'the Hazeel tile is recognized at stage 6');

  p.attrs.set('quest.hazeel_cult.stage', 0);
  p.loc = new core.Location(3200, 3200, 0);
  const stageZero = h.object(p, 16683, 'Climb-up', { x: 2573, y: 3271, z: 1 });
  assert.equal(stageZero.handled, undefined, 'the Hazeel ladder does not fire at stage 0');
  assert.deepEqual([p.loc.getX(), p.loc.getY(), p.loc.getZ()], [3200, 3200, 0]);

  p.attrs.set('quest.hazeel_cult.stage', 6);
  p.attrs.set('quest.hazeel_cult.side', 0);
  const cerilSide = h.object(p, 16683, 'Climb-up', { x: 2573, y: 3271, z: 1 });
  assert.equal(cerilSide.handled, undefined, 'the Hazeel ladder does not fire on the Ceril side');
  assert.deepEqual([p.loc.getX(), p.loc.getY(), p.loc.getZ()], [3200, 3200, 0]);
});

test('mansion doors 1540/46863 stay with the shared Doors plugin, not the quest handler', () => {
  const h = harness();
  const p = player();
  p.attrs.set('quest.hazeel_cult.stage', 2);
  p.loc = new core.Location(2569, 3272, 0);

  const front = h.object(p, 1540, 'Open', { x: 2569, y: 3273, z: 0 });
  assert.equal(front.handled, undefined, 'the quest does not claim the mansion front door');
  assert.deepEqual([p.loc.getX(), p.loc.getY(), p.loc.getZ()], [2569, 3272, 0]);

  const interior = h.object(p, 46863, 'Open', { x: 2567, y: 3271, z: 0 });
  assert.equal(interior.handled, undefined, 'the quest does not claim the interior door');
  assert.deepEqual([p.loc.getX(), p.loc.getY(), p.loc.getZ()], [2569, 3272, 0]);
});

test('post-quest Hazeel side: Ceril, Henryeta and the guard use their Hazeel transcript pages', () => {
  const h = harness();
  const p = player();
  p.attrs.set('quest.hazeel_cult.stage', 9);
  p.attrs.set('quest.hazeel_cult.side', 1);
  p.varps.set(223, 9);

  const ceril = h.talk(p, N.CERIL_CARNILLEAN);
  assert.deepEqual(ceril, { page: 'Ceril Carnillean', variant: 'after-hazeel-cult-sided-with-hazeel' });
  h.finish(p);

  const henryeta = h.talk(p, N.HENRYETA_CARNILLEAN);
  assert.deepEqual(henryeta, { page: 'Henryeta Carnillean', variant: 'after-hazeel-cult-sided-with-hazeel' });
  h.finish(p);

  const guard = h.talk(p, N.GUARD_180);
  assert.deepEqual(guard, { page: 'Guard (Carnillean)', variant: 'after-hazeel-cult-sided-with-hazeel' });
  h.finish(p);
});

test('post-quest Hazeel side: Clivet reclaims a lost mark through the NPC transcript page', () => {
  const h = harness();
  const p = player();
  p.attrs.set('quest.hazeel_cult.stage', 9);
  p.attrs.set('quest.hazeel_cult.side', 1);
  p.varps.set(223, 9);
  h.talk(p, N.CLIVET);
  h.finish(p);
  assert.equal(p.items.get(I.HAZEELS_MARK), 1);
});


test('earned Hazeel auxiliary state replays native poison checkpoint and preserves varp siblings', () => {
  const h = harness(), p = player();
  const ids = { HAZEELCULT_CLIVET_LOCATION: 14769, HAZEELCULT_ALOMONE_VIS: 14770,
    HAZEELCULT_GIVEN_ARMOUR: 14772, HAZEELCULT_JONES_CUTSCENE: 14773,
    HAZEELCULT_POISON_SUCCESS: 14775, HAZEELCULT_GIVEN_AMULET: 14776, HAZEELCULT_GIVEN_SCROLL: 14780 };
  for (const [name, id] of Object.entries(ids)) assert.equal(CacheDefinitions.getVarbitId(name.toLowerCase()), id);
  p.attrs.set('quest.hazeel_cult.stage', 4);
  p.attrs.set('quest.hazeel_cult.side', 1);
  h.login(p);
  assert.equal(p.varbits.get(14775), 0);
  p.items.set(I.POISON, 1);
  h.itemOnObject(p, O.RANGE, I.POISON);
  assert.equal(p.varbits.get(14775), 1);
  p.varbits.clear(); p.varps.clear();
  const def = CacheDefinitions.getVarbit(14775);
  let ownedMask = 0;
  for (const id of Object.values(ids)) {
    const d = CacheDefinitions.getVarbit(id);
    if (d.baseVar === def.baseVar) ownedMask |= (2 ** (d.endBit - d.startBit + 1) - 1) << d.startBit;
  }
  const siblings = 0x5a5a5a5a & ~ownedMask;
  p.varps.set(def.baseVar, siblings);
  h.login(p);
  assert.equal(p.varbits.get(14775), 1, 'existing stage-five save reconstructs earned poison');
  assert.equal(p.varps.get(def.baseVar) & ~ownedMask, siblings);
  assert.equal(p.varbits.get(14780), 0, 'no invented scroll hand-in');
  p.varps.set(def.baseVar, siblings);
  p.varbits.clear();
  const stage = h.quest.getStage(p), xp = [...p.xp], coins = p.items.get(I.COINS);
  h.emit('player:bootstrap-complete', { player: p });
  assert.equal(p.varbits.get(14775), 1, 'bootstrap restores earned poison after its backing varp reset');
  assert.equal(p.varbits.get(14769), 0, 'bootstrap preserves the Hazeel branch');
  assert.equal(p.varps.get(def.baseVar) & ~ownedMask, siblings);
  assert.equal(h.quest.getStage(p), stage);
  assert.deepEqual(p.xp, xp);
  assert.equal(p.items.get(I.COINS), coins);
});


test('mark flag is earned only by a successful handout and survives losing the mark and relogging', () => {
  const h = harness(), p = player();
  p.attrs.set('quest.hazeel_cult.stage', 5);
  p.attrs.set('quest.hazeel_cult.side', 1);
  p.freeSlots = 0;
  h.emit('npc-dialogue:action', { player: p, npcId: N.CLIVET, stepId: '6FjnaM', kind: 'message' });
  h.login(p);
  assert.equal(p.varbits.get(14776), 0);
  p.freeSlots = 1;
  h.emit('npc-dialogue:action', { player: p, npcId: N.CLIVET, stepId: '6FjnaM', kind: 'message' });
  assert.equal(p.varbits.get(14776), 1);
  p.items.delete(I.HAZEELS_MARK);
  p.varbits.clear();
  h.login(p);
  assert.equal(p.varbits.get(14776), 1);
});


test('cave and sewer stairs pair real cache footprints with reachable standable landings', () => {
  const h = harness(), p = player();
  const rf = new RsmodRouteFinding(RegionManager.getClipping.bind(RegionManager));
  const mq = new MovementQueue({ ...p, isPlayer: () => true, isNpc: () => false,
    getAsPlayer: () => p, getPrivateArea: () => null });
  function verifyReach(id, x, y, fromX, fromY) {
    const object = (MapObjects.mapObjects.get(MapObjects.getHash(x, y, 0)) ?? []).find(o => o.getId() === id);
    assert.ok(object, `actual map object ${id}`);
    const spec = mq.buildObjectRouteSpec(object);
    assert.equal(rf.reachedAbsolute({ level: 0, srcX: fromX, srcY: fromY, srcSize: 1,
      destX: x, destY: y, destWidth: spec.reachWidth, destLength: spec.reachLength,
      locAngle: spec.reachAngle, locShape: spec.reachShape,
      blockAccessFlags: spec.reachBlockAccessFlags, privateArea: null }), true);
  }
  p.loc = new core.Location(2587, 3237, 0);
  verifyReach(O.CAVE_ENTRANCE_14, 2585, 3233, 2587, 3237);
  h.object(p, O.CAVE_ENTRANCE_14, 'Enter', { x: 2585, y: 3233, z: 0 });
  assert.deepEqual([p.loc.getX(), p.loc.getY(), p.loc.getZ()], [2570, 9682, 0]);
  assert.equal(RegionManager.getClipping(2570, 9682, 0, null), 0);
  verifyReach(O.STAIRS_14, 2570, 9683, 2570, 9682);
  h.object(p, O.STAIRS_14, 'Climb-up', { x: 2570, y: 9683, z: 0 });
  assert.deepEqual([p.loc.getX(), p.loc.getY(), p.loc.getZ()], [2587, 3237, 0]);
  assert.equal(RegionManager.getClipping(2587, 3237, 0, null), 0);
  assert.equal(rf.findRoute({ level: 0, srcX: 2587, srcY: 3237, srcSize: 1,
    destX: 2587, destY: 3245, destWidth: 1, destLength: 1, locShape: -1,
    moveNear: false, privateArea: null }).success, true, 'normal walk from cave to the valve approach');
});


test('completed Hazeel Cult yields the canonical wall parent to Secrets of the North', () => {
  const h=harness(),p=player();p.attrs.set('quest.hazeel_cult.stage',9);p.attrs.set('quest.hazeel_cult.side',1);
  for(const id of [46707,46902]) {
    const event=h.object(p,id,'Knock-at',{x:2572,y:3270,z:1});
    assert.equal(event.handled,undefined);assert.equal(p.prompt,null);
  }
});


test('canonical outside wall approaches offer Yes while the north room tile exits', () => {
  const h=harness();
  for(const x of [2571,2572]) {
    const p=player();p.attrs.set('quest.hazeel_cult.stage',6);p.attrs.set('quest.hazeel_cult.side',1);
    p.moveTo(new core.Location(x,3270,1));h.object(p,46902,'Knock-at',{x:2572,y:3270,z:1});
    assert.ok(p.prompt?.options.includes('Yes.'),'corridor tile is outside, not the hidden-room exit');
    h.choose(p,'Yes.');h.finish(p);
    assert.deepEqual([p.loc.getX(),p.loc.getY(),p.loc.getZ()],[2572,3271,1]);
    h.object(p,46902,'Knock-at',{x:2572,y:3270,z:1});
    assert.deepEqual([p.loc.getX(),p.loc.getY(),p.loc.getZ()],[2571,3270,1]);
  }
});


test('Hazeel completion retains real Alomone and Jones for canonical repeat dialogue and relog without rewards', () => {
  const h = harness({ realNpcs: true }), p = player();
  p.attrs.set('quest.hazeel_cult.stage', 7); p.attrs.set('quest.hazeel_cult.side', 1);
  p.items.set(I.HAZEEL_SCROLL, 1);
  h.login(p); h.talk(p, N.ALOMONE); h.finish(p);
  assert.equal(h.quest.getStage(p), 9);
  const coins = p.items.get(I.COINS), xp = [...p.xp];
  const own = id => h.npcs.filter(npc => npc.getId() === id && npc.getOwner() === p && !npc.removed);
  for (const id of [N.ALOMONE, N.BUTLER_JONES, N.CERIL_CARNILLEAN]) assert.equal(own(id).length, 1);
  for (const [id, page] of [[N.ALOMONE, 'Alomone'], [N.BUTLER_JONES, 'Butler Jones']]) {
    const choice = h.talk(p, id); assert.equal(choice.page, page); h.finish(p);
  }
  assert.ok(p.log.some(row => row[0] === 'text' && String(row[2]).includes('always welcome here')));
  for (const fn of h.hooks.onPlayerLogout ?? []) fn({ player: p });
  assert.equal(own(N.ALOMONE).length, 0);
  h.login(p); h.emit('player:bootstrap-complete', { player: p });
  assert.equal(own(N.ALOMONE).length, 1); h.talk(p, N.ALOMONE); h.finish(p);
  assert.equal(p.items.get(I.COINS), coins); assert.deepEqual(p.xp, xp);
});


test('cache parents distinguish living HC contacts from the misplaced Fight Arena actors', () => {
  const zero = { getVarbit: () => 0, getVarp: () => 0 };
  assert.equal(CacheDefinitions.resolveNpc(1204, zero).id, 12030);
  assert.equal(CacheDefinitions.getNpc(12030).name, 'Sammy Servil');
  assert.equal(CacheDefinitions.resolveNpc(1203, zero).id, 12029);
  assert.equal(CacheDefinitions.getNpc(12029).name, 'Lady Servil');
  assert.equal(CacheDefinitions.resolveNpc(11976, zero).id, N.ALOMONE);
  const dead = { ...zero, getVarbit: id => id === 14770 ? 2 : 0 };
  assert.equal(CacheDefinitions.resolveNpc(11976, dead), undefined, 'killed Alomone has no visible HC form');
  assert.equal(CacheDefinitions.resolveNpc(11972, zero).id, N.CERIL_CARNILLEAN);
  assert.equal(CacheDefinitions.resolveNpc(11974, zero).id, N.BUTLER_JONES);
  const spawns = require('../data/definitions/npc-spawns.json');
  for (const id of [11972, 11974, 11976]) assert.equal(spawns.some(spawn => spawn.id === id), false);
});

test('both HC endings hand cult actors to SOTN at6/7/13 in either plugin order', () => {
  for (const northFirst of [false, true]) for (const side of [0, 1]) {
    const h = harness({ realNpcs: true, withNorth: true, northFirst }), p = player();
    p.getUsername = () => `q055-${northFirst}-${side}`;
    p.attrs.set('quest.hazeel_cult.stage', 9); p.attrs.set('quest.hazeel_cult.side', side);
    p.loc = new core.Location(2609, 9670, 0);
    h.northQuest.setStage(p, 6); h.login(p);
    const live = id => h.npcs.filter(npc => !npc.removed && npc.getOwner() === p && npc.getId() === id);
    const oldHC = live(N.ALOMONE)[0];
    assert.equal(live(N.ALOMONE).length, side === 1 ? 1 : 0, 'stage6 uses living Alomone only when he survived HC');
    const contact = side === 1 ? oldHC : live(N.HAZEEL_2)[0];
    assert.ok(contact, 'Carnillean route has the canonical already-awake Hazeel alternative');
    assert.equal(h.dispatchNpc(p, contact).handled, true);
    h.continueUntil(p, () => h.northQuest.getStage(p) === 7);
    p.manager.reset(); p.prompt = null;
    assert.equal(live(N.ALOMONE).length, side === 1 ? 1 : 0, 'SOTN never resurrects killed Alomone');
    if (side === 1) {
      assert.equal(oldHC.removed, true, 'HC removes only its own copy at SOTN takeover');
      assert.equal(live(N.ALOMONE)[0].hasFlag('secrets-of-the-north:spawned'), true);
    }
    h.login(p);
    assert.equal(live(N.ALOMONE).length, side === 1 ? 1 : 0, 'either login ordering keeps one appropriate actor');
    h.northQuest.setStage(p, 13); h.login(p);
    assert.equal(live(N.ALOMONE).length, side === 1 ? 1 : 0, 'after13 only the surviving HC contact remains');
    if (side === 1) {
      assert.equal(live(N.ALOMONE)[0].hasFlag('secrets-of-the-north:spawned'), false, 'SOTN cleanup preserves HC ownership');
      h.talk(p, N.ALOMONE); h.finish(p);
    }
    if (side === 1) assert.ok(h.queries.includes(6) && h.queries.includes(7) && h.queries.includes(13), 'HC consults the public stage query');
    assert.equal(p.xp.length, 0); assert.equal(p.items.get(I.COINS) ?? 0, 0, 'handoff grants no HC rewards');
    for (const fn of h.hooks.onPlayerLogout ?? []) fn({ player: p });
  }
});
