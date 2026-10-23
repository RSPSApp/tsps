// From server/: node --test tests/qh728-q006.test.cjs (no build needed; plugins load from source).
// QH q006 Big Chompy Bird Hunting: the canonical QH arrow hand-in is item-use
// (use 6+ ogre arrows on Rantz), not only the Talk-to variant.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();
const core = require(root + '/dist/plugins/PluginManager').PluginManager.getCoreApi();
const runtime = require(root + '/plugins/quests/QuestRuntime');
const { PluginManager } = require(root + '/dist/plugins/PluginManager');
const noop = () => {};

before(async () => {
  const { CachePipeline } = require(root + '/dist/game/cache/CachePipeline');
  const { NpcDefinitionLoader } = require(root + '/dist/game/definition/loader/impl/NpcDefinitionLoader');
  const { RegionManager } = require(root + '/dist/game/collision/RegionManager');
  await CachePipeline.initialize(root);
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function player(items = [], attrs = [], levels = {}) {
  const attributes = new Map(attrs), inventory = new Map(items);
  let location = new core.Location(3210, 3220, 0);
  const packet = new Proxy({
    sendInterfaceRemoval() { p.manager?.reset(); p.prompt = null; return packet; },
    sendCameraMoveTo(...args) { p.camera.push(['move', ...args]); return packet; },
    sendCameraLookAt(...args) { p.camera.push(['look', ...args]); return packet; },
    sendCameraReset() { p.camera.push(['reset']); return packet; },
  }, { get: (target, key) => target[key] ?? (() => packet) });
  const p = {
    xp: [],
    moves: [],
    camera: [],
    equipped: new Map(),
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: id => inventory.get(id) ?? 0,
      contains: id => (inventory.get(id) ?? 0) > 0,
      isFull: () => Boolean(p.inventoryFull),
      getFreeSlots: () => p.inventoryFull ? 0 : 28,
      getItems: () => [],
      getValidItems: () => [],
      adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount),
      forceAdd: (item) => inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()),
      deleteNumber: (id, amount) => inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - amount)),
    }),
    getEquipment: () => ({ get: slot => p.equipped.get(slot) ?? null, getAmount: () => 0,
      getItems: () => [...p.equipped.values()] }),
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: skill => levels[skill.getIndex()] ?? 99,
      getCombatLevel: () => 3,
      addExperiences: (skill, amount) => p.xp.push([skill.getIndex(), amount]),
    }),
    getPacketSender: () => packet,
    getLocation: () => location,
    getArea: () => null,
    getPrivateArea: () => null,
    getAsPlayer: () => p,
    moveTo: to => { location = to; p.moves.push([to.getX(), to.getY(), to.getZ()]); },
    getBanks: () => [],
    getUsername: () => 'QH q006',
    getUpdateFlag: () => ({ flag: noop }),
    messages: [],
    sendMessage(message) { p.messages.push(message); },
    performAnimation: noop,
    isPlayer: () => true,
    isNpc: () => false,
    isRegistered: () => true,
    setPositionToFace: noop,
    items: inventory,
    attrs: attributes,
  };
  return p;
}

function dialoguePlayer(items, attrs, levels) {
  const { DialogueManager } = require(root + '/dist/game/model/dialogues/DialogueManager');
  const p = player(items, attrs, levels);
  p.manager = new DialogueManager(p);
  p.getDialogueManager = () => p.manager;
  return p;
}

