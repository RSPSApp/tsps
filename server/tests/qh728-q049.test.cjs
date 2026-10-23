// From server/: node --test tests/qh728-q049.test.cjs (after yarn build).
// Getting Ahead: registered-dispatch tests for the wire contract, the Quest
// Helper stage graph, the flour/overnight recovery, fake-head item operations,
// mounting and the final inspection hand-in. Early stages are fixture state;
// every state change goes through the production handlers.
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

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  core.ObjectDefinition.init();
});

const GORDON = N.GORDON; // 10500
const MARY = N.MARY_2; // 10502
const BEAST = N.HEADLESS_BEAST_2; // 10506
const VARBIT = 693;
const STAGE = {
  start: 2, mary: 4, poured: 8, trail: 10, lair: 12, killed: 14,
  refused: 16, maryFake: 18, clayMade: 20, clayShown: 22, furMade: 24,
  furShown: 26, bloodyMade: 28, bloodyShown: 30, mounted: 32, complete: 34,
};

function harness(extraPlugins = []) {
  const hooks = {}, events = {}, tasks = [], npcs = [], removed = [], objects = [];
  const clicks = new Map(), namedObjects = new Map(), namedNpcs = new Map();
  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  };
  const objectManager = {
    register(object) { objects.push(object); },
    deregister(object) { const index = objects.indexOf(object); if (index >= 0) objects.splice(index, 1); },
  };
  const api = new Proxy({
    core: {
      ...core,
      World: { ...core.World, getNpcsNear: () => npcs },
      TaskManager: taskManager,
      ObjectManager: objectManager,
      MultiChatboxPrompt: { getPending: player => player.prompt },
    },
    getTaskManager: () => taskManager,
    getObjectManager: () => objectManager,
    getItemOnGroundManager: () => ({ registerLocation: noop }),
    registerArea: noop,
    registerCombatMethodResolver: noop,
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    onObjectFirstClick: (ids, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    onObjectInteraction: (nameOrFn, actions) => {
      if (typeof nameOrFn === 'function') (hooks.onObjectInteraction ??= []).push(nameOrFn);
      else namedObjects.set(nameOrFn, actions);
    },
    onNpcInteraction: (nameOrFn, actions) => {
      if (typeof nameOrFn === 'function') (hooks.onNpcInteraction ??= []).push(nameOrFn);
      else namedNpcs.set(nameOrFn, actions);
    },
    sendMultiChatboxPrompt(player, title, ...pairs) {
      player.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
      return true;
    },
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z), area = null;
      const npc = {
        ...definition, getId: () => definition.id, getIndex: () => npc.index, index: nextIndex++,
        getLocation: () => location, moveTo: to => { location = to; },
        getArea: () => area, setArea: value => { area = value; }, getPrivateArea: () => area,
        isNpc: () => true, isPlayer: () => false, getAsNpc: () => npc,
        isRegistered: () => !npc.removed, setPositionToFace: noop, setUntargetable: noop,
        performAnimation: noop, performGraphic: noop, sendMessage: noop,
        getMovementQueue: () => ({ addSteps: noop }),
        getCombat: () => ({ attack: target => { npc.target = target; }, getHitQueue: () => ({ addPendingDamage: noop }) }),
        getHitpoints: () => 100,
      };
      npcs.push(npc);
      return npc;
    },
    removeNpc(npc) { npc.removed = true; removed.push(npc); },
  }, { get: (target, key) => target[key] ?? ((...args) => {
    const fn = args.find(argument => typeof argument === 'function');
    if (fn) (hooks[key] ??= []).push(fn);
  }) });

  require('../plugins/quests/quests/GettingAhead.Quest')(api);
  for (const pluginPath of extraPlugins) {
    const plugin = require(pluginPath);
    if (typeof plugin === 'function') plugin(api);
    else plugin.register(api);
  }
  const quest = runtime.getRegisteredQuests().at(-1);
  const driver = {
    api, hooks, events, tasks, npcs, removed, objects, clicks, namedObjects, namedNpcs, quest,
    variant(player, npcId) {
      for (const fn of hooks.onNpcDialogueVariant ?? []) {
        const result = fn({ player, npcId, npc: null, definition: { getName: () => '' } });
        if (result) return result;
      }
      return null;
    },
    answer(player, stepId, npcId = GORDON) {
      for (const fn of hooks.onNpcDialogueCondition ?? []) {
        const result = fn({ player, stepId, npcId, text: '' });
        if (result !== null && result !== undefined) return result;
      }
      return null;
    },
    line(player, npcId, text) {
      const event = { player, npcId, text };
      (events['npc-dialogue:line'] ?? []).forEach(fn => fn(event));
      // NpcDialogues runs a line's `before` hook as the line is reached.
      if (typeof event.before === 'function') event.before();
      return event;
    },
    action(player, npcId, stepId) {
      const event = { player, npcId, stepId, text: '', kind: 'action', handled: false };
      (events['npc-dialogue:action'] ?? []).forEach(fn => fn(event));
      return event;
    },
    startHook(player, npcId = GORDON) {
      (events['npc-dialogue:hook'] ?? []).forEach(fn =>
        fn({ player, npcId, hook: 'quest:getting-ahead:start' }));
    },
    itemOnObject(player, itemId, objectId, x, y) {
      const event = { player, itemId, objectId, location: new core.Location(x, y, 0), handled: false };
      (hooks.onItemOnObject ?? []).forEach(fn => fn(event));
      return event;
    },
    itemOnItem(player, usedItemId, usedWithItemId) {
      const event = { player, usedItemId, usedWithItemId, handled: false };
      (hooks.onItemOnItem ?? []).forEach(fn => fn(event));
      return event;
    },
    itemOnNpc(player, npcId, itemId) {
      const event = { player, npcId, itemId, handled: false };
      (hooks.onItemOnNpc ?? []).forEach(fn => fn(event));
      return event;
    },
    build(player) {
      const actions = namedObjects.get('Mounted Head Space');
      assert.ok(actions?.Build, 'Mounted Head Space Build is registered');
      actions.Build({ player, objectId: 20858, location: new core.Location(1240, 3683, 0), handled: false });
    },
    tradeMary(player, npcId = N.MARY_3) {
      const actions = namedNpcs.get('Mary');
      assert.ok(actions?.Trade, 'Mary Trade is registered');
      actions.Trade({ player, npcId, npc: null, handled: false });
    },
    login(player) { (hooks.onPlayerLogin ?? []).forEach(fn => fn({ player })); },
    logout(player) { (hooks.onPlayerLogout ?? []).forEach(fn => fn({ player })); },
    loginReplay(player) { runtime.sendQuestVarps({ player }); },
    tick(count = 1) { while (count-- > 0) for (const task of [...tasks]) task.tick(); },
    choose(player, label) {
      const prompt = player.prompt;
      assert.ok(prompt, `no menu for ${label}`);
      const index = prompt.options.indexOf(label);
      assert.ok(index >= 0, `missing ${label} in ${prompt.options.join(', ')}`);
      player.prompt = null;
      prompt.pairs[index * 2 + 1]();
    },
  };
  return driver;
}

