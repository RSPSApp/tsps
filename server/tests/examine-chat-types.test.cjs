// Run after `yarn build`: node --test tests/examine-chat-types.test.cjs
// Examines go out with their own chat types, as live sends them: objects as loc_examine (29, rsprox
// 237/01098.txt:334474) and NPCs as npc_examine (28). The native examine packets through the
// connection's real dispatch, on a real Player.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  ObjectDefinition.init();
  new NpcDefinitionLoader().load();
  core = PM.getCoreApi();
});

function examiner(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername('examiner');
  const conn = new ClientConnection(channel);
  conn.player = p;
  const typed = [];
  const plain = [];
  t.mock.method(p.getPacketSender(), 'sendTypedMessage', (type, text) => { typed.push([type, text]); return p.getPacketSender(); });
  t.mock.method(p.getPacketSender(), 'sendMessage', (text) => { plain.push(text); return p.getPacketSender(); });
  return { conn, typed, plain };
}

test('an object examine is a loc_examine line (29)', async (t) => {
  const f = examiner(t);
  await f.conn.dispatch([{ type: 'examine_object', id: 1276 }], true);
  assert.deepEqual(f.plain, []);
  assert.deepEqual(f.typed, [[core.ChatType.LOC_EXAMINE, 'One of the most common trees in Gielinor.']]);
  assert.equal(core.ChatType.LOC_EXAMINE, 29);
});

test('an NPC examine is an npc_examine line (28)', async (t) => {
  const f = examiner(t);
  await f.conn.dispatch([{ type: 'examine_npc', id: core.NpcIdentifiers.MAN }], true);
  assert.deepEqual(f.plain, []);
  assert.equal(f.typed.length, 1);
  assert.equal(f.typed[0][0], 28);
  assert.equal(typeof f.typed[0][1], 'string');
});
