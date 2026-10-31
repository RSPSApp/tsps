const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

const ARETHA = 7042;
const KEY_MASTER = 12599;
const SPADE = 952;
const SOUL_JOURNEY = 19637;
const DAMAGED_SOUL_BEARER = 19636;
const SOUL_BEARER = 19634;
const REPAIR_MESSAGE = 'VKnY1K';

function setup() {
  const hooks = { custom: new Map(), conditions: [], objects: [], itemActions: [], npcs: new Map() };
  const transcripts = [];
  const tasks = [];
  let tick = 0;
  const core = {
    ...PluginManager.getCoreApi(),
    CountdownTask: class {
      constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); }
    },
    TaskManager: {
      submit(task) { task.due = tick + task.ticks; tasks.push(task); },
      cancelTasks() {},
    },
  };
  const realStartTranscript = runtime.startTranscript;
  runtime.startTranscript = (api, player, npcId, page, variant) => {
    transcripts.push({ npcId, page, variant });
    return true;
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(name, actions) { hooks.npcs.set(name, actions); },
    onObjectInteraction(name, actions) { hooks.objects.push({ name, actions }); },
    onItemAction(name, actions) { hooks.itemActions.push({ name, actions }); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) {
      for (const fn of hooks.custom.get(name) ?? []) fn(event);
    },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  try {
    require('../plugins/quests/quests/BearYourSoul.Quest')(api);
  } finally {
    runtime.startTranscript = realStartTranscript;
  }
  const quest = runtime.getRegisteredQuests().at(-1);

  const attrs = new Map();
  const items = new Map();
  const varbits = new Map();
  const messages = [];
  const animations = [];
  const sounds = [];
  const jingles = [];
  let dialogueChain = null;
  let full = false;
  let location = core.Location ? new core.Location(0, 0, 0) : { x: 0, y: 0, z: 0 };
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig() { return sender; },
    sendString() { return sender; },
    sendInterface() { return sender; },
    sendInterfaceRemoval() { return sender; },
    sendInterfaceDisplayState() { return sender; },
    sendInterfaceScript() { return sender; },
    closeSubInterface() { return sender; },
    sendJingle(id) { jingles.push(id); return sender; },
    sendSound(id) { sounds.push(id); return sender; },
    sendItemOnInterfaces() { return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getUsername: () => 'bear-test',
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    getLocation: () => location,
    moveTo: (value) => { location = value; },
    performAnimation(animation) { animations.push(animation.getId?.() ?? animation); },
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      isFull: () => full,
      getFreeSlots: () => (full ? 0 : 28),
      full() { messages.push('Not enough space in your inventory.'); return this; },
      adds(id, count) { items.set(id, (items.get(id) ?? 0) + count); return this; },
      deleteNumber(id, count) { items.set(id, Math.max(0, (items.get(id) ?? 0) - count)); return true; },
      get: () => undefined,
    }),
    getBanks: () => [],
    isRegistered: () => true,
    getDialogueManager: () => ({
      startDialogues(chain) { dialogueChain = chain; },
      reset() { dialogueChain = null; },
      getCurrent: () => dialogueChain,
    }),
    getFrameUpdater: () => undefined,
  };
  const object = (name, option, extra = {}) => {
    const entry = hooks.objects.find((candidate) => candidate.name === name);
    return entry.actions[option]({ player, location, handled: false, ...extra });
  };
  const item = (name, option, extra = {}) => {
    const entry = hooks.itemActions.find((candidate) => candidate.name === name);
    return entry.actions[option]({ player, handled: false, ...extra });
  };
  const custom = (name, extra = {}) => {
    const event = { player, ...extra };
    api.emitCustomEvent(name, event);
    return event;
  };
  const keyMasterTalk = () => hooks.npcs.get('Key Master')['Talk-to']({ player, handled: false });
  const advance = () => {
    tick++;
    for (const task of [...tasks]) {
      if (!task.done && task.due <= tick) {
        task.done = true;
        task.run();
      }
    }
  };
  return {
    api, core, quest, hooks, transcripts, attrs, items, varbits, messages, player,
    animations, sounds, jingles,
    get dialogueChain() { return dialogueChain; },
    setLocation(x, y, z = 0) { location = core.Location ? new core.Location(x, y, z) : { x, y, z }; },
    setFull(value) { full = value; },
    object, item, custom, keyMasterTalk, advance,
    stage: () => quest.getStage(player),
  };
}

