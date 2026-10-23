// Monk's Friend (q074) route contract. From server/: node --test tests/qh728-q074.test.cjs
// The route test starts at fresh stage 0. The plank/full-bag/relog tests fixture-set a
// labelled durable stage and inventory, then dispatch the real registered handlers; they
// prove the handler contracts only, not a natural route.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();
const core = require(root + '/dist/plugins/PluginManager').PluginManager.getCoreApi();
const PluginManager = require(root + '/dist/plugins/PluginManager').PluginManager;
const { CachePipeline } = require(root + '/dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require(root + '/dist/game/definition/loader/impl/NpcDefinitionLoader');
const { DialogueManager } = require(root + '/dist/game/model/dialogues/DialogueManager');
const { CountdownTask } = require(root + '/dist/game/task/impl/CountdownTask');
const runtime = require(root + '/plugins/quests/QuestRuntime');
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(root);
  new NpcDefinitionLoader().load();
});

const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;
const STACKABLE = new Set([I.LAW_RUNE]);

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const xp = [];
  const jingles = [];
  const moves = [];
  const dropped = [];
  const configs = new Map();
  let location = new core.Location(2607, 3211, 0);

  const sender = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendJingle(id) { jingles.push(id); return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });

  const usedSlots = () => [...items.values()].filter((amount) => amount > 0).length;
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => inventory.getAmount(id) > 0,
    containsNumber: (id) => inventory.getAmount(id) > 0,
    getFreeSlots: () => 28 - usedSlots(),
    isFull: () => usedSlots() >= 28,
    adds(id, amount = 1) {
      if (STACKABLE.has(id)) {
        if (inventory.getAmount(id) > 0 || inventory.getFreeSlots() > 0) {
          items.set(id, inventory.getAmount(id) + amount);
        } else {
          messages.push("You couldn't hold all those items.");
        }
        return inventory;
      }
      for (let index = 0; index < amount; index++) {
        if (inventory.getFreeSlots() <= 0) {
          messages.push("You couldn't hold all those items.");
          break;
        }
        items.set(id, inventory.getAmount(id) + 1);
      }
      return inventory;
    },
    deleteNumber(id, amount = 1) {
      const left = inventory.getAmount(id) - amount;
      if (left > 0) items.set(id, left);
      else items.delete(id);
      return inventory;
    },
    forceAdd(_player, item) {
      const id = item.getId();
      const amount = item.getAmount();
      if (inventory.isFull() && !(inventory.getAmount(id) > 0 && STACKABLE.has(id))) {
        dropped.push([id, amount]);
        return inventory;
      }
      return inventory.adds(id, amount);
    },
  };

  const player = {
    attrs, items, messages, xp, jingles, moves, dropped, configs, inventory,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]) }),
    getPacketSender: () => sender,
    getLocation: () => location,
    setLocation: (next) => { location = next; },
    moveTo: (next) => moves.push([next.getX(), next.getY(), next.getZ()]),
    sendMessage: (message) => messages.push(message),
    getDialogueManager: () => ({ isActive: () => false }),
    getArea: () => null,
    getIndex: () => 1,
    isPlayer: () => true,
    getAsPlayer: () => player,
    isRegistered: () => true,
    getUsername: () => 'qh728-q074',
  };
  return player;
}

function harness() {
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const objectHooks = [];
  const registered = [];
  const deregistered = [];
  let area = null;
  const api = new Proxy({
    core: { ...core, TaskManager: { submit: noop, cancelTasks: noop } },
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onObjectInteraction: (handler) => objectHooks.push(handler),
    onCustomEvent(key, handler) {
      const handlers = custom.get(key) ?? [];
      handlers.push(handler);
      custom.set(key, handlers);
    },
    emitCustomEvent(key, event) {
      for (const handler of custom.get(key) ?? []) handler(event);
    },
    registerArea(next) { area = next; },
    getObjectManager: () => ({
      register: (object) => registered.push(object),
      deregister: (object) => deregistered.push(object),
    }),
  }, { get: (target, key) => (key in target ? target[key] : noop) });
  require(root + '/plugins/quests/quests/MonksFriend.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'monks_friend');
  return { custom, variants, conditions, objectHooks, registered, deregistered, get area() { return area; }, quest };
}

function emit(h, key, event) {
  const request = { player: h.player, handled: false, ...event };
  for (const handler of h.custom.get(key) ?? []) handler(request);
  return request;
}

function variant(h, npcId) {
  let picked = null;
  for (const handler of h.variants) {
    const value = handler({ player: h.player, npcId });
    if (value) picked = value;
  }
  return picked;
}

function action(h, stepId, npcId = N.BROTHER_OMAD, extra = {}) {
  return emit(h, 'npc-dialogue:action', { npcId, stepId, ...extra });
}

function choose(h, option, npcId) {
  return emit(h, 'npc-dialogue:choice', { npcId, option });
}

function make(npcId) {
  const h = harness();
  h.player = makePlayer();
  h.npcId = npcId;
  return h;
}

function transcriptHarness() {
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const tasks = [];
  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks() {},
  };
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: taskManager,
      CountdownTask,
      MultiChatboxPrompt: { getPending: (p) => p.prompt ?? null },
    },
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onCustomEvent(key, handler) {
      const handlers = custom.get(key) ?? [];
      handlers.push(handler);
      custom.set(key, handlers);
    },
    emitCustomEvent(key, event) {
      for (const handler of custom.get(key) ?? []) handler(event);
    },
    sendMultiChatboxPrompt(p, title, ...pairs) {
      p.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
      return true;
    },
    registerArea: noop,
    getObjectManager: () => ({ register: noop, deregister: noop }),
  }, { get: (target, key) => (key in target ? target[key] : noop) });
  require(root + '/plugins/quests/quests/MonksFriend.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'monks_friend');
  return { api, custom, variants, conditions, tasks, quest };
}

