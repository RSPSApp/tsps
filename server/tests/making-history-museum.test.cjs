// Run after `yarn build`: node --test tests/making-history-museum.test.cjs
// Making History (issue 6776): Drozal's journal reads in the two-page book, and once the outpost is
// the museum (makinghistory_objloc 1390 = 1) Study on the Shield Display, both Large Displays and
// the bookcase shows the Wiki's text. Everything goes through the loaded plugins: the item action
// and the loc click as the packet listeners emit them, the multiloc resolved for the player.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const museum = require('../plugins/quests/makinghistory/data/museum.json');

const BOOK = 392;
const uid = (child) => (BOOK << 16) | child;
const MUSEUM_VARBIT = 1390; // makinghistory_objloc
const SHIELD_MULTILOC = 10266, LARGE1_MULTILOC = 10268, LARGE2_MULTILOC = 10270, BOOKCASE_MULTILOC = 10272;
const JOURNAL = 6755, FILLIMAN_JOURNAL = 2967;

let core;
let index = 27760;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  core.ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function reader(t, { museumBuilt = true, name = 'Mh Reader', pronouns } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel)); player.setIndex(index++); player.setUsername(name);
  player.setRegistered(true); player.setLocation(new core.Location(2435, 3346, 0)); player.needsPlacement = false;
  if (pronouns !== undefined) player.getAppearance().setPronouns(pronouns);
  const texts = new Map();
  const sender = player.getPacketSender();
  const sendString = sender.sendString.bind(sender);
  sender.sendString = (text, id) => { texts.set(id, text); return sendString(text, id); };
  sender.sendVarbit(MUSEUM_VARBIT, museumBuilt ? 1 : 0);
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, texts };
}

function study(player, multiloc, x = 2436, y = 3343, z = 0) {
  const object = new core.GameObject(multiloc, new core.Location(x, y, z), 10, 0);
  const definition = core.ObjectDefinition.forPlayer(multiloc, player);
  const event = { player, object, objectId: multiloc, definition, location: { x, y, z }, clickType: 1, option: definition?.getInteractions?.()?.[0], handled: false };
  return { handled: PM.emitObjectInteraction(event), definition };
}

function boxes(player) {
  const manager = player.getDialogueManager();
  const seen = [];
  for (let guard = 0; guard < 10 && manager.isActive(); guard++) {
    const current = manager.getCurrent();
    if (!(current instanceof core.StatementDialogue)) break;
    seen.push(current.getText());
    manager.advance();
  }
  return seen;
}

