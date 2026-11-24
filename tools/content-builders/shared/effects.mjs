import {specialActivation} from './special-activation.mjs';
import {validateRuleFeatures,ruleTraits,referenceRules} from './attack-rules.mjs';
import {validateExtraFeatures} from './attack-features.mjs';
import { validateVisuals } from './visuals.mjs';
import {validateMechanicOverrides,validateNativeFeatures,referenceFeatures,validateAttackModifiers,attackModifiers,materializeFeatureVisuals} from './native-mechanics.mjs';
// Data-only gear effects. Keep runtime.effects.cjs's validator in agreement.
export const EFFECT_VERSION = 1;
export const EFFECT_LIMITS = Object.freeze({ passives: 8, actions: 4, hits: 4, pieces: 12, alternatives: 16 });
export const EFFECT_ACTIONS = Object.freeze({ heal: 'Heal yourself', prayer: 'Restore prayer', drain: 'Lower enemy Defence', 'drain-levels': 'Lower a chosen enemy stat', 'drain-stats': 'Drain enemy stats in order', freeze: 'Freeze the enemy', poison: 'Poison the enemy', venom:'Venom the enemy', teleblock:'Teleblock the enemy' });
export const EFFECT_STATS = Object.freeze(['defence','strength','prayer','attack','magic','ranged']);
export const EFFECT_TRIGGERS = Object.freeze({damage:'On dealing damage',accurate:'On a successful hit',attack:'On attacking',taken:'On taking damage','hit-received':'On being hit',kill:'On killing a target',interval:'Every X ticks','hp-below':'When HP falls to a threshold','prayer-below':'When Prayer falls to a threshold',equip:'When the required gear is equipped'});
export const POLLED_TRIGGERS = Object.freeze(['interval','hp-below','prayer-below','equip']);
export const RECOVERY_BASES = Object.freeze({dealt:'HP actually lost by the enemy',rolled:'Damage before the enemy HP limit',max:'Base skill level',missing:'Missing points',flat:'Fixed points'});
export const SPECIAL_ROLL_FIELDS = Object.freeze(['sharedAccuracy','minimumDamageMultiplier','maximumDamageMultiplier','defenceRollMultiplier','attackSpeedTicks']);
export const EFFECT_ANIMATIONS = Object.freeze([
    [1062, 'Dragon dagger · Puncture'], [1378, 'Dragon warhammer · Smash'],
    [7640, 'Saradomin godsword · Healing blade'], [7638, 'Zamorak godsword · Ice cleave'],
    [7642, 'Bandos godsword · Warstrike'], [7644, 'Armadyl godsword · The judgement'],
    [876, 'Toxic blowpipe · Special attack'], [5061, 'Toxic blowpipe · Blow'], [1167, 'Sanguinesti staff · Cast'],
    [422, 'Unarmed · Punch'], [423, 'Unarmed · Kick'],
    [1058,'Dragon longsword · Cleave'],[1060,'Dragon mace · Shatter'],[3300,'Abyssal dagger · Abyssal puncture'],
    [11222,"Osmumten's fang · Eviscerate"],[412,"Vesta's longsword · Feint"],[11124,'Elder maul · Pulverize'],
    [5870,'Barrelchest anchor · Sunder'],[1658,'Abyssal whip / tentacle · Lash'],[7222,'Ballista · Concentrated shot'],
    [7514,'Dragon claws · Slice and dice'],[11140,'Burning claws · Burning barrage'],[1203,'Dragon halberd · Sweep'],
    [7515,'Dragon sword · Wild stab'],[1872,'Dragon scimitar · Sever'],[3157,'Dragon 2h sword · Powerstab'],
    [1074,'Magic shortbow · Snapshot'],[426,'Bow · Draw'],[8291,'Dragon knife · Twin throw'],[8292,'Poisoned dragon knife · Twin throw'],
    [7521,'Dragon thrownaxe · Momentum'],[1068,'Rune thrownaxe · Chainhit'],[1132,'Saradomin sword · Lightning'],[1133,'Blessed Saradomin sword · Lightning'],
    [1056,'Dragon battleaxe · Rampage'],[1057,'Excalibur · Sanctuary'],[6147,'Ancient mace · Favour of the War God'],
    [3299,'Abyssal bludgeon · Penance'],[2890,'Arclight / Darklight · Weaken'],[9171,'Ancient godsword · Blood sacrifice'],
    [11275,'Voidwaker · Disrupt'],[9964,'Webweaver bow · Swarm'],[11133,'Scorching bow · Scorching shackles'],
    [4230,'Armadyl crossbow · Armadyl eye'],[9166,'Zaryte crossbow · Evoke'],[8532,'Nightmare staff · Cast'],
    [9961,'Accursed sceptre · Condemn'],[6118,'Brine sabre · Liquify'],[1667,'Granite maul · Quick smash'],
    [9544,'Keris partisan · Special'],[8184,"Vesta's spear · Spear wall"]
]);
const fail = message => { throw new Error(message); };
const number = (v, lo, hi, name, whole = false) => {
    if (!Number.isFinite(v) || v < lo || v > hi || whole && !Number.isInteger(v)) fail(`${name} must be ${whole ? 'a whole number ' : ''}from ${lo} to ${hi}.`);
    return v;
};
const text = (v, name) => typeof v === 'string' && v.trim().length && v.length <= 80 && !/[\x00-\x1f]/.test(v) ? v.trim() : fail(`Give ${name} a name of 1 to 80 characters.`);
const choice = (v, list, name) => list.includes(v) ? v : fail(`Choose ${name}.`);
const keys = (v, list, name) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !list.includes(k))) fail(`Unsupported ${name} field.`);
};
function actions(input) {
    if (!Array.isArray(input) || input.length > 4) fail('Use at most 4 effects per rule.');
    return input.map(a => {
        keys(a, ['type','percent','minimum','basis','ticks','skill','order','trigger','phase','chance','damage'], 'enemy or recovery effect');
        const type = choice(a.type, Object.keys(EFFECT_ACTIONS), 'an effect');
        const extra={};
        if(a.phase!==undefined)extra.phase=choice(a.phase,['launch','impact'],'an effect timing');
        if(extra.phase==='launch'&&!['freeze','poison','venom','teleblock'].includes(type))fail('Only status effects can happen on launch.');
        if(a.chance!==undefined)extra.chance=number(a.chance,0,100,'Individual effect chance');
        if (type === 'drain-stats') {
            const out={type,...extra};
            if(a.percent!==undefined)out.percent=number(a.percent,1,100,'Damage used for stat drain');
            if(a.order!==undefined){if(!Array.isArray(a.order)||!a.order.length||a.order.length>6||new Set(a.order).size!==a.order.length)fail('Choose each drained stat once.');out.order=a.order.map(s=>choice(s,EFFECT_STATS,'a drained stat'));}
            return out;
        }
        if (type === 'freeze') return { type, ticks: number(a.ticks, 1, 32, 'Freeze duration', true),...extra };
        if (type === 'teleblock') return {type,ticks:number(a.ticks,1,6000,'Teleblock duration',true),...extra};
        if (type === 'venom') return {type,...extra};
        if (type === 'poison') return {type,damage:number(a.damage,1,20,'First poison damage',true),...extra};
        if (type === 'drain') return { type, percent: number(a.percent, 1, 100, 'Defence reduction'),...(a.trigger===undefined?{}:{trigger:choice(a.trigger,['damage','accurate'],'a drain trigger')}),...extra };
        if (type === 'drain-levels') return {type,skill:choice(a.skill,EFFECT_STATS,'an enemy stat'),percent:number(a.percent,1,100,'Stat reduction'),basis:choice(a.basis??'dealt',['dealt','current'],'damage or current level'),...extra};
        return { type, percent: number(a.percent, 1, 100, 'Recovery percentage'), minimum: number(a.minimum ?? 0, 0, 100, 'Minimum recovery', true), basis: choice(a.basis ?? 'dealt', Object.keys(RECOVERY_BASES), 'a recovery basis'),...extra };
    });
}
export function newAction(type){return type==='venom'?{type}:type==='teleblock'?{type,ticks:500}:type==='freeze'?{type,ticks:8}:type==='poison'?{type,damage:4}:type==='drain-levels'?{type,skill:'magic',percent:100,basis:'dealt'}:type==='drain-stats'?{type,percent:100,order:[...EFFECT_STATS]}:type==='drain'?{type,percent:30}:{type,percent:50,minimum:0,basis:'dealt'};}
export function newEffects() { return { version: 1, special: null, passives: [] }; }
export function newSpecial() { return { name: 'My special attack', activation:'melee', style:'melee', animation: 1062, graphic: -1, energy: 25, hitCount: 2, hitDelayTicks: [0,0], accuracyMultiplier: 1.15, damageMultiplier: 1.15, defence: 'slash', chance: 100, actions: [] }; }
export function newNativeSpecial(row) {
    const hitCount=Math.max(1,Math.min(4,row.traits?.hitCount??1));
    const special={...newSpecial(),style:row.style??'melee',defence:'style',hitCount,hitDelayTicks:Array.from({length:hitCount},(_,i)=>row.traits?.hitDelayTicks?.[i]??0),name:`${row.name} special`.slice(0,80),nativeFrom:row.id,nativeOverrides:[],replaceGraphics:false,animation:row.animations?.[0]??-1,graphic:-1,energy:row.energy??25,accuracyMultiplier:Math.max(.1,Math.min(5,row.accuracy??1)),damageMultiplier:Math.max(.1,Math.min(5,row.damage??1)),...(row.traits?.damageMultiplierStages?{damageStages:row.traits.damageMultiplierStages}:{}),...(row.mechanics?.length?{nativeFeatures:referenceFeatures(row)}:{})};
    special.activation=specialActivation({style:row.style??'melee',traits:row.traits,recipe:row.recipe});special.modifiers=attackModifiers(special);if(row.traits?.accuracyMultiplierStages)special.modifiers=[...special.modifiers.filter(row=>row.type!=='accuracy'),...row.traits.accuracyMultiplierStages.map((multiplier,index)=>({id:`accuracy-${index+1}`,type:'accuracy',multiplier}))];if(row.recipe){special.recipe=true;if(row.recipe.animation!==undefined)special.animation=row.recipe.animation;if(row.recipe.modifiers)special.modifiers=structuredClone(row.recipe.modifiers);special.ruleFeatures=structuredClone(row.recipe.rules);special.extraFeatures=structuredClone(row.recipe.extras);special.nativeFeatures=referenceFeatures(row);special.actions=structuredClone(row.recipe.actions);special.visuals=(row.recipe.visuals??row.visualClips??[]).filter(clip=>!(row.mechanics??[]).some(group=>group.preview?.graphic===clip.id&&(group.preview.recipient??'target')===clip.recipient)).map(clip=>({...clip,kind:'graphic',delayMs:0,speed:1,durationMs:0,loop:false,height:clip.height??0}));special.replaceGraphics=true;}return special.recipe?materializeFeatureVisuals(special,[row]):special;
}
export function newPassive() { return { id: 'effect-1', name: 'Healing touch', style: 'any', chance: 25, trigger: 'damage', bonusDamage: 0, actions: [{type:'heal',percent:100,minimum:0,basis:'dealt'}], set: null }; }
/** Generic host capabilities required by this configuration. The loader may
 * expose these in package compatibility information before enabling the plugin.
 */