/**
 * The shared transcript runner resolves conditions through the real
 * PluginManager, so the quest's condition hook has to live there too. The
 * returned cleanup removes it again.
 */
function woodHarness() {
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const tasks = [];
  const actions = [];
  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks() {},
  };
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: taskManager,
      CountdownTask,
      MultiChatboxPrompt: { getPending: (p) => p.prompt ?? null },
    },
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => {
      conditions.push(handler);
      PluginManager.npcDialogueConditionHooks.push({ pluginName: 'qh728-q074', handler });
    },
    onCustomEvent(key, handler) {
      const handlers = custom.get(key) ?? [];
      handlers.push(handler);
      custom.set(key, handlers);
    },
    emitCustomEvent(key, event) {
      if (key === 'npc-dialogue:action') actions.push(event.stepId);
      for (const handler of custom.get(key) ?? []) handler(event);
    },
    sendMultiChatboxPrompt(p, title, ...pairs) {
      p.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
      return true;
    },
    registerArea: noop,
    getObjectManager: () => ({ register: noop, deregister: noop }),
  }, { get: (target, key) => (key in target ? target[key] : noop) });
  require(root + '/plugins/quests/quests/MonksFriend.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'monks_friend');
  const cleanup = () => {
    PluginManager.npcDialogueConditionHooks =
      PluginManager.npcDialogueConditionHooks.filter((hook) => hook.pluginName !== 'qh728-q074');
  };
  return { api, custom, variants, conditions, tasks, actions, quest, cleanup };
}

/** Plays the real registered wood transcript and reports what it consumed. */
function playWood(held) {
  const wood = woodHarness();
  try {
    const p = runnerPlayer();
    for (const [id, amount] of held) p.items.set(id, amount);
    wood.quest.setStage(p, 60);
    assert.equal(runtime.startTranscript(
      wood.api, p, N.BROTHER_CEDRIC, "Monk's Friend",
      'brother-cedric-talking-to-brother-cedric-while-holding-some-wood',
      null, null), true);
    playTranscript(p, wood.tasks);
    return {
      actions: wood.actions,
      repairs: p.messages.filter((message) => message.includes('repair the cart')).length,
      logs: p.items.get(I.LOGS) ?? 0,
      plank: p.items.get(I.PLANK) ?? 0,
      stage: wood.quest.getStage(p),
    };
  } finally {
    wood.cleanup();
  }
}

function runnerPlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const ground = [];
  const overheads = [];
  const itemBoxes = [];
  const strings = [];
  const sequence = [];
  const localNpcs = [];
  const xp = [];
  const usedSlots = () => [...items.values()].filter((amount) => amount > 0).length;
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => inventory.getAmount(id) > 0,
    getFreeSlots: () => 28 - usedSlots(),
    isFull: () => usedSlots() >= 28,
    adds(id, amount = 1) {
      items.set(id, inventory.getAmount(id) + amount);
      if (id === I.LAW_RUNE && amount > 0) sequence.push(['add-runes', amount]);
      return inventory;
    },
    deleteNumber(id, amount = 1) {
      const left = inventory.getAmount(id) - amount;
      if (left > 0) items.set(id, left); else items.delete(id);
      return inventory;
    },
    forceAdd(_player, item) {
      if (inventory.isFull() && !(inventory.getAmount(item.getId()) > 0 && STACKABLE.has(item.getId()))) {
        ground.push([item.getId(), item.getAmount()]);
        if (item.getId() === I.LAW_RUNE) sequence.push(['drop-runes', item.getAmount()]);
      } else {
        inventory.adds(item.getId(), item.getAmount());
      }
      return inventory;
    },
  };
  let p;
  const sender = new Proxy({
    sendString(text, uid) { strings.push([uid, text]); return sender; },
    sendItemOnInterfaces(uid, itemId) {
      itemBoxes.push([uid, itemId]);
      if (itemId === I.LAW_RUNE) sequence.push(['rune-box']);
      return sender;
    },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });
  p = {
    attrs, items, messages, ground, overheads, itemBoxes, strings, sequence, localNpcs, xp, inventory,
    prompt: null,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]) }),
    getPacketSender: () => sender,
    getDialogueManager: () => p.manager,
    getLocalNpcs: () => localNpcs,
    getLocation: () => new core.Location(2607, 3211, 0),
    getPrivateArea: () => null,
    moveTo: noop,
    sendMessage(text) { messages.push(text); sequence.push(['message', text]); },
    forceChat(text) { overheads.push(['player', text]); sequence.push(['overhead', 'player', text]); },
    getUsername: () => 'qh728-q074',
    getIndex: () => 1,
    isPlayer: () => true,
    getAsPlayer: () => p,
    isRegistered: () => true,
  };
  p.manager = new DialogueManager(p);
  return p;
}

