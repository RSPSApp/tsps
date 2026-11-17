// Run after `yarn build`: node --test tests/npc-dialogue-return-to-previous-menu.test.cjs
//
// Transcript:Monkey Madness I, speaking to Daero: each "Talk about ..." topic opens a submenu ending in "Return to
// previous menu" (osrsreboxed-db#120 gives it {{tact|previous}}). Played through the quest transcript runner
// (QuestRuntime.startTranscript), a real Player and native dialogue_continue packets.
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

let core, runtime, next = 9900;

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
  player.setIndex(next++); player.setUsername('daero' + next); player.setRegistered(true);
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
  const play = (npcId, page, variant) => assert.equal(runtime.startTranscript(PM.createApi('ReturnMenuTest'), player, npcId, page, variant), true);
  return { player, said, menu, choose, count, play };
}

const TOPICS = ['Talk about the journey...', 'Talk about the 10th squad...', 'Talk about Caranock', 'Leave...'];

async function toTopics(f) {
  for (let i = 0; i < 10; i++) {
    const options = await f.menu();
    assert.ok(Array.isArray(options), `a menu: ${JSON.stringify(options)} after ${JSON.stringify(f.said)}`);
    if (options.includes(TOPICS[0])) return options;
    await f.choose(options[0]);
  }
  assert.fail('never reached the topics');
}

test('Daero: "Return to previous menu" goes back to the topics, from each topic in turn', async (t) => {
  const f = harness(t);
  f.player.getInventory().add(new core.Item(core.ItemIdentifiers.NARNODES_ORDERS, 1)); // "If you have the orders:"
  f.play(core.NpcIdentifiers.DAERO, 'Monkey Madness I', 'chapter-1-speaking-to-daero');
  assert.deepEqual(await toTopics(f), TOPICS);
  for (const topic of [TOPICS[0], TOPICS[1], TOPICS[2], TOPICS[0]]) {
    await f.choose(topic);
    const submenu = await f.menu();
    assert.ok(submenu.includes('Return to previous menu'), JSON.stringify(submenu));
    await f.choose('Return to previous menu');
    assert.deepEqual(await f.menu(), TOPICS, `back to the topics from ${topic}`);
  }
});

test('Daero: a question on a topic submenu, then "Return to previous menu", is back at the topics', async (t) => {
  const f = harness(t);
  f.player.getInventory().add(new core.Item(core.ItemIdentifiers.NARNODES_ORDERS, 1)); // "If you have the orders:"
  f.play(core.NpcIdentifiers.DAERO, 'Monkey Madness I', 'chapter-1-speaking-to-daero');
  await toTopics(f);
  await f.choose(TOPICS[1]);
  await f.choose('Who is Garkor?');
  const again = await f.menu();
  assert.ok(again.includes('Return to previous menu'), `the submenu again: ${JSON.stringify(again)}`);
  await f.choose('Return to previous menu');
  assert.deepEqual(await f.menu(), TOPICS);
  await f.choose(TOPICS[2]);
  await f.choose('Return to previous menu');
  assert.deepEqual(await f.menu(), TOPICS);
});
