// A Porcine of Interest (q088) source-contract regression.
// From server/: node --test tests/qh728-q088.test.cjs
//
// This is a handler-contract test. Inventory and a starting stage are fixture-set and
// transcript condition/action ids are dispatched at the moment the dialogue runtime
// would emit them. It is not a live route or a visual cutscene check.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
const runtime = require('../plugins/quests/QuestRuntime');
const data = require('../data/definitions/npc-dialogues.json');

const core = PluginManager.getCoreApi();
const transcripts = [];
let transcriptObserver = null;
const originalStartTranscript = runtime.startTranscript;
runtime.startTranscript = (api, player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  if (transcriptObserver) transcriptObserver({ npcId, page, variant });
  return true;
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});
// require after the stub so the plugin captures it
const register = require('../plugins/quests/quests/PorcineOfInterest.Quest');

const N = core.NpcIdentifiers;
const I = core.ItemIdentifiers;

const SARAH = N.SARAH;
const SPRIA_DURING = N.SPRIA_3;
const SPRIA_DONE = N.SPRIA;
const SOURHOG_QUEST = N.SOURHOG_2;
const PIG_THING = N.PIG_THING;

const PAGE = 'A Porcine of Interest';
const NOTICE_BOARD = 40307;
const STRANGE_HOLE_PARENT = 40341;
const SKELETON_PARENT = 40350;
const DEAD_SOURHOG_PARENT = 40349;
const VARBIT_STAGE = 10582;
const VARBIT_FOOTCUT = 10583;
const VARBIT_NEED_ROPE = 10585;
const VARBIT_STOP_WARNING = 10587;
const HEAD = core.Equipment.HEAD_SLOT;
const WEAPON = core.Equipment.WEAPON_SLOT;

const ITEM_INFO = new Map([
  [I.ROPE, { name: 'Rope', slash: 0 }],
  [I.KNIFE, { name: 'Knife', slash: 0 }],
  [I.BRONZE_SCIMITAR, { name: 'Bronze scimitar', slash: 7 }],
  [I.REINFORCED_GOGGLES, { name: 'Reinforced goggles', slash: 0 }],
  [I.SOURHOG_FOOT, { name: 'Sourhog foot', slash: 0 }],
  [I.COINS, { name: 'Coins', slash: 0 }],
]);