function fakeNpc(id, name, x, y, overheads, sequence) {
  const definition = { getName: () => name, getId: () => id };
  return {
    getId: () => id,
    getIndex: () => id,
    getCurrentDefinition: () => definition,
    getDefinition: () => definition,
    getLocation: () => new core.Location(x, y, 0),
    getPrivateArea: () => null,
    isOwnerOnly: () => false,
    getOwner: () => null,
    isRegistered: () => true,
    isVisible: () => true,
    forceChat(text) {
      overheads.push([name, text]);
      sequence?.push(['overhead', name, text]);
    },
  };
}

function playTranscript(p, tasks, limit = 500) {
  for (let step = 0; step < limit; step++) {
    const current = p.manager.getCurrent();
    if (!current) {
      const running = tasks.filter((task) => task.isRunning());
      if (!running.length) return;
      for (const task of running) task.tick();
      continue;
    }
    if (current.constructor?.name === 'ActionDialogue') {
      const before = current;
      const running = tasks.filter((task) => task.isRunning());
      for (const task of running) task.tick();
      if (p.manager.getCurrent() !== before) continue;
      if (!tasks.some((task) => task.isRunning())) p.manager.advance();
      continue;
    }
    p.manager.advance();
  }
  throw new Error('transcript did not finish');
}

test('login replay sends the saved Monk\'s Friend stage in varp 30', () => {
  const h = make(N.BROTHER_OMAD);
  assert.equal(h.quest.varpId, 30);
  assert.equal(h.quest.completionValue, 80, 'cache quest row 97 requires varp 30 to reach 80');
  h.quest.setStage(h.player, 60);
  h.player.configs.clear();
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.player.configs.get(30), 60, 'stage 60 is replayed at login');

  h.quest.setStage(h.player, 80);
  h.player.configs.clear();
  emit(h, 'player:bootstrap-complete', {});
  assert.equal(h.player.configs.get(30), 80, 'the bootstrap replay keeps the completed stage');

  // A fresh save loads stage 0 and is replayed as 0, not left undefined.
  const fresh = make(N.BROTHER_OMAD);
  fresh.player.configs.clear();
  runtime.sendQuestVarps({ player: fresh.player });
  assert.equal(fresh.player.configs.get(30), 0);
});

test('every variant the selector returns is reachable from the indexed transcript pages', () => {
  const dialogues = require(root + '/data/definitions/npc-dialogues.json');
  const index = require(root + '/data/definitions/npc-dialogue-index.json');
  const pagesFor = (npcId) => index[String(npcId)].map((entry) => entry.page.replace(/^Transcript:/, ''));
  assert.deepEqual(pagesFor(N.BROTHER_OMAD).sort(), ['Brother Omad', "Monk's Friend"].sort());
  assert.deepEqual(pagesFor(N.BROTHER_CEDRIC).sort(), ['Brother Cedric', "Monk's Friend"].sort());
  assert.ok(pagesFor(N.MONK_13).includes('Monk') && pagesFor(N.MONK_13).includes("Monk's Friend"));
  assert.ok(dialogues['Brother Cedric'].variants['after-monk-s-friend'], 'post-quest Cedric page carries the thank-you');
  assert.ok(dialogues['Brother Omad'].variants['standard-dialogue-post-quest'], 'the permanent Omad post-quest page exists');
  assert.equal(dialogues['Monk'].default, 'standard-dialogue', 'the generic monk page is still the source-backed default');
  assert.ok(dialogues["Monk's Friend"].variants['getting-started-monk-overhead'],
    'the quest monk line for stage 10 exists');
  assert.ok(dialogues['Monk'].variants['ardougne-monastery-before-monk-s-friend']);
  assert.ok(dialogues['Monk'].variants['ardougne-monastery-after-monk-s-friend']);
  assert.ok(dialogues["Monk's Friend"].variants['child-s-blanket-talking-to-a-monk-after-retrieving-the-blanket']);
  assert.ok(dialogues["Monk's Friend"].variants['post-quest-dialogue-for-20-minutes-talking-to-the-monks']);
  for (const name of [
    'getting-started-talking-to-brother-omad',
    'getting-started-talking-to-brother-omad-before-retrieving-the-blanket',
    "child-s-blanket-talking-to-brother-omad-after-retrieving-the-blanket",
    'brother-cedric-talking-to-brother-omad-again',
    'brother-cedric-talking-to-brother-omad-before-finding-brother-cedric',
    'brother-cedric-talking-to-brother-omad-after-finding-brother-cedric',
    'brother-cedric-talking-to-brother-omad-after-giving-brother-cedric-water',
    'brother-cedric-talking-to-brother-omad-after-finding-and-helping-brother-cedric',
    'post-quest-dialogue-for-20-minutes-talking-to-brother-omad',
    'brother-cedric-talking-to-brother-cedric-before-agreeing-to-find-him',
    'brother-cedric-talking-to-brother-cedric',
    'brother-cedric-talking-to-brother-cedric-before-getting-water',
    'brother-cedric-talking-to-brother-cedric-with-water',
    'brother-cedric-talking-to-brother-cedric-after-giving-him-water-before-accepting-to-help-with-the-cart',
    'brother-cedric-talking-to-brother-cedric-before-getting-some-wood',
    'brother-cedric-talking-to-brother-cedric-while-holding-some-wood',
    'brother-cedric-talking-to-brother-cedric-again-before-returning',
    'brother-cedric-dancing-cutscene',
  ]) {
    assert.ok(dialogues["Monk's Friend"].variants[name], name);
  }
});

