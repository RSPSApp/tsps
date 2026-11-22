// Mayor Hobb's "what brings you to Witchaven?" menu (issue #6503): every answer gets his reply and
// goes on into his questions, which set his track (slug2_npc_track2). Real Player, real plugins,
// the native menu choice and dialogue_continue packets.
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
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');

const MAYOR_HOBB = 4783; // slug2_hobb_stage2
const STAGE_BRIEFED = 2; // O'Niall named the three people (tick 997)
const TRACKS_KEY = 'quest.the_slug_menace.tracks';
const TRACK_HOBB = 2;
const ANSWERS = ["I'm here to relax.", "I'm just looking around.", "I'm here to fish."];

let core, quest, nextIndex = 2600;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find((entry) => entry.key === 'the_slug_menace');
});
after(() => PM.emitServerShutdown({}));

function fixture(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername(`slugmayor${player.getIndex()}`);
  player.setRegistered(true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const npc = core.NPC.create(MAYOR_HOBB, new core.Location(2706, 3294));
  t.after(() => { player.closeInterruptibleInterfaces(); player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, npc, connection };
}

const text = (player) => String(player.getDialogueManager().getCurrent()?.getText?.() ?? '').replace(/<br>/g, ' ').replace(/\s+/g, ' ');

async function next(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | 5, childIndex: -1 }]);
  f.connection.processTurnPackets();
}

/** Continues until a menu shows (or the chat ends), collecting the lines on the way. */
async function untilMenu(f, seen) {
  for (let i = 0; i < 40 && !MultiChatboxPrompt.getPending(f.player) && f.player.getDialogueManager().getCurrent(); i++) {
    seen.push(text(f.player));
    await next(f);
  }
  return MultiChatboxPrompt.getPending(f.player);
}

for (const [index, answer] of ANSWERS.entries()) {
  test(`"${answer}" gets the Mayor's reply and his questions, with his track`, async (t) => {
    const f = fixture(t);
    quest.setStage(f.player, STAGE_BRIEFED);
    const event = { player: f.player, npc: f.npc, npcId: MAYOR_HOBB, variant: { page: 'The Slug Menace', variant: 'witchaven-talking-to-mayor-hobb-2' }, exact: true };
    PM.emitCustomEvent('npc-dialogue:start', event);
    assert.equal(event.handled, true);
    const seen = [];
    const menu = await untilMenu(f, seen);
    assert.ok(seen.includes('Tell me, what brings you to Witchaven?'), seen.join(' | '));
    assert.deepEqual(menu?.options, ANSWERS);
    assert.equal(MultiChatboxPrompt.selectOption(f.player, index), true);
    f.connection.processTurnPackets();

    const after = [];
    const questions = await untilMenu(f, after);
    assert.equal(after[0], answer);
    assert.equal(after[1], "That's good, yes, that's good. Witchaven is a nice quiet village - very relaxing, good fishing.");
    assert.equal(after.at(-1), 'Is there anything else you need to know?');
    assert.ok(questions, 'his questions menu shows');
    assert.equal(questions.options[0], 'What can you tell me about Witchaven?');
    assert.equal(Number(f.player.getAttribute(TRACKS_KEY)) & TRACK_HOBB, TRACK_HOBB);
  });
}
