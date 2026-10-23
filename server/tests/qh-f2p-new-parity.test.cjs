// Quest Helper parity for Below Ice Mountain and The Ides of Milk.
// Run from server/: node --test tests/qh-f2p-new-parity.test.cjs
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function register(name, key) {
  const variants = [], conditions = [], custom = new Map(), packets = [];
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant: (fn) => variants.push(fn),
    onNpcDialogueCondition: (fn) => conditions.push(fn),
    onCustomEvent: (event, fn) => {
      if (!custom.has(event)) custom.set(event, []);
      custom.get(event).push(fn);
    },
    emitCustomEvent: (event, payload) => { for (const fn of custom.get(event) ?? []) fn(payload); },
  }, { get: (target, prop) => prop in target ? target[prop] : () => {} });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  return {
    quest: getRegisteredQuests().findLast((quest) => quest.key === key),
    variant: (npcId, player) => variants.map((fn) => fn({ player, npcId })).find(Boolean) ?? null,
    condition: (event) => conditions.map((fn) => fn(event)).find((answer) => answer !== null && answer !== undefined) ?? null,
    emit: (event, payload) => api.emitCustomEvent(event, payload),
    packets,
  };
}

function talkWorld(key) {
  const variants = [], conditions = [], custom = new Map(), interactions = {}, namedNpcs = new Map(), spoken = [], messages = [];
  const dispatchedActions = [];
  let selectedOption = null, interceptedAction = null;
  const installed = { variants: 0, conditions: 0 };
  const api = new Proxy({
    core,
    persistAttribute() {}, registerArea() {}, registerNpcCombatMethodProvider() {},
    onNpcDialogueVariant: (fn) => {
      variants.push(fn);
      PluginManager.npcDialogueVariantHooks.push({ pluginName: 'qh-f2p-new-test', handler: fn });
      installed.variants++;
    },
    onNpcDialogueCondition: (fn) => {
      conditions.push(fn);
      PluginManager.npcDialogueConditionHooks.push({ pluginName: 'qh-f2p-new-test', handler: fn });
      installed.conditions++;
    },
    onCustomEvent: (event, fn) => {
      if (!custom.has(event)) custom.set(event, []);
      custom.get(event).push(fn);
    },
    onNpcInteraction: (name, actions) => namedNpcs.set(name, actions),
    emitCustomEvent: (event, payload) => {
      if (event === 'npc-dialogue:action' && payload.stepId === interceptedAction) {
        dispatchedActions.push(payload.stepId);
        payload.handled = true;
        payload.end = true;
        return;
      }
      for (const fn of custom.get(event) ?? []) fn(payload);
    },
    onAnyNpcInteraction: (actions) => Object.assign(interactions, actions),
    sendMultiChatboxPrompt: (_player, _prompt, ...pairs) => {
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push({ text: String(pairs[i]), select: pairs[i + 1] });
      (options.find((option) => selectedOption && option.text === selectedOption)
        ?? options.find((option) => /fine|goodbye/i.test(option.text)) ?? options.at(-1))?.select();
      return true;
    },
  }, { get: (target, prop) => prop in target ? target[prop] : () => {} });
  require(`../plugins/quests/quests/${key === 'the_ides_of_milk' ? 'IdesOfMilk' : 'BelowIceMountain'}.Quest`)(api);
  const quest = getRegisteredQuests().findLast((entry) => entry.key === key);
  require('../plugins/npcs/NpcDialogues.plugin').register(api);

  function dialogueManager(p) {
    let generation = 0;
    const manager = {
      entries: [], index: -1,
      reset() { this.entries = []; this.index = -1; },
      getCurrent() { return this.entries[this.index]; },
      isActive() { return false; },
      advance() {},
      startDialogues(chain) {
        const entries = [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex());
        const mine = ++generation;
        this.entries = entries; this.index = 0;
        while (generation === mine && this.index < entries.length) {
          const entry = entries[this.index++];
          if (typeof entry.getText === 'function') spoken.push(entry.getText());
          entry.send(p);
        }
        if (generation === mine) this.reset();
      },
    };
    return manager;
  }

  function player() {
    const attributes = new Map(), items = new Map(), varbits = new Map(), packets = [], equipment = [];
    let free = 28, manager, location = new core.Location(3254, 3274, 0);
    const sender = new Proxy({ sendVarbit: (id, value) => { varbits.set(id, value); return sender; } }, {
      get: (target, key) => key in target ? target[key] : (...args) => { packets.push([key, ...args]); return sender; },
    });
    const inventory = {
      getAmount: (id) => items.get(id) ?? 0, getFreeSlots: () => free, isFull: () => free <= 0,
      adds(id, amount = 1) {
        assert.ok(free >= amount, `no inventory space for ${id}`);
        items.set(id, (items.get(id) ?? 0) + amount); free -= amount;
      },
      deleteNumber(id, amount = 1) {
        assert.ok((items.get(id) ?? 0) >= amount, `missing ${id}`);
        const left = (items.get(id) ?? 0) - amount;
        if (left) items.set(id, left); else items.delete(id);
        free += amount;
      },
    };
    const p = {
      attributes, items, varbits, packets, equipment, getFreeSlots: () => free,
      getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
      getInventory: () => inventory,
      getEquipment: () => ({
        get: () => null, getItems: () => equipment, refreshItems() {},
        getAmount: (id) => equipment.filter((item) => item.getId() === id).length,
      }),
      getPacketSender: () => sender,
      getDialogueManager: () => manager,
      getSkillManager: () => ({ getCurrentLevel: () => 99, getMaxLevel: () => 10, getCombatLevel: () => 20 }),
      getLocation: () => location, moveTo: (value) => { location = value; },
      getUsername: () => 'QhParity', getAppearance: () => ({ isMale: () => true }), isIronman: () => false,
      sendMessage: (text) => messages.push(text), isRegistered: () => true,
      getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }),
      getCombat: () => ({ reset() {} }), setUntargetable() {}, performAnimation() {},
    };
    manager = dialogueManager(p);
    return p;
  }

  return {
    quest, player, interactions, spoken, messages, dispatchedActions,
    choose(option) { selectedOption = option; },
    interceptAction(stepId) { interceptedAction = stepId; },
    talk(p, npcId) {
      const definition = core.NpcDefinition.forId(npcId);
      const event = { player: p, npc: { getId: () => npcId, getName: () => definition.getName() }, npcId, definition };
      return namedNpcs.get(definition.getName())?.['Talk-to']?.(event)
        ?? interactions['Talk-to'](event);
    },
    cleanup() {
      if (installed.variants) PluginManager.npcDialogueVariantHooks.splice(-installed.variants);
      if (installed.conditions) PluginManager.npcDialogueConditionHooks.splice(-installed.conditions);
    },
  };
}