test('fresh stage 0 reaches completion through the registered Quest Helper legs', () => {
  const h = make(N.BROTHER_OMAD);
  const p = h.player;
  h.quest.setStage(p, 0);
  assert.equal(h.quest.getStage(p), 0);

  assert.equal(variant(h, N.BROTHER_OMAD), 'getting-started-talking-to-brother-omad');
  assert.equal(variant(h, N.BROTHER_CEDRIC), 'brother-cedric-talking-to-brother-cedric-before-agreeing-to-find-him');

  emit(h, 'npc-dialogue:hook', { npcId: N.BROTHER_OMAD, hook: 'quest:monk-s-friend:start' });
  assert.equal(h.quest.getStage(p), 10, 'the start hook sets stage 10');

  // Stage 10, blanket not yet picked up: the message does not hand anything over.
  const noBlanket = action(h, 'bT1LEg');
  assert.equal(noBlanket.handled, false);
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(variant(h, N.BROTHER_OMAD), 'getting-started-talking-to-brother-omad-before-retrieving-the-blanket');

  p.items.set(I.CHILDS_BLANKET, 1);
  assert.equal(variant(h, N.BROTHER_OMAD), 'child-s-blanket-talking-to-brother-omad-after-retrieving-the-blanket');
  const blanket = action(h, 'bT1LEg');
  assert.equal(blanket.handled, true);
  assert.equal(h.quest.getStage(p), 20, 'the blanket hand-in sets stage 20');
  assert.equal(p.items.get(I.CHILDS_BLANKET), undefined, 'the blanket is consumed');

  assert.equal(variant(h, N.BROTHER_OMAD), 'brother-cedric-talking-to-brother-omad-again');
  choose(h, 'Where should I look?', N.BROTHER_OMAD);
  assert.equal(h.quest.getStage(p), 30, 'asking where to look sets stage 30');
  assert.equal(variant(h, N.BROTHER_OMAD), 'brother-cedric-talking-to-brother-omad-before-finding-brother-cedric');

  // Meeting drunk Cedric: the conversation begins at stage 30 and opens the water leg.
  assert.equal(variant(h, N.BROTHER_CEDRIC), 'brother-cedric-talking-to-brother-cedric');
  assert.equal(h.quest.getStage(p), 40, 'the first Cedric talk sets stage 40');
  assert.equal(variant(h, N.BROTHER_CEDRIC), 'brother-cedric-talking-to-brother-cedric-before-getting-water');

  // Water hand-in without the jug is refused by the handler (the variant also guards it).
  const noWater = action(h, 'w4kh6u', N.BROTHER_CEDRIC);
  assert.equal(noWater.handled, false);
  assert.equal(h.quest.getStage(p), 40);
  p.items.set(I.JUG_OF_WATER, 1);
  assert.equal(variant(h, N.BROTHER_CEDRIC), 'brother-cedric-talking-to-brother-cedric-with-water');
  const water = action(h, 'w4kh6u', N.BROTHER_CEDRIC);
  assert.equal(water.handled, true);
  assert.equal(h.quest.getStage(p), 50, 'the water hand-in sets stage 50');
  assert.equal(p.items.get(I.JUG_OF_WATER), undefined, 'the jug of water is consumed');

  assert.equal(variant(h, N.BROTHER_CEDRIC), 'brother-cedric-talking-to-brother-cedric-after-giving-him-water-before-accepting-to-help-with-the-cart');
  choose(h, "Yes, I'd be happy to!", N.BROTHER_CEDRIC);
  assert.equal(h.quest.getStage(p), 60, 'accepting the cart help sets stage 60');

  assert.equal(variant(h, N.BROTHER_CEDRIC), 'brother-cedric-talking-to-brother-cedric-before-getting-some-wood');
  p.items.set(I.LOGS, 2);
  assert.equal(variant(h, N.BROTHER_CEDRIC), 'brother-cedric-talking-to-brother-cedric-while-holding-some-wood');
  const logs = action(h, 'nd6lda', N.BROTHER_CEDRIC);
  assert.equal(logs.handled, true);
  assert.equal(h.quest.getStage(p), 70, 'the wood hand-in sets stage 70');
  assert.equal(p.items.get(I.LOGS), 1, 'only one log is consumed');

  assert.equal(variant(h, N.BROTHER_CEDRIC), 'brother-cedric-talking-to-brother-cedric-again-before-returning');
  assert.equal(variant(h, N.BROTHER_OMAD), 'brother-cedric-talking-to-brother-omad-after-finding-and-helping-brother-cedric');

  const runeBox = action(h, 'iTAzwR');
  assert.deepEqual(runeBox.box, { items: [I.LAW_RUNE] }, 'the canonical eight-rune item box is shown');
  assert.equal(runeBox.handled, false, 'the item box remains presentation');
  assert.equal(p.items.get(I.LAW_RUNE), 8, 'the normal handover pays eight at the box before the party');
  assert.equal(p.getAttribute('monks-friend:rune-reward-paid'), 1);
  assert.equal(h.quest.getStage(p), 70);

  action(h, 'iTAzwR');
  assert.equal(p.items.get(I.LAW_RUNE), 8, 're-entering the same box cannot pay again');

  const dancing = action(h, 'KiiD54');
  assert.equal(dancing.handled, true);
  assert.ok(Array.isArray(dancing.steps) && dancing.steps.some((step) => step.id === 'QwqMu_'),
    'the cutscene variant is spliced in with its completion action');

  const complete = action(h, 'QwqMu_');
  assert.equal(complete.handled, true);
  assert.equal(complete.end, true);
  assert.equal(h.quest.getStage(p), 80, 'the completion action sets the durable completion stage');
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(Number(p.getAttribute('quest.points')) || 0, 1, 'one quest point');
  assert.equal(p.items.get(I.LAW_RUNE), 8, 'eight law runes');
  assert.ok(p.xp.some(([skill, amount]) => skill === core.Skill.WOODCUTTING.getIndex() && amount === 2000),
    '2,000 Woodcutting experience');
  assert.ok(p.messages.some((message) => message.includes("Monk's Friend")), 'the completion message is sent');

  action(h, 'QwqMu_');
  assert.equal(p.items.get(I.LAW_RUNE), 8, 'completion cannot add a second reward');

  assert.equal(variant(h, N.BROTHER_OMAD), 'post-quest-dialogue-for-20-minutes-talking-to-brother-omad');
  assert.equal(variant(h, N.BROTHER_CEDRIC), 'after-monk-s-friend', 'post-quest Cedric uses the canonical thank-you');
  assert.equal(variant(h, N.MONK_13), 'post-quest-dialogue-for-20-minutes-talking-to-the-monks',
    'Ardougne monks share the 20-minute party chatter');
  assert.ok(Number(p.getAttribute('monks-friend:party-until')) > Date.now(), 'the party window starts at completion');
});

