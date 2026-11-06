// Build first: node --test tests/holiday-toy-dialogues.test.cjs
// Holiday item options whose words are Wiki transcripts in the imported dialogue dump, driven
// through native inventory_action / dialogue_continue packets with every plugin loaded.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { ItemActionPacketListener: Items } = require('../dist/net/packet/impl/ItemActionPacketListener');
const dialogues = require('../data/definitions/npc-dialogues.json');
const toys = require('../plugins/items/data/holiday-toys.json');

let core, c, nextIndex = 2700;
const errors = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  c = core.CacheDefinitions;
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  // A dialogue listener that cannot cope with an item conversation (no NPC) would throw here.
  const error = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); error(...args); };
});
after(() => PM.emitServerShutdown({}));

function fixture(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername('toytalkqa');
  player.setRegistered(true);
  player.setLocation(new core.Location(3222, 3218, 0));
  const messages = [];
  const send = player.sendMessage.bind(player);
  player.sendMessage = (message, ...rest) => { messages.push(message); return send(message, ...rest); };
  const connection = new ClientConnection(channel);
  connection.player = player;
  errors.length = 0;
  t.after(() => {
    player.closeInterruptibleInterfaces();
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
    assert.deepEqual(errors, [], 'no plugin hook failed');
  });
  return { player, connection, messages };
}
function give(f, symbol, slot = 0) {
  f.player.getInventory().setItem(slot, new core.Item(c.getObjId(symbol), 1));
  return slot;
}
async function use(f, slot, option) {
  const itemId = f.player.getInventory().getItems()[slot].getId();
  await f.connection.dispatch([{ type: 'inventory_action', slot, itemId, widgetId: c.getComponentId('inventory:items'), option }]);
  f.connection.processTurnPackets();
}
async function next(f, choice) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  const widgetId = choice == null ? (group << 16) | ([231, 217].includes(group) ? 5 : 0) : core.OptionDialogue.OPTIONS_WIDGET_ID;
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId, childIndex: choice ?? -1 }]);
  f.connection.processTurnPackets();
}
const current = f => f.player.getDialogueManager().getCurrent();
const text = f => current(f)?.getText?.().replace(/\s+/g, ' ');
const pending = f => core.MultiChatboxPrompt.getPending(f.player);
const shows = (f, kind) => current(f)?.constructor?.name === kind;

test('the Zombie head Question menu plays the transcript with the cache Zombie Head chathead', async t => {
  const f = fixture(t);
  await use(f, give(f, 'trick_or_treat_head'), 'Question');
  assert.deepEqual(pending(f).options, ['How did you die?', 'What is your name?', 'Can you do any tricks?', 'Want a new hat?', 'Want to go scare some people?']);
  await next(f, 1);
  assert.equal(text(f), 'Hey, Head?');
  await next(f);
  assert.equal(text(f), 'What?');
  assert.equal(current(f).getNpcId(), c.getNpcId('break_zomb_head'));
  await next(f);
  assert.equal(text(f), 'How did you die?');
});

test('Eek talks with her own chathead, from the inventory and while held', async t => {
  const f = fixture(t);
  const openers = dialogues.Eek.steps[0].options.map(option => option.steps[0].npc);
  await use(f, give(f, 'hw18_eek'), 'Talk-to');
  assert.ok(openers.includes(text(f)), text(f));
  assert.equal(current(f).getNpcId(), c.getNpcId('hw18_spider_eek'));
  f.player.closeInterruptibleInterfaces();
  const eek = c.getObjId('hw18_eek'), weapon = core.Equipment.WEAPON_SLOT;
  f.player.getInventory().resetItems();
  f.player.getEquipment().setItem(weapon, new core.Item(eek, 1));
  const worn = 2 + Array.from({ length: 5 }, (_, i) => c.getItem(eek).params?.get?.(451 + i)).indexOf('Talk-to');
  Items.handleAction(f.player, core.Equipment.INVENTORY_INTERFACE_ID, eek, weapon, worn);
  assert.ok(openers.includes(text(f)), 'Talk-to from the worn tab');
});

test('each painted Archibald answers with the chathead of his own style', async t => {
  const f = fixture(t);
  await use(f, give(f, 'easter26_egg_companion03'), 'Interact');
  assert.equal(text(f), 'What adventure do you want to go on today, Archibald?');
  await next(f);
  assert.equal(text(f), '...');
  assert.equal(current(f).getNpcId(), c.getNpcId('poh_easter26_egg_03'));
  await next(f);
  assert.ok(["I don't know about that one.", "Let's do it!", 'I was thinking the same thing!',
    "Ok, I'll let you think about it for a bit longer."].includes(text(f)));
});