function player() {
  const attributes = new Map(), items = new Map();
  let location = new core.Location(3200, 3400, 0), free = 28, strength = 99, ironman = false;
  const sender = new Proxy({ sendVarbit: (id, value) => { p.varbits.set(id, value); return sender; } }, {
    get: (target, key) => key in target ? target[key] : () => sender,
  });
  const p = {
    attributes, items, varbits: new Map(), messages: [],
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0, isFull: () => free <= 0, getFreeSlots: () => free,
      adds: (id, amount) => items.set(id, (items.get(id) ?? 0) + amount),
      deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)),
    }),
    getEquipment: () => ({ get: () => null, getAmount: () => 0 }),
    getSkillManager: () => ({ getCurrentLevel: () => strength, getMaxLevel: () => 10, getCombatLevel: () => 20 }),
    getLocation: () => location, moveTo: (value) => { location = value; },
    getPacketSender: () => sender, isIronman: () => ironman,
    sendMessage: (text) => p.messages.push(text),
    getDialogueManager: () => ({ reset() {}, startDialogues() {} }),
    setFreeSlots(value) { free = value; }, setStrength(value) { strength = value; }, setIronman(value) { ironman = value; },
  };
  return p;
}

test('Below Ice Mountain covers every QH recruitment state and its last-member branches', () => {
  const q = register('BelowIceMountain', 'below_ice_mountain'), p = player();
  const C = 'quest.below_ice_mountain.checkal', M = 'quest.below_ice_mountain.marley', B = 'quest.below_ice_mountain.burntof';
  const progress = (value) => p.setAttribute('below-ice-mountain:progress', value);
  const variant = (npcId) => q.variant(npcId, p);

  q.quest.setStage(p, 0);
  assert.equal(variant(N.WILLOW), 'willow-the-archaeologist-talking-to-willow');

  q.quest.setStage(p, 1);
  progress(5); assert.equal(variant(N.WILLOW), 'willow-the-archaeologist-talking-to-willow');
  progress(7); assert.equal(variant(N.WILLOW), 'willow-the-archaeologist-talking-to-willow');
  progress(10); assert.equal(variant(N.WILLOW), 'willow-the-archaeologist-talking-to-willow-again');

  p.setAttribute(C, 5);
  assert.equal(variant(N.CHECKAL), 'checkal-the-strongman-talking-to-checkal-talking-to-checkal-again');
  p.setAttribute('quest.below_ice_mountain.atlas-sessions', 1); p.setAttribute(C, 15);
  assert.equal(variant(N.CHECKAL), 'checkal-the-strongman-talking-to-checkal-after-completing-atlas-training');
  p.setAttribute(C, 20);
  assert.equal(variant(N.CHECKAL), 'checkal-the-strongman-talking-to-checkal-again-before-showing-muscles');
  p.setAttribute(C, 40);
  assert.equal(variant(N.CHECKAL), 'checkal-the-strongman-talking-to-checkal-again-before-showing-muscles-talking-to-checkal-at-ice-mountain');

  p.setAttribute(M, 5);
  assert.equal(variant(N.MARLEY), 'marley-the-thief-talking-to-marley-talking-to-marley-again');
  p.setAttribute(M, 35);
  assert.equal(variant(N.MARLEY), 'marley-the-thief-returning-to-marley');
  p.setAttribute(M, 40);
  assert.equal(variant(N.MARLEY), 'marley-the-thief-returning-to-marley-talking-to-marley-at-ice-mountain');

  p.setAttribute(B, 5);
  assert.equal(variant(N.BURNTOF), 'burntof-master-of-explosives-talking-to-burntof-again-before-he-gets-a-beer');
  p.setAttribute(B, 10);
  assert.equal(variant(N.BURNTOF), 'burntof-master-of-explosives-rock-paper-scissors');
  p.setAttribute(B, 15);
  assert.equal(variant(N.BURNTOF_2), 'burntof-master-of-explosives-rock-paper-scissors');
  p.setAttribute(B, 40);
  assert.equal(variant(N.BURNTOF), 'burntof-master-of-explosives-talking-to-burntof-at-ice-mountain');

  q.quest.setStage(p, 2);
  progress(20); assert.equal(variant(N.WILLOW), 'the-ruins-of-camdozaal-talking-to-willow');
  progress(25); assert.equal(variant(N.WILLOW), 'the-ruins-of-camdozaal-talking-to-willow-talking-to-willow-again-if-the-player-chose-no');

  // Each crew member's line checks the *other* two, so the final recruit sees the
  // QH "this was the last member" branch even though its own state is not 40 yet.
  const last = (npcId, current, drop, lastId, otherId) => {
    p.setAttribute(C, 40); p.setAttribute(M, 40); p.setAttribute(B, 40); p.setAttribute(current, 20);
    assert.equal(q.condition({ player: p, npcId, stepId: lastId }), true);
    assert.equal(q.condition({ player: p, npcId, stepId: otherId }), false);
    p.setAttribute(drop, 0);
    assert.equal(q.condition({ player: p, npcId, stepId: lastId }), false);
    assert.equal(q.condition({ player: p, npcId, stepId: otherId }), true);
  };
  last(N.CHECKAL, C, M, 'RPjNZ9', 'p3MZVl');
  last(N.BURNTOF, B, C, '_wuChA', 'h3U6R5');
  last(N.BURNTOF_2, B, C, '_wuChA', 'h3U6R5');
  last(N.MARLEY, M, C, 'mVCBES', 'Yky2FJ');

  const condition = (stepId) => q.condition({ player: p, npcId: N.ATLAS, stepId });
  p.setStrength(98); assert.equal(condition('CdEohS'), false); assert.equal(condition('YEdgkU'), true);
  p.setStrength(99); assert.equal(condition('CdEohS'), true); assert.equal(condition('YEdgkU'), false);
  p.items.set(I.COINS, 24999); assert.equal(condition('-zuNtr'), false); assert.equal(condition('Z_TXng'), true);
  p.items.set(I.COINS, 25000); assert.equal(condition('-zuNtr'), true); assert.equal(condition('Z_TXng'), false);
  p.items.clear(); assert.equal(condition('EX9T0U'), true); assert.equal(condition('L2PHG2'), false);
  p.items.set(I.ASGARNIAN_ALE, 1); assert.equal(condition('EX9T0U'), false); assert.equal(condition('L2PHG2'), true);
});

