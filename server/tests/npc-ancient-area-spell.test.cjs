// Run after `yarn build`: node --test tests/npc-ancient-area-spell.test.cjs
// An NPC casting an accurate Ancient area spell (a barrage) in multicombat splashes nearby victims of the
// primary target's kind. It used to leave the victim list unset and throw on the cast.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { World } = require('../dist/game/World');
const { AreaManager } = require('../dist/game/model/areas/AreaManager');
const { CombatFactory, CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
const { MagicCombatMethod } = require('../dist/game/content/combat/method/impl/MagicCombatMethod');
const core = PluginManager.getCoreApi();

before(async () => {
  await CachePipeline.initialize(process.cwd());
  PluginManager.createApi('NpcAncientAreaSpellTest').onCombatHitRoll(event => {
    if (event.attacker.getAttribute?.('npc-ancient-test:hit')) event.forceAccurate = true;
  });
});

function npc(t, x) {
  const definition = Object.assign(new NpcDefinition(), { stats: new Array(5).fill(1), attackable: true });
  const value = new NPC(1, new core.Location(x, 3200, 0));
  t.mock.method(value, 'getCurrentDefinition', () => definition);
  t.mock.method(value, 'isRegistered', () => true);
  return value;
}

function player(t, x) {
  const p = new Player(null);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write() {} }));
  t.mock.method(p, 'isRegistered', () => true);
  p.setLocation(new core.Location(x, 3200, 0));
  return p;
}

function barrageCaster(t) {
  const caster = npc(t, 3195);
  caster.setAttribute('npc-ancient-test:hit', true);
  caster.getCombat().setCastSpell(core.CombatSpells.ICE_BARRAGE);
  t.mock.method(AreaManager, 'inMulti', () => true);
  t.mock.method(CombatFactory, 'canAttackByPolicy', () => CanAttackResponse.CAN_ATTACK);
  t.mock.method(core.Sounds, 'playAreaSound', () => {});
  return caster;
}

test('an NPC barrage on a player splashes a second player beside the target, and not one far away', t => {
  const caster = barrageCaster(t);
  const target = player(t, 3200);
  const beside = player(t, 3201);
  const far = player(t, 3210);
  t.mock.method(World, 'getPlayers', () => [target, beside, far]);
  const hits = new MagicCombatMethod().hits(caster, target);
  assert.ok(hits[0].isAccurate());
  assert.deepEqual(hits.map(hit => hit.getTarget()), [target, beside]);
});

test('an NPC barrage on an NPC draws its splash victims from the NPCs near the target', t => {
  const caster = barrageCaster(t);
  const target = npc(t, 3200);
  const beside = npc(t, 3201);
  const near = t.mock.method(World, 'getNpcsNear', () => [caster, target, beside]);
  const hits = new MagicCombatMethod().hits(caster, target);
  assert.deepEqual(hits.map(hit => hit.getTarget()), [target, beside]);
  assert.equal(near.mock.calls[0].arguments[0], target.getLocation());
  assert.equal(near.mock.calls[0].arguments[1], core.CombatSpells.ICE_BARRAGE.spellRadius());
});

test('a large monster is caught when any of its tiles is in the area, not only its south-west tile (Wiki: Ancient Magicks)', t => {
  const caster = barrageCaster(t);
  const target = npc(t, 3200);
  const large = (x, y) => {
    const value = npc(t, x);
    value.setLocation(new core.Location(x, y, 0));
    t.mock.method(value, 'getSize', () => 3);
    return value;
  };
  const radius = core.CombatSpells.ICE_BARRAGE.spellRadius();
  assert.equal(radius, 1);
  // South-west tile 3 away, but its north-east tile (3199, 3199) touches the target's.
  assert.equal(CombatFactory.canAttackSecondaryTarget(caster, target, large(3197, 3197), radius), true);
  // Its nearest tile (its south-west, 3202, 3202) is 2 away: outside.
  assert.equal(CombatFactory.canAttackSecondaryTarget(caster, target, large(3202, 3202), radius), false);
  // A 1x1 target is measured as before.
  assert.equal(CombatFactory.canAttackSecondaryTarget(caster, target, npc(t, 3202), radius), false);
  assert.equal(CombatFactory.canAttackSecondaryTarget(caster, target, npc(t, 3201), radius), true);
});
