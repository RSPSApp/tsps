// Source-contract checks for Enakhra's Lament (Quest Helper q032).
// Run from server/: node --test tests/qh728-q032.test.cjs (after yarn build).
//
// Quest Helper source: pinned /tmp/tsps-600-parallel/quest-helper
// src/main/java/com/questhelper/helpers/quests/enakhraslament/EnakhrasLament.java
// at 06da90f982518a093f2fe1c9cfac5547fa7053d3.
//
// The route test starts at fresh stage 0 but fixture-sets ordinary supplies
// (sandstone, granite, food, logs, runes, prayer). Every quest stage change and
// item hand-over below comes from the plugin's registered handlers. These tests
// prove handler contracts and the stage graph, not a live playthrough or the
// visual Quest Helper overlay.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { Item } = require('../dist/game/model/Item');
const runtime = require('../plugins/quests/QuestRuntime');
const CACHE_FALLEN_STATUE_MULTILOC = 10970;
const CACHE_WALL_RIGHT_MULTILOC = 11027;
const CACHE_NORTH_BOULDER_MULTILOC = 11045;

test('the three spell puzzle targets are non-attackable in the active cache', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  for (const id of [N.BONEGUARD, N.CRUST_OF_ICE, N.FURNACE_GRATE]) {
    assert.equal(NpcDefinition.forId(id).isAttackable(), false, `NPC ${id} reaches the scripted spell hook`);
  }
});

const transcripts = [];
const realStartTranscript = runtime.startTranscript;
const stubbedStartTranscript = (api, player, npcId, page, variant, select) => {
  transcripts.push({ player, npcId, page, variant, select });
  return true;
};
runtime.startTranscript = stubbedStartTranscript;

// The real transcript runner asks core for the dialogue conditions, and core
// only knows the plugins registered with it, so the harness answers for the
// plugin it loaded.
let activeHooks = null;
if (!PluginManager.npcDialogueConditionHooks.some((hook) => hook.pluginName === 'qh728-q032')) {
  PluginManager.npcDialogueConditionHooks.push({
    pluginName: 'qh728-q032',
    handler: (event) => {
      if (!activeHooks) return null;
      for (const fn of activeHooks.conditions) {
        const value = fn(event);
        if (typeof value === 'boolean') return value;
      }
      return null;
    },
  });
}

