// Run after `yarn build`: node --test tests/serum-207-herblore.test.cjs
// Wiki (Serum 207): ashes on a tarromin potion (unf) make Serum 207 (3) at 15 Herblore (boostable) for 50 XP.
// rsprox_transcripts/227/01846.txt (Leagues V): ashes on the tarromin vial in slot 9 -> "You make serum 207." (spam),
// mort_serum3 in slot 9, the ashes' slot emptied, human_herbing_vial, synth 2608 and a Herblore XP drop. The quest gave
// Serum 207 (4) wherever there was room, at any level, for no XP.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, quest, next = 9940;
const bots = process.env.DISABLE_PLAYER_BOTS;
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find((q) => q.key === 'shades_of_mortton');
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});
function herbalist(t, level) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('serum' + next); p.setRegistered(true); p.setLocation(new core.Location(3481, 3279, 0)); p.needsPlacement = false;
  p.getSkillManager().setMaxLevel(core.Skill.HERBLORE, level, true).setCurrentLevel(core.Skill.HERBLORE, level, true);
  const c = new ClientConnection(channel); c.player = p;
  const messages = [];
  const sender = p.getPacketSender(), typed = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, 'sendMessage', (m) => { messages.push(m); return sender; });
  t.mock.method(sender, 'sendTypedMessage', (type, m, ...r) => { messages.push(m); return typed(type, m, ...r); });
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); });
  quest.setStage(p, 5);
  const inv = p.getInventory(), I = core.ItemIdentifiers;
  for (let i = 0; i < 9; i++) inv.setItem(i, new core.Item(I.BONES, 1)); // the vial sits in slot 9, as recorded
  inv.setItem(9, new core.Item(I.TARROMIN_POTION_UNF_, 1));
  inv.setItem(13, new core.Item(I.ASHES, 1));
  const raw = () => p.getSkillManager().skills.experience[core.Skill.HERBLORE.getIndex()];
  const use = async () => { await c.dispatch([{ type: 'inventory_use_on', itemId: I.ASHES, slot: 13, target: { kind: 'inventory', slot: 9 } }]); c.processTurnPackets(); };
  return { p, inv, messages, raw, use };
}
test('at 15 Herblore: Serum 207 (3) in the tarromin vial\'s slot, 50 XP, the captured line', async (t) => {
  const f = herbalist(t, 15);
  const before = f.raw();
  await f.use();
  const I = core.ItemIdentifiers;
  assert.equal(f.inv.forSlot(9)?.getId(), I.SERUM_207_3_, 'mort_serum3 in slot 9');
  assert.equal(f.inv.getAmount(I.SERUM_207_4_), 0);
  assert.equal(f.inv.forSlot(13)?.getId() ?? -1, -1, 'the ashes are gone');
  assert.equal(f.raw() - before, 50);
  assert.ok(f.messages.includes('You make serum 207.'), f.messages.join(' | '));
  assert.equal(quest.getStage(f.p), 10, 'the quest moves on');
});
test('at 14 Herblore nothing is made', async (t) => {
  const f = herbalist(t, 14);
  await f.use();
  const I = core.ItemIdentifiers;
  assert.equal(f.inv.forSlot(9)?.getId(), I.TARROMIN_POTION_UNF_);
  assert.equal(f.inv.getAmount(I.ASHES), 1);
  assert.equal(quest.getStage(f.p), 5);
});