test('declining the optional dialogue branches keeps the route on its current leg', () => {
  const h = make(N.BROTHER_OMAD);
  const p = h.player;
  h.quest.setStage(p, 20);
  choose(h, "I've no time for that, sorry.", N.BROTHER_OMAD);
  assert.equal(h.quest.getStage(p), 20, 'declining to look for Cedric does not advance');
  choose(h, 'Where should I look?', N.BROTHER_OMAD);
  assert.equal(h.quest.getStage(p), 30, 'the same stage-20 conversation still advances on the real choice');

  h.quest.setStage(p, 50);
  assert.equal(variant(h, N.BROTHER_CEDRIC), 'brother-cedric-talking-to-brother-cedric-after-giving-him-water-before-accepting-to-help-with-the-cart');
  choose(h, "No, I've helped enough monks today!", N.BROTHER_CEDRIC);
  assert.equal(h.quest.getStage(p), 50, 'declining the cart help keeps stage 50');
  assert.equal(variant(h, N.BROTHER_CEDRIC), 'brother-cedric-talking-to-brother-cedric-after-giving-him-water-before-accepting-to-help-with-the-cart',
    'the menu is still offered on the next talk');
  choose(h, "Yes, I'd be happy to!", N.BROTHER_CEDRIC);
  assert.equal(h.quest.getStage(p), 60, 'accepting later still advances');
});

test('the wood leg accepts a plank and refuses either item when it is missing', () => {
  const h = make(N.BROTHER_CEDRIC);
  const p = h.player;
  h.quest.setStage(p, 60);

  assert.equal(variant(h, N.BROTHER_CEDRIC), 'brother-cedric-talking-to-brother-cedric-before-getting-some-wood');
  const noWood = action(h, 'nd6lda', N.BROTHER_CEDRIC);
  assert.equal(noWood.handled, true, 'the hand-over message is suppressed without the item');
  assert.equal(h.quest.getStage(p), 60, 'but the cart is not repaired');
  assert.ok(!p.messages.some((message) => message.includes('repair the cart')));

  p.items.set(I.PLANK, 1);
  assert.equal(variant(h, N.BROTHER_CEDRIC), 'brother-cedric-talking-to-brother-cedric-while-holding-some-wood');
  const plank = action(h, 'Gil6fA', N.BROTHER_CEDRIC);
  assert.equal(plank.handled, true);
  assert.equal(h.quest.getStage(p), 70, 'a plank repairs the cart just as logs do');
  assert.equal(p.items.get(I.PLANK), undefined, 'the plank is consumed');
});