function setup() {
  const realCore = PluginManager.getCoreApi();
  const hooks = {
    variants: [], conditions: [], custom: new Map(), login: [], logout: [], startup: [],
    namedNpcs: new Map(), namedObjects: new Map(),
    itemOnItem: [], itemOnObject: [], itemOnNpc: [], spellOnObject: [], spellOnNpc: [], spellCast: [],
  };
  const spawned = [], removed = [], messages = [], xp = [], varbits = new Map();
  const areaObjects = new Map();
  const keyOf = (location) => `${location.getX()},${location.getY()},${location.getZ()}`;
  class GameObject {
    constructor(id, location, type = 10, face = 0) {
      Object.assign(this, { id, location, type, face });
    }
    getId() { return this.id; }
    getLocation() { return this.location; }
    getType() { return this.type; }
    getFace() { return this.face; }
  }
  const ObjectManager = {
    objectsAt(location) { return areaObjects.get(keyOf(location)) ?? []; },
    register(object) {
      const key = keyOf(object.getLocation());
      const list = areaObjects.get(key) ?? [];
      list.push(object);
      areaObjects.set(key, list);
    },
    deregister(object) {
      const key = keyOf(object.getLocation());
      const list = areaObjects.get(key) ?? [];
      const index = list.indexOf(object);
      if (index >= 0) list.splice(index, 1);
    },
  };
  const I = realCore.ItemIdentifiers;
  // The cache's item names, for the food the plugin recognises by name.
  const itemNames = new Map([
    [I.CHISEL, 'Chisel'],
    [I.BREAD, 'Bread'],
    [I.APPLE_PIE, 'Apple pie'],
    [I.REDBERRY_PIE, 'Redberry pie'],
    [I.MEAT_PIE, 'Meat pie'],
    [I.HALF_A_MEAT_PIE, 'Half a meat pie'],
    [I.CAKE, 'Cake'],
    [I.CHOCOLATE_CAKE, 'Chocolate cake'],
    [I.PLAIN_PIZZA, 'Plain pizza'],
  ]);
  const pendingTasks = [], accuracyResults = [], graphics = [], sounds = [],
    core = {
    ...realCore,
    GameObject,
    ObjectManager,
    AccuracyFormulasDpsCalc: {
      ...realCore.AccuracyFormulasDpsCalc,
      rollAccuracy: (...args) => {
        accuracyCalls.push(args);
        selectedSpellAtAccuracy.push(args[0].getCombat().getCastSpell());
        return accuracyResults.length ? accuracyResults.shift() : true;
      },
    },
    TaskManager: { ...realCore.TaskManager, submit: (task) => pendingTasks.push(task) },
    Sounds: { ...realCore.Sounds, sendSound: (target, sound) => sounds.push({ target, sound }) },
    CacheDefinitions: {
      getItem: (id) => ({ name: itemNames.get(id) }),
      getSpellName: () => 'Wind Bolt',
    },
  };
  const accuracyCalls = [];
  const selectedSpellAtAccuracy = [];
  const menus = [];
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(name, handlers) {
      if (typeof name === 'function') return;
      hooks.namedNpcs.set(name, handlers);
    },
    onObjectInteraction(name, handlers) {
      if (typeof name === 'function') return;
      hooks.namedObjects.set(name, handlers);
    },
    onItemOnItem(fn) { hooks.itemOnItem.push(fn); },
    onItemOnObject(fn) { hooks.itemOnObject.push(fn); },
    onItemOnNpc(fn) { hooks.itemOnNpc.push(fn); },
    onSpellOnObject(fn) { hooks.spellOnObject.push(fn); },
    onSpellOnNpc(fn) { hooks.spellOnNpc.push(fn); },
    onSpellCast(fn) { hooks.spellCast.push(fn); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onPlayerLogout(fn) { hooks.logout.push(fn); },
    onServerStartup(fn) { hooks.startup.push(fn); },
    onCustomEvent(name, fn) {
      const list = hooks.custom.get(name) ?? [];
      list.push(fn);
      hooks.custom.set(name, list);
    },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') { event.complete = false; return; }
      for (const fn of hooks.custom.get(name) ?? []) fn(event);
    },
    sendMultiChatboxPrompt(player, prompt, ...pairs) {
      menus.push({ prompt, pairs });
      return true;
    },
    getWorld: () => ({ getNpcs: () => spawned }),
    spawnNpc(definition) {
      const npc = {
        ...definition,
        getId: () => definition.id,
        getLocation: () => new realCore.Location(definition.x, definition.y, definition.z),
        getOwner: () => definition.owner,
        isRegistered: () => !removed.includes(npc),
        isRemoved: () => removed.includes(npc),
        performGraphic: (graphic) => graphics.push({ npc, graphic }),
        remove() {},
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { if (npc) removed.push(npc); },
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return () => {};
    },
  });

  require('../plugins/quests/quests/EnakhrasLament.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'enakhras_lament');
  // NpcDialogues normally answers npc-dialogue:start; record the request so the
  // Lazim body-hand-in take-over can be exercised as a registered hook.
  const startRequests = [];
  api.onCustomEvent('npc-dialogue:start', (event) => { startRequests.push(event); event.handled = true; });

  const attrs = new Map(), inventory = new Map();
  activeHooks = hooks;
  let location = new realCore.Location(3190, 2925, 0), full = false, prayerOn = false, online = true;
  let activeCastSpell = null;
  const texts = [];
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    sendString(text) { texts.push(String(text)); return sender; },
    sendConfig() { return sender; },
    sendJingle() { return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const inventoryApi = {
    getAmount: (id) => inventory.get(id) ?? 0,
    contains: (id) => (inventory.get(id) ?? 0) > 0,
    isFull: () => full,
    getFreeSlots: () => full ? 0 : 28,
    adds(id, amount) { inventory.set(id, (inventory.get(id) ?? 0) + amount); },
    forceAdd(id, amount) { inventory.set(id, (inventory.get(id) ?? 0) + amount); },
    deleteNumber(id, amount) {
      assert.ok((inventory.get(id) ?? 0) >= amount, `missing item ${id}`);
      inventory.set(id, (inventory.get(id) ?? 0) - amount);
    },
    getItems: () => [...inventory].filter(([, amount]) => amount > 0)
      .map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };
  let activeInventory = inventoryApi;
  const dialogueErrors = [];
  let deferDialogues = false;
  const pendingDialogueChains = [];
  const dialogueManager = {
    startDialogues(chain) {
      if (deferDialogues) {
        pendingDialogueChains.push(chain);
        return;
      }
      for (const dialogue of chain.getDialogues().values()) {
        try {
          dialogue.send(player);
        } catch (error) {
          dialogueErrors.push(error);
        }
      }
    },
    reset() { pendingDialogueChains.length = 0; },
    advance() {},
    getCurrent: () => null,
    isActive: () => false,
  };
  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getInventory: () => activeInventory,
    getEquipment: () => ({ getItems: () => [] }),
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      getCurrentLevel: () => 99,
      getCombatLevel: () => 126,
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
    }),
    getPacketSender: () => sender,
    getDialogueManager: () => dialogueManager,
    getLocation: () => location,
    getCombat: () => ({ getCastSpell: () => activeCastSpell, setCastSpell: (spell) => { activeCastSpell = spell; } }),
    moveTo: (value) => { location = value; },
    getPrayerActive: () => ({ [realCore.PrayerHandler.PROTECT_FROM_MELEE]: prayerOn }),
    sendMessage: (text) => messages.push(text),
    getUsername: () => 'qh728-q032',
    getIndex: () => 1,
    getPrivateArea: () => null,
    isRegistered: () => online,
    isPlayer: () => true,
  };
  const fire = (name, event = {}) => api.emitCustomEvent(name, { player, ...event });
  const variant = (npcId) => hooks.variants.map((fn) => fn({ player, npcId })).find(Boolean) ?? null;
  const condition = (stepId, npcId, extra = {}) => hooks.conditions
    .map((fn) => fn({ player, npcId, stepId, ...extra }))
    .find((value) => value !== null && value !== undefined);
  const choice = (npcId, option, stepId) => fire('npc-dialogue:choice', { npcId, option, stepId });
  const action = (stepId, npcId) => fire('npc-dialogue:action', { npcId, stepId, handled: false });
  const itemOnItem = (usedItemId, usedWithItemId) => {
    for (const fn of hooks.itemOnItem) fn({ player, usedItemId, usedWithItemId });
  };
  const itemOnObject = (itemId, objectId, at = location) => {
    for (const fn of hooks.itemOnObject) fn({ player, itemId, objectId, location: at });
  };
  const itemOnNpc = (itemId, npcId) => {
    for (const fn of hooks.itemOnNpc) fn({ player, itemId, npcId });
  };
  const door = (objectId) => fire('door:toggle', {
    objectId, object: new GameObject(objectId, new realCore.Location(3100, 9300, 0), 0, 0),
  });
  const namedObject = (name, option, event = {}) => {
    const handlers = hooks.namedObjects.get(name);
    assert.ok(handlers?.[option], `missing ${name}.${option}`);
    return handlers[option]({ player, ...event });
  };
  const namedNpc = (name, option, event = {}) => {
    const handlers = hooks.namedNpcs.get(name);
    assert.ok(handlers?.[option], `missing ${name}.${option}`);
    return handlers[option]({ player, ...event });
  };
  const spellOnObject = (objectId) => {
    for (const fn of hooks.spellOnObject) fn({ player, objectId, spellWidget: 1, spellItemId: 1 });
  };
  const spellOnNpc = (npcId, spellName, npc = null, resolve = true) => {
    const spell = realCore.CombatSpells[spellName];
    npc ??= spawned.findLast((candidate) => candidate.id === npcId && !removed.includes(candidate)) ?? {
      id: npcId, getId: () => npcId, getOwner: () => player,
      getLocation: () => location,
      isRegistered: () => !removed.includes(npc),
      performGraphic: (graphic) => graphics.push({ npc, graphic }),
    };
    const event = { player, npcId, spell, spellId: spell.spellId(), npc, consumeRunes: () => true, handled: false };
    for (const fn of hooks.spellOnNpc) fn(event);
    if (resolve) flushTasks();
    return event;
  };
  function flushTasks() {
    while (pendingTasks.length) pendingTasks.shift().execute();
  }
  const castSpell = (spellName) => {
    for (const fn of hooks.spellCast) fn({ player, spellName, spellWidget: 1, spellItemId: 1 });
  };
  return {
    player, quest, attrs, inventory, messages, xp, varbits, spawned, removed, transcripts, hooks, startRequests,
    fire, variant, condition, choice, action, itemOnItem, itemOnObject, itemOnNpc, door,
    namedObject, namedNpc, spellOnObject, spellOnNpc, castSpell,
    api, menus, texts, dialogueErrors, core: realCore, pendingTasks, accuracyResults, accuracyCalls, selectedSpellAtAccuracy, graphics, sounds, flushTasks,
    logout() { online = false; for (const fn of hooks.logout) fn({ player }); },
    login() { online = true; for (const fn of hooks.login) fn({ player }); },
    setLocation(x, y, z = 0) { location = new realCore.Location(x, y, z); },
    setFull(value) { full = value; },
    setPrayer(value) { prayerOn = value; },
    useInventory(value) { activeInventory = value; },
    deferDialogues(value) { deferDialogues = value; },
    cancelDialogue() { dialogueManager.reset(); },
    pendingDialogueCount() { return pendingDialogueChains.length; },
  };
}

function limbCounts(h) {
  const I = h.core.ItemIdentifiers;
  const get = (id) => h.inventory.get(id) ?? 0;
  return {
    arms: get(I.STONE_LEFT_ARM) + get(I.STONE_RIGHT_ARM),
    legs: get(I.STONE_LEFT_LEG) + get(I.STONE_RIGHT_LEG),
  };
}