function questHarness() {
  const hooks = {};
  const spawned = [], removed = [], tasks = [], sceneChat = [];
  const rantz = {
    getId: () => core.NpcIdentifiers.RANTZ,
    getLocation: () => new core.Location(2630, 2981, 0),
    isRegistered: () => true,
    forceChat: text => sceneChat.push(text),
    performAnimation: noop,
  };
  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { for (const task of tasks) if (task.key === key) task.stop(); },
  };
  const api = new Proxy({
    core: { ...core, TaskManager: taskManager,
      World: { ...core.World, getNpcsNear: () => [rantz] } },
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (hooks[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (hooks[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) {
      p.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
      return true;
    },
    spawnNpc(definition) {
      const npc = {
        ...definition,
        getId: () => definition.id,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z ?? 0),
        getOwner: () => definition.owner,
        isRegistered: () => true,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { removed.push(npc); },
  }, { get: (target, key) => target[key] ?? ((...args) => {
    (hooks[key] ??= []).push(args.find(arg => typeof arg === 'function'));
  }) });
  require(root + '/plugins/quests/quests/BigChompyBirdHunting.Quest')(api);
  return { api, hooks, spawned, removed, tasks, sceneChat,
    quest: runtime.getRegisteredQuests().at(-1) };
}

function tickTasks(h, ticks) {
  for (let tick = 0; tick < ticks; tick++) {
    for (const task of [...h.tasks]) if (task.isRunning()) task.tick();
  }
}

function withConditions(hooks, fn) {
  const original = PluginManager.emitNpcDialogueCondition;
  PluginManager.emitNpcDialogueCondition = event => {
    for (const handler of hooks.onNpcDialogueCondition ?? []) {
      const answer = handler(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  try {
    return fn();
  } finally {
    PluginManager.emitNpcDialogueCondition = original;
  }
}

function continueToMenu(p, limit = 120) {
  while (!p.prompt) {
    assert.ok(limit-- > 0, 'dialogue stalled before a menu');
    assert.ok(p.manager.getCurrent(), 'dialogue ended before a menu');
    p.manager.advance();
  }
}

function choose(p, text) {
  const prompt = p.prompt;
  assert.ok(prompt, 'no menu for ' + text);
  const index = prompt.options.indexOf(text);
  assert.ok(index >= 0, 'missing ' + text + ' in ' + JSON.stringify(prompt.options));
  p.prompt = null;
  prompt.pairs[index * 2 + 1]();
}

function continueUntil(p, predicate, limit = 120) {
  while (!predicate()) {
    assert.ok(limit-- > 0, 'dialogue stalled');
    assert.ok(p.manager.getCurrent(), 'dialogue ended before the hand-in');
    p.manager.advance();
  }
}

function advanceUntil(p, predicate, limit = 120) {
  while (!predicate()) {
    assert.ok(limit-- > 0, 'dialogue stalled');
    assert.ok(p.manager.getCurrent(), 'dialogue ended before the expected line');
    p.manager.advance();
  }
}

const PAGE = 'Big Chompy Bird Hunting';
// Revision 241: spawned parent 1470 resolves to content id 14793 (NpcIdentifiers.RANTZ).
const RANTZ = core.NpcIdentifiers.RANTZ;

test('real cave entrance Enter lands on the cache mouth tile and reaches the chest', () => {
  const { RegionManager } = require(root + '/dist/game/collision/RegionManager');
  const { MapObjects } = require(root + '/dist/game/entity/impl/object/MapObjects');
  const O = core.ObjectIdentifiers;
  if (!global.__q006RealCave) {
    require(root + '/plugins/quests/quests/BigChompyBirdHunting.Quest')(
      PluginManager.createApi('BigChompyQ006Cave'));
    global.__q006RealCave = true;
  }
  const quest = runtime.getRegisteredQuests().findLast(entry => entry.key === 'big_chompy_bird_hunting');
  const p = player();
  quest.setStage(p, 15);

  RegionManager.loadMapFiles(2629, 2998);
  const entrance = MapObjects.get(O.CAVE_ENTRANCE_18, new core.Location(2629, 2998, 0), null);
  assert.ok(entrance, 'cache loc 3379 is placed at 2629,2998');
  assert.equal(entrance.getDefinition().getActions()[0], 'Enter');
  assert.equal(entrance.getDefinition().getSizeX(), 3);
  assert.equal(entrance.getDefinition().getSizeY(), 2);

  const event = { player: p, object: entrance, objectId: entrance.getId(), clickType: 1, option: 'Enter', handled: false };
  assert.equal(PluginManager.emitObjectInteraction(event), true, 'the registered Enter action claims the cave entrance');
  assert.deepEqual(p.moves.at(-1), [2635, 9397, 0], 'lands on the walkable cave-mouth tile');
  assert.equal(RegionManager.blocked(new core.Location(2635, 9397, 0), null), false, 'landing tile is walkable');
  assert.equal(RegionManager.blocked(new core.Location(2630, 9398, 0), null), true, 'the old +6400 landing is blocked');

  assert.equal(RegionManager.canMove(2635, 9397, 2636, 9397, 0, 1, 1, null), true);
  assert.equal(RegionManager.canMove(2636, 9397, 2637, 9397, 0, 1, 1, null), true,
    'the chest approach 2637,9397 is reachable from the landing');
  const chest = MapObjects.get(O.LOCKED_OGRE_CHEST, new core.Location(2637, 9398, 0), null);
  assert.ok(chest, 'cache loc 3377 is placed at 2637,9398');
  assert.ok(chest.getDefinition().getActions().includes('Unlock'), 'the chest Unlock action is present');
});

test('real cave exit lands on the canonical surface step and routes to Rantz, clearing and bubbles', () => {
  const { RegionManager } = require(root + '/dist/game/collision/RegionManager');
  const { MapObjects } = require(root + '/dist/game/entity/impl/object/MapObjects');
  const { RsmodRouteFinding } = require(root + '/dist/game/model/movement/path/RsmodRouteFinding');
  const O = core.ObjectIdentifiers;
  if (!global.__q006RealCave) {
    require(root + '/plugins/quests/quests/BigChompyBirdHunting.Quest')(
      PluginManager.createApi('BigChompyQ006Cave'));
    global.__q006RealCave = true;
  }
  const quest = runtime.getRegisteredQuests().findLast(entry => entry.key === 'big_chompy_bird_hunting');
  const p = player();
  quest.setStage(p, 20);

  RegionManager.loadMapFiles(2647, 9377);
  RegionManager.loadMapFiles(2629, 2998);
  const exit = MapObjects.get(O.CAVE_EXIT_9, new core.Location(2647, 9377, 0), null);
  assert.ok(exit, 'cache loc 3381 is placed at 2647,9377');
  assert.equal(exit.getDefinition().getActions()[0], 'Walk through');

  const event = { player: p, object: exit, objectId: exit.getId(), clickType: 1, option: 'Walk through', handled: false };
  assert.equal(PluginManager.emitObjectInteraction(event), true, 'the registered Walk through action claims cave exit 3381');
  assert.deepEqual(p.moves.at(-1), [2630, 2997, 0], 'lands on the south step of the surface entrance');
  assert.equal(RegionManager.blocked(new core.Location(2630, 2997, 0), null), false, 'exit landing is walkable');

  const right = MapObjects.get(O.CAVE_EXIT_8, new core.Location(2646, 9377, 0), null);
  assert.ok(right, 'paired cache loc 3380 is placed at 2646,9377');
  const p2 = player();
  quest.setStage(p2, 20);
  const rightEvent = { player: p2, object: right, objectId: right.getId(), clickType: 1, option: 'Walk through', handled: false };
  assert.equal(PluginManager.emitObjectInteraction(rightEvent), true, 'paired exit 3380 is handled');
  assert.deepEqual(p2.moves.at(-1), [2630, 2997, 0], 'paired exit uses the same canonical landing');

  const route = new RsmodRouteFinding();
  const path = (srcX, srcY, destX, destY, moveNear = false) => route.findRoute({
    level: 0, srcX, srcY, srcSize: 1, destX, destY, moveNear, maxWaypoints: 100,
  });
  assert.equal(path(2630, 2997, 2631, 2982).success, true, 'exit reaches Rantz exactly');
  assert.equal(path(2630, 2997, 2635, 2966).success, true, 'exit reaches the toad clearing exactly');
  assert.equal(path(2631, 2982, 2630, 2997).success, true, 'Rantz can walk back to the cave entrance');
  assert.equal(path(2635, 9397, 2647, 9378).success, true, 'cave landing reaches the exit 3381 stand tile');
  assert.equal(path(2647, 9378, 2635, 9397).success, true, 'exit stand returns to the cave entrance landing');
  const bubbles = path(2630, 2997, 2601, 2967, true);
  assert.equal(bubbles.success, true, 'exit reaches the swamp bubbles approach');
  assert.deepEqual([bubbles.endX, bubbles.endY], [2602, 2967], 'bubble interaction tile is one step east');

  assert.equal(path(2647, 2977, 2631, 2982).success, false, 'the old -6400 landing cannot reach Rantz');
  assert.equal(path(2647, 2977, 2601, 2967, true).success, false, 'the old landing cannot reach the swamp');
});

test('fresh stage 0 accepts the start on the resolved Rantz content id 14793', () => {
  const { api, hooks, quest } = questHarness();
  const p = dialoguePlayer();
  const choice = hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId: RANTZ })).find(Boolean);
  assert.ok(choice, 'resolved Rantz 14793 selects the Big Chompy start variant');
  withConditions(hooks, () => {
    runtime.startTranscript(api, p, RANTZ, choice.page, choice.variant);
    continueToMenu(p);
    choose(p, 'Yes.');
  });
  assert.equal(quest.getStage(p), 5, 'the start hook advances to stage 5');
});

test('using six ogre arrows on Rantz takes six arrows and advances to stage 10', () => {
  const { api, hooks, quest } = questHarness();
  const p = dialoguePlayer([[core.ItemIdentifiers.OGRE_ARROW, 6]]);
  quest.setStage(p, 5);

  const handler = (hooks.onItemOnNpc ?? [])[0];
  assert.ok(handler, 'Big Chompy registers an item-on-NPC route for the QH arrow hand-in');
  const event = { player: p, npcId: RANTZ, itemId: core.ItemIdentifiers.OGRE_ARROW, handled: false };
  withConditions(hooks, () => {
    handler(event);
    assert.equal(event.handled, true, 'using the arrows on Rantz is claimed');
    continueUntil(p, () => quest.getStage(p) === 10);
  });
  assert.equal(p.items.get(core.ItemIdentifiers.OGRE_ARROW) ?? 0, 0, 'Rantz takes the six arrows');
});

test('Talk-to arrow hand-in still consumes six arrows and advances to stage 10', () => {
  const { api, hooks, quest } = questHarness();
  const p = dialoguePlayer([[core.ItemIdentifiers.OGRE_ARROW, 6]]);
  quest.setStage(p, 5);

  const choice = hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId: RANTZ })).find(Boolean);
  assert.ok(choice, 'stage 5 Rantz has a Talk-to variant');
  withConditions(hooks, () => {
    runtime.startTranscript(api, p, RANTZ, choice.page, choice.variant);
    continueUntil(p, () => quest.getStage(p) === 10);
  });
  assert.equal(p.items.get(core.ItemIdentifiers.OGRE_ARROW) ?? 0, 0, 'the Talk-to route consumes the same six arrows');
});