function setup() {
  transcripts.length = 0;
  transcriptObserver = null;
  const attributes = new Map();
  const items = new Map();
  const varbits = new Map();
  const messages = [];
  const spawned = [];
  const removed = [];
  const ground = [];
  const registeredObjects = [];
  const loginHooks = [];
  const logoutHooks = [];
  const deathHooks = [];
  const variantHooks = [];
  const conditionHooks = [];
  const custom = new Map();
  const zoneHooks = [];
  const xp = [];
  let grantedPoints = 0;
  let slayerTask = false;
  let combatCheckDisabled = false;
  const slayerUnlocks = new Set();
  let location = new core.Location(3086, 3251, 0);
  let freeSlots = 28;
  const equipment = new Map();

  const stackable = new Set([I.COINS, I.ROPE, I.SOURHOG_FOOT]);

  function addItem(id, amount) {
    const held = items.get(id) ?? 0;
    const needed = stackable.has(id) ? (held > 0 ? 0 : 1) : amount;
    if (needed > freeSlots) return false;
    freeSlots -= needed;
    items.set(id, held + amount);
    return true;
  }
  function deleteItem(id, amount) {
    const held = items.get(id) ?? 0;
    const removedAmount = Math.min(held, amount);
    if (removedAmount <= 0) return;
    const next = held - removedAmount;
    if (next <= 0) {
      items.delete(id);
      freeSlots += stackable.has(id) ? 1 : removedAmount;
    } else {
      items.set(id, next);
      if (!stackable.has(id)) freeSlots += removedAmount;
    }
  }

  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds: (id, amount) => addItem(id, amount),
    addItem: (item) => addItem(item.getId?.() ?? item.id, item.getAmount?.() ?? item.amount),
    deleteNumber: deleteItem,
    isFull: () => freeSlots <= 0,
    getFreeSlots: () => freeSlots,
    getItems: () => [...items.entries()].map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
    forceAdd(player, item) {
      const id = item.getId?.() ?? item.id;
      const amount = item.getAmount?.() ?? item.amount;
      items.set(id, (items.get(id) ?? 0) + amount);
    },
  };

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    getVarp(id) { return varbits.get(id) ?? 0; },
  }, { get(target, prop) { return prop in target ? target[prop] : () => sender; } });

  const player = {
    getUsername: () => 'qh728-q088',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getEquipment: () => ({
      get: (slot) => equipment.get(slot),
      getItems: () => [...equipment.values()],
    }),
    getPacketSender: () => sender,
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: () => 99,
      getCombatLevel: () => 99,
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
    }),
    getLocation: () => location,
    moveTo(value) { location = new core.Location(value.getX(), value.getY(), value.getZ()); },
    getPrivateArea: () => null,
    getMovementQueue: () => ({ setBlockMovement() {}, addSteps() {} }),
    setUntargetable() {},
    performAnimation() {},
    performGraphic() {},
    getDialogueManager: () => ({ reset() {}, isActive: () => false }),
    getBanks: () => [],
    isPlayerBot: () => false,
    isRegistered: () => true,
    isPlayer: () => true,
    sendMessage(message) { messages.push(message); },
  };

  const ItemDefinition = {
    forId(id) {
      const info = ITEM_INFO.get(id) ?? { name: 'Item', slash: 0 };
      return {
        getId: () => id,
        getName: () => info.name,
        getBonuses: () => [0, info.slash, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      };
    },
  };

  class StubTask {
    constructor() {}
    stop() {}
  }
  const TaskManager = {
    // Run scheduled callbacks immediately: the test drives one cutscene edge at a
    // time and has no tick loop.
    submit(task) {
      if (typeof task?.execute === 'function') task.execute();
      else if (typeof task?.callback === 'function') task.callback();
    },
    cancelTasks() {},
  };
  class CountdownTask {
    constructor(_player, _ticks, callback) { this.callback = callback; }
  }
  class StubBoundary {
    constructor(...args) { this.args = args; }
  }
  class StubPrivateArea {
    constructor() {}
    enter() {}
    add() {}
    leave() {}
    isDestroyed() { return false; }
    postLeave() {}
  }
  class StubGameObject {
    constructor(id, objectLocation) { this.id = id; this.objectLocation = objectLocation; }
    getLocation() { return this.objectLocation; }
  }
  const ObjectManager = {
    register(object) { registeredObjects.push(object); },
    deregister() {},
  };

  const api = new Proxy({
    core: {
      ...core,
      ItemDefinition,
      Task: StubTask,
      TaskManager,
      CountdownTask,
      Boundary: StubBoundary,
      PrivateArea: StubPrivateArea,
      GameObject: StubGameObject,
      ObjectManager,
    },
    persistAttribute() {},
    onCustomEvent(name, fn) {
      if (!custom.has(name)) custom.set(name, []);
      custom.get(name).push(fn);
    },
    emitCustomEvent(name, event) {
      if (name === 'slayer:task-tip' && slayerTask && event) event.line = 'Kill some sourhogs.';
      if (name === 'slayer:grant-points' && event) grantedPoints += event.points;
      if (name === 'slayer:has-unlock' && event && slayerUnlocks.has(event.name)) event.unlocked = true;
      for (const fn of custom.get(name) ?? []) fn(event);
    },
    onNpcDialogueVariant(fn) { variantHooks.push(fn); },
    onNpcDialogueCondition(fn) { conditionHooks.push(fn); },
    onObjectInteraction(fn) { objectHooks.push(fn); },
    onItemOnObject(fn) { itemOnObjectHooks.push(fn); },
    onNpcDeath(fn) { deathHooks.push(fn); },
    onPlayerLogin(fn) { loginHooks.push(fn); },
    onPlayerLogout(fn) { logoutHooks.push(fn); },
    onPlayerDeath(fn) { deathHooks.push(fn); },
    onZoneEnter(_zone, fn) { zoneHooks.push(fn); },
    onCanUnequip() {},
    onInterfaceActionButton() {},
    registerNpcCombatMethodProvider() {},
    spawnNpc(def) {
      const npc = {
        def,
        getId: () => def.id,
        getContentId: () => def.id,
        getLocation: () => new core.Location(def.x, def.y, def.z),
        getOwner: () => def.owner,
        getMovementQueue: () => ({ addSteps() {} }),
        performAnimation() {},
        setPositionToFace() {},
        isRegistered: () => true,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { removed.push(npc); },
    getItemOnGroundManager: () => ({
      registerLocation(_player, item, tile) { ground.push({ id: item.getId(), tile }); },
      getGroundItem() { return null; },
    }),
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => undefined;
    },
  });

  const objectHooks = [];
  const itemOnObjectHooks = [];

  register(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'a_porcine_of_interest');

  const variant = (npcId) => {
    for (const fn of variantHooks) {
      const result = fn({ player, npcId, definition: { getId: () => npcId }, pages: [{ page: PAGE }] });
      if (result) return typeof result === 'string' ? result : result.variant;
    }
    return null;
  };
  const condition = (stepId, npcId = SPRIA_DURING) => {
    for (const fn of conditionHooks) {
      const result = fn({ player, npcId, stepId, text: '', definition: { getId: () => npcId } });
      if (result !== null && result !== undefined) return result;
    }
    return null;
  };
  const action = (stepId, npcId = SPRIA_DURING, kind = 'action') => {
    const event = { player, npcId, stepId, kind, definition: { getId: () => npcId }, text: '', handled: false };
    api.emitCustomEvent('npc-dialogue:action', event);
    return event;
  };
  const message = (stepId, npcId) => action(stepId, npcId, 'message');
  const conditionChosen = (stepId, npcId = SARAH) => {
    const event = { player, npcId, stepId, text: '', definition: { getId: () => npcId } };
    api.emitCustomEvent('npc-dialogue:condition', event);
    return event;
  };
  const choice = (option, npcId = SARAH) => {
    const event = { player, npcId, option, definition: { getId: () => npcId }, handled: false };
    api.emitCustomEvent('npc-dialogue:choice', event);
    return event;
  };
  const hook = (name, npcId = SARAH) => {
    const event = { player, npcId, hook: name, quest: 'A Porcine of Interest', definition: { getId: () => npcId } };
    api.emitCustomEvent('npc-dialogue:hook', event);
    return event;
  };
  const objectInteract = (objectId, clickType = 1) => {
    const event = { player, objectId, clickType, handled: false };
    for (const fn of objectHooks) fn(event);
    return event;
  };
  const itemOnObject = (itemId, objectId) => {
    const event = { player, itemId, objectId, handled: false };
    for (const fn of itemOnObjectHooks) fn(event);
    return event;
  };
  const death = (npcId, npc) => {
    for (const fn of deathHooks) fn({ killer: player, npcId, npc, location: npc.getLocation() });
  };
  const login = () => {
    for (const fn of loginHooks) fn({ player, username: player.getUsername() });
    runtime.sendQuestVarps({ player });
  };
  const bootstrap = () => {
    api.emitCustomEvent('player:bootstrap-complete', { player });
    runtime.sendQuestVarps({ player });
  };
  const give = (id, amount = 1) => { items.set(id, (items.get(id) ?? 0) + amount); };
  const equip = (slot, id) => equipment.set(slot, { getId: () => id });

  return {
    api, player, quest, items, varbits, messages, spawned, removed, ground, registeredObjects, xp,
    get grantedPoints() { return grantedPoints; },
    setSlayerTask(value) { slayerTask = value; },
    getSlayerTaskForTest() { return slayerTask; },
    setCombatCheckDisabled(value) { combatCheckDisabled = value; },
    addSlayerUnlock(name) { slayerUnlocks.add(name); },
    variant, condition, conditionChosen, action, message, choice, hook, objectInteract, itemOnObject, death, login, bootstrap, give, equip,
    transcripts,
    setObserver(fn) { transcriptObserver = fn; },
    stage: () => quest.getStage(player),
    setStage: (value) => quest.setStage(player, value),
    setLocation: (x, y, z) => { location = new core.Location(x, y, z); },
    setFreeSlots: (value) => { freeSlots = value; },
    getFreeSlots: () => freeSlots,
    get combatCheckDisabled() { return combatCheckDisabled; },
  };
}

// The Slayer plugin registers after the quests; this stands in for its condition hook so a
// Porcine answer would be observed first and win if it still hardcoded these.
function installSlayerStandIn(h) {
  h.api.onNpcDialogueCondition(({ stepId }) => {
    if (stepId === '9dGri8') return h.combatCheckDisabled;
    if (stepId === '6YLYvN') return !h.combatCheckDisabled;
    if (stepId === 'DhLGnl') return !h.getSlayerTaskForTest();
    if (stepId === 'oIq-xQ') return h.getSlayerTaskForTest();
    return null;
  });
}

test('cache contract: wire varbit 10582 reaches the 40 threshold and login replays saves', () => {
  const h = setup();
  assert.equal(h.quest.varbitId, VARBIT_STAGE);
  assert.equal(h.quest.varpId, 2748);
  assert.equal(h.quest.completionValue, 9);
  assert.equal(h.quest.varbitValue(9, h.player), 40);

  h.login();
  h.bootstrap();
  assert.equal(h.varbits.get(VARBIT_STAGE), 0, 'fresh stage 0 replays on login');

  const wires = [[1, 5], [2, 10], [3, 15], [4, 20], [5, 25], [6, 30], [7, 30], [8, 35], [9, 40]];
  for (const [stage, wire] of wires) {
    h.setStage(stage);
    h.login();
    h.bootstrap();
    assert.equal(h.varbits.get(VARBIT_STAGE), wire, `stage ${stage} replays as wire ${wire}`);
  }
});

test('fresh stage 0 reaches completion through the registered mandatory handlers', () => {
  const h = setup();
  h.give(I.ROPE, 1);

  h.objectInteract(NOTICE_BOARD);
  assert.equal(h.transcripts.at(-1).variant, 'starting-out-searching-the-notice-board');
  h.hook('quest:a-porcine-of-interest:start');
  assert.equal(h.stage(), 1);
  assert.equal(h.varbits.get(VARBIT_STAGE), 5);

  h.choice('Talk about the bounty.');
  assert.equal(h.stage(), 2);
  assert.equal(h.varbits.get(VARBIT_STAGE), 10);

  h.itemOnObject(I.ROPE, STRANGE_HOLE_PARENT);
  assert.equal(h.transcripts.at(-1).variant, 'investigating-the-crossroads-strange-hole');
  assert.equal(h.condition('k3vDUa', SARAH), true);
  h.conditionChosen('k3vDUa', SARAH);
  h.action('tp5oyF', SARAH, 'message');
  assert.equal(h.stage(), 3);
  assert.equal(h.varbits.get(VARBIT_STAGE), 15);
  assert.equal(h.items.get(I.ROPE) ?? 0, 0, 'tying the rope consumes it');

  h.objectInteract(SKELETON_PARENT);
  assert.equal(h.transcripts.at(-1).variant, 'inside-the-cave-investigating-the-skeleton');
  h.action('EaeUfj', PIG_THING);
  assert.equal(h.stage(), 4);
  assert.equal(h.varbits.get(VARBIT_STAGE), 20);

  assert.equal(h.condition('-iFZGD', SPRIA_DURING), true);
  h.action('LFxcPW', SPRIA_DURING);
  assert.equal(h.stage(), 5);
  assert.equal(h.varbits.get(VARBIT_STAGE), 25);
  assert.equal(h.items.get(I.REINFORCED_GOGGLES), 1);

  h.equip(HEAD, I.REINFORCED_GOGGLES);
  h.objectInteract(STRANGE_HOLE_PARENT);
  const boss = h.spawned.find((npc) => npc.getId() === SOURHOG_QUEST);
  assert.ok(boss, 'entering the cave at the kill stage spawns quest Sourhog 10436');
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()], [3158, 9713, 0]);

  h.death(SOURHOG_QUEST, boss);
  assert.equal(h.stage(), 6);
  assert.equal(h.varbits.get(VARBIT_STAGE), 30);
  assert.equal(h.registeredObjects.at(-1).id, 40349, 'death registers the dead-sourhog multiloc');

  h.objectInteract(DEAD_SOURHOG_PARENT);
  assert.equal(h.transcripts.at(-1).variant, 'the-sourhog-taking-the-sourhog-s-foot');
  h.message('Um0TAs', SARAH);
  assert.equal(h.stage(), 7);
  assert.equal(h.items.get(I.SOURHOG_FOOT), 1);
  assert.equal(h.varbits.get(VARBIT_FOOTCUT), 1);

  h.message('fvC8GN', SARAH);
  assert.equal(h.stage(), 8);
  assert.equal(h.varbits.get(VARBIT_STAGE), 35);
  assert.equal(h.items.get(I.SOURHOG_FOOT) ?? 0, 0, 'Sarah consumes the foot');
  assert.equal(h.items.get(I.COINS), 5000);

  assert.equal(h.variant(SPRIA_DURING), 'finishing-up-talking-to-spria');
  h.action('w1i1Mg', SPRIA_DURING);
  assert.equal(h.stage(), 9);
  assert.equal(h.varbits.get(VARBIT_STAGE), 40, 'completion is at the cache threshold');
  assert.equal(h.xp.filter((entry) => entry.amount === 1000).length, 1);
  assert.equal(h.grantedPoints, 30);

  h.action('w1i1Mg', SPRIA_DURING);
  assert.equal(h.xp.filter((entry) => entry.amount === 1000).length, 1, 'replaying completion does not duplicate XP');
  assert.equal(h.grantedPoints, 30, 'replaying completion does not duplicate points');
  h.login();
  h.bootstrap();
  assert.equal(h.varbits.get(VARBIT_STAGE), 40, 'completion survives relog');
});