test('fresh stage 0 follows the full mandatory route to completion and rewards once', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  const O = PluginManager.getCoreApi().ObjectIdentifiers;
  h.core = PluginManager.getCoreApi();
  assert.equal(h.quest.getStage(h.player), 0);
  assert.equal(h.variant(N.LAZIM), 'starting-out-talking-to-lazim');

  // Start.
  h.choice(N.LAZIM, 'Of course!');
  assert.equal(h.quest.getStage(h.player), 1);

  // 32 kg base in batches, chisel, place.
  h.inventory.set(I.SANDSTONE_10KG_, 3);
  h.inventory.set(I.SANDSTONE_2KG_, 1);
  for (let i = 0; i < 3; i++) h.choice(N.LAZIM, "Here's a large 10 kg block.", 'u5ihBN');
  h.choice(N.LAZIM, "Here's a small 2 kg block.", 'D9Ee_i');
  assert.equal(h.quest.getStage(h.player), 2);
  assert.equal(h.inventory.get(I.SANDSTONE_32KG_), 1);
  h.itemOnItem(I.SANDSTONE_32KG_, I.CHISEL);
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.inventory.get(I.SANDSTONE_BASE), 1);
  h.itemOnObject(I.SANDSTONE_BASE, O.FLAT_GROUND);
  assert.equal(h.quest.getStage(h.player), 4);

  // 20 kg body, chisel, place, chisel statue. Talking at stage 4 while carrying
  // sandstone must take over the dead-ending body-hand-in transcript.
  h.inventory.set(I.SANDSTONE_10KG_, 2);
  assert.equal(h.namedNpc('Lazim', 'Talk-to'), true);
  assert.equal(h.startRequests.at(-1).variant, 'starting-out-talking-to-lazim-while-holding-sandstone-for-the-body');
  h.choice(N.LAZIM, "Here's a large 10 kg block.", 'teyOME');
  h.choice(N.LAZIM, "Here's a large 10 kg block.", 'teyOME');
  assert.equal(h.quest.getStage(h.player), 5);
  h.itemOnItem(I.SANDSTONE_20KG_, I.CHISEL);
  assert.equal(h.quest.getStage(h.player), 6);
  h.itemOnObject(I.SANDSTONE_BODY, O.HEADLESS_STATUE);
  assert.equal(h.quest.getStage(h.player), 7);
  h.itemOnObject(I.CHISEL, O.HEADLESS_STATUE_2);
  assert.equal(h.quest.getStage(h.player), 8);

  // Choose and carve the head, confirm it, use it on the statue.
  h.choice(N.LAZIM, 'I think it should have your head.');
  h.inventory.set(I.GRANITE_5KG_, 1);
  h.itemOnItem(I.CHISEL, I.GRANITE_5KG_);
  h.choice(N.LAZIM, 'The head of Lazim, the sculptor');
  assert.equal(h.quest.getStage(h.player), 9);
  assert.equal(h.inventory.get(I.STONE_HEAD), 1);
  assert.equal(conditionValue(h, 'Oxb3xp', N.LAZIM), true);
  h.itemOnObject(I.STONE_HEAD, O.HEADLESS_STATUE_3);
  assert.equal(h.varbits.get(1593), 28, 'the head handover transforms the cache statue into its hole');
  h.action('ARRUvf', N.LAZIM);
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(h.varbits.get(1593), 28, 'entering the temple preserves the surface transform');
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY()], [3130, 9327]);

  // Temple briefing and the four statue limbs.
  const briefing = h.variant(N.LAZIM);
  assert.equal(briefing, 'bottom-floor-of-enakhra-s-temple-talking-to-lazim-inside-the-temple');
  assert.equal(h.quest.getStage(h.player), 10, 'selecting the briefing does not consume it');
  assert.equal(realStartTranscript(h.api, h.player, N.LAZIM, "Enakhra's Lament", briefing), true);
  assert.equal(h.quest.getStage(h.player), 11);
  h.itemOnObject(I.CHISEL, CACHE_FALLEN_STATUE_MULTILOC);
  for (const [stepId, item] of [
    ['M6XzRN', I.STONE_LEFT_ARM],
    ['arsdof', I.STONE_RIGHT_ARM],
    ['61YBoM', I.STONE_LEFT_LEG],
    ['osLsmW', I.STONE_RIGHT_LEG],
  ]) {
    h.choice(N.LAZIM, 'x', stepId);
    assert.equal(h.inventory.get(item), 1, `${stepId} gives ${item}`);
    if (stepId === 'M6XzRN') assert.equal(h.varbits.get(1587), 7, 'the first removed limb selects its cache model');
  }
  assert.equal(h.quest.getStage(h.player), 12);

  // Four outer doors: each cache door consumes its own limb type and plays its
  // own cutscene (anticlockwise: north, north-west, south-west, south-east).
  const doors = [
    [O.DOOR_263, 'bottom-floor-of-enakhra-s-temple-open-door-to-the-north', 'arms'],
    [O.DOOR_265, 'bottom-floor-of-enakhra-s-temple-open-door-to-the-north-west', 'legs'],
    [O.DOOR_261, 'bottom-floor-of-enakhra-s-temple-open-door-to-the-south-west', 'arms'],
    [O.DOOR_267, 'bottom-floor-of-enakhra-s-temple-open-door-to-the-south-east', 'legs'],
  ];
  for (const [objectId, variantName, kind] of doors) {
    const before = limbCounts(h);
    const start = h.transcripts.length;
    h.door(objectId);
    const after = limbCounts(h);
    assert.equal(after[kind], before[kind] - 1, `${objectId} consumes a ${kind} limb`);
    assert.equal(after[kind === 'arms' ? 'legs' : 'arms'], before[kind === 'arms' ? 'legs' : 'arms']);
    assert.equal(h.transcripts[start].variant, variantName);
  }
  assert.equal(h.quest.getStage(h.player), 13);

  // Sigils come from the pedestal the cache actually names.
  h.namedObject('Pedestal', 'Take-sigil', { objectId: O.PEDESTAL_20 });
  h.namedObject('Pedestal', 'Take-sigil', { objectId: O.PEDESTAL_19 });
  h.namedObject('Pedestal', 'Take-sigil', { objectId: O.PEDESTAL_21 });
  h.namedObject('Pedestal', 'Take-sigil', { objectId: O.PEDESTAL_22 });
  assert.equal(h.inventory.get(I.M_SIGIL), 1);
  assert.equal(h.inventory.get(I.Z_SIGIL), 1);
  assert.equal(h.inventory.get(I.R_SIGIL), 1);
  assert.equal(h.inventory.get(I.K_SIGIL), 1);

  // Inner M door, then the pedestal mould and camel-cavity head.
  h.door(O.DOOR_253);
  assert.equal(h.quest.getStage(h.player), 14);
  h.inventory.set(I.SOFT_CLAY, 1);
  h.itemOnObject(I.SOFT_CLAY, O.PEDESTAL);
  assert.equal(h.inventory.get(I.CAMEL_MOULD_P_), 1);
  h.inventory.set(I.GRANITE_5KG_, 1);
  h.itemOnItem(I.CHISEL, I.GRANITE_5KG_);
  assert.equal(h.inventory.get(I.STONE_HEAD_5), 1);
  h.itemOnObject(I.STONE_HEAD_5, O.PEDESTAL);
  assert.equal(h.quest.getStage(h.player), 15);

  // Four elemental rooms.
  h.inventory.set(I.BREAD, 1);
  h.itemOnNpc(I.BREAD, N.PENTYN);
  h.spellOnNpc(N.CRUST_OF_ICE, 'FIRE_BOLT');
  h.spellOnNpc(N.FURNACE_GRATE, 'WIND_BOLT');
  for (const [x, y, item] of [
    [3114, 9306, I.LOGS],
    [3116, 9306, I.OAK_LOGS],
    [3118, 9306, I.WILLOW_LOGS],
    [3114, 9309, I.MAPLE_LOGS],
    [3116, 9309, I.LIT_CANDLE],
    [3118, 9309, I.COAL],
  ]) {
    h.inventory.set(item, 1);
    h.itemOnObject(item, O.BRAZIER, new h.core.Location(x, y, 1));
  }
  assert.equal(h.quest.getStage(h.player), 16);
  h.namedObject('Magic barrier', 'Pass-through', { objectId: O.MAGIC_BARRIER });

  // First boneguard: selecting Crumble Undead and talking do not complete the cast.
  h.action('AdRB_B', N.BONEGUARD);
  assert.equal(h.quest.getStage(h.player), 16);
  h.castSpell('Crumble Undead');
  h.action('AdRB_B', N.BONEGUARD);
  assert.equal(h.quest.getStage(h.player), 16);
  h.spellOnNpc(N.BONEGUARD, 'CRUMBLE_UNDEAD');
  assert.equal(h.quest.getStage(h.player), 17);

  // Second boneguard, Protect from Melee, agree to build.
  h.setPrayer(true);
  assert.equal(conditionValue(h, 'EgNB8X', N.BONEGUARD_2), true);
  h.choice(N.BONEGUARD_2, "Okay, I'll start building.");
  assert.equal(h.quest.getStage(h.player), 18);

  // Three wall loads: place sandstone, trim with the chisel.
  for (let i = 0; i < 3; i++) {
    h.inventory.set(I.SANDSTONE_5KG_, 1);
    h.itemOnObject(I.SANDSTONE_5KG_, O.WALL_31);
    h.itemOnObject(I.CHISEL, O.WALL_31);
  }
  assert.equal(h.quest.getStage(h.player), 19);

  // Final hand-in: boneguard -> Akthanakos -> Enakhra cutscene -> complete.
  assert.equal(h.variant(N.BONEGUARD_2), 'middle-floor-of-enakhra-s-temple-talking-to-the-boneguard-after-finishing-the-wall');
  h.action('tAjTwX', N.BONEGUARD_2);
  h.action('qyIeWP', N.BONEGUARD_2);
  h.action('qFz3o_', N.BONEGUARD_2);
  assert.equal(h.quest.getStage(h.player), 20);
  assert.equal(h.varbits.get(1560), 70, 'completion emits native varbit 1560 at the DB threshold');
  assert.equal(h.inventory.get(I.CAMULET), 1, 'completion grants the Camulet');
  assert.deepEqual(h.xp, [
    [h.core.Skill.CRAFTING.getIndex(), 7000],
    [h.core.Skill.MINING.getIndex(), 7000],
    [h.core.Skill.FIREMAKING.getIndex(), 7000],
    [h.core.Skill.MAGIC.getIndex(), 7000],
  ]);
  h.action('qFz3o_', N.BONEGUARD_2);
  assert.equal(h.inventory.get(I.CAMULET), 1, 'repeat completion action does not duplicate the reward');

  // Post-quest selection is pure; the separate runner test marks the first
  // conversation complete only after one of its final lines is continued.
  assert.equal(h.variant(N.LAZIM), 'post-quest-talking-to-lazim-after-the-quest');
  assert.equal(h.variant(N.LAZIM), 'post-quest-talking-to-lazim-after-the-quest');
  assert.equal(h.variant(N.PENTYN), 'standard-dialogue-after-completion-of-the-quest');
});