test('Bear Your Soul: library book, Aretha, crypt dig and Key Master repair', () => {
  const h = setup();

  // No bookshelf outside the Arceuus Library.
  h.setLocation(3200, 3200, 0);
  h.object('Bookshelf', 'Search');
  assert.equal(h.items.get(SOUL_JOURNEY) ?? 0, 0);

  // The unread book comes from a library shelf once, with the pickup animation
  // and an item box on the next tick.
  h.setLocation(1632, 3808, 0);
  assert.equal(h.object('Bookshelf', 'Search'), true);
  assert.equal(h.items.get(SOUL_JOURNEY), 1);
  assert.ok(h.animations.includes(832));
  h.advance();
  const foundBox = h.dialogueChain.getDialogues().get(0);
  assert.equal(foundBox.getItemId(), SOUL_JOURNEY);
  assert.match(foundBox.getText(), /You find:.*The Journey of Souls, by Aretha/);
  h.object('Bookshelf', 'Search');
  assert.equal(h.items.get(SOUL_JOURNEY), 1);

  // Reading opens the book; the stage and hint only land when it is closed.
  assert.equal(h.stage(), 0);
  h.item('Soul Journey', 'Read', { itemId: SOUL_JOURNEY, option: 'Read' });
  assert.ok(h.animations.includes(1350));
  assert.equal(h.stage(), 0);
  h.custom('interface:closed', { interfaceId: 392 });
  assert.equal(h.stage(), 1);
  assert.equal(h.varbits.get(5078), 1);
  const readBox = h.dialogueChain.getDialogues().get(0);
  assert.equal(readBox.getItemId(), SOUL_JOURNEY);
  assert.match(readBox.getText(), /artefact being buried in Kourend/);
  h.item('Soul Journey', 'Read', { itemId: SOUL_JOURNEY, option: 'Read' });
  h.custom('interface:closed', { interfaceId: 392 });
  assert.equal(h.stage(), 1);

  // Aretha's book option is visible after reading, and stays visible after the
  // directions until the bearer is actually dug up.
  const condition = (text) => h.hooks.conditions[0]({ npcId: ARETHA, player: h.player, text });
  assert.equal(condition('If the player has not yet found the Soul bearer:'), true);
  assert.equal(condition('If the player has started/completed the Bear Your Soul miniquest:'), false);
  const directions = h.custom('npc-dialogue:line', {
    npcId: ARETHA, text: "Now, we buried the artefact in the crypt of the Arceuus church.",
  });
  assert.equal(h.stage(), 1);
  assert.equal(typeof directions.before, 'function');
  directions.before();
  assert.equal(h.stage(), 2);
  assert.equal(h.varbits.get(5078), 2);
  assert.equal(condition('If the player has not yet found the Soul bearer:'), true);

  // Digging only works in the crypt, and only once while the bearer is held.
  h.setLocation(3200, 3200, 0);
  h.item('Spade', 'Dig', { itemId: SPADE, option: 'Dig' });
  assert.equal(h.items.get(DAMAGED_SOUL_BEARER) ?? 0, 0);
  h.setLocation(1699, 3794, 0);
  assert.equal(h.item('Spade', 'Dig', { itemId: SPADE, option: 'Dig' }), true);
  assert.equal(h.items.get(DAMAGED_SOUL_BEARER), 1);
  assert.ok(h.animations.includes(830));
  assert.ok(h.sounds.includes(1470));
  const digBox = h.dialogueChain.getDialogues().get(0);
  assert.equal(digBox.getItemId(), DAMAGED_SOUL_BEARER);
  assert.equal(digBox.getText(), 'You have found the soul bearer.');
  h.item('Spade', 'Dig', { itemId: SPADE, option: 'Dig' });
  assert.equal(h.items.get(DAMAGED_SOUL_BEARER), 1);
  assert.equal(condition('If the player has not yet found the Soul bearer:'), false);
  assert.equal(condition('If the player has started/completed the Bear Your Soul miniquest:'), true);

  // Aretha's repaired-bearer transcript lines become the damaged-bearer words.
  const first = h.custom('npc-dialogue:line', {
    npcId: ARETHA, text: "About the soul bearer again... I got it repaired by the Key Master. Thanks for your help.",
  });
  assert.match(first.text, /I've dug it up, but it's damaged\./);
  const reply = h.custom('npc-dialogue:line', {
    npcId: ARETHA, text: 'Use it carefully, traveller, and respect the souls.',
  });
  assert.match(reply.text, /paid attention to my book/);
  assert.equal(typeof reply.after, 'function');
  reply.after();

  // The damaged bearer selects the Key Master's repair conversation.
  assert.equal(h.keyMasterTalk(), true);
  assert.deepEqual(h.transcripts.at(-1), {
    npcId: KEY_MASTER, page: 'Key Master', variant: 'during-bear-your-soul',
  });
  assert.equal(h.quest.isComplete(h.player), false);

  // The repair message swaps the item, plays the live sound, and finishes the
  // miniquest without the normal jingle, scroll or "Congratulations" line.
  const repair = h.custom('npc-dialogue:action', { npcId: KEY_MASTER, stepId: REPAIR_MESSAGE, kind: 'message' });
  assert.equal(h.items.get(DAMAGED_SOUL_BEARER), 0);
  assert.equal(h.items.get(SOUL_BEARER), 1);
  assert.equal(repair.box.items[0], SOUL_BEARER);
  assert.ok(h.sounds.includes(1595));
  assert.equal(h.jingles.length, 0);
  assert.equal(h.messages.some((message) => /Congratulations/.test(message)), false);
  assert.equal(h.stage(), 3);
  assert.equal(h.varbits.get(5078), 3);
  assert.equal(h.quest.isComplete(h.player), true);
  h.custom('npc-dialogue:action', { npcId: KEY_MASTER, stepId: REPAIR_MESSAGE, kind: 'message' });
  assert.equal(h.items.get(SOUL_BEARER), 1);
  assert.equal(h.keyMasterTalk(), false);

  // A lost soul bearer can be dug up and repaired again.
  h.items.set(SOUL_BEARER, 0);
  assert.equal(h.item('Spade', 'Dig', { itemId: SPADE, option: 'Dig' }), true);
  assert.equal(h.items.get(DAMAGED_SOUL_BEARER), 1);
  h.custom('npc-dialogue:action', { npcId: KEY_MASTER, stepId: REPAIR_MESSAGE, kind: 'message' });
  assert.equal(h.items.get(SOUL_BEARER), 1);
  assert.equal(h.items.get(DAMAGED_SOUL_BEARER), 0);

  // A full inventory does not lose the dig or the shelf search.
  h.items.clear();
  h.setFull(true);
  h.setLocation(1699, 3794, 0);
  h.item('Spade', 'Dig', { itemId: SPADE, option: 'Dig' });
  assert.equal(h.items.get(DAMAGED_SOUL_BEARER) ?? 0, 0);
  assert.ok(h.messages.includes('Not enough space in your inventory.'));
  h.setFull(false);
});

