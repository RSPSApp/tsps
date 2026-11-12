// From server/: node --test tests/bottomless-milk-bucket.test.cjs (after yarn build).
//
// The bottomless milk bucket against the Wiki (Bottomless milk bucket, its Transcript): Check,
// Fill (warning, count, texts), Empty, milk and chocolate dust on it, dairy cows filling it a use
// every 7 ticks (6 with the cowbell amulet), and quests taking one use (Gertrude's Cat, Cook's
// Assistant, Skippy). A real Player, Inventory and DialogueManager, driven by the plugins' hooks.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;

const FILLED = I.BOTTOMLESS_MILK_BUCKET;
const EMPTY = I.BOTTOMLESS_MILK_BUCKET_EMPTY_;
const hooks = { actions: {}, onItem: [], onObject: [], events: {}, tasks: [] };

function fakeApi() {
  return new Proxy({
    core: { ...core, TaskManager: { submit: (task) => hooks.tasks.push(task) } },
    getTaskManager: () => ({ submit: (task) => hooks.tasks.push(task) }),
    onServerStartup: (fn) => fn(),
    onItemAction: (name, actions) => { hooks.actions[name] = { ...hooks.actions[name], ...actions }; },
    onItemOnItem: (a, b, handler) => hooks.onItem.push({ a, b, handler }),
    onItemOnObject: (item, object, handler) => hooks.onObject.push({ item, object, handler }),
    onCustomEvent: (name, fn) => (hooks.events[name] ??= []).push(fn),
    emitCustomEvent: (name, event) => { for (const fn of hooks.events[name] ?? []) fn(event); },
  }, { get: (target, key) => target[key] ?? (() => {}) });
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const api = fakeApi();
  require('../plugins/items/BottomlessMilkBucket.plugin').register(api);
  require('../plugins/objects/DairyCow.plugin').register(api);
});

let index = 2900;
function player() {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(`milk${index}`);
  p.setLocation(new core.Location(3254, 3270, 0));
  p.messages = [];
  p.sendMessage = (text) => p.messages.push(text);
  p.setRegistered(true);
  return p;
}

const slotOf = (p, id) => p.getInventory().getItems().findIndex((item) => item?.getId() === id);
const bucketIn = (p) => p.getInventory().getItems().find((item) => item && (item.getId() === FILLED || item.getId() === EMPTY));
const uses = (p) => bucketIn(p)?.getMetaValue('bottomless-milk')?.uses ?? 0;
const box = (p) => p.getDialogueManager().getCurrent()?.getText?.();

function give(p, id, amount = 1) {
  for (let i = 0; i < amount; i++) p.getInventory().add(new core.Item(id, 1), false);
}

function action(p, option) {
  const item = bucketIn(p);
  hooks.actions[item.getDefinition().getName()][option]({ player: p, item, itemId: item.getId(), slot: slotOf(p, item.getId()) });
}

function use(p, usedId, withId) {
  const usedSlot = slotOf(p, usedId);
  const withSlot = slotOf(p, withId);
  const event = {
    player: p, handled: false,
    usedItem: p.getInventory().forSlot(usedSlot), usedItemId: usedId, usedItemSlot: usedSlot,
    usedWithItem: p.getInventory().forSlot(withSlot), usedWithItemId: withId, usedWithItemSlot: withSlot,
  };
  const names = [event.usedItem.getDefinition().getName(), event.usedWithItem.getDefinition().getName()];
  for (const hook of hooks.onItem) {
    if (event.handled) break;
    if ((names[0] === hook.a && names[1] === hook.b) || (names[0] === hook.b && names[1] === hook.a)) hook.handler(event);
  }
  return event;
}

/** The client's option resume: one-based child index on the options widget. */
function choose(p, option) {
  assert.ok(p.getDialogueManager().getCurrent() instanceof OptionDialogue, 'an option dialogue is open');
  assert.equal(p.getDialogueManager().handleResume(OptionDialogue.OPTIONS_WIDGET_ID, option), true);
}

const advance = (p) => p.getDialogueManager().advance();

test('Check on the empty bucket, then Fill: the warning, Yes, one bucket poured, a bucket back', () => {
  const p = player();
  give(p, EMPTY);
  action(p, 'Check');
  assert.equal(box(p), 'Your milk bucket is currently empty.');
  action(p, 'Fill');
  assert.equal(p.messages.at(-1), "You don't have any milk to fill your bottomless milk bucket with.");
  give(p, I.BUCKET_OF_MILK);
  action(p, 'Fill');
  assert.match(box(p), /ALL<\/col> remaining milk inside it will be <col=7f0000>LOST/);
  advance(p);
  assert.equal(p.getDialogueManager().getCurrent().getTitle(), 'Do you wish to proceed?');
  choose(p, 1);
  assert.equal(bucketIn(p).getId(), FILLED);
  assert.equal(uses(p), 1);
  assert.equal(p.getInventory().getAmount(I.BUCKET_OF_MILK), 0);
  assert.equal(p.getInventory().getAmount(I.BUCKET), 1);
  assert.equal(box(p), 'You fill your bottomless milk bucket with a single bucket of regular milk. Your bottomless milk bucket now contains a total of 1 use.');
  action(p, 'Check');
  assert.equal(box(p), 'Your bottomless milk bucket is currently holding 1 use of regular milk.');
});