function conditionValue(h, stepId, npcId) {
  return h.condition(stepId, npcId);
}

// Fixture start: stage 12 (limbs taken) with only legs; proves the door handler contract.
test('limb door contract rejects the wrong limb type and keeps per-door saves', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const O = PluginManager.getCoreApi().ObjectIdentifiers;
  h.quest.setStage(h.player, 12);
  // Only legs carried: the right-arm door must not open, and nothing is eaten.
  h.inventory.set(I.STONE_LEFT_LEG, 1);
  h.inventory.set(I.STONE_RIGHT_LEG, 1);
  h.door(O.DOOR_263);
  assert.equal(h.inventory.get(I.STONE_LEFT_LEG), 1);
  assert.equal(h.inventory.get(I.STONE_RIGHT_LEG), 1);
  assert.ok(h.messages.some((message) => /stone limb/.test(message)));
  assert.equal(h.quest.getStage(h.player), 12);
});

// Fixture start: stage 11 (temple briefed); the right arm is cut then removed from inventory.
test('lost statue limb is handed back by Lazim before the doors are finished', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 11);
  h.choice(N.LAZIM, 'x', 'arsdof');
  assert.equal(h.inventory.get(I.STONE_RIGHT_ARM), 1);
  h.inventory.delete(I.STONE_RIGHT_ARM);
  assert.equal(
    h.variant(N.LAZIM),
    'bottom-floor-of-enakhra-s-temple-talking-to-lazim-after-losing-the-stone-limbs',
    'the lost-limb recovery menu is reachable before all four doors are open',
  );
  assert.equal(h.condition('JtVWqW', N.LAZIM), true);
  assert.equal(h.inventory.get(I.STONE_RIGHT_ARM), 1);
});

// Fixture start: stage 20, post-quest flag, unlimited flag, no Camulet.
test('post-quest lost Camulet is recoverable even after the unlimited upgrade', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 20);
  h.attrs.set('quest.enakhras_lament.post-quest', 1);
  h.attrs.set('quest.enakhras_lament.camulet-unlimited', 1);
  assert.equal(
    h.variant(N.LAZIM),
    'post-quest-talking-to-lazim-again-after-the-quest',
  );
  assert.equal(h.condition('Y-IaPG', N.LAZIM), true);
  h.action('BNC2HB', N.LAZIM);
  assert.equal(h.inventory.get(I.CAMULET), 1);
});

// Fixture start: stage 20, post-quest flag, Camulet only in the bank.
test('banked Camulet is not treated as lost and never opens the return branch', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 20);
  h.attrs.set('quest.enakhras_lament.post-quest', 1);
  h.player.getBanks = () => [{ contains: (id) => id === I.CAMULET }];
  assert.equal(h.variant(N.LAZIM), 'post-quest-talking-to-lazim-again-after-the-quest');
  assert.equal(h.condition('Y-IaPG', N.LAZIM), false, 'a banked Camulet is not lost');
  assert.equal(h.condition('VvEJ5Q', N.LAZIM), true, 'the transcript bank branch is selected instead');
});

// Fixture start: stage 11; the right arm is cut then banked.
test('banked statue limb is not re-granted as lost', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 11);
  h.choice(N.LAZIM, 'x', 'arsdof');
  h.inventory.delete(I.STONE_RIGHT_ARM);
  h.player.getBanks = () => [{ contains: (id) => id === I.STONE_RIGHT_ARM }];
  assert.equal(
    h.variant(N.LAZIM),
    'bottom-floor-of-enakhra-s-temple-talking-to-lazim-after-getting-the-stone-head-once',
    'a banked limb is not the lost-limb variant',
  );
  assert.equal(h.condition('JtVWqW', N.LAZIM), false);
});