test('fresh stage 0 needs a rope and consumes nothing without one', () => {
  const h = setup();
  h.setStage(2);
  assert.equal(h.condition('eqR84-', SARAH), true);
  h.conditionChosen('eqR84-', SARAH);
  assert.equal(h.stage(), 2);
  assert.equal(h.varbits.get(VARBIT_NEED_ROPE), 1);
  assert.equal(h.items.get(I.ROPE), undefined);
});

test('Spria refuses the goggles with a full bag and keeps stage 4', () => {
  const h = setup();
  h.setStage(4);
  h.setFreeSlots(0);
  assert.equal(h.condition('fEocnZ', SPRIA_DURING), true);
  assert.equal(h.condition('-iFZGD', SPRIA_DURING), false);
  h.action('LFxcPW', SPRIA_DURING);
  assert.equal(h.items.get(I.REINFORCED_GOGGLES), undefined);
  assert.equal(h.stage(), 4);
  assert.match(h.messages.join('\n'), /free inventory space/i);
});

test('cutting the foot is refused with a full bag and needs the action context', () => {
  const h = setup();
  h.setStage(6);
  h.setFreeSlots(0);
  const refused = h.message('Um0TAs', SARAH);
  assert.equal(h.items.get(I.SOURHOG_FOOT), undefined);
  assert.equal(h.stage(), 6);
  assert.equal(refused.box.statement, true, 'full bag shows a statement, not the success item box');
  assert.equal(refused.box.items, undefined);
  assert.match(refused.text, /free inventory space/i);

  h.setFreeSlots(5);
  h.give(I.KNIFE, 1);
  h.setObserver(({ variant: started }) => {
    if (started !== 'the-sourhog-taking-the-sourhog-s-foot') return;
    assert.equal(h.condition('lfiWkg', SARAH), false, 'a knife is a sharp tool');
    assert.equal(h.condition('zc6fD9', SARAH), true);
  });
  h.objectInteract(DEAD_SOURHOG_PARENT);
  h.message('Um0TAs', SARAH);
  assert.equal(h.items.get(I.SOURHOG_FOOT), 1);
  assert.equal(h.stage(), 7);
});