function page(texts, side) {
  const lines = [];
  for (let line = 0; line < 15; line++) lines.push(texts.get(uid((side ? 60 : 44) + line)) ?? '');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

test('Read on Drozal\'s journal opens the two-page book on its first spread', (t) => {
  const { player, texts } = reader(t);
  const item = new core.Item(JOURNAL, 1);
  player.getInventory().add(item, false);
  const event = { player, interfaceId: 149, item, itemId: JOURNAL, slot: 0, clickType: 1, option: 'Read', handled: false };
  assert.equal(PM.emitItemAction(event), true);
  assert.equal(player.getInterfaceId(), BOOK);
  assert.equal(texts.get(uid(6)), "Drozal's Journal");
  assert.equal(texts.get(uid(9)), '1');
  assert.equal(texts.get(uid(10)), '2');
  assert.deepEqual(page(texts, 0).slice(0, 4), ['----------------------', '---1st Bennath', '----------------------', 'My life is full of changes at']);
  assert.deepEqual(page(texts, 1), ['', 'I can hardly wait!']);
  assert.equal(museum.journal.spreads.length, 4);
});

test('another item called Journal (Filliman\'s) is not taken for Drozal\'s', (t) => {
  const { player, texts } = reader(t);
  const item = new core.Item(FILLIMAN_JOURNAL, 1);
  player.getInventory().add(item, false);
  PM.emitItemAction({ player, interfaceId: 149, item, itemId: FILLIMAN_JOURNAL, slot: 0, clickType: 1, option: 'Read', handled: false });
  assert.notEqual(texts.get(uid(6)), "Drozal's Journal");
});

test('Study on the Shield Display shows its plate', (t) => {
  const { player } = reader(t);
  const { handled, definition } = study(player, SHIELD_MULTILOC, 2437, 3344);
  assert.equal(definition.getName(), 'Shield Display');
  assert.equal(handled, true);
  assert.deepEqual(boxes(player), [museum.shieldDisplay]);
});

test('Study on each Large Display shows its own three cards', (t) => {
  const ground = reader(t);
  assert.equal(study(ground.player, LARGE1_MULTILOC).handled, true);
  const groundBoxes = boxes(ground.player);
  assert.equal(groundBoxes.length, 3);
  assert.match(groundBoxes[0], /^Inside the case are three items, the first is a helmet/);
  assert.match(groundBoxes[2], /Randas/);

  const upstairs = reader(t);
  assert.equal(study(upstairs.player, LARGE2_MULTILOC, 2436, 3343, 1).handled, true);
  const upstairsBoxes = boxes(upstairs.player);
  assert.equal(upstairsBoxes.length, 3);
  assert.match(upstairsBoxes[0], /flag of Saradomin/);
  assert.match(upstairsBoxes[2], /flag of Zamorak/);
});

test('before the museum the displays are not there to study', (t) => {
  const { player } = reader(t, { museumBuilt: false });
  for (const multiloc of [SHIELD_MULTILOC, LARGE1_MULTILOC, BOOKCASE_MULTILOC]) {
    const object = new core.GameObject(multiloc, new core.Location(2436, 3343, 0), 10, 0);
    const definition = core.ObjectDefinition.forPlayer(multiloc, player);
    assert.ok(!definition?.getInteractions?.()?.includes('Study'), String(multiloc));
    // A forged Study on the pre-museum loc is not answered by the museum handlers.
    const event = { player, object, objectId: multiloc, definition, location: { x: 2436, y: 3343, z: 0 }, clickType: 1, option: 'Study', handled: false };
    PM.emitObjectInteraction(event);
  }
  assert.equal(player.getDialogueManager().isActive(), false);
});

function openBookcase(player) {
  assert.equal(study(player, BOOKCASE_MULTILOC, 2434, 3344).handled, true);
  const manager = player.getDialogueManager();
  assert.equal(manager.getCurrent().getText(), museum.bookcase.prompt);
  manager.advance();
  const menu = manager.getCurrent();
  assert.ok(menu instanceof core.OptionDialogue);
  assert.deepEqual(menu.getOptions(), museum.bookcase.options);
  return manager;
}

test('the bookcase: The History of the Outpost names the reader', (t) => {
  const { player, texts } = reader(t, { name: 'Unshayani' });
  openBookcase(player).handleResume(core.OptionDialogue.OPTIONS_WIDGET_ID, 1);
  assert.equal(player.getInterfaceId(), BOOK);
  assert.equal(texts.get(uid(6)), 'The History of the Outpost');
  assert.equal(page(texts, 0)[3], 'known only as Unshayani');
});

test('the bookcase: The Times of Lathas follows Song of the Elves', (t) => {
  const { player } = reader(t);
  openBookcase(player).handleResume(core.OptionDialogue.OPTIONS_WIDGET_ID, 2);
  assert.deepEqual(boxes(player), [museum.timesOfLathas.before]);

  const finished = reader(t);
  const song = require('../plugins/quests/QuestRuntime').questNamed('Song of the Elves');
  finished.player.setAttribute('quest.song_of_the_elves.stage', song.completionValue);
  assert.equal(song.isComplete(finished.player), true);
  openBookcase(finished.player).handleResume(core.OptionDialogue.OPTIONS_WIDGET_ID, 2);
  assert.deepEqual(boxes(finished.player), [museum.timesOfLathas.afterSongOfTheElves]);
});

test('the bookcase: The Mysterious Adventurer uses the reader\'s name and pronouns', (t) => {
  for (const [pronouns, phrase] of [[0, 'He has'], [1, 'She has'], [2, 'They have']]) {
    const { player, texts } = reader(t, { name: 'Unshayani', pronouns });
    openBookcase(player).handleResume(core.OptionDialogue.OPTIONS_WIDGET_ID, 3);
    assert.equal(texts.get(uid(6)), 'The Mysterious Adventurer');
    assert.equal(page(texts, 0)[3], `'Unshayani', ${phrase} talked to`);
  }
});