test('the wood leg hands over one item only: logs are preferred and a plank is never spent', () => {
  // The real transcript runner keeps the remaining sibling conditions as a tail
  // after the chosen branch, so a player carrying both must not pay twice.
  const both = playWood([[I.LOGS, 2], [I.PLANK, 1]]);
  assert.deepEqual(both.actions, ['nd6lda'], 'only the logs branch runs');
  assert.equal(both.repairs, 1, 'the repair message is printed once');
  assert.equal(both.logs, 1, 'one log is consumed');
  assert.equal(both.plank, 1, 'the plank is not spent');
  assert.equal(both.stage, 70, 'the cart is repaired');

  const lastLog = playWood([[I.LOGS, 1], [I.PLANK, 1]]);
  assert.deepEqual(lastLog.actions, ['nd6lda'], 'the last log still wins over the plank');
  assert.equal(lastLog.repairs, 1);
  assert.equal(lastLog.logs, 0);
  assert.equal(lastLog.plank, 1, 'the plank survives the hand-over');

  const plankOnly = playWood([[I.PLANK, 1]]);
  assert.deepEqual(plankOnly.actions, ['Gil6fA'], 'a plank on its own still repairs the cart');
  assert.equal(plankOnly.repairs, 1);
  assert.equal(plankOnly.plank, 0, 'the plank is consumed');
  assert.equal(plankOnly.stage, 70);
});

test('the stone circle spawns the canonical ladder and scopes both ladder clicks', () => {
  const h = make(N.BROTHER_OMAD);
  const p = h.player;
  p.setLocation(new core.Location(2561, 3221, 0));

  h.area.enter(p);
  assert.equal(h.registered.length, 1, 'entering the circle spawns its ladder');
  const ladder = h.registered[0];
  assert.equal(ladder.getId(), O.LADDER_192, 'the helper/cache ladder id 16680, not the KBD ladder');
  assert.deepEqual([ladder.getLocation().getX(), ladder.getLocation().getY(), ladder.getLocation().getZ()], [2561, 3221, 0]);
  assert.ok(p.messages.includes('A ladder mysteriously appears.'));

  const click = (objectId, x, y) => {
    const event = {
      player: p,
      objectId,
      location: new core.Location(x, y, 0),
      clickType: 1,
      definition: { getActions: () => ['Climb-down'] },
      handled: false,
    };
    for (const handler of h.objectHooks) handler(event);
    return event;
  };

  assert.equal(click(O.LADDER_192, 2561, 3221).handled, true, 'the spawned circle ladder is handled');
  assert.deepEqual(p.moves.at(-1), [2561, 9621, 0], 'it enters the thieves cave');
  assert.equal(click(O.LADDER_192, 2884, 3397).handled, false, 'other ladders with the same id are untouched');
  assert.deepEqual(p.moves.at(-1), [2561, 9621, 0], 'an unrelated 16680 click does not move the player');

  assert.equal(click(O.LADDER_216, 2561, 9622).handled, true, 'the cave exit ladder is handled');
  assert.deepEqual(p.moves.at(-1), [2561, 3221, 0], 'it returns to the stone circle');
  assert.equal(click(O.LADDER_216, 3405, 9907).handled, false, 'other cellar ladders stay with their own plugins');

  h.area.leave(p, false);
  assert.equal(h.deregistered.length, 1, 'leaving the last player removes the spawned ladder');
});

test('the 20-minute party dialogue expires to the named post-quest pages', () => {
  const h = make(N.BROTHER_OMAD);
  const p = h.player;
  h.quest.setStage(p, 80);

  p.setAttribute('monks-friend:party-until', Date.now() + 60_000);
  assert.equal(variant(h, N.BROTHER_OMAD), 'post-quest-dialogue-for-20-minutes-talking-to-brother-omad');
  assert.equal(variant(h, N.MONK_13), 'post-quest-dialogue-for-20-minutes-talking-to-the-monks');

  p.setAttribute('monks-friend:party-until', Date.now() - 1);
  assert.deepEqual(variant(h, N.BROTHER_OMAD), { page: 'Brother Omad', variant: 'standard-dialogue-post-quest' },
    'after the titled window the named page supplies the permanent post-quest line');
  assert.deepEqual(variant(h, N.MONK_13), { page: 'Monk', variant: 'ardougne-monastery-after-monk-s-friend' },
    'after the window the monk uses its named after-quest line, not generic Greetings traveller');

  // Old saves predate the timestamp; the permanent named page is the safe source-backed default.
  p.attrs.delete('monks-friend:party-until');
  assert.deepEqual(variant(h, N.BROTHER_OMAD), { page: 'Brother Omad', variant: 'standard-dialogue-post-quest' });
});