test('Atlas Talk-to dispatches its canonical training transcript', () => {
  const w = talkWorld('below_ice_mountain'), p = w.player();
  w.quest.setStage(p, 1);
  p.setAttribute('quest.below_ice_mountain.checkal', 5);
  w.interceptAction('_RwWTk');
  w.choose('Yes.');

  assert.equal(w.talk(p, N.ATLAS), true);
  assert.ok(w.spoken.includes('What do you want, little man?'));
  assert.ok(w.spoken.some((line) => line.replace(/\s+/g, ' ').includes('No price is too much for a good workout. Are you ready to start your training session?')));
  assert.deepEqual(w.dispatchedActions, ['_RwWTk'], 'the canonical Yes branch dispatches the training-start action');
  assert.equal(p.getAttribute('quest.below_ice_mountain.atlas-sessions'), undefined);
});

test('The Ides of Milk covers every QH stage branch and condition', () => {
  const q = register('IdesOfMilk', 'the_ides_of_milk'), p = player();
  const variant = (npcId) => q.variant(npcId, p);
  const stage = (value) => q.quest.setStage(p, value);

  stage(3);
  assert.equal(variant(N.CASSIUS_2), 'starting-off-talking-to-cassius-again-before-talking-to-both-gillie-and-seth');
  assert.equal(variant(N.GILLIE_GROATS), 'starting-off-talking-to-gillie');
  assert.equal(variant(N.SETH_GROATS), 'starting-off-talking-to-seth');
  p.setAttribute('quest.the_ides_of_milk.seth', 1);
  assert.equal(variant(N.SETH_GROATS), 'starting-off-talking-to-seth-again');

  stage(4); assert.equal(variant(N.CASSIUS_2), 'returning-to-cassius');
  stage(5); assert.equal(variant(N.CASSIUS_2), 'returning-to-cassius-reclaiming-the-milk-sample');
  stage(6);
  assert.equal(variant(N.CASSIUS_2), 'returning-to-cassius-reclaiming-the-milk-sample');
  p.items.set(I.MILK_SAMPLE, 1);
  assert.equal(variant(N.CASSIUS_2), 'returning-to-cassius-talking-to-cassius-before-sampling-the-milk');
  stage(8); assert.equal(variant(N.CASSIUS_2), 'returning-to-cassius-after-sampling-the-milk-resume');
  stage(10);
  assert.equal(variant(N.CASSIUS_2), 'returning-to-cassius-talking-to-cassius-again');
  assert.equal(variant(N.DUKE_HORACIO), 'talking-to-the-duke');
  assert.equal(variant(N.GILLIE_GROATS), null);
  stage(12);
  assert.equal(variant(N.DUKE_HORACIO), 'talking-to-the-duke-talking-to-the-duke-again');
  assert.equal(variant(N.GILLIE_GROATS), 'talking-to-the-duke-talking-to-gillie');
  stage(14); assert.equal(variant(N.GILLIE_GROATS), 'talking-to-the-duke-talking-to-gillie-again');
  stage(16); assert.equal(variant(N.GILLIE_GROATS), 'talking-to-the-duke-drinking-the-second-sample');
  stage(18); assert.equal(variant(N.GILLIE_GROATS), 'talking-to-the-duke-talking-to-gillie-again-2');
  stage(20); assert.equal(variant(N.GILLIE_GROATS), 'facing-the-bull-talking-to-gillie');
  stage(21);
  assert.equal(variant(N.GILLIE_GROATS), 'facing-the-bull-talking-to-gillie-again');
  assert.equal(variant(N.CASSIUS_2), 'facing-the-bull-returning-to-cassius');
  stage(22);
  assert.equal(variant(N.CASSIUS_2), 'post-quest-talking-to-cassius');
  assert.equal(variant(N.GILLIE_GROATS), 'post-quest-talking-to-gillie');

  const condition = (stepId) => q.condition({ player: p, npcId: N.GILLIE_GROATS, stepId });
  p.setAttribute('quest.the_ides_of_milk.seth', 0);
  assert.equal(condition('UGwoXz'), true); assert.equal(condition('P1dfHS'), false);
  p.setAttribute('quest.the_ides_of_milk.seth', 1);
  assert.equal(condition('UGwoXz'), false); assert.equal(condition('P1dfHS'), true);
  p.setIronman(true); assert.equal(condition('iRWhJf'), true); assert.equal(condition('3dp-G-'), false);
  p.setIronman(false); assert.equal(condition('iRWhJf'), false); assert.equal(condition('3dp-G-'), true);

  // QH inventories: the amulet is handed over before the lamp's space check.
  p.items.clear(); p.setFreeSlots(0);
  assert.equal(condition('rQeSSv'), true); assert.equal(condition('m2cjiq'), true); assert.equal(condition('0MczJn'), false);
  p.setFreeSlots(1);
  assert.equal(condition('rQeSSv'), false); assert.equal(condition('m2cjiq'), true); assert.equal(condition('0MczJn'), false);
  p.setFreeSlots(2);
  assert.equal(condition('m2cjiq'), false); assert.equal(condition('0MczJn'), true);
  p.items.set(I.COWBELL_AMULET, 1);
  assert.equal(condition('m2cjiq'), false); assert.equal(condition('0MczJn'), true);

  // The condition registry must advance the Groats information varbit, not just
  // expose a plausible helper.
  q.emit('npc-dialogue:condition', { player: p, stepId: 'UGwoXz' });
  assert.equal(p.getAttribute('quest.the_ides_of_milk.gillie'), 1);
  assert.equal(p.varbits.get(20107), 1);
});