test('stage 0 to completion: cave, bellows, toads, bow, chompy, ingredients and hand-in', () => {
  const h = questHarness();
  const { api, hooks, spawned, removed, quest } = h;
  const p = dialoguePlayer();
  const I = core.ItemIdentifiers;
  const O = core.ObjectIdentifiers;
  const variantFor = (player, npcId) => {
    const choice = hooks.onNpcDialogueVariant.map(fn => fn({ player, npcId })).find(Boolean);
    assert.ok(choice, `no variant for ${npcId}`);
    return choice;
  };
  const play = (player, npcId) => {
    const choice = variantFor(player, npcId);
    assert.equal(runtime.startTranscript(api, player, npcId, choice.page, choice.variant), true);
  };
  const reset = () => { p.manager.reset(); p.prompt = null; };

  withConditions(hooks, () => {
    play(p, RANTZ);
    continueToMenu(p);
    choose(p, 'Yes.');
    assert.equal(quest.getStage(p), 5, 'start');
    reset();

    p.items.set(I.OGRE_ARROW, 6);
    hooks.onItemOnNpc[0]({ player: p, npcId: RANTZ, itemId: I.OGRE_ARROW, handled: false });
    continueUntil(p, () => quest.getStage(p) === 10);
    assert.equal(p.items.get(I.OGRE_ARROW), 0, 'six arrows handed in');
    reset();

    play(p, RANTZ);
    continueToMenu(p);
    choose(p, 'How do we make the chompys come?');
    assert.equal(quest.getStage(p), 15, 'asking the key question advances to the cave leg');
    reset();

    const enter = { player: p, objectId: O.CAVE_ENTRANCE_18, clickType: 1, option: 'Enter', handled: false };
    hooks.onObjectInteraction[0](enter);
    assert.equal(enter.handled, true);
    assert.deepEqual(p.moves.at(-1), [2635, 9397, 0], 'entered Rantz cave on a walkable mouth tile');

    const chest = { player: p, objectId: O.LOCKED_OGRE_CHEST, clickType: 1, option: 'Unlock', handled: false };
    hooks.onObjectInteraction[0](chest);
    assert.equal(chest.handled, true);
    assert.equal(p.items.get(I.OGRE_BELLOWS), 1, 'took empty bellows');
    assert.equal(quest.getStage(p), 20);

    const fill = { player: p, objectId: O.SWAMP_BUBBLES, itemId: I.OGRE_BELLOWS, handled: false };
    hooks.onItemOnObject[0](fill);
    assert.equal(fill.handled, true);
    assert.equal(p.items.get(I.OGRE_BELLOWS_3_), 1, 'bellows filled');

    const inflate = () => {
      const event = { player: p, npcId: core.NpcIdentifiers.SWAMP_TOAD, clickType: 1,
        npc: { getId: () => core.NpcIdentifiers.SWAMP_TOAD }, definition: { getActions: () => ['Inflate'] }, handled: false };
      hooks.onNpcInteraction[0](event);
      assert.equal(event.handled, true);
    };
    inflate();
    inflate();
    assert.equal(p.items.get(I.BLOATED_TOAD), 2, 'two bloated toads');
    assert.equal(p.items.get(I.OGRE_BELLOWS_1_), 1, 'bellows consumed two charges');

    play(p, RANTZ);
    continueUntil(p, () => quest.getStage(p) === 25);
    assert.equal(quest.getStage(p), 25, 'showing the toad tells you where to place it');
    reset();

    hooks.onItemAction[0]({ player: p, itemId: I.BLOATED_TOAD, option: 'Release', handled: false });
    assert.equal(quest.getStage(p), 30, 'first toad places the bait and waits for a chompy');
    assert.equal(p.items.get(I.BLOATED_TOAD), 1);
    const firstChompy = spawned.at(-1);
    assert.equal(firstChompy.id, core.NpcIdentifiers.CHOMPY_BIRD, 'the first chompy arrives');
    assert.ok(p.camera.some(entry => entry[0] === 'move'), 'the scene pans to the clearing');
    tickTasks(h, 5);
    assert.equal(quest.getStage(p), 35, 'Rantz takes his shot');
    assert.ok(h.sceneChat.includes("Hey, dere's da chompy, I's gonna shoot it."));
    tickTasks(h, 2);
    assert.ok(removed.includes(firstChompy), 'the missed chompy leaves');
    tickTasks(h, 3);
    assert.equal(quest.getStage(p), 40, 'the missed shot leads to the bow conversation');
    assert.ok(h.sceneChat.includes("Grrr...de'ese arrows are rubbish."));

    play(p, RANTZ);
    continueToMenu(p);
    choose(p, 'Come on, let me have a go...');
    continueToMenu(p);
    choose(p, "I'm actually quite strong... please let me try.");
    continueUntil(p, () => quest.getStage(p) === 45);
    assert.equal(p.items.get(I.OGRE_BOW), 1, 'Rantz hands over the ogre bow');
    reset();

    hooks.onItemAction[0]({ player: p, itemId: I.BLOATED_TOAD, option: 'Release', handled: false });
    assert.equal(spawned.at(-1).id, core.NpcIdentifiers.CHOMPY_BIRD, 'second toad attracts a chompy');
    assert.equal(p.items.get(I.BLOATED_TOAD), 0);

    const chompy = spawned.at(-1);
    const denied = { attacker: p, target: chompy, allow: null };
    hooks.onCanAttack[0](denied);
    assert.equal(denied.allow, false, 'a chompy cannot be hit without the bow and arrows');
    p.equipped.set(core.Equipment.WEAPON_SLOT, { getId: () => I.OGRE_BOW });
    p.equipped.set(core.Equipment.AMMUNITION_SLOT, { getId: () => I.OGRE_ARROW });
    const allowed = { attacker: p, target: chompy, allow: null };
    hooks.onCanAttack[0](allowed);
    assert.notEqual(allowed.allow, false, 'bow and ogre arrows allow the attack');

    hooks.onNpcDeath[0]({ killer: p, npcId: core.NpcIdentifiers.CHOMPY_BIRD, npc: chompy,
      location: { x: 2635, y: 2966, z: 0 } });
    assert.equal(quest.getStage(p), 50, 'killing the chompy advances the hunt');
    const dead = spawned.at(-1);
    assert.equal(dead.id, core.NpcIdentifiers.CHOMPY_BIRD_2, 'a pluckable carcass remains');

    const pluck = { player: p, npcId: core.NpcIdentifiers.CHOMPY_BIRD_2, clickType: 4, npc: dead,
      definition: { getActions: () => [null, null, null, 'Pluck', null] }, handled: false };
    hooks.onNpcInteraction[0](pluck);
    assert.equal(pluck.handled, true);
    assert.equal(p.items.get(I.RAW_CHOMPY), 1);
    assert.ok(removed.includes(dead));

    play(p, RANTZ);
    continueUntil(p, () => quest.getStage(p) === 55);
    assert.equal(quest.getStage(p), 55, 'Rantz explains cooking and asks for his ingredient');
    reset();

    play(p, core.NpcIdentifiers.BUGS);
    advanceUntil(p, () => Boolean(p.getAttribute('big-chompy-bird-hunting:bugs-ingredient')));
    const bugsIngredient = p.getAttribute('big-chompy-bird-hunting:bugs-ingredient');
    assert.ok([I.EQUA_LEAVES, I.CABBAGE].includes(bugsIngredient), 'Bugs names equa leaves or cabbage');
    reset();

    play(p, core.NpcIdentifiers.FYCIE);
    advanceUntil(p, () => Boolean(p.getAttribute('big-chompy-bird-hunting:fycie-ingredient')));
    const fycieIngredient = p.getAttribute('big-chompy-bird-hunting:fycie-ingredient');
    assert.ok([I.TOMATO, I.DOOGLE_LEAVES].includes(fycieIngredient), 'Fycie names tomato or doogle leaves');
    reset();

    const rantzIngredient = p.getAttribute('big-chompy-bird-hunting:rantz-ingredient');
    for (const id of [rantzIngredient, bugsIngredient, fycieIngredient]) {
      p.items.set(id, (p.items.get(id) ?? 0) + 1);
    }
    const cook = { player: p, objectId: 6895, itemId: I.RAW_CHOMPY,
      location: { x: 2630, y: 2990, z: 0 }, handled: false };
    hooks.onItemOnObject[0](cook);
    assert.equal(cook.handled, true);
    assert.equal(quest.getStage(p), 60);
    assert.equal(p.items.get(I.RAW_CHOMPY), 0);
    assert.equal(p.items.get(I.SEASONED_CHOMPY), 1);
    for (const id of [rantzIngredient, bugsIngredient, fycieIngredient]) assert.equal(p.items.get(id), 0);

    play(p, RANTZ);
    continueUntil(p, () => quest.getStage(p) === 65);
    assert.equal(quest.isComplete(p), true);
    assert.equal(p.items.get(I.SEASONED_CHOMPY), 0, 'seasoned chompy handed over');
    assert.equal(p.items.get(I.OGRE_BOW), 1, 'the bow is not duplicated at completion');
    assert.equal(p.getAttribute('quest.points'), 2);
    assert.deepEqual(p.xp, [[core.Skill.FLETCHING.getIndex(), 262], [core.Skill.COOKING.getIndex(), 1470],
      [core.Skill.RANGED.getIndex(), 735]]);

    const xpBefore = p.xp.length;
    (hooks['npc-dialogue:action'] ?? []).forEach(fn => fn({ player: p, npcId: RANTZ, stepId: 'cmDp4e', handled: false }));
    assert.equal(quest.getStage(p), 65, 'repeat completion action is a no-op');
    assert.equal(p.items.get(I.OGRE_BOW), 1);
    assert.equal(p.xp.length, xpBefore);

    hooks.onPlayerLogin[0]({ player: p, username: 'QH q006' });
    assert.equal(quest.getStage(p), 65, 'stage survives the login refresh hook');
  });
});

