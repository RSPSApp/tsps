// Run after `yarn build`: node --test tests/god-spell-drains.test.cjs
// Wiki (Saradomin Strike, Claws of Guthix, Flames of Zamorak): a successful hit lowers Prayer by 1,
// Defence by 1 + 5% or Magic by 1 + 5%; the percentage drains neither stack nor reapply until the
// stat is back at its base level. Only a player's cast drains: the Mage Arena battle mages cast the same spells, and
// rsprox_transcripts/238/04155.txt (a normal world) has a guthix_mage's Claws of Guthix land on the player at ticks
// 1865, 1877 and 1889 with no Defence update. 235/03344.txt has zamorak mages casting Claws too.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { World } = require('../dist/game/World');
const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { BotPlayerSession } = require('../dist/net/BotPlayerSession');
const core = PluginManager.getCoreApi();

before(async () => {
  await CachePipeline.initialize(process.cwd());
  new NpcDefinitionLoader().load();
});

function player(t, name) {
  const p = new Player(new BotPlayerSession());
  p.setUsername(name);
  p.setLocation(new core.Location(3222, 3218, 0));
  t.after(() => core.TaskManager.cancelTasks(p.getIndex()));
  return p;
}

function setLevel(p, skill, level) {
  p.getSkillManager().setMaxLevel(skill, level).setCurrentLevel(skill, level, false);
}

test('Flames of Zamorak lowers a player\'s Magic by 1 + 5% once, until it recovers', t => {
  const caster = player(t, 'zamcaster'), target = player(t, 'zamtarget');
  setLevel(target, core.Skill.MAGIC, 99);
  CombatSpells.FLAMES_OF_ZAMORAK.finishCast(caster, target, true, 10);
  assert.equal(target.getSkillManager().getCurrentLevel(core.Skill.MAGIC), 99 - (1 + 4));
  CombatSpells.FLAMES_OF_ZAMORAK.finishCast(caster, target, true, 10);
  assert.equal(target.getSkillManager().getCurrentLevel(core.Skill.MAGIC), 94, 'no stacking while lowered');
});

test('Claws of Guthix lowers an NPC\'s Defence by 1 + 5% once, and a boosted level too', t => {
  const caster = player(t, 'guthcaster');
  const npc = new core.NPC(core.NpcIdentifiers.GUARD, new core.Location(3223, 3218, 0));
  t.after(() => World.getNpcs().remove(npc));
  const base = npc.getMaxLevel(core.Skill.DEFENCE);
  assert.ok(base > 0);
  CombatSpells.CLAWS_OF_GUTHIX.finishCast(caster, npc, true, 5);
  assert.equal(npc.getCurrentLevel(core.Skill.DEFENCE), base - (1 + Math.floor(base * 0.05)));
  CombatSpells.CLAWS_OF_GUTHIX.finishCast(caster, npc, true, 5);
  assert.equal(npc.getCurrentLevel(core.Skill.DEFENCE), base - (1 + Math.floor(base * 0.05)), 'no stacking');

  const target = player(t, 'guthtarget');
  setLevel(target, core.Skill.DEFENCE, 99);
  target.getSkillManager().setCurrentLevel(core.Skill.DEFENCE, 118, false);
  CombatSpells.CLAWS_OF_GUTHIX.finishCast(caster, target, true, 5);
  assert.equal(target.getSkillManager().getCurrentLevel(core.Skill.DEFENCE), 118 - (1 + 5));
});

test('Saradomin Strike lowers a player\'s Prayer by 1 on every hit', t => {
  const caster = player(t, 'sacaster'), target = player(t, 'satarget');
  setLevel(target, core.Skill.PRAYER, 70);
  CombatSpells.SARADOMIN_STRIKE.finishCast(caster, target, true, 3);
  CombatSpells.SARADOMIN_STRIKE.finishCast(caster, target, true, 3);
  assert.equal(target.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 68);
});

test('a splash or a 0 drains nothing', t => {
  const caster = player(t, 'splashcaster'), target = player(t, 'splashtarget');
  setLevel(target, core.Skill.MAGIC, 99);
  setLevel(target, core.Skill.PRAYER, 70);
  CombatSpells.FLAMES_OF_ZAMORAK.finishCast(caster, target, false, 0);
  CombatSpells.SARADOMIN_STRIKE.finishCast(caster, target, true, 0);
  assert.equal(target.getSkillManager().getCurrentLevel(core.Skill.MAGIC), 99);
  assert.equal(target.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 70);
});

// The battle mages (1610 Zamorak, 1611 Saradomin, 1612 Guthix) through the Mage Arena's own combat method and the real
// magic hit path: a landed god spell drains nothing on the player.
for (const [npcId, skillName, base] of [[1612, 'DEFENCE', 99], [1610, 'MAGIC', 99], [1611, 'PRAYER', 70]]) {
  test(`a battle mage (${npcId}) landing its god spell on a player leaves ${skillName} alone`, t => {
    const { battleMages } = require('../plugins/minigames/MageArena.plugin')._test;
    battleMages.setCore(core);
    const god = battleMages.godForMage(npcId);
    const method = new (battleMages.battleMageCombatMethod(god.spell))();
    const target = player(t, 'bmtarget' + npcId);
    const skill = core.Skill[skillName];
    setLevel(target, core.Skill.HITPOINTS, 99);
    setLevel(target, core.Skill.DEFENCE, skillName === 'DEFENCE' ? base : 1);
    setLevel(target, skill, base);
    const npc = new core.NPC(npcId, new core.Location(3225, 3218, 0));
    t.after(() => World.getNpcs().remove(npc));
    let landed = null;
    for (let i = 0; i < 400 && !landed; i++) {
      npc.getCombat().setCastSpell(god.spell);
      const [hit] = method.hits(npc, target);
      if (hit.isAccurate() && hit.getTotalDamage() > 0) landed = hit;
    }
    assert.ok(landed, 'an accurate damaging hit was rolled');
    assert.equal(landed.getSpell(), god.spell, 'the hit carries the god spell');
    method.handleAfterHitEffects(landed);
    assert.equal(target.getSkillManager().getCurrentLevel(skill), base);
  });
}