test('real post-quest Gillie Talk-to hands the amulet, then exactly one unused lamp', () => {
  const w = talkWorld('the_ides_of_milk');
  try {
    const p = w.player(), inventory = p.getInventory();
    w.quest.setStage(p, 22);
    inventory.adds(I.SHARK, 27); // 27 non-stackable fillers: one free slot
    assert.equal(p.getFreeSlots(), 1);

    assert.equal(w.talk(p, N.GILLIE_GROATS), true);
    assert.equal(inventory.getAmount(I.COWBELL_AMULET), 1);
    assert.equal(inventory.getAmount(I.MAGIC_LAMP), 0);
    assert.equal(p.getFreeSlots(), 0);
    assert.equal(p.getAttribute('quest.the_ides_of_milk.reward'), 1);
    assert.equal(p.varbits.get(20109), 1);
    assert.ok(w.spoken.some((line) => /inventory is full/i.test(line)), 'the make-room branch must play');
    assert.ok(!w.spoken.some((line) => /Gillie hands you a magical lamp/i.test(line)));

    inventory.deleteNumber(I.SHARK, 1); // make room
    assert.equal(p.getFreeSlots(), 1);
    assert.equal(w.talk(p, N.GILLIE_GROATS), true);
    assert.equal(inventory.getAmount(I.COWBELL_AMULET), 1);
    assert.equal(inventory.getAmount(I.MAGIC_LAMP), 1);
    assert.equal(p.getFreeSlots(), 0);

    const before = [inventory.getAmount(I.COWBELL_AMULET), inventory.getAmount(I.MAGIC_LAMP), p.getFreeSlots()];
    assert.equal(w.talk(p, N.GILLIE_GROATS), true);
    assert.deepEqual([inventory.getAmount(I.COWBELL_AMULET), inventory.getAmount(I.MAGIC_LAMP), p.getFreeSlots()], before);
  } finally {
    w.cleanup();
  }
});