test('lost ogre bow is reclaimable for coins, and never granted without them', () => {
  const I = core.ItemIdentifiers;
  const variantFor = (h, player) => {
    const choice = h.hooks.onNpcDialogueVariant.map(fn => fn({ player, npcId: RANTZ })).find(Boolean);
    assert.ok(choice, 'lost-bow Rantz variant');
    return choice;
  };

  const paid = questHarness();
  const rich = dialoguePlayer([[I.COINS, 500]]);
  paid.quest.setStage(rich, 45);
  withConditions(paid.hooks, () => {
    const choice = variantFor(paid, rich);
    runtime.startTranscript(paid.api, rich, RANTZ, choice.page, choice.variant);
    continueToMenu(rich);
    choose(rich, "Yes, I'll buy the bow.");
    advanceUntil(rich, () => rich.items.get(I.OGRE_BOW) === 1);
  });
  assert.equal(rich.items.get(I.COINS) ?? 0, 0, 'reclaim costs the coins');
  assert.equal(rich.items.get(I.OGRE_BOW), 1);
  assert.equal(paid.quest.getStage(rich), 45, 'reclaim does not change quest progress');

  const poorHarness = questHarness();
  const poor = dialoguePlayer();
  poorHarness.quest.setStage(poor, 45);
  withConditions(poorHarness.hooks, () => {
    const choice = variantFor(poorHarness, poor);
    runtime.startTranscript(poorHarness.api, poor, RANTZ, choice.page, choice.variant);
    continueToMenu(poor);
    choose(poor, "Yes, I'll buy the bow.");
    advanceUntil(poor, () => !poor.manager.getCurrent());
  });
  assert.equal(poor.items.get(I.OGRE_BOW) ?? 0, 0, 'no bow without the coins');
  assert.equal(poorHarness.quest.getStage(poor), 45);
});

