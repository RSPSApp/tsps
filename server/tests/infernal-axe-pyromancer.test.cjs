// Run after `yarn build`: node --test tests/infernal-axe-pyromancer.test.cjs
// Wiki (Infernal axe): "Experience gained from logs burnt by the infernal axe is increased by the Pyromancer outfit
// bonus." The burn gave half the log's Firemaking XP, never asking the outfit ("firemaking:xp-multiplier", as
// Wintertodt does).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const InfernalAxe = require('../plugins/skills/woodcutting/InfernalAxe.Woodcutting');
let core, next = 9990;
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
function burner(t, outfit) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('infernal' + next); p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); });
  const I = core.ItemIdentifiers, E = core.Equipment, eq = p.getEquipment();
  eq.setItem(E.WEAPON_SLOT, new core.Item(I.INFERNAL_AXE, 1));
  if (outfit) {
    eq.setItem(E.HEAD_SLOT, new core.Item(I.PYROMANCER_HOOD, 1));
    eq.setItem(E.BODY_SLOT, new core.Item(I.PYROMANCER_GARB, 1));
    eq.setItem(E.LEG_SLOT, new core.Item(I.PYROMANCER_ROBE, 1));
    eq.setItem(E.FEET_SLOT, new core.Item(I.PYROMANCER_BOOTS, 1));
  }
  t.mock.method(Math, 'random', () => 0);
  const raw = () => p.getSkillManager().skills.experience[core.Skill.FIREMAKING.getIndex()];
  return { p, raw };
}
const outfitMultiplier = (p) => {
  const request = { player: p, multiplier: 1 };
  PM.emitCustomEvent('firemaking:xp-multiplier', request);
  return request.multiplier;
};

test('a yew burnt by the infernal axe gives half its 202.5 XP times the pyromancer bonus', (t) => {
  const f = burner(t, true);
  const multiplier = outfitMultiplier(f.p);
  assert.ok(Math.abs(multiplier - 1.025) < 1e-9, `the full outfit's 2.5%: ${multiplier}`);
  const before = f.raw();
  assert.equal(InfernalAxe.tryBurnLog(f.p, core.ItemIdentifiers.INFERNAL_AXE, core.ItemIdentifiers.YEW_LOGS), true);
  assert.ok(Math.abs(f.raw() - before - 101.25 * 1.025) < 0.11, `${f.raw() - before}`);
});

test('control: without the outfit the burn gives half the XP', (t) => {
  const f = burner(t, false);
  const before = f.raw();
  InfernalAxe.tryBurnLog(f.p, core.ItemIdentifiers.INFERNAL_AXE, core.ItemIdentifiers.YEW_LOGS);
  assert.ok(Math.abs(f.raw() - before - 101.25) < 0.11, `${f.raw() - before}`);
});
