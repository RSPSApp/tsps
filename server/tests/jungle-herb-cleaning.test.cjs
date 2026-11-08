// Run after `yarn build`: node --test tests/jungle-herb-cleaning.test.cjs
// rsprox_transcripts/227/01875.txt: Clean on grimy snake weed in slot 9 -> "You clean the Grimy snake weed." (spam),
// snake weed in slot 9 and a cleaning sound (3920-3922). Jungle Potion's own handler said "You clean the snake weed."
// as a plain message, moved the herb to the first free slot and played no sound.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, next = 9910;
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
function cleaner(t, level) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('jungle' + next); p.setRegistered(true); p.setLocation(new core.Location(2762, 3042, 0)); p.needsPlacement = false;
  p.getSkillManager().setMaxLevel(core.Skill.HERBLORE, level, true).setCurrentLevel(core.Skill.HERBLORE, level, true);
  const c = new ClientConnection(channel); c.player = p;
  const plain = [], spam = [], sounds = [];
  const sender = p.getPacketSender(), typed = sender.sendTypedMessage.bind(sender), sound = sender.sendSound.bind(sender);
  t.mock.method(sender, 'sendMessage', (m) => { plain.push(m); return sender; });
  t.mock.method(sender, 'sendTypedMessage', (type, m, ...r) => { if (type === core.ChatType.SPAM) spam.push(m); else plain.push(m); return typed(type, m, ...r); });
  t.mock.method(sender, 'sendSound', (id, ...r) => { sounds.push(id); return sound(id, ...r); });
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); });
  p.getInventory().setItem(9, new core.Item(core.ItemIdentifiers.GRIMY_SNAKE_WEED, 1));
  const raw = () => p.getSkillManager().skills.experience[core.Skill.HERBLORE.getIndex()];
  const clean = async () => {
    const w = core.CacheDefinitions.getComponentId('inventory:items');
    await c.dispatch([{ type: 'widget_action', widgetId: w, groupId: w >>> 16, childId: w & 65535, buttonNum: 2, slot: 9, itemId: core.ItemIdentifiers.GRIMY_SNAKE_WEED }]);
    c.processTurnPackets();
  };
  return { p, plain, spam, sounds, raw, clean };
}
test('Clean on grimy snake weed: the clean herb in the same slot, the captured spam line, a cleaning sound, 2.5 XP', async (t) => {
  const f = cleaner(t, 3);
  const before = f.raw();
  await f.clean();
  assert.equal(f.p.getInventory().forSlot(9)?.getId(), core.ItemIdentifiers.SNAKE_WEED, 'snake weed in slot 9');
  assert.deepEqual(f.spam, ['You clean the Grimy snake weed.']);
  assert.ok(f.sounds.some((id) => id >= 3920 && id <= 3923), `${f.sounds}`);
  assert.equal(f.raw() - before, 2.5);
});
test('below level 3 the herb stays grimy', async (t) => {
  const f = cleaner(t, 2);
  await f.clean();
  assert.equal(f.p.getInventory().forSlot(9)?.getId(), core.ItemIdentifiers.GRIMY_SNAKE_WEED);
  assert.deepEqual(f.plain, ['You need level 3 Herblore to clean the Grimy snake weed.']);
});