function player() {
  const attrs = new Map(), items = new Map(), configs = new Map(), varbits = new Map();
  const xp = [], messages = [], animations = [], dialogueTexts = [];
  let location = new core.Location(1248, 3686, 0), area = null, text = '', prompt = null, full = false, offline = false;
  let manager;
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    getFreeSlots: () => full ? 0 : 28 - items.size,
    isFull() { return full || items.size >= 28; },
    getItems: () => [...items].map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
    adds(id, amount) {
      assert.ok(!full || items.has(id), 'inventory full');
      items.set(id, (items.get(id) ?? 0) + amount);
    },
    deleteNumber(id, amount) {
      assert.ok((items.get(id) ?? 0) >= amount, `missing item ${id}`);
      const left = items.get(id) - amount;
      if (left > 0) items.set(id, left);
      else items.delete(id);
    },
    getSlotForItemId(id) {
      if (!items.has(id)) return -1;
      return [...items.keys()].indexOf(id);
    },
    setItem(slot, item) {
      const oldId = [...items.keys()][slot];
      if (oldId !== undefined) items.delete(oldId);
      items.set(item.getId(), item.getAmount());
      return inventory;
    },
    refreshItems() { return inventory; },
    clear() { items.clear(); },
    setFull(value) { full = value; },
  };
  const equipment = { get: () => null };
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; },
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    getVarbit: id => varbits.get(id) ?? 0,
    getVarp: id => configs.get(id) ?? 0,
    sendString(value) { text = value; dialogueTexts.push(value); return packet; },
    sendInterfaceRemoval() { manager.reset(); prompt = null; return packet; },
  }, { get: (target, key) => target[key] ?? ((...args) => packet) });
  const p = {
    attrs, items, configs, varbits, xp, messages, animations, dialogueTexts, inventory, equipment,
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => equipment,
    getPacketSender: () => packet,
    getDialogueManager: () => manager,
    getSkillManager: () => ({
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
      getMaxLevel: () => 99,
      getCurrentLevel: () => 99,
    }),
    getMovementQueue: () => {
      const queue = {
        reset() { return queue; },
        setBlockMovement() { return queue; },
        addSteps(to) { location = to; return queue; },
      };
      return queue;
    },
    getLocation: () => location,
    moveTo: to => { location = to; },
    getArea: () => area,
    setArea: value => { area = value; },
    getPrivateArea: () => area,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => p,
    isRegistered: () => !offline,
    getUsername: () => 'q049',
    getIndex: () => p.index,
    index: nextIndex++,
    setUntargetable: noop,
    setPositionToFace: noop,
    performAnimation: animation => animations.push(animation.getId()),
    sendMessage: message => messages.push(message),
    getCombat: () => ({ reset: noop }),
    getHitpoints: () => 99,
    setOffline(value) { offline = value; },
  };
  manager = new DialogueManager(p);
  Object.defineProperty(p, 'text', { get: () => text, set: value => { text = value; } });
  Object.defineProperty(p, 'prompt', { get: () => prompt, set: value => { prompt = value; } });
  Object.defineProperty(p, 'manager', { get: () => manager });
  return p;
}