test('No on the warning pours nothing; milk used on a filled bucket asks how much when there are several', () => {
  const p = player();
  give(p, EMPTY);
  give(p, I.BUCKET_OF_MILK, 3);
  use(p, I.BUCKET_OF_MILK, EMPTY);
  advance(p);
  choose(p, 2);
  assert.equal(bucketIn(p).getId(), EMPTY);
  assert.equal(p.getInventory().getAmount(I.BUCKET_OF_MILK), 3);
  bucketIn(p).setId(FILLED).setMetaValue('bottomless-milk', { uses: 5, type: I.BUCKET_OF_MILK });
  assert.equal(use(p, I.BUCKET_OF_MILK, FILLED).handled, true);
  p.getEnteredAmountAction().execute(2);
  assert.equal(uses(p), 7);
  assert.equal(p.getInventory().getAmount(I.BUCKET_OF_MILK), 1);
  assert.equal(p.getInventory().getAmount(I.BUCKET), 2);
  assert.equal(box(p), 'You fill your bottomless milk bucket with 2 buckets of regular milk. Your bottomless milk bucket now contains a total of 7 uses.');
});

test('one kind at a time, 10,000 at most', () => {
  const p = player();
  give(p, FILLED);
  bucketIn(p).setMetaValue('bottomless-milk', { uses: 4, type: I.BUCKET_OF_MILK });
  give(p, I.CHOCOLATEY_MILK);
  use(p, I.CHOCOLATEY_MILK, FILLED);
  assert.equal(p.messages.at(-1), "You don't have any more of this type of milk to fill it with.");
  assert.equal(uses(p), 4);
  bucketIn(p).setMetaValue('bottomless-milk', { uses: 10000, type: I.BUCKET_OF_MILK });
  give(p, I.BUCKET_OF_MILK);
  action(p, 'Fill');
  assert.equal(p.messages.at(-1), 'Your bottomless milk bucket is... full.');
  assert.equal(uses(p), 10000);
});

test('Empty: the discard warning, the acknowledgement, and the bucket is empty again', () => {
  const p = player();
  give(p, FILLED);
  bucketIn(p).setMetaValue('bottomless-milk', { uses: 12, type: I.MILKY_MIXTURE });
  action(p, 'Check');
  assert.equal(box(p), 'Your bottomless milk bucket is currently holding 12 uses of creamy milk.');
  action(p, 'Empty');
  advance(p);
  assert.equal(p.getDialogueManager().getCurrent().getTitle(), 'Proceed to discard the contents?');
  assert.deepEqual(p.getDialogueManager().getCurrent().getOptions(), ["Yes - I acknowledge I'll lose all milk within the bucket.", "No - don't proceed."]);
  choose(p, 1);
  assert.equal(bucketIn(p).getId(), EMPTY);
  assert.equal(bucketIn(p).getMetaValue('bottomless-milk'), undefined);
  assert.equal(box(p), 'You discard the contents of your bottomless milk bucket.');
});

test('unnoted chocolate dust on regular milk makes one chocolatey milk for one use', () => {
  const p = player();
  give(p, FILLED);
  bucketIn(p).setMetaValue('bottomless-milk', { uses: 1, type: I.BUCKET_OF_MILK });
  give(p, I.CHOCOLATE_DUST);
  assert.equal(use(p, I.CHOCOLATE_DUST, FILLED).handled, true);
  assert.equal(p.getInventory().getAmount(I.CHOCOLATEY_MILK), 1);
  assert.equal(p.getInventory().getAmount(I.CHOCOLATE_DUST), 0);
  assert.equal(bucketIn(p).getId(), EMPTY, 'the last use empties it');
});

function milkCow(p) {
  hooks.tasks.length = 0;
  hooks.onObject.find((h) => h.item === 'Bottomless milk bucket (empty)' && h.object === 'Dairy cow').handler({ player: p });
  const task = hooks.tasks.at(-1);
  task?.setRunning(true); // as TaskManager.submit does
  return task;
}

test('a dairy cow fills it a use every 7 ticks, 6 with the cowbell amulet, until it is full', () => {
  const p = player();
  give(p, EMPTY);
  const task = milkCow(p);
  for (let tick = 1; tick <= 14; tick++) task.tick();
  assert.equal(uses(p), 2, '14 ticks, two uses');
  assert.equal(bucketIn(p).getMetaValue('bottomless-milk').type, I.BUCKET_OF_MILK);

  const fast = player();
  give(fast, EMPTY);
  fast.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I.COWBELL_AMULET, 1));
  const quick = milkCow(fast);
  for (let tick = 1; tick <= 12; tick++) quick.tick();
  assert.equal(uses(fast), 2, '12 ticks with the cowbell, two uses');

  bucketIn(p).setMetaValue('bottomless-milk', { uses: 9999, type: I.BUCKET_OF_MILK });
  const last = milkCow(p);
  for (let tick = 1; tick <= 7; tick++) last.tick();
  assert.equal(uses(p), 10000);
  assert.equal(p.messages.at(-1), 'Your bottomless milk bucket, surprisingly, is full.');
  assert.equal(last.isRunning(), false);
  milkCow(p);
  assert.equal(p.messages.at(-1), 'Your bottomless milk bucket, surprisingly, is full.');
});