test('the Haunted wine bottle wails without a ghostspeak amulet and counts conversations with one', async t => {
  const f = fixture(t), bottle = c.getObjId('hw21_haunted_bottle');
  const slot = give(f, 'hw21_haunted_bottle');
  await use(f, slot, 'Talk-to');
  assert.equal(text(f), 'Hello...?');
  await next(f);
  assert.ok(shows(f, 'ItemStatementDialogue'));
  assert.equal(current(f).getItemId?.() ?? current(f).itemId, bottle);
  assert.equal(text(f), 'WoooOooOooOooooOOOoo.');
  assert.equal(f.player.getAttribute('holiday-toys:haunted-bottle-talks') ?? 0, 0, 'nothing counts without an amulet');
  f.player.closeInterruptibleInterfaces();
  f.player.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(c.getObjId('amulet_of_ghostspeak'), 1));
  const firsts = ['Yes, toytalkqa?', 'What do you want?', "I'm awake."];
  for (const line of firsts) {
    await use(f, slot, 'Talk-to');
    await next(f);
    assert.equal(text(f), line);
    f.player.closeInterruptibleInterfaces();
  }
  t.mock.method(Math, 'random', () => 4.5 / 11);
  await use(f, slot, 'Talk-to');
  await next(f);
  assert.equal(text(f), 'Hi toytalkqa.');
  for (let i = 0; i < 2; i++) await next(f);
  assert.equal(text(f), '4 times.', 'the count fills the transcript blank');
  assert.equal(f.player.getAttribute('holiday-toys:haunted-bottle-talks'), 4);
});

test('the Magic egg ball asks its questions, shakes in a box and answers in chat', async t => {
  const f = fixture(t);
  const slot = give(f, 'easter20_magic_egg');
  await use(f, slot, 'Shake');
  assert.equal(pending(f).title, 'What would you like to ask the Magic Egg?');
  assert.deepEqual(pending(f).options, ['What rare item will I get today?', 'Will I get a pet today?',
    'What should I train today?', 'What boss should I fight today?', 'Never mind.']);
  await next(f, 3);
  assert.equal(text(f), 'Magic Egg Ball, what should I train today?');
  await next(f);
  assert.ok(shows(f, 'StatementDialogue'));
  assert.equal(text(f), 'You shake the egg violently.');
  await next(f);
  assert.match(f.messages.at(-1), /^Today you will train yourself in \w+/);
  assert.equal(current(f), undefined);
  // The pet question's "same as above" reuses the rare-item answers.
  await use(f, slot, 'Shake');
  await next(f, 2);
  assert.match(text(f), /^Magic Egg Ball, will I get a pet .+ today\?$/);
  await next(f);
  await next(f);
  const answers = dialogues['Magic egg ball'].branches;
  const said = Object.values(answers).flat().flatMap(step => step.options ?? []).map(option => option.steps[0].text);
  assert.ok(said.includes(f.messages.at(-1)), f.messages.at(-1));
  await use(f, slot, 'Shake');
  await next(f, 5);
  assert.equal(f.messages.at(-1), 'The egg returns to its dormant state.');
});

test('Santa\'s list puts the player on one list at the first Check and keeps them there', async t => {
  const f = fixture(t);
  t.mock.method(Math, 'random', () => 0.75);
  const slot = give(f, 'xmas22_cape');
  await use(f, slot, 'Check');
  assert.deepEqual(f.messages, ['You are on the naughty list!']);
  assert.equal(f.player.getAttribute('holiday-toys:santas-list'), 'naughty');
  await use(f, slot, 'Check');
  assert.ok(toys.santasList.again.naughty.includes(f.messages[1]));
});

function npc(symbolId, at) {
  return core.NPC.create(symbolId, at);
}
async function talk(f, target) {
  const clickType = target.getCurrentDefinition(f.player).getActions().indexOf('Talk-to') + 1;
  f.player.setLocation(target.getLocation().transform(1, 0, 0));
  PM.emitNpcInteraction({ player: f.player, npc: target, npcId: target.getId(), action: 'Talk-to', clickType, handled: false });
}