test('side bits replay on login and bootstrap from the durable attribute', () => {
  const h = setup();
  h.setStage(7);
  h.setObserver(({ variant: started }) => {
    if (started === 'the-sourhog-taking-the-sourhog-s-foot') {
      assert.equal(h.condition('zc6fD9', SARAH), true);
    }
  });
  h.give(I.KNIFE, 1);
  h.objectInteract(DEAD_SOURHOG_PARENT);
  h.message('Um0TAs', SARAH);
  assert.equal(h.varbits.get(VARBIT_FOOTCUT), 1);

  h.varbits.clear();
  h.login();
  assert.equal(h.varbits.get(VARBIT_STAGE), 30);
  assert.equal(h.varbits.get(VARBIT_FOOTCUT), 1, 'login resends the footcut bit');

  h.varbits.clear();
  h.bootstrap();
  assert.equal(h.varbits.get(VARBIT_STAGE), 30, 'bootstrap resends the durable stage');
  assert.equal(h.varbits.get(VARBIT_FOOTCUT), 1, 'bootstrap resends the footcut bit');
});

test('Porcine yields the Slayer standard-page conditions and answers its own unlock branch', () => {
  const h = setup();
  h.setStage(9);
  installSlayerStandIn(h);

  h.setCombatCheckDisabled(true);
  assert.equal(h.condition('9dGri8', SPRIA_DONE), true, 'the Slayer owner answers disabled combat checking');
  assert.equal(h.condition('6YLYvN', SPRIA_DONE), false, 'Porcine does not force enabled combat checking');
  h.setCombatCheckDisabled(false);
  assert.equal(h.condition('9dGri8', SPRIA_DONE), false);
  assert.equal(h.condition('6YLYvN', SPRIA_DONE), true);

  assert.equal(h.condition('cuEtvC', SPRIA_DONE), false);
  h.addSlayerUnlock('Malevolent Masquerade');
  assert.equal(h.condition('cuEtvC', SPRIA_DONE), true);
});

