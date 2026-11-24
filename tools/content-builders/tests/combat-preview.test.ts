import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {combatPreview,previewStats,previewMaximum,previewDamageRange,visibleHitsplats,visibleStatuses,HIT_TYPES} from '../shared/combat-preview.mjs';
import {specialActivation} from '../shared/special-activation.mjs';
import {newSpecial,newNativeSpecial,newEffects,newAction,compileEffects,validateEffects} from '../shared/effects.mjs';
import {BuilderCache} from '../cache';
const root=path.resolve(import.meta.dirname,'../../..');
const project=()=>({id:'preview-test',kind:'gear',ids:{definition:60888},settings:{equipmentType:'WEAPON',specialFrom:-1,doubleHanded:false,bonuses:[0,0,0,0,0,0,0,0,0,0,40,25,10]},effects:{...newEffects(),special:newSpecial()}});

test('preview presets use exactly the requested external bonuses and never change project or compiled gameplay',()=>{
 const p=project(),before=JSON.stringify(p),manifest=JSON.stringify(compileEffects(p));
 const trueHit=combatPreview(p,p.effects.special),average=combatPreview(p,p.effects.special,{preset:'average'});
 assert.deepEqual(trueHit.stats.external,[78,36,32]);assert.deepEqual(average.stats.external,[39,18,16]);
 assert.equal(trueHit.stats.level,99);assert.equal(average.stats.level,80);assert.equal(trueHit.stats.meleeStrength,118);
 assert.deepEqual(trueHit.primaryMaxima,[35,35]);assert.deepEqual(average.primaryMaxima,[23,23]);
 p.settings.doubleHanded=true;assert.deepEqual(previewStats(p).external,[70,26,27]);assert.deepEqual(previewStats(p,'average').external,[35,13,13.5]);p.settings.doubleHanded=false;
 assert.equal(JSON.stringify(p),before);assert.equal(JSON.stringify(compileEffects(p)),manifest);
});

test('display math matches the native formula and bounds ordering, including rounding, caps and splits',async()=>{
 const cwd=process.cwd();process.chdir(path.join(root,'server'));try{
 const {DamageFormulas}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/formula/DamageFormulas');
 const {CombatFactory}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/CombatFactory');
 const {CombatSpecial}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/CombatSpecial');
 const {FightStyle}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/FightStyle');
 const {BonusManager}=await import('../../../server/src/main/typescript/elvarg/game/model/equipment/BonusManager');
 let traits:any={},style=FightStyle.AGGRESSIVE;const stats=previewStats(project()),other=[];other[BonusManager.STRENGTH]=stats.meleeStrength;other[BonusManager.RANGED_STRENGTH]=stats.rangedStrength;
 const fake:any={isNpc:()=>false,isPlayer:()=>true,getAsPlayer:()=>fake,getPrayerActive:()=>[],getSkillManager:()=>({getCurrentLevel:()=>99}),getBonusManager:()=>({getOtherBonus:()=>other}),getFightType:()=>({getStyle:()=>style}),getCombatSpecial:()=>null,isSpecialActivated:()=>true,getEquipment:()=>({getItems:()=>[],get:()=>({getId:()=>-1}),getWeapon:()=>({getId:()=>-1})})};
 const old=CombatSpecial.activeTraitsFor;CombatSpecial.activeTraitsFor=()=>traits;
 try{
  for(const t of [{},{damageMultiplier:1.15},{damageMultiplierStages:[1.1,1.25]},{damageMultiplierStages:[1.075,1.087],damageMultiplierStageRounding:['ceil','floor']},{strengthLevelMultiplier:1.2,maxHitOverride:37}]){
   traits=t;style=FightStyle.AGGRESSIVE;assert.equal(previewMaximum(stats,'melee',traits),DamageFormulas.calculateMaxMeleeHit(fake));
   style=FightStyle.ACCURATE;assert.equal(previewMaximum(stats,'ranged',traits),DamageFormulas.calculateMaxRangedHit(fake));
  }
  for(const t of [{minimumDamageMultiplier:.25,maximumDamageMultiplier:1.25},{minimumDamageBonus:8,maximumDamageBonus:17,maximumDamageCap:35},{hitMaximumSplitCount:3}]){
   traits=t;for(let i=0;i<3;i++){const bounds:any={reduction:3,...(t.hitMaximumSplitCount?{maximumSplit:{count:3,index:i}}:{})};assert.deepEqual(previewDamageRange(40,t,bounds,i),(CombatFactory as any).specialDamageRange(fake,40,bounds));}
  }
 }finally{CombatSpecial.activeTraitsFor=old;}
 }finally{process.chdir(cwd);}
});

