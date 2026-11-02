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

const DESIGNER = 679;
const button = (component) => (DESIGNER << 16) | component;

before(async () => {
  await CachePipeline.initialize();
  MakeOverMage.register(new Proxy({ core: { CacheDefinitions, Appearance: require("../dist/game/model/Appearance").Appearance }, getCombatFactory: () => ({}) }, { get: (t, k) => (k in t ? t[k] : () => {}) }));
});

function designer(look) {
  const state = { look: [...look], canChange: true, removed: false, varbits: [] };
  const appearance = {
    getLook: () => state.look,
    setLookArray: (next) => { state.look = [...next]; },
    getCanChangeAppearance: () => state.canChange,
    setCanChangeAppearance: (value) => { state.canChange = value; },
  };
  const sender = { sendInterfaceRemoval: () => { state.removed = true; }, sendVarbit: (id, value) => state.varbits.push([id, value]) };
  return { state, player: { getInterfaceId: () => DESIGNER, getAppearance: () => appearance, getPacketSender: () => sender } };
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
  assert.equal(state.look[12], 7, 'skin left wraps within the designer\'s 8');
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
