import {attackTraits,scaleTrait} from './attack-rules.mjs';
import {resolveMechanics} from './native-mechanics.mjs';
import {specialActivation} from './special-activation.mjs';

// These profiles are display inputs only. Never copy them into a project or manifest.
export const DAMAGE_PRESETS=Object.freeze({
 true:Object.freeze({name:'True max hit',level:99,bonusScale:1}),
 average:Object.freeze({name:'Average max hit',level:80,bonusScale:.5})
});
export const HIT_TYPES=Object.freeze({miss:12,damage:16,max:43,poison:65,venom:65,burn:74,bleed:16});
const tick=600,positive=value=>Math.max(0,Math.floor(value)),sum=rows=>rows.reduce((a,b)=>a+b,0);
export function previewStats(project,preset='true'){
 const profile=DAMAGE_PRESETS[preset];if(!profile)throw new Error('Unknown preview damage preset.');
 const external=project.settings.doubleHanded?[70,26,27]:[78,36,32],own=project.settings.bonuses??[];
 return {level:profile.level,meleeStrength:Number(own[10]??0)+external[0]*profile.bonusScale,rangedStrength:Number(own[11]??0)+external[1]*profile.bonusScale,magicPercent:Number(own[12]??0)+external[2]*profile.bonusScale,external:external.map(n=>n*profile.bonusScale)};
}
const magicBonus=(base,stats)=>Math.floor(base*(1000+Math.round(stats.magicPercent*10))/1000);
const stages=(base,traits)=>(traits.damageMultiplierStages??[traits.damageMultiplier??1]).reduce((n,m,i)=>Math[traits.damageMultiplierStageRounding?.[i]==='ceil'?'ceil':'floor'](n*Math.round(m*1000)/1000),base);
export function previewMaximum(stats,style,traits={}){
 if(traits.maxHitOverride!==undefined)return positive(traits.maxHitOverride);
 const source=traits.maximumHitSource??style;
 let base;
 if(source==='magic'||source==='visible_magic')base=magicBonus(source==='visible_magic'?Math.min(traits.visibleMagicMaximumHit??1,Math.floor((traits.visibleMagicMaximumHit??1)*stats.level/99+1)):1,stats);
 else {const ranged=source==='ranged',effective=Math.floor(stats.level*(traits.strengthLevelMultiplier??1))+3+8;const strength=ranged?stats.rangedStrength:stats.meleeStrength;base=Math.floor((effective*(strength+64)+320)/640);}
 return positive(source==='visible_magic'?base:stages(base,traits));
}
/** Same ordering as CombatFactory.specialDamageRange: scale, add, cap, reduce, split. */
export function previewDamageRange(max,traits={},bounds={},index=0){
 let minimum=Math.floor(max*(bounds.minimumMultiplier??traits.minimumDamageMultiplier??0))+Math.trunc(bounds.minimumBonus??traits.minimumDamageBonus??0),maximum=Math.floor(max*(bounds.maximumMultiplier??traits.maximumDamageMultiplier??1))+Math.trunc(bounds.maximumBonus??traits.maximumDamageBonus??0);
 const cap=bounds.cap??traits.maximumDamageCap;if(cap!==undefined){maximum=Math.min(maximum,Math.trunc(cap));minimum=Math.min(minimum,maximum);}
 if(bounds.reduction>0){maximum=Math.max(0,maximum-Math.trunc(bounds.reduction));minimum=Math.min(minimum,maximum);}
 if(maximum<minimum)[minimum,maximum]=[maximum,minimum];
 if(traits.hitMaximumSplitCount){const count=Math.max(1,traits.hitMaximumSplitCount),i=Math.min(count-1,index);maximum=Math.floor(maximum*(i+1)/count)-Math.floor(maximum*i/count);minimum=Math.min(minimum,maximum);}
 return {minimum:positive(minimum),maximum:positive(maximum)};
}
function nativeGroups(rule,references){return (rule.nativeFeatures??[]).flatMap(feature=>{const group=references.find(r=>r.id===feature.source)?.mechanics?.find(g=>g.id===feature.mechanic);if(!group)return [];const values=resolveMechanics([group],{[group.id]:feature.values})[group.id];return values.enabled===false?[]:[{id:feature.id,type:group.id,values,group}];});}

