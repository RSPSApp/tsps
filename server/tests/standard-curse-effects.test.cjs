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
  PluginManager.createApi('CurseAccuracyTest').onCombatHitRoll(event => {
    if (event.attacker.getAttribute?.('standard-curses-test:accurate')) event.forceAccurate=true;
  });
  PluginManager.createApi('UtilityEffectVetoTest').onCustomEvent('magic:utility-effect-check', event => {
    if (event.attacker?.getAttribute?.('standard-curses-test:veto')) event.allowed=false;
    if (event.attacker?.getAttribute?.('standard-curses-test:handled')) event.handled=true;
  });
});

function player(t) {
  const p = new Player(null);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write() {} }));
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

function paidCast(t,name,target) {
  let cycle=10;t.mock.method(core.World,'getProcessCycle',()=>cycle);t.mock.method(Date,'now',()=>cycle*600);
  t.mock.method(core.Sounds,'sendSound',()=>{});
  const p=player(t),spell=core.CombatSpells[name],method=new core.MagicCombatMethod();
  p.getSkillManager().setMaxLevel(core.Skill.MAGIC,99).setCurrentLevels(core.Skill.MAGIC,99,false);
  p.setAttribute('standard-curses-test:accurate',true);
  for(const rune of spell.itemsRequired(p))p.getInventory().add(new core.Item(rune.getId(),rune.getAmount()*10));
  const select=()=>{p.getCombat().setTarget(target);p.getCombat().setCastSpell(spell);};select();
  return {p,spell,target,method,select,next(){cycle++;},hit(){return method.hits(p,target)[0];},impact(hit){method.handleAfterHitEffects(hit);}};
}

test('all six curses refuse lowered NPC/player stats before rune payment, until the affected stat fully recovers',t=>{
  for(const [name,stat,percent] of cases)for(const pvp of [false,true]){
    const target=pvp?player(t):npc(t).value,skill=core.Skill[stat],levels=pvp?target.getSkillManager():target;
    const f=paidCast(t,name,target),maximum=levels.getMaxLevel(skill);
    assert.equal(f.method.canAttack(f.p,target),true,name);f.method.start(f.p,target);
    const hit=f.hit();assert.equal(hit.isAccurate(),true);f.impact(hit);
    assert.equal(levels.getCurrentLevel(skill),maximum-Math.floor(maximum*percent/100),name);
    f.next();const inventory=JSON.stringify(f.p.getInventory().getItems()),xp=f.p.getSkillManager().getSkills().experience[core.Skill.MAGIC.getIndex()];
    assert.equal(f.method.canPursue(f.p,target),false,name+' preview');f.select();
    assert.equal(f.method.canAttack(f.p,target),false,name+' paid cast');
    assert.equal(JSON.stringify(f.p.getInventory().getItems()),inventory,name+' preserves runes');
    assert.equal(f.p.getSkillManager().getSkills().experience[core.Skill.MAGIC.getIndex()],xp,name+' preserves XP');
    assert.ok(f.p.messages.some(message=>message.includes('already weakened.')));
    if(pvp)levels.setCurrentLevels(skill,maximum-1,false);else levels.setCurrentLevels(skill,maximum-1);
    f.select();assert.equal(f.spell.canCast(f.p,false),false,'partial recovery is not enough');
    if(pvp)levels.setCurrentLevels(skill,maximum,false);else levels.setCurrentLevels(skill,maximum);
    f.select();assert.equal(f.spell.canCast(f.p,false),true,'full recovery permits another curse');
  }
});

test('paid curses retain splash XP, impact-race protection, unrelated-stat casts and new-target selection',t=>{
  const {value:target}=npc(t),f=paidCast(t,'CURSE',target),skill=core.Skill.DEFENCE;
  f.p.setAttribute('standard-curses-test:accurate',false);
  t.mock.method(core.AccuracyFormulasDpsCalc,'rollAccuracy',()=>false);
  assert.equal(f.method.canAttack(f.p,target),true);f.method.start(f.p,target);const missed=f.hit();
  assert.equal(missed.isAccurate(),false);f.impact(missed);assert.equal(target.getCurrentLevel(skill),100);
  assert.equal(f.p.getSkillManager().getSkills().experience[core.Skill.MAGIC.getIndex()],29);
  f.next();f.select();assert.equal(f.spell.canCast(f.p,false),true,'a splash permits another cast');
  f.p.setAttribute('standard-curses-test:accurate',true);
  assert.equal(f.method.canAttack(f.p,target),true);f.method.start(f.p,target);const hit=f.hit();
  assert.equal(hit.isAccurate(),true);target.setCurrentLevels(skill,99);f.impact(hit);
  assert.equal(target.getCurrentLevel(skill),99,'an in-flight curse cannot stack on an intervening drain');
  f.next();f.p.getCombat().setCastSpell(core.CombatSpells.CONFUSE);
  for(const rune of core.CombatSpells.CONFUSE.itemsRequired(f.p))f.p.getInventory().add(new core.Item(rune.getId(),rune.getAmount()));
  assert.equal(core.CombatSpells.CONFUSE.canCast(f.p,false),true,'a different unaffected stat remains eligible');
  f.p.getCombat().setTarget(npc(t).value);f.p.getCombat().setCastSpell(f.spell);
  assert.equal(f.spell.canCast(f.p,false),true,'a new healthy target is independent of the old target');
});