test('Bugs and Fycie sell the QH tool/feather supplies through their real dialogue', () => {
  const I = core.ItemIdentifiers;
  const h = questHarness();
  const p = dialoguePlayer([[I.COINS, 10]]);
  h.quest.setStage(p, 5);
  const variantFor = (npcId) => {
    const choice = h.hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId })).find(Boolean);
    assert.ok(choice);
    return choice;
  };
  withConditions(h.hooks, () => {
    const choice = variantFor(core.NpcIdentifiers.BUGS);
    runtime.startTranscript(h.api, p, core.NpcIdentifiers.BUGS, choice.page, choice.variant);
    continueToMenu(p);
    choose(p, "Ok, I'll give you 10 bright pretties.");
    advanceUntil(p, () => p.items.get(I.KNIFE) === 1 && p.items.get(I.CHISEL) === 1);
    assert.equal(p.items.get(I.COINS) ?? 0, 0);
    assert.equal(p.getAttribute('big-chompy-bird-hunting:bugs-tools-bought'), 1);
    p.manager.reset();
    assert.equal(variantFor(core.NpcIdentifiers.BUGS).variant,
      'starting-off-talking-to-bugs-without-a-chisel-and-knife-talking-to-bugs-after-buying-his-chisel-and-knife');

    const f = dialoguePlayer([[I.COINS, 50]]);
    h.quest.setStage(f, 5);
    const fycieVariant = h.hooks.onNpcDialogueVariant.map(fn => fn({ player: f, npcId: core.NpcIdentifiers.FYCIE })).find(Boolean);
    assert.ok(fycieVariant);
    runtime.startTranscript(h.api, f, core.NpcIdentifiers.FYCIE, fycieVariant.page, fycieVariant.variant);
    continueToMenu(f);
    choose(f, "Ok, I'll give you 50 bright pretties.");
    advanceUntil(f, () => f.items.get(I.FEATHER) === 25);
    assert.equal(f.items.get(I.COINS) ?? 0, 0);
    assert.equal(f.getAttribute('big-chompy-bird-hunting:fycie-feathers-bought'), 1);
  });
});

test('the start warning follows the QH Ranged/Cooking/Fletching requirement', () => {
  const { hooks } = questHarness();
  const low = dialoguePlayer([], [], {
    [core.Skill.RANGED.getIndex()]: 1,
    [core.Skill.COOKING.getIndex()]: 99,
    [core.Skill.FLETCHING.getIndex()]: 99,
  });
  const high = dialoguePlayer();
  const ask = (player) => {
    const handler = hooks.onNpcDialogueCondition[0];
    return handler({ player, npcId: RANTZ, stepId: 'THE8iv',
      text: 'If the player is missing at least one requirement:' });
  };
  assert.equal(ask(low), true, 'low Ranged triggers the warning');
  assert.equal(ask(high), false, 'meeting all three levels does not');

  const handler = hooks.onNpcDialogueCondition[0];
  const rich = dialoguePlayer([[core.ItemIdentifiers.COINS, 500]]);
  assert.equal(handler({ player: high, npcId: core.NpcIdentifiers.HARRY, stepId: 'THE8iv',
    text: 'If the player is missing at least one requirement:' }), null, 'foreign NPC is not answered');
  assert.equal(handler({ player: high, npcId: RANTZ, stepId: 'some-other-step',
    text: 'If the player is missing at least one requirement:' }), null, 'foreign step is not answered');
  assert.equal(handler({ player: high, npcId: core.NpcIdentifiers.HARRY, stepId: 'BmgmUE',
    text: "If the player doesn't have enough coins:" }), null, 'the 500-coin branch is Rantz-only');
  assert.equal(handler({ player: high, npcId: RANTZ, stepId: 'BmgmUE',
    text: "If the player doesn't have enough coins:" }), true);
  assert.equal(handler({ player: rich, npcId: RANTZ, stepId: 'BmgmUE',
    text: "If the player doesn't have enough coins:" }), false);
  assert.equal(handler({ player: rich, npcId: RANTZ, stepId: 'Zlt_Rt',
    text: 'If the player has enough coins:' }), true);
});

// Source handler-contract test: stage 40 and stage 60 are fixture starting states,
// not a claim that a natural playthrough skipped the intermediate legs.
test('bow reward contract: u_dBhh grants one bow and completion grants no second', () => {
  const I = core.ItemIdentifiers;
  const h = questHarness();
  assert.equal(h.quest.rewardItemId, undefined, 'completion must not use rewardItemId for the bow');
  assert.equal(h.quest.scrollItemId, I.OGRE_BOW, 'the completion scroll still shows the bow');
  assert.equal(h.quest.rewardItemLabel, 'An ogre bow');

  const p = dialoguePlayer();
  h.quest.setStage(p, 40);
  withConditions(h.hooks, () => {
    const choice = h.hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId: RANTZ })).find(Boolean);
    assert.ok(choice, 'stage 40 selects the failed-hunt bow dialogue');
    runtime.startTranscript(h.api, p, RANTZ, choice.page, choice.variant);
    continueToMenu(p);
    choose(p, 'Come on, let me have a go...');
    continueToMenu(p);
    choose(p, "I'm actually quite strong... please let me try.");
    continueUntil(p, () => h.quest.getStage(p) === 45);
  });
  assert.equal(p.items.get(I.OGRE_BOW), 1, 'u_dBhh is the single canonical bow acquisition');

  h.quest.setStage(p, 60);
  p.items.set(I.SEASONED_CHOMPY, 1);
  withConditions(h.hooks, () => {
    const choice = h.hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId: RANTZ })).find(Boolean);
    assert.ok(choice, 'stage 60 selects the seasoned-chompy hand-in');
    runtime.startTranscript(h.api, p, RANTZ, choice.page, choice.variant);
    continueUntil(p, () => h.quest.getStage(p) === 65);
  });
  assert.equal(p.items.get(I.OGRE_BOW), 1, 'completion does not add a second ogre bow');
  assert.equal(p.items.get(I.SEASONED_CHOMPY), 0);

  (h.hooks['npc-dialogue:action'] ?? []).forEach(fn => fn({ player: p, npcId: RANTZ, stepId: 'cmDp4e', handled: false }));
  assert.equal(p.items.get(I.OGRE_BOW), 1, 'repeat completion cannot add another bow');
  assert.equal(h.quest.getStage(p), 65);
});