/** Deterministic successful exchange. Does not mutate saved data or roll proc/accuracy chances. */
export function combatPreview(project,rule,{preset='true',impactMs=600,special=true,references=[],targetIsPlayer=false,ammoStrength=0,ammoName=''}={}){
 const stats={...previewStats(project,preset)};stats.rangedStrength+=ammoStrength;
 const activation=special?specialActivation(rule):'melee',selfCast=special&&activation==='self',hits=[],statuses=[],assumptions=[];
 const traits=special?{...(rule.recipe?{}:rule),...attackTraits(rule)}:{},extras=rule.extraFeatures??[],native=nativeGroups(rule,references),has=type=>extras.find(row=>row.type===type)?.values;
 if(!special)Object.assign(traits,{damageMultiplier:1});
 if(selfCast)impactMs=0;
 for(const row of extras){const v=row.values;
  if(row.type==='energy-bonus')scaleTrait(traits,'damageMultiplier',1+Math.floor(100/v.step)*v.damagePerStep/100);
  if(row.type==='human-magic'){
   traits.maximumHitSource='visible_magic';traits.visibleMagicMaximumHit=v.base;
   if(v.formula==='volatile')traits.maxHitOverride=magicBonus(Math.min(v.base,Math.floor(stats.level*263/449+1)),stats);
   if(v.formula==='powered-staff')traits.maxHitOverride=magicBonus(v.base,stats);
   traits.minimumDamageBonus=Math.max(traits.minimumDamageBonus??0,v.minimum);
  }
  if(row.type==='ranged-formula'){const strength=v.from==='ammo'?ammoStrength:Number(project.settings.bonuses?.[11]??0);traits.maxHitOverride=positive(.5+(stats.level+v.stance)*(strength+64)/v.divisor);}
  if(row.type==='charged-hits')traits.hitCount=v.initialCharges>0?v.charged:v.uncharged;
  if(row.type==='multi-primary'&&!v.multiOnly)traits.hitCount=v.hits;
  if(['soul-stacks','freeze-bonus','burn-bonus','charge-slam','stack-explosion','cure-bonus'].includes(row.type))assumptions.push(`${row.type}: no pre-existing stacks, charges or afflictions.`);
 }
 const style=rule.style==='any'||!rule.style?'melee':rule.style,maximum=previewMaximum(stats,style,traits),count=selfCast||traits.skipAttack||!special&&['interval','hp-below','prayer-below','equip'].includes(rule.trigger)?0:traits.hitCount??(special?rule.hitCount??1:1),offsets=traits.hitDelayTicks??(special?rule.hitDelayTicks??[]:[]);
 const addHit=(damage,at,type='damage',recipient='target',source='primary')=>{const value=positive(damage);hits.push({damage:value,timeMs:Math.max(0,at),type:value?type:'miss',typeId:HIT_TYPES[value?type:'miss'],recipient,source});};
 const addStatus=(label,at,duration,recipient='target',extra={})=>{statuses.push({label,startMs:at,endMs:duration===null?null:at+duration,recipient,...extra});};
 const accuracyBranch=traits.damageRangeBySuccessfulAccuracyRolls?.[Math.max(0,(traits.accuracyRollCount??1)-1)],first=traits.firstSuccessfulAccuracyDamageRanges?.[0];
 const bounds=first?{minimumMultiplier:first.minimumDamageMultiplier,maximumMultiplier:first.maximumDamageMultiplier,reduction:first.maximumDamageReduction}:accuracyBranch?{minimumMultiplier:accuracyBranch.minimumDamageMultiplier,maximumMultiplier:accuracyBranch.maximumDamageMultiplier,reduction:traits.maximumHitReductionOnFullAccuracyRolls??0}:{reduction:traits.maximumHitReductionOnFullAccuracyRolls??0};
 const rolled=previewDamageRange(maximum,traits,bounds).maximum;
 for(let i=0;i<count;i++){
  let damage=previewDamageRange(maximum,traits,bounds,i).maximum;
  if(first?.distribution==='random-follow-up')damage=i===0?rolled:Math.floor(rolled*(first.followUpMaximum??.75));
  else if(first?.hitDamageMultipliers)damage=Math.floor(rolled*(first.hitDamageMultipliers[i]??0))+(first.hitDamageBonuses?.[i]??0);
  const ammo=has('ammo-damage');if(ammo){const dragon=/dragon arrow/i.test(ammoName);damage=Math.max(dragon?ammo.dragonMinimum:ammo.normalMinimum,Math.min(dragon?ammo.dragonCap:10000,Math.floor(damage*(dragon?ammo.dragon:ammo.normal)/100)));}
  if(has('split-accurate'))damage=Math.max(has('split-accurate').minimum,Math.floor(rolled*(i+1)/count)-Math.floor(rolled*i/count));
  if(!special&&i===0)damage+=rule.bonusDamage??0;
  addHit(damage,impactMs+(offsets[i]??0)*tick,'max');
 }
 const primary=[...hits],total=sum(primary.map(h=>h.damage));
 const poison=(damage,at,type='poison')=>{if(!(damage>0))return;const until=type==='venom'?null:damage*5*30*tick;addHit(type==='venom'?6:damage,at+30*tick,type,'target','first-dot');addStatus(type==='venom'?'Venomed':'Poisoned',at,until,'target',{firstTickMs:at+30*tick});};
 const burn=(damage,at,stacks=1)=>{if(!(damage>0))return;addHit(Math.min(5,stacks),at+4*tick,'burn','target','first-dot');addStatus('Burning',at,damage*4*tick,'target',{firstTickMs:at+4*tick});};
 const action=(a,at)=>{
  if(a.type==='freeze')addStatus('Frozen',at,a.ticks*tick);
  if(a.type==='teleblock')addStatus('Teleblocked',at,a.ticks*tick,'target',{playersOnly:true});
  if(a.type==='poison'||a.type==='venom')poison(a.damage??6,at,a.type);
  if(a.type.startsWith('drain'))addStatus(a.type==='drain'?'Defence reduced':a.skill?`${a.skill[0].toUpperCase()+a.skill.slice(1)} reduced`:'Stats reduced',at,null);
 };
 for(const a of rule.actions??[])action(a,a.phase==='launch'?0:impactMs);
 for(const row of native){if(selfCast&&row.group.event!=='launch')continue;const v=row.values,at=row.group.event==='launch'?0:impactMs;
  if(row.group.preview?.damageParameter){const cue=row.group.preview,delay=Number(v[cue.delayParameter]??0)*tick;addStatus(row.group.name,at,delay);addHit(v[cue.damageParameter],at+delay,'damage',cue.recipient??'target','follow-up');}
  if(row.type==='freeze')addStatus('Frozen',at,v.durationTicks*tick);
  if(row.type==='prayer-block')addStatus('Protection prayers locked',at,v.durationTicks*tick,'target',{playersOnly:true});
  if(row.type==='poison')poison(v.damage,at);
  if(['burn','burn-rolls'].includes(row.type))burn(v.damage,at,v.perHit?Math.max(1,primary.length):1);
  if(/drain$/.test(row.type))addStatus('Stats reduced',at,null);
 }
 for(const row of extras){const v=row.values;if(selfCast&&v.event&&v.event!=='launch')continue;const at=v.event==='launch'?0:impactMs;
  if(row.type==='follow-up')addHit(Math.floor(v.maximum*v.percent/100),at+v.delayTicks*tick,'damage','target','follow-up');
  if(row.type==='next-flames')addHit(v.maximum,at+v.delayTicks*tick,'damage','target','follow-up');
  if(row.type==='burn')burn(v.damage,at);
  if(row.type==='bleed'&&(!v.playersOnly||targetIsPlayer)){const amount=Math.floor(total*v.percent/100),pulses=Math.ceil(amount/v.chunk);if(pulses>0){addHit(Math.min(v.chunk,amount),at+v.intervalTicks*tick,'bleed','target','first-dot');addStatus('Bleeding',at,pulses*v.intervalTicks*tick);}}
  if(row.type==='knockback')addStatus('Stunned',at,v.stunTicks*tick);
  if(['protection','empower-attacks','ally-empower'].includes(row.type))addStatus({'protection':'Protected','empower-attacks':'Attacks empowered','ally-empower':'Next attack empowered'}[row.type],at,v.durationTicks*tick,'player');
  if(['vulnerability','hamstring'].includes(row.type))addStatus(row.type==='vulnerability'?'Vulnerable':'Run energy drain increased',at,v.durationTicks*tick,'target',{playersOnly:row.type==='hamstring'});
 }
 if(selfCast){for(const hit of hits)hit.recipient='player';for(const status of statuses)status.recipient='player';}
 for(const status of statuses)if(status.playersOnly&&!targetIsPlayer&&!selfCast)status.previewOnly=true;
 hits.sort((a,b)=>a.timeMs-b.timeMs);
 const endMs=Math.max(2000,...hits.map(h=>h.timeMs+1400),...statuses.map(s=>s.firstTickMs!==undefined?s.firstTickMs+1400:s.endMs??s.startMs+2400));
 return {stats,preset,activation,selfCast,maximum,primaryMaxima:primary.map(h=>h.damage),hits,statuses,endMs,assumptions};
}

