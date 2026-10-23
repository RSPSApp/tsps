// From server/: node --test tests/remaining-miscellania-parity.test.cjs (after yarn build).
//
// Route cross-checked against the OSRS Wiki transcripts, RuneLite Quest Helper
// (Zoinkwiz/quest-helper @ 06da90f, ThroneOfMiscellania/RoyalTrouble) and the
// cache varbits. Varbit 72 is the cache's 7-bit native misc_approval scale
// (0..127): capture 91 starts at 32, Quest Helper requires 96 for 75%.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

class CountdownTask {
  constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); }
}

function harness(questModule, completedQuests = new Set()) {
  const hooks = {}, events = {}, tasks = [], transcripts = [], spawned = [], removed = [], ground = [];
  const namedNpc = new Map(), anyNpc = [], zoneEnter = [], zoneExit = [], groundClicks = [];
  const modules = Array.isArray(questModule) ? questModule : [questModule];
  const api = new Proxy({
    core: { ...core, CountdownTask, TaskManager: { submit: (task) => { task.setRunning?.(true); tasks.push(task); } } },
    persistAttribute: noop,
    onCustomEvent: (name, fn) => (events[name] ??= []).push(fn),
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') { event.complete = completedQuests.has(event.key); return; }
      for (const fn of events[name] ?? []) fn(event);
    },
    onNpcInteraction(target, actions) {
      if (typeof target === 'string') namedNpc.set(target, actions);
      else anyNpc.push(target);
    },
    onZoneEnter: (zone, fn) => zoneEnter.push({ zone, fn }),
    onZoneExit: (zone, fn) => zoneExit.push({ zone, fn }),
    onGroundItemClick: (ids, clickType, fn) => groundClicks.push({ ids, clickType, fn }),
    spawnNpc(def) {
      let area, tile = new core.Location(def.x, def.y, def.z);
      const npc = { ...def, getId: () => def.id, getArea: () => area, setArea: (value) => { area = value; },
        getLocation: () => tile, moveTo: (value) => { tile = value; }, isRegistered: () => true };
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => removed.push(npc),
    getItemOnGroundManager: () => ({
      registerLocation: (...args) => { ground.push(args); return args; },
      getGroundItemById: (id) => ground.find((args) => args[1].getId() === id) ?? null,
    }),
  }, {
    get(target, key) {
      if (target[key]) return target[key];
      return (...args) => {
        const fn = typeof args[0] === 'function' ? args[0] : args[1];
        if (typeof fn === 'function') (hooks[key] ??= []).push(fn);
      };
    },
  });

  const original = runtime.startTranscript;
  runtime.startTranscript = (...args) => { transcripts.push(args); return true; };
  try { for (const module of modules) module(api); } finally { runtime.startTranscript = original; }
  const registered = runtime.getRegisteredQuests();
  const quest = registered.at(-1);

  function player() {
    const attributes = new Map(), items = new Map(), bankItems = new Map(), varbits = new Map(), configs = new Map(), strings = new Map(), messages = [], xp = [], cameras = [];
    let location = new core.Location(2502, 3852, 1), registered = true;
    const sender = new Proxy({
      sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
      sendConfig: (id, value) => { configs.set(id, value); return sender; },
      sendString: (text, id) => { strings.set(id, text); return sender; },
      sendCameraMoveTo: (...args) => { cameras.push(['move', ...args]); return sender; },
      sendCameraLookAt: (...args) => { cameras.push(['look', ...args]); return sender; },
      sendCameraReset: () => { cameras.push(['reset']); return sender; },
    }, { get: (target, key) => target[key] ?? (() => sender) });
    const inventory = {
      getAmount: (id) => items.get(id) ?? 0,
      getFreeSlots: () => 28,
      isFull: () => false,
      adds: (id, amount = 1) => items.set(id, (items.get(id) ?? 0) + amount),
      deleteNumber: (id, amount = 1) => {
        assert.ok((items.get(id) ?? 0) >= amount, `deleting ${amount} of ${id} with ${items.get(id) ?? 0}`);
        items.set(id, (items.get(id) ?? 0) - amount);
      },
    };
    const p = {
      attributes, items, bankItems, varbits, configs, strings, messages, xp, cameras,
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
      getUsername: () => 'Tester',
      getInventory: () => inventory,
      getBank: () => ({ getAmount: (id) => bankItems.get(id) ?? 0 }),
      getPacketSender: () => sender,
      getDialogueManager: () => ({ startDialogues: noop, reset: noop }),
      getLocation: () => location,
      moveTo: (value) => { location = value; },
      sendMessage: (message) => messages.push(message),
      isRegistered: () => registered,
      setRegistered: (value) => { registered = value; },
      getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill?.getName?.() ?? skill, amount]) }),
    };
    return p;
  }

  return {
    api, hooks, events, tasks, transcripts, spawned, removed, ground, quest, registered, player,
    namedNpc, anyNpc, zoneEnter, zoneExit, groundClicks,
    variantAll: (npcId, p) => (hooks.onNpcDialogueVariant ?? []).map((fn) => fn({ player: p, npcId })).find(Boolean) ?? null,
    emit: (name, event) => { for (const fn of events[name] ?? []) fn(event); },
    variant: (npcId, p) => (hooks.onNpcDialogueVariant ?? []).find(Boolean)?.( { player: p, npcId }),
    choice: (p, npcId, option) => api.emitCustomEvent('npc-dialogue:choice', { player: p, npcId, option }),
    line: (p, npcId, text) => { const event = { player: p, npcId, text }; api.emitCustomEvent('npc-dialogue:line', event); return event; },
    action: (p, npcId, stepId, kind) => { const event = { player: p, npcId, stepId, kind }; api.emitCustomEvent('npc-dialogue:action', event); return event; },
    itemOnNpc(p, npcId, itemId) { const event = { player: p, npcId, itemId, target: { getId: () => npcId } }; for (const fn of hooks.onItemOnNpc ?? []) fn(event); return event; },
    itemOnItem(p, usedItemId, usedWithItemId) { const event = { player: p, usedItemId, usedWithItemId }; for (const fn of hooks.onItemOnItem ?? []) fn(event); return event; },
    itemOnObject(p, itemId, objectId) { const event = { player: p, itemId, objectId }; for (const fn of hooks.onItemOnObject ?? []) fn(event); return event; },
    object(p, objectId) { const event = { player: p, objectId, clickType: 1 }; for (const fn of hooks.onObjectInteraction ?? []) fn(event); return event; },
    itemAction(p, itemId, option = 'Read') { const event = { player: p, itemId, option }; for (const fn of hooks.onItemAction ?? []) fn(event); return event; },
    tick(count) { while (count-- > 0) [...tasks].forEach((task) => task.run?.()); },
  };
}