test('Longhall door leaves use the cache open locs and unseal Atlas through real clipping', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
  const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  RegionManager.init();
  for (const [x, y] of [[3078, 3435], [3079, 3435], [3075, 3439], [3074, 3441]]) RegionManager.loadMapFiles(x, y);

  const actions = {};
  const doorCore = {
    ...core, ObjectManager, MapObjects,
    Sounds: { sendSound() {} },
    TaskManager: { submit() {}, cancelTasks() {} },
  };
  delete require.cache[require.resolve('../plugins/objects/Doors.plugin.js')];
  require('../plugins/objects/Doors.plugin.js').register({
    core: doorCore,
    onObjectInteraction: (name, handlers) => { if (name === 'Longhall door') Object.assign(actions, handlers); },
    onRegionLoaded() {}, onServerStartup() {}, onObjectRoute() {}, emitCustomEvent() {},
  });
  assert.equal(typeof actions.Open, 'function', 'Longhall door must reach the Doors dispatch');
  assert.equal(typeof actions.Close, 'function');

  const player = { getPrivateArea: () => null, getLocation: () => new core.Location(3078, 3434, 0) };
  const finder = new RsmodRouteFinding();
  const route = () => finder.findRoute({
    level: 0, srcX: 3078, srcY: 3434, srcSize: 1, destX: 3076, destY: 3438,
    destWidth: 1, destLength: 1, locAngle: 0, locShape: -1, moveNear: false,
    blockAccessFlags: 0, maxWaypoints: 25, privateArea: null,
  });
  const click = (id, x, y, option) => {
    const object = MapObjects.get(id, new core.Location(x, y, 0), null);
    assert.ok(object, `map object ${id}@${x},${y}`);
    actions[option]({
      player, object, objectId: id, definition: { id },
      location: new core.Location(x, y, 0), clickType: 1, handled: false,
    });
  };

  assert.equal(route().success, false, 'closed Longhall leaves seal the Atlas entrance');
  click(11621, 3078, 3435, 'Open');
  click(11620, 3079, 3435, 'Open');
  assert.equal(MapObjects.get(11621, new core.Location(3078, 3435, 0), null), null);
  assert.equal(MapObjects.get(11620, new core.Location(3079, 3435, 0), null), null);
  assert.ok(MapObjects.get(11625, new core.Location(3078, 3436, 0), null), 'west leaf becomes 11625');
  assert.ok(MapObjects.get(11624, new core.Location(3079, 3436, 0), null), 'east leaf becomes 11624');
  assert.equal(route().success, true, 'both open cache leaves clear the threshold');
  assert.deepEqual(route().waypoints.at(-1), { x: 3076, y: 3438, z: 0 });

  click(11625, 3078, 3436, 'Close');
  click(11624, 3079, 3436, 'Close');
  assert.ok(MapObjects.get(11621, new core.Location(3078, 3435, 0), null), 'west leaf closes back to 11621');
  assert.ok(MapObjects.get(11620, new core.Location(3079, 3435, 0), null), 'east leaf closes back to 11620');
  assert.equal(route().success, false, 'closing both leaves seals the entrance again');
});