test('Bear Your Soul: journal and quest metadata', () => {
  const h = setup();
  assert.equal(h.quest.name, 'Bear Your Soul');
  assert.equal(h.quest.key, 'bear_your_soul');
  assert.equal(h.quest.varbitId, 5078);
  assert.equal(h.quest.varpId, 695);
  assert.equal(h.quest.completionValue, 3);
  assert.match(h.quest.buildJournal(h.player).join(' '), /Journey of Souls/);
  h.quest.setStage(h.player, 3);
  assert.match(h.quest.buildJournal(h.player).join(' '), /MINIQUEST COMPLETE!/);

  const pages = require('../plugins/quests/data/bear-your-soul-book.json');
  assert.equal(pages.length, 9);
  for (const spread of pages) {
    for (let line = 0; line < 15; line++) {
      assert.equal(typeof spread[44 + line], 'string');
      assert.equal(typeof spread[60 + line], 'string');
    }
  }
  assert.equal(pages[0][44], 'If a culture does not respect');
  assert.equal(pages[0][58], 'privilege to study the soul');
  assert.equal(pages[1][44], '<col=7f0000>The River</col>');
  assert.equal(pages[2][60], "<col=7f0000>The Guardian's Keeper</col>");
  assert.equal(pages[4][44], '<col=7f0000>The Soul Altar</col>');
  assert.equal(pages[5][60], '<col=7f0000>The Ensouled</col>');
  assert.equal(pages[6][60], '<col=7f0000>The Soul Bearer</col>');
  assert.equal(pages[8][60], 'an ensouled head, exerting its');
});