test('Getting Ahead wire contract and fresh stage 0 -> Mary', () => {
  const h = harness(), p = player();
  assert.equal(h.quest.key, 'getting_ahead');
  assert.equal(h.quest.varbitId, VARBIT);
  assert.equal(h.quest.completionValue, STAGE.complete);
  assert.equal(h.quest.getStage(p), 0);
  assert.equal(h.quest.isComplete(p), false);

  const fresh = h.variant(p, GORDON);
  assert.deepEqual(fresh, { page: 'Getting Ahead', variant: 'a-strange-event-talking-to-gordon' });
  h.startHook(p);
  assert.equal(h.quest.getStage(p), STAGE.start);
  assert.equal(p.varbits.get(VARBIT), STAGE.start);
  assert.deepEqual(h.variant(p, GORDON), {
    page: 'Getting Ahead', variant: 'a-strange-event-talking-to-gordon-talking-to-gordon-again-after-starting-the-quest',
  });

  const maryTalk = h.variant(p, MARY);
  assert.deepEqual(maryTalk, { page: 'Getting Ahead', variant: 'a-strange-event-talking-to-mary' });
  h.line(p, MARY, "Oh! I have an idea! If this beast ended up getting coated in flour, it wouldn't be hard for you to track it back to its home.");
  assert.equal(h.quest.getStage(p), STAGE.mary);
  assert.equal(p.varbits.get(VARBIT), STAGE.mary);
  assert.deepEqual(h.variant(p, GORDON), {
    page: 'Getting Ahead', variant: 'a-strange-event-talking-to-gordon-after-talking-to-mary',
  });
});

test('Getting Ahead flour pour, overnight, and stage-8 login recovery', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, STAGE.mary);
  p.inventory.adds(I.POT_OF_FLOUR, 1);

  h.itemOnObject(p, I.POT_OF_FLOUR, 40427, 1257, 3686);
  assert.equal(h.quest.getStage(p), STAGE.poured, 'the durable stage after pouring flour is 8');
  assert.equal(p.varbits.get(VARBIT), STAGE.poured);
  assert.equal(p.inventory.getAmount(I.POT_OF_FLOUR), 0);
  assert.equal(p.inventory.getAmount(I.POT), 1);

  h.action(p, GORDON, 'pL8hVR');
  assert.equal(h.quest.getStage(p), STAGE.poured);
  const overnight = h.action(p, GORDON, '7aXCpS');
  assert.equal(overnight.end, true, 'the timed overnight transition ends the current transcript');
  h.tick(2);
  assert.equal(h.quest.getStage(p), STAGE.trail);
  assert.equal(p.varbits.get(VARBIT), STAGE.trail);
  h.tick(4);
  assert.equal(p.dialogueTexts.filter(text => text === 'You head off for the night and come back the next day.').length, 1,
    'the night transition statement is displayed once');
  h.loginReplay(p);
  assert.equal(p.varbits.get(VARBIT), STAGE.trail, 'login replay sends the saved stage in varbit 693');

  const saved = harness(), q = player();
  saved.quest.setStage(q, STAGE.poured);
  assert.equal(q.varbits.get(VARBIT), STAGE.poured);
  saved.login(q);
  assert.equal(saved.quest.getStage(q), STAGE.poured, 'stage 8 is the durable interruption point');
  saved.tick(3);
  assert.equal(saved.quest.getStage(q), STAGE.trail);
  assert.equal(q.varbits.get(VARBIT), STAGE.trail);
  saved.loginReplay(q);
  assert.equal(q.varbits.get(VARBIT), STAGE.trail);
});