export function effectRequirements(config) {
    const c=validateEffects(config),requires=['combat-hit-hooks/1'];
    if(c.special)requires.push('combat-special-removal/1');
    if(c.special?.style==='ranged'&&c.special.nativeFrom===undefined)requires.push('native-ranged-method/1');
    if(c.passives.some(p=>p.bonusDamage>0))requires.push('combat-hit-context/1');
    if([c.special,...c.passives].some(p=>p?.visuals?.length))requires.push('actor-visuals/1');
    if(c.special?.nativeFrom!==undefined&&!c.special.recipe)requires.push('native-special-template/1');
    if(c.special?.recipe)requires.push('modular-attack-recipes/1');
    if(c.special?.nativeMechanics)requires.push('native-special-mechanics/1');
    if(c.special?.nativeFeatures!==undefined)requires.push('native-special-features/1');
    if([c.special,...c.passives].some(p=>p?.disabledFeatureVisuals?.length||p?.visuals?.some(c=>c.nativeGraphic!==undefined)))requires.push('actor-native-cues/1');
    if(c.passives.some(p=>POLLED_TRIGGERS.includes(p.trigger)))requires.push('player-process-hooks/1');
    if(c.passives.some(p=>p.trigger==='kill'))requires.push('combat-death-hooks/1');
    if([c.special,...c.passives].some(p=>p?.visuals?.some(c=>c.hueShift)))requires.push('actor-visual-colour/1');
    if([c.special,...c.passives].some(p=>p?.visuals?.some(c=>c.speed<1||c.delayMs+c.durationMs>30000)))requires.push('actor-visual-timing/2');
    return requires;
}
export function validateEffects(input = newEffects()) {
    keys(input, ['version','special','passives'], 'gear effects');
    if (input.version !== EFFECT_VERSION) fail('Unsupported gear effect version.');
    const out = newEffects();
    if (input.special !== null) {
        const s = input.special;
        keys(s, ['name','activation','style','animation','graphic','energy','hitCount','hitDelayTicks','accuracyMultiplier','damageMultiplier','damageStages','defence','chance','actions','visuals','nativeFrom','nativeOverrides','nativeMechanics','nativeFeatures','explicitVisuals','disabledFeatureVisuals','modifiers','recipe','ruleFeatures','extraFeatures','replaceGraphics',...SPECIAL_ROLL_FIELDS], 'special attack');
        const activation=specialActivation(s);
        const hitCount = number(s.hitCount, 1, 4, 'Number of hits', true);
        if (!Array.isArray(s.hitDelayTicks) || s.hitDelayTicks.length !== hitCount) fail('Give every hit a timing.');
        const delays = s.hitDelayTicks.map(t => number(t, 0, 8, 'Hit timing', true));
        if (delays[0] !== 0 || delays.some((t,i) => i && t < delays[i-1])) fail('Hit timings must start at zero and stay in order.');
        const effects = actions(s.actions);
        out.special = { name: text(s.name, 'the special attack'), activation, animation: number(s.animation, s.nativeFrom===undefined&&!s.recipe?0:-1, 65534, 'Attack animation', true), graphic: number(s.graphic ?? -1, -1, 65534, 'Attack graphic', true), energy: number(s.energy, s.nativeFrom===undefined&&!s.recipe?1:0, 100, 'Special energy', true), hitCount, hitDelayTicks: delays, accuracyMultiplier: number(s.accuracyMultiplier, .1, 5, 'Accuracy multiplier'), damageMultiplier: number(s.damageMultiplier, .1, 5, 'Damage multiplier'), defence: choice(s.defence, ['style','stab','slash','crush'], 'enemy defence'), chance: number(s.chance, 0, 100, 'Effect chance'), actions: effects };
        if(s.nativeFrom!==undefined){
            out.special.nativeFrom=number(s.nativeFrom,1,65022,'Native attack template',true);
            const fields=['accuracy','damage','hits','defence','speed','animation'];
            if(!Array.isArray(s.nativeOverrides)||new Set(s.nativeOverrides).size!==s.nativeOverrides.length)fail('Choose each native override once.');
            out.special.nativeOverrides=s.nativeOverrides.map(v=>choice(v,fields,'a native attack override'));
            if(typeof s.replaceGraphics!=='boolean')fail('Choose native or custom VFX.');out.special.replaceGraphics=s.replaceGraphics;
            if(s.nativeMechanics!==undefined)out.special.nativeMechanics=validateMechanicOverrides(s.nativeMechanics);
        }else if(s.nativeOverrides!==undefined||s.nativeMechanics!==undefined||s.replaceGraphics!==undefined||s.style==='magic'&&!s.recipe)fail('Choose a native attack template first.');
        if(s.visuals!==undefined)out.special.visuals=validateVisuals(s.visuals);
        if(s.recipe!==undefined){if(s.recipe!==true)fail('Unsupported attack recipe.');out.special.recipe=true;out.special.ruleFeatures=validateRuleFeatures(s.ruleFeatures);out.special.extraFeatures=validateExtraFeatures(s.extraFeatures);}
        else if(s.ruleFeatures!==undefined||s.extraFeatures!==undefined)fail('Attack rule effects require a modular recipe.');
        if(s.nativeFeatures!==undefined)out.special.nativeFeatures=validateNativeFeatures(s.nativeFeatures);
        if(s.explicitVisuals!==undefined){if(s.explicitVisuals!==true||!s.recipe)fail('Explicit visual queues require a modular attack.');out.special.explicitVisuals=true;}
        if(s.disabledFeatureVisuals!==undefined){if(!Array.isArray(s.disabledFeatureVisuals)||s.disabledFeatureVisuals.length>16||new Set(s.disabledFeatureVisuals).size!==s.disabledFeatureVisuals.length||s.disabledFeatureVisuals.some(id=>!s.nativeFeatures?.some(row=>row.id===id)))fail('Choose an existing feature for VFX removal.');out.special.disabledFeatureVisuals=[...s.disabledFeatureVisuals];}
        if(out.special.visuals?.some(clip=>clip.nativeFeature&&!s.nativeFeatures?.some(row=>row.id===clip.nativeFeature)&&!s.extraFeatures?.some(row=>row.id===clip.nativeFeature&&row.type==='next-flames')))fail('The VFX source feature is unavailable.');
        if(s.modifiers!==undefined){
            const modifiers=validateAttackModifiers(s.modifiers),damage=modifiers.filter(row=>row.type==='damage').map(row=>row.multiplier),accuracy=modifiers.filter(row=>row.type==='accuracy').map(row=>row.multiplier);
            out.special.modifiers=modifiers;out.special.damageMultiplier=number(damage.reduce((a,b)=>a*b,1),.1,5,'Combined damage multiplier');out.special.accuracyMultiplier=number(accuracy.reduce((a,b)=>a*b,1),.1,5,'Combined accuracy multiplier');
            if(damage.length>1)out.special.damageStages=damage;else delete out.special.damageStages;
        }
        if(out.special.visuals?.some(c=>c.nativeGraphic!==undefined)&&(!(s.nativeFrom!==undefined&&s.replaceGraphics)&&!s.nativeFeatures?.length&&!s.extraFeatures?.some(row=>row.type==='next-flames')))fail('Native graphic cues need an imported feature or a native attack with custom VFX enabled.');
        out.special.style=choice(s.style??'melee',['melee','ranged','magic'],'a special attack style');
        if(out.special.style==='ranged'&&!s.recipe&&out.special.defence!=='style')fail('Ranged specials use native ranged defence.');
        if(s.sharedAccuracy!==undefined){if(typeof s.sharedAccuracy!=='boolean')fail('Choose independent or shared accuracy.');out.special.sharedAccuracy=s.sharedAccuracy;}
        for(const field of ['minimumDamageMultiplier','maximumDamageMultiplier'])if(s[field]!==undefined)out.special[field]=number(s[field],0,3,'Damage bound');
        if((s.minimumDamageMultiplier??0)>(s.maximumDamageMultiplier??1))fail('Minimum damage cannot exceed maximum damage.');
        if(s.defenceRollMultiplier!==undefined)out.special.defenceRollMultiplier=number(s.defenceRollMultiplier,.1,2,'Enemy defence roll multiplier');
        if(s.attackSpeedTicks!==undefined)out.special.attackSpeedTicks=number(s.attackSpeedTicks,1,20,'Attack duration',true);
        if (s.damageStages !== undefined&&s.modifiers===undefined) {
            if (!Array.isArray(s.damageStages) || !s.damageStages.length || s.damageStages.length > 16) fail('Use 1 to 16 damage stages.');
            out.special.damageStages = s.damageStages.map(v => number(v,.1,5,'Damage stage'));
        }
    }
    if(out.special?.recipe){const r=out.special,t=ruleTraits(r.ruleFeatures);r.hitCount=t.hitCount??1;r.hitDelayTicks=Array.from({length:r.hitCount},(_,index)=>t.hitDelayTicks?.[index]??0);if(t.sharedAccuracyRollAcrossHits!==undefined)r.sharedAccuracy=t.sharedAccuracyRollAcrossHits;else delete r.sharedAccuracy;}
    if (!Array.isArray(input.passives) || input.passives.length > 8) fail('Use at most 8 passive or set effects.');
    const seen = new Set();
    out.passives = input.passives.map(p => {
        keys(p, ['id','name','style','chance','trigger','bonusDamage','actions','set','visuals','intervalTicks','thresholdPercent','cooldownTicks','conditions'], 'passive');
        if (typeof p.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(p.id) || seen.has(p.id)) fail('Each passive needs a unique short ID.');
        seen.add(p.id);
        const bonusDamage = number(p.bonusDamage ?? 0, 0, 100, 'Added damage', true);
        if (bonusDamage > 0 && p.trigger !== 'accurate') fail('Added damage requires a successful accuracy roll.');
        let set = null;
        if (p.set !== null) {
            keys(p.set, ['required','pieces'], 'equipment set');
            if (!Array.isArray(p.set.pieces) || !p.set.pieces.length || p.set.pieces.length > 12) fail('A set needs 1 to 12 equipment slots.');
            const slots = new Set();
            const pieces = p.set.pieces.map(piece => {
                keys(piece, ['slot','itemIds'], 'set piece');
                const slot = number(piece.slot, 0, 13, 'Equipment slot', true);
                if (![0,1,2,3,4,5,7,9,10,12,13].includes(slot) || slots.has(slot)) fail('Use each real equipment slot only once in a set.');
                slots.add(slot);
                if (!Array.isArray(piece.itemIds) || !piece.itemIds.length || piece.itemIds.length > 16) fail('Each slot needs 1 to 16 alternative item IDs.');
                const ids = piece.itemIds.map(id => id === 'self' || typeof id === 'string' && /^item:[a-z][a-z0-9-]{0,55}$/.test(id) ? id : number(id, 1, 65022, 'Set item ID', true));
                if (new Set(ids).size !== ids.length) fail('Remove duplicate set item IDs.');
                return {slot, itemIds:ids};
            });
            set = {required:number(p.set.required,1,pieces.length,'Required set pieces',true),pieces};
        }
        const visualClips=validateVisuals(p.visuals);
        if(visualClips?.some(c=>c.phase!=='impact'||c.nativeGraphic!==undefined))fail('Passive visual clips start at activation impact.');
        const effects=actions(p.actions);if(effects.some(a=>a.phase==='launch'))fail('Passive effects happen at impact.');
        const trigger=choice(p.trigger,Object.keys(EFFECT_TRIGGERS),'an activation trigger'),timing={};
        if(trigger==='interval')timing.intervalTicks=number(p.intervalTicks,1,6000,'Interval in ticks',true);
        else if(p.intervalTicks!==undefined)fail('An interval belongs to an Every X ticks trigger.');
        if(['hp-below','prayer-below'].includes(trigger))timing.thresholdPercent=number(p.thresholdPercent,1,100,'Activation threshold');
        else if(p.thresholdPercent!==undefined)fail('A threshold belongs to an HP or Prayer trigger.');
        if(p.cooldownTicks!==undefined)timing.cooldownTicks=number(p.cooldownTicks,0,6000,'Cooldown in ticks',true);
        if(p.conditions!==undefined){
            keys(p.conditions,['hpBelowPercent','prayerBelowPercent','targetHpBelowPercent','inCombat'],'activation condition');
            timing.conditions={};
            for(const key of ['hpBelowPercent','prayerBelowPercent','targetHpBelowPercent'])if(p.conditions[key]!==undefined)timing.conditions[key]=number(p.conditions[key],0,100,'Condition percentage');
            if(p.conditions.inCombat!==undefined){if(typeof p.conditions.inCombat!=='boolean')fail('Choose in or out of combat.');timing.conditions.inCombat=p.conditions.inCombat;}
        }
        if([...POLLED_TRIGGERS,'attack'].includes(trigger)&&effects.some(a=>['heal','prayer'].includes(a.type)&&['dealt','rolled'].includes(a.basis)||a.type==='drain-stats'||a.type==='drain-levels'&&a.basis==='dealt'))fail('This trigger has no hit damage. Choose maximum level, missing points, fixed recovery or a current-level drain.');
        return { id:p.id, name:text(p.name,'the passive effect'), style:choice(p.style,['any','melee','ranged','magic'],'a combat style'), chance:number(p.chance,0,100,'Effect chance'), trigger, bonusDamage, actions:effects, set, ...timing,...(p.visuals===undefined?{}:{visuals:visualClips}) };
    });
    return out;
}
/** Resolve self only at export so reassigning a project's item ID is safe. */
export function compileEffects(project, {itemIds,ownerId=project.id} = {}) {
    const config = validateEffects(project.effects);
    if (project.kind !== 'gear' && (config.special || config.passives.length)) fail('Gear effects can only be used on gear.');
    if (config.special && project.settings?.equipmentType !== 'WEAPON') fail('A special attack needs the Weapon equipment slot.');
    if (config.special && project.settings?.specialFrom >= 0) fail('Choose an original special or a borrowed special, then remove the other.');
    if (config.passives.length && project.settings?.equipmentType === 'NONE') fail('Passive effects need an equipment slot.');
    const id = number(project.ids?.definition, 50000, 65022, 'Custom item ID', true);
    for (const p of config.passives) for (const piece of p.set?.pieces ?? []) piece.itemIds = piece.itemIds.map(value => {
        if(value==='self')return id;
        if(typeof value==='string'){
            const resolved=itemIds?.get(value.slice(5));
            if(!Number.isInteger(resolved))fail('This effect refers to another custom item. Export it with its gear set.');
            return resolved;
        }
        return value;
    });
    // Duplicate IDs can arise when a literal ID equals self after reassignment.
    const checked = validateEffects(config);
    if (!checked.special && !checked.passives.length) return null;
    if (typeof ownerId !== 'string' || !/^[a-z][a-z0-9-]{0,55}$/.test(ownerId)) fail('Invalid effect owner.');
    return { owner:`content-builder:${ownerId}`, itemId:id, config:checked, requires:effectRequirements(checked) };
}
const heal = (percent,basis='dealt',minimum=0) => ({type:'heal',percent,basis,minimum});
const spec = patch => ({...newSpecial(),activation:patch.style==='ranged'||patch.style==='magic'?'ranged':'melee',...patch});
const single = patch => spec({hitCount:1,hitDelayTicks:[0],accuracyMultiplier:1,damageMultiplier:1,defence:'style',...patch});
const reference=(id,name,weapon,itemId,goal,note,value)=>({id,name,kind:'special',itemId,goal,note,source:`server/plugins/combat/specials/${weapon}.SpecialAttack.js`,url:`https://oldschool.runescape.wiki/w/${name.split(' · ')[0].replaceAll(' ','_')}`,value});
const REFERENCE_ITEMS={dagger:1215,warhammer:13576,saradomin:11806,zamorak:11808,blowpipe:12926,guthans:4726,sanguinesti:22323,armadyl:11802,bandos:11804};
const referenceGoal=p=>p.kind!=='special'?'Recovery':p.value.actions.some(a=>a.type.startsWith('drain'))?'Weaken':p.value.actions.some(a=>['freeze','poison'].includes(a.type))?'Control':p.value.actions.some(a=>['heal','prayer'].includes(a.type))?'Recovery':'Damage';
// These references are deliberately scoped to the effect, not charges, degradation,
// powered spells, encounter exceptions, or the full native item's behaviour.
export const EFFECT_PRESETS = Object.freeze([
    {id:'dagger',name:'Dragon dagger · Puncture',kind:'special',source:'server/plugins/combat/specials/DragonDagger.SpecialAttack.js',url:'https://oldschool.runescape.wiki/w/Dragon_dagger',note:'Two independent melee accuracy and damage rolls. Each has 15% more accuracy and damage, against slash defence.',value:spec({name:'Puncture'})},
    {id:'warhammer',name:'Dragon warhammer · Defence drain',kind:'special',source:'server/plugins/combat/specials/DragonWarhammer.SpecialAttack.js',url:'https://oldschool.runescape.wiki/w/Dragon_warhammer',note:'One hit with 50% more damage. Positive damage lowers current Defence by 30%. This editable effect does not copy Tekton missed-drain exceptions.',value:spec({name:'Smash',animation:1378,graphic:1292,energy:50,hitCount:1,hitDelayTicks:[0],accuracyMultiplier:1,damageMultiplier:1.5,defence:'style',actions:[{type:'drain',percent:30}]})},
    {id:'saradomin',name:'Saradomin godsword · Recovery',kind:'special',source:'server/plugins/combat/specials/SaradominGodsword.SpecialAttack.js',url:'https://oldschool.runescape.wiki/w/Saradomin_godsword',note:'Double accuracy, 10% more damage. Uses damage before the enemy HP limit to heal half (minimum 10) and restore a quarter as Prayer (minimum 5). The damage roll must be above zero.',value:spec({name:'Healing blade',animation:7640,graphic:1209,energy:50,hitCount:1,hitDelayTicks:[0],accuracyMultiplier:2,damageMultiplier:1.1,actions:[heal(50,'rolled',10),{type:'prayer',percent:25,basis:'rolled',minimum:5}]})},
    {id:'zamorak',name:'Zamorak godsword · Freeze',kind:'special',source:'server/plugins/combat/specials/ZamorakGodsword.SpecialAttack.js',url:'https://oldschool.runescape.wiki/w/Zamorak_godsword',note:'Double accuracy, 10% more damage. A successful accuracy roll freezes for 32 ticks. Native freeze immunity and resistance still apply.',value:spec({name:'Ice cleave',animation:7638,graphic:1210,energy:50,hitCount:1,hitDelayTicks:[0],accuracyMultiplier:2,damageMultiplier:1.1,actions:[{type:'freeze',ticks:32}]})},
    {id:'blowpipe',name:'Toxic blowpipe · Healing effect',kind:'special',source:'server/plugins/items/ToxicBlowpipe.plugin.js',url:'https://oldschool.runescape.wiki/w/Toxic_blowpipe',note:'Recovery reference for an original ranged shot: double accuracy, 50% more damage and half of damage before the enemy HP limit as healing. Uses the custom weapon’s native ammunition and projectile. Does not create a loaded blowpipe, darts or scales. Requires a single-projectile ranged weapon profile.',value:spec({name:'Healing shot',style:'ranged',animation:876,energy:50,hitCount:1,hitDelayTicks:[0],accuracyMultiplier:2,damageMultiplier:1.5,defence:'style',actions:[heal(50,'rolled')]})},
    {id:'guthans',name:"Guthan's · Full-set healing",kind:'set',source:'server/plugins/items/BarrowsEquipment.plugin.js',url:'https://oldschool.runescape.wiki/w/Guthan_the_Infested%27s_equipment',note:'With every chosen piece worn, a damaging attack has a 25% chance to heal its dealt damage. The reference uses four undegraded native pieces. The editor replaces the matching equipment slot with This creation. Degradation and amulet of the damned are not copied.',value:{...newPassive(),id:'guthans',name:"Guthan's healing",set:{required:4,pieces:[{slot:0,itemIds:[4724]},{slot:3,itemIds:[4726]},{slot:4,itemIds:[4728]},{slot:7,itemIds:[4730]}]}}},
    {id:'sanguinesti',name:'Sanguinesti staff · Life leech effect',kind:'passive',source:'server/plugins/items/SanguinestiStaff.plugin.js',url:'https://oldschool.runescape.wiki/w/Sanguinesti_staff',note:'TSPS life leech reference: successful magic accuracy has a 20% chance to add 8 to the existing hit, then heal half of final dealt damage at impact. Does not copy the powered spell or blood-rune charging.',value:{...newPassive(),id:'sanguinesti',name:'Life leech',style:'magic',chance:20,trigger:'accurate',bonusDamage:8,actions:[heal(50)]}},
    {id:'armadyl',name:'Armadyl godsword · The judgement',kind:'special',source:'server/plugins/combat/specials/ArmadylGodsword.SpecialAttack.js',url:'https://oldschool.runescape.wiki/w/Armadyl_godsword',note:'Double accuracy. Damage applies 1.1 then 1.25, flooring after each stage, against slash defence.',value:spec({name:'The judgement',animation:7644,graphic:1211,energy:50,hitCount:1,hitDelayTicks:[0],accuracyMultiplier:2,damageMultiplier:1.375,damageStages:[1.1,1.25]})},
    {id:'bandos',name:'Bandos godsword · Stat drain',kind:'special',source:'server/plugins/combat/specials/BandosGodsword.SpecialAttack.js',url:'https://oldschool.runescape.wiki/w/Bandos_godsword',note:'Double accuracy. Damage applies 1.1 twice, flooring each stage. Dealt damage drains Defence, Strength, Prayer, Attack, Magic, then Ranged. NPCs skip Prayer; an encounter stat floor stops spillover. Tekton missed-drain exceptions are not copied.',value:spec({name:'Warstrike',animation:7642,graphic:1212,energy:50,hitCount:1,hitDelayTicks:[0],accuracyMultiplier:2,damageMultiplier:1.21,damageStages:[1.1,1.1],actions:[{type:'drain-stats'}]})},
    reference('longsword','Dragon longsword · Cleave','DragonLongsword',1305,'Damage','A heavier slash with 25% more damage.',single({name:'Cleave',animation:1058,graphic:248,energy:25,damageMultiplier:1.25,defence:'slash'})),
    reference('mace','Dragon mace · Shatter','DragonMace',1434,'Damage','A single strike with 25% more accuracy and 50% more damage.',single({name:'Shatter',animation:1060,graphic:251,energy:25,accuracyMultiplier:1.25,damageMultiplier:1.5})),
    reference('abyssal-dagger','Abyssal dagger · Abyssal puncture','AbyssalDagger',13265,'Damage','Two damage rolls share one accuracy roll. Each has 25% more accuracy and 15% less damage, against slash defence.',spec({name:'Abyssal puncture',animation:3300,graphic:1283,accuracyMultiplier:1.25,damageMultiplier:.85,sharedAccuracy:true})),
    reference('abyssal-dagger-bh','Abyssal dagger (bh) · Abyssal puncture','AbyssalDagger',27861,'Damage','The native imbued roll pattern uses 35% energy and 95% damage per hit, with shared accuracy.',spec({name:'Abyssal puncture',animation:3300,graphic:1283,energy:35,accuracyMultiplier:1.25,damageMultiplier:.95,sharedAccuracy:true})),
    reference('fang',"Osmumten's fang · Eviscerate",'OsmumtensFang',26219,'Damage','50% more accuracy. Successful damage ranges from 15% to 100% of the normal maximum. The fang’s ordinary passive accuracy is separate.',single({name:'Eviscerate',animation:11222,graphic:2833,energy:25,accuracyMultiplier:1.5,minimumDamageMultiplier:.15,maximumDamageMultiplier:1})),
    reference('vesta',"Vesta's longsword · Feint",'VestasLongsword',22613,'Damage','Uses stab defence at a quarter of the normal defence roll. Successful damage ranges from 20% to 120% of the normal maximum.',single({name:'Feint',animation:412,energy:25,defence:'stab',defenceRollMultiplier:.25,minimumDamageMultiplier:.2,maximumDamageMultiplier:1.2})),
    reference('statius',"Statius's warhammer · Smash",'StatiusWarhammer',22622,'Weaken','Successful damage ranges from 25% to 125% of the normal maximum. An accurate hit removes 75% of current Defence.',single({name:'Smash',animation:1378,energy:35,minimumDamageMultiplier:.25,maximumDamageMultiplier:1.25,actions:[{type:'drain',percent:75,trigger:'accurate'}]})),
    reference('elder-maul','Elder maul · Pulverize','ElderMaul',21003,'Weaken','25% more accuracy, a seven-tick attack and 35% Defence drain on an accurate hit, including zero damage. Encounter-specific missed drains are separate.',single({name:'Pulverize',animation:11124,graphic:2804,energy:50,accuracyMultiplier:1.25,attackSpeedTicks:7,actions:[{type:'drain',percent:35,trigger:'accurate'}]})),
    reference('anchor','Barrelchest anchor · Sunder','BarrelchestAnchor',10887,'Weaken','Double accuracy and 10% more damage. Drain 10% of damage through Defence, Attack, Ranged, then Magic.',single({name:'Sunder',animation:5870,graphic:1027,energy:50,accuracyMultiplier:2,damageMultiplier:1.1,actions:[{type:'drain-stats',percent:10,order:['defence','attack','ranged','magic']}]})),
    reference('tentacle','Abyssal tentacle · Binding tentacle','AbyssalTentacle',12006,'Control','Bind for eight ticks on launch, even on a miss, and independently roll a 50% chance of poison starting at four damage. Native immunity applies. Charges are separate.',single({name:'Binding tentacle',animation:1658,energy:50,accuracyMultiplier:1.25,defence:'slash',actions:[{type:'freeze',ticks:8,phase:'launch'},{type:'poison',damage:4,phase:'launch',chance:50}]})),
    reference('ballista','Ballista · Concentrated shot','Ballista',19478,'Damage','25% more accuracy and damage on one paid native ranged shot. Keeps the creation’s ammunition profile and projectile.',single({name:'Concentrated shot',style:'ranged',animation:7222,energy:65,accuracyMultiplier:1.25,damageMultiplier:1.25})),
    {id:'blood-fury',name:'Amulet of blood fury · Healing effect',itemId:24780,kind:'passive',source:'server/plugins/items/AmuletOfBloodFury.plugin.js',url:'https://oldschool.runescape.wiki/w/Amulet_of_blood_fury',note:'A melee attack has a 20% chance to heal 30% of health actually lost. This composed effect rolls once per attack; the native amulet rolls per damaging splat and consumes charges.',value:{...newPassive(),id:'blood-fury',name:'Blood fury healing',style:'melee',chance:20,actions:[heal(30)]}}
].map(p=>({...p,itemId:p.itemId??REFERENCE_ITEMS[p.id],goal:p.goal??referenceGoal(p)})));
export function effectPreset(id) { const row = EFFECT_PRESETS.find(p => p.id === id); if (!row) fail('Choose a reference effect.'); return structuredClone(row.value); }
/** Native accuracy formula for a supplied final attack and defence roll. */
export function accuracyChance(attack, defence) { return attack > defence ? 1 - (defence + 2) / (2 * (attack + 1)) : attack / (2 * (defence + 1)); }
export function previewSpecial(input, {maxHit=30,attackRoll=10000,defenceRoll=10000} = {}) {
    const s = validateEffects({version:1,special:input,passives:[]}).special;
    number(maxHit,0,10000,'Preview maximum hit',true);number(attackRoll,0,100000000,'Preview attack roll');number(defenceRoll,0,100000000,'Preview defence roll');
    const boosted = (s.damageStages ?? [s.damageMultiplier]).reduce((value,multiplier)=>Math.floor(value*multiplier),maxHit),minimum=Math.floor(boosted*(s.minimumDamageMultiplier??0)), maximum=Math.floor(boosted*(s.maximumDamageMultiplier??1)), chance = accuracyChance(Math.floor(attackRoll*s.accuracyMultiplier),Math.floor(defenceRoll*(s.defenceRollMultiplier??1)));
    return {minimumPerHit:minimum,maximumPerHit:maximum,maximumTotal:maximum*s.hitCount,accuracy:chance,expected:(minimum+maximum)/2*chance*s.hitCount,energyUses:Math.floor(100/s.energy),sharedAccuracy:s.sharedAccuracy??false,hits:s.hitDelayTicks.map(t=>({tick:t,seconds:t*.6,minimum,maximum}))};
}
/** A single-rule example on an accurate attack, before protection prayers.
 * Returns activation outcomes, not random loot or a grant to a real player.
 */
