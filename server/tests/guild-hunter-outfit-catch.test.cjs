// Run after yarn build: node --test tests/guild-hunter-outfit-catch.test.cjs
// Wiki (Guild hunter outfit): catch rate +0.2% headwear, +0.8% top, +0.6% legs, +0.4% boots, +0.5% for the whole set
// worn (2.5% in all). The catch roll used to give 2.5% only with all four worn and nothing for fewer.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const path = require('node:path');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const C = require('../plugins/skills/hunter/Context.Hunter');
const { H } = C;
let core, index = 8960;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  H.core = core;
  H.api = { emitCustomEvent() {} };
});
function hunter(t, worn) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername('ghoutfit' + p.getIndex()); p.setRegistered(true);
  p.getSkillManager().setCurrentLevels(core.Skill.HUNTER, 50).setMaxLevel(core.Skill.HUNTER, 50);
  const E = core.Equipment, I = core.ItemIdentifiers;
  const slots = { GUILD_HUNTER_HEADWEAR: E.HEAD_SLOT, GUILD_HUNTER_TOP: E.BODY_SLOT, GUILD_HUNTER_LEGS: E.LEG_SLOT, GUILD_HUNTER_BOOTS: E.FEET_SLOT };
  for (const name of worn) p.getEquipment().setItem(slots[name], new core.Item(I[name], 1));
  return p;
}
// A creature whose chart gives 0 at every level, so the chance is the outfit's bonus alone.
const creature = { npc: 1, level: 1, low: -1, high: -1 };
function chanceOf(p) {
  const random = Math.random;
  let seen = null;
  const request = { emitCustomEvent: (name, r) => { if (name === 'hunter:catch-chance') seen = r.chance; } };
  H.api = request;
  try { Math.random = () => 0.99; C.chance(p, creature); } finally { Math.random = random; }
  return seen;
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('each worn guild hunter piece raises the catch chance by its own amount', (t) => {
  assert.ok(near(chanceOf(hunter(t, [])), 0));
  assert.ok(near(chanceOf(hunter(t, ['GUILD_HUNTER_HEADWEAR'])), 0.002));
  assert.ok(near(chanceOf(hunter(t, ['GUILD_HUNTER_TOP'])), 0.008));
  assert.ok(near(chanceOf(hunter(t, ['GUILD_HUNTER_LEGS', 'GUILD_HUNTER_BOOTS'])), 0.010));
  assert.ok(near(chanceOf(hunter(t, ['GUILD_HUNTER_HEADWEAR', 'GUILD_HUNTER_TOP', 'GUILD_HUNTER_LEGS'])), 0.016));
});

test('the whole set worn gives 2.5%', (t) => {
  const p = hunter(t, ['GUILD_HUNTER_HEADWEAR', 'GUILD_HUNTER_TOP', 'GUILD_HUNTER_LEGS', 'GUILD_HUNTER_BOOTS']);
  assert.ok(near(chanceOf(p), 0.025));
});