test('moving away stops the milking', () => {
  const p = player();
  give(p, EMPTY);
  const task = milkCow(p);
  for (let tick = 1; tick <= 7; tick++) task.tick();
  p.setLocation(new core.Location(3255, 3270, 0));
  for (let tick = 1; tick <= 14; tick++) task.tick();
  assert.equal(uses(p), 1);
});

test('quests take one use: holds/spend events, Gertrude\'s Cat on Fluffs', () => {
  const p = player();
  give(p, FILLED);
  bucketIn(p).setMetaValue('bottomless-milk', { uses: 2, type: I.BUCKET_OF_MILK });
  const holds = { player: p, type: I.BUCKET_OF_MILK, holds: false };
  hooks.events['bottomless-milk:holds'][0](holds);
  assert.equal(holds.holds, true);
  const cure = { player: p, type: I.HANGOVER_CURE, holds: false };
  hooks.events['bottomless-milk:holds'][0](cure);
  assert.equal(cure.holds, false, 'regular milk is not a hangover cure');

  // Gertrude's Cat, with the quest's real item-on-NPC handler.
  const quests = {};
  const stages = new Map([[p, 2]]); // STAGE_PAID_BOY
  const api = fakeApi();
  api.onItemOnNpc = (fn) => { quests.onNpc = fn; };
  const register = require('../plugins/quests/QuestRuntime');
  const original = register.registerQuest;
  register.registerQuest = (_api, def) => ({ ...def, getStage: (pl) => stages.get(pl) ?? 0, setStage: (pl, s) => stages.set(pl, s) });
  try {
    require('../plugins/quests/quests/GertrudesCat.Quest')(api);
  } finally {
    register.registerQuest = original;
  }
  const fluffs = core.NpcIdentifiers.GERTRUDES_CAT_2;
  const event = { player: p, npcId: fluffs, target: { getId: () => fluffs }, item: bucketIn(p), itemId: FILLED, slot: slotOf(p, FILLED), handled: false };
  quests.onNpc(event);
  assert.equal(event.handled, true);
  assert.equal(uses(p), 1, 'one use, not the whole bucket');
  assert.equal(p.messages.at(-1), 'Fluffs laps up the milk.');
  assert.equal(stages.get(p), 3);
  assert.equal(p.getInventory().getAmount(I.BUCKET), 0, 'no empty bucket comes back');
});

test('the uses and the kind survive a real save into a fresh player (PlayerSave.fromPlayer -> applyToPlayer)', () => {
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const p = player();
  give(p, FILLED);
  bucketIn(p).setMetaValue('bottomless-milk', { uses: 321, type: I.HANGOVER_CURE });
  const saved = PlayerSave.fromPlayer(p);
  const fresh = player();
  saved.applyToPlayer(fresh);
  assert.equal(bucketIn(fresh).getId(), FILLED);
  assert.deepEqual(bucketIn(fresh).getMetaValue('bottomless-milk'), { uses: 321, type: I.HANGOVER_CURE });
  action(fresh, 'Check');
  assert.equal(box(fresh), 'Your bottomless milk bucket is currently holding 321 uses of hangover cure.');
});

test("Cook's Assistant: a bucket of regular milk counts as the milk, and the hand-in takes one use", () => {
  const p = player();
  give(p, FILLED);
  bucketIn(p).setMetaValue('bottomless-milk', { uses: 3, type: I.BUCKET_OF_MILK });
  const api = fakeApi();
  let condition;
  api.onNpcDialogueCondition = (fn) => { condition = fn; };
  const register = require('../plugins/quests/QuestRuntime');
  const original = register.registerQuest;
  register.registerQuest = (_api, def) => ({ ...def, getStage: () => 1, setStage: () => {} });
  try {
    require('../plugins/quests/quests/CooksAssistant.Quest')(api);
  } finally {
    register.registerQuest = original;
  }
  const cook = core.NpcIdentifiers.COOK_7;
  assert.equal(condition({ npcId: cook, player: p, text: 'If the player has the ingredients:' }), true);
  const line = { npcId: cook, player: p, text: "Here's a bucket of milk." };
  const handlers = hooks.events['npc-dialogue:line'];
  handlers[handlers.length - 1](line);
  assert.equal(line.skip, undefined, 'the milk line is said');
  line.after();
  assert.equal(uses(p), 2);
  assert.equal(p.getAttribute('cooks-assistant:delivered-ingredients') & 1, 1, 'the milk is delivered');
});
