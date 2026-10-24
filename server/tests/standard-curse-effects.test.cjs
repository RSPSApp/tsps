const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const core = PluginManager.getCoreApi();
const cases = [['CONFUSE','ATTACK',5],['WEAKEN','STRENGTH',5],['CURSE','DEFENCE',5],
  ['VULNERABILITY','DEFENCE',10],['ENFEEBLE','STRENGTH',10],['STUN','ATTACK',10]];
before(async () => {
  await CachePipeline.initialize(process.cwd());
  require('../plugins/combat/StandardCurses.plugin').register(PluginManager.createApi('StandardCursesTest'));
  PluginManager.createApi('UtilityEffectVetoTest').onCustomEvent('magic:utility-effect-check', event => {
    if (event.attacker?.getAttribute?.('standard-curses-test:veto')) event.allowed=false;
    if (event.attacker?.getAttribute?.('standard-curses-test:handled')) event.handled=true;
  });
});

function player(t) {
  const p = new Player(null);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true }));
  p.messages=[];t.mock.method(p,'sendMessage',text=>p.messages.push(text));
  for (const skill of [core.Skill.ATTACK,core.Skill.STRENGTH,core.Skill.DEFENCE]) {
    p.getSkillManager().setMaxLevel(skill,100);
    p.getSkillManager().setCurrentLevel(skill,100,false);
  }
  return p;
}
function npc(t,level=100) {
  const definition=Object.assign(new NpcDefinition(),{stats:new Array(5).fill(level)});
  const value=new NPC(1,new core.Location(3200,3200));
  t.mock.method(value,'getCurrentDefinition',()=>definition);
  return {value,definition};
}
function cast(name,attacker,target,accurate=true) {
  core.CombatSpells[name].finishCast(attacker,target,accurate,0);
}

for(const [name,skill,percent] of cases) test(name+' drains the actual NPC level without changing other stats or its definition',t=>{
  const attacker=player(t),{value,definition}=npc(t);
  cast(name,attacker,value);
  for(const stat of ['ATTACK','STRENGTH','DEFENCE']) assert.equal(value.getCurrentLevel(core.Skill[stat]),stat===skill?100-percent:100,stat);
  assert.deepEqual(definition.getStats(),[100,100,100,100,100]);
});

test('player targets retain the six existing percentages and relevant-skill-only changes',t=>{
  for(const [name,skill,percent] of cases) {
    const attacker=player(t),target=player(t);cast(name,attacker,target);
    for(const stat of ['ATTACK','STRENGTH','DEFENCE']) assert.equal(target.getSkillManager().getCurrentLevel(core.Skill[stat]),stat===skill?100-percent:100,name+' '+stat);
    assert.ok(target.messages.includes('You feel slightly weakened.'));
  }
});

test('splashes do not drain NPCs or players',t=>{
  for(const [name,skill] of cases){const attacker=player(t),target=player(t),{value}=npc(t);
    cast(name,attacker,value,false);cast(name,attacker,target,false);
    assert.equal(value.getCurrentLevel(core.Skill[skill]),100);
    assert.equal(target.getSkillManager().getCurrentLevel(core.Skill[skill]),100);
  }
});

test('non-damaging curse spells explicitly declare zero direct magic damage',t=>{
  const attacker=player(t);
  for(const [name] of cases) assert.equal(core.DamageFormulas.getMagicMaxhit(attacker,core.CombatSpells[name]),0,name);
});

test('curses cannot stack on an already drained relevant level',t=>{
  const attacker=player(t),{value}=npc(t),target=player(t);
  value.setCurrentLevels(core.Skill.DEFENCE,95);target.getSkillManager().setCurrentLevel(core.Skill.DEFENCE,95,false);
  cast('VULNERABILITY',attacker,value);cast('VULNERABILITY',attacker,target);
  assert.equal(value.getCurrentLevel(core.Skill.DEFENCE),95);
  assert.equal(target.getSkillManager().getCurrentLevel(core.Skill.DEFENCE),95);
  assert.ok(attacker.messages.filter(text=>text.includes('already weakened')).length>=2);
});

