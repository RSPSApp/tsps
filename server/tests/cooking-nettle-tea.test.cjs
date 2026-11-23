// Run after `yarn build`: node --test tests/cooking-nettle-tea.test.cjs
// Nettle tea (rsprox capture 1001702, rev 242; Wiki Nettle tea, Nettle-water, Cup of tea (nettle)):
// nettles on a bowl of water make nettle-water a tick later, in the bowl's slot, with "You place
// the nettles into the bowl of water."; nettle-water on a stove plays human_cooking with sound fry
// and "You boil the water and make nettle tea." for 52 XP. The Wiki's chart (78/412) lets the water
// boil over, leaving an empty bowl. The tea pours into an empty or porcelain cup, and milk into the
// tea, in the slots the Ghosts Ahoy capture shows, with sound 2401 and no line.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Cookers = require('../plugins/skills/cooking/Cookers.Cooking');
let core, next = 3720;
const bots = process.env.DISABLE_PLAYER_BOTS;
const AT = [3077, 3496, 0]; // beside the Edgeville house stove (100_dave_stove) the capture used
const BOIL_LINE = 'You boil the water and make nettle tea.';
const PLACE_LINE = 'You place the nettles into the bowl of water.';

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});

const obj = (name) => core.CacheDefinitions.getObjId(name);

/** A cook at `level` with `carried` gamevals (one per slot, in order) beside a stove. */
function setup(t, carried, level = 99) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('nettle' + next); p.setRegistered(true); p.setLocation(new core.Location(...AT)); p.needsPlacement = false;
  p.getSkillManager().setMaxLevel(core.Skill.COOKING, level, true).setCurrentLevel(core.Skill.COOKING, level, true);
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  carried.forEach((name, slot) => { if (name) p.getInventory().setItem(slot, new core.Item(obj(name), 1)); });
  const object = new core.GameObject(core.CacheDefinitions.getLocId('100_dave_stove'), new core.Location(AT[0], AT[1] - 1, 0), 10, 0, null);
  core.ObjectManager.register(object, true);
  t.after(() => core.ObjectManager.deregister(object, true));
  const sent = { spam: [], messages: [], sounds: [], anims: [], statements: [] };
  const sender = p.getPacketSender();
  const typed = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, 'sendTypedMessage', (type, text) => { sent.spam.push(text); return typed(type, text); });
  const message = p.sendMessage.bind(p);
  t.mock.method(p, 'sendMessage', (text) => { sent.messages.push(text); return message(text); });
  t.mock.method(core.Sounds, 'sendSound', (_player, sound) => { sent.sounds.push(sound.getId?.() ?? sound.id); });
  const perform = p.performAnimation.bind(p);
  t.mock.method(p, 'performAnimation', (animation) => { sent.anims.push(animation.getId?.() ?? animation.id); return perform(animation); });
  const manager = p.getDialogueManager();
  const start = manager.startDialogues.bind(manager);
  t.mock.method(manager, 'startDialogues', (chain) => { sent.statements.push(chain); return start(chain); });
  return { p, object, sent, inv: p.getInventory() };
}

function useOn(p, used, withItem) {
  const items = p.getInventory().getItems();
  const a = items.findIndex((item) => item?.getId() === obj(used));
  const b = items.findIndex((item) => item?.getId() === obj(withItem));
  return PM.emitItemOnItem({ player: p, usedItem: items[a], usedItemId: obj(used), usedItemSlot: a, usedWithItem: items[b], usedWithItemId: obj(withItem), usedWithItemSlot: b, handled: false });
}

function cookOn(p, object, name) {
  const slot = p.getInventory().getSlotForItemId(obj(name));
  Cookers._test.handleCook({ player: p, object, objectId: object.getId(), itemId: obj(name), item: p.getInventory().get(slot), itemSlot: slot, handled: false });
}

function ticks(n, roll = 0.99) {
  const previous = Math.random;
  Math.random = () => roll;
  try { for (let i = 0; i < n; i++) core.TaskManager.process(); } finally { Math.random = previous; }
}

const at = (inv, slot) => inv.getItems()[slot]?.getId() ?? -1;

test('nettles on a bowl of water: nettle-water a tick later in the bowl\'s slot (capture 1001702 tick 15607)', (t) => {
  const { p, sent, inv } = setup(t, [null, null, 'nettles_picked', null, null, 'bowl_water']);
  const xp = p.getSkillManager().getExperience(core.Skill.COOKING);
  assert.equal(useOn(p, 'bowl_water', 'nettles_picked'), true);
  assert.equal(at(inv, 5), obj('bowl_water'), 'nothing on the click tick');
  ticks(1);
  assert.equal(at(inv, 2), -1, 'the nettles\' slot empties');
  assert.equal(at(inv, 5), obj('bowl_nettlewater'), 'the bowl\'s slot holds the nettle-water');
  assert.deepEqual(sent.spam, [PLACE_LINE]);
  assert.equal(p.getSkillManager().getExperience(core.Skill.COOKING), xp, 'no XP (Wiki Nettle-water)');
});