test('native spell-on-NPC targeting rejects a repeated paid Curse on real cached combat stats',t=>{
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  const {NPCOptionPacketListener}=require('../dist/net/packet/impl/NPCOptionPacketListener');
  const target=new NPC(core.NpcIdentifiers.LESSER_DEMON,new core.Location(3201,3200));
  const f=paidCast(t,'CURSE',target);f.p.setRegistered(true);f.p.setLocation(new core.Location(3200,3200));
  assert.equal(target.getCurrentDefinition().getName(),'Lesser demon');
  assert.ok(target.getMaxLevel(core.Skill.DEFENCE)>=20);
  core.World.getNpcs().add(target);t.after(()=>core.World.getNpcs().remove(target));
  assert.equal(NPCOptionPacketListener.castSpell(f.p,target.getIndex(),f.spell.spellId()),true);
  assert.equal(f.p.getCombat().getTarget(),target);
  assert.equal(f.method.canAttack(f.p,target),true);f.method.start(f.p,target);f.impact(f.hit());f.next();
  assert.ok(target.getCurrentLevel(core.Skill.DEFENCE)<target.getMaxLevel(core.Skill.DEFENCE));
  const inventory=JSON.stringify(f.p.getInventory().getItems()),xp=f.p.getSkillManager().getSkills().experience[core.Skill.MAGIC.getIndex()];
  assert.equal(NPCOptionPacketListener.castSpell(f.p,target.getIndex(),f.spell.spellId()),true,'the native click selects the target');
  assert.equal(f.method.canAttack(f.p,target),false,'the cast gate refuses before payment');
  assert.equal(JSON.stringify(f.p.getInventory().getItems()),inventory);
  assert.equal(f.p.getSkillManager().getSkills().experience[core.Skill.MAGIC.getIndex()],xp);
});

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

test('Count Draynor garlic cannot turn any nondamaging curse into a damaging impact', t => {
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  const attacker = player(t), tasks = [], spawned = [];
  attacker.getInventory().setItem(0, new core.Item(core.ItemIdentifiers.GARLIC));
  let openCoffin;
  const api = PluginManager.createApi('CountCurseTest');
  require('../plugins/bosses/CountDraynor.plugin').register({ ...api,
    core: { ...core, TaskManager: { submit: task => tasks.push(task) } },
    onObjectFirstClick: (_id, handler) => { openCoffin = handler; },
    emitCustomEvent: (name, event) => {
      if (name === 'quest:is-started') event.started = true;
      if (name === 'quest:is-complete') event.complete = false;
    },
    spawnNpc: row => {
      const value = new NPC(row.id, new core.Location(row.x, row.y, row.z));
      value.setRegistered(true);
      spawned.push(value);
      return value;
    },
    removeNpc: () => {},
  });
  openCoffin({ player: attacker, object: new core.GameObject(core.ObjectIdentifiers.COFFIN_46,
    new core.Location(3077, 9775, 0), 10, 3, null) });
  tasks.find(task => task.getDelay() === 9).execute();
  const target = spawned.at(-1);
  assert.equal(target.getId(), core.NpcIdentifiers.COUNT_DRAYNOR);
  attacker.getCombat().setTarget(target);
  t.mock.method(Math, 'random', () => 0.999);
  const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
  const { MagicCombatMethod } = require('../dist/game/content/combat/method/impl/MagicCombatMethod');
  for (const [name] of [...cases, ['BIND']]) {
    const spell = core.CombatSpells[name];
    attacker.getCombat().setCastSpell(spell);
    assert.deepEqual(core.DamageFormulas.getMagicHitBounds(attacker, spell, target), { minimum: 0, maximum: 0 }, name);
    assert.equal(core.DamageFormulas.getMagicMaxhit(attacker, spell), 0, name);
    const hit = new PendingHit(attacker, target, new MagicCombatMethod(), { rollAccuracy: false });
    assert.equal(hit.isAccurate(), true, name);
    assert.equal(hit.getTotalDamage(), 0, name);
  }
  assert.equal(core.DamageFormulas.getMagicMaxhit(attacker, core.CombatSpells.FIRE_STRIKE), 9,
    'garlic still adds one to damaging spells');
  assert.equal(core.DamageFormulas.getMagicMaxhit(attacker, core.CombatSpells.TELEBLOCK), 2,
    'unspecified negative utility maximum retains its existing fallback');
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