const throne = () => require('../plugins/quests/quests/ThroneOfMiscellania.Quest');
const royal = () => require('../plugins/quests/quests/RoyalTrouble.Quest');

/** Play one real NpcDialogues Talk-to through the production transcript graph. */
function playRealTalk(h, player, npcId, name) {
  const originalVariant = PluginManager.emitNpcDialogueVariant;
  const originalCondition = PluginManager.emitNpcDialogueCondition;
  let handlers;
  const api = new Proxy({
    core,
    onCustomEvent: (eventName, fn) => (h.events[eventName] ??= []).push(fn),
    emitCustomEvent: (eventName, event) => { for (const fn of h.events[eventName] ?? []) fn(event); },
    onAnyNpcInteraction: (registered) => { handlers = registered; },
    sendMultiChatboxPrompt(target, title, ...pairs) {
      target.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
      return true;
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  PluginManager.emitNpcDialogueVariant = (event) =>
    (h.hooks.onNpcDialogueVariant ?? []).map((fn) => fn(event)).find(Boolean) ?? null;
  PluginManager.emitNpcDialogueCondition = (event) => {
    for (const fn of h.hooks.onNpcDialogueCondition ?? []) {
      const answer = fn(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  require('../plugins/npcs/NpcDialogues.plugin').register(api);
  try {
    handlers['Talk-to']({
      player, npc: null, npcId, clickType: 1, handled: false,
      definition: { getName: () => name, getId: () => npcId, getActions: () => ['Talk-to'] },
    });
    for (let step = 0; step < 200; step++) {
      if (player.prompt) {
        const prompt = player.prompt;
        player.prompt = null;
        prompt.pairs[1]();
        continue;
      }
      if (!player.manager.getCurrent()) break;
      player.manager.advance();
    }
  } finally {
    PluginManager.emitNpcDialogueVariant = originalVariant;
    PluginManager.emitNpcDialogueCondition = originalCondition;
  }
}

function completeThronePrerequisites(set) {
  set.add('fremennik_trials');
  set.add('heroes_quest');
}

test('Throne of Miscellania: start gate, courtship varbits and emote gates', () => {
  const done = new Set();
  const h = harness(throne(), done), p = h.player();
  h.emit('npc-dialogue:hook', { player: p, npcId: N.KING_VARGAS, hook: 'quest:throne-of-miscellania:start' });
  assert.equal(h.quest.getStage(p), 0);
  assert.match(p.messages.at(-1), /Fremennik Trials and Heroes' Quest/);

  completeThronePrerequisites(done);
  h.emit('npc-dialogue:hook', { player: p, npcId: N.KING_VARGAS, hook: 'quest:throne-of-miscellania:start' });
  assert.equal(h.quest.getStage(p), 10);
  h.choice(p, N.KING_VARGAS, "I want to earn Prince Brand's approval.");
  assert.equal(p.varbits.get(14607), 1);
  assert.match(h.variant(5447, p).variant, /getting-started-talking-to-advisor-ghrim-after-starting-the-quest$/,
    'the resolved content id 5447 reaches the Throne selector');

  assert.match(h.variant(N.PRINCE_BRAND, p).variant, /gaining-the-approval-of-prince-brand-talking-to-prince-brand$/);
  for (const answer of ['Be still, my heart.', "They don't understand your poetry as I do.", 'You will be the greatest bard!']) {
    h.choice(p, N.PRINCE_BRAND, answer);
  }
  assert.deepEqual([p.varbits.get(85), p.varbits.get(86), p.varbits.get(87)].map(Boolean), [true, true, true]);
  assert.equal(p.varbits.get(73), 13, 'capture: 10 start, +1 per answer');

  p.items.set(I.ASSORTED_FLOWERS, 1);
  h.itemOnNpc(p, N.PRINCE_BRAND, I.ASSORTED_FLOWERS);
  assert.equal(p.items.get(I.ASSORTED_FLOWERS), 0);
  assert.equal(p.varbits.get(94), 1);
  assert.equal(p.varbits.get(73), 14);

  // A ring before the emote/kiss is refused and kept.
  p.items.set(I.GOLD_RING, 1);
  h.itemOnNpc(p, N.PRINCE_BRAND, I.GOLD_RING);
  assert.equal(p.varbits.get(14606), 0);
  assert.equal(p.items.get(I.GOLD_RING), 1);

  // The clap must be next to Brand; another slot or wrong room does nothing.
  h.emit('player:emote', { player: p, slot: 12 });
  assert.equal(p.varbits.get(96), 0);
  p.moveTo(new core.Location(2502, 3852, 0));
  h.emit('player:emote', { player: p, slot: 20 });
  assert.equal(p.varbits.get(96), 0, 'must be upstairs');
  p.moveTo(new core.Location(2502, 3852, 1));
  h.emit('player:emote', { player: p, slot: 20 });
  assert.equal(p.varbits.get(96), 1);
  assert.equal(p.varbits.get(73), 15);

  // Formal introduction, second set, cake, third set.
  assert.match(h.variant(N.PRINCE_BRAND, p).variant, /after-gaining-sufficient-approval$/);
  assert.equal(p.varbits.get(73), 20);
  for (const answer of ['How poetic.', 'How inspiring!', 'A much nobler pursuit, to be sure.']) h.choice(p, N.PRINCE_BRAND, answer);
  assert.equal(p.varbits.get(73), 23);
  p.items.set(I.CAKE, 1);
  h.itemOnNpc(p, N.PRINCE_BRAND, I.CAKE);
  assert.equal(p.varbits.get(95), 1);
  assert.equal(p.varbits.get(73), 24);
  assert.match(h.variant(N.PRINCE_BRAND, p).variant, /after-giving-him-cake$/);
  assert.equal(p.varbits.get(73), 30);
  for (const answer of ["That was lovely. I'm touched!", "I wouldn't presume to have the skill...", "I'm glad to hear it."]) h.choice(p, N.PRINCE_BRAND, answer);
  assert.deepEqual([p.varbits.get(91), p.varbits.get(92), p.varbits.get(93)].map(Boolean), [true, true, true]);
  assert.equal(p.varbits.get(97), 0);
  assert.equal(p.varbits.get(73), 33);

  // Kiss gate, then the ring takes and the heir is trusted.
  h.emit('player:emote', { player: p, slot: 17 });
  assert.equal(p.varbits.get(97), 1);
  assert.equal(p.varbits.get(73), 34);
  h.itemOnNpc(p, N.PRINCE_BRAND, I.GOLD_RING);
  assert.equal(p.items.get(I.GOLD_RING), 1, 'ring waits for the proposal message');
  h.action(p, N.PRINCE_BRAND, 'nDuj-o', 'message');
  assert.equal(p.items.get(I.GOLD_RING), 0);
  assert.equal(p.varbits.get(14606), 1);
  assert.equal(p.varbits.get(73), 40);
  assert.equal(h.quest.getStage(p), 20);

  // Relog keeps courtship, affection and trust.
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(14606), 1);
  assert.equal(p.varbits.get(85), 1);
  assert.equal(p.varbits.get(96), 1);
  assert.equal(p.varbits.get(97), 1);
  assert.equal(p.varbits.get(73), 40);
});


test('Throne of Miscellania: Astrid uses the dance and bow, and switching heirs resets progress', () => {
  const done = new Set(); completeThronePrerequisites(done);
  const h = harness(throne(), done), p = h.player();
  h.emit('npc-dialogue:hook', { player: p, npcId: N.KING_VARGAS, hook: 'quest:throne-of-miscellania:start' });
  h.choice(p, N.KING_VARGAS, "I want to earn Princess Astrid's approval.");
  assert.equal(p.varbits.get(14607), 0);
  h.variant(N.PRINCESS_ASTRID, p);
  for (const answer of ['Archery is a noble art!', "He's been very helpful.", 'Hahahaha!']) h.choice(p, N.PRINCESS_ASTRID, answer);
  p.items.set(I.ASSORTED_FLOWERS, 1);
  h.itemOnNpc(p, N.PRINCESS_ASTRID, I.ASSORTED_FLOWERS);
  p.moveTo(new core.Location(2502, 3867, 1));
  h.emit('player:emote', { player: p, slot: 20 });
  assert.equal(p.varbits.get(96), 0, 'the clap is Brand only');
  h.emit('player:emote', { player: p, slot: 12 });
  assert.equal(p.varbits.get(96), 1);
  h.variant(N.PRINCESS_ASTRID, p);
  for (const answer of ['That sounds like a good idea.', 'What happened next?', "I'm quite fond of it myself."]) h.choice(p, N.PRINCESS_ASTRID, answer);
  p.items.set(I.SHORTBOW, 1);
  h.itemOnNpc(p, N.PRINCESS_ASTRID, I.SHORTBOW);
  assert.equal(p.varbits.get(95), 1);
  assert.equal(p.items.get(I.SHORTBOW), 0);
  h.variant(N.PRINCESS_ASTRID, p);
  for (const answer of ["It's a lovely little country.", 'And what a great bard he makes!', "I suppose you don't have much opportunity to."]) h.choice(p, N.PRINCESS_ASTRID, answer);
  assert.deepEqual([p.varbits.get(91), p.varbits.get(92), p.varbits.get(93)].map(Boolean), [true, true, true]);
  h.emit('player:emote', { player: p, slot: 17 });
  p.items.set(I.GOLD_RING, 1);
  h.itemOnNpc(p, N.PRINCESS_ASTRID, I.GOLD_RING);
  h.action(p, N.PRINCESS_ASTRID, 'H2ri6u', 'message');
  assert.equal(h.quest.getStage(p), 20);

  // Changing heirs after trust keeps the quest stage but resets courtship.
  h.choice(p, N.KING_VARGAS, "I want to earn Prince Brand's approval instead.");
  assert.equal(p.varbits.get(14607), 1);
  assert.equal(p.varbits.get(14606), 0, 'trust does not carry to the other heir');
  assert.equal(h.quest.getStage(p), 10);
  p.moveTo(new core.Location(2502, 3852, 1));
  assert.match(h.variant(N.PRINCE_BRAND, p).variant, /talking-to-prince-brand$/);
  assert.equal(p.varbits.get(85), 0);

  // Completed quests never lose progress through a stray heir choice.
  h.quest.setStage(p, 100);
  h.choice(p, N.KING_VARGAS, 'I think Princess Astrid would make the best heir.');
  assert.equal(h.quest.getStage(p), 100);
  assert.equal(p.varbits.get(14607), 1);
});

test('Throne of Miscellania: anthem, treaty, giant pen, support and one completion', () => {
  const h = harness(throne(), new Set(['fremennik_trials', 'heroes_quest'])), p = h.player();
  h.quest.setStage(p, 20);
  assert.match(h.variant(N.QUEEN_SIGRID, p).variant, /talking-to-queen-sigrid$/);
  assert.equal(h.quest.getStage(p), 30);
  h.action(p, N.KING_VARGAS, 'hYN_8p');
  assert.equal(h.quest.getStage(p), 40);
  assert.match(h.variant(N.QUEEN_SIGRID, p).variant, /after-king-vargas-asks-to-change-the-anthem$/);
  assert.equal(h.quest.getStage(p), 50);

  assert.match(h.variant(N.PRINCE_BRAND, p).variant, /to-ask-for-a-new-anthem$/);
  h.line(p, N.PRINCE_BRAND, "Here's a copy, you can keep it.");
  assert.equal(p.items.get(I.AWFUL_ANTHEM), 1);
  h.line(p, N.ADVISOR_GHRIM, 'There you go');
  assert.equal(p.items.get(I.AWFUL_ANTHEM), 0);
  assert.equal(p.items.get(I.GOOD_ANTHEM), 1);
  assert.equal(h.quest.getStage(p), 60);

  assert.match(h.variant(N.QUEEN_SIGRID, p).variant, /with-the-good-anthem$/);
  h.line(p, N.QUEEN_SIGRID, 'Here is a treaty declaring');
  assert.equal(p.items.get(I.GOOD_ANTHEM), 0);
  assert.equal(p.items.get(I.TREATY), 1);
  assert.equal(h.quest.getStage(p), 70);

  // A lost treaty can be replaced; one copy at a time.
  p.items.set(I.TREATY, 0);
  assert.match(h.variant(N.QUEEN_SIGRID, p).variant, /after-getting-the-treaty$/);
  assert.equal(p.items.get(I.TREATY), 1);

  h.action(p, N.KING_VARGAS, 'ZJ2xU5');
  assert.equal(p.items.get(I.TREATY), 0);
  assert.equal(h.quest.getStage(p), 80);

  h.line(p, N.DERRIK, 'One giant pen nib');
  assert.equal(p.items.get(I.GIANT_NIB) ?? 0, 0, 'no iron bar, no nib');
  p.items.set(I.IRON_BAR, 1);
  h.line(p, N.DERRIK, 'One giant pen nib');
  assert.equal(p.items.get(I.IRON_BAR), 0);
  assert.equal(p.items.get(I.GIANT_NIB), 1);
  p.items.set(I.LOGS, 1);
  h.itemOnItem(p, I.GIANT_NIB, I.LOGS);
  assert.equal(p.items.get(I.GIANT_PEN), 1);
  assert.match(h.variant(N.KING_VARGAS, p).variant, /after-getting-the-giant-pen$/);
  assert.equal(p.items.get(I.GIANT_PEN), 0);
  assert.equal(h.quest.getStage(p), 90);

  assert.equal(p.varbits.get(72), 32, 'capture starts support at native 32');
  const completion = h.action(p, N.KING_VARGAS, '7ukkOd');
  assert.equal(completion.handled, true);
  assert.equal(h.quest.getStage(p), 90, 'native 32 is not enough');

  // The recorded route hands lobsters to Fisherman Frodi; wrong items and
  // anything outside the support stage do nothing.
  p.items.set(I.RAW_LOBSTER, 1);
  h.itemOnNpc(p, N.FISHERMAN_FRODI, I.BONES);
  assert.equal(p.items.get(I.RAW_LOBSTER), 1);
  assert.equal(p.varbits.get(72), 32);
  p.moveTo(new core.Location(2550, 3890, 0));
  for (let i = 0; i < 63; i++) {
    p.items.set(I.RAW_LOBSTER, 1);
    h.itemOnNpc(p, N.FISHERMAN_FRODI, I.RAW_LOBSTER);
  }
  assert.equal(p.varbits.get(72), 95, 'one native point below the 75% gate');
  assert.equal(p.items.get(I.RAW_LOBSTER) ?? 0, 0);
  assert.match(p.messages.at(-1), /Fisherman Frodi/);
  assert.equal(h.hooks.onNpcDialogueCondition[0]({ player: p, stepId: 'Wrg10w' }), false,
    'Quest Helper 75% condition stays false at native 95');
  assert.doesNotMatch(h.variant(N.KING_VARGAS, p).variant, /after-gaining-enough-support$/);
  h.action(p, N.KING_VARGAS, '7ukkOd');
  assert.equal(h.quest.getStage(p), 90, 'native 95 does not complete');

  p.items.set(I.RAW_LOBSTER, 1);
  h.itemOnNpc(p, N.FISHERMAN_FRODI, I.RAW_LOBSTER);
  assert.equal(p.varbits.get(72), 96, '75% is native 96');
  assert.equal(h.hooks.onNpcDialogueCondition[0]({ player: p, stepId: 'Wrg10w' }), true);
  assert.match(h.variant(N.KING_VARGAS, p).variant, /after-gaining-enough-support$/);
  const percentLine = h.line(p, N.KING_VARGAS, 'Your current approval rating is [number]%.');
  assert.equal(percentLine.text, 'Your current approval rating is 75%.',
    'the native scale still reads as 75% to the player');
  h.action(p, N.KING_VARGAS, '7ukkOd');
  assert.equal(h.quest.getStage(p), 100);
  const points = p.attributes.get('quest.points');
  h.action(p, N.KING_VARGAS, '7ukkOd');
  assert.equal(h.quest.getStage(p), 100);
  assert.equal(p.attributes.get('quest.points'), points, 'replaying the scroll cannot pay twice');
});

test('Royal Trouble: Sigrid replays the heavy-box hand-in only with the earned box, and pays once', () => {
  const h = harness(royal(), new Set(['fremennik_trials', 'heroes_quest', 'throne_of_miscellania']));
  const p = h.player();
  p.manager = new DialogueManager(p);
  p.getDialogueManager = () => p.manager;
  h.quest.setStage(p, 20);
  p.attributes.set('royal-trouble:royal-misc', 50);
  p.attributes.set('royal-trouble:royal-etc', 20);

  assert.match(h.variant(N.QUEEN_SIGRID, p).variant, /talking-to-sigrid-again$/,
    'before the box, repeat Sigrid talk is the search reminder');
  playRealTalk(h, p, N.QUEEN_SIGRID, 'Queen Sigrid');
  assert.equal(p.attributes.get('royal-trouble:royal-etc'), 20, 'the real graph cannot advance to the letter');
  assert.equal(p.items.get(I.COINS) ?? 0, 0, 'the real graph does not pay early');

  p.items.set(I.HEAVY_BOX, 1);
  assert.match(h.variant(N.QUEEN_SIGRID, p).variant, /with-the-heavy-box$/);
  playRealTalk(h, p, N.QUEEN_SIGRID, 'Queen Sigrid');
  assert.equal(p.items.get(I.HEAVY_BOX) ?? 0, 0, 'the hand-in consumes the box');
  assert.equal(p.attributes.get('royal-trouble:royal-etc'), 40);
  assert.equal(p.items.get(I.COINS), 20000, 'the earned hand-in pays once');

  playRealTalk(h, p, N.QUEEN_SIGRID, 'Queen Sigrid');
  assert.equal(p.items.get(I.COINS), 20000, 'repeat talk after the hand-in cannot pay again');
});

test('Royal Trouble: post-quest Ghrim, workers and dungeon guard use canonical variants', () => {
  const h = harness(royal(), new Set(['fremennik_trials', 'heroes_quest', 'throne_of_miscellania']));
  const p = h.player();
  h.quest.setStage(p, 30);
  p.attributes.set('royal-trouble:royal-misc', 130);
  p.attributes.set('royal-trouble:royal-etc', 40);
  assert.deepEqual(h.variant(N.ADVISOR_GHRIM, p), {
    page: 'Advisor Ghrim', variant: 'standard-dialogue-after-completing-royal-trouble',
  });
  assert.deepEqual(h.variant(N.GUARD_14, p), {
    page: 'Guard (Miscellania)', variant: 'standard-dialogue-after-completing-royal-trouble',
  });
  assert.deepEqual(h.variant(N.GARDENER_GUNNHILD, p), {
    page: 'Gardener Gunnhild', variant: 'standard-dialogue-after-completion-of-throne-of-miscellania',
  });

  const before = h.player();
  h.quest.setStage(before, 10);
  before.attributes.set('royal-trouble:royal-misc', 0);
  assert.deepEqual(h.variant(N.LUMBERJACK_LEIF, before), {
    page: 'Lumberjack Leif', variant: 'standard-dialogue-after-throne-of-miscellania',
  });
  assert.deepEqual(h.variant(N.MINER_MAGNUS, before), {
    page: 'Miner Magnus', variant: 'standard-dialogue-after-throne-of-miscellania',
  });
});

test('Royal Trouble: investigation route, lift repair, diary, boss and rewards', () => {
  const done = new Set(['fremennik_trials', 'heroes_quest']);
  const h = harness(royal(), done), p = h.player();
  h.emit('npc-dialogue:hook', { player: p, npcId: 5447, hook: 'quest:royal-trouble:start' });
  assert.equal(h.quest.getStage(p), 0);
  assert.match(p.messages.at(-1), /Throne of Miscellania/);
  done.add('throne_of_miscellania');
  h.emit('npc-dialogue:hook', { player: p, npcId: 5447, hook: 'quest:royal-trouble:start' });
  assert.equal(h.quest.getStage(p), 10);

  // The world resolves spawn 3670 to content id 5447, which the RT selector keys on.
  assert.equal(h.variant(5447, p).variant, 'getting-started-talking-to-advisor-ghrim-after-starting-the-quest');

  // Partner then Vargas starts the investigation.
  h.action(p, N.PRINCESS_ASTRID, 'SQJNBj');
  h.action(p, N.PRINCESS_ASTRID, '1XAyvr');
  assert.equal(h.quest.getStage(p), 20);
  h.choice(p, N.KING_VARGAS, 'Right away, your Majesty.');
  assert.equal(p.varbits.get(2141), 10);

  h.variant(N.GARDENER_GUNNHILD, p);
  assert.equal(p.varbits.get(2143), 1);
  h.action(p, N.KING_VARGAS, 'z94pTN');
  assert.equal(p.varbits.get(2141), 20);

  h.variant(N.QUEEN_SIGRID, p);
  h.choice(p, N.QUEEN_SIGRID, "Of course, it's my duty.");
  assert.equal(p.varbits.get(2142), 10);
  h.variant(N.MATILDA, p);
  assert.equal(p.varbits.get(2144), 1);
  assert.match(h.variant(N.QUEEN_SIGRID, p).variant, /returning-to-queen-sigrid$/);
  h.choice(p, N.QUEEN_SIGRID, 'I suppose so...');
  assert.equal(p.varbits.get(2142), 20);

  h.action(p, N.KING_VARGAS, 'clSfQu');
  assert.equal(p.varbits.get(2141), 30);
  assert.match(h.variant(N.ADVISOR_GHRIM, p).variant, /to-the-dungeon-with-you-talking-to-advisor-ghrim$/);
  h.choice(p, N.SAILOR, "I'm looking for a sailor...");
  assert.equal(p.varbits.get(2141), 40);
  h.action(p, N.KING_VARGAS, 'YeaEfW');
  assert.equal(p.varbits.get(2141), 50);
  h.zoneEnter[0].fn({ player: p, zone: h.zoneEnter[0].zone });
  assert.equal(p.varbits.get(2141), 60);

  h.action(p, N.DONAL, 'UhPyoe');
  assert.equal(p.varbits.get(2141), 80);
  assert.equal(p.items.get(I.MINING_PROP), 1);

  p.items.set(I.BURNT_DIARY_1, 1);
  h.itemAction(p, I.BURNT_DIARY_1);
  assert.equal(p.varbits.get(2141), 80, 'one diary page cannot skip to stage 100');

  // Crevice stays locked until the prop is placed.
  h.object(p, O.CREVICE_10);
  assert.equal(p.varbits.get(2145), 0);
  h.itemOnObject(p, I.MINING_PROP, O.CREVICE_10);
  assert.equal(p.varbits.get(2145), 1);
  assert.equal(p.items.get(I.MINING_PROP), 0);

  // Lift repair in Quest Helper order, with ordering negatives.
  h.itemOnObject(p, I.COAL, 15238);
  assert.equal(p.varbits.get(2156), 0, 'coal cannot go in before the engine');
  p.items.set(I.ENGINE, 1); p.items.set(I.PULLEY_BEAM, 1);
  h.itemOnObject(p, I.BEAM, 15239);
  assert.equal(p.varbits.get(2146), 0, 'beam needs the rope first');
  h.itemOnObject(p, I.PULLEY_BEAM, 15240);
  assert.equal(p.varbits.get(2146), 1);
  p.items.set(I.BEAM, 1); p.items.set(I.PULLEY_BEAM, 1);
  h.itemOnItem(p, I.BEAM, I.PULLEY_BEAM);
  assert.equal(p.items.get(I.LONG_PULLEY_BEAM), 1);
  h.itemOnObject(p, I.LONG_PULLEY_BEAM, 15240);
  p.items.set(I.BEAM, 1);
  h.itemOnItem(p, I.BEAM, I.LONG_PULLEY_BEAM);
  assert.equal(p.items.get(I.LONGER_PULLEY_BEAM), 1);
  h.itemOnObject(p, I.LONGER_PULLEY_BEAM, 15240);
  assert.equal(p.varbits.get(2146), 2);
  p.items.set(I.PULLEY_BEAM, 1);
  h.itemOnObject(p, I.PULLEY_BEAM, 15240);
  assert.equal(p.varbits.get(2146), 3);
  p.items.set(I.ROPE, 1);
  h.itemOnObject(p, I.ROPE, 15240);
  assert.equal(p.varbits.get(2146), 4);
  p.items.set(I.BEAM, 1);
  h.itemOnObject(p, I.BEAM, 15239);
  assert.equal(p.varbits.get(2146), 5);
  for (let i = 0; i < 5; i++) { p.items.set(I.COAL, 1); h.itemOnItem(p, I.COAL, I.ENGINE); }
  assert.equal(p.varbits.get(2156), 5, 'coal can be loaded into the carried engine');
  h.itemOnObject(p, I.ENGINE, 15238);
  assert.equal(p.varbits.get(2156), 5);
  assert.equal(p.varbits.get(2146), 7);
  assert.equal(p.varbits.get(2141), 90, 'the repaired lift reaches the recorded 90');
  h.object(p, 15239);
  assert.equal(p.varbits.get(2146), 9);

  // Diary pages come from the fires in any order but only once each.
  for (const id of [15206, 15207, 15208, 15209, 15210]) h.object(p, id);
  assert.equal(p.varbits.get(2148), 5);
  h.object(p, 15206);
  assert.equal(p.varbits.get(2148), 5);
  assert.equal(p.items.get(I.BURNT_DIARY_5), 1);

  // Crevice needs all pages and a read diary.
  h.object(p, O.CREVICE_12);
  assert.equal(p.varbits.get(2157), 0);
  h.itemAction(p, I.BURNT_DIARY_5);
  assert.equal(p.varbits.get(2141), 100, 'reading the completed diary reaches 100');
  h.object(p, O.CREVICE_12);
  assert.equal(p.varbits.get(2157) ?? 0, 0, 'the watched flag lands when the scene ends');
  assert.equal(p.getLocation().getY(), 10276, 'the recorded kids scene places the camera over the room');
  assert.deepEqual(p.cameras.map((entry) => entry[0]), ['move', 'look']);
  h.action(p, N.ARMOD, 'P_Qf1k');
  assert.deepEqual(p.cameras.slice(-3).map((entry) => entry[0]), ['move', 'look', 'look'],
    'captured reveal sweep runs before the reset');
  h.tick(1);
  assert.equal(p.varbits.get(2157), 1);
  assert.equal(p.getLocation().getX(), 2580);
  assert.equal(p.getLocation().getY(), 10268, 'the scene teleports the player onto the path');
  assert.equal(p.cameras.at(-1)[0], 'reset');
  h.object(p, O.CREVICE_13);
  assert.equal(p.getLocation().getY(), 10263, 'leaving moves back to the path');

  // Kids, snake, heavy box.
  const kidEvent = { player: p, npcId: N.ARMOD, clickType: 1, definition: { getActions: () => ['Talk-to'] } };
  for (const fn of h.anyNpc) fn(kidEvent);
  assert.equal(p.varbits.get(2141), 110);
  h.zoneEnter[1].fn({ player: p, zone: h.zoneEnter[1].zone });
  assert.equal(h.spawned.length, 1);
  h.hooks.onNpcDeath[0]({ killer: p, npc: h.spawned[0], npcId: N.GIANT_SEA_SNAKE });
  assert.equal(p.varbits.get(2141), 120);
  assert.equal(h.ground.length, 1);
  assert.deepEqual([h.ground[0][2].getX(), h.ground[0][2].getY()], [2613, 10278],
    'the captured box lands on the reachable fight ledge');

  // Sigrid's letter, then Vargas completes once and pays once.
  p.items.set(I.HEAVY_BOX, 1);
  assert.match(h.variant(N.QUEEN_SIGRID, p).variant, /with-the-heavy-box$/);
  h.action(p, N.QUEEN_SIGRID, 'ARzdfn');
  assert.equal(p.varbits.get(2142), 40);
  assert.equal(p.items.get(I.LETTER_6), 1);
  assert.match(h.variant(N.KING_VARGAS, p).variant, /returning-to-king-vargas$/);
  h.action(p, N.KING_VARGAS, '2rSWNl');
  assert.equal(h.quest.getStage(p), 30);
  assert.equal(p.varbits.get(2141), 130, 'completion records the captured 130');
  assert.equal(p.varbits.get(2143), 0);
  assert.equal(p.varbits.get(2144), 0);
  const xp = p.xp.length, points = p.attributes.get('quest.points');
  h.action(p, N.KING_VARGAS, '2rSWNl');
  assert.equal(p.xp.length, xp);
  assert.equal(p.attributes.get('quest.points'), points);
});

test('Royal Trouble: dropped scroll and prop are recoverable, relog restores varbits', () => {
  const done = new Set(['fremennik_trials', 'heroes_quest', 'throne_of_miscellania']);
  const h = harness(royal(), done), p = h.player();
  h.quest.setStage(p, 20);
  p.attributes.set('royal-trouble:royal-misc', 50);
  p.attributes.set('royal-trouble:royal-etc', 20);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(2141), 50);
  assert.equal(p.varbits.get(2142), 20);
  p.attributes.set('royal-trouble:royal-misc', 0);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(2141), 0);
});

test('Ghrim resolves through content id 5447 and defers between the two quests', () => {
  const done = new Set();
  const h = harness([royal(), throne()], done), p = h.player();
  let choice = h.variantAll(5447, p);
  assert.equal(choice.page, 'Throne of Miscellania');
  assert.match(choice.variant, /pre-quest-talking-to-advisor-ghrim/);

  h.registered.find((quest) => quest.key === 'throne_of_miscellania').setStage(p, 10);
  choice = h.variantAll(5447, p);
  assert.equal(choice.page, 'Throne of Miscellania');
  assert.equal(choice.variant, 'getting-started-talking-to-advisor-ghrim-after-starting-the-quest');

  done.add('throne_of_miscellania');
  choice = h.variantAll(5447, p);
  assert.equal(choice.page, 'Royal Trouble');
  assert.equal(choice.variant, 'getting-started-talking-to-advisor-ghrim');
});

test('the lift manual opens from the inventory and from its floor spawn', () => {
  const h = harness(royal(), new Set(['fremennik_trials', 'heroes_quest', 'throne_of_miscellania'])), p = h.player();
  h.itemAction(p, I.LIFT_MANUAL, 'Read');
  assert.equal(p.strings.get((392 << 16) | 6), 'AMCE Lift-In-A-Box User Manual');
  assert.equal(p.items.get(I.LIFT_MANUAL) ?? 0, 0, 'reading the floor item does not move it');

  const click = h.groundClicks.find((entry) => entry.ids.includes(I.LIFT_MANUAL) && entry.clickType === 3);
  assert.ok(click, 'the manual is registered as a ground-item Read');
  const event = { player: p, groundItemId: I.LIFT_MANUAL, handled: false };
  click.fn(event);
  assert.equal(event.handled, true);
  assert.equal(p.strings.get((392 << 16) | 6), 'AMCE Lift-In-A-Box User Manual');
});

test('Royal Trouble death and lost-item paths recover the boss and the prop', () => {
  const done = new Set(['fremennik_trials', 'heroes_quest', 'throne_of_miscellania']);
  const h = harness(royal(), done), p = h.player();
  h.quest.setStage(p, 20);
  p.attributes.set('royal-trouble:royal-misc', 110);
  const bossZone = h.zoneEnter.find((entry) => entry.zone && entry.zone.minX === 2608);
  assert.ok(bossZone);
  bossZone.fn({ player: p, zone: bossZone.zone });
  assert.equal(h.spawned.length, 1);
  h.hooks.onPlayerDeath[0]({ player: p });
  assert.equal(h.removed.length, 1);
  bossZone.fn({ player: p, zone: bossZone.zone });
  assert.equal(h.spawned.length, 2, 're-entering the lair respawns the snake');

  p.attributes.set('royal-trouble:royal-misc', 80);
  h.emit('npc-dialogue:condition', { player: p, stepId: 'j11h8I' });
  assert.equal(p.items.get(I.MINING_PROP), 1, 'Donal returns a lost prop');
});

test('Throne of Miscellania: a lobster catch beside Frodi is handed in automatically', () => {
  const done = new Set(); completeThronePrerequisites(done);
  const h = harness(throne(), done), p = h.player();
  h.quest.setStage(p, 90);
  p.attributes.set('throne-of-miscellania:approval-native', 32);
  p.moveTo(new core.Location(2573, 3855, 0));

  // The fishing plugin has already landed the catch before it emits the event.
  p.items.set(I.RAW_LOBSTER, 1);
  h.emit('fishing:success', { player: p, skill: core.Skill.FISHING, itemId: I.RAW_LOBSTER });
  assert.equal(p.items.get(I.RAW_LOBSTER), 0);
  assert.equal(p.varbits.get(72), 33);
  assert.equal(p.messages.at(-1), 'You catch a lobster and give it to Fisherman Frodi.');

  // Other fish keep generic support and are not consumed.
  p.items.set(I.RAW_SHARK, 1);
  h.emit('fishing:success', { player: p, skill: core.Skill.FISHING, itemId: I.RAW_SHARK });
  assert.equal(p.items.get(I.RAW_SHARK), 1);
  assert.equal(p.varbits.get(72), 34);

  // Mining and woodcutting still use the ordinary +1 support path.
  h.emit('mining:success', { player: p, skill: core.Skill.MINING });
  h.emit('woodcutting:success', { player: p, skill: core.Skill.WOODCUTTING });
  assert.equal(p.varbits.get(72), 36);

  // Away from Frodi the catch stays in the inventory.
  p.moveTo(new core.Location(2520, 3880, 0));
  p.items.set(I.RAW_LOBSTER, 1);
  h.emit('fishing:success', { player: p, skill: core.Skill.FISHING, itemId: I.RAW_LOBSTER });
  assert.equal(p.items.get(I.RAW_LOBSTER), 1);
  assert.equal(p.varbits.get(72), 37);

  // Before the support stage nothing changes.
  h.quest.setStage(p, 80);
  h.emit('fishing:success', { player: p, skill: core.Skill.FISHING, itemId: I.RAW_LOBSTER });
  assert.equal(p.items.get(I.RAW_LOBSTER), 1);
  assert.equal(p.varbits.get(72), 37);
});

test('Throne of Miscellania: native approval survives login and legacy percentages migrate once', () => {
  const done = new Set(); completeThronePrerequisites(done);
  const h = harness(throne(), done), p = h.player();
  h.quest.setStage(p, 90);
  p.attributes.set('throne-of-miscellania:approval-native', 96);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(72), 96, 'a native save restores unchanged');
  assert.equal(p.attributes.get('throne-of-miscellania:approval-native'), 96);

  // The persisted default is -1 ("not migrated yet"), not a valid native value.
  const fresh = h.player();
  h.quest.setStage(fresh, 90);
  h.hooks.onPlayerLogin[0]({ player: fresh });
  assert.equal(fresh.varbits.get(72), 0, 'a missing attribute reads as no support');

  const defaulted = h.player();
  h.quest.setStage(defaulted, 90);
  defaulted.attributes.set('throne-of-miscellania:approval-native', -1);
  h.hooks.onPlayerLogin[0]({ player: defaulted });
  assert.equal(defaulted.varbits.get(72), 0, 'the -1 sentinel alone is no support');

  // Old saves held 0..100 percent under the legacy key. Native ceil keeps the
  // same displayed percentage without inventing progress.
  const legacy75 = h.player();
  h.quest.setStage(legacy75, 90);
  legacy75.attributes.set('throne-of-miscellania:approval-native', -1);
  legacy75.attributes.set('throne-of-miscellania:approval', 75);
  h.hooks.onPlayerLogin[0]({ player: legacy75 });
  assert.equal(legacy75.varbits.get(72), 96, 'legacy 75% becomes Quest Helper native 96');
  assert.equal(legacy75.attributes.get('throne-of-miscellania:approval-native'), 96);
  const line75 = h.line(legacy75, N.KING_VARGAS, 'Your current approval rating is [number]%.');
  assert.equal(line75.text, 'Your current approval rating is 75%.');

  const legacy32 = h.player();
  h.quest.setStage(legacy32, 90);
  legacy32.attributes.set('throne-of-miscellania:approval', 32);
  h.hooks.onPlayerLogin[0]({ player: legacy32 });
  assert.equal(legacy32.varbits.get(72), 41, 'legacy 32% becomes native 41, not a reset');
  assert.equal(legacy32.attributes.get('throne-of-miscellania:approval-native'), 41);

  // Native 0 is authoritative once written; it must not re-read the legacy key.
  const zero = h.player();
  h.quest.setStage(zero, 90);
  zero.attributes.set('throne-of-miscellania:approval-native', 0);
  zero.attributes.set('throne-of-miscellania:approval', 75);
  h.hooks.onPlayerLogin[0]({ player: zero });
  assert.equal(zero.varbits.get(72), 0, 'native zero wins over the legacy value');

  // A second login must not migrate the now-native value again.
  h.hooks.onPlayerLogin[0]({ player: legacy75 });
  assert.equal(legacy75.varbits.get(72), 96);
  h.hooks.onPlayerLogin[0]({ player: legacy32 });
  assert.equal(legacy32.varbits.get(72), 41);
});

test('Throne of Miscellania: the real ring Yes/Yes proposal earns trust', () => {
  const h = harness(throne(), new Set(['fremennik_trials', 'heroes_quest'])), p = h.player();
  h.quest.setStage(p, 10);
  p.attributes.set('throne-of-miscellania:partner', 1);
  p.attributes.set('throne-of-miscellania:bits', (7 << 10) | (1 << 13));
  p.attributes.set('throne-of-miscellania:affection', 34);
  p.items.set(I.GOLD_RING, 1);
  h.itemOnNpc(p, N.PRINCE_BRAND, I.GOLD_RING);
  assert.equal(p.items.get(I.GOLD_RING), 1, 'ring is kept until the proposal is accepted');
  h.choice(p, N.PRINCE_BRAND, 'Yes');
  h.choice(p, N.PRINCE_BRAND, 'Yes');
  assert.equal(p.items.get(I.GOLD_RING), 0);
  assert.equal(p.varbits.get(14606), 1);
  assert.equal(p.attributes.get('throne-of-miscellania:married'), 1);
  assert.equal(p.attributes.get('throne-of-miscellania:affection'), 40);
  assert.equal(h.quest.getStage(p), 20);

  const other = h.player();
  h.quest.setStage(other, 10);
  other.attributes.set('throne-of-miscellania:partner', 1);
  other.attributes.set('throne-of-miscellania:bits', (7 << 10) | (1 << 13));
  other.items.set(I.GOLD_RING, 1);
  h.itemOnNpc(other, N.PRINCE_BRAND, I.GOLD_RING);
  h.choice(other, N.PRINCE_BRAND, 'Yes');
  h.choice(other, N.PRINCE_BRAND, 'No');
  assert.equal(other.items.get(I.GOLD_RING), 1, 'refusing marriage keeps the ring');
  assert.equal(other.varbits.get(14606) ?? 0, 0, 'refusing marriage waits for the trust message');
  h.action(other, N.PRINCE_BRAND, 'nDuj-o', 'message');
  assert.equal(other.varbits.get(14606), 1);
  assert.equal(other.attributes.get('throne-of-miscellania:married') ?? 0, 0);
});

test('Throne of Miscellania: ring survives a relog before the proposal and is consumed once', () => {
  const h = harness(throne(), new Set(['fremennik_trials', 'heroes_quest'])), first = h.player();
  h.quest.setStage(first, 10);
  first.attributes.set('throne-of-miscellania:partner', 1);
  first.attributes.set('throne-of-miscellania:bits', (7 << 10) | (1 << 13));
  first.items.set(I.GOLD_RING, 1);
  h.itemOnNpc(first, N.PRINCE_BRAND, I.GOLD_RING);
  assert.equal(first.items.get(I.GOLD_RING), 1, 'pending proposal keeps the ring');
  const relogged = h.player();
  h.quest.setStage(relogged, 10);
  relogged.attributes.set('throne-of-miscellania:partner', 1);
  relogged.attributes.set('throne-of-miscellania:bits', (7 << 10) | (1 << 13));
  relogged.items.set(I.GOLD_RING, 1);
  h.itemOnNpc(relogged, N.PRINCE_BRAND, I.GOLD_RING);
  assert.equal(relogged.items.get(I.GOLD_RING), 1);
  h.choice(relogged, N.PRINCE_BRAND, 'Yes');
  assert.equal(relogged.items.get(I.GOLD_RING), 1, 'first Yes does not consume');
  h.choice(relogged, N.PRINCE_BRAND, 'Yes');
  assert.equal(relogged.items.get(I.GOLD_RING), 0, 'accepted proposal consumes once');
  assert.equal(relogged.varbits.get(14606), 1);
});

test('Throne of Miscellania: the ring message cannot award trust without consuming a ring', () => {
  const h = harness(throne(), new Set(['fremennik_trials', 'heroes_quest']));
  const setupRing = (p) => {
    h.quest.setStage(p, 10);
    p.attributes.set('throne-of-miscellania:partner', 1);
    p.attributes.set('throne-of-miscellania:bits', (7 << 10) | (1 << 13));
    p.attributes.set('throne-of-miscellania:affection', 34);
    p.items.set(I.GOLD_RING, 1);
    h.itemOnNpc(p, N.PRINCE_BRAND, I.GOLD_RING);
  };

  const declined = h.player();
  setupRing(declined);
  declined.items.set(I.GOLD_RING, 0);
  h.choice(declined, N.PRINCE_BRAND, 'Yes');
  h.choice(declined, N.PRINCE_BRAND, 'No');
  h.action(declined, N.PRINCE_BRAND, 'nDuj-o', 'message');
  assert.equal(declined.varbits.get(14606) ?? 0, 0, 'no trust without a ring');
  assert.equal(h.quest.getStage(declined), 10, 'stage unchanged without a ring');
  assert.equal(declined.attributes.get('throne-of-miscellania:affection'), 34, 'affection unchanged without a ring');

  const accepted = h.player();
  setupRing(accepted);
  h.action(accepted, N.PRINCE_BRAND, 'nDuj-o', 'message');
  assert.equal(accepted.items.get(I.GOLD_RING), 0, 'message consumes the ring');
  assert.equal(accepted.varbits.get(14606), 1);
  assert.equal(accepted.attributes.get('throne-of-miscellania:affection'), 40);
  assert.equal(h.quest.getStage(accepted), 20);
  h.action(accepted, N.PRINCE_BRAND, 'nDuj-o', 'message');
  assert.equal(accepted.attributes.get('throne-of-miscellania:affection'), 40, 'message is one-shot');
});

test('Royal Trouble: the tunnel lands on the captured walkable ledge', () => {
  const h = harness(royal(), new Set(['fremennik_trials', 'heroes_quest', 'throne_of_miscellania'])), p = h.player();
  h.quest.setStage(p, 20);
  p.attributes.set('royal-trouble:royal-misc', 90);
  h.object(p, 15188);
  assert.equal(p.getLocation().getX(), 2514);
  assert.equal(p.getLocation().getY(), 10291);
  assert.ok(p.messages.includes('You squeeze through the small hole in the wall.'));
});

test('Royal Trouble: death and relog recover one heavy box on the canonical ledge', () => {
  const done = new Set(['fremennik_trials', 'heroes_quest', 'throne_of_miscellania']);
  const h = harness(royal(), done), p = h.player();
  h.quest.setStage(p, 20);
  p.attributes.set('royal-trouble:royal-misc', 110);
  const bossZone = h.zoneEnter.find((entry) => entry.zone && entry.zone.minX === 2608);
  bossZone.fn({ player: p, zone: bossZone.zone });

  h.hooks.onNpcDeath[0]({ killer: p, npc: h.spawned[0], npcId: N.GIANT_SEA_SNAKE });
  assert.equal(p.varbits.get(2141), 120);
  assert.equal(h.ground.length, 1);
  assert.deepEqual([h.ground[0][2].getX(), h.ground[0][2].getY()], [2613, 10278]);
  assert.equal(h.spawned.length, 1, 'the earned kill does not respawn the snake');

  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(h.ground.length, 1, 'relog never duplicates the existing box');
  h.ground.length = 0;
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(h.ground.length, 1, 'an expired box is restored on the same ledge');
  assert.deepEqual([h.ground[0][2].getX(), h.ground[0][2].getY()], [2613, 10278]);

  h.ground.length = 0;
  p.items.set(I.HEAVY_BOX, 1);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(h.ground.length, 0, 'an inventory box is not duplicated');
  p.items.set(I.HEAVY_BOX, 0);
  p.bankItems.set(I.HEAVY_BOX, 1);
  h.emit('npc-dialogue:condition', { player: p, stepId: 'lAKjBl' });
  assert.equal(p.items.get(I.HEAVY_BOX) ?? 0, 0, 'a bank box blocks the guard replacement');
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(h.ground.length, 0, 'a bank box is not duplicated');
  p.bankItems.set(I.HEAVY_BOX, 0);
  h.emit('npc-dialogue:condition', { player: p, stepId: 'lAKjBl' });
  assert.equal(p.items.get(I.HEAVY_BOX), 1, 'the guard replaces a truly lost box');
  h.ground.length = 0;
  h.emit('npc-dialogue:condition', { player: p, stepId: 'lAKjBl' });
  assert.equal(p.items.get(I.HEAVY_BOX), 1, 'the guard never stacks a second box');
  p.items.set(I.HEAVY_BOX, 0);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(h.ground.length, 1, 'nothing owned restores one reachable box');
});

test('Royal Trouble: the captured heavy-box ledge is walk-reachable by cache PathFinder', () => {
  RegionManager.loadMapFiles(2613, 10278);
  const boxTile = new core.Location(2613, 10278, 0);
  assert.equal(RegionManager.blocked(boxTile, null), false, 'box tile has no terrain collision');
  const queue = {
    lastDestX: 0, lastDestY: 0,
    reset() { return queue; }, setRoute() { return queue; }, syncDestinationFlagToRoute() {},
    addCheckpoint() { return queue; }, setPathX() { return queue; }, setPathY() { return queue; },
  };
  const fake = {
    isPlayer: () => true,
    getAsPlayer: () => ({ getUsername: () => 'parity', isPlayerBot: () => false }),
    getLocation: () => new core.Location(2612, 10278, 0),
    getSize: () => 1,
    getPrivateArea: () => null,
    getMovementQueue: () => queue,
  };
  assert.equal(PathFinder.reachedObj(fake, boxTile), true,
    'a player beside the captured tile can pick the box up');
  const route = PathFinder.calculateRoute(fake, 1, 2614, 10278, 0, 0, 0, 0, false);
  assert.ok(route > 0, 'cache region pathfinding reaches the box tile');
});
