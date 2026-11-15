// In Search of the Myreque: a stage-10 Cyreg conversation is a "talking to him again"
// section whose {{tact|previous}} repeats the first conversation. A player who returns
// with a charged druid pouch must reach the pouch branch and advance to stage 15.
//
// From server/: node --test tests/myreque-cyreg-pouch-return.test.cjs
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const runtime = require('../plugins/quests/QuestRuntime');

let core;
const CYREG = 5046;
const DRUID_POUCH = 2957;
const STAGE_REFUSED = 10;
const STAGE_PERSUADED = 15;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
});

after(() => PM.emitServerShutdown({}));

function fixture(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(9914);
  player.setUsername('cyreg-pouch-qa');
  player.setRegistered(true);
  player.setLocation(new core.Location(3480, 3232));
  core.RegionManager.loadMapFiles(3480, 3232);
  const npc = core.NPC.create(CYREG, new core.Location(3480, 3232));
  core.World.getNpcs().add(npc);
  npc.setRegistered(true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => {
    player.closeInterruptibleInterfaces();
    npc.setRegistered(false);
    core.World.getNpcs().remove(npc);
    player.setRegistered(false);
  });
  return { player, npc, connection, manager: player.getDialogueManager() };
}

async function nextLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | 5, childIndex: -1 }]);
  f.connection.processTurnPackets();
}

async function advanceToMenu(f) {
  for (let i = 0; i < 80; i++) {
    const pending = MultiChatboxPrompt.getPending(f.player);
    if (pending) return pending;
    if (!f.manager.getCurrent()) break;
    await nextLine(f);
  }
  assert.fail('the conversation did not reach its menu');
}

async function choose(f, option) {
  const pending = MultiChatboxPrompt.getPending(f.player);
  assert.ok(pending, 'a menu is open');
  const index = pending.options.indexOf(option);
  assert.ok(index >= 0, `menu offers ${option}`);
  // MultiChatboxPrompt.selectOption reads the resume argument as a 1-based slot.
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  f.connection.processTurnPackets();
}

test('a stage-10 Cyreg replays the first conversation so a charged pouch still progresses the quest', async (t) => {
  const f = fixture(t);
  const quest = runtime.questNamed('In Search of the Myreque');
  quest.setStage(f.player, STAGE_REFUSED);
  f.player.getInventory().adds(DRUID_POUCH, 5);

  PM.emitNpcInteraction({ player: f.player, npc: f.npc, npcId: CYREG, action: 'Talk-to', clickType: 1, handled: false });

  assert.equal(f.manager.getCurrent()?.getText(), 'Please. I need to know how to find the Myreque.');
  await nextLine(f);
  assert.equal(f.manager.getCurrent()?.getText(), "I'm sorry, but I can't help you. I guess you're all out of luck.");
  await nextLine(f);
  assert.equal(f.manager.getCurrent()?.getText(), 'Hello there friend.',
    '{{tact|previous}} replays the conversation it repeats, not the end of the chat');

  await advanceToMenu(f);
  await choose(f, "Well, I guess they'll just die without weapons.");
  await advanceToMenu(f);
  await choose(f, 'Resourceful enough to get their own steel weapons?');
  await advanceToMenu(f);
  await choose(f, "If you don't tell me, their deaths are on your head!");
  await advanceToMenu(f);
  await choose(f, "What kind of a man are you to say that you don't care?");

  const menu = await advanceToMenu(f);
  assert.equal(quest.getStage(f.player), STAGE_PERSUADED, 'showing the pouch advances the quest');
  assert.deepEqual(menu.options, ['Here are some planks for you.', "I'll be back later."]);
});