test('the actual final Omad transcript plays the rune box, party overheads and completion in order', () => {
  const h = transcriptHarness();
  const p = runnerPlayer();
  h.quest.setStage(p, 70);
  const omad = fakeNpc(N.BROTHER_OMAD, 'Brother Omad', 2607, 3211, p.overheads, p.sequence);
  const monk = fakeNpc(N.MONK_13, 'Monk', 2608, 3209, p.overheads, p.sequence);
  p.localNpcs.push(omad, monk);

  assert.equal(runtime.startTranscript(
    h.api, p, N.BROTHER_OMAD, "Monk's Friend",
    'brother-cedric-talking-to-brother-omad-after-finding-and-helping-brother-cedric',
    null, omad), true);
  playTranscript(p, h.tasks);

  assert.equal(h.quest.getStage(p), 80, 'the transcript completion action dispatches the durable stage');
  assert.equal(p.items.get(I.LAW_RUNE), 8, 'the normal handover pays exactly eight');
  assert.equal(p.getAttribute('monks-friend:rune-reward-paid'), 1);
  assert.ok(Number(p.getAttribute('monks-friend:party-until')) > Date.now(), 'completion starts the party window');
  assert.ok(p.itemBoxes.some(([, itemId]) => itemId === I.LAW_RUNE), 'the rune item box is rendered');
  assert.ok(p.strings.some(([, text]) => text.includes('Brother Omad gives you 8 Law Runes.')),
    'the canonical tbox text is used');
  assert.deepEqual(p.overheads, [
    ['Brother Omad', 'Party!'],
    ['player', 'Woop!'],
    ['Monk', 'Yeah!'],
    ['Brother Omad', "Let's boogie!"],
    ['player', 'Oh baby!'],
    ['Monk', 'GO!'],
    ['Brother Omad', 'Get down!'],
    ['player', 'Feel the rhythm!'],
    ['Monk', 'Dance!'],
    ['Brother Omad', 'Oh my!'],
    ['player', 'Watch me go!'],
    ['Monk', 'You go!'],
  ], 'the canonical party lines keep their actors and overhead presentation');

  const runeBoxAt = p.sequence.findIndex((entry) => entry[0] === 'rune-box');
  const runeGrantAt = p.sequence.findIndex((entry) => entry[0] === 'add-runes');
  const firstOverheadAt = p.sequence.findIndex((entry) => entry[0] === 'overhead');
  const completionAt = p.sequence.findIndex((entry) => entry[0] === 'message' && entry[1].includes("Monk's Friend"));
  assert.ok(runeBoxAt >= 0 && runeGrantAt >= 0 && runeGrantAt < firstOverheadAt && runeBoxAt < firstOverheadAt,
    'the normal runes and their box are handled at the handover before the party');
  assert.ok(completionAt > firstOverheadAt, 'completion is after the dancing overheads');

  h.player = p;
  emit(h, 'npc-dialogue:action', { npcId: N.BROTHER_OMAD, stepId: 'iTAzwR' });
  emit(h, 'npc-dialogue:action', { npcId: N.BROTHER_OMAD, stepId: 'QwqMu_' });
  assert.equal(p.items.get(I.LAW_RUNE), 8, 'a replayed box/completion cannot pay a second reward');
  assert.equal(h.quest.getStage(p), 80);
});

test('a full bag defers all eight runes to the floor after the actual party transcript', () => {
  // Fixture: stage 70 (ready to finish) and 28 distinct filler items, no law runes.
  const h = transcriptHarness();
  const p = runnerPlayer();
  h.quest.setStage(p, 70);
  for (let index = 0; index < 28; index++) p.items.set(20000 + index, 1);
  const omad = fakeNpc(N.BROTHER_OMAD, 'Brother Omad', 2607, 3211, p.overheads, p.sequence);
  const monk = fakeNpc(N.MONK_13, 'Monk', 2608, 3209, p.overheads, p.sequence);
  p.localNpcs.push(omad, monk);
  assert.equal(p.inventory.isFull(), true);

  let completedObserver = null;
  let observerCalls = 0;
  h.api.onCustomEvent('quest:completed', ({ player, quest }) => {
    observerCalls++;
    completedObserver = {
      stage: quest.getStage(player),
      paid: Number(player.getAttribute('monks-friend:rune-reward-paid')),
      pending: Number(player.getAttribute('monks-friend:rune-reward-pending')),
      dropped: player.ground.filter(([id]) => id === I.LAW_RUNE).reduce((sum, [, amount]) => sum + amount, 0),
      held: player.items.get(I.LAW_RUNE) ?? 0,
    };
  });

  assert.equal(runtime.startTranscript(
    h.api, p, N.BROTHER_OMAD, "Monk's Friend",
    'brother-cedric-talking-to-brother-omad-after-finding-and-helping-brother-cedric',
    null, omad), true);
  playTranscript(p, h.tasks);

  assert.equal(h.quest.getStage(p), 80);
  assert.equal(p.getAttribute('monks-friend:rune-reward-paid'), 1);
  assert.equal(p.getAttribute('monks-friend:rune-reward-pending'), 0);
  const droppedRunes = p.ground.filter(([id]) => id === I.LAW_RUNE).reduce((sum, [, amount]) => sum + amount, 0);
  assert.equal(droppedRunes, 8, 'exactly eight runes drop for a full bag');
  assert.equal(p.items.get(I.LAW_RUNE) ?? 0, 0);

  const overheadIndexes = p.sequence
    .map((entry, index) => (entry[0] === 'overhead' ? index : -1))
    .filter((index) => index >= 0);
  assert.equal(overheadIndexes.length, 12, 'all twelve dancing overhead lines played');
  const firstDropAt = p.sequence.findIndex((entry) => entry[0] === 'drop-runes');
  assert.ok(firstDropAt > overheadIndexes.at(-1), 'no ground drop during any of the twelve overhead lines');
  assert.ok(!p.sequence.some((entry) => entry[0] === 'add-runes'), 'nothing is added to the full bag');

  assert.deepEqual(completedObserver, { stage: 80, paid: 1, pending: 0, dropped: 8, held: 0 },
    'quest:completed observers see the settled full-bag reward');
  assert.equal(observerCalls, 1);

  // Simulated relog, then repeated box/completion actions, cannot pay twice.
  runtime.sendQuestVarps({ player: p });
  h.player = p;
  emit(h, 'npc-dialogue:action', { npcId: N.BROTHER_OMAD, stepId: 'iTAzwR' });
  emit(h, 'npc-dialogue:action', { npcId: N.BROTHER_OMAD, stepId: 'QwqMu_' });
  const droppedAgain = p.ground.filter(([id]) => id === I.LAW_RUNE).reduce((sum, [, amount]) => sum + amount, 0);
  assert.equal(droppedAgain, 8, 'a relog/repeated completion cannot drop a second reward');
  assert.equal(observerCalls, 1, 'a completed quest does not emit a second completion');
});

