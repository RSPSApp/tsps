const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const core = PluginManager.getCoreApi();
const commits=[];
before(async()=>{
  await CachePipeline.initialize(process.cwd());
  const api=PluginManager.createApi('CastContextProbe');
  api.onCustomEvent('magic:cast-committed',event=>{
    if(!event.player.getAttribute('cast-context-test:enabled'))return;
    event.context.data.set('cast-context-test:snapshot',Object.freeze({value:event.player.getAttribute('cast-context-test:value')}));
    commits.push(event);
  });
  api.onCustomEvent('magic:utility-effect-check',event=>{
    if(event.attacker.getAttribute?.('cast-context-test:enabled'))event.attacker.setAttribute('cast-context-test:impact',event.context);
  });
  api.onCustomEvent('combat:magic-hit-bounds',event=>{
    if(event.attacker.getAttribute?.('cast-context-test:enabled'))event.attacker.setAttribute('cast-context-test:calculation',event.context);
    if(event.attacker.getAttribute?.('cast-context-test:bounds')){event.minHit=3;event.maxHit=9;}
  });
});
function fixture(t,{runes=true,spellName='FIRE_STRIKE'}={}){
  let cycle=10;t.mock.method(core.World,'getProcessCycle',()=>cycle);t.mock.method(Date,'now',()=>cycle*600);
  const p=new Player(null);t.mock.method(p,'getSession',()=>({sendClientPacket:()=>true}));
  t.mock.method(p,'sendMessage',()=>{});
  p.getSkillManager().setMaxLevel(core.Skill.MAGIC,99);p.getSkillManager().setCurrentLevel(core.Skill.MAGIC,99,false);
  p.setAttribute('cast-context-test:enabled',true);p.setAttribute('cast-context-test:value',7);
  const spell=core.CombatSpells[spellName];p.getCombat().setCastSpell(spell);
  if(runes)for(const item of spell.itemsRequired(p))p.getInventory().add(new core.Item(item.getId(),item.getAmount()*10));
  return{p,spell,next(){cycle++;}};
}
test('paid spell commitment emits once, while previews, missing resources and cooldown refusal do not',t=>{
  const f=fixture(t),start=commits.length;
  assert.equal(f.spell.canCast(f.p,false),true);assert.equal(commits.length,start);
  assert.equal(f.spell.canCast(f.p,true),true);assert.equal(commits.length,start+1);
  assert.equal(commits.at(-1).spell,f.spell);assert.ok(commits.at(-1).context?.data instanceof Map);
  assert.equal(f.spell.canCast(f.p,true),false);assert.equal(commits.length,start+1);
  const empty=fixture(t,{runes:false});assert.equal(empty.spell.canCast(empty.p,true),false);assert.equal(commits.length,start+1);
});
test('a current cast context is scoped by actor, actual spell and world tick; old snapshots remain independent',t=>{
  assert.equal(typeof core.Spell.getCastContext,'function');
  const f=fixture(t);f.spell.canCast(f.p,true);
  const first=core.Spell.getCastContext(f.p,f.spell);assert.ok(first);
  assert.deepEqual(first.data.get('cast-context-test:snapshot'),{value:7});
  assert.equal(core.Spell.getCastContext(f.p,core.CombatSpells.WATER_STRIKE),null);
  assert.equal(core.Spell.getCastContext(new Player(null),f.spell),null);
  f.next();assert.equal(core.Spell.getCastContext(f.p,f.spell),null);
  f.p.setAttribute('cast-context-test:value',99);f.spell.canCast(f.p,true);
  const second=core.Spell.getCastContext(f.p,f.spell);assert.notEqual(second,first);
  assert.deepEqual(first.data.get('cast-context-test:snapshot'),{value:7});
  assert.deepEqual(second.data.get('cast-context-test:snapshot'),{value:99});
});
test('PendingHit retains the committed context through later casts and forwards it to a utility impact',t=>{
  assert.equal(typeof core.Spell.getCastContext,'function');
  const f=fixture(t,{spellName:'CONFUSE'});f.spell.canCast(f.p,true);const context=core.Spell.getCastContext(f.p,f.spell);
  const target=new core.NPC(1,new core.Location(3200,3200));
  const method=new core.MagicCombatMethod();
  const hit=method.hits(f.p,target)[0];t.mock.method(hit,'isAccurate',()=>true);
  t.mock.method(core.Sounds,'sendSound',()=>{});
  assert.equal(hit.getSpellContext(),context);f.next();f.p.getCombat().setCastSpell(core.CombatSpells.EARTH_STRIKE);
  method.handleAfterHitEffects(hit);
  assert.equal(f.p.getAttribute('cast-context-test:impact'),context);
});
test('generic magic bounds preserve their lower bound in the actual damage roller',t=>{
  assert.equal(typeof core.DamageFormulas.getMagicHitBounds,'function');
  const f=fixture(t);f.p.setAttribute('cast-context-test:bounds',true);
  const target=new core.NPC(1,new core.Location(3200,3200));
  assert.deepEqual(core.DamageFormulas.getMagicHitBounds(f.p,f.spell,target),{minimum:3,maximum:9});
  assert.equal(core.DamageFormulas.getMagicMaxhit(f.p,f.spell,target),9);
  const ranges=[];t.mock.method(core.Misc,'randomInclusive',(minimum,maximum)=>{ranges.push([minimum,maximum]);return minimum;});
  assert.equal(core.CombatFactory.getHitDamage(f.p,target,core.CombatType.MAGIC).getDamage(),3);
  assert.deepEqual(ranges,[[3,9]],'the actual uniform roller receives both bounds, without a post-roll clamp');
});

test('paid snapshots are visible only inside actual hit calculations, not later previews in the same tick',t=>{
  const f=fixture(t);f.spell.canCast(f.p,true);const context=core.Spell.getCastContext(f.p,f.spell);
  core.DamageFormulas.getMagicMaxhit(f.p);assert.equal(f.p.getAttribute('cast-context-test:calculation'),null);
  const target=new core.NPC(1,new core.Location(3200,3200));
  new core.PendingHit(f.p,target,new core.MagicCombatMethod(),{rollAccuracy:false,damage:undefined},true,context);
  assert.equal(f.p.getAttribute('cast-context-test:calculation'),context);
  core.DamageFormulas.getMagicMaxhit(f.p);assert.equal(f.p.getAttribute('cast-context-test:calculation'),null);
});

test('nested and throwing roll scopes restore their previous context',t=>{
  const f=fixture(t);f.spell.canCast(f.p,true);const context=core.Spell.getCastContext(f.p,f.spell);
  core.Spell.withCastContext(f.p,context,()=>{
    assert.equal(core.Spell.getCalculationContext(f.p,f.spell),context);
    assert.throws(()=>core.Spell.withCastContext(f.p,null,()=>{throw new Error('probe');}),/probe/);
    assert.equal(core.Spell.getCalculationContext(f.p,f.spell),context);
  });
  assert.equal(core.Spell.getCalculationContext(f.p,f.spell),null);
});
