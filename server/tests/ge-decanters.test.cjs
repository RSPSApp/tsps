// Run after `yarn build`: node --test tests/ge-decanters.test.cjs
//
// The Grand Exchange decanters against rsprox (Bob Barter: 226/01637, 226/01671; Murky Matt:
// 226/01671, 232/03238, 238/04168) and the Wiki, with a real Player and Inventory.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

let Decanters, core;
const events = new Map();
const npcs = {};
let click;

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    onCustomEvent: (name, fn) => events.set(name, fn),
    emitCustomEvent: (name, request) => events.get(name)?.(request),
    onNpcInteraction: (name, actions) => { if (typeof name === 'string') npcs[name] = actions; },
    onInterfaceActionClick: (fn) => { click = fn; },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require('../plugins/items/Potions.plugin').register(api);
  Decanters = require('../plugins/npcs/GeDecanters.plugin');
  Decanters.register(api);
});

const obj = (name) => core.CacheDefinitions.getObjId(name);
const note = (name) => core.ItemDefinition.forId(obj(name)).getNoteId();

function player(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.lines = [];
  p.chatbox = [];
  t.mock.method(p, 'getDialogueManager', () => ({ startDialogues: (b) => { for (const d of b.getDialogues().values()) p.lines.push(d.getText()); } }));
  // No client: only the session's writes are stubbed; the chatbox state is the real sender's.
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p.getPacketSender(), 'sendSoundEffect', () => p.getPacketSender());
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  return p;
}

const give = (p, id, amount = 1) => { for (let i = 0; i < (core.ItemDefinition.forId(id).isStackable() ? 1 : amount); i++) p.getInventory().add(new core.Item(id, core.ItemDefinition.forId(id).isStackable() ? amount : 1)); };
const has = (p, id) => p.getInventory().getAmount(id);
const bob = (p, doses) => {
  npcs['Bob Barter (herbs)'].Decant({ player: p });
  assert.ok(p.getPacketSender().isChatboxInterface(582), 'the decant interface');
  click({ player: p, groupId: 582, childId: doses + 2, handled: false });
};

test('Bob, unnoted (226/01637): 4 x 2-dose and 11 x 1-dose staminas into 4 x 4-dose and a 3-dose, with 10 vials', (t) => {
  const p = player(t);
  give(p, obj('2dosestamina'), 4);
  give(p, obj('1dosestamina'), 11);
  bob(p, 4);
  assert.equal(has(p, obj('4dosestamina')), 4);
  assert.equal(has(p, obj('3dosestamina')), 1);
  assert.equal(has(p, obj('2dosestamina')) + has(p, obj('1dosestamina')), 0);
  assert.equal(has(p, obj('vial_empty')), 10);
  assert.deepEqual(p.lines, ['There, all done.']);
});

test('Bob, noted (226/01671): 20 x 1-dose and 21 x 2-dose super restores into 15 x 4-dose and a 2-dose, vials noted; a lone potion stays', (t) => {
  const p = player(t);
  give(p, note('1dose2restore'), 20);
  give(p, note('2dose2restore'), 21);
  give(p, obj('2dose1energy'), 1);
  bob(p, 4);
  assert.equal(has(p, note('4dose2restore')), 15);
  assert.equal(has(p, note('2dose2restore')), 1);
  assert.equal(has(p, note('vial_empty')), 25);
  assert.equal(has(p, obj('2dose1energy')), 1, 'a lone potion has nothing to pool with');
});

test("Bob splits into 1-dose potions with the player's vials, then sells the rest at 5 coins each (Wiki)", (t) => {
  const p = player(t);
  give(p, obj('4dosestamina'), 1);
  give(p, obj('vial_empty'), 1);
  give(p, 995, 100);
  bob(p, 1);
  assert.equal(has(p, obj('1dosestamina')), 4);
  assert.equal(has(p, obj('vial_empty')), 0);
  assert.equal(has(p, 995), 90, 'two vials bought');
});

