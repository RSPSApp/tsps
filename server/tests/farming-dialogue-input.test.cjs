// Farming menus through native option resumes with every plugin loaded and real game objects.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { PlayerStatus } = require('../dist/game/model/PlayerStatus');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
let core, Data, Patches;
let actorIndex = 200;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  for (const [x, y] of [[1802, 3502], [2435, 3414]]) core.RegionManager.loadMapFiles(x, y);
  Data = require('../plugins/skills/farming/Data.Farming');
  Patches = require('../plugins/skills/farming/Patches.Farming');
  Data.initializeFarmingData();
});

function actor(t, x = 1802, y = 3502) {
  const transport = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(transport));
  p.setUsername(`farmenu${actorIndex}`);
  p.setIndex(actorIndex++);
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, 0));
  p.getSkillManager().setMaxLevels(core.Skill.FARMING, 99, false).setCurrentLevels(core.Skill.FARMING, 99, false);
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', text => { messages.push(text); return p.getPacketSender(); });
  const connection = new ClientConnection(transport);
  connection.player = p;
  return { p, connection, messages };
}

async function input(f, ...packets) {
  await f.connection.dispatch(packets);
  f.connection.processTurnPackets();
  for (let i = 0; i < 3; i++) {
    core.TaskManager.process();
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
  }
}

const resume = (f, n, widgetId = core.OptionDialogue.OPTIONS_WIDGET_ID) =>
  input(f, { type: 'dialogue_continue', widgetId, childIndex: n });
const options = f => f.p.getDialogueManager().getCurrent()?.getOptions?.() ?? [];

test('native choices 1 through 4 execute the corresponding displayed action exactly once', async t => {
  for (let n = 1; n <= 4; n++) {
    const f = actor(t), selected = [];
    Patches.choose(f.p, [0, 1, 2, 3].map(i => [`Choice ${i + 1}`, () => selected.push(i)]));
    await resume(f, n);
    await resume(f, n);
    assert.deepEqual(selected, [n - 1]);
  }
});

test('a one-action menu displays Cancel and the native first choice runs its action', async t => {
  const f = actor(t);
  let count = 0;
  Patches.choose(f.p, [['Only action', () => count++]]);
  assert.deepEqual(options(f), ['Only action', 'Cancel']);
  await resume(f, 1);
  await resume(f, 1);
  assert.equal(count, 1);
  Patches.choose(f.p, [['Only action', () => count++]]);
  await resume(f, 2);
  assert.equal(count, 1);
});

test('More options reaches the next page and wraps without changing displayed indices', async t => {
  const f = actor(t), selected = [];
  const entries = Array.from({ length: 6 }, (_, i) => [`Action ${i + 1}`, () => selected.push(i)]);
  Patches.choose(f.p, entries);
  assert.equal(options(f)[4], 'More options');
  await resume(f, 5);
  assert.deepEqual(options(f), ['Action 5', 'Action 6', 'More options']);
  await resume(f, 3);
  assert.equal(options(f)[0], 'Action 1');
  await resume(f, 5);
  await resume(f, 2);
  assert.deepEqual(selected, [5]);
});

test('invalid or closed/replaced menus cannot execute a saved Farming action', async t => {
  const f = actor(t);
  let count = 0;
  const open = () => Patches.choose(f.p, [['Run action', () => count++], ['Cancel', () => {}]]);
  open();
  for (const n of [0, 3, 6]) await resume(f, n);
  await resume(f, 1, (231 << 16) | 5);
  assert.equal(count, 0);
  f.p.getPacketSender().sendInterfaceRemoval();
  await resume(f, 1);
  assert.equal(count, 0);
  open();
  f.p.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, 'Another conversation.')));
  await resume(f, 1);
  assert.equal(count, 0);
});

test('dead, trading or newly placed players cannot accept a pending Farming action', async t => {
  for (const state of ['dead', 'trade', 'placement']) {
    const f = actor(t);
    let count = 0;
    Patches.choose(f.p, [['Run action', () => count++], ['Cancel', () => {}]]);
    if (state === 'dead') f.p.setHitpoints(0);
    else if (state === 'trade') f.p.setStatus(PlayerStatus.TRADING);
    else f.p.moveTo(new core.Location(1802, 3502, 0));
    await resume(f, 1);
    assert.equal(count, 0, state);
    if (state === 'trade') assert.equal(f.p.getStatus(), PlayerStatus.TRADING);
  }
});

