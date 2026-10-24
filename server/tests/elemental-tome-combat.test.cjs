const assert=require('node:assert/strict');
const {before,test}=require('node:test');
const {Server}=require('../dist/Server');Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {NpcDefinition}=require('../dist/game/definition/NpcDefinition');
const {AccuracyFormulasDpsCalc:Accuracy}=require('../dist/game/content/combat/formula/AccuracyFormulasDpsCalc');
const Common=require('../plugins/items/elementaltomes/Common.ElementalTomes');
const core=PluginManager.getCoreApi();
const TEST='elemental-tome-test:enabled',bounds=new WeakMap();
before(async()=>{
 await CachePipeline.initialize(process.cwd());
 require('../plugins/combat/ElementalSpells.plugin').register(PluginManager.createApi('ElementalScalingTest'));
 require('../plugins/combat/StandardCurses.plugin').register(PluginManager.createApi('StandardCurseTest'));
 require('../plugins/items/ElementalStaves.plugin').register(PluginManager.createApi('ElementalStavesTest'));
 require('../plugins/items/ElementalTomes.plugin').register(PluginManager.createApi('ElementalTomesTest'));
 const api=PluginManager.createApi('TomeProbe');
 api.onCombatHitRoll(event=>{if(event.attacker.getAttribute?.(TEST))event.forceAccurate=true;});
 api.onCustomEvent('combat:magic-hit-bounds',event=>{if(event.attacker.getAttribute?.(TEST))bounds.set(event.attacker,{minimum:event.minHit,maximum:event.maxHit});});
 api.onCustomEvent('magic:rune-saving',event=>{if(event.player.getAttribute('elemental-tome-test:save-runes'))event.saved=true;});
});
function player(t){const p=new Player(null);t.mock.method(p,'getSession',()=>({sendClientPacket:()=>true}));t.mock.method(p,'sendMessage',()=>{});
 p.getSkillManager().setMaxLevel(core.Skill.MAGIC,99);p.getSkillManager().setCurrentLevel(core.Skill.MAGIC,99,false);return p;}