test('multihits stack in the four native slots and preserve per-hit delays and maximum shares',()=>{
 const p=project(),s={...newSpecial(),recipe:true,modifiers:[],extraFeatures:[],ruleFeatures:[{id:'rule-count',type:'hitCount',value:4},{id:'rule-delay',type:'hitDelayTicks',value:[0,0,1,1]},{id:'rule-split',type:'hitMaximumSplitCount',value:4}]},preview=combatPreview(p,s);
 assert.equal(preview.primaryMaxima.reduce((a,b)=>a+b,0),preview.maximum);
 assert.deepEqual(preview.hits.map(h=>h.timeMs),[600,600,1200,1200]);assert.deepEqual(visibleHitsplats(preview.hits,1250).map(h=>h.slot),[0,1,2,3]);assert.equal(visibleHitsplats(preview.hits,3000).length,0);
 assert.ok(preview.hits.every(h=>h.typeId===HIT_TYPES.max));
});

test('poison, venom and burns always proc in the preview and use their first natural pulse and native colors',()=>{
 const p=project(),s={...newSpecial(),chance:0,actions:[{type:'poison',damage:4,chance:0},{type:'venom',chance:0}],extraFeatures:[{id:'extra-burn',type:'burn',values:{damage:10,chance:0,event:'accurate'}}]};
 const old=Math.random;Math.random=()=>{throw new Error('preview must not roll');};
 try{const preview=combatPreview(p,s),dots=preview.hits.filter(h=>h.source==='first-dot');assert.deepEqual(dots.map(h=>[h.type,h.damage,h.timeMs,h.typeId]),[['burn',1,3000,74],['poison',4,18600,65],['venom',6,18600,65]]);assert.equal(preview.endMs,20000);assert.equal(preview.statuses.find(s=>s.label==='Venomed').endMs,null);}finally{Math.random=old;}
});

test('finite statuses count down to zero and expire, including player-only teleblock, without altering durations',()=>{
 const p=project(),preview=combatPreview(p,{...newSpecial(),actions:[{type:'freeze',ticks:32},{type:'teleblock',ticks:500}]});
 assert.equal(visibleStatuses(preview.statuses,600).find(s=>s.label==='Frozen').remainingMs,19200);
 assert.equal(visibleStatuses(preview.statuses,19800).find(s=>s.label==='Frozen').remainingMs,0);assert.ok(!visibleStatuses(preview.statuses,19801).some(s=>s.label==='Frozen'));
 assert.equal(preview.statuses.find(s=>s.label==='Teleblocked').endMs,300600);assert.equal(preview.endMs,300600);
});

test('every native reference previews without random rolls, including editable blood sacrifice and claw distributions',()=>{
 const cache=new BuilderCache(root);try{
  const refs=[];for(let offset=0;;offset+=50){const page=cache.specialDonors('',offset);refs.push(...page.rows);if(refs.length>=page.total)break;}
  const p=project(),random=Math.random;Math.random=()=>{throw new Error('preview must not roll');};
  try{for(const ref of refs.filter(r=>r.recipe)){const s=newNativeSpecial(ref),before=JSON.stringify(s),preview=combatPreview(p,s,{references:refs});assert.ok(Number.isFinite(preview.maximum),ref.name);assert.ok(preview.hits.every(h=>Number.isInteger(h.damage)&&h.damage>=0&&Number.isFinite(h.timeMs)),ref.name);assert.equal(JSON.stringify(s),before);}
   const s=newNativeSpecial(refs.find(r=>r.name==='Ancient godsword'));Object.assign(s.nativeFeatures[0].values,{damage:37,delayTicks:4});const preview=combatPreview(p,s,{references:refs});assert.ok(preview.hits.some(h=>h.source==='follow-up'&&h.damage===37&&h.timeMs===3000));assert.ok(visibleStatuses(preview.statuses,1800).some(s=>s.label==='Blood sacrifice'&&s.remainingMs===1200));
  }finally{Math.random=random;}
 }finally{cache.close();}
});