test('Below post-quest Willow visibility is main-varbit driven at the Nardah spawn', () => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const vars = (value) => ({ getVarp: () => 0, getVarbit: () => value });
  assert.equal(CacheDefinitions.resolveNpc(10638, vars(10))?.id, 10655, 'start Willow before 15');
  assert.equal(CacheDefinitions.resolveNpc(10638, vars(120)), undefined, 'start Willow hides after the betrayal');
  assert.equal(CacheDefinitions.resolveNpc(10639, vars(25))?.id, 10655, 'entrance Willow mid-quest');
  assert.equal(CacheDefinitions.resolveNpc(10639, vars(120)), undefined, 'entrance Willow hides at completion');
  assert.equal(CacheDefinitions.resolveNpc(10641, vars(35)), undefined, 'Nardah parent is hidden mid-quest');
  assert.equal(CacheDefinitions.resolveNpc(10641, vars(120))?.id, 10655, 'Nardah parent resolves to Willow only at main 120');

  const spawns = require('../data/definitions/npc-spawns.json');
  const nardah = spawns.find((spawn) => spawn.name === 'Willow' && spawn.id === 10641);
  assert.deepEqual([nardah.x, nardah.y], [3446, 2903], 'canonical post-quest Willow is the Nardah spawn');

  const q = register('BelowIceMountain', 'below_ice_mountain'), p = player();
  q.quest.setStage(p, 5); // Below STAGE_COMPLETE; 22 is the Ides completion value.
  assert.equal(q.quest.getStage(p), 5);
  assert.equal(q.quest.varbitValue(5, p), 120, 'Below completion wires main varbit 120');
  assert.equal(p.varbits.get(12063), 120, 'the recorded completion packet is main 120');
  assert.equal(q.variant(N.WILLOW, p), 'post-quest-dialogue-willow');
});

