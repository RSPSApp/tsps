// Run after `yarn build`: node --test tests/tourist-trap-captain-key.test.cjs
// Killing the mercenary captain mid-quest: rsprox 235/03792.txt tick 14948 (and the Wiki's Mercenary
// Captain) sends "The mercenary captain drops a metal key on the floor. You quickly grab the key and
// add it to your inventory." to chat, then opens the same line in an item box (objectbox, 193) with
// the metal key. Real plugins and a real Player; the kill's drop context is emitted as NpcDrops does.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const QuestRuntime = require('../plugins/quests/QuestRuntime');

const LINE = 'The mercenary captain drops a metal key on the floor. You quickly grab the key and add it to your inventory.';
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test('the captain key is announced in chat and in an item box with the key', (t) => {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(2762); p.setUsername('captainkey');
  p.setRegistered(true); p.setLocation(new core.Location(3273, 3028, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', (m) => { messages.push(m); return p.getPacketSender(); });
  const quest = QuestRuntime.getRegisteredQuests().find((q) => q.name === 'The Tourist Trap');
  assert.ok(quest);
  quest.setStage(p, 1);
  const captain = core.NPC.create(core.NpcIdentifiers.MERCENARY_CAPTAIN, new core.Location(3272, 3028, 0));
  const context = { perfectKill: false, bountyTask: null, preferredMethodLocation: null, handledItemIds: new Set() };
  PM.emitCustomEvent('npc-drops:context', { player: p, npc: captain, npcId: captain.getId(), context });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.METAL_KEY), 1, 'the key is in the inventory');
  assert.ok(context.handledItemIds.has(core.ItemIdentifiers.METAL_KEY), 'the shared table does not drop another');
  assert.ok(messages.includes(LINE), messages.join(' | '));
  const box = p.getDialogueManager().getCurrent();
  assert.ok(box instanceof core.ItemStatementDialogue, `an item box: ${box?.constructor?.name}`);
});
