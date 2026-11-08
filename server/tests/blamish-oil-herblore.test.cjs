// Run after `yarn build`: node --test tests/blamish-oil-herblore.test.cjs
// Wiki (Blamish oil): blamish snail slime on a harralander potion (unf) "requires level 25 Herblore to be made and
// gives 80 Herblore experience". Heroes' Quest made it at any level for no XP.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, next = 9920;
const bots = process.env.DISABLE_PLAYER_BOTS;
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});
function mixer(t, level) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('blamish' + next); p.setRegistered(true); p.setLocation(new core.Location(2897, 3511, 0)); p.needsPlacement = false;
  p.getSkillManager().setMaxLevel(core.Skill.HERBLORE, level, true).setCurrentLevel(core.Skill.HERBLORE, level, true);
  const c = new ClientConnection(channel); c.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', (m) => { messages.push(m); return p.getPacketSender(); });
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); });
  const I = core.ItemIdentifiers, inv = p.getInventory();
  inv.setItem(0, new core.Item(I.BLAMISH_SNAIL_SLIME, 1));
  inv.setItem(1, new core.Item(I.HARRALANDER_POTION_UNF_, 1));
  const raw = () => p.getSkillManager().skills.experience[core.Skill.HERBLORE.getIndex()];
  const use = async () => { await c.dispatch([{ type: 'inventory_use_on', itemId: I.BLAMISH_SNAIL_SLIME, slot: 0, target: { kind: 'inventory', slot: 1 } }]); c.processTurnPackets(); };
  return { p, inv, messages, raw, use };
}
test('at 25 Herblore the oil is made for 80 XP', async (t) => {
  const f = mixer(t, 25);
  const before = f.raw();
  await f.use();
  assert.equal(f.inv.getAmount(core.ItemIdentifiers.BLAMISH_OIL), 1, f.messages.join(' | '));
  assert.equal(f.raw() - before, 80);
});
test('at 24 Herblore nothing is used up', async (t) => {
  const f = mixer(t, 24);
  await f.use();
  const I = core.ItemIdentifiers;
  assert.equal(f.inv.getAmount(I.BLAMISH_OIL), 0);
  assert.equal(f.inv.getAmount(I.BLAMISH_SNAIL_SLIME), 1);
  assert.equal(f.inv.getAmount(I.HARRALANDER_POTION_UNF_), 1);
  assert.ok(f.messages.includes('You need a Herblore level of 25 to combine those.'), f.messages.join(' | '));
});