// Fixture start: stage 19 (wall built) with a full inventory.
test('full bag at the final reward keeps completion pending until a return talk', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 19);
  h.setFull(true);
  assert.equal(h.variant(N.BONEGUARD_2), 'middle-floor-of-enakhra-s-temple-talking-to-the-boneguard-after-finishing-the-wall');
  h.action('tAjTwX', N.BONEGUARD_2);
  assert.equal(h.quest.getStage(h.player), 19, 'transforming the boneguard is not completion');
  assert.equal(h.condition('yaY72t', N.AKTHANAKOS), true, 'no space selects the return-to-me branch');
  assert.equal(h.condition('tP9pxd', N.AKTHANAKOS), true);
  h.setFull(false);
  assert.equal(h.condition('tP9pxd', N.AKTHANAKOS), false, 'a free slot continues the reward and cutscene');
  h.action('Nbd15u', N.AKTHANAKOS);
  h.action('qFz3o_', N.AKTHANAKOS);
  assert.equal(h.quest.getStage(h.player), 20);
  assert.equal(h.inventory.get(I.CAMULET), 1);
});

// Fixture start: stage 8, then stage 14 for the pedestal-tried head check.
test('banked stone head is not duplicated by Lazim, but a genuinely lost head is returned', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  const O = PluginManager.getCoreApi().ObjectIdentifiers;
  h.quest.setStage(h.player, 8);
  h.choice(N.LAZIM, 'I think it should have your head.');
  h.inventory.set(I.GRANITE_5KG_, 1);
  h.itemOnItem(I.CHISEL, I.GRANITE_5KG_);
  h.choice(N.LAZIM, 'The head of Lazim, the sculptor');
  assert.equal(h.inventory.get(I.STONE_HEAD), 1);
  h.quest.setStage(h.player, 14);
  h.itemOnObject(I.STONE_HEAD, O.PEDESTAL);
  h.inventory.delete(I.STONE_HEAD);
  h.player.getBanks = () => [{ contains: (id) => id === I.STONE_HEAD }];
  assert.equal(h.condition('jsyT6r', N.LAZIM), false, 'a banked head is not lost');
  h.choice(N.LAZIM, "Do you know where the statue's head is?");
  assert.equal(h.inventory.get(I.STONE_HEAD) ?? 0, 0, 'no duplicate from the bank case');
  h.player.getBanks = () => [];
  assert.equal(h.condition('jsyT6r', N.LAZIM), true);
  h.choice(N.LAZIM, "Do you know where the statue's head is?");
  assert.equal(h.inventory.get(I.STONE_HEAD), 1);
});


test('native completion wire: varbit 1560 uses native milestones and 70 at completion', () => {
  const h = setup();
  const milestones = [
    [0, 0], [1, 10], [4, 10], [9, 10], [10, 20], [14, 20],
    [15, 30], [16, 40], [17, 50], [18, 60], [19, 60],
  ];
  for (const [stage, wire] of milestones) {
    h.quest.setStage(h.player, stage);
    assert.equal(h.varbits.get(1560), wire, `internal stage ${stage} maps to native milestone ${wire}`);
  }
  h.quest.setStage(h.player, 20);
  assert.equal(h.varbits.get(1560), 70, 'the existing completion stage maps to 70');
  h.quest.setStage(h.player, 19);
  h.varbits.clear();
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.varbits.get(1560), 60, 'login/bootstrap replays the in-progress milestone');
  h.quest.setStage(h.player, 20);
  h.varbits.clear();
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.varbits.get(1560), 70, 'an old stage-20 save replays as 70 after login');
});

test('each limb door consumes only the limb the cache names', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const O = PluginManager.getCoreApi().ObjectIdentifiers;
  h.quest.setStage(h.player, 12);
  for (const id of [I.STONE_LEFT_ARM, I.STONE_RIGHT_ARM, I.STONE_LEFT_LEG, I.STONE_RIGHT_LEG]) {
    h.inventory.set(id, 1);
  }
  h.door(O.DOOR_263); // right arm door
  assert.equal(h.inventory.get(I.STONE_RIGHT_ARM) ?? 0, 0, 'right-arm door consumed the right arm');
  assert.equal(h.inventory.get(I.STONE_LEFT_ARM), 1, 'left arm is retained');
  h.door(O.DOOR_265); // left leg door
  assert.equal(h.inventory.get(I.STONE_LEFT_LEG) ?? 0, 0, 'left-leg door consumed the left leg');
  assert.equal(h.inventory.get(I.STONE_RIGHT_LEG), 1, 'right leg is retained');
});

test('each inner sigil door requires and consumes its own sigil', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const O = PluginManager.getCoreApi().ObjectIdentifiers;
  h.quest.setStage(h.player, 13);
  h.inventory.set(I.Z_SIGIL, 1);
  h.door(O.DOOR_259); // K door with only a Z sigil
  assert.equal(h.inventory.get(I.Z_SIGIL), 1, 'wrong sigil is not consumed');
  assert.equal(h.quest.getStage(h.player), 13, 'wrong sigil does not open the door');
  h.inventory.set(I.K_SIGIL, 1);
  h.door(O.DOOR_259);
  assert.equal(h.inventory.get(I.K_SIGIL) ?? 0, 0, 'K door consumes the K sigil');
  assert.equal(h.inventory.get(I.Z_SIGIL), 1, 'the Z sigil is retained');
  assert.equal(h.quest.getStage(h.player), 14);
});