export function previewPassive(input,{rolledDamage=20,targetHp=100,enemyDefence=100,enemyLevels={},maxHp=99,currentHp=50,maxPrayer=99,currentPrayer=50}={}) {
    const p=validateEffects({version:1,special:null,passives:[input]}).passives[0];
    number(rolledDamage,0,10000,'Example rolled damage',true);number(targetHp,0,1000000,'Example enemy hitpoints',true);number(enemyDefence,0,10000,'Example Defence',true);
    const noDamage=[...POLLED_TRIGGERS,'attack'].includes(p.trigger),potential=noDamage?0:rolledDamage+p.bonusDamage,dealt=Math.min(targetHp,potential),eligible=['damage','taken'].includes(p.trigger)?dealt>0:p.trigger==='kill'?dealt>0&&dealt>=targetHp:true;
    for(const [key,value] of Object.entries({maxHp,currentHp,maxPrayer,currentPrayer}))number(value,0,10000,`Example ${key}`,true);
    const levels=Object.fromEntries(EFFECT_STATS.map(skill=>[skill,number(enemyLevels[skill]??(skill==='defence'?enemyDefence:100),0,10000,`Example ${skill}`,true)]));
    const result={chance:eligible?p.chance/100:0,dealt,extraDamage:Math.max(0,dealt-Math.min(targetHp,rolledDamage)),heal:0,prayer:0,defenceRemoved:0,freezeTicks:0,statDrain:0};
    if(!eligible)return result;
    for(const a of p.actions) {
        if(a.type==='freeze')result.freezeTicks=Math.max(result.freezeTicks,a.ticks);
        else if(a.type==='drain'&&(dealt>0||a.trigger==='accurate'||noDamage)) {const removed=Math.floor(levels.defence*a.percent/100);levels.defence-=removed;result.defenceRemoved+=removed;}
        else if(a.type==='drain-stats'&&dealt>0){
            let remaining=Math.floor(dealt*(a.percent??100)/100);
            for(const skill of a.order??EFFECT_STATS){const amount=Math.min(levels[skill],remaining);levels[skill]-=amount;remaining-=amount;result.statDrain+=amount;if(!remaining)break;}
        }
        else if(a.type==='drain-levels'&&(dealt>0||noDamage&&a.basis==='current')){const amount=Math.min(levels[a.skill],Math.floor((a.basis==='current'?levels[a.skill]:dealt)*a.percent/100));levels[a.skill]-=amount;result.statDrain+=amount;}
        else if(a.type==='poison'&&(dealt>0||noDamage))result.poisonDamage=a.damage;
        else if(a.type==='heal'||a.type==='prayer') {const maximum=a.type==='heal'?maxHp:maxPrayer,current=a.type==='heal'?currentHp:currentPrayer,damage=a.basis==='rolled'?potential:a.basis==='max'?maximum:a.basis==='missing'?Math.max(0,maximum-current):a.basis==='flat'?0:dealt;if(damage>0||a.basis==='flat')result[a.type]+=Math.max(a.minimum,Math.floor(damage*a.percent/100));}
    }
    return result;
}

