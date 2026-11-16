// Jungle Potion (q063) source-contract checks.
// From server/: node --test tests/qh728-q063.test.cjs
//
// Fixture starts are labelled per test. Each test dispatches the plugin's real
// registered object/item/dialogue handlers. Fixtures set only a starting stage,
// prerequisites and ordinary inventory; they never set the expected effect.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;

const TRUFITUS = N.TRUFITUS;
const VARP_STAGE = 175;
const START_HOOK = 'quest:jungle-potion:start';
const COMPLETE_ACTION = 'WiofTb';
const ENTER_CAVE_MESSAGE = 'LP0T9g';
// Live starts the quest as the player continues past this acceptance line (rsprox captures, JunglePotion ticks 158-160).
const ACCEPT_LINE = "It sounds like just the challenge for me. And it would make a nice break from killing things!";

const HERBS = [
  {
    name: 'Snake weed',
    grimy: I.GRIMY_SNAKE_WEED, clean: I.SNAKE_WEED, locId: O.MARSHY_JUNGLE_VINE,
    search: 'You search the vine...',
    talk: 'snake-weed-talking-to-trufitus',
    handIn: 'Z2U1Sk', requested: 1, found: 2, next: 3,
  },
  {
    name: 'Ardrigal',
    grimy: I.GRIMY_ARDRIGAL, clean: I.ARDRIGAL, locId: O.PALM_TREE_2,
    search: 'You search the palm...',
    talk: 'ardrigal-talking-to-trufitus',
    handIn: '1TUBY2', requested: 3, found: 4, next: 5,
  },
  {
    name: 'Sito foil',
    grimy: I.GRIMY_SITO_FOIL, clean: I.SITO_FOIL, locId: O.SCORCHED_EARTH,
    search: 'You search the scorched earth...',
    talk: 'sito-foil-talking-to-trufitus',
    handIn: '4Qi9K-', requested: 5, found: 6, next: 7,
  },
  {
    name: 'Volencia moss',
    grimy: I.GRIMY_VOLENCIA_MOSS, clean: I.VOLENCIA_MOSS, locId: O.ROCK_3,
    search: 'You search the rock...',
    talk: 'volencia-moss-talking-to-trufitus',
    handIn: 'l4gnZZ', requested: 7, found: 8, next: 9,
  },
  {
    name: "Rogue's purse",
    grimy: I.GRIMY_ROGUES_PURSE, clean: I.ROGUES_PURSE, locId: O.FUNGUS_COVERED_CAVERN_WALL,
    search: 'You search the wall...',
    talk: 'rogue-s-purse-talking-to-trufitus',
    handIn: '3UOzJ-', requested: 9, found: 10, next: 11,
  },
];

const TRANSCRIPTS = [];
const originalStartTranscript = runtime.startTranscript;
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  TRANSCRIPTS.push({ npcId, page, variant });
  return true;
};
after(() => { runtime.startTranscript = originalStartTranscript; });

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  ObjectDefinition.init();
});