test('native auxiliary varbits mirror limbs, doors, rooms, braziers and wall for Quest Helper', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  const O = PluginManager.getCoreApi().ObjectIdentifiers;

  // Statue multivars and blurb flags.
  h.quest.setStage(h.player, 4);
  assert.equal(h.varbits.get(1593), 1, 'base placed');
  h.quest.setStage(h.player, 7);
  assert.equal(h.varbits.get(1593), 2, 'body placed');
  h.quest.setStage(h.player, 8);
  assert.equal(h.varbits.get(1593), 3, 'statue chiselled');
  assert.equal(h.varbits.get(1563), 1, 'head-choice blurb');
  h.quest.setStage(h.player, 5);
  assert.equal(h.varbits.get(1562), 1, 'body blurb after talking about the body');
  h.quest.setStage(h.player, 11);
  assert.equal(h.varbits.get(1566), 1, 'briefed in the temple');

  // Limbs: individual taken flags plus the exact 63 all-limbs sentinel.
  for (const stepId of ['M6XzRN', 'arsdof', '61YBoM', 'osLsmW']) h.choice(N.LAZIM, 'x', stepId);
  assert.equal(h.varbits.get(1589), 1);
  assert.equal(h.varbits.get(1590), 1);
  assert.equal(h.varbits.get(1591), 1);
  assert.equal(h.varbits.get(1592), 1);
  assert.equal(h.varbits.get(1587), 63, 'QH requires the exact 63 all-limbs value');

  // Outer doors -> armlock/leglock varbits.
  h.quest.setStage(h.player, 13);
  h.door(O.DOOR_263);
  h.door(O.DOOR_265);
  h.door(O.DOOR_261);
  h.door(O.DOOR_267);
  assert.equal(h.varbits.get(1608), 1, 'right arm lock');
  assert.equal(h.varbits.get(1609), 1, 'left leg lock');
  assert.equal(h.varbits.get(1607), 1, 'left arm lock');
  assert.equal(h.varbits.get(1610), 1, 'right leg lock');

  // Inner sigil doors -> per-letter door varbits.
  for (const id of [I.Z_SIGIL, I.M_SIGIL, I.R_SIGIL, I.K_SIGIL]) h.inventory.set(id, 1);
  h.door(O.DOOR_253);
  h.door(O.DOOR_255);
  h.door(O.DOOR_257);
  h.door(O.DOOR_259);
  assert.equal(h.varbits.get(1611), 1, 'Z door');
  assert.equal(h.varbits.get(1612), 1, 'M door');
  assert.equal(h.varbits.get(1613), 1, 'R door');
  assert.equal(h.varbits.get(1614), 1, 'K door');

  // Element rooms and six braziers.
  h.quest.setStage(h.player, 15);
  assert.equal(h.varbits.get(1618), 1, 'seen pedestal');
  h.inventory.set(I.BREAD, 1);
  h.itemOnNpc(I.BREAD, N.PENTYN);
  h.spellOnNpc(N.CRUST_OF_ICE, 'FIRE_BOLT');
  h.spellOnNpc(N.FURNACE_GRATE, 'WIND_BOLT');
  assert.equal(h.varbits.get(1576), 1, 'blood room');
  assert.equal(h.varbits.get(1577), 1, 'ice room');
  assert.equal(h.varbits.get(1578), 1, 'smoke room');
  for (const [x, y, item] of [
    [3114, 9306, I.LOGS],
    [3116, 9306, I.OAK_LOGS],
    [3118, 9306, I.WILLOW_LOGS],
    [3114, 9309, I.MAPLE_LOGS],
    [3116, 9309, I.LIT_CANDLE],
    [3118, 9309, I.COAL],
  ]) {
    h.inventory.set(item, 1);
    h.itemOnObject(item, O.BRAZIER, new (PluginManager.getCoreApi()).Location(x, y, 1));
  }
  for (let i = 0; i < 6; i++) assert.equal(h.varbits.get(1581 + i), 1, `brazier ${i + 1}`);
  assert.equal(h.varbits.get(1579), 1, 'shadow room');

  // Wall: needs-trimming during placement, incremental multivars when trimmed.
  h.quest.setStage(h.player, 18);
  h.inventory.set(I.SANDSTONE_5KG_, 1);
  h.itemOnObject(I.SANDSTONE_5KG_, CACHE_WALL_RIGHT_MULTILOC);
  assert.equal(h.varbits.get(1620), 1, 'wall needs trimming');
  for (let i = 0; i < 3; i++) {
    h.itemOnObject(I.CHISEL, CACHE_WALL_RIGHT_MULTILOC);
    if (i < 2) {
      h.inventory.set(I.SANDSTONE_5KG_, 1);
      h.itemOnObject(I.SANDSTONE_5KG_, CACHE_WALL_RIGHT_MULTILOC);
    }
  }
  assert.equal(h.varbits.get(1602), 4, 'finished wall');
  assert.equal(h.varbits.get(1620), 0, 'no longer needs trimming');

  // Login/bootstrap resends the auxiliary mirror after varp clobbering.
  h.varbits.clear();
  h.fire('player:bootstrap-complete');
  assert.equal(h.varbits.get(1602), 4, 'bootstrap resends the wall to Quest Helper');
  assert.equal(h.varbits.get(1589), 1, 'bootstrap resends limb flags');
});

test('Pentyn eats a whole pie, and only a whole one', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 14);
  h.inventory.set(I.APPLE_PIE, 1);
  h.itemOnNpc(I.APPLE_PIE, N.PENTYN);
  assert.equal(h.inventory.get(I.APPLE_PIE) ?? 0, 0, 'the pie is eaten');
  assert.equal(h.varbits.get(1576), 1, 'the blood globe is lit');
  assert.equal(h.condition('aGRJAj', N.PENTYN), true, 'the transcript plays its food branch');

  const half = setup();
  half.quest.setStage(half.player, 14);
  half.inventory.set(I.HALF_A_MEAT_PIE, 1);
  half.itemOnNpc(I.HALF_A_MEAT_PIE, N.PENTYN);
  assert.equal(half.inventory.get(I.HALF_A_MEAT_PIE), 1, 'a half-eaten pie is not eaten');
  assert.equal(half.varbits.get(1576) ?? 0, 0, 'a half-eaten pie does not light the globe');
});

test('the furnace grate NPC is the smoke room target', () => {
  const h = setup();
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 14);
  const start = h.transcripts.length;
  h.spellOnNpc(N.FURNACE_GRATE, 'WIND_STRIKE');
  assert.equal(h.varbits.get(1578) ?? 0, 0, 'Wind Strike is below the required tier');
  h.spellOnNpc(N.FURNACE_GRATE, 'WIND_BOLT');
  assert.equal(h.varbits.get(1578), 1, 'the smoke globe is lit');
  assert.equal(
    h.transcripts[start].variant,
    'middle-floor-of-enakhra-s-temple-casting-wind-bolt-blast-wave-or-surge-on-furnace-grate',
  );

  const early = setup();
  early.quest.setStage(early.player, 10);
  early.spellOnNpc(N.FURNACE_GRATE, 'WIND_BOLT');
  assert.equal(early.varbits.get(1578) ?? 0, 0, 'the grate does nothing before the puzzle floor');
});

test('the ice crust requires Fire Bolt or a stronger fire combat spell', () => {
  const h = setup();
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 14);
  h.spellOnNpc(N.CRUST_OF_ICE, 'WIND_BOLT');
  h.spellOnNpc(N.CRUST_OF_ICE, 'FIRE_STRIKE');
  assert.equal(h.varbits.get(1577) ?? 0, 0, 'wrong-element and weaker spells do not melt the crust');
  h.spellOnNpc(N.CRUST_OF_ICE, 'FIRE_BOLT');
  assert.equal(h.varbits.get(1577), 1);
  assert.equal(h.spellOnNpc(N.CRUST_OF_ICE, 'FIRE_SURGE').handled, false, 'the puzzle cannot consume a second cast');
});

test('the boneguard only falls to Crumble Undead', () => {
  const h = setup();
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 16);
  h.action('AdRB_B', N.BONEGUARD);
  h.action('AdRB_B', N.BONEGUARD);
  assert.equal(h.quest.getStage(h.player), 16, 'no spell, no freedom');
  assert.ok(h.messages.some((message) => /Crumble Undead/.test(message)));
  h.spellOnNpc(N.BONEGUARD, 'FIRE_BOLT');
  assert.equal(h.quest.getStage(h.player), 16, 'the wrong spell frees nobody');
  h.castSpell('Crumble Undead');
  h.action('AdRB_B', N.BONEGUARD);
  assert.equal(h.quest.getStage(h.player), 16, 'selecting the spell alone frees nobody');
  h.spellOnNpc(N.BONEGUARD, 'CRUMBLE_UNDEAD');
  assert.equal(h.quest.getStage(h.player), 17, 'Crumble Undead frees the boneguard');
});

