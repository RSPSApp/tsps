import {referenceRules} from './attack-rules.mjs';
import {featureDefaults} from './attack-features.mjs';
// These recipes supplement the canonical declarative traits, never inherit a combat method.
// Each special listed here has been audited for non-trait behaviour.
const simple=new Set(['abyssal_dagger','abyssal_dagger_bh','ancient_godsword','arclight','arkan_blade','armadyl_crossbow','armadyl_godsword','ballista','bandos_godsword','barrelchest_anchor','bone_dagger','burning_claws','darklight','dawnbringer','dorgeshuun_crossbow','dragon_2h_sword','dragon_axe','dragon_claws','dragon_crossbow','dragon_dagger','dragon_halberd','dragon_harpoon','dragon_knife','dragon_longsword','dragon_mace','dragon_pickaxe','dragon_scimitar','dragon_sword','dragon_thrownaxe','dragon_warhammer','emberlight','granite_hammer','granite_maul','osmuntens_fang','osmumtens_fang','rune_claws','saradomin_godsword','saradomins_blessed_sword','seercull','statius_warhammer','statius_warhammer_bh','vestas_longsword','vestas_longsword_bh','vestas_spear_deadman','voidwaker','zamorak_godsword','zaryte_crossbow','abyssal_bludgeon','rosewood_blowpipe']);
const recipes={
 dragon_knife:{traits:{hitCount:2}},
 seercull:{extras:[['ranged-formula',{from:'ammo'}]]},
 zoryas_tome:{animation:15140,visuals:[{id:4432,recipient:'player',phase:'launch',height:100},{id:4430,recipient:'target',phase:'impact'}],traits:{accuracyMultiplier:2.5,damageMultiplier:1.6},extras:[['human-magic',{formula:'powered-staff',base:18,useCharge:false}],['empower-attacks',{accuracy:2.5,damage:1.6,durationTicks:50}]]},
 abyssal_tentacle:{actions:[{type:'freeze',ticks:8,phase:'launch'},{type:'poison',damage:4,chance:50,phase:'launch'}]},
 abyssal_whip:{extras:[['run-transfer',{}]]},
 accursed_sceptre:{extras:[['capped-drain',{}],['human-magic',{formula:'powered-staff',base:29,range:7,useCharge:false}]]},
 ancient_mace:{extras:[['transfer',{resource:'prayer',basis:'damage',overheal:true}]]},
 blue_moon_spear:{traits:{meleeAttackBonusIndex:2},extras:[['condition',{fullMoonSet:'blue'}],['freeze-bonus',{}]]},
 brine_sabre:{extras:[['condition',{underwaterOnly:true}],['damage-boost',{}]]},
 dinhs_bulwark:{extras:[['highest-drain',{}],['multi-primary',{}]]},
 dragon_battleaxe:{extras:[['rampage',{}]]},
 dragon_hasta:{traits:{meleeAttackBonusIndex:0},extras:[['energy-bonus',{}]]},
 dual_macuahuitl:{extras:[['condition',{fullMoonSet:'blood'}],['self-damage',{percent:25}],['reduce-delay',{}]],traits:{hitMaximumSplitCount:2}},
 eclipse_atlatl:{extras:[['condition',{fullMoonSet:'eclipse'}],['burn-bonus',{}]]},
 elder_maul:{extras:[['drain-current',{percent:35,skill:'defence'}]]},
 eldritch_nightmare_staff:{extras:[['human-magic',{}],['prayer-recovery',{}]],traits:{attackSpeedTicks:5}},
 eye_of_ayak:{extras:[['human-magic',{formula:'powered-staff',base:33,delayTicks:5,range:6,useCharge:false}],['bonus-drain',{}]],traits:{attackSpeedTicks:5}},
 keris_partisan_of_corruption:{extras:[['condition',{tombsOnly:true}],['vulnerability',{}]]},
 keris_partisan_of_the_sun:{extras:[['condition',{tombsOnly:true}],['restore-levels',{}]]},
 magic_longbow:{extras:[['ranged-formula',{from:'ammo'}]]},
 magic_shortbow:{extras:[['ranged-formula',{from:'ammo'}]],traits:{hitCount:2,hitDelayTicks:[0,1]}},
 morrigans_javelin:{extras:[['bleed',{}]]},
 morrigans_throwing_axe_bh:{extras:[['hamstring',{}]]},
 noxious_halberd:{extras:[['condition',{poisonedOnly:true}],['cure-bonus',{}]]},
 rune_thrownaxe:{extras:[['chain',{}],['ranged-formula',{from:'weapon'}]]},
 saradomin_sword:{extras:[['follow-up',{}]]},
 scorching_bow:{extras:[['condition',{demonOnly:true}],['projectile',{id:2807,delayCycles:46,baseCycles:46,cyclesPerTile:5,angle:255,progress:80}],['burn',{damage:4,event:'launch'}],['follow-up',{event:'launch',minimum:1,maximum:1,style:'typeless',respectPrayer:false}]],actions:[{type:'freeze',ticks:20,phase:'launch'}],traits:{skipAttack:true}},
 shove:{extras:[['knockback',{}]],traits:{skipAttack:true}},
 soulreaper_axe:{extras:[['soul-stacks',{}]]},
 staff_of_the_dead:{extras:[['protection',{}]]},staff_of_light:{extras:[['protection',{}]]},staff_of_balance:{extras:[['protection',{}]]},toxic_staff_of_the_dead:{extras:[['protection',{}]]},
 toxic_blowpipe:{animation:876,actions:[{type:'heal',percent:50,minimum:0,basis:'rolled'}]},
 vestas_spear_bh:{extras:[['protection',{durationTicks:8,reduction:100,ranged:true,requiresEquipped:false,blockEffects:true}],['reduce-delay',{}]]},
 volatile_nightmare_staff:{extras:[['human-magic',{formula:'volatile',base:58,minimum:1}]],traits:{attackSpeedTicks:5}},
 webweaver_bow:{actions:[{type:'poison',damage:4,chance:50}]},
 excalibur:{extras:[['skill-boost',{skill:'defence',flat:8,percent:0,addCurrent:true}]]},
 purging_staff:{extras:[['condition',{demonOnly:true}],['human-magic',{formula:'demonbane',delayTicks:3,range:10,useCharge:false}]]},
 tonalztics_of_ralos:{extras:[['charged-hits',{}],['cross-stat-drain',{}]]},
 infernal_tecpatl:{extras:[['split-accurate',{}]]},
 dark_bow:{extras:[['ammo-damage',{}]],traits:{hitCount:2}},
 soulflame_horn:{extras:[['ally-empower',{}]]},
 fang_of_the_hound:{extras:[['next-flames',{}]]},
 lithic_sceptre:{extras:[['stack-explosion',{}]]},
 rondache:{extras:[['charge-slam',{}]]},
};
export function attackRecipe(reference){
 const name=reference.specialName,source=reference.source??'';
 if(name!=='zoryas_tome'&&!source.includes('/combat/specials/'))return null;
 if(!simple.has(name)&&!recipes[name])return null;
 const recipe=recipes[name]??{},traits={...reference.traits,...recipe.traits};
 if(name==='dragon_claws')for(const [index,branch] of (traits.firstSuccessfulAccuracyDamageRanges??[]).entries()){branch.distribution='claws';branch.hitDamageBonuses=index<3?[0,0,0,1]:[0,0,0,0];delete branch.distributeDamage;}
 if(name==='vestas_spear_bh')for(const branch of traits.firstSuccessfulAccuracyDamageRanges??[]){delete branch.distributeDamage;Object.assign(branch,{distribution:'random-follow-up',followUpMinimum:.5,followUpMaximum:.75});}
 return {version:1,...(recipe.animation!==undefined?{animation:recipe.animation}:{}),...(recipe.visuals?{visuals:recipe.visuals}:{}),...(recipe.traits?.damageMultiplier!==undefined||recipe.traits?.accuracyMultiplier!==undefined?{modifiers:[{id:'damage-1',type:'damage',multiplier:traits.damageMultiplier??reference.damage??1},{id:'accuracy-1',type:'accuracy',multiplier:traits.accuracyMultiplier??reference.accuracy??1}]}:{}),rules:referenceRules({...reference,traits}),extras:[...(reference.style==='ranged'?[['ammunition',{mode:traits.skipAttack?'none':'weapon',minimum:['dragon_knife','magic_shortbow','dark_bow'].includes(name)?2:1,extra:['dragon_knife','magic_shortbow'].includes(name)?1:0}]]:[]),...(recipe.extras??[]),...(reference.soundClips??[]).map(values=>['sound',values]),...(reference.projectileClips??[]).map(values=>['projectile',values])].map(([type,values],index)=>({id:`extra-${index+1}`,type,values:{...featureDefaults(type),...values}})),actions:recipe.actions??[]};
}
