// Hazeel Cult (Quest Helper 06da90f) route, recovery and cache-wire regressions.
// Run from server/: node --test tests/qh728-q055.test.cjs
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

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function harness() {
  const hooks = {}, events = {}, tasks = [], npcs = [];
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
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    spawnNpc(definition) {
      const npc = { ...definition, removed: false, getId: () => definition.id, getIndex: () => npc.index,
        index: nextIndex++, getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        isRegistered: () => !npc.removed, performAnimation: noop, forceChat: noop };
      npcs.push(npc); return npc;
    },
    removeNpc: npc => { npc.removed = true; },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require('../plugins/quests/quests/HazeelCult.Quest')(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) {
      const answer = fn(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  const h = {
    api, hooks, events, tasks, npcs,
    quest: runtime.getRegisteredQuests().at(-1),
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
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendConfig(id, value) { varps.set(id, value); return packet; },
    getVarbit: id => varbits.get(id) ?? 0,
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
    getLocation: () => p.loc, moveTo: loc => { p.loc = loc; }, getUsername: () => 'Q055',
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

function solveValves(h, p) {
  for (const id of [O.SEWER_VALVE, O.SEWER_VALVE_2, O.SEWER_VALVE_3, O.SEWER_VALVE_4, O.SEWER_VALVE_5]) {
    h.object(p, id, 'Turn');
  }
  assert.equal(p.attrs.get('quest.hazeel_cult.valves'), 31);
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
  h.object(p, O.RAFT, 'Board');
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

  h.login(p);
  assert.equal(p.varps.get(223), 9, 'login resends the persisted completed stage');
  assert.equal(h.quest.getStage(p), 9);
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

  solveValves(h, p);
  h.object(p, O.RAFT, 'Board');
  h.talk(p, N.ALOMONE); h.finish(p);
  assert.equal(h.quest.getStage(p), 4);

  const death = { player: p, killer: p, npcId: N.ALOMONE };
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
