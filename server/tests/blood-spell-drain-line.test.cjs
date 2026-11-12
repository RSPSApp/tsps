// Run after `yarn build`: node --test tests/blood-spell-drain-line.test.cjs
// A blood spell that hits sends one spam line per cast: "You drain some of your opponent's health." for one
// target and "You drain some of your opponents' health." for two or more (rsprox_transcripts/226/01702.txt and
// 234/00821.txt: every singular line follows exactly one blood impact; 238/01224.txt tick 3066, Blood Blitz). The
// line counts accurate impacts, 0 damage included (234/00821.txt tick 4446: base Magic XP only, the singular line).
// It goes out on the cast tick, with the runes, the XP and the impact spotanim.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
const { MagicCombatMethod } = require('../dist/game/content/combat/method/impl/MagicCombatMethod');
const { ChatType } = require('../dist/net/protocol/ClientProtocol');
const core = PluginManager.getCoreApi();

const ONE = "You drain some of your opponent's health.";
const MANY = "You drain some of your opponents' health.";

before(async () => {
  await CachePipeline.initialize(process.cwd());
  PluginManager.createApi('BloodDrainLineTest').onCombatHitRoll(event => {
    const mode = event.attacker.getAttribute?.('blood-drain-test:roll');
    if (mode === 'hit') { event.forceAccurate = true; event.forceMaxHit = true; }
  });
});

function caster(t) {
  const p = new Player(null);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write() {} }));
  p.getSkillManager().setMaxLevel(core.Skill.MAGIC, 99).setCurrentLevels(core.Skill.MAGIC, 99, false);
  p.setLocation(new core.Location(3200, 3200, 0));
  const lines = [];
  t.mock.method(p.getPacketSender(), 'sendTypedMessage', (type, text) => { lines.push([type, text]); return p.getPacketSender(); });
  t.mock.method(core.Sounds, 'sendSound', () => {});
  return { p, lines };
}

function npc(t) {
  const definition = Object.assign(new NpcDefinition(), { stats: new Array(5).fill(1) });
  const value = new NPC(1, new core.Location(3201, 3200, 0));
  t.mock.method(value, 'getCurrentDefinition', () => definition);
  return value;
}

test('a Blood Blitz that hits one target sends the singular line on the spam channel, once', t => {
  const { p, lines } = caster(t);
  const target = npc(t);
  p.setAttribute('blood-drain-test:roll', 'hit');
  p.getCombat().setCastSpell(core.CombatSpells.BLOOD_BLITZ);
  const hits = new MagicCombatMethod().hits(p, target);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].isAccurate() && hits[0].getTotalDamage() > 0);
  assert.deepEqual(lines, [[ChatType.SPAM, ONE]]);
});

test('two or more accurate impacts give the plural line; a lone accurate 0 the singular; a splash none', t => {
  const { p, lines } = caster(t);
  const method = new MagicCombatMethod();
  const hit = (damage) => {
    const h = new PendingHit(p, npc(t), method, { rollAccuracy: false });
    h.setTotalDamage(damage);
    return h;
  };
  const splash = () => { const h = hit(0); t.mock.method(h, 'isAccurate', () => false); return h; };
  MagicCombatMethod.sendBloodDrainLine(p, core.CombatSpells.BLOOD_BARRAGE, [hit(10), hit(4), hit(0)]);
  MagicCombatMethod.sendBloodDrainLine(p, core.CombatSpells.BLOOD_BARRAGE, [hit(0)]);
  MagicCombatMethod.sendBloodDrainLine(p, core.CombatSpells.BLOOD_BARRAGE, [splash(), splash()]);
  MagicCombatMethod.sendBloodDrainLine(p, core.CombatSpells.BLOOD_BARRAGE, [hit(0), splash()]);
  MagicCombatMethod.sendBloodDrainLine(p, core.CombatSpells.ICE_BARRAGE, [hit(10), hit(10)]);
  assert.deepEqual(lines, [[ChatType.SPAM, MANY], [ChatType.SPAM, ONE], [ChatType.SPAM, ONE]],
    'three accurate (one a 0): plural; a lone accurate 0: singular; splashes: none; one accurate beside a splash: singular');
});
