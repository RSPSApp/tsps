// Real Player, PacketSender and DialogueManager; capture only the session's outbound wire.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { NpcDialogue } = require('../dist/game/model/dialogues/entries/impl/NpcDialogue');
const { PlayerDialogue } = require('../dist/game/model/dialogues/entries/impl/PlayerDialogue');
const { ActionDialogue } = require('../dist/game/model/dialogues/entries/impl/ActionDialogue');
const { DialogueChainBuilder } = require('../dist/game/model/dialogues/builders/DialogueChainBuilder');
const CHAT_MESSAGE = 120; // ServerPackets.ts CHAT_MESSAGE (const enum).

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});
function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel), player = new Player(session), packets = [];
  player.setUsername('DialogueTester'); player.setIndex(9101); player.setRegistered(true);
  t.mock.method(session, 'sendClientPacket', frame => { packets.push(Buffer.from(frame)); return true; });
  const connection = new ClientConnection(channel); connection.player = player;
  const lines = () => packets.filter(p => p[0] === CHAT_MESSAGE).map(p => {
    let offset = 3;
    const string = () => { const end = p.indexOf(0, offset); const value = p.toString('latin1', offset, end); offset = end + 1; return value; };
    const text = string(), type = p[offset++], from = string();
    return { type, text, from };
  });
  return { player, packets, lines, resume: group => connection.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | 5, childIndex: -1 }], true) };
}
test('spoken pages send one recorded dialogue packet before opening, including native continuation and repeated text', async t => {
  const f = actor(t), text = '<col=0000ff>Hello<lt>friend<gt></col><br>Again.';
  f.player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new NpcDialogue(0, 306, text, 'Guide'))
    .add(new PlayerDialogue(1, 'Yes please.'))
    .add(new NpcDialogue(2, 306, text, 'Guide')));
  assert.deepEqual(f.lines(), [{ type: 114, text: 'Guide|<col=0000ff>Hello<lt>friend<gt></col> Again.', from: '' }]);
  assert.equal(f.packets[0][0], CHAT_MESSAGE);
  await f.resume(231);
  assert.equal(f.lines()[1].text, `${f.player.getDisplayName()}|Yes please.`);
  await f.resume(217);
  assert.equal(f.lines().length, 3);
  assert.deepEqual(f.lines()[2], f.lines()[0]);
  f.player.getDialogueManager().reset();
  await f.resume(231);
  assert.equal(f.lines().length, 3, 'stale resume does not replay history');
});
test('combined name and flattened text stop at200 while the full dialogue text remains authored', t => {
  const f = actor(t), text = 'A long line. '.repeat(30) + '<br>End.';
  const entry = new NpcDialogue(0, 306, text, 'Lumbridge Guide', undefined, 217);
  entry.send(f.player);
  assert.deepEqual(f.lines(), [{ type: 114, text: ('Lumbridge Guide|' + text.replace(/<br>/g, ' ')).slice(0, 200), from: '' }]);
  assert.equal(entry.getText(), text);
});
test('held speech emits once and native resume cannot advance the self-advancing action', async t => {
  const f = actor(t);
  const held = new ActionDialogue(0, { execute: () => new NpcDialogue(0, 306, 'Wait.', 'Guide').sendHeld(f.player) }, true);
  f.player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(held).add(new NpcDialogue(1, 306, 'Next.', 'Guide')));
  await f.resume(231);
  assert.equal(f.player.getDialogueManager().getCurrent(), held);
  assert.deepEqual(f.lines(), [{ type: 114, text: 'Guide|Wait.', from: '' }]);
  f.player.getDialogueManager().advance();
  assert.deepEqual(f.lines().map(x => x.text), ['Guide|Wait.', 'Guide|Next.']);
});

test('RandomEvents shares core history without a second echo, and default names come from real NPC definitions', async t => {
  const f = actor(t);
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const core = PluginManager.getCoreApi();
  const flow = require('../plugins/npcs/random-events/DialogueFlow.RandomEvents');
  flow.chat({ core }, { player: f.player, npcId: core.NpcIdentifiers.RICK_TURPENTINE,
    pages: [{ text: 'Today is your lucky day, madam! I am donating to the victims of crime to atone for my<br>past actions!' },
      { player: true, text: 'Thank you.' }], end: false });
  assert.deepEqual(f.lines(), [{ type: 114, text: 'Rick Turpentine|Today is your lucky day, madam! I am donating to the victims of crime to atone for my past actions!', from: '' }]);
  await f.resume(231);
  assert.deepEqual(f.lines().map(line => line.text), ['Rick Turpentine|Today is your lucky day, madam! I am donating to the victims of crime to atone for my past actions!', `${f.player.getDisplayName()}|Thank you.`]);
});
test('custom door and Death office presentation paths send the displayed names once', async t => {
  const f = actor(t);
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const core = PluginManager.getCoreApi();
  const { DoorChatDialogue } = require('../plugins/areas/strongholdofsecurity/Dialogues.StrongholdOfSecurity');
  new DoorChatDialogue(0, 2495, 'Rickety Door', 'Correct!').send(f.player);
  const office = require('../plugins/areas/deathsoffice/Common.DeathsOffice');
  office.bind({ core });
  office.talk(f.player, [{ npc: 'Welcome.' }, { player: 'Hello.' }]);
  await f.resume(231);
  assert.deepEqual(f.lines().map(line => line.text), ['Rickety Door|Correct!', 'Death|Welcome.', `${f.player.getDisplayName()}|Hello.`]);
});
