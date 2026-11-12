const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const DATA = require('../plugins/skills/data/bolt-enchanting.json');

// Crossbow Bolt Enchantments: rsprox recordings 89, 239 and 1749 (menu, cast timing, animation, graphic, sound,
// message, ten bolts and a gem's XP per cast, a last cast of the bolts left) and the Wiki Enchant_Crossbow_Bolt
// table for levels, runes and XP.
let core;
let tasks;
const ids = {};

before(async () => {
  await CachePipeline.initialize(process.cwd());
  core = PluginManager.getCoreApi();
  tasks = [];
  const api = PluginManager.createApi('BoltEnchantingTest');
  const stubbed = { ...api, core: { ...api.core, TaskManager: { submit: task => tasks.push(task) }, Task: api.core.Task } };
  require('../plugins/skills/BoltEnchanting.plugin').register(stubbed);
  for (const gem of DATA.gems) for (const [from, to] of gem.bolts) { ids[from] = core.ItemIds[from]; ids[to] = core.ItemIds[to]; }
});

function playerWith(entries, level = 99) {
  const amounts = new Map(entries), log = [], attrs = new Map();
  const inventory = {
    getAmount: id => amounts.get(id) ?? 0,
    contains: id => (amounts.get(id) ?? 0) > 0,
    getFreeSlots: () => 28 - [...amounts].filter(([, n]) => n > 0).length,
    deleteNumber: (id, n) => { amounts.set(id, Math.max(0, (amounts.get(id) ?? 0) - n)); return inventory; },
    deletes: item => inventory.deleteNumber(item.id, item.getAmount()),
    adds: (id, n) => { amounts.set(id, (amounts.get(id) ?? 0) + n); return inventory; },
    refreshItems: () => inventory,
  };
  const sender = {
    sendSound(id) { log.push(['sound', id]); return sender; },
    sendTypedMessage(type, text) { log.push([type === core.ChatType.SPAM ? 'spam' : 'typed', text]); return sender; },
    sendCreationMenu(menu) { player.menu = menu; return sender; },
  };
  const player = {
    amounts, log, menu: null, level, book: core.MagicSpellbook.NORMAL,
    getInventory: () => inventory,
    getEquipment: () => ({ containsAllItem: () => true, getItems: () => [] }),
    getSkillManager: () => ({ getCurrentLevel: () => player.level, addExperiences: (skill, xp) => log.push(['xp', skill, xp]) }),
    getCombat: () => ({ reset() {}, setCastSpell() {} }), getSpellbook: () => player.book,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getPacketSender: () => sender, sendMessage: text => log.push(['message', text]),
    performAnimation: anim => log.push(['animation', anim.getId()]),
    performGraphic: gfx => log.push(['graphic', gfx.getId()]),
    getIndex: () => 1, isRegistered: () => true, getHitpoints: () => 99,
  };
  return player;
}

function cast(player) {
  return PluginManager.emitSpellCast({ player, spellName: 'Crossbow Bolt Enchantments', spellWidget: 0, spellItemId: -1, opId: 1, handled: false });
}
const RUBY_RUNES = [[core => core.ItemIds.FIRE_RUNE, 5], [core => core.ItemIds.BLOOD_RUNE, 1], [core => core.ItemIds.COSMIC_RUNE, 1]];
function rubyRunes(times) { return RUBY_RUNES.map(([id, n]) => [id(core), n * times]); }
function runTicks(count) {
  for (let i = 0; i < count; i++) for (const task of [...tasks]) { if (task.isRunning === false) continue; task.execute(); }
}

test('every recipe names real, distinct bolts: an unenchanted kind and its (e) twin', () => {
  for (const gem of DATA.gems) for (const [from, to] of gem.bolts) {
    const input = core.ItemDefinition.forId(core.ItemIds[from]), output = core.ItemDefinition.forId(core.ItemIds[to]);
    assert.ok(Number.isInteger(core.ItemIds[from]) && Number.isInteger(core.ItemIds[to]), `${from} ${to}`);
    assert.equal(output.getName(), `${input.getName()} (e)`.replace('Red Topaz', 'Topaz'), `${from}`);
    assert.ok(input.isStackable() && output.isStackable());
  }
});

test('the cache spell is the Crossbow Bolt Enchantments entry at Magic level 4', () => {
  assert.equal(core.CacheDefinitions.getSpellRequirements(DATA.spell).level, 4);
});

test('with no bolts the click answers "You have no bolts to enchant." and opens no menu', () => {
  const player = playerWith([]);
  assert.equal(cast(player), true);
  assert.deepEqual(player.log, [['message', 'You have no bolts to enchant.']]);
  assert.equal(player.menu, null);
});

test('the menu offers the enchanted form of each kind carried, in the captured shape', () => {
  const player = playerWith([[core.ItemIds.RUBY_BOLTS, 314], [core.ItemIds.ONYX_DRAGON_BOLTS, 5]]);
  cast(player);
  assert.equal(player.menu.getTitle(), 'How many sets of bolts to enchant?');
  assert.deepEqual(player.menu.getItems(), [core.ItemIds.RUBY_BOLTS_E_, core.ItemIds.ONYX_DRAGON_BOLTS_E_]);
  assert.equal(player.menu.getOptions().mode, 3);
  assert.equal(player.menu.getOptions().maxAmount, 10);
});