test('Bob without room (226/01671): what fits is done, the rest left, and "a bit short of inventory space"', (t) => {
  const p = player(t);
  give(p, obj('4dosestamina'), 1);
  for (let i = 0; i < 26; i++) give(p, 1511, 1);
  give(p, 995, 100);
  bob(p, 1);
  assert.equal(has(p, obj('4dosestamina')), 1, 'four 1-dose potions need three more slots');
  assert.deepEqual(p.lines, ["You're a bit short of inventory space."]);
  const none = player(t);
  bob(none, 4);
  assert.deepEqual(none.lines, ["I don't think you've got anything that I can decant."]);
});

test('Matt (226/01671): noted glory 1 + 3 into a glory(4) and an uncharged glory; 44 dueling charges into 5 x (8) and a (4); glory(6)s untouched', (t) => {
  const p = player(t);
  give(p, note('amulet_of_glory_1'), 1);
  give(p, note('amulet_of_glory_3'), 1);
  give(p, note('amulet_of_glory_6'), 4);
  give(p, note('ring_of_dueling_3'), 1);
  give(p, note('ring_of_dueling_4'), 2);
  give(p, note('ring_of_dueling_5'), 1);
  give(p, note('ring_of_dueling_7'), 4);
  npcs['Murky Matt (runes)'].Decant({ player: p });
  assert.equal(has(p, note('amulet_of_glory_4')), 1);
  assert.equal(has(p, note('amulet_of_glory')), 1, 'the emptied glory comes back uncharged');
  assert.equal(has(p, note('amulet_of_glory_6')), 4, 'past its normal capacity');
  assert.equal(has(p, note('ring_of_dueling_8')), 5);
  assert.equal(has(p, note('ring_of_dueling_4')), 1);
  assert.equal(has(p, note('ring_of_dueling_7')) + has(p, note('ring_of_dueling_5')) + has(p, note('ring_of_dueling_3')), 0, 'emptied rings are gone');
  assert.deepEqual(p.lines, ['Arr, all done.']);
});

test("Matt's refusals (232/03238): the Fountain of Rune for glory 2 + 5, and plain for two full rings or none", (t) => {
  const glory = player(t);
  give(glory, obj('amulet_of_glory_2'), 1);
  give(glory, obj('amulet_of_glory_5'), 1);
  npcs['Murky Matt (runes)'].Decant({ player: glory });
  assert.match(glory.lines[0], /charge it on the Fountain of Rune/);
  const full = player(t);
  give(full, obj('ring_of_dueling_8'), 2);
  npcs['Murky Matt (runes)'].Decant({ player: full });
  assert.deepEqual(full.lines, ["Arrr, ye've got nothing that I can combine."]);
  const unnoted = player(t);
  give(unnoted, obj('ring_of_dueling_7'), 2);
  npcs['Murky Matt (runes)'].Decant({ player: unnoted });
  assert.equal(has(unnoted, obj('ring_of_dueling_8')), 1);
  assert.equal(has(unnoted, obj('ring_of_dueling_6')), 1, 'recorded: 7 + 7 is 8 + 6');
});

const I = () => core.ItemIdentifiers;

test('families come from the cache: two Attack mix(1)s make an Attack mix(2), the mixes topping out at 2', (t) => {
  const p = player(t);
  give(p, I().ATTACK_MIX_1_, 2);
  bob(p, 4);
  assert.equal(has(p, I().ATTACK_MIX_2_), 1);
  assert.equal(has(p, I().ATTACK_MIX_1_), 0);
  assert.equal(has(p, obj('vial_empty')), 1);
});

test('only vial potions: Guthix rest (a cup) and Egniol (no vessel) are left as they are', (t) => {
  const p = player(t);
  give(p, I().GUTHIX_REST_1_, 4);
  give(p, I().EGNIOL_POTION_2_, 2);
  bob(p, 4);
  assert.equal(has(p, I().GUTHIX_REST_1_), 4);
  assert.equal(has(p, I().EGNIOL_POTION_2_), 2);
  assert.equal(has(p, obj('vial_empty')), 0, 'no vial out of nowhere');
  assert.deepEqual(p.lines, ["I don't think you've got anything that I can decant."]);
});