test('Below completion keeps the extra 1,999 coins in a full, stacked or one-slot bag', () => {
  const { World } = require('../dist/game/World');
  const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const q = register('BelowIceMountain', 'below_ice_mountain');
  let sequence = 0;

  function completeWith({ sharks, coins = 0 }) {
    let packet;
    packet = new Proxy({ sendVarbit() { return packet; }, sendConfig() { return packet; } }, {
      get: (target, key) => key in target ? target[key] : () => packet,
    });
    const attrs = new Map([['quest.points', 16]]);
    const username = `QhBelowReward${++sequence}`;
    const player = {
      getAttribute: (key) => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
      getInventory: () => inventory, getPacketSender: () => packet,
      getSkillManager: () => ({ getCurrentLevel: () => 99 }), getPrivateArea: () => null,
      getLocation: () => new core.Location(2950, 5769, 0),
      getUsername: () => username, getIndex: () => sequence, isPlayer: () => true, sendMessage() {},
    };
    const inventory = new Inventory(player);
    if (sharks) inventory.adds(I.SHARK, sharks);
    if (coins) inventory.adds(I.COINS, coins);
    q.quest.setStage(player, 4); // Below STAGE_GUARDIAN_DEAD
    const completed = q.quest.complete(player);
    const ground = World.getItems()
      .filter((item) => item.getOwner() === username && item.getItem().getId() === I.COINS)
      .map((item) => ({ amount: item.getItem().getAmount(), x: item.getPosition().getX(), y: item.getPosition().getY() }));
    const repeated = q.quest.complete(player);
    const state = {
      completed, repeated, qp: attrs.get('quest.points'), free: inventory.getFreeSlots(),
      coins: inventory.getAmount(I.COINS), ground,
    };
    for (const item of World.getItems().filter((entry) => entry.getOwner() === username)) {
      ItemOnGroundManager.deregister(item);
    }
    return state;
  }

  const full = completeWith({ sharks: 28 });
  assert.equal(full.completed, true);
  assert.equal(full.repeated, false, 'completion is once-only');
  assert.equal(full.qp, 17);
  assert.equal(full.coins, 0);
  assert.deepEqual(full.ground, [{ amount: 2000, x: 2950, y: 5769 }]);

  const stacked = completeWith({ sharks: 27, coins: 1 });
  assert.equal(stacked.completed, true);
  assert.equal(stacked.coins, 2001, 'forceAdd merges the full reward into an existing coin stack');
  assert.deepEqual(stacked.ground, []);

  const oneFree = completeWith({ sharks: 27 });
  assert.equal(oneFree.completed, true);
  assert.equal(oneFree.coins, 2000, 'one free slot holds the full reward');
  assert.equal(oneFree.free, 0);
  assert.deepEqual(oneFree.ground, []);
});

test('post-quest Gillie treats an equipped cowbell amulet as owned', () => {
  const w = talkWorld('the_ides_of_milk');
  try {
    const p = w.player(), inventory = p.getInventory();
    w.quest.setStage(p, 22);
    p.setAttribute('quest.the_ides_of_milk.reward', 1);
    p.setAttribute('quest.the_ides_of_milk.lamp', 1);
    p.equipment.push({ getId: () => I.COWBELL_AMULET_2 });
    assert.equal(w.talk(p, N.GILLIE_GROATS), true);
    assert.equal(inventory.getAmount(I.COWBELL_AMULET), 0, 'equipped amulet must not be duplicated');
    assert.equal(p.equipment.length, 1);
    assert.ok(!w.spoken.some((line) => /I've lost that amulet/i.test(line)));
  } finally {
    w.cleanup();
  }
});