test('legacy widget actions use the same one-based Farming choices without falling through', async t => {
  for (let n = 1; n <= 4; n++) {
    const f = actor(t), selected = [];
    Patches.choose(f.p, [1, 2, 3, 4].map(i => [`Choice ${i}`, () => selected.push(i)]));
    await input(f, { type: 'widget_action', widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID,
      groupId: core.OptionDialogue.OPTIONS_WIDGET_ID >>> 16, childId: 1, buttonNum: n, slot: -1 });
    assert.deepEqual(selected, [n]);
  }
});

test('empty menus do not create a dialogue', t => {
  const f = actor(t);
  Patches.choose(f.p, []);
  assert.equal(f.p.getDialogueManager().getCurrent(), undefined);
});

test('an unrelated widget action cannot fall through into the current Farming choice', async t => {
  const f = actor(t);
  let count = 0;
  Patches.choose(f.p, [['Run action', () => count++], ['Cancel', () => {}]]);
  const menu = f.p.getDialogueManager().getCurrent();
  await input(f, { type: 'widget_action', widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID - 1,
    groupId: core.OptionDialogue.OPTIONS_WIDGET_ID >>> 16, childId: 0, buttonNum: 2 });
  assert.equal(count, 0);
  assert.equal(f.p.getDialogueManager().getCurrent(), menu);
});

for (const [choice, name] of [[1, 'Golovanova'], [2, 'Bologano'], [3, 'Logavano']]) {
  test(`native Seed table -> ${name} -> Take 100 gives the selected seeds`, async t => {
    const f = actor(t);
    await input(f, { type: 'object_option', id: core.ObjectIdentifiers.SEED_TABLE, x: 1802, y: 3503, action: 'Search' });
    assert.equal(options(f).length, 3, JSON.stringify({ id: core.ObjectIdentifiers.SEED_TABLE,
      busy: f.p.busy(), placement: f.p.isNeedsPlacement(), messages: f.messages, location: f.p.getLocation() }));
    await resume(f, choice);
    assert.deepEqual(options(f), ['Take 100', 'Take 1000', 'Take 10000']);
    await resume(f, 1);
    assert.equal(f.p.getInventory().getAmount(Data.itemId(`${name} seed`)), 100);
    await resume(f, 1);
    assert.equal(f.p.getInventory().getAmount(Data.itemId(`${name} seed`)), 100);
  });
}

test('full inventory and walking away prevent native seed collection', async t => {
  for (const full of [false, true]) {
    const f = actor(t);
    if (full) while (f.p.getInventory().getFreeSlots()) f.p.getInventory().add(new core.Item(Data.itemId('Rake'), 1), false);
    await input(f, { type: 'object_option', id: core.ObjectIdentifiers.SEED_TABLE, x: 1802, y: 3503, action: 'Search' });
    assert.equal(options(f).length, 3);
    await resume(f, 3);
    assert.deepEqual(options(f), ['Take 100', 'Take 1000', 'Take 10000']);
    if (!full) f.p.setLocation(new core.Location(1815, 3502, 0));
    await resume(f, 1);
    assert.equal(f.p.getInventory().getAmount(Data.itemId('Logavano seed')), 0);
  }
});

test('all three quantity choices work, with the existing 10,000-seed limit', async t => {
  for (const [choice, count] of [[1, 100], [2, 1000], [3, 10000]]) {
    const f = actor(t);
    await input(f, { type: 'object_option', id: core.ObjectIdentifiers.SEED_TABLE, x: 1802, y: 3503, action: 'Search' });
    await resume(f, 3);
    await resume(f, choice);
    assert.equal(f.p.getInventory().getAmount(Data.itemId('Logavano seed')), count);
  }
  const f = actor(t), seed = Data.itemId('Logavano seed');
  f.p.getInventory().add(new core.Item(seed, 9999), false);
  await input(f, { type: 'object_option', id: core.ObjectIdentifiers.SEED_TABLE, x: 1802, y: 3503, action: 'Search' });
  await resume(f, 3);
  await resume(f, 3);
  assert.equal(f.p.getInventory().getAmount(seed), 10000);
});

test('seed collection uses the last free slot and does not change the other 27 items', async t => {
  const f = actor(t), rake = Data.itemId('Rake');
  for (let i = 0; i < 27; i++) f.p.getInventory().add(new core.Item(rake, 1), false);
  await input(f, { type: 'object_option', id: core.ObjectIdentifiers.SEED_TABLE, x: 1802, y: 3503, action: 'Search' });
  await resume(f, 3);
  await resume(f, 1);
  assert.equal(f.p.getInventory().getAmount(Data.itemId('Logavano seed')), 100);
  assert.equal(f.p.getInventory().getAmount(rake), 27);
  assert.equal(f.p.getInventory().getFreeSlots(), 0);
});