test('self casts have no hostile hits while melee weapons can activate at ranged distance with the same damage formula',()=>{
 const p=project(),rule=newSpecial(),melee=combatPreview(p,rule),ranged=combatPreview(p,{...rule,activation:'ranged'}),self=combatPreview(p,{...rule,activation:'self'});
 assert.deepEqual(ranged.primaryMaxima,melee.primaryMaxima);assert.equal(ranged.activation,'ranged');assert.equal(self.hits.length,0);assert.equal(self.selfCast,true);
 const legacy={...rule};delete legacy.activation;assert.equal(specialActivation(legacy),'melee');assert.equal(specialActivation({...legacy,style:'magic'}),'ranged');
 assert.equal(specialActivation({...legacy,ruleFeatures:[{type:'skipAttack',value:true}]}),'self');assert.equal(specialActivation({...legacy,ruleFeatures:[{type:'skipAttack',value:true}],extraFeatures:[{type:'knockback'}]}),'melee');
 assert.throws(()=>validateEffects({...newEffects(),special:{...rule,activation:'invalid'}}),/activation type/);
 for(const type of ['venom','teleblock'])assert.equal(validateEffects({...newEffects(),special:{...rule,actions:[newAction(type)]}}).special.actions[0].type,type);
});

test('hitsplat assets resolve transformed native definitions into actual sprites and digit glyphs',()=>{
 const cache=new BuilderCache(root);try{for(const theme of cache.hitsplatThemes()){assert.ok(theme.font?.digits.length===10);assert.ok(theme.font.digits.every(g=>Buffer.from(g.mask,'base64').some(n=>n!==0)));assert.ok([theme.left,theme.left2,theme.middle,theme.right].some(part=>part&&Buffer.from(part.rgba,'base64').some(n=>n!==0)));assert.ok(theme.durationMs>0);}}finally{cache.close();}
});

test('ranged previews select the strongest compatible ammunition and never double-count thrown or self-ammo weapons',()=>{
 const cache=new BuilderCache(root);try{
  const cases=[[861,'Amethyst arrow',55],[11235,'Dragon arrow',60],[9185,'Onyx bolts',120],[19481,'Dragon javelin',150],[12926,'Dragon dart',35]];
  for(const [weapon,name,strength] of cases){const ammo=cache.previewAmmunition(weapon);assert.equal(ammo.name,name);assert.equal(ammo.strength,strength);}
  for(const id of [25867,22809,868,11230,1215])assert.equal(cache.previewAmmunition(id),null);
  const p=project(),s={...newSpecial(),style:'ranged',activation:'ranged'},before=JSON.stringify(p),base=combatPreview(p,s),loaded=combatPreview(p,s,{ammoStrength:60,ammoName:'Dragon arrow'});assert.ok(loaded.maximum>base.maximum);assert.equal(loaded.stats.rangedStrength,base.stats.rangedStrength+60);
  const average=combatPreview(p,s,{preset:'average',ammoStrength:60});assert.equal(average.stats.rangedStrength,25+18+60,'only the external gear bonus is halved');assert.equal(JSON.stringify(p),before);
  const formula={...s,extraFeatures:[{type:'ranged-formula',values:{from:'ammo',stance:10,divisor:640}}]};assert.equal(combatPreview(p,formula,{ammoStrength:55}).maximum,Math.floor(.5+(99+10)*(55+64)/640));
 }finally{cache.close();}
});