test("a noted split uses the player's noted vials before buying any", (t) => {
  const p = player(t);
  give(p, note('4dosestamina'), 10);
  give(p, note('vial_empty'), 1000);
  give(p, 995, 1000);
  bob(p, 1);
  assert.equal(has(p, note('1dosestamina')), 40);
  assert.equal(has(p, note('vial_empty')), 970);
  assert.equal(has(p, 995), 1000, 'nothing bought');
});

test('the buttons only work while the decant interface is open', (t) => {
  const p = player(t);
  give(p, obj('2dosestamina'), 2);
  npcs['Bob Barter (herbs)'].Decant({ player: p });
  p.getPacketSender().sendInterfaceRemoval();
  const event = { player: p, groupId: 582, childId: 6, handled: false };
  click(event);
  assert.equal(event.handled, false);
  assert.equal(has(p, obj('2dosestamina')), 2);
  const never = player(t);
  give(never, obj('2dosestamina'), 2);
  click({ player: never, groupId: 582, childId: 6, handled: false });
  assert.equal(has(never, obj('2dosestamina')), 2, 'not opened at all');
});

test('room counts the vials and coins a split spends; a vial stack at its limit is short, not clamped', (t) => {
  const p = player(t);
  give(p, obj('4dosestamina'), 1);
  give(p, obj('vial_empty'), 3);
  for (let i = 0; i < 24; i++) give(p, 1511, 1);
  bob(p, 1);
  assert.equal(has(p, obj('1dosestamina')), 4, 'the potion and its three vials free the four slots');
  assert.deepEqual(p.lines, ['There, all done.']);
  const capped = player(t);
  give(capped, note('vial_empty'), 2147483646);
  give(capped, note('1dosestamina'), 4);
  bob(capped, 4);
  assert.equal(has(capped, note('1dosestamina')), 4, 'three more vials would overflow the stack');
  assert.equal(has(capped, note('vial_empty')), 2147483646);
  assert.deepEqual(capped.lines, ["You're a bit short of inventory space."]);
});

test("short of coins for the vials, Bob says so instead of claiming there's nothing to decant", (t) => {
  const p = player(t);
  give(p, obj('4dosestamina'), 1);
  give(p, obj('vial_empty'), 1);
  give(p, 995, 9);
  bob(p, 1);
  assert.equal(has(p, obj('4dosestamina')), 1);
  assert.equal(has(p, 995), 9);
  assert.deepEqual(p.lines, ["You'll need some coins for the vials I'd have to give you."]);
});

// ---------------------------------------------------------------- review #1260: the planned inventory

test('a preset (metadata) potion is never touched: the plain one beside it is the one decanted', (t) => {
  const p = player(t);
  const id = obj('4dose2strength');
  p.getInventory().add(new core.Item(id, 1, { preset: 'pvp-arena' }));
  p.getInventory().add(new core.Item(id, 1));
  give(p, obj('vial_empty'), 3);
  bob(p, 1);
  const items = p.getInventory().getItems().filter((item) => item && item.getId() > 0);
  const tagged = items.filter((item) => item.getMeta?.()?.preset === 'pvp-arena');
  assert.equal(tagged.length, 1, 'the preset copy is still there');
  assert.equal(tagged[0].getId(), id);
  assert.equal(has(p, obj('1dose2strength')), 4, 'only the plain one was split');
});

test("two families can't both spend the same coins: the second is left whole, no doses lost", (t) => {
  const p = player(t);
  give(p, obj('4dosestamina'), 1);
  give(p, obj('4dose2restore'), 1);
  give(p, 995, 5);
  for (let i = 0; i < 25; i++) give(p, 1511, 1);
  bob(p, 2);
  const doses = (prefix) => [1, 2, 3, 4].reduce((n, d) => n + d * has(p, obj(`${d}dose${prefix}`)), 0);
  assert.equal(doses('stamina'), 4, 'stamina doses kept');
  assert.equal(doses('2restore'), 4, 'restore doses kept');
  assert.equal(has(p, 995), 0, 'one vial bought, once');
  assert.equal(has(p, obj('2dosestamina')) + has(p, obj('2dose2restore')), 2, 'exactly one family split');
});

