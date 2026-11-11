// Run after `yarn build`: node --test tests/god-spell-drains.test.cjs
// Wiki (Saradomin Strike, Claws of Guthix, Flames of Zamorak): a successful hit lowers Prayer by 1,
// Defence by 1 + 5% or Magic by 1 + 5%; the percentage drains neither stack nor reapply until the
// stat is back at its base level. No recording casts a god spell on a target.
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