function fixture(t,{element='earth',spellName=element.toUpperCase()+'_WAVE',charges=3,searing=false,pvp=false,damage=50,weakness=60,includeElement=false,level=100}={}){
 let cycle=10;t.mock.method(core.World,'getProcessCycle',()=>cycle);t.mock.method(Date,'now',()=>cycle*600);t.mock.method(core.Sounds,'sendSound',()=>{});
 const p=player(t);p.setAttribute(TEST,true);
 const definition=Object.assign(new NpcDefinition(),{stats:[level,level,level,level,level],elementalWeaknessType:['wind','water','earth','fire'].indexOf(element)+1,elementalWeaknessPercent:weakness});
 const target=pvp?player(t):new core.NPC(1,new core.Location(3200,3200));if(!pvp)t.mock.method(target,'getCurrentDefinition',()=>definition);
 t.mock.method(p.getCombat(),'getTarget',()=>target);
 const itemId=core.ItemIdentifiers['TOME_OF_'+element.toUpperCase()+'_EMPTY_'];const book=new core.Item(itemId),bookDefinition=Common.getDefinition(itemId);
 Common.set(book,bookDefinition,charges,searing?bookDefinition.specialPageId:bookDefinition.pageId);
 p.getEquipment().getItems()[core.Equipment.SHIELD_SLOT]=book;
 p.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH]=damage;
 p.getBonusManager().getAttackBonus()[core.BonusManager.ATTACK_MAGIC]=100;
 const spell=core.CombatSpells[spellName];p.getCombat().setCastSpell(spell);
 for(const item of spell.itemsRequired(p)??[])if(includeElement||item.getId()!==bookDefinition.rune)p.getInventory().add(new core.Item(item.getId(),item.getAmount()*10));
 return{p,target,book,spell,bookDefinition,next(){cycle++;},
  preview(){return core.DamageFormulas.getMagicHitBounds(p,spell,target);},
  commit(){return spell.canCast(p,true);},
  hit(){return new core.MagicCombatMethod().hits(p,target)[0];}};
}
test('all fifteen matching standard elemental spells multiply the geared weakness maximum last without consuming previews',t=>{
 for(const element of ['fire','water','earth'])for(const [family,maximum] of [['STRIKE',17],['BOLT',27],['BLAST',36],['WAVE',46],['SURGE',55]]){
  const f=fixture(t,{element,spellName:element.toUpperCase()+'_'+family});
  assert.equal(f.preview().maximum,maximum,element+' '+family);assert.equal(Common.read(f.book).charges,3);
  assert.equal(f.commit(),true,element+' '+family+' pays successfully');
  assert.equal(Common.read(f.book).charges,2,element+' '+family+' spends one charge');
 }
});
test('matching charged tomes supply only their own rune, composing with staves and other spellbooks',t=>{
 for(const element of ['fire','water','earth']){
  const f=fixture(t,{element});assert.ok(f.spell.itemsRequired(f.p).some(item=>item.getId()===f.bookDefinition.rune));
  assert.equal(f.spell.itemsToConsume(f.p).some(item=>item.getId()===f.bookDefinition.rune),false);
 }
 const f=fixture(t,{element:'fire',spellName:'IBAN_BLAST'});
 assert.equal(f.spell.itemsToConsume(f.p).some(item=>item.getId()===core.ItemIdentifiers.FIRE_RUNE),false);
 f.p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]=new core.Item(core.ItemIdentifiers.MYSTIC_AIR_STAFF);
 assert.equal(core.Spell.inventoryShortfall(f.p,core.CombatSpells.FIRE_WAVE.itemsToConsume(f.p)).some(item=>[core.ItemIdentifiers.AIR_RUNE,core.ItemIdentifiers.FIRE_RUNE].includes(item.getId())),false);
});
test('each paid cast consumes exactly one charge, while previews, cooldown and missing resources do not',t=>{
 const f=fixture(t);assert.equal(f.spell.canCast(f.p,false),true);assert.equal(Common.read(f.book).charges,3);
 assert.equal(f.commit(),true);assert.equal(Common.read(f.book).charges,2);
 assert.equal(f.commit(),false);assert.equal(Common.read(f.book).charges,2);
 f.next();assert.equal(f.commit(),true);assert.equal(Common.read(f.book).charges,1);
 f.p.getInventory().resetItems();f.next();assert.equal(f.commit(),false);assert.equal(Common.read(f.book).charges,1);
});
test('a final charge benefits the actual hit but not same-tick or later previews',t=>{
 const f=fixture(t,{charges:1});assert.equal(f.commit(),true);assert.equal(Common.read(f.book).charges,0);
 assert.equal(f.preview().maximum,42);f.hit();assert.equal(bounds.get(f.p).maximum,46);
 assert.equal(f.preview().maximum,42);f.next();assert.equal(f.preview().maximum,42);
});
test('rune-saving does not create a second charge decision or prevent the paid tome charge',t=>{
 const f=fixture(t);f.p.setAttribute('elemental-tome-test:save-runes',true);
 const rune=f.spell.itemsRequired(f.p).find(item=>item.getId()!==f.bookDefinition.rune).getId(),before=f.p.getInventory().getAmount(rune);
 assert.equal(f.commit(),true);assert.equal(Common.read(f.book).charges,2);assert.equal(f.p.getInventory().getAmount(rune),before);
 f.hit();assert.equal(Common.read(f.book).charges,2);
});
test('wrong elements, nonstandard spellbooks, empty and unequipped tomes receive no damage bonus',t=>{
 for(const spellName of ['FIRE_WAVE','ICE_BARRAGE','FLAMES_OF_ZAMORAK','IBAN_BLAST']){
  const f=fixture(t,{spellName}),withBook=f.preview();f.p.getEquipment().getItems()[core.Equipment.SHIELD_SLOT]=new core.Item(-1);
  assert.deepEqual(f.preview(),withBook,spellName);
 }
 const f=fixture(t,{charges:0});assert.equal(f.preview().maximum,42);
 assert.equal(f.spell.itemsToConsume(f.p).some(item=>item.getId()===f.bookDefinition.rune),true);
});
test('searing supplies a true minimum from the pre-tome maximum and keeps its final-charge snapshot',t=>{
 const f=fixture(t,{element:'fire',searing:true,charges:1});assert.deepEqual(f.preview(),{minimum:4,maximum:46});
 assert.equal(f.commit(),true);assert.deepEqual(f.preview(),{minimum:0,maximum:42});f.hit();assert.deepEqual(bounds.get(f.p),{minimum:4,maximum:46});
});
test('actual PvP targets select Fire50%, Water20% and Earth10% damage',t=>{
 for(const [element,maximum]of[['fire',45],['water',36],['earth',33]])assert.equal(fixture(t,{element,pvp:true}).preview().maximum,maximum,element);
});
test('Water accuracy is applied before the additive raw weakness stage; curses get20%',t=>{
 const f=fixture(t,{element:'water'}),raw=108*164;
 assert.equal(Accuracy.attackMagicRoll(f.p,f.target),Math.floor(raw*1.1)+Math.floor(raw*.6));
 const curse=fixture(t,{element:'water',spellName:'CONFUSE'});
 assert.equal(Accuracy.attackMagicRoll(curse.p,curse.target),Math.floor(raw*1.2));
});
test('Water curses consume one charge and retain their boosted impact after gear changes and later ticks',t=>{
 for(const [spellName,skill,expected]of[['CONFUSE','ATTACK',93],['WEAKEN','STRENGTH',93],['CURSE','DEFENCE',93],['VULNERABILITY','DEFENCE',85],['ENFEEBLE','STRENGTH',85],['STUN','ATTACK',85]]){
  const f=fixture(t,{element:'water',spellName,charges:1});assert.equal(f.commit(),true,spellName);const hit=f.hit();
  assert.equal(Common.read(f.book).charges,0);f.next();f.p.getEquipment().getItems()[core.Equipment.SHIELD_SLOT]=new core.Item(-1);
  new core.MagicCombatMethod().handleAfterHitEffects(hit);assert.equal(f.target.getCurrentLevel(core.Skill[skill]),expected,spellName);
 }
});
test('equipping a Water tome after a paid plain curse cannot retroactively boost the old impact',t=>{
 const f=fixture(t,{element:'water',spellName:'CONFUSE',charges:0,includeElement:true});assert.equal(f.commit(),true);const hit=f.hit();
 Common.set(f.book,f.bookDefinition,20,f.bookDefinition.pageId);f.next();new core.MagicCombatMethod().handleAfterHitEffects(hit);
 assert.equal(f.target.getCurrentLevel(core.Skill.ATTACK),95);assert.equal(Common.read(f.book).charges,20);
});

