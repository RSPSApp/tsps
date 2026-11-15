// Run after `yarn build`: node --test tests/potion-drink-lines.test.cjs
// The recorded drink lines of potions that sent none, from the rsprox.net index and the local
// recordings (docs/potion-drink-lines.md#lines-added-from-the-local-recordings).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const { Item } = require('../dist/game/model/Item');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(process.cwd());
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PluginManager.emitServerStartup({});
});

after(() => PluginManager.emitServerShutdown({}));

/** A player whose chat lines land in one list as `spam:` or `game:` lines, in order. */
function drinker(t) {
  const p = new Player(null);
  const out = [];
  p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(p, 'sendMessage', (m) => out.push(`game: ${m}`));
  t.mock.method(p, 'performAnimation', () => {});
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendTypedMessage', (type, m) => { out.push(`spam: ${m}`); return sender; });
  t.after(() => { p.setRegistered(false); TaskManager.cancelTasks(p); });
  return { p, out };
}

function drink(f, itemId) {
  f.p.getInventory().resetItems?.();
  f.p.getInventory().setItem(0, new Item(itemId, 1));
  const item = f.p.getInventory().getItems()[0];
  assert.equal(PluginManager.emitItemAction({ player: f.p, item, itemId, slot: 0, clickType: 1, handled: false }), true, String(itemId));
  return f.out.filter((line) => !line.includes('varp'));
}

const DOSE_LINES = [
  // rsprox local 1001355-1001362 (rev 240), 1001421 (rev 241): 55 drinks of energy potion(4)/(3).
  [I.ENERGY_POTION_3_, 'You drink some of your energy potion.', 'You have 2 doses of potion left.'],
  [I.ENERGY_POTION_1_, 'You drink some of your energy potion.', 'You have finished your potion.'],
  // rsprox local 1000410 (rev 227) tick 33404.
  [I.DEFENCE_POTION_3_, 'You drink some of your defence potion.', 'You have 2 doses of potion left.'],
  // rsprox local 1000438 (rev 227) tick 7793.
  [I.FISHING_POTION_4_, 'You drink some of your fishing potion.', 'You have 3 doses of potion left.'],
  // rsprox.net 907 (rev 235) tick 5746, local 1001295 (rev 236) tick 1321.
  [I.ANTIDOTE_3__3, 'You drink some of your antipoison potion.', 'You have 2 doses of potion left.'],
  // rsprox local 1002134 (rev 242) ticks 7054, 9585.
  [I.EXTENDED_ANTIFIRE_3_, 'You drink some of your extended antifire potion.', 'You have 2 doses of potion left.'],
  // rsprox local 1000463 (rev 227) tick 12180.
  [I.ANCIENT_BREW_3_, 'You drink some of the foul liquid.', 'You have 2 doses of potion left.'],
];

for (const [id, line, left] of DOSE_LINES) {
  test(`${line} (${id}) then the doses left, as spam`, (t) => {
    const f = drinker(t);
    assert.deepEqual(drink(f, id), [`spam: ${line}`, `spam: ${left}`]);
  });
}

/** Inside the Chambers of Xeric: the raid plugin's potions:area answer. */
function inRaid(t, player) {
  const emit = PluginManager.emitCustomEvent.bind(PluginManager);
  t.mock.method(PluginManager, 'emitCustomEvent', (name, payload) => {
    if (name === 'potions:area' && payload?.player === player) { payload.inside = true; return payload; }
    return emit(name, payload);
  });
}

// rsprox local 1000495 (rev 227): strong Xeric's aid(2) tick 2700, (1) ticks 2216/4476; strong
// revitalisation(3) tick 3002, (1) tick 2325. The gourd line is spam.
test("a strong CoX gourd sends its line, and the finished gourd line as spam", (t) => {
  for (const [id, line, last] of [
    [20982, "You drink some of your strong Xeric's aid potion.", 'You have 1 dose of potion left.'],
    [20981, "You drink some of your strong Xeric's aid potion.", 'You have finished your potion. The gourd vial disintegrates.'],
    [20959, 'You drink some of your strong revitalisation potion.', 'You have 2 doses of potion left.'],
    [20957, 'You drink some of your strong revitalisation potion.', 'You have finished your potion. The gourd vial disintegrates.'],
    // Already in the table before this change (rsprox local 1000468, rev 227).
    [20972, 'You drink some of your strong prayer enhance potion.', 'You have 3 doses of potion left.'],
  ]) {
    const f = drinker(t);
    inRaid(t, f.p);
    assert.deepEqual(drink(f, id), [`spam: ${line}`, `spam: ${last}`], String(id));
  }
});

// rsprox.net rec 365 (rev 231): Drink on a Moonlight mead, the two lines as spam, a beer glass left.
test('Moonlight mead sends its two recorded lines and leaves a beer glass', (t) => {
  const f = drinker(t);
  assert.deepEqual(drink(f, I.MOONLIGHT_MEAD), ['spam: You drink the foul smelling brew.', 'spam: It tastes like something just died in your mouth.']);
  assert.equal(f.p.getInventory().getItems()[0].getId(), I.BEER_GLASS);
});