// Source handler-contract test: stage 65 and a 30-kill counter are fixture state.
// It drives Rantz's real after-quest menu and condition chain, not a natural route.
test('post-quest hat trade grants one threshold hat and cooked chompy hand-in is supported', () => {
  const I = core.ItemIdentifiers;
  const h = questHarness();
  const p = dialoguePlayer([[I.OGRE_BOW, 1]]);
  h.quest.setStage(p, 65);
  p.setAttribute('big-chompy-bird-hunting:chompy-kills', 30);

  const playRantz = () => {
    const choice = h.hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId: RANTZ })).find(Boolean);
    assert.ok(choice, 'post-quest Rantz variant');
    runtime.startTranscript(h.api, p, RANTZ, choice.page, choice.variant);
  };

  withConditions(h.hooks, () => {
    playRantz();
    continueToMenu(p);
    choose(p, 'More...');
    continueToMenu(p);
    choose(p, 'Can I have a hat please?');
    advanceUntil(p, () => p.items.get(2978) === 1);
  });
  assert.equal(p.items.get(2978), 1, 'Ogre Bowman hat (30 kills) is granted');
  assert.equal(p.items.get(2979) ?? 0, 0, 'the next threshold is not granted');
  assert.equal(p.getAttribute('big-chompy-bird-hunting:chompy-kills'), 30);

  p.manager.reset();
  p.prompt = null;
  withConditions(h.hooks, () => {
    playRantz();
    continueToMenu(p);
    choose(p, 'More...');
    continueToMenu(p);
    choose(p, 'Can I have a hat please?');
    advanceUntil(p, () => !p.manager.getCurrent());
  });
  assert.equal(p.items.get(2978), 1, 'already-claimed hat is not duplicated');

  p.manager.reset();
  p.prompt = null;
  p.items.set(I.COOKED_CHOMPY, 1);
  const handIn = { player: p, npcId: RANTZ, itemId: I.COOKED_CHOMPY, handled: false };
  h.hooks.onItemOnNpc[0](handIn);
  assert.equal(handIn.handled, true, 'cooked chompy on Rantz is claimed');
  assert.equal(p.items.get(I.COOKED_CHOMPY), 0, 'the cooked chompy is handed over');

  p.items.set(I.BLOATED_TOAD, 1);
  h.hooks.onItemAction[0]({ player: p, itemId: I.BLOATED_TOAD, option: 'Release', handled: false });
  const postQuestChompy = h.spawned.at(-1);
  assert.equal(postQuestChompy.id, core.NpcIdentifiers.CHOMPY_BIRD, 'post-quest toad still attracts a chompy');
  assert.equal(p.items.get(I.BLOATED_TOAD), 0);
  h.hooks.onNpcDeath[0]({ killer: p, npcId: core.NpcIdentifiers.CHOMPY_BIRD, npc: postQuestChompy,
    location: { x: 2635, y: 2966, z: 0 } });
  assert.equal(p.getAttribute('big-chompy-bird-hunting:chompy-kills'), 31, 'post-quest kill increments the hat counter');
  assert.equal(h.spawned.at(-1).id, core.NpcIdentifiers.CHOMPY_BIRD_2, 'post-quest carcass remains pluckable');
});

function playBowDialogue(h, p) {
  const choice = h.hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId: RANTZ })).find(Boolean);
  assert.ok(choice, 'bow dialogue variant');
  runtime.startTranscript(h.api, p, RANTZ, choice.page, choice.variant);
  continueToMenu(p);
  choose(p, 'Come on, let me have a go...');
  continueToMenu(p);
  choose(p, "I'm actually quite strong... please let me try.");
}