test('stage predicates select the Quest Helper variants for Sarah and Spria', () => {
  const h = setup();
  const sarah = (stage, expected) => {
    h.setStage(stage);
    assert.equal(h.variant(SARAH), expected, `Sarah stage ${stage}`);
  };
  sarah(0, 'standard-dialogue');
  sarah(1, 'starting-out-talking-to-sarah-initial-conversation');
  sarah(2, 'starting-out-talking-to-sarah-subsequent-conversation');
  sarah(3, 'inside-the-cave-talking-to-sarah-after-finding-the-cave');
  sarah(7, 'collecting-the-bounty-talking-to-sarah');
  sarah(8, 'finishing-up-talking-to-sarah-before-telling-spria-about-the-bounty-completion');
  sarah(9, 'standard-dialogue');

  const spria = (stage, expected) => {
    h.setStage(stage);
    assert.equal(h.variant(SPRIA_DURING), expected, `Spria stage ${stage}`);
  };
  spria(0, 'standard-dialogue-before-a-porcine-of-interest');
  spria(4, 'the-sourhog-talking-to-spria-initial-conversation');
  spria(5, 'the-sourhog-talking-to-spria-after-acquiring-the-reinforced-goggles');
  spria(6, 'collecting-the-bounty-talking-to-spria');
  spria(8, 'finishing-up-talking-to-spria');
  spria(9, 'standard-dialogue-after-a-porcine-of-interest');
});