test('spell puzzles resolve at projectile impact, and a Boneguard splash can be retried', () => {
  const h = setup();
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 16);
  h.action('AdRB_B', N.BONEGUARD);
  h.accuracyResults.push(false);
  const miss = h.spellOnNpc(N.BONEGUARD, 'CRUMBLE_UNDEAD', null, false);
  assert.equal(miss.handled, true);
  assert.equal(h.accuracyCalls[0][2], h.core.CombatType.MAGIC);
  assert.equal(h.selectedSpellAtAccuracy[0], h.core.CombatSpells.CRUMBLE_UNDEAD,
    'the spell being cast is the spell context used by the standard accuracy formula');
  assert.equal(h.quest.getStage(h.player), 16, 'the cast does not free the guard before impact');
  assert.equal(h.pendingTasks.length, 1);
  assert.equal(h.spellOnNpc(N.BONEGUARD, 'CRUMBLE_UNDEAD', null, false).handled, false,
    'a second cast cannot overlap the unresolved projectile');
  h.flushTasks();
  assert.equal(h.quest.getStage(h.player), 16, 'a splash leaves the guard and quest unchanged');
  assert.equal(h.graphics.length, 1);
  assert.equal(h.sounds.length, 1);

  h.accuracyResults.push(true);
  h.spellOnNpc(N.BONEGUARD, 'CRUMBLE_UNDEAD', null, false);
  assert.equal(h.quest.getStage(h.player), 16);
  h.flushTasks();
  assert.equal(h.quest.getStage(h.player), 17, 'the accurate impact frees the guard');
  assert.equal(h.removed.filter((npc) => npc.id === N.BONEGUARD).length, 1);
  assert.equal(h.graphics.length, 2, 'the successful cast shows its spell end graphic');
});

test('a player logout before impact cancels quest effects and removes owner NPCs', () => {
  const h = setup();
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 16);
  h.action('AdRB_B', N.BONEGUARD);
  h.accuracyResults.push(true);
  const cast = h.spellOnNpc(N.BONEGUARD, 'CRUMBLE_UNDEAD', null, false);
  const target = h.spawned.findLast((npc) => npc.id === N.BONEGUARD);
  const transcriptsBeforeImpact = h.transcripts.length;
  assert.equal(cast.handled, true);
  h.logout();
  assert.ok(h.removed.includes(target), 'the owner-scoped NPC is queued for removal at logout');
  h.flushTasks();
  assert.equal(h.quest.getStage(h.player), 16, 'the delayed impact cannot advance a logged-out player');
  assert.equal(h.transcripts.length, transcriptsBeforeImpact, 'logout does not start an impact transcript');

  h.login();
  h.accuracyResults.push(true);
  h.spellOnNpc(N.BONEGUARD, 'CRUMBLE_UNDEAD', null, false);
  h.flushTasks();
  assert.equal(h.quest.getStage(h.player), 17, 'login restores the temple NPC and permits a fresh cast');
});

test('furnace and ice puzzle changes also wait for accurate spell impacts', () => {
  const h = setup();
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 16);

  h.accuracyResults.push(false);
  h.spellOnNpc(N.FURNACE_GRATE, 'WIND_BOLT', null, false);
  h.flushTasks();
  assert.equal(h.varbits.get(1578) ?? 0, 0, 'a wind-spell splash does not clear the smoke room');
  h.accuracyResults.push(true);
  h.spellOnNpc(N.FURNACE_GRATE, 'WIND_BOLT', null, false);
  assert.equal(h.varbits.get(1578) ?? 0, 0, 'the furnace remains blocked until projectile impact');
  h.flushTasks();
  assert.equal(h.varbits.get(1578), 1);

  h.accuracyResults.push(false);
  h.spellOnNpc(N.CRUST_OF_ICE, 'FIRE_BOLT', null, false);
  h.flushTasks();
  assert.equal(h.varbits.get(1577) ?? 0, 0, 'a fire-spell splash does not melt the crust');
  h.accuracyResults.push(true);
  h.spellOnNpc(N.CRUST_OF_ICE, 'FIRE_BOLT', null, false);
  assert.equal(h.varbits.get(1577) ?? 0, 0, 'the crust remains until accurate impact');
  h.flushTasks();
  assert.equal(h.varbits.get(1577), 1);
});

test('the four sand piles pair with the four surface holes', () => {
  const h = setup();
  const O = PluginManager.getCoreApi().ObjectIdentifiers;
  h.quest.setStage(h.player, 11);
  h.namedObject('Sand pile', 'Climb', { location: new h.core.Location(3087, 9333, 1) });
  assert.deepEqual(
    [h.player.getLocation().getX(), h.player.getLocation().getY()],
    [3148, 2937],
    'the north room surfaces at the north hole',
  );
  assert.equal(h.varbits.get(1598), 1, 'the north boulder varbit is set');
  assert.equal(h.varbits.get(1599) ?? 0, 0, 'the other entrances stay locked');

  h.namedObject('Secret entrance', 'Climb-down', {
    objectId: CACHE_NORTH_BOULDER_MULTILOC,
    location: new h.core.Location(3148, 2937, 0),
  });
  assert.deepEqual(
    [h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [3087, 9333, 1],
    'the hole leads back into its own tunnel',
  );

  const other = setup();
  other.quest.setStage(other.player, 11);
  other.namedObject('Sand pile', 'Climb', { location: new other.core.Location(3120, 9289, 1) });
  assert.deepEqual(
    [other.player.getLocation().getX(), other.player.getLocation().getY()],
    [3189, 2888],
    'the south room surfaces at the south hole',
  );
});

test('a temple ladder unlocks its room\'s secret entrance', () => {
  const h = setup();
  h.quest.setStage(h.player, 11);
  h.fire('ladders:climb', { object: { getLocation: () => new h.core.Location(3121, 9286, 0) } });
  assert.equal(h.varbits.get(1600), 1, 'the south boulder varbit is set');
  h.fire('ladders:climb', { object: { getLocation: () => new h.core.Location(3104, 9309, 0) } });
  assert.equal(h.varbits.get(1600), 1, 'the central ladder has no entrance of its own');
  assert.equal(h.varbits.get(1598) ?? 0, 0, 'the central ladder unlocks nothing');
});

test('a dropped sandstone block is handed back by Lazim', () => {
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  h.quest.setStage(h.player, 2);
  h.attrs.set('quest.enakhras_lament.base-kg', 32);
  assert.equal(h.namedNpc('Lazim', 'Talk-to'), true);
  assert.equal(h.inventory.get(I.SANDSTONE_32KG_), 1, 'Lazim hands the block back');
  const request = h.startRequests.at(-1);
  assert.equal(request.variant, 'starting-out-talking-to-lazim-while-holding-sandstone-for-the-base');
  const page = runtime.loadTranscripts(h.api)["Enakhra's Lament"];
  const steps = request.select(page.variants[request.variant]);
  assert.equal(steps.length, 1, 'only the hand-over branch plays');
  assert.equal(steps[0].id, 'r7_kHr', 'the transcript\'s own hand-over branch');

  const kept = setup();
  kept.quest.setStage(kept.player, 2);
  kept.attrs.set('quest.enakhras_lament.base-kg', 32);
  kept.inventory.set(I.SANDSTONE_32KG_, 1);
  kept.namedNpc('Lazim', 'Talk-to');
  assert.equal(kept.inventory.get(I.SANDSTONE_32KG_), 1, 'a block in the pack is not replaced');
  assert.equal(kept.startRequests.length, 0, 'no recovery branch for a block the player has');
});

test('the temple NPCs are owner-scoped, so one player cannot take them away', () => {
  const h = setup();
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 16);
  const spawned = h.spawned.filter((npc) => npc.ownerOnly === true);
  assert.ok(spawned.length > 0, 'the temple NPCs are spawned for the player');
  for (const npc of spawned) {
    assert.equal(npc.owner, h.player, `${npc.id} belongs to the player`);
  }
  const ids = spawned.map((npc) => npc.id);
  assert.ok(ids.includes(N.BONEGUARD), 'the first boneguard is the player\'s own');
  assert.ok(ids.includes(N.FURNACE_GRATE), 'the furnace grate is the player\'s own');

  // Freeing the boneguard takes away that player's copy only.
  h.action('AdRB_B', N.BONEGUARD);
  h.spellOnNpc(N.BONEGUARD, 'CRUMBLE_UNDEAD');
  assert.equal(h.quest.getStage(h.player), 17);
  assert.equal(h.removed.filter((npc) => npc.id === N.BONEGUARD).length, 1, 'only the player\'s boneguard is removed');
});