test('native gardener Pay -> Yes takes payment and protects the planted tree once', async t => {
  const f = actor(t, 2435, 3415);
  const patch = Data.CACHE.patches.find(p => p.x === 2435 && p.y === 3414);
  const state = Patches.stateFor(f.p, patch);
  Object.assign(state, { crop: 'MAGIC', stage: 0, status: 'growing', checked: false, protected: false, nextAt: Date.now() + 3600000 });
  const coconutNote = core.ItemDefinition.forId(Data.itemId('Coconut')).getNoteId();
  f.p.getInventory().add(new core.Item(coconutNote, 25), false);
  const gardener = core.NPC.create(core.NpcIdentifiers.PRISSY_SCILLA, new core.Location(2436, 3415, 0));
  core.World.getNpcs().add(gardener);
  t.after(() => core.World.getNpcs().remove(gardener));
  const pay = gardener.getCurrentDefinition(f.p).getActions().findIndex(a => a?.toLowerCase() === 'pay') + 1;
  assert.ok(pay > 0);
  await input(f, { type: 'npc_option', index: gardener.getIndex(), clickType: pay });
  // rsprox captures: the gardener asks "Pay 25 coconuts?" (Yes./No./Yes and don't ask again.).
  assert.equal(f.p.getDialogueManager().getCurrent().getTitle(), 'Pay 25 coconuts?');
  assert.deepEqual(options(f), ['Yes.', 'No.', "Yes and don't ask again."]);
  await resume(f, 1);
  assert.equal(state.protected, true);
  assert.equal(f.p.getInventory().getAmount(coconutNote), 0);
  assert.match(f.p.getDialogueManager().getCurrent().getText(), /^That'll do nicely, (sir|madam)\. Leave it with me/);
});

const GARDENERS_ATTRIBUTE = 'quest.fairytale-i-growing-pains:gardeners';
const GARDENER_QUESTION = 'Are you a member of the Group of Advanced Gardeners?';
function questGardener(t, id) {
  const f = actor(t, 2435, 3415);
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests()
    .find(quest => quest.key === 'fairytale_i_growing_pains');
  quest.setStage(f.p, quest.startedValue);
  const gardeners = [];
  f.setGardener = id => {
    f.gardener = core.NPC.create(id, new core.Location(2436, 3415, 0));
    core.World.getNpcs().add(f.gardener);
    gardeners.push(f.gardener);
  };
  f.setGardener(id);
  f.names = [];
  const sender = f.p.getPacketSender(), sendString = sender.sendString.bind(sender);
  t.mock.method(sender, 'sendString', (text, widget) => {
    if (widget === (231 << 16 | 4)) f.names.push(text);
    return sendString(text, widget);
  });
  t.after(() => { f.p.closeInterruptibleInterfaces(); gardeners.forEach(npc => core.World.getNpcs().remove(npc)); });
  f.talk = () => input(f, { type: 'npc_option', index: f.gardener.getIndex(), clickType: 1 });
  f.asked = () => String(f.p.getAttribute(GARDENERS_ATTRIBUTE) ?? '').split(',').filter(Boolean).map(Number);
  return f;
}
async function gardenerChoice(f, text) {
  const menu = MultiChatboxPrompt.getPending(f.p);
  assert.ok(menu?.options.includes(text), JSON.stringify(menu));
  await input(f, { type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    childIndex: menu.options.indexOf(text) + 1 });
}
async function gardenerContinue(f) {
  const group = f.p.getPacketSender().getChatboxGroupId();
  await input(f, { type: 'dialogue_continue', widgetId: group << 16 | 5, childIndex: -1 });
}
async function finishGardener(f) {
  for (let n = 0; n < 40 && f.p.getDialogueManager().getCurrent(); n++) await gardenerContinue(f);
  assert.equal(f.p.getDialogueManager().getCurrent(), undefined, 'the source branch completes');
}

test('five native quest gardener conversations use the actual actor name and credit only a completed answer', async t => {
  const ids = [core.NpcIdentifiers.FRIZZY_SKERNIP, core.NpcIdentifiers.ELSTAN,
    core.NpcIdentifiers.HESKEL, core.NpcIdentifiers.DREVEN, core.NpcIdentifiers.TREZNOR];
  const f = questGardener(t, ids[0]);
  for (const [index, id] of ids.entries()) {
    if (index > 0) f.setGardener(id);
    f.names.length = 0;
    await f.talk();
    await gardenerChoice(f, GARDENER_QUESTION);
    assert.equal(f.asked().length, index, 'choosing the question does not count unheard information');
    await gardenerContinue(f);
    assert.equal(f.p.getDialogueManager().getCurrent().getNpcId(), id, 'the NPC head stays bound to the actor');
    assert.equal(f.asked().length, index);
    f.p.closeInterruptibleInterfaces();
    assert.equal(f.asked().length, index, 'cancelling an answer does not count it');
    await f.talk();
    await gardenerChoice(f, GARDENER_QUESTION);
    await finishGardener(f);
    assert.deepEqual(f.asked(), ids.slice(0, index + 1));
    assert.ok(f.names.length > 0);
    assert.deepEqual([...new Set(f.names)], [f.gardener.getCurrentDefinition(f.p).getName()]);
    await f.talk();
    assert.match(f.p.getDialogueManager().getCurrent()?.getText() ?? '', /^You don't have a sapling planted/,
      `the completed gardener yields to Farming: ${JSON.stringify({ id, actions: f.gardener.getCurrentDefinition(f.p).getActions(), messages: f.messages })}`);
    f.p.closeInterruptibleInterfaces();
    assert.deepEqual(f.asked(), ids.slice(0, index + 1), 'repeated service access adds no duplicate');
  }
  f.setGardener(core.NpcIdentifiers.KRAGEN);
  await f.talk();
  assert.match(f.p.getDialogueManager().getCurrent().getText(), /^You don't have a sapling planted/,
    'after five answers even an unasked gardener yields to Farming');
  assert.deepEqual(f.asked(), ids);
  const restored = actor(t, 2435, 3415);
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  PlayerSave.fromPlayer(f.p).applyToPlayer(restored.p);
  assert.equal(restored.p.getAttribute(GARDENERS_ATTRIBUTE), ids.join(','), 'completed answers survive save/load');
  await input(restored, { type: 'npc_option', index: f.gardener.getIndex(), clickType: 1 });
  assert.match(restored.p.getDialogueManager().getCurrent().getText(), /^You don't have a sapling planted/);
  restored.p.closeInterruptibleInterfaces();
});

for (const name of ['TREZNOR', 'ELSTAN']) {
test(`a quest ${name} look-after choice reaches native Farming payment and protects exactly once`, async t => {
  const f = questGardener(t, core.NpcIdentifiers[name]);
  const patch = Data.CACHE.patches.find(p => p.x === 2435 && p.y === 3414);
  const state = Patches.stateFor(f.p, patch);
  Object.assign(state, { crop: 'MAGIC', stage: 0, status: 'growing', checked: false, protected: false, nextAt: Date.now() + 3600000 });
  const coconutNote = core.ItemDefinition.forId(Data.itemId('Coconut')).getNoteId();
  f.p.getInventory().add(new core.Item(coconutNote, 25), false);
  await f.talk();
  await gardenerChoice(f, 'Would you look after my crops for me?');
  assert.equal(f.p.getDialogueManager().getCurrent()?.getTitle(), 'Pay 25 coconuts?');
  assert.equal(state.protected, false);
  assert.deepEqual(f.asked(), []);
  f.p.closeInterruptibleInterfaces();
  await resume(f, 1);
  assert.equal(state.protected, false, 'cancelled payment cannot be resumed');
  assert.equal(f.p.getInventory().getAmount(coconutNote), 25);
  await f.talk();
  await gardenerChoice(f, 'Would you look after my crops for me?');
  await resume(f, 1);
  assert.equal(state.protected, true);
  assert.equal(f.p.getInventory().getAmount(coconutNote), 0);
  await resume(f, 1);
  assert.equal(f.p.getInventory().getAmount(coconutNote), 0);
  assert.deepEqual(f.asked(), [], 'ordinary Farming never counts a quest answer');
});
}

test('an invalid gardener answer never counts towards the five reports', async t => {
  const f = questGardener(t, core.NpcIdentifiers.AYESHA);
  await f.talk();
  await gardenerChoice(f, GARDENER_QUESTION);
  await finishGardener(f);
  assert.deepEqual(f.asked(), []);
  assert.deepEqual([...new Set(f.names)], [f.gardener.getCurrentDefinition(f.p).getName()]);
});