let realCounter = 0;

function findOption(steps, text) {
  for (const step of steps ?? []) {
    for (const option of step.options ?? []) {
      if (option.text === text) return option;
      const nested = findOption(option.steps, text);
      if (nested) return nested;
    }
    const nested = findOption(step.steps, text);
    if (nested) return nested;
  }
  return null;
}

function fillInventory(player) {
  let id = 20000;
  while (!player.getInventory().isFull() && id < 20100) {
    player.getInventory().adds(id++, 1);
  }
  assert.equal(player.getInventory().isFull(), true, 'fixture filled every inventory slot');
}

function realSetup(stage) {
  const api = PluginManager.createApi(`qh728-q088-real-${++realCounter}`);
  const lines = [];
  const actions = [];
  const messages = [];
  const packets = [];
  const sender = new Proxy({}, {
    get: (_target, method) => {
      if (method === 'getVarbit' || method === 'getVarp') return () => 0;
      return (...args) => {
        packets.push([String(method), ...args]);
        return sender;
      };
    },
  });
  const player = new Player(null);
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(String(text));

  const objectHooks = [];
  const registerObjectHook = api.onObjectInteraction.bind(api);
  api.onObjectInteraction = (handler, actions) => {
    if (typeof handler === 'function') {
      objectHooks.push(handler);
      return;
    }
    return registerObjectHook(handler, actions);
  };
  runtime.startTranscript = originalStartTranscript;
  try {
    register(api);
  } finally {
    runtime.startTranscript = (api_, player_, npcId, page, variant) => {
      transcripts.push({ npcId, page, variant });
      if (transcriptObserver) transcriptObserver({ npcId, page, variant });
      return true;
    };
  }
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'a_porcine_of_interest');
  quest.setStage(player, stage);
  // Register observers after the plugin so they see the plugin's final text/box.
  api.onCustomEvent('npc-dialogue:line', (event) => lines.push(String(event.text ?? '')));
  api.onCustomEvent('npc-dialogue:action', (event) => actions.push(event));
  const objectInteract = (objectId, clickType = 1) => {
    const event = { player, objectId, clickType, handled: false };
    for (const fn of objectHooks) fn(event);
    return event;
  };
  return { api, player, quest, lines, actions, messages, packets, objectInteract };
}