/** Four native slots with the definition’s overflow priority. */
export function visibleHitsplats(hits,timeMs,lifetime=1400){
 const slots=Array(4).fill(null);let next=0;
 for(const hit of hits){if(hit.timeMs>timeMs)break;const info=typeof lifetime==='function'?lifetime(hit):lifetime,life=typeof info==='number'?info:info.durationMs,priority=typeof info==='number'?-1:info.compareType;if(slots.every(h=>!h||h.timeMs+h.lifetime<=hit.timeMs))next=0;let slot=-1;for(let i=0;i<4;i++){const candidate=next;next=(next+1)%4;if(!slots[candidate]||slots[candidate].timeMs+slots[candidate].lifetime<=hit.timeMs){slot=candidate;break;}}if(slot<0){if(priority===-1)continue;slot=slots.reduce((best,h,i)=>(priority===1?h.damage<slots[best].damage:h.timeMs+h.lifetime<slots[best].timeMs+slots[best].lifetime)?i:best,0);if(priority===1&&slots[slot].damage>=hit.damage)continue;}slots[slot]={...hit,slot,lifetime:life};}
 return slots.filter(h=>h&&timeMs<h.timeMs+h.lifetime);
}
export function visibleStatuses(statuses,timeMs){return statuses.filter(s=>timeMs>=s.startMs&&(s.endMs===null||timeMs<=s.endMs)).map(s=>({...s,remainingMs:s.endMs===null?null:Math.max(0,s.endMs-timeMs)}));}