function harness() {
  const questCore = { ...core, CountdownTask: undefined, TaskManager: undefined };
  const custom = new Map();
  const objects = [];
  const conditions = [];
  const variants = [];
  const itemActions = [];
  const logins = [];

  const actions = (name) => custom.get(name) ?? [];
  const tasks = [];
  const api = new Proxy({
    core: questCore,
    getTaskManager: () => ({ submit(task) { task.setRunning(true); tasks.push(task); } }),
    persistAttribute() {},
    onNpcDialogueCondition(handler) { conditions.push(handler); },
    onNpcDialogueVariant(handler) { variants.push(handler); },
    onObjectInteraction(handler) { objects.push(handler); },
    onItemAction(handler) { itemActions.push(handler); },
    onPlayerLogin(handler) { logins.push(handler); },
    onCustomEvent(name, handler) {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      // Druidic Ritual is the start requirement.
      if (name === 'quest:is-complete' && event.key === 'druidic_ritual') event.complete = true;
      for (const handler of actions(name)) handler(event);
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  logins.push(runtime.sendQuestVarps);
  require('../plugins/quests/quests/JunglePotion.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'jungle_potion');

  const attributes = new Map();
  const amounts = new Map();
  const slots = [];
  const messages = [];
  const moves = [];
  const varbits = new Map();
  const configs = new Map();
  const xp = [];
  let full = false;
  let location = new core.Location(0, 0, 0);

  function addItem(id, amount = 1) {
    amounts.set(id, (amounts.get(id) ?? 0) + amount);
    if (!slots.includes(id)) slots.push(id);
  }
  function removeItem(id, amount = 1) {
    const left = Math.max(0, (amounts.get(id) ?? 0) - amount);
    if (left === 0) {
      amounts.delete(id);
      const index = slots.indexOf(id);
      if (index >= 0) slots.splice(index, 1);
    } else {
      amounts.set(id, left);
    }
  }

  const spam = [];
  const boxes = [];
  const sender = new Proxy({
    sendTypedMessage(_type, message) { spam.push(message); return sender; },
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { configs.set(id, value); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  const inventory = {
    getAmount: (id) => amounts.get(id) ?? 0,
    adds(id, amount = 1) {
      if (full) return false;
      addItem(id, amount);
      return true;
    },
    forceAdd(_player, item) { addItem(item.getId(), item.getAmount()); },
    deleteNumber(id, amount = 1) { removeItem(id, amount); return true; },
    deleteAtSlot(slot, amount = 1) { const id = slots[slot]; if (id !== undefined) removeItem(id, amount); return true; },
    // Cleaning swaps the herb in its own slot (Inventory.setItem, as the Herblore plugin does).
    setItem(slot, item) { const id = slots[slot]; if (id !== undefined) removeItem(id, 1); addItem(item.getId(), item.getAmount()); return inventory; },
    refreshItems() { return inventory; },
    isFull: () => full,
    getFreeSlots: () => (full ? 0 : 28),
    getItems: () => slots.map((id) => ({ getId: () => id, getAmount: () => amounts.get(id) ?? 0 })),
  };

  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues(chain) { boxes.push(chain); }, reset() {}, handleResume() {} }),
    performAnimation() {},
    getMovementQueue: () => ({ size: () => 0 }),
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: () => 99,
      addExperiences: (skill, amount) => { xp.push([skill.index ?? skill, amount]); },
      addExperience: (skill, amount) => { xp.push([skill.index ?? skill, amount]); return true; },
    }),
    getLocation: () => location,
    getUsername: () => 'qh728-q063',
    getPrivateArea: () => null,
    sendMessage: (message) => messages.push(message),
    moveTo: (next) => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    isRegistered: () => true,
  };

  return {
    spam, boxes,
    /** Run the submitted tasks for `ticks` ticks, as TaskManager does (Task.tick). */
    tick(ticks = 1) {
      for (let i = 0; i < ticks; i++) {
        for (const task of [...tasks]) if (task.isRunning()) task.tick();
      }
    },
    quest, player, attributes, amounts, messages, moves, varbits, configs, xp,
    give: addItem,
    has: (id) => (amounts.get(id) ?? 0) > 0,
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    hook(hook, npcId = TRUFITUS) {
      const event = { player, npcId, hook };
      for (const handler of actions('npc-dialogue:hook')) handler(event);
      return event;
    },
    answer(text, npcId = TRUFITUS) {
      for (const handler of conditions) {
        const value = handler({ player, npcId, text });
        if (value !== null && value !== undefined) return value;
      }
      return null;
    },
    variant(npcId = TRUFITUS) {
      for (const handler of variants) {
        const value = handler({ player, npcId });
        if (value) return value;
      }
      return null;
    },
    handIn(stepId, npcId = TRUFITUS) {
      const event = { player, npcId, stepId, handled: false };
      for (const handler of actions('npc-dialogue:condition')) handler(event);
      return event;
    },
    action(stepId, npcId = TRUFITUS) {
      const event = { player, npcId, stepId, handled: false };
      for (const handler of actions('npc-dialogue:action')) handler(event);
      return event;
    },
    /** A message step as the dialogue runtime emits it; `after` runs as its box is continued. */
    message(stepId, text = '', npcId = TRUFITUS) {
      const event = { player, npcId, stepId, text, kind: 'message', handled: false };
      for (const handler of actions('npc-dialogue:action')) handler(event);
      event.after?.();
      return event;
    },
    /** A speech line as the dialogue runtime emits it; `after` runs as it is continued. */
    line(text, npcId = TRUFITUS) {
      const event = { player, npcId, text, skip: false };
      for (const handler of actions('npc-dialogue:line')) handler(event);
      event.after?.();
      return event;
    },
    /** Continue the last chain started (a message box), running its actions. */
    continueBox() {
      for (const entry of boxes.at(-1).getDialogues().values()) if (entry instanceof core.ActionDialogue) entry.send(player);
    },
    objectSearch(objectId) {
      const event = {
        player, objectId, clickType: 2, handled: false,
        location: new core.Location(0, 0, 0),
        definition: { getInteractions: () => [null, 'Search'] },
      };
      for (const handler of objects) handler(event);
      return event;
    },
    objectClimb(objectId) {
      const event = {
        player, objectId, clickType: 1, handled: false,
        location: new core.Location(0, 0, 0),
        definition: { getInteractions: () => ['Climb'] },
      };
      for (const handler of objects) handler(event);
      return event;
    },
    clean(itemId, slot, option = 'Clean') {
      const event = { player, itemId, slot, option, handled: false };
      for (const handler of itemActions) handler(event);
      return event;
    },
    login() { for (const handler of logins) handler({ player }); },
  };
}

test('cache object ids used by the route are the searchable herb and cave objects', () => {
  assert.equal(O.MARSHY_JUNGLE_VINE, 2575);
  assert.equal(O.PALM_TREE_2, 2577);
  assert.equal(O.SCORCHED_EARTH, 2579);
  assert.equal(O.ROCK_3, 2581);
  assert.equal(O.FUNGUS_COVERED_CAVERN_WALL, 2583);
  assert.equal(O.ROCKS_4, 2584);
  assert.equal(O.HAND_HOLDS, 2585);
  assert.equal(N.TRUFITUS, 4625);

  for (const objectId of [O.MARSHY_JUNGLE_VINE, O.PALM_TREE_2, O.SCORCHED_EARTH, O.ROCK_3, O.FUNGUS_COVERED_CAVERN_WALL, O.ROCKS_4]) {
    assert.ok(ObjectDefinition.forId(objectId).getInteractions().includes('Search'), `${objectId} is searchable`);
  }
  assert.ok(ObjectDefinition.forId(O.HAND_HOLDS).getInteractions().includes('Climb'));
  for (const herb of HERBS) {
    assert.ok(Number.isInteger(herb.grimy) && Number.isInteger(herb.clean), `${herb.name} item ids`);
  }
});

test('fresh stage 0 starts at stage 1; searching before the request yields nothing', () => {
  const h = harness();
  h.objectSearch(O.MARSHY_JUNGLE_VINE);
  assert.equal(h.quest.getStage(h.player), 0);
  assert.equal(h.has(I.GRIMY_SNAKE_WEED), false);
  assert.match(h.messages.at(-1), /nothing of interest/i);

  h.hook(START_HOOK);
  assert.equal(h.quest.getStage(h.player), 0, '"Yes." alone does not start it');
  h.line(ACCEPT_LINE);
  assert.equal(h.quest.getStage(h.player), 1);
  assert.equal(h.configs.get(VARP_STAGE), 1);
  assert.match(h.messages.at(-1), /^You've started a new quest: /);
});

test('mandatory route: search, clean and hand in all five herbs, enter and leave the cave, then complete', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const h = harness();
  h.hook(START_HOOK);
  h.line(ACCEPT_LINE);
  assert.equal(h.quest.getStage(h.player), 1);

  for (const [index, herb] of HERBS.entries()) {
    if (index === HERBS.length - 1) {
      const entrance = h.objectSearch(O.ROCKS_4);
      assert.equal(entrance.handled, true);
      assert.equal(TRANSCRIPTS.at(-1).variant, 'rogue-s-purse-search-rocks');
      const enter = h.message(ENTER_CAVE_MESSAGE);
      assert.deepEqual(enter.box, { statement: true }, 'the cave message is a message box');
      assert.deepEqual(h.moves.at(-1), [2830, 9520, 0], 'continuing the cave message moves the player inside');
    }

    const search = h.objectSearch(herb.locId);
    assert.equal(search.handled, true);
    assert.equal(h.spam.at(-1), herb.search);
    // The vine rolls 10 ticks after the search (rsprox captures); the others find it at once.
    if (herb.locId === O.MARSHY_JUNGLE_VINE) h.tick(10);
    // The fungus wall rolls every 6 ticks (fitted to the rsprox captures).
    if (herb.locId === O.FUNGUS_COVERED_CAVERN_WALL) h.tick(6);
    assert.equal(h.has(herb.grimy), true, `${herb.name} grimy herb is added`);
    assert.equal(h.quest.getStage(h.player), herb.found);
    assert.equal(h.configs.get(VARP_STAGE), herb.found);

    assert.equal(h.answer(`If the player has grimy ${herb.name.toLowerCase()}:`), true);
    assert.equal(h.answer(`If the player has ${herb.name.toLowerCase()}:`), false);
    assert.equal(h.answer(`If the player does not have any ${herb.name.toLowerCase()}:`), false);

    h.clean(herb.grimy, 0);
    assert.equal(h.has(herb.grimy), false);
    assert.equal(h.has(herb.clean), true);
    assert.equal(h.quest.getStage(h.player), herb.found, 'cleaning does not advance the stage');
    assert.equal(h.answer(`If the player has ${herb.name.toLowerCase()}:`), true);

    if (index === HERBS.length - 1) {
      const climb = h.objectClimb(O.HAND_HOLDS);
      assert.equal(climb.handled, true);
      assert.deepEqual(h.moves.at(-1), [2830, 9520, 0], 'the climb waits for its message box');
      h.continueBox();
      assert.deepEqual(h.moves.at(-1), [2830, 9520, 0], 'still inside the tick the box is continued');
      h.tick(1);
      assert.deepEqual(h.moves.at(-1), [2823, 3120, 0], 'out of the cave the tick after');
    }

    h.handIn(herb.handIn);
    assert.equal(h.has(herb.clean), false, `${herb.name} is consumed by the hand-in`);
    assert.equal(h.quest.getStage(h.player), herb.next);
    assert.equal(h.configs.get(VARP_STAGE), herb.next);
  }

  assert.equal(h.quest.getStage(h.player), 11);
  assert.equal(h.variant(), 'rogue-s-purse-talking-to-trufitus');

  h.action(COMPLETE_ACTION);
  assert.equal(h.quest.getStage(h.player), 12);
  assert.equal(h.configs.get(VARP_STAGE), 12, 'cache completion threshold varp 175 = 12');
  assert.equal(h.xp.filter(([, amount]) => amount === 775).length, 1, '775 Herblore XP once');
  assert.equal(h.player.getAttribute('quest.points'), 1);
  assert.match(h.messages.at(-1), /completed a quest/);

  const xpAfter = h.xp.length;
  h.action(COMPLETE_ACTION);
  assert.equal(h.quest.getStage(h.player), 12);
  assert.equal(h.xp.length, xpAfter, 'repeat completion action gives no second reward');
  assert.equal(h.player.getAttribute('quest.points'), 1);
  assert.equal(h.variant(), 'after-jungle-potion');
});

test('stage 11 recovery: talking to Trufitus after an interrupted final hand-in completes once', () => {
  const h = harness();
  h.quest.setStage(h.player, 11);
  h.configs.clear();

  assert.equal(h.variant(), 'rogue-s-purse-talking-to-trufitus');
  assert.equal(h.answer("If the player has no rogue's purse:"), false);
  assert.equal(h.answer("If the player has grimy rogue's purse:"), false);
  assert.equal(h.answer("If the player has rogue's purse:"), true);

  h.handIn(HERBS[4].handIn);
  assert.equal(h.quest.getStage(h.player), 11, 'the replay hand-in does not consume or rewind');

  h.action(COMPLETE_ACTION);
  assert.equal(h.quest.getStage(h.player), 12);
  assert.equal(h.configs.get(VARP_STAGE), 12);
  assert.equal(h.xp.filter(([, amount]) => amount === 775).length, 1);
});

test('grimy jungle herbs clean before the quest and only from the clicked slot', () => {
  const h = harness();
  h.give(I.GRIMY_SNAKE_WEED, 1);
  h.give(I.GRIMY_ARDRIGAL, 1);
  assert.equal(h.quest.getStage(h.player), 0);

  h.clean(I.GRIMY_ARDRIGAL, 1);
  assert.equal(h.has(I.GRIMY_ARDRIGAL), false);
  assert.equal(h.has(I.ARDRIGAL), true);
  assert.deepEqual(h.xp.at(-1).slice(1), [2.5]);

  h.clean(I.GRIMY_SNAKE_WEED, 1);
  assert.equal(h.has(I.GRIMY_SNAKE_WEED), true, 'a stale slot does not consume the wrong item');
  assert.equal(h.has(I.ARDRIGAL), true, 'the item actually in the slot is untouched');
  assert.equal(h.has(I.SNAKE_WEED), false, 'no clean herb is created from the stale click');

  h.clean(I.GRIMY_SNAKE_WEED, 0);
  assert.equal(h.has(I.GRIMY_SNAKE_WEED), false);
  assert.equal(h.has(I.SNAKE_WEED), true);
});

test('full bag: herb searches do not advance or create items', () => {
  const h = harness();
  h.quest.setStage(h.player, 1);
  h.setFull(true);
  h.objectSearch(O.MARSHY_JUNGLE_VINE);
  assert.equal(h.quest.getStage(h.player), 1);
  assert.equal(h.has(I.GRIMY_SNAKE_WEED), false);
  assert.match(h.messages.at(-1), /no room/i);
});

test('out-of-order hand-ins and early completion actions do not consume items or complete', () => {
  const h = harness();
  h.quest.setStage(h.player, 3);
  h.give(I.SNAKE_WEED, 1);
  h.handIn(HERBS[0].handIn);
  assert.equal(h.has(I.SNAKE_WEED), true, 'an herb already handed in is not eaten again');

  h.quest.setStage(h.player, 0);
  h.action(COMPLETE_ACTION);
  assert.equal(h.quest.getStage(h.player), 0);
  assert.equal(h.player.getAttribute('quest.points') ?? 0, 0);
});

test('login resends the durable stage on varp 175', () => {
  const h = harness();
  h.quest.setStage(h.player, 7);
  h.configs.clear();
  h.login();
  assert.equal(h.configs.get(VARP_STAGE), 7);

  h.quest.complete(h.player);
  h.configs.clear();
  h.login();
  assert.equal(h.configs.get(VARP_STAGE), 12);
});
