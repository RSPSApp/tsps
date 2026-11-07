// Run after `yarn build`: node --test tests/sote-alrena-tabard.test.cjs
// Song of the Elves, Alrena's knightly-disguise talk played through the real dialogue runtime and Continue packets.
// Handing over no silk or dye (dropped while her menu is open) ends the conversation: her "Here you go, one tabard." and the "gives you" line no longer
// follow with nothing given. A tabard paid for but not given (a logout between the two) is given on the next talk,
// without taking a second set.
const assert = require('node:assert/strict'), path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { startTranscript } = require('../plugins/quests/QuestRuntime');

const TABARD_PAID = 'quest.song_of_the_elves.tabard-paid';
let api, c, alrena;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  api = PM.createApi('SongOfTheElves'); c = api.core; c.RegionManager.init();
  require('../plugins/world/DefinitionArchives.plugin').register(PM.createApi('DefinitionArchives'));
  require('../plugins/npcs/NpcDialogues.plugin').register(PM.createApi('NpcDialogues'));
  require('../plugins/quests/quests/SongOfTheElves.Quest')(api);
  alrena = c.NpcIdentifiers.ALRENA;
  assert.ok(alrena > 0);
});

function fixture(t, items = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel)), connection = new ClientConnection(channel); connection.player = player;
  assert.equal(c.World.getPlayers().add(player), true);
  player.setLocation(new c.Location(2614, 3291, 0)); player.setNeedsPlacement(false);
  for (const [id, amount] of Object.entries(items)) player.getInventory().adds(Number(id), amount);
  const messages = [];
  const send = player.getPacketSender().sendMessage.bind(player.getPacketSender());
  t.mock.method(player.getPacketSender(), 'sendMessage', (text) => { messages.push(text); return send(text); });
  t.after(() => { player.closeInterruptibleInterfaces(); c.TaskManager.cancelTasks(player.getIndex()); c.World.getPlayers().remove(player); });
  return { player, connection, messages };
}
async function resume(f, choice = 1) {
  const pending = MultiChatboxPrompt.getPending(f.player), group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: pending ? MultiChatboxPrompt.OPTIONS_WIDGET_ID : (group << 16) | 5, childIndex: pending ? choice : -1 }]);
  f.connection.processTurnPackets();
}
const text = (f) => f.player.getDialogueManager().getCurrent()?.getText?.()?.replace(/\s+/g, ' ');
/** Plays the talk, picking "Yes." at "Give Alrena the items?", and returns every line shown. */
async function talk(f, atMenu = () => {}) {
  assert.equal(startTranscript(api, f.player, alrena, 'Song of the Elves', 'making-a-knightly-disguise-talking-to-alrena'), true);
  const shown = [];
  for (let n = 0; n < 30; n++) {
    const pending = MultiChatboxPrompt.getPending(f.player);
    if (pending) { shown.push(`menu: ${pending.options.join(' / ')}`); atMenu(); await resume(f, Math.max(1, pending.options.indexOf('Yes.') + 1)); continue; }
    if (!f.player.getDialogueManager().getCurrent()) break;
    shown.push(text(f)); await resume(f);
  }
  return shown;
}
const tabards = (f) => f.player.getInventory().getAmount(c.ItemIdentifiers.ARDOUGNE_KNIGHT_TABARD);

test('handing Alrena no silk or dye ends the talk: no "Here you go", no tabard', async (t) => {
  // The talk checks for the items before her menu; the player drops them while it is open.
  const I = c.ItemIdentifiers;
  const f = fixture(t, { [I.SILK]: 1, [I.PURPLE_DYE]: 1 });
  const shown = await talk(f, () => { f.player.getInventory().deleteNumber(I.SILK, 1); f.player.getInventory().deleteNumber(I.PURPLE_DYE, 1); });
  assert.ok(shown.some((line) => /^menu: Yes\. \/ No\./.test(line)), `the hand-over menu is reached: ${shown.join(' | ')}`);
  assert.ok(f.messages.includes('You need some silk and some purple dye for Alrena to make the tabard.'));
  assert.ok(!shown.some((line) => /Here you go, one tabard/.test(line ?? '')), `Alrena doesn't hand one over: ${shown.join(' | ')}`);
  assert.ok(!f.messages.some((m) => /gives you a Knight of Ardougne tabard/.test(m)));
  assert.equal(f.player.getDialogueManager().getCurrent(), undefined, 'the conversation is over');
  assert.equal(tabards(f), 0);
});

test('with the silk and dye, Alrena takes one of each and gives one tabard', async (t) => {
  const I = () => c.ItemIdentifiers;
  const f = fixture(t, { [I().SILK]: 2, [I().PURPLE_DYE]: 2 });
  const shown = await talk(f);
  assert.ok(shown.some((line) => /Here you go, one tabard/.test(line ?? '')));
  assert.equal(tabards(f), 1);
  assert.equal(f.player.getInventory().getAmount(I().SILK), 1);
  assert.equal(f.player.getInventory().getAmount(I().PURPLE_DYE), 1);
  assert.notEqual(f.player.getAttribute(TABARD_PAID), true, 'nothing is left owed');
});

test('a tabard paid for before a logout is saved, and given next time without taking a second set', async (t) => {
  assert.ok(PlayerSave.persistentAttributeKeys.has(TABARD_PAID),
    'the owed tabard is a saved attribute');
  const I = () => c.ItemIdentifiers;
  const f = fixture(t, { [I().SILK]: 1, [I().PURPLE_DYE]: 1 });
  f.player.setAttribute(TABARD_PAID, true);
  await talk(f);
  assert.equal(tabards(f), 1, 'the owed tabard is given');
  assert.equal(f.player.getInventory().getAmount(I().SILK), 1, 'the spare silk is kept');
  assert.equal(f.player.getInventory().getAmount(I().PURPLE_DYE), 1, 'the spare dye is kept');
  assert.notEqual(f.player.getAttribute(TABARD_PAID), true);
});
