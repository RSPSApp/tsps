// Run after `yarn build`: node --test tests/makeover-design.test.cjs
// The character designer (679) on the server, as the official client uses it: each click comes
// to the server, which changes the player's look.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const MakeOverMage = require('../plugins/npcs/MakeOverMage.plugin');
const { Appearance } = require('../dist/game/model/Appearance');

const DESIGNER = 679;
const button = (component) => (DESIGNER << 16) | component;

before(async () => {
  await CachePipeline.initialize();
  MakeOverMage.register(new Proxy({ core: { CacheDefinitions, Appearance }, getCombatFactory: () => ({}) }, { get: (t, k) => (k in t ? t[k] : () => {}) }));
});

function designer(look, attributes = {}) {
  const state = { look: [...look], canChange: true, removed: false, varbits: [], attributes: { ...attributes } };
  const owner = { getAttribute: (key) => state.attributes[key], setAttribute: (key, value) => { state.attributes[key] = value; } };
  const appearance = {
    player: owner,
    isSkinColourUnlocked: Appearance.prototype.isSkinColourUnlocked,
    unlockedSkinColours: Appearance.prototype.unlockedSkinColours,
    getLook: () => state.look,
    setLookArray: (next) => { state.look = [...next]; },
    getCanChangeAppearance: () => state.canChange,
    setCanChangeAppearance: (value) => { state.canChange = value; },
  };
  const sender = { sendInterfaceRemoval: () => { state.removed = true; }, sendVarbit: (id, value) => state.varbits.push([id, value]) };
  return { state, player: { ...owner, getInterfaceId: () => DESIGNER, getAppearance: () => appearance, getPacketSender: () => sender } };
}

const selectable = (part) => CacheDefinitions.getIdentKits().filter((kit) => !kit.nonSelectable && kit.bodyPartId === part).map((kit) => kit.id);

test('the arrows cycle a body part through its selectable kits, and a colour through its palette', () => {
  const heads = selectable(0);
  assert.ok(heads.length > 1, 'male heads in the cache');
  const { state, player } = designer([0, heads[0], 18, 26, 33, 36, 42, 10, 0, 0, 0, 0, 0]);
  const { clickDesign } = MakeOverMage._test;
  assert.equal(clickDesign({ player, buttonId: button(16) }), true);
  assert.equal(state.look[1], heads[1], 'head right');
  clickDesign({ player, buttonId: button(15) });
  clickDesign({ player, buttonId: button(15) });
  assert.equal(state.look[1], heads[heads.length - 1], 'head left wraps');
  clickDesign({ player, buttonId: button(62) });
  assert.equal(state.look[12], 12, 'skin left wraps to purple, the last open colour');
});

const SKIN_LEFT = button(62), SKIN_RIGHT = button(63);
const skins = (player, state, buttonId, clicks) => Array.from({ length: clicks }, () => (MakeOverMage._test.clickDesign({ player, buttonId }), state.look[12]));
// The saved unlocks (core Appearance.SKIN_UNLOCKS), one per cache varbit.
const [HW07, HW15, HW17] = ['appearance:hw07-skin-colours', 'appearance:hw15-skin-colours', 'appearance:hw17-skin-colours'];

test('without a Halloween unlock skin cycles 0-7 and purple, never green, black, white or blue', () => {
  const { state, player } = designer([0, 0, 18, 26, 33, 36, 42, 10, 0, 0, 0, 0, 7]);
  assert.deepEqual(skins(player, state, SKIN_RIGHT, 3), [12, 0, 1], '7 -> 12 -> 0');
  state.look[12] = 0;
  assert.deepEqual(skins(player, state, SKIN_LEFT, 3), [12, 7, 6], '0 -> 12 -> 7');
});

test('hw15_skincols opens black and white only; each unlock opens its own colours', () => {
  const { state, player } = designer([0, 0, 18, 26, 33, 36, 42, 10, 0, 0, 0, 0, 7], { [HW15]: true });
  assert.deepEqual(skins(player, state, SKIN_RIGHT, 4), [9, 10, 12, 0]);
  state.look[12] = 0;
  assert.deepEqual(skins(player, state, SKIN_LEFT, 4), [12, 10, 9, 7]);
  const all = designer([0, 0, 18, 26, 33, 36, 42, 10, 0, 0, 0, 0, 7], { [HW07]: true, [HW15]: true, [HW17]: true });
  assert.deepEqual(skins(all.player, all.state, SKIN_RIGHT, 6), [8, 9, 10, 11, 12, 0]);
});

test('a kept locked skin colour steps to its open neighbour, as in the browser designer', () => {
  const { state, player } = designer([0, 0, 18, 26, 33, 36, 42, 10, 0, 0, 0, 0, 9]);
  assert.deepEqual(skins(player, state, SKIN_RIGHT, 1), [12], 'locked black, right -> 12');
  state.look[12] = 9;
  assert.deepEqual(skins(player, state, SKIN_LEFT, 1), [7], 'locked black, left -> 7');
  const hw15 = designer([0, 0, 18, 26, 33, 36, 42, 10, 0, 0, 0, 0, 11], { [HW15]: true });
  assert.deepEqual(skins(hw15.player, hw15.state, SKIN_RIGHT, 1), [12], 'locked blue, right -> 12');
  hw15.state.look[12] = 11;
  assert.deepEqual(skins(hw15.player, hw15.state, SKIN_LEFT, 1), [10], 'locked blue, left -> white');
});

test('a completed Halloween event unlocks every Halloween skin colour and shows the varbits', () => {
  const { state, player } = designer([0, 0, 18, 26, 33, 36, 42, 10, 0, 0, 0, 0, 7]);
  MakeOverMage._test.unlockHalloweenSkins({ player });
  assert.deepEqual([HW07, HW15, HW17].map((key) => state.attributes[key]), [true, true, true]);
  const ids = ['hw07_skincols', 'hw15_skincols', 'hw17_skincols'].map((name) => CacheDefinitions.getVarbitId(name));
  assert.deepEqual(ids, [4803, 4804, 6007], 'the cache varbits');
  assert.deepEqual(state.varbits, ids.map((id) => [id, 1]));
});

test('body type B takes the first female kit of each part; Confirm closes the designer', () => {
  const { state, player } = designer([0, 0, 18, 26, 33, 36, 42, 10, 0, 0, 0, 0, 0]);
  const { clickDesign } = MakeOverMage._test;
  clickDesign({ player, buttonId: button(69) });
  assert.equal(state.look[0], 1);
  assert.equal(state.look[1], selectable(7)[0], 'female head');
  assert.deepEqual(state.varbits.at(-1), [14021, 1]);
  clickDesign({ player, buttonId: button(74) });
  assert.equal(state.removed, true);
  assert.equal(state.canChange, false);
  assert.equal(clickDesign({ player, buttonId: button(16) }), false, 'no changes once confirmed');
});