test('Getting Ahead fake-head creation consumes the Quest Helper items', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, STAGE.maryFake);
  p.inventory.adds(I.KNIFE, 1);
  p.inventory.adds(I.SOFT_CLAY, 1);
  h.itemOnItem(p, I.KNIFE, I.SOFT_CLAY);
  h.choose(p, 'Yes.');
  assert.equal(p.inventory.getAmount(I.SOFT_CLAY), 0);
  assert.equal(p.inventory.getAmount(I.CLAY_HEAD), 1);
  h.action(p, GORDON, 'wT3s4c');
  assert.equal(h.quest.getStage(p), STAGE.clayMade);

  h.quest.setStage(p, STAGE.clayShown);
  p.inventory.adds(I.FUR, 1);
  p.inventory.adds(I.NEEDLE, 1);
  p.inventory.adds(I.THREAD, 1);
  h.itemOnItem(p, I.CLAY_HEAD, I.FUR);
  h.choose(p, 'Yes.');
  assert.equal(p.inventory.getAmount(I.CLAY_HEAD), 0);
  assert.equal(p.inventory.getAmount(I.FUR), 0);
  assert.equal(p.inventory.getAmount(I.THREAD), 0);
  assert.equal(p.inventory.getAmount(I.NEEDLE), 1, 'the needle is reusable');
  assert.equal(p.inventory.getAmount(I.FUR_HEAD), 1);
  h.action(p, GORDON, '9iNdir');
  assert.equal(h.quest.getStage(p), STAGE.furMade);

  h.quest.setStage(p, STAGE.furShown);
  p.inventory.adds(I.RED_DYE, 1);
  h.itemOnItem(p, I.FUR_HEAD, I.RED_DYE);
  h.choose(p, 'Yes.');
  assert.equal(p.inventory.getAmount(I.FUR_HEAD), 0);
  assert.equal(p.inventory.getAmount(I.RED_DYE), 0);
  assert.equal(p.inventory.getAmount(I.BLOODY_HEAD), 1);
  h.action(p, GORDON, '_RfAUL');
  assert.equal(h.quest.getStage(p), STAGE.bloodyMade);
});

