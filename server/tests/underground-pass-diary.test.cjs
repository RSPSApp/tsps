// From server/: node --test tests/underground-pass-diary.test.cjs (after yarn build).
// Underground Pass: Koftik at the bridge offers "What does it say?" about the remains of a book; the
// transcript's open_interface "Diary of Randas" used to do nothing. It now opens the book widget with the
// wiki's Diary of Randas text (Transcript:The Diary of Randas).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const DIARY = require('../plugins/quests/quests/data/underground-pass-diary');
const DIALOGUES = require('../data/definitions/npc-dialogues.json');

const BOOK_GROUP = 392;
let core, quest, actionHooks = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    persistAttribute() {},
    emitCustomEvent() {},
    onCustomEvent(name, fn) { if (name === 'npc-dialogue:action') actionHooks.push(fn); },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require('../plugins/quests/quests/UndergroundPass.Quest')(api);
  quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find((entry) => entry.key === 'underground_pass');
});

function reader() {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  player.setRegistered(true);
  player.sendMessage = () => {};
  player.setLocation(new core.Location(2496, 9715, 0));
  quest.setStage(player, 1);
  const strings = new Map();
  const interfaces = [];
  const packet = player.getPacketSender();
  packet.sendString = (text, uid) => { strings.set(uid, text); return packet; };
  packet.sendInterface = (id) => { interfaces.push(id); return packet; };
  return { player, strings, interfaces };
}
const diaryAction = (player) => ({ player, stepId: 'EY2WSw', action: 'open_interface', target: 'Diary of Randas', handled: false });

test("the transcript's Diary of Randas action is the step this fix answers", () => {
  const variant = DIALOGUES['Underground Pass'].variants['the-underground-pass-talking-to-koftik-at-the-bridge'];
  assert.match(JSON.stringify(variant), /"action":"open_interface"[^}]*"target":"Diary of Randas"/);
});

test('the diary text is the wiki transcript, wrapped to one book spread', () => {
  assert.equal(DIARY.title, 'The Diary of Randas');
  const text = Object.values(DIARY.pages[0]).filter(Boolean).join(' ');
  assert.equal(text, [
    'It began as a whisper in my ears. Dismissing the sounds as the whistling of the wind, I steeled myself against these forces, and continued on my way.',
    'But the whispers became moans...',
    'At once fearsome and enticing like the call of some beautiful siren.',
    'Join us!',
    'Our greatness lies within you, but only Zamorak can unlock your potential...',
  ].join(' '));
});

test('the Diary of Randas action opens the book with that text', () => {
  const { player, strings, interfaces } = reader();
  const event = diaryAction(player);
  for (const hook of actionHooks) hook(event);
  assert.equal(event.handled, true);
  assert.deepEqual(interfaces, [BOOK_GROUP]);
  assert.equal(strings.get((BOOK_GROUP << 16) | 6), 'The Diary of Randas');
  assert.equal(strings.get((BOOK_GROUP << 16) | 44), 'It began as a whisper in my ears.');
  assert.match(strings.get((BOOK_GROUP << 16) | 45), /^Dismissing the sounds as the/);
});

test('another interface target is left alone', () => {
  const { player, interfaces } = reader();
  const event = { ...diaryAction(player), target: 'Bank' };
  for (const hook of actionHooks) hook(event);
  assert.equal(event.handled, false);
  assert.deepEqual(interfaces, []);
});