test('a splash spends its paid charge once and cannot apply a Water stat curse',t=>{
 const f=fixture(t,{element:'water',spellName:'CONFUSE',charges:1});
 f.p.setAttribute(TEST,false);t.mock.method(Accuracy,'rollAccuracy',()=>false);
 assert.equal(f.commit(),true);const hit=f.hit();assert.equal(hit.isAccurate(),false);
 assert.equal(Common.read(f.book).charges,0);
 new core.MagicCombatMethod().handleAfterHitEffects(hit);
 assert.equal(f.target.getCurrentLevel(core.Skill.ATTACK),100);
 assert.equal(Common.read(f.book).charges,0);
});

test('all nine Water curse casts pay once, while Tele Block and Iban Blast retain charges',t=>{
 for(const spellName of ['CONFUSE','WEAKEN','CURSE','VULNERABILITY','ENFEEBLE','STUN','BIND','SNARE','ENTANGLE']){
  const f=fixture(t,{element:'water',spellName});assert.equal(f.commit(),true,spellName);
  assert.equal(Common.read(f.book).charges,2,spellName);
 }
 for(const [element,spellName]of [['water','TELEBLOCK'],['fire','IBAN_BLAST']]){
  const f=fixture(t,{element,spellName});
  if(spellName==='IBAN_BLAST')f.p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]=new core.Item(core.ItemIdentifiers.IBANS_STAFF);
  assert.equal(f.commit(),true,spellName);
  assert.equal(Common.read(f.book).charges,3,spellName);
 }
});

test('paid casts and final charges remain independent between owners and separate tome instances',t=>{
 const a=fixture(t,{element:'fire',charges:1}),b=fixture(t,{element:'fire',charges:2});
 assert.equal(a.commit(),true);assert.equal(Common.read(b.book).charges,2);
 const replacement=new core.Item(a.bookDefinition.emptyId);Common.set(replacement,a.bookDefinition,40,a.bookDefinition.pageId);
 a.p.getEquipment().getItems()[core.Equipment.SHIELD_SLOT]=replacement;
 a.hit();assert.equal(bounds.get(a.p).maximum,46);assert.equal(Common.read(replacement).charges,40);
 assert.equal(b.commit(),true);assert.equal(Common.read(b.book).charges,1);
 assert.equal(Common.read(a.book).charges,0);
});

test('Water floors the enhanced curse percentage before applying it to high-stat targets',t=>{
 for(const [spellName,expected]of [['CONFUSE',186],['STUN',170]]){
  const f=fixture(t,{element:'water',spellName,level:200});
  assert.equal(f.commit(),true);const hit=f.hit();new core.MagicCombatMethod().handleAfterHitEffects(hit);
  assert.equal(f.target.getCurrentLevel(core.Skill.ATTACK),expected,spellName);
 }
});