function play(api, player, npcId, steps, branches) {
  player.getDialogueManager().reset();
  const event = { player, npcId, definition: NpcDefinition.forId(npcId) };
  startDialogue(api, event, steps, branches, { ...event, pages: [{ page: PAGE }] });
}

function runDialogue(player, limit = 60) {
  for (let i = 0; i < limit && player.getDialogueManager().isActive(); i++) {
    if (!player.getDialogueManager().handleResume((231 << 16) | 5, 1)) break;
  }
}

test('real transcript runner: full-bag cut-foot refuses, retry succeeds with the item box', () => {
  const h = realSetup(6);
  h.player.getInventory().adds(I.KNIFE, 1);
  fillInventory(h.player);

  // The object handler starts the generated variant through the real startTranscript.
  h.objectInteract(DEAD_SOURHOG_PARENT);
  const refused = h.actions.find((event) => event.stepId === 'Um0TAs');
  assert.ok(refused, 'the cut-foot message ran through the registered handler');
  assert.equal(refused.box.statement, true, 'refusal is a statement, not the success item box');
  assert.equal(refused.box.items, undefined);
  assert.match(refused.text, /free inventory space/i);
  assert.equal(h.player.getInventory().getAmount(I.SOURHOG_FOOT), 0);
  assert.equal(h.quest.getStage(h.player), 6);

  const filler = h.player.getInventory().getItems().find((item) => item.getId() === 20000);
  assert.ok(filler, 'fixture filler item is present');
  h.player.getInventory().deleteNumber(20000, 1);
  h.objectInteract(DEAD_SOURHOG_PARENT);
  const succeeded = h.actions.filter((event) => event.stepId === 'Um0TAs').at(-1);
  assert.deepEqual(succeeded.box.items, [I.SOURHOG_FOOT]);
  assert.equal(h.player.getInventory().getAmount(I.SOURHOG_FOOT), 1);
  assert.equal(h.quest.getStage(h.player), 7);
});

test('real transcript runner: full-bag goggle reclaim refuses and retries with the hand-out', () => {
  const h = realSetup(5);
  const record = data[PAGE];
  const option = findOption(
    record.variants['the-sourhog-talking-to-spria-initial-conversation'],
    'Can I have another pair of Reinforced Goggles?',
  );
  assert.ok(option, 'reclaim option exists in the generated transcript');
  fillInventory(h.player);

  play(h.api, h.player, SPRIA_DURING, option.steps, record.branches);
  runDialogue(h.player);
  assert.equal(h.lines.some((text) => text.includes('free up some inventory space')), true,
    'the hand-out line is replaced by a refusal');
  assert.equal(h.lines.some((text) => text.startsWith('Sure, I have another going spare.')), false,
    'no success line with a full bag');
  assert.equal(h.player.getInventory().getAmount(I.REINFORCED_GOGGLES), 0);
  const refused = h.actions.find((event) => event.stepId === 'nT99T5');
  assert.equal(refused.end, true, 'the refused hand-over ends without granting');

  h.player.getInventory().deleteNumber(20000, 1);
  play(h.api, h.player, SPRIA_DURING, option.steps, record.branches);
  runDialogue(h.player);
  assert.equal(h.lines.some((text) => text.startsWith('Sure, I have another going spare.')), true,
    'normal capacity keeps the canonical hand-out line');
  assert.equal(h.player.getInventory().getAmount(I.REINFORCED_GOGGLES), 1);
  const succeeded = h.actions.filter((event) => event.stepId === 'nT99T5').at(-1);
  assert.notEqual(succeeded.end, true, 'successful hand-over does not end as a refusal');
});