test('a result that would pass the stack limit is refused whole (noted glories at the limit)', (t) => {
  const p = player(t);
  give(p, note('amulet_of_glory_2'), 2147483647);
  give(p, note('amulet_of_glory_3'), 2147483647);
  npcs['Murky Matt (runes)'].Decant({ player: p });
  assert.equal(has(p, note('amulet_of_glory_2')), 2147483647);
  assert.equal(has(p, note('amulet_of_glory_3')), 2147483647);
  assert.equal(has(p, note('amulet_of_glory_4')), 0);
});

test("Matt's result doesn't depend on order: a family refused for room is done once another frees it", (t) => {
  const p = player(t);
  give(p, note('ring_of_dueling_3'), 3);
  for (let i = 0; i < 25; i++) give(p, 4151, 1);
  give(p, obj('necklace_of_minigames_1'), 1);
  give(p, obj('necklace_of_minigames_7'), 1);
  npcs['Murky Matt (runes)'].Decant({ player: p });
  assert.equal(has(p, obj('necklace_of_minigames_8')), 1);
  assert.equal(has(p, note('ring_of_dueling_8')), 1);
  assert.equal(has(p, note('ring_of_dueling_1')), 1, '9 charges: an (8) and a (1)');
  assert.deepEqual(p.lines, ['Arr, all done.']);
});

test('item id 0 (Dwarf remains) is a real item: it stays, and nothing is put in its slot', (t) => {
  const p = player(t);
  p.getInventory().add(new core.Item(0, 1));
  give(p, obj('1dosestamina'), 2);
  bob(p, 4);
  assert.equal(has(p, obj('2dosestamina')), 1);
  assert.equal(p.getInventory().getAmount(0), 1, 'the remains are kept');
  assert.equal(p.getInventory().getItems()[0].getId(), 0);
});

test("the buttons do nothing mid-trade (the trade's room check is already done)", (t) => {
  const p = player(t);
  give(p, obj('1dosestamina'), 2);
  npcs['Bob Barter (herbs)'].Decant({ player: p });
  t.mock.method(p, 'busy', () => true);
  click({ player: p, groupId: 582, childId: 6, handled: false });
  assert.equal(has(p, obj('1dosestamina')), 2);
});

test("Bob's cost doesn't depend on slot order: spare vials from one family go to another before any are bought", (t) => {
  for (const order of [['4dosestamina', '1dose2restore'], ['1dose2restore', '4dosestamina']]) {
    const p = player(t);
    for (const name of order) give(p, obj(name), name === '1dose2restore' ? 2 : 1);
    give(p, 995, 5);
    bob(p, 2);
    assert.equal(has(p, 995), 5, `${order.join(' then ')}: nothing bought`);
    assert.equal(has(p, obj('vial_empty')), 0, 'the spare vial was used');
  }
});

test("Zahur's Decant (230/00333): the same interface, free, and he speaks the result", (t) => {
  const p = player(t);
  const speakers = [];
  t.mock.method(p, 'getDialogueManager', () => ({ startDialogues: (b) => { for (const d of b.getDialogues().values()) { p.lines.push(d.getText()); speakers.push(d.getNpcId()); } } }));
  give(p, obj('3doseprayerrestore'), 2);
  assert.ok(npcs.Zahur?.Decant, 'Zahur has Decant');
  npcs.Zahur.Decant({ player: p, npcId: core.CacheDefinitions.getNpcId('elid_herbalist') });
  assert.ok(p.getPacketSender().isChatboxInterface(582), 'the decant interface');
  click({ player: p, groupId: 582, childId: 6, handled: false });
  assert.equal(has(p, obj('4doseprayerrestore')), 1);
  assert.equal(has(p, obj('2doseprayerrestore')), 1);
  assert.deepEqual(p.lines, ['There, all done.']);
  assert.deepEqual(speakers, [core.CacheDefinitions.getNpcId('elid_herbalist')]);
});