test('the Secret santa present: tags, deliveries in order, colour unlocks and Change-colour', async t => {
  const f = fixture(t), presents = toys.secretSanta.presents.map(name => c.getObjId(name));
  const slot = give(f, 'xm21_present_1');
  await use(f, slot, 'Read-tag');
  assert.ok(shows(f, 'ItemStatementDialogue'));
  assert.equal(text(f), 'I sell tools that chop. Near where adventures begin. Come visit my shop.');
  f.player.closeInterruptibleInterfaces();
  await use(f, slot, 'Change-colour');
  assert.equal(text(f), 'Deliver the present to the residents of Gielinor to unlock more colours. Check the name tag!');
  f.player.closeInterruptibleInterfaces();

  // Aggie is not next: her ordinary conversation, no present option.
  const aggie = npc(120, new core.Location(3086, 3258));
  await talk(f, aggie);
  assert.ok(!pending(f)?.options?.includes('I have a present for you!'));
  f.player.closeInterruptibleInterfaces();

  const bob = npc(10619, new core.Location(3230, 3203));
  const anims = [];
  bob.performAnimation = animation => anims.push(animation.getId());
  await talk(f, bob);
  assert.deepEqual(pending(f).options, ['I have a present for you!', 'Talk about other things.']);
  await next(f, 1);
  for (let i = 0; i < 12 && !/^You've unlocked/.test(text(f) ?? ''); i++) await next(f);
  assert.equal(text(f), "You've unlocked blue wrapping paper for your present.");
  assert.equal(current(f).getItemId?.() ?? current(f).itemId, presents[1]);
  assert.equal(f.player.getAttribute('holiday-toys:secret-santa-colours'), 1);
  assert.deepEqual(anims, [c.getSeqId('human_cast_enchantring')]);
  f.player.closeInterruptibleInterfaces();

  // Bob again: delivered, so his ordinary conversation.
  await talk(f, bob);
  assert.ok(!pending(f)?.options?.includes('I have a present for you!'));
  f.player.closeInterruptibleInterfaces();

  await use(f, slot, 'Read-tag');
  assert.match(text(f), /^Red, yellow and blue\./);
  f.player.closeInterruptibleInterfaces();
  await use(f, slot, 'Change-colour');
  assert.deepEqual(pending(f).options, ['Red', 'Blue', 'I want to unlock more colours!']);
  await next(f, 2);
  assert.equal(f.player.getInventory().getItems()[slot].getId(), presents[1], 'now blue, in the same slot');

  // "Talk about other things." hands Aggie back to her ordinary conversation.
  await talk(f, aggie);
  assert.deepEqual(pending(f).options, ['I have a present for you!', 'Talk about other things.']);
  await next(f, 2);
  assert.ok(current(f) || pending(f), 'her ordinary conversation started');
  assert.ok(!pending(f)?.options?.includes('I have a present for you!'));
  assert.equal(f.player.getAttribute('holiday-toys:secret-santa-colours'), 1);
});

test('a present not held offers no delivery', async t => {
  const f = fixture(t);
  const bob = npc(10619, new core.Location(3230, 3203));
  await talk(f, bob);
  assert.ok(!pending(f)?.options?.includes('I have a present for you!'));
});

test('every dialogue entry names a real cache option and an imported transcript section', () => {
  const has = (symbol, option) => {
    const item = c.getItem(c.getObjId(symbol));
    return item.inventoryActions.includes(option) || Array.from({ length: 5 }, (_, i) => item.params?.get?.(451 + i)).includes(option);
  };
  const sections = page => Object.keys(dialogues[page].variants ?? { 'standard-dialogue': dialogues[page].steps });
  for (const entry of toys.dialogues) {
    for (const item of entry.items) assert.ok(has(item, entry.option), `${item} ${entry.option}`);
    for (const speaker of entry.speakers ?? []) assert.notEqual(c.getNpcId(speaker), null, speaker);
    assert.ok(dialogues[entry.page], entry.page);
    if (entry.variant) assert.ok(sections(entry.page).includes(entry.variant), `${entry.page}: ${entry.variant}`);
  }
  const { hauntedBottle, secretSanta } = toys;
  for (const variant of [...hauntedBottle.variants, hauntedBottle.silent]) assert.ok(sections('Haunted wine bottle').includes(variant), variant);
  for (const variant of [...secretSanta.tags, ...secretSanta.deliveries]) assert.ok(sections('Secret santa present').includes(variant), variant);
  for (const name of hauntedBottle.amulets) assert.notEqual(c.getObjId(name), null, name);
  for (const item of toys.santasList.items) assert.ok(has(item, toys.santasList.option), item);
});

test('an unaccepted or finished delivery never takes the NPC\'s own actions or unlocks a colour', async t => {
  const f = fixture(t);
  const actions = [];
  const emit = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, 'emitCustomEvent', (name, payload) => {
    emit(name, payload);
    if (name === 'npc-dialogue:action' && payload.step?.action === 'open_shop') actions.push(payload.handled);
  });
  const bob = npc(10619, new core.Location(3230, 3203));
  const shop = async () => {
    await talk(f, bob);
    const option = pending(f).options.indexOf('Have you anything to sell?');
    assert.ok(option >= 0, pending(f).options.join(' | '));
    await next(f, option + 1);
    for (let i = 0; i < 6 && actions.length === 0; i++) await next(f);
  };
  // Offered, menu closed without a pick, present banked: Bob's shop is his own.
  give(f, 'xm21_present_1');
  await talk(f, bob);
  assert.deepEqual(pending(f).options, ['I have a present for you!', 'Talk about other things.']);
  f.player.closeInterruptibleInterfaces();
  f.player.getInventory().resetItems();
  await shop();
  assert.deepEqual(actions, [false], 'the shop step is left to the shop code');
  assert.equal(f.player.getAttribute('holiday-toys:secret-santa-colours') ?? 0, 0, 'no colour without a delivery');
  f.player.closeInterruptibleInterfaces();
  // After a real delivery, his shop still opens through its own step.
  give(f, 'xm21_present_1');
  await talk(f, bob);
  await next(f, 1);
  for (let i = 0; i < 12 && !/^You've unlocked/.test(text(f) ?? ''); i++) await next(f);
  assert.equal(f.player.getAttribute('holiday-toys:secret-santa-colours'), 1);
  f.player.closeInterruptibleInterfaces();
  actions.length = 0;
  await shop();
  assert.deepEqual(actions, [false]);
  assert.equal(f.player.getAttribute('holiday-toys:secret-santa-colours'), 1);
});