/** Upgrade old native selections into a recipe without losing the author's additions. */
export function materializeSpecial(input,reference){
    if(input.recipe)return structuredClone(input);
    if(input.nativeFrom===undefined&&!reference){const next=structuredClone(input),traits={hitCount:input.hitCount,hitDelayTicks:input.hitDelayTicks,...(input.defence==='style'?{}:{meleeDefenceBonusIndex:{stab:0,slash:1,crush:2}[input.defence]})};for(const [from,to] of [['sharedAccuracy','sharedAccuracyRollAcrossHits'],['minimumDamageMultiplier','minimumDamageMultiplier'],['maximumDamageMultiplier','maximumDamageMultiplier'],['defenceRollMultiplier','defenceRollMultiplier'],['attackSpeedTicks','attackSpeedTicks']])if(input[from]!==undefined)traits[to]=input[from];return {...next,recipe:true,modifiers:attackModifiers(input),ruleFeatures:referenceRules({traits}),extraFeatures:[],nativeFeatures:next.nativeFeatures??[]};}
    if(!reference?.recipe)return structuredClone(input);
    const next=newNativeSpecial(reference);next.visuals=(next.visuals??[]).filter(clip=>!clip.nativeFeature);delete next.explicitVisuals;const overrides=new Set(input.nativeOverrides??[]);
    for(const key of ['name','energy','chance','activation'])if(input[key]!==undefined)next[key]=input[key];
    next.actions=[...next.actions,...structuredClone(input.actions??[])];
    if(input.nativeFeatures!==undefined)next.nativeFeatures=structuredClone(input.nativeFeatures);
    else if(input.nativeMechanics)for(const feature of next.nativeFeatures)feature.values={...feature.values,...structuredClone(input.nativeMechanics[feature.mechanic]??{})};
    if(input.modifiers)next.modifiers=structuredClone(input.modifiers);
    else for(const type of ['damage','accuracy'])if(overrides.has(type)){next.modifiers=next.modifiers.filter(row=>row.type!==type);const values=type==='damage'?(input.damageStages??[input.damageMultiplier]):[input.accuracyMultiplier];values.forEach((multiplier,index)=>next.modifiers.push({id:`${type}-${index+1}`,type,multiplier}));}
    const setRule=(type,value)=>{next.ruleFeatures=next.ruleFeatures.filter(row=>row.type!==type);if(value!==undefined)next.ruleFeatures.push({id:`rule-custom-${type}`,type,value:structuredClone(value)});};
    if(overrides.has('hits')){setRule('hitCount',input.hitCount);setRule('hitDelayTicks',input.hitDelayTicks);setRule('sharedAccuracyRollAcrossHits',input.sharedAccuracy);}
    if(overrides.has('damage'))for(const type of ['minimumDamageMultiplier','maximumDamageMultiplier'])if(input[type]!==undefined)setRule(type,input[type]);
    if(overrides.has('speed'))setRule('attackSpeedTicks',input.attackSpeedTicks);
    if(overrides.has('defence')){setRule('meleeDefenceBonusIndex',{stab:0,slash:1,crush:2}[input.defence]);setRule('defenceRollMultiplier',input.defenceRollMultiplier);}
    if(overrides.has('animation'))next.animation=input.animation;
    if(input.replaceGraphics)next.visuals=[];
    next.visuals.push(...structuredClone(input.visuals??[]).map(clip=>{if(clip.nativeGraphic!==undefined&&!(reference.mechanics??[]).some(group=>group.preview?.graphic===clip.nativeGraphic&&(group.preview.recipient??'target')===clip.nativeRecipient)){delete clip.nativeGraphic;delete clip.nativeRecipient;delete clip.heightMode;}return clip;}));
    next.nativeOverrides=[];return next;
}