test('Getting Ahead remakes a lost shown head at the next craft stage', () => {
  const h = harness(), p = player();

  // Stage 22: the clay head was shown and then lost. The same knife + soft-clay
  // recipe must still make the clay head needed for the fur-head step.
  h.quest.setStage(p, STAGE.clayShown);
  p.items.clear();
  p.prompt = null;
  p.inventory.adds(I.KNIFE, 1);
  p.inventory.adds(I.SOFT_CLAY, 1);
  const clayAt22 = h.itemOnItem(p, I.KNIFE, I.SOFT_CLAY);
  assert.equal(clayAt22.handled, true, 'clay head remake is available at stage 22');
  h.choose(p, 'Yes.');
  assert.equal(p.inventory.getAmount(I.SOFT_CLAY), 0);
  assert.equal(p.inventory.getAmount(I.CLAY_HEAD), 1);
  assert.equal(h.quest.getStage(p), STAGE.clayShown);
  p.inventory.adds(I.FUR, 1);
  p.inventory.adds(I.NEEDLE, 1);
  p.inventory.adds(I.THREAD, 1);
  const furAt22 = h.itemOnItem(p, I.CLAY_HEAD, I.FUR);
  assert.equal(furAt22.handled, true, 'the remade clay head can become the fur head at stage 22');
  h.choose(p, 'Yes.');
  assert.equal(p.inventory.getAmount(I.FUR_HEAD), 1);

  // Stage 26: the fur head was shown and lost, and no clay head is left.
  h.quest.setStage(p, STAGE.furShown);
  p.items.clear();
  p.prompt = null;
  p.inventory.adds(I.KNIFE, 1);
  p.inventory.adds(I.SOFT_CLAY, 1);
  const clayAt26 = h.itemOnItem(p, I.KNIFE, I.SOFT_CLAY);
  assert.equal(clayAt26.handled, true, 'clay head remake is available at stage 26');
  h.choose(p, 'Yes.');
  p.inventory.adds(I.FUR, 1);
  p.inventory.adds(I.NEEDLE, 1);
  p.inventory.adds(I.THREAD, 1);
  const furAt26 = h.itemOnItem(p, I.CLAY_HEAD, I.FUR);
  assert.equal(furAt26.handled, true);
  h.choose(p, 'Yes.');
  p.inventory.adds(I.RED_DYE, 1);
  const bloodAt26 = h.itemOnItem(p, I.FUR_HEAD, I.RED_DYE);
  assert.equal(bloodAt26.handled, true, 'the remade fur head can become bloody at stage 26');
  h.choose(p, 'Yes.');
  assert.equal(p.inventory.getAmount(I.BLOODY_HEAD), 1);

  // Stage 30: the bloody head was shown and lost.
  h.quest.setStage(p, STAGE.bloodyShown);
  p.items.clear();
  p.prompt = null;
  p.inventory.adds(I.FUR_HEAD, 1);
  p.inventory.adds(I.RED_DYE, 1);
  const bloodAt30 = h.itemOnItem(p, I.FUR_HEAD, I.RED_DYE);
  assert.equal(bloodAt30.handled, true, 'bloody head remake is available at stage 30');
  h.choose(p, 'Yes.');
  assert.equal(p.inventory.getAmount(I.BLOODY_HEAD), 1);
  assert.equal(h.quest.getStage(p), STAGE.bloodyShown);

  // Negatives: no head crafting after mounting, and each recipe stays closed
  // before its helper window.
  h.quest.setStage(p, STAGE.mounted);
  p.items.clear();
  p.prompt = null;
  p.inventory.adds(I.KNIFE, 1);
  p.inventory.adds(I.SOFT_CLAY, 1);
  assert.notEqual(h.itemOnItem(p, I.KNIFE, I.SOFT_CLAY).handled, true, 'no clay head after mounting');
  p.inventory.adds(I.CLAY_HEAD, 1);
  p.inventory.adds(I.FUR, 1);
  assert.notEqual(h.itemOnItem(p, I.CLAY_HEAD, I.FUR).handled, true, 'no fur head after mounting');
  p.inventory.adds(I.FUR_HEAD, 1);
  p.inventory.adds(I.RED_DYE, 1);
  assert.notEqual(h.itemOnItem(p, I.FUR_HEAD, I.RED_DYE).handled, true, 'no bloody head after mounting');

  h.quest.setStage(p, STAGE.clayMade);
  p.items.clear();
  p.prompt = null;
  p.inventory.adds(I.CLAY_HEAD, 1);
  p.inventory.adds(I.FUR, 1);
  assert.notEqual(h.itemOnItem(p, I.CLAY_HEAD, I.FUR).handled, true, 'fur before the clay head is shown');
  p.items.clear();
  p.prompt = null;
  p.inventory.adds(I.FUR_HEAD, 1);
  p.inventory.adds(I.RED_DYE, 1);
  assert.notEqual(h.itemOnItem(p, I.FUR_HEAD, I.RED_DYE).handled, true, 'dye before the fur head is shown');
  p.items.clear();
  p.prompt = null;
  p.inventory.adds(I.KNIFE, 1);
  p.inventory.adds(I.CLAY, 1);
  assert.notEqual(h.itemOnItem(p, I.KNIFE, I.CLAY).handled, true, 'knife on hard clay is not the quest recipe');
});

