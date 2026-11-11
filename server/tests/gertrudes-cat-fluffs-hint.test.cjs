// Run after `yarn build`: node --test tests/gertrudes-cat-fluffs-hint.test.cjs
// Stroke on Fluffs at stage 2 shows "Perhaps the cat wants something?" in a message box
// (messagebox, 229) and as a mesbox chat line, both on the same tick: rsprox 232/03222.txt tick 12370
// (type=mesbox, then if_opensub messagebox). Real plugins, a real Player, the quest's own stage and
// the native npc_option packet.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const QuestRuntime = require('../plugins/quests/QuestRuntime');

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("stroking Fluffs at stage 2 shows the hint in a message box with its mesbox chat line", async (t) => {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(2761); p.setUsername('fluffshint');
  p.setRegistered(true); p.setLocation(new core.Location(3307, 3511, 1)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  const fluffs = core.NPC.create(core.NpcIdentifiers.GERTRUDES_CAT_2, new core.Location(3308, 3511, 1));
  core.World.getNpcs().add(fluffs);
  t.after(() => { core.World.getNpcs().remove(fluffs); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', (m) => { messages.push(m); return p.getPacketSender(); });
  const typed = [];
  const sendTyped = p.getPacketSender().sendTypedMessage.bind(p.getPacketSender());
  t.mock.method(p.getPacketSender(), 'sendTypedMessage', (type, m) => { typed.push([type, m]); return sendTyped(type, m); });
  const quest = QuestRuntime.getRegisteredQuests().find((q) => q.name === "Gertrude's Cat");
  quest.setStage(p, 2);
  await c.dispatch([{ type: 'npc_option', index: fluffs.getIndex(), clickType: 3 }]);
  c.processTurnPackets();
  // Fluffs hisses and the player says "Ouch!" overhead first (the variant's first two steps).
  const box = () => p.getDialogueManager().getCurrent() instanceof core.StatementDialogue;
  for (let i = 0; i < 12 && !box(); i++) {
    core.TaskManager.processWalkTo(p.getIndex()); p.getMovementQueue().process(); core.TaskManager.process();
  }
  const current = p.getDialogueManager().getCurrent();
  assert.ok(current instanceof core.StatementDialogue, `a message box: ${current?.constructor?.name}`);
  assert.equal(String(current.getText?.() ?? ''), 'Perhaps the cat wants something?');
  assert.deepEqual(typed.filter(([, m]) => m === 'Perhaps the cat wants something?'),
    [[core.ChatType.MESBOX, 'Perhaps the cat wants something?']], 'one mesbox chat line with the box');
  assert.ok(!messages.includes('Perhaps the cat wants something?'), 'not an ordinary game message');
});
