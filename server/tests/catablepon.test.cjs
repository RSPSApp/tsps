const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const core = PluginManager.getCoreApi();
let catablepon;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  require('../plugins/combat/StandardCurses.plugin').register(PluginManager.createApi('StandardCurses'));
  catablepon = require('../plugins/npcs/Catablepon.plugin');
  catablepon.register(PluginManager.createApi('Catablepon'));
});

function player(t, strength, base = strength) {
  const p = new Player(null);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write() {} }));
  p.messages = []; t.mock.method(p, 'sendMessage', (text) => p.messages.push(text));
  p.getSkillManager().setMaxLevel(core.Skill.STRENGTH, base);
  p.getSkillManager().setCurrentLevel(core.Skill.STRENGTH, strength, false);
  p.setLocation(new core.Location(2145, 5261, 0));
  return p;
}

function fight(t, strength, base) {
  const p = player(t, strength, base);
  const npc = new NPC(core.NpcIdentifiers.CATABLEPON, new core.Location(2145, 5259, 0));
  npc.getCombat().setTarget(p);
  return { p, npc };
}

/** One glare from the catablepon, landed (accurate) or splashed. */
function glare(npc, p, accurate = true) {
  const method = CombatFactory.getMethod(npc);
  method.start(npc, p);
  const [hit] = method.hits(npc, p);
  hit.getSpell().finishCast(npc, p, accurate, 0);
  method.finished(npc, p);
  return { method, hit };
}

const strength = (p) => p.getSkillManager().getCurrentLevel(core.Skill.STRENGTH);

test('a glare is a Weaken cast with the breath, a zero hit on the cast tick, and the recorded line', (t) => {
  const { p, npc } = fight(t, 90);
  const { method, hit } = glare(npc, p);
  assert.notEqual(method, npc.getCombatMethod(), 'the glare replaces the default attack');
  assert.equal(npc.getAnimation().getId(), 4272, 'catpon_attack_breath');
  assert.equal(hit.getSpell().spellId(), core.CombatSpells.WEAKEN.spellId());
  assert.equal(hit.getDelay(), 0, 'lands on the cast tick (rec 339 tick 1172)');
  assert.equal(hit.getTotalDamage(), 0);
  assert.equal(strength(p), 85, '90 -> 85 (rec 339)');
  assert.deepEqual(p.messages, ['You feel weakened.']);
});

test('glares stack on a lowered level by floor(5%) + 1, as recorded', (t) => {
  const { p, npc } = fight(t, 40);
  glare(npc, p); assert.equal(strength(p), 37, '40 -> 37 (rec 75 tick 11422)');
  glare(npc, p); assert.equal(strength(p), 35, '37 -> 35 (rec 75 tick 11434)');
  for (const [from, to, base] of [[104, 98, 90], [106, 100, 90], [99, 94, 99], [3, 2, 3]]) {
    const fresh = fight(t, from, base);
    glare(fresh.npc, fresh.p);
    assert.equal(strength(fresh.p), to, `${from} -> ${to}`);
  }
});

test('a splash drains nothing', (t) => {
  const { p, npc } = fight(t, 90);
  glare(npc, p, false);
  assert.equal(strength(p), 90);
  assert.deepEqual(p.messages, []);
});

test('it stops glaring once 8% + 3 of base Strength is drained (Wiki), and attacks as before', (t) => {
  assert.equal(catablepon.drainLimit(90), 10);
  const below = fight(t, 81, 90); // 9 drained
  assert.notEqual(CombatFactory.getMethod(below.npc), below.npc.getCombatMethod());
  const at = fight(t, 80, 90); // 10 drained
  assert.equal(CombatFactory.getMethod(at.npc), at.npc.getCombatMethod());
  // Not a player: the default attack.
  const npc = new NPC(core.NpcIdentifiers.CATABLEPON, new core.Location(2145, 5259, 0));
  npc.getCombat().setTarget(new NPC(core.NpcIdentifiers.CATABLEPON, new core.Location(2145, 5261, 0)));
  assert.equal(CombatFactory.getMethod(npc), npc.getCombatMethod());
});

test("a player's own Weaken keeps the spell's rule: no stacking, 5%, the old line", (t) => {
  const caster = player(t, 99);
  const target = player(t, 100);
  core.CombatSpells.WEAKEN.finishCast(caster, target, true, 0);
  assert.equal(strength(target), 95);
  assert.deepEqual(target.messages, ['You feel slightly weakened.']);
  core.CombatSpells.WEAKEN.finishCast(caster, target, true, 0);
  assert.equal(strength(target), 95);
});