test('Getting Ahead gives each head to Gordon at the helper stage window', () => {
  const h = harness(), p = player();
  for (const [stage, item, shownStage] of [
    [STAGE.clayMade, I.CLAY_HEAD, STAGE.clayShown],
    [STAGE.furMade, I.FUR_HEAD, STAGE.furShown],
    [STAGE.bloodyMade, I.BLOODY_HEAD, STAGE.bloodyShown],
  ]) {
    h.quest.setStage(p, stage);
    p.items.clear();
    p.inventory.adds(item, 1);
    const event = h.itemOnNpc(p, GORDON, item);
    assert.equal(event.handled, true, `showing item ${item} at stage ${stage}`);
    const line = {
      [STAGE.clayMade]: "Quite rare because they don't exist! I'm no fool, this is clearly a pretend head! It doesn't even have any fur!",
      [STAGE.furMade]: "You must take me for an idiot! This is some head you bought from a taxidermist or something. It's clearly not a fresh kill!",
      [STAGE.bloodyMade]: "A head like this deserves a place of honour! My friend, please could you mount it in our home?",
    }[stage];
    h.line(p, GORDON, line);
    assert.equal(h.quest.getStage(p), shownStage);
    assert.equal(p.varbits.get(VARBIT), shownStage);
  }
  h.quest.setStage(p, STAGE.clayShown);
  p.items.clear();
  p.inventory.adds(I.CLAY_HEAD, 1);
  const late = h.itemOnNpc(p, GORDON, I.CLAY_HEAD);
  assert.notEqual(late.handled, true, 'a clay head outside its stage window does not advance');
});

test('Getting Ahead resumes an older flour-pouring save without another pot', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, 6);
  h.login(p);
  assert.equal(h.quest.getStage(p), STAGE.poured);
  assert.equal(p.inventory.getAmount(I.POT_OF_FLOUR), 0);
  h.tick(3);
  assert.equal(h.quest.getStage(p), STAGE.trail);
});

test('Getting Ahead mounts the bloody head and completes once with the canonical wire value', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, STAGE.bloodyShown);
  p.inventory.adds(I.BLOODY_HEAD, 1);
  p.inventory.adds(I.PLANK, 2);
  p.inventory.adds(I.IRON_NAILS, 10);
  p.inventory.adds(I.HAMMER, 1);
  p.inventory.adds(I.SAW, 1);
  h.build(p);
  h.tick(40);
  assert.equal(h.quest.getStage(p), STAGE.mounted);
  assert.equal(p.varbits.get(VARBIT), STAGE.mounted);
  assert.equal(p.inventory.getAmount(I.BLOODY_HEAD), 0);
  assert.equal(p.inventory.getAmount(I.PLANK), 0);
  assert.ok(p.inventory.getAmount(I.IRON_NAILS) <= 4, 'six nails were used');

  h.quest.setStage(p, STAGE.mounted);
  const rewardLine = "That's great! I'd say it's about time for your reward. But first, let's have a look at this head...";
  const line = h.line(p, GORDON, rewardLine);
  assert.equal(typeof line.after, 'function');
  line.after();
  h.tick(30);
  assert.equal(h.quest.getStage(p), STAGE.complete);
  assert.equal(p.varbits.get(VARBIT), STAGE.complete, 'varbit 693 reaches the cache completion threshold');
  assert.deepEqual(p.xp, [
    [core.Skill.CRAFTING.getIndex(), 4000],
    [core.Skill.CONSTRUCTION.getIndex(), 3200],
  ]);
  assert.equal(p.inventory.getAmount(I.COINS), 3000);
  assert.equal(p.attrs.get('quest.points'), 1);
  assert.ok(p.messages.some(message => /completed a quest: .*Getting Ahead/.test(message)));
  p.varbits.delete(VARBIT);
  p.varbits.delete(694);
  h.login(p);
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.varbits.get(VARBIT), STAGE.complete, 'registered player login replays completed stage 34');
  assert.equal(p.varbits.get(694), 1, 'registered player login restores the claimed coin reward bit');
  p.varbits.set(694, 0);
  h.api.emitCustomEvent('player:bootstrap-complete', { player: p });
  assert.equal(p.varbits.get(694), 1, 'bootstrap restores the earned reward bit after login defaults');
  assert.equal(p.attrs.get('getting-ahead:coins-claimed'), 1);
  assert.equal(h.answer(p, 'Ve-vo0'), true, 'Gordon selects the already-received reward branch after login');
  assert.equal(h.answer(p, 'ybriIj'), false);

  const xpAfter = p.xp.length;
  const repeated = h.line(p, GORDON, rewardLine);
  if (typeof repeated.after === 'function') repeated.after();
  h.tick(30);
  assert.equal(p.inventory.getAmount(I.COINS), 3000, 'the reward is not duplicated');
  assert.equal(p.xp.length, xpAfter);
  assert.equal(p.attrs.get('quest.points'), 1);
});

