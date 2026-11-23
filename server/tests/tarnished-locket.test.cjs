// From server/: node --test tests/tarnished-locket.test.cjs (after yarn build).
//
// The Guardians of the Rift tarnished locket's Inspect, against the Wiki (Transcript:Tarnished
// locket) and the local rsprox recording 20261020T153228 (ticks 4968-4970 and 5040-5044): the
// locket in an item box, "Would you like to read it?" with Read it. / Leave it alone., and the
// note interface (291) on Read it., which is also what marks the locket as inspected for the
// Lumbridge Guide. A real Player and DialogueManager, the real cache.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');
const { ItemStatementDialogue } = require('../dist/game/model/dialogues/entries/impl/ItemStatementDialogue');
const Shared = require('../plugins/minigames/guardiansoftherift/Shared.GuardiansOfTheRift');
const Records = require('../plugins/minigames/guardiansoftherift/Records.GuardiansOfTheRift');
const Amulet = require('../plugins/minigames/guardiansoftherift/Amulet.GuardiansOfTheRift');

// Wiki (Transcript:Tarnished locket), as the recording lays it out on note:line1-line12.
const NOTE_LINES = [
  '', '', 'To my beloved,', '',
  "While I can't be with you in person right now, I hope",
  'that this locket will remind you of me in the years to',
  'come. I think of you daily, and look forward to our',
  'inevitable reunion.', '', 'Your dearest Philly.', '', '',
];
const LOCKET_OPENS = 'The locket opens, revealing a note inside.';
const READ_TITLE = 'Would you like to read it?';
const NOTE = 291;
let core;
let inspect;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    onItemAction: (name, actions) => { if (name === 'Tarnished locket') inspect = actions.Inspect; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Shared.bind(api);
  Amulet.attach(api);
});

function fixture(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.getInventory().setItem(0, new core.Item(core.CacheDefinitions.getObjId('gotr_tarnished_locket'), 1));
  const sender = player.getPacketSender();
  const strings = new Map();
  t.mock.method(sender, 'sendString', (text, id) => { strings.set(id, text); return sender; });
  const opened = [];
  t.mock.method(sender, 'sendInterface', (id) => { opened.push(id); return sender; });
  return { player, strings, opened };
}

function inspectToOptions(player) {
  assert.equal(inspect({ player }), true);
  const box = player.getDialogueManager().getCurrent();
  assert.ok(box instanceof ItemStatementDialogue, 'the item box comes first');
  assert.equal(box.getItemId(), core.CacheDefinitions.getObjId('gotr_tarnished_locket'));
  assert.equal(box.getText(), LOCKET_OPENS);
  player.getDialogueManager().advance();
  const menu = player.getDialogueManager().getCurrent();
  assert.ok(menu instanceof OptionDialogue, 'then the read-it menu');
  assert.deepEqual(menu.getOptions(), ['Read it.', 'Leave it alone.']);
  assert.equal(menu.getTitle(), READ_TITLE);
}

const opened = (player) => Records.setting(player, 'gotr_locket_opened');

test('Inspect shows the item box and the read-it menu, and marks nothing yet', (t) => {
  const f = fixture(t);
  inspectToOptions(f.player);
  assert.equal(opened(f.player), 0);
  assert.deepEqual(f.opened, []);
});

test('Read it. opens the note with its twelve lines and marks the locket inspected', (t) => {
  const f = fixture(t);
  inspectToOptions(f.player);
  assert.equal(f.player.getDialogueManager().handleResume(OptionDialogue.OPTIONS_WIDGET_ID, 1), true);
  assert.equal(opened(f.player), 1);
  assert.deepEqual(f.opened, [NOTE]);
  NOTE_LINES.forEach((line, index) => assert.equal(f.strings.get((NOTE << 16) | (5 + index)), line, `line${index + 1}`));
  assert.equal(f.strings.get((NOTE << 16) | 7), 'To my beloved,');
  assert.equal(f.strings.get((NOTE << 16) | 14), 'Your dearest Philly.');
});

test('Leave it alone. closes the menu without the note or the inspected flag', (t) => {
  const f = fixture(t);
  inspectToOptions(f.player);
  assert.equal(f.player.getDialogueManager().handleResume(OptionDialogue.OPTIONS_WIDGET_ID, 2), true);
  assert.equal(opened(f.player), 0);
  assert.deepEqual(f.opened, []);
});