// Source handler-contract tests: fixture stages/items exercise full-bag guards.
test('full inventory cannot lose the bow, reclaim coins, a toad charge or a carcass', () => {
  const I = core.ItemIdentifiers;

  const bowHarness = questHarness();
  const bow = dialoguePlayer();
  bowHarness.quest.setStage(bow, 40);
  bow.inventoryFull = true;
  withConditions(bowHarness.hooks, () => {
    playBowDialogue(bowHarness, bow);
    advanceUntil(bow, () => bow.messages.some(text => text.includes('empty inventory slot for the ogre bow')));
  });
  assert.equal(bowHarness.quest.getStage(bow), 40, 'full bag does not advance past the bow step');
  assert.equal(bow.items.get(I.OGRE_BOW) ?? 0, 0);
  bow.inventoryFull = false;
  bow.manager.reset();
  withConditions(bowHarness.hooks, () => {
    playBowDialogue(bowHarness, bow);
    continueUntil(bow, () => bowHarness.quest.getStage(bow) === 45);
  });
  assert.equal(bow.items.get(I.OGRE_BOW), 1);

  const reclaimHarness = questHarness();
  const reclaim = dialoguePlayer([[I.COINS, 500]]);
  reclaimHarness.quest.setStage(reclaim, 45);
  reclaim.inventoryFull = true;
  const playReclaim = () => {
    const choice = reclaimHarness.hooks.onNpcDialogueVariant.map(fn => fn({ player: reclaim, npcId: RANTZ })).find(Boolean);
    assert.ok(choice);
    runtime.startTranscript(reclaimHarness.api, reclaim, RANTZ, choice.page, choice.variant);
    continueToMenu(reclaim);
    choose(reclaim, "Yes, I'll buy the bow.");
  };
  withConditions(reclaimHarness.hooks, () => {
    playReclaim();
    advanceUntil(reclaim, () => reclaim.messages.some(text => text.includes('empty inventory slot for the ogre bow')));
  });
  assert.equal(reclaim.items.get(I.COINS), 500, 'coins are not charged when the bow cannot fit');
  assert.equal(reclaim.items.get(I.OGRE_BOW) ?? 0, 0);
  reclaim.inventoryFull = false;
  reclaim.manager.reset();
  withConditions(reclaimHarness.hooks, () => {
    playReclaim();
    advanceUntil(reclaim, () => reclaim.items.get(I.OGRE_BOW) === 1);
  });
  assert.equal(reclaim.items.get(I.COINS) ?? 0, 0);

  const toadHarness = questHarness();
  const toad = dialoguePlayer([[I.OGRE_BELLOWS_3_, 1]]);
  toadHarness.quest.setStage(toad, 20);
  toad.inventoryFull = true;
  const inflate = (npc) => {
    const event = { player: toad, npcId: core.NpcIdentifiers.SWAMP_TOAD, clickType: 1, npc,
      definition: { getActions: () => ['Inflate'] }, handled: false };
    toadHarness.hooks.onNpcInteraction[0](event);
    return event;
  };
  const firstToad = { getId: () => core.NpcIdentifiers.SWAMP_TOAD };
  const blocked = inflate(firstToad);
  assert.equal(blocked.handled, true);
  assert.equal(toad.items.get(I.OGRE_BELLOWS_3_), 1, 'charge is retained on a full bag');
  assert.equal(toad.items.get(I.BLOATED_TOAD) ?? 0, 0);
  assert.ok(!toadHarness.removed.includes(firstToad), 'the toad stays in the world');
  toad.inventoryFull = false;
  const secondToad = { getId: () => core.NpcIdentifiers.SWAMP_TOAD };
  const allowed = inflate(secondToad);
  assert.equal(allowed.handled, true);
  assert.equal(toad.items.get(I.OGRE_BELLOWS_2_), 1);
  assert.equal(toad.items.get(I.BLOATED_TOAD), 1);
  assert.ok(toadHarness.removed.includes(secondToad));

  const pluckHarness = questHarness();
  const pluck = dialoguePlayer();
  pluckHarness.quest.setStage(pluck, 50);
  pluck.inventoryFull = true;
  const pluckAt = (npc) => {
    const event = { player: pluck, npcId: core.NpcIdentifiers.CHOMPY_BIRD_2, clickType: 4, npc,
      definition: { getActions: () => [null, null, null, 'Pluck', null] }, handled: false };
    pluckHarness.hooks.onNpcInteraction[0](event);
    return event;
  };
  const firstCarcass = { getId: () => core.NpcIdentifiers.CHOMPY_BIRD_2 };
  const blockedPluck = pluckAt(firstCarcass);
  assert.equal(blockedPluck.handled, true);
  assert.equal(pluck.items.get(I.RAW_CHOMPY) ?? 0, 0);
  assert.ok(!pluckHarness.removed.includes(firstCarcass), 'carcass remains when the raw chompy cannot fit');
  pluck.inventoryFull = false;
  const secondCarcass = { getId: () => core.NpcIdentifiers.CHOMPY_BIRD_2 };
  pluckAt(secondCarcass);
  assert.equal(pluck.items.get(I.RAW_CHOMPY), 1);
  assert.ok(pluckHarness.removed.includes(secondCarcass));
});

test('replacement removes the prior chompy and raw/seasoned loss can be recovered', () => {
  const I = core.ItemIdentifiers;
  const h = questHarness();
  const p = dialoguePlayer([[I.BLOATED_TOAD, 2]]);
  h.quest.setStage(p, 45);
  h.hooks.onItemAction[0]({ player: p, itemId: I.BLOATED_TOAD, option: 'Release', handled: false });
  const first = h.spawned.at(-1);
  h.hooks.onItemAction[0]({ player: p, itemId: I.BLOATED_TOAD, option: 'Release', handled: false });
  assert.ok(h.removed.includes(first), 'the previous quest chompy is removed on replacement');
  assert.notEqual(h.spawned.at(-1), first);

  const rawHarness = questHarness();
  const raw = dialoguePlayer([[I.BLOATED_TOAD, 1]]);
  rawHarness.quest.setStage(raw, 50);
  rawHarness.hooks.onItemAction[0]({ player: raw, itemId: I.BLOATED_TOAD, option: 'Release', handled: false });
  assert.equal(rawHarness.quest.getStage(raw), 50, 'raw loss can re-bait at stage 50');
  const recoveryChompy = rawHarness.spawned.at(-1);
  assert.equal(recoveryChompy.id, core.NpcIdentifiers.CHOMPY_BIRD);
  rawHarness.hooks.onNpcDeath[0]({ killer: raw, npcId: core.NpcIdentifiers.CHOMPY_BIRD, npc: recoveryChompy,
    location: { x: 2635, y: 2966, z: 0 } });
  const recoveryCarcass = rawHarness.spawned.at(-1);
  assert.equal(recoveryCarcass.id, core.NpcIdentifiers.CHOMPY_BIRD_2);
  const pluck = { player: raw, npcId: core.NpcIdentifiers.CHOMPY_BIRD_2, clickType: 4, npc: recoveryCarcass,
    definition: { getActions: () => [null, null, null, 'Pluck', null] }, handled: false };
  rawHarness.hooks.onNpcInteraction[0](pluck);
  assert.equal(raw.items.get(I.RAW_CHOMPY), 1, 'raw chompy is recovered');

  const cookHarness = questHarness();
  const cook = dialoguePlayer([[I.RAW_CHOMPY, 1], [I.ONION, 1], [I.EQUA_LEAVES, 1], [I.TOMATO, 1]]);
  cookHarness.quest.setStage(cook, 60);
  cook.setAttribute('big-chompy-bird-hunting:rantz-ingredient', I.ONION);
  cook.setAttribute('big-chompy-bird-hunting:bugs-ingredient', I.EQUA_LEAVES);
  cook.setAttribute('big-chompy-bird-hunting:fycie-ingredient', I.TOMATO);
  const cookEvent = { player: cook, objectId: 6895, itemId: I.RAW_CHOMPY,
    location: { x: 2630, y: 2990, z: 0 }, handled: false };
  cookHarness.hooks.onItemOnObject[0](cookEvent);
  assert.equal(cookEvent.handled, true);
  assert.equal(cook.items.get(I.SEASONED_CHOMPY), 1, 'a lost seasoned chompy can be re-cooked');
  assert.equal(cookHarness.quest.getStage(cook), 60);
});

test('swamp bubbles only accept an actual bellows item', () => {
  const I = core.ItemIdentifiers;
  const h = questHarness();
  const p = dialoguePlayer([[I.OGRE_BELLOWS, 1], [I.RAW_CHOMPY, 1]]);
  h.quest.setStage(p, 15);
  const foreign = { player: p, objectId: core.ObjectIdentifiers.SWAMP_BUBBLES, itemId: I.RAW_CHOMPY, handled: false };
  h.hooks.onItemOnObject[0](foreign);
  assert.equal(foreign.handled, false, 'a non-bellows item is not claimed');
  assert.equal(p.items.get(I.OGRE_BELLOWS), 1);
  assert.equal(p.items.get(I.OGRE_BELLOWS_3_) ?? 0, 0);
  const bellows = { player: p, objectId: core.ObjectIdentifiers.SWAMP_BUBBLES, itemId: I.OGRE_BELLOWS, handled: false };
  h.hooks.onItemOnObject[0](bellows);
  assert.equal(bellows.handled, true);
  assert.equal(p.items.get(I.OGRE_BELLOWS_3_), 1);
});