test('only kinds the Magic level reaches are offered; short of all of them it names the level', () => {
  const player = playerWith([[core.ItemIds.OPAL_BOLTS, 20], [core.ItemIds.RUBY_BOLTS, 20]], 4);
  cast(player);
  assert.deepEqual(player.menu.getItems(), [core.ItemIds.OPAL_BOLTS_E_]);
  const short = playerWith([[core.ItemIds.RUBY_BOLTS, 20]], 30);
  cast(short);
  assert.equal(short.menu, null);
  assert.deepEqual(short.log, [['message', 'You need a Magic level of 49 to cast this spell.']]);
});

test('a set enchants ten bolts for their runes and XP: first now, the next 2 ticks later, then every 3', () => {
  tasks.length = 0;
  const player = playerWith([[core.ItemIds.RUBY_BOLTS, 24], ...rubyRunes(3)]);
  cast(player);
  player.menu.execute(core.ItemIds.RUBY_BOLTS_E_, 10);
  const enchanted = () => player.amounts.get(core.ItemIds.RUBY_BOLTS_E_) ?? 0;
  // Cast 1 on choosing: 4462, 759, 2921, the message and 59 XP (rsprox 89, 239).
  assert.equal(enchanted(), 10);
  assert.equal(player.amounts.get(core.ItemIds.RUBY_BOLTS), 14);
  assert.deepEqual(player.log.filter(([kind]) => kind !== 'xp'), [
    ['animation', 4462], ['graphic', 759], ['sound', 2921],
    ['spam', 'The magic of the runes coaxes out the true nature of the gem tips.'],
  ]);
  assert.deepEqual(player.log.find(([kind]) => kind === 'xp').slice(2), [59]);
  assert.equal(player.amounts.get(core.ItemIds.COSMIC_RUNE), 2);
  assert.equal(player.amounts.get(core.ItemIds.FIRE_RUNE), 10);
  runTicks(1);
  assert.equal(enchanted(), 10, 'tick 1: not yet');
  runTicks(1);
  assert.equal(enchanted(), 20, 'cast 2 on tick 2');
  runTicks(2);
  assert.equal(enchanted(), 20, 'tick 4: not yet');
  runTicks(1);
  // Cast 3 on tick 5 takes the last four bolts (rsprox 89: 14, 4 then 0 left).
  assert.equal(enchanted(), 24);
  assert.equal(player.amounts.get(core.ItemIds.RUBY_BOLTS), 0);
  runTicks(3);
  assert.equal(enchanted(), 24, 'nothing left to enchant');
});

test('a cast without its runes enchants nothing and takes nothing', () => {
  tasks.length = 0;
  const player = playerWith([[core.ItemIds.RUBY_BOLTS, 20]]);
  cast(player);
  player.menu.execute(core.ItemIds.RUBY_BOLTS_E_, 10);
  assert.equal(player.amounts.get(core.ItemIds.RUBY_BOLTS), 20);
  assert.equal(player.amounts.get(core.ItemIds.RUBY_BOLTS_E_) ?? 0, 0);
  assert.equal(player.log.some(([kind]) => kind === 'xp'), false);
});

test('the chosen sets cap the casts, and every gem takes its Wiki runes, level and XP', () => {
  for (const gem of DATA.gems) {
    tasks.length = 0;
    const [from, to] = gem.bolts[0];
    const runes = gem.runes.map(([name, n]) => [core.ItemIds[name], n * 2]);
    const player = playerWith([[core.ItemIds[from], 50], ...runes], gem.level);
    cast(player);
    assert.deepEqual(player.menu.getItems(), [core.ItemIds[to]], gem.gem);
    player.menu.execute(core.ItemIds[to], 2);
    runTicks(10);
    assert.equal(player.amounts.get(core.ItemIds[to]), 20, gem.gem);
    assert.equal(player.amounts.get(core.ItemIds[from]), 30, gem.gem);
    assert.deepEqual(player.log.filter(([kind]) => kind === 'xp').map(entry => entry[2]), [gem.xp, gem.xp], gem.gem);
    for (const [name] of gem.runes) assert.equal(player.amounts.get(core.ItemIds[name]), 0, `${gem.gem} ${name}`);
  }
});

test('a cast with no room for the enchanted bolts keeps its runes', () => {
  tasks.length = 0;
  const fillers = Array.from({ length: 24 }, (_, i) => [900000 + i, 1]);
  const player = playerWith([[core.ItemIds.RUBY_BOLTS, 20], ...rubyRunes(2), ...fillers]);
  assert.equal(player.getInventory().getFreeSlots(), 0);
  cast(player);
  player.menu.execute(core.ItemIds.RUBY_BOLTS_E_, 1);
  assert.equal(player.amounts.get(core.ItemIds.RUBY_BOLTS), 20);
  assert.equal(player.amounts.get(core.ItemIds.RUBY_BOLTS_E_) ?? 0, 0);
  for (const [id, n] of rubyRunes(2)) assert.equal(player.amounts.get(id), n);
  assert.ok(player.log.some(([kind, text]) => kind === 'message' && /enough inventory space/.test(text)));
  assert.equal(player.log.some(([kind]) => kind === 'xp'), false);
});