test('Getting Ahead migrates completed saves with no pending coins to the claimed state on login', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, STAGE.complete);
  p.attrs.delete('getting-ahead:coins-claimed');
  p.attrs.delete('quest.getting_ahead.coins-pending');
  p.varbits.delete(694);
  h.login(p);
  assert.equal(p.attrs.get('getting-ahead:coins-claimed'), 1);
  assert.equal(p.varbits.get(694), 1);
  assert.equal(h.answer(p, 'Ve-vo0'), true);
  assert.equal(h.answer(p, 'ybriIj'), false);
});

test('Getting Ahead holds the coin reward when the bag is full and reclaims it from Gordon', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, STAGE.mounted);
  p.inventory.setFull(true);
  const line = h.line(p, GORDON, "That's great! I'd say it's about time for your reward. But first, let's have a look at this head...");
  line.after();
  h.tick(30);
  assert.equal(h.quest.getStage(p), STAGE.complete);
  assert.equal(p.inventory.getAmount(I.COINS), 0);
  assert.equal(p.attrs.get('quest.getting_ahead.coins-pending'), 1);
  p.varbits.delete(694);
  h.login(p);
  assert.equal(p.varbits.get(694), 0, 'login leaves the claim bit clear while the coins are pending');
  assert.equal(h.answer(p, 'ybriIj'), true, 'Gordon offers the outstanding coins');
  p.inventory.setFull(false);
  h.action(p, GORDON, 'eJJth4');
  assert.equal(p.inventory.getAmount(I.COINS), 3000);
  assert.equal(p.attrs.get('quest.getting_ahead.coins-pending'), 0);
  assert.equal(p.attrs.get('getting-ahead:coins-claimed'), 1);
  p.varbits.delete(694);
  h.login(p);
  assert.equal(p.varbits.get(694), 1, 'the claimed bit survives a later registered login');
  assert.equal(h.answer(p, 'ybriIj'), false);
  assert.equal(h.answer(p, 'Ve-vo0'), true);
});

test('Getting Ahead post-quest Mary unlocks tanning and the Trade route', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, STAGE.complete);
  const variant = h.variant(p, MARY);
  assert.deepEqual(variant, { page: 'Mary (Getting Ahead)', variant: 'standard-dialogue-after-completing-getting-ahead' });
  h.line(p, MARY, "Not to worry. If it keeps Gordon happy, so be it. Anyway, thank you for keeping our farm safe. With the beast dealt with, I've been able to get back to tanning again.");
  assert.equal(p.attrs.get('getting-ahead:tanning-unlocked'), 1);
  assert.equal(p.varbits.get(696), 1);
  const tanning = [];
  (h.events['tanning:open'] ??= []).push(event => tanning.push(event));
  h.action(p, MARY, 'cUU4Bn');
  h.tick(1);
  assert.equal(tanning.length, 1);
  assert.deepEqual(h.variant(p, MARY), {
    page: 'Mary (Getting Ahead)', variant: 'standard-dialogue-after-completing-getting-ahead-after-unlocking-tanning',
  });
  h.tradeMary(p);
  assert.equal(tanning.length, 2, 'the Trade option opens the same tanning route');
});

test('WaterSources fills an empty bucket at the Getting Ahead farmhouse sink', () => {
  const h = harness(['../plugins/world/WaterSources.plugin.js']);
  const p = player();
  p.inventory.adds(I.BUCKET, 1);
  const event = h.itemOnObject(p, I.BUCKET, 1763, 1239, 3677);
  assert.equal(event.handled, true);
  assert.equal(p.inventory.getAmount(I.BUCKET), 0);
  assert.equal(p.inventory.getAmount(I.BUCKET_OF_WATER), 1);
  assert.ok(p.animations.includes(832), 'human_pickuptable fill animation');
  assert.ok(p.messages.some(message => /You fill the bucket from the sink\./.test(message)));
  h.tick(2);
  assert.equal(p.inventory.getAmount(I.BUCKET_OF_WATER), 1, 'the repeat task stops with no empty bucket left');
});