test('an unrelated drained stat does not block the curse and encounter immunity cannot be bypassed',t=>{
  const attacker=player(t),{value}=npc(t);
  value.setCurrentLevels(core.Skill.STRENGTH,50);cast('CURSE',attacker,value);
  assert.equal(value.getCurrentLevel(core.Skill.DEFENCE),95);assert.equal(value.getCurrentLevel(core.Skill.STRENGTH),50);
  value.setStatDrainImmune(true);
  for(const [name] of cases)cast(name,attacker,value);
  for(const stat of ['ATTACK','STRENGTH','DEFENCE'])assert.equal(value.getCurrentLevel(core.Skill[stat]),100);
});

test('NPC curse drains restore on the real per-NPC clock',t=>{
  let cycle=0;t.mock.method(core.World,'getProcessCycle',()=>cycle);
  const attacker=player(t),{value}=npc(t);value.setStatRestoreTicks(100);
  cast('CONFUSE',attacker,value);assert.equal(value.getCurrentLevel(core.Skill.ATTACK),95);
  cycle=99;assert.equal(value.getCurrentLevel(core.Skill.ATTACK),95);
  cycle=100;assert.equal(value.getCurrentLevel(core.Skill.ATTACK),96);
  cycle=500;assert.equal(value.getCurrentLevel(core.Skill.ATTACK),100);
});

test('a prior utility-effect veto prevents NPC and player drains',t=>{
  const attacker=player(t),target=player(t),{value}=npc(t);
  attacker.setAttribute('standard-curses-test:veto',true);
  cast('VULNERABILITY',attacker,value);cast('VULNERABILITY',attacker,target);
  assert.equal(value.getCurrentLevel(core.Skill.DEFENCE),100);
  assert.equal(target.getSkillManager().getCurrentLevel(core.Skill.DEFENCE),100);
});

test('the actual impact spell controls the drain even if the selected spell has changed',t=>{
  const attacker=player(t),{value}=npc(t);
  attacker.getCombat().setCastSpell(core.CombatSpells.CONFUSE);
  cast('STUN',attacker,value);
  assert.equal(value.getCurrentLevel(core.Skill.ATTACK),90);
});

test('drain rounding retains floor-of-current-level amount, including boosted players',t=>{
  const attacker=player(t),target=player(t),{value}=npc(t,50);
  cast('CONFUSE',attacker,value);assert.equal(value.getCurrentLevel(core.Skill.ATTACK),48);
  target.getSkillManager().setCurrentLevel(core.Skill.ATTACK,110,false);
  assert.equal(target.getSkillManager().getCurrentLevel(core.Skill.ATTACK),110);
  cast('CONFUSE',attacker,target);assert.equal(target.getSkillManager().getCurrentLevel(core.Skill.ATTACK),105);
});

test('prior handling retains utility effect ownership and prevents the curse drain',t=>{
  const attacker=player(t),{value}=npc(t);
  attacker.setAttribute('standard-curses-test:handled',true);
  cast('STUN',attacker,value);assert.equal(value.getCurrentLevel(core.Skill.ATTACK),100);
});

test('unrelated utility spells retain their fallback effect and inaccurate casts never call it',t=>{
  const {CombatEffectSpell}=require('../dist/game/content/combat/magic/CombatEffectSpell');
  const attacker=player(t),{value}=npc(t);let calls=0;
  const spell=new CombatEffectSpell({spellId:()=>-9876,spellEffect:(caster,target)=>{
    assert.equal(caster,attacker);assert.equal(target,value);calls++;
  }});
  spell.finishCast(attacker,value,false,0);assert.equal(calls,0);
  spell.finishCast(attacker,value,true,0);assert.equal(calls,1);
  attacker.setAttribute('standard-curses-test:handled',true);
  spell.finishCast(attacker,value,true,0);assert.equal(calls,1);
  attacker.setAttribute('standard-curses-test:handled',false);
  attacker.setAttribute('standard-curses-test:veto',true);
  spell.finishCast(attacker,value,true,0);assert.equal(calls,1);
});