test('nettle-water needs 20 Cooking (Wiki Nettle-water)', (t) => {
  const { sent, inv, p } = setup(t, ['nettles_picked', 'bowl_water'], 19);
  useOn(p, 'nettles_picked', 'bowl_water');
  ticks(2);
  assert.equal(inv.getAmount(obj('bowl_nettlewater')), 0);
  assert.equal(inv.getAmount(obj('nettles_picked')), 1);
  assert.equal(sent.statements.length, 1, 'a message box refuses it');
});

test('nettle-water on the stove: human_cooking, fry, the captured line and 52 XP (capture 1001702 tick 15651)', (t) => {
  const { p, object, sent, inv } = setup(t, [null, null, null, null, null, 'bowl_nettlewater']);
  const xp = p.getSkillManager().getExperience(core.Skill.COOKING);
  cookOn(p, object, 'bowl_nettlewater');
  ticks(4);
  assert.equal(inv.getAmount(obj('bowl_nettlewater')), 0);
  assert.equal(inv.getAmount(obj('bowl_nettletea')), 1);
  assert.ok(sent.spam.includes(BOIL_LINE));
  assert.ok(sent.anims.includes(core.CacheDefinitions.getSeqId('human_cooking')));
  assert.ok(sent.sounds.includes(core.Sound.COOKING_COOK.getId?.() ?? core.Sound.COOKING_COOK.id));
  assert.equal(p.getSkillManager().getExperience(core.Skill.COOKING) - xp, 52 * core.GameConstants.EXPERIENCE_MULTIPLIER);
  assert.equal(p.getAttribute('cooking:success-count'), 1);
});

test('the water can boil over, leaving the empty bowl and no XP (Wiki Nettle tea)', (t) => {
  const { p, object, sent, inv } = setup(t, ['bowl_nettlewater'], 20);
  const xp = p.getSkillManager().getExperience(core.Skill.COOKING);
  cookOn(p, object, 'bowl_nettlewater');
  ticks(4, 0);
  assert.equal(inv.getAmount(obj('bowl_nettletea')), 0);
  assert.equal(inv.getAmount(obj('bowl_empty')), 1);
  assert.ok(sent.spam.includes('The water boils over.'));
  assert.equal(p.getSkillManager().getExperience(core.Skill.COOKING), xp);
});

test('the boil follows the Wiki chart (78/412): 56.3% at 20, never boils over from 53', (t) => {
  const cookable = Cookers._test.cookableFor(obj('bowl_nettlewater'));
  for (const [level, expected] of [[20, 144 / 256], [53, 1]]) {
    const { p, object } = setup(t, [], level);
    assert.equal(Cookers._test.successChance(p, cookable, object.getId(), 'range', object.getLocation()), expected, `level ${level}`);
  }
});

for (const [poured, into, emptied, made] of [
  ['bowl_nettletea', 'cup_empty', 'bowl_empty', 'cup_of_nettletea'],
  ['bowl_nettletea_milky', 'cup_empty', 'bowl_empty', 'cup_of_nettletea_milky'],
  ['bucket_milk', 'bowl_nettletea', 'bucket_empty', 'bowl_nettletea_milky'],
  ['bucket_milk', 'cup_of_nettletea', 'bucket_empty', 'cup_of_nettletea_milky'],
  ['bowl_nettletea', 'chinacup_empty', 'bowl_empty', 'chinacup_of_nettletea'],
]) {
  test(`${poured} into ${into}: ${made} in its slot, ${emptied} in the other, sound 2401, no line`, (t) => {
    const { p, sent, inv } = setup(t, [null, into, null, poured]);
    for (const [first, second] of [[poured, into]]) assert.equal(useOn(p, first, second), true);
    assert.equal(at(inv, 1), obj(made));
    assert.equal(at(inv, 3), obj(emptied));
    assert.deepEqual(sent.sounds, [2401]);
    assert.deepEqual(sent.spam, []);
    assert.deepEqual(sent.messages, []);
  });
}

test('either way round: the empty cup used on the tea pours the same', (t) => {
  const { p, inv } = setup(t, ['cup_empty', 'bowl_nettletea']);
  assert.equal(useOn(p, 'cup_empty', 'bowl_nettletea'), true);
  assert.equal(at(inv, 0), obj('cup_of_nettletea'));
  assert.equal(at(inv, 1), obj('bowl_empty'));
});
