// Run after `yarn build`: node --test tests/npc-dialogue-same-as-condition-loops.test.cjs
//
// Two Wiki "same as above" jumps that looped to the jump limit after #5832, played through the quest transcript
// runner (QuestRuntime.startTranscript), a real Player and native dialogue_continue packets.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');

let core, runtime, next = 9800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  runtime = require('../plugins/quests/QuestRuntime');
});
after(() => PM.emitServerShutdown({}));

function harness(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername('sameas' + next); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(3222, 3222, 0)); player.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = player;
  t.after(() => { player.getDialogueManager().reset(); player.setRegistered(false); core.TaskManager.cancelTasks(player); });
  const tick = () => { core.TaskManager.process(); c.processTurnPackets(); };
  const send = async (packet) => { await c.dispatch([packet]); for (let i = 0; i < 2; i++) tick(); };
  const group = () => player.getPacketSender().getChatboxGroupId();
  const text = () => player.getDialogueManager().getCurrent()?.getText?.()?.replace(/\s+/g, ' ');
  const said = [];
  async function menu() {
    for (let i = 0; i < 120; i++) {
      const current = player.getDialogueManager().getCurrent();
      if (typeof current?.getOptions === 'function') return current.getOptions();
      const pending = MultiChatboxPrompt.getPending(player);
      if (pending) return pending.options;
      if (!player.getDialogueManager().isActive()) return null;
      if (text()) said.push(text());
      await send({ type: 'dialogue_continue', widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
    }
    return 'still talking after 120 lines';
  }
  async function choose(option) {
    const options = await menu();
    assert.ok(Array.isArray(options) && options.includes(option), `${option} in ${JSON.stringify(options)}`);
    await send({ type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: options.indexOf(option) + 1 });
  }
  const count = (line) => said.filter((entry) => entry === line).length;
  const play = (npcId, page, variant) => assert.equal(runtime.startTranscript(PM.createApi('SameAsTest'), player, npcId, page, variant), true);
  return { player, said, menu, choose, count, play };
}

// Transcript:Ghosts Ahoy, talking to the Old Crone again: "Remind me - what can I do about Necrovarus?" is only
// {{tact|above}}, and the page's copy has her "Do you have such a thing as a ghostspeak amulet?" then conditions that
// each open with {{tact|above}}. Those jumps took the option's own copy again, so the two lines alternated to the
// jump limit. They now carry on as her line does where the page first has it, then her enchantment explanation.
test('Old Crone: "Remind me - what can I do about Necrovarus?" says its line once and reaches the enchantment', async (t) => {
  const f = harness(t);
  f.play(core.NpcIdentifiers.OLD_CRONE, 'Ghosts Ahoy', 'talking-to-the-old-crone-talking-to-the-old-crone-again');
  await f.choose('Remind me - what can I do about Necrovarus?');
  const options = await f.menu();
  assert.equal(f.count('Remind me - what can I do about Necrovarus?'), 1, JSON.stringify(f.said));
  assert.equal(f.count('Do you have such a thing as a ghostspeak amulet?'), 1, JSON.stringify(f.said));
  assert.ok(f.said.some((line) => line.startsWith('There is an enchantment that I can perform on such an amulet')), JSON.stringify(f.said));
  assert.ok(Array.isArray(options) || options === null, `the chat settles: ${JSON.stringify(options)}`);
});

// Transcript:Timfraku: in the menu after "What do you do here?", "I've been doing some work around the village." is
// only {{tact|above}}. The page's copy ends in a branch that is only another {{tact|above}}, which landed on the
// same copy again, so the line and his reply repeated to the jump limit.
test('Timfraku: "I\'ve been doing some work around the village." is said once with his reply', async (t) => {
  const f = harness(t);
  f.play(core.NpcIdentifiers.TIMFRAKU, 'Timfraku', 'after-tai-bwo-wannai-trio');
  await f.choose('What do you do here?');
  await f.choose("I've been doing some work around the village.");
  const options = await f.menu();
  assert.equal(f.count("I've been doing some work around the village."), 1, JSON.stringify(f.said));
  assert.ok(f.said.some((line) => line.startsWith("That's good Bwana, I would hate to think that you were just being lazy")), JSON.stringify(f.said));
  assert.ok(f.said.length < 12, JSON.stringify(f.said));
  // Transcript:Timfraku has {{tact|above}} there, and rsprox_transcripts/237/01102.txt shows the same four-option
  // menu again after his reply.
  assert.ok(Array.isArray(options), `his menu comes back: ${JSON.stringify(options)} after ${JSON.stringify(f.said)}`);
  assert.ok(options.includes("I've been doing some work around the village."), JSON.stringify(options));
  assert.ok(options.includes('What do you do here?'), JSON.stringify(options));
});