test('an interrupted box payment survives re-talk and relog without duplication', () => {
  const h = make(N.BROTHER_OMAD);
  const p = h.player;
  h.quest.setStage(p, 70);

  action(h, 'iTAzwR');
  assert.equal(p.items.get(I.LAW_RUNE), 8);
  assert.equal(p.getAttribute('monks-friend:rune-reward-paid'), 1);
  assert.equal(p.getAttribute('monks-friend:rune-reward-pending'), 0);

  // Simulated relog: the saved stage and reward flags are still present.
  p.configs.clear();
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.configs.get(30), 70);
  action(h, 'iTAzwR');
  assert.equal(p.items.get(I.LAW_RUNE), 8, 're-talking at the same stage does not pay again');

  action(h, 'QwqMu_');
  assert.equal(h.quest.getStage(p), 80);
  assert.equal(p.items.get(I.LAW_RUNE), 8);
  action(h, 'QwqMu_');
  assert.equal(p.items.get(I.LAW_RUNE), 8, 'repeat completion is once-only');

  // Fixture: full bag, interrupted after the deferred box state.
  const full = make(N.BROTHER_OMAD);
  const q = full.player;
  full.quest.setStage(q, 70);
  for (let index = 0; index < 28; index++) q.items.set(20000 + index, 1);
  action(full, 'iTAzwR');
  assert.equal(q.getAttribute('monks-friend:rune-reward-pending'), 1);
  assert.equal(q.dropped.length, 0, 'the full-bag drop is not early');
  action(full, 'iTAzwR');
  assert.equal(q.dropped.length, 0, 'a replayed box cannot drop early or duplicate');
  action(full, 'QwqMu_');
  assert.equal(q.dropped.filter(([id]) => id === I.LAW_RUNE).reduce((sum, [, amount]) => sum + amount, 0), 8);
  action(full, 'QwqMu_');
  assert.equal(q.dropped.filter(([id]) => id === I.LAW_RUNE).reduce((sum, [, amount]) => sum + amount, 0), 8);
});

test('Ardougne monk 4246 follows the sourced pre/blanket/party/post variants', () => {
  const h = make(N.MONK_13);
  const p = h.player;

  h.quest.setStage(p, 0);
  assert.deepEqual(variant(h, N.MONK_13), { page: 'Monk', variant: 'ardougne-monastery-before-monk-s-friend' });

  h.quest.setStage(p, 10);
  assert.deepEqual(variant(h, N.MONK_13), { page: "Monk's Friend", variant: 'getting-started-monk-overhead' },
    'stage 10 uses the quest monk line, not the generic monk page with its healing menu');

  h.quest.setStage(p, 20);
  assert.equal(variant(h, N.MONK_13), 'child-s-blanket-talking-to-a-monk-after-retrieving-the-blanket');
  h.quest.setStage(p, 79);
  assert.equal(variant(h, N.MONK_13), 'child-s-blanket-talking-to-a-monk-after-retrieving-the-blanket');

  h.quest.setStage(p, 80);
  p.setAttribute('monks-friend:party-until', Date.now() + 60_000);
  assert.equal(variant(h, N.MONK_13), 'post-quest-dialogue-for-20-minutes-talking-to-the-monks');
  p.setAttribute('monks-friend:party-until', Date.now() - 1);
  assert.deepEqual(variant(h, N.MONK_13), { page: 'Monk', variant: 'ardougne-monastery-after-monk-s-friend' },
    'after the party window the named after-quest line is used, not generic Greetings traveller');
});