test('the finished cutscene cannot be replayed', () => {
  const h = setup();
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 20);
  assert.equal(h.variant(N.AKTHANAKOS), null, 'no Akthanakos branch after the quest');
  assert.equal(h.variant(N.ENAKHRA), null, 'no Enakhra branch after the quest');
  assert.equal(h.variant(N.BONEGUARD_2), null, 'no boneguard branch after the quest');
  assert.equal(h.variant(N.PENTYN), 'standard-dialogue-after-completion-of-the-quest');
});

test('Lazim briefing selection survives cancellation and advances after its last line', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const h = setup();
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 10);
  const firstVariant = 'bottom-floor-of-enakhra-s-temple-talking-to-lazim-inside-the-temple';

  assert.equal(h.variant(N.LAZIM), firstVariant);
  assert.equal(h.quest.getStage(h.player), 10);
  h.deferDialogues(true);
  assert.equal(realStartTranscript(h.api, h.player, N.LAZIM, "Enakhra's Lament", firstVariant), true);
  assert.ok(h.pendingDialogueCount() > 0, 'the imported transcript runner opened the dialogue chain');
  h.cancelDialogue();
  assert.equal(h.pendingDialogueCount(), 0, 'cancellation discards the pending dialogue chain');
  assert.equal(h.quest.getStage(h.player), 10, 'cancellation does not commit the briefing milestone');
  assert.equal(h.variant(N.LAZIM), firstVariant, 'the next talk selects the full briefing again');

  h.deferDialogues(false);
  assert.equal(realStartTranscript(h.api, h.player, N.LAZIM, "Enakhra's Lament", firstVariant), true);
  assert.equal(h.quest.getStage(h.player), 11, 'the milestone advances after the final briefing line');
});

test('Lazim post-quest first conversation is not consumed by a canceled opening', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const h = setup();
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  h.quest.setStage(h.player, 20);
  const firstVariant = 'post-quest-talking-to-lazim-after-the-quest';

  assert.equal(h.variant(N.LAZIM), firstVariant);
  assert.equal(h.attrs.get('quest.enakhras_lament.post-quest'), undefined);
  h.deferDialogues(true);
  assert.equal(realStartTranscript(h.api, h.player, N.LAZIM, "Enakhra's Lament", firstVariant), true);
  assert.ok(h.pendingDialogueCount() > 0, 'the imported transcript runner opened the first-time conversation');
  h.cancelDialogue();
  assert.equal(h.variant(N.LAZIM), firstVariant, 'canceling before speech keeps the first-time variant');
  assert.equal(h.attrs.get('quest.enakhras_lament.post-quest'), undefined);

  h.deferDialogues(false);
  assert.equal(realStartTranscript(h.api, h.player, N.LAZIM, "Enakhra's Lament", firstVariant), true);
  const pairs = h.menus.at(-1).pairs;
  const noTeachIndex = pairs.indexOf("I couldn't do that!");
  assert.ok(noTeachIndex >= 0, 'the canonical first-time choice is presented');
  pairs[noTeachIndex + 1]();
  assert.equal(h.attrs.get('quest.enakhras_lament.post-quest'), 1, 'finishing either first-time answer marks it seen');
  assert.equal(h.variant(N.LAZIM), 'post-quest-talking-to-lazim-again-after-the-quest');
});

test('chiseling 5kg sandstone checks real inventory slots before splitting', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const h = setup();
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const actualInventory = new Inventory(h.player);
  h.useInventory(actualInventory);
  actualInventory.setItem(0, new Item(I.SANDSTONE_5KG_, 1));
  for (let slot = 1; slot < 28; slot++) actualInventory.setItem(slot, new Item(I.SANDSTONE_1KG_, 1));
  assert.equal(actualInventory.getFreeSlots(), 0, 'the actual 28-slot Inventory is full');

  h.itemOnItem(I.SANDSTONE_5KG_, I.CHISEL);
  assert.equal(actualInventory.getAmount(I.SANDSTONE_5KG_), 1, 'the source block is preserved when two extra slots are needed');
  assert.equal(actualInventory.getAmount(I.SANDSTONE_2KG_), 0);
  assert.equal(actualInventory.getAmount(I.SANDSTONE_1KG_), 27);
  assert.ok(h.messages.includes("You don't have enough inventory space."));

  actualInventory.deleteNumber(I.SANDSTONE_1KG_, 2);
  assert.equal(actualInventory.getFreeSlots(), 2, 'the real container reports the two slots the split needs');
  h.itemOnItem(I.SANDSTONE_5KG_, I.CHISEL);
  assert.equal(actualInventory.getAmount(I.SANDSTONE_5KG_), 0);
  assert.equal(actualInventory.getAmount(I.SANDSTONE_2KG_), 2);
  assert.equal(actualInventory.getAmount(I.SANDSTONE_1KG_), 26, 'the split preserves all 5kg after two slots open');
});

test('the full bag at the reward waits for room, through the real transcript runner', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  runtime.startTranscript = realStartTranscript;
  try {
    const h = setup();
    const I = PluginManager.getCoreApi().ItemIdentifiers;
    const N = PluginManager.getCoreApi().NpcIdentifiers;
    h.quest.setStage(h.player, 19);
    h.setFull(true);
    runtime.startTranscript(
      h.api,
      h.player,
      N.BONEGUARD_2,
      "Enakhra's Lament",
      'middle-floor-of-enakhra-s-temple-talking-to-the-boneguard-after-finishing-the-wall',
    );
    assert.deepEqual(h.dialogueErrors, [], 'the transcript ran without errors');
    assert.equal(h.quest.getStage(h.player), 19, 'a full bag keeps the reward pending');
    assert.equal(h.inventory.get(I.CAMULET) ?? 0, 0, 'no amulet while the bag is full');
    assert.ok(
      h.texts.join(' ').replace(/<br>/g, ' ').replace(/\s+/g, ' ').includes('return when you can take it from me'),
      'the transcript asks the player to come back with room',
    );

    h.setFull(false);
    runtime.startTranscript(
      h.api,
      h.player,
      N.BONEGUARD_2,
      "Enakhra's Lament",
      'middle-floor-of-enakhra-s-temple-talking-to-the-boneguard-after-finishing-the-wall',
    );
    assert.deepEqual(h.dialogueErrors, [], 'the second transcript ran without errors');
    assert.equal(h.quest.getStage(h.player), 20, 'the reward and the cutscene complete the quest');
    assert.equal(h.inventory.get(I.CAMULET), 1, 'the amulet is handed over');
    assert.equal(h.varbits.get(1560), 70, 'the completion wire is sent');
  } finally {
    runtime.startTranscript = stubbedStartTranscript;
  }
});