function releaseToad(h, p) {
  h.hooks.onItemAction[0]({ player: p, itemId: core.ItemIdentifiers.BLOATED_TOAD,
    option: 'Release', handled: false });
}

// Source handler-contract test: fixture stage/items, real timer/task interleavings.
test('first-hunt timers are identity-bound, cancellable and cannot write after logout', () => {
  const I = core.ItemIdentifiers;
  const success = questHarness();
  const settled = dialoguePlayer([[I.BLOATED_TOAD, 1]]);
  success.quest.setStage(settled, 25);
  releaseToad(success, settled);
  tickTasks(success, 5);
  assert.equal(success.quest.getStage(settled), 35);
  tickTasks(success, 2);
  tickTasks(success, 3);
  assert.equal(success.quest.getStage(settled), 40, 'logged-in settlement reaches stage 40');

  const logout = questHarness();
  const gone = dialoguePlayer([[I.BLOATED_TOAD, 1]]);
  logout.quest.setStage(gone, 25);
  releaseToad(logout, gone);
  tickTasks(logout, 5);
  tickTasks(logout, 2);
  assert.equal(logout.quest.getStage(gone), 35);
  logout.hooks.onPlayerLogout[0]({ player: gone });
  gone.isRegistered = () => false;
  tickTasks(logout, 10);
  assert.equal(logout.quest.getStage(gone), 35, 'logout cancels the settle before it writes');
  assert.ok(logout.tasks.every(task => !task.isRunning()), 'no first-hunt timer remains running');

  const detached = questHarness();
  const unregistered = dialoguePlayer([[I.BLOATED_TOAD, 1]]);
  detached.quest.setStage(unregistered, 25);
  releaseToad(detached, unregistered);
  tickTasks(detached, 5);
  tickTasks(detached, 2);
  unregistered.isRegistered = () => false;
  tickTasks(detached, 5);
  assert.equal(detached.quest.getStage(unregistered), 35, 'detached player is not advanced');

  const replaced = questHarness();
  const again = dialoguePlayer([[I.BLOATED_TOAD, 2]]);
  replaced.quest.setStage(again, 25);
  releaseToad(replaced, again);
  tickTasks(replaced, 5);
  tickTasks(replaced, 2);
  releaseToad(replaced, again);
  assert.equal(replaced.quest.getStage(again), 30, 'replacement restarts the hunt');
  tickTasks(replaced, 3);
  assert.equal(replaced.quest.getStage(again), 30, 'old settle cannot fire after replacement');
  tickTasks(replaced, 5);
  tickTasks(replaced, 2);
  tickTasks(replaced, 3);
  assert.equal(replaced.quest.getStage(again), 40, 'replacement hunt settles normally');
});

// Source handler-contract test: real PluginManager canAttack hook + CombatFactory policy.
test('canAttack policy only gates the tracked chompy, not other owner-only quest NPCs', () => {
  const { CombatFactory, CanAttackResponse } = require(root + '/dist/game/content/combat/CombatFactory');
  const { World } = require(root + '/dist/game/World');
  const I = core.ItemIdentifiers;
  if (!global.__q006RealCanAttack) {
    require(root + '/plugins/quests/quests/BigChompyBirdHunting.Quest')(
      PluginManager.createApi('BigChompyQ006Policy'));
    // Real registrations for the two owner-only quest policy owners. Neither adds a
    // canAttack hook; this proves Big Chompy no longer denies their NPCs globally.
    require(root + '/plugins/quests/quests/CorsairCurse.Quest')(
      PluginManager.createApi('CorsairCurseQ006Policy'));
    require(root + '/plugins/quests/quests/AscentOfArceuus.Quest')(
      PluginManager.createApi('AscentQ006Policy'));
    global.__q006RealCanAttack = true;
  }
  const quest = runtime.getRegisteredQuests().findLast(entry => entry.key === 'big_chompy_bird_hunting');
  const p = player([[I.BLOATED_TOAD, 1]]);
  quest.setStage(p, 45);
  assert.equal(PluginManager.emitItemAction({
    player: p, item: new core.Item(I.BLOATED_TOAD, 1), itemId: I.BLOATED_TOAD,
    slot: 0, clickType: 1, option: 'Release', handled: false,
  }), true);
  const chompy = [...World.getNpcs()].find(npc => npc.getId?.() === core.NpcIdentifiers.CHOMPY_BIRD
    && npc.getOwner?.() === p);
  assert.ok(chompy, 'real handler spawned the tracked chompy');

  const ithoi = { getId: () => 7964, getOwner: () => p, getLocation: () => new core.Location(2529, 2839, 1),
    getArea: () => null, getPrivateArea: () => null, isPlayer: () => false };
  const tormentedSoul = { getId: () => core.NpcIdentifiers.TORMENTED_SOUL, getOwner: () => p,
    getLocation: () => new core.Location(0, 0, 0), getArea: () => null, getPrivateArea: () => null,
    isPlayer: () => false };

  p.equipped.set(core.Equipment.WEAPON_SLOT, { getId: () => 1 });
  p.equipped.delete(core.Equipment.AMMUNITION_SLOT);
  assert.equal(CombatFactory.canAttackByPolicy(p, chompy), CanAttackResponse.CANT_ATTACK_IN_AREA,
    'tracked chompy still needs the ogre bow and arrows');
  assert.equal(CombatFactory.canAttackByPolicy(p, ithoi), CanAttackResponse.CAN_ATTACK,
    'Corsair Curse Ithoi remains attackable with a normal weapon');
  assert.equal(CombatFactory.canAttackByPolicy(p, tormentedSoul), CanAttackResponse.CAN_ATTACK,
    'Ascent owner Tormented Soul remains attackable with a normal weapon');

  p.equipped.set(core.Equipment.WEAPON_SLOT, { getId: () => I.OGRE_BOW });
  p.equipped.set(core.Equipment.AMMUNITION_SLOT, { getId: () => I.OGRE_ARROW });
  assert.equal(CombatFactory.canAttackByPolicy(p, chompy), CanAttackResponse.CAN_ATTACK,
    'tracked chompy is attackable with the canonical bow and arrows');
});
