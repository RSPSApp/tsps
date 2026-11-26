const specialActivation=(()=>{
const SPECIAL_ACTIVATIONS=Object.freeze({melee:'Melee attack',ranged:'Ranged attack',self:'Cast on self'});
const offensive=new Set(['projectile','follow-up','next-flames','burn','bleed','chain','knockback','drain-current','capped-drain','cross-stat-drain','highest-drain','bonus-drain']);
/** Migration reads intent from the recipe, rather than equating every omitted primary hit with a self-cast. */
function specialActivation(rule){
 if(rule.activation!==undefined){if(!Object.hasOwn(SPECIAL_ACTIVATIONS,rule.activation))throw new Error('Choose an activation type.');return rule.activation;}
 const skip=rule.ruleFeatures?.findLast(row=>row.type==='skipAttack')?.value??rule.traits?.skipAttack??false;
 const targetsEnemy=rule.extraFeatures?.some(row=>offensive.has(row.type))||rule.recipe?.extras?.some(row=>offensive.has(row.type))||rule.nativeFeatures?.some(row=>!['skill-boost','recovery','missing-resource-bonus'].includes(row.mechanic));
 return skip&&!targetsEnemy?'self':rule.style==='melee'||!rule.style?'melee':'ranged';
}

return specialActivation;})();
const attackRuntime=/* BUILDER_ATTACK_RUNTIME */ require('./runtime.attack.cjs');
function validateVisuals(input) {
    if(input===undefined)return undefined;
    if(!Array.isArray(input)||input.length>24)throw new Error(`Use at most ${24} visual clips per effect.`);
    return input.map(c=>{
        const fail=()=>{throw new Error('Invalid visual clip. Choose a native ID, recipient and timing within 120 seconds.');};
        if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['kind','id','recipient','phase','delayMs','speed','durationMs','loop','height','nativeGraphic','nativeRecipient','nativeFeature','heightMode','hueShift'].includes(k)))fail();
        const num=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
        if(!['graphic','animation'].includes(c.kind)||!Number.isInteger(c.id)||!num(c.id,0,65534)||!['player','target','both'].includes(c.recipient)||!['launch','impact'].includes(c.phase)||!num(c.delayMs,0,119999)||!num(c.speed,.1,4)||!num(c.durationMs,0,120000)||c.delayMs+c.durationMs>120000||typeof c.loop!=='boolean'||!num(c.height,-256,512))fail();
        if(c.hueShift!==undefined&&(!num(c.hueShift,-180,180)||c.kind!=='graphic'))fail();
        if(c.nativeGraphic!==undefined&&(!Number.isInteger(c.nativeGraphic)||!num(c.nativeGraphic,0,65534)||!['player','target'].includes(c.nativeRecipient)))fail();
        if(c.nativeGraphic===undefined&&(c.nativeRecipient!==undefined||c.heightMode!==undefined))fail();
        if(c.nativeFeature!==undefined&&(c.nativeGraphic===undefined||typeof c.nativeFeature!=='string'||! /^[a-z][a-zA-Z0-9-]{0,47}$/.test(c.nativeFeature)))fail();
        if(c.heightMode!==undefined&&!['native','custom'].includes(c.heightMode))fail();
        if(c.kind==='animation'&&(c.speed!==1||c.durationMs!==0||c.loop||c.height!==0))throw new Error('Character animations use native speed and length. Speed, duration and looping apply to VFX.');
        if(c.loop&&c.durationMs===0)throw new Error('Give a looping VFX a duration.');
        return {...c};
    });
}

'use strict';
function validateMechanicOverrides(input){
    const scalar=value=>typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1000000||typeof value==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(value);
    const id=value=>typeof value==='string'&&/^[a-z][a-zA-Z0-9-]{0,47}$/.test(value)&&!['constructor','prototype'].includes(value);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>16)throw new Error('Invalid native mechanic overrides.');
    const out={};
    for(const [group,values] of Object.entries(input)){
        if(!id(group)||!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length>16)throw new Error('Invalid native mechanic parameters.');
        out[group]={};
        for(const [key,value] of Object.entries(values)){
            if(!id(key)||!(scalar(value)||Array.isArray(value)&&value.length<=24&&value.every(scalar)))throw new Error('Native mechanic values must be finite numbers, choices, switches or bounded lists.');
            out[group][key]=Array.isArray(value)?[...value]:value;
        }
    }
    return out;
}
function resolveMechanics(groups=[],input={}){
    const overrides=validateMechanicOverrides(input),out={};
    for(const group of groups){out[group.id]={};for(const parameter of group.parameters){const value=overrides[group.id]?.[parameter.key]??parameter.value;
        if(parameter.type==='boolean'?typeof value!=='boolean':parameter.type==='choice'?!parameter.choices.some(choice=>choice.value===value):parameter.type==='order'?!Array.isArray(value)||!value.length||new Set(value).size!==value.length||value.some(value=>!parameter.choices.some(choice=>choice.value===value)):!Number.isFinite(value)||value<parameter.min||value>parameter.max||parameter.step===1&&!Number.isInteger(value))throw new Error(`${group.name}: invalid ${parameter.label}.`);
        out[group.id][parameter.key]=value;
    }}
    for(const [key,values] of Object.entries(overrides)){const group=groups.find(row=>row.id===key);if(!group||Object.keys(values).some(key=>!group.parameters.some(row=>row.key===key)))throw new Error('This native template does not support the requested mechanic. Update its gameplay plugin.');}
    return out;
}
function validateNativeFeatures(input){
    const id=value=>typeof value==='string'&&/^[a-z][a-zA-Z0-9-]{0,47}$/.test(value)&&!['constructor','prototype'].includes(value);
    if(!Array.isArray(input)||input.length>16)throw new Error('Use at most 16 native features.');
    const seen=new Set();return input.map(feature=>{
        if(!feature||Object.keys(feature).some(key=>!['id','source','mechanic','values'].includes(key))||!id(feature.id)||seen.has(feature.id)||!Number.isInteger(feature.source)||feature.source<1||feature.source>65022||!id(feature.mechanic))throw new Error('Invalid or duplicate attack feature.');
        seen.add(feature.id);return {...feature,values:validateMechanicOverrides({[feature.mechanic]:feature.values??{}})[feature.mechanic]};
    });
}
// Portable plugin helper. No filesystem, source-tree imports, timers, saved attributes,
// queued synthetic hits, or process-global registries. Embed this file in exported code.
function validateManifest(manifest) {
    const check = (ok, message) => { if (!ok) throw new Error(`Gear effects: ${message}`); };
    const num = (v,min,max,whole=false) => Number.isFinite(v) && v >= min && v <= max && (!whole || Number.isInteger(v));
    const object = (value,allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k=>allowed.includes(k));
    const name = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 80 && !/[\x00-\x1f]/.test(v);
    check(object(manifest,['owner','itemId','config','requires']) && typeof manifest.owner==='string' && /^content-builder:[a-z][a-z0-9-]{0,55}$/.test(manifest.owner) && num(manifest.itemId,50000,65022,true),'invalid owner or custom item ID.');
    const c = manifest.config;
    check(object(c,['version','special','passives']) && c.version === 1 && Array.isArray(c.passives) && c.passives.length <= 8,'invalid configuration.');
    const validateActions = actions => {
        check(Array.isArray(actions) && actions.length <= 4,'at most four actions per rule.');
        for (const a of actions) {
            check(object(a,['type','percent','minimum','basis','ticks','skill','order','trigger','phase','chance','damage']), 'unsupported action field.');
            check(['heal','prayer','drain','drain-levels','drain-stats','freeze','poison','venom','teleblock'].includes(a.type),'unknown action.');
            if(a.phase!==undefined)check(['launch','impact'].includes(a.phase)&&(!(a.phase==='launch')||['freeze','poison','venom','teleblock'].includes(a.type)),'invalid effect timing.');
            if(a.chance!==undefined)check(num(a.chance,0,100),'invalid individual chance.');
            if(a.trigger!==undefined)check(a.type==='drain'&&['damage','accurate'].includes(a.trigger),'invalid drain trigger.');
            if (a.type === 'freeze') check(num(a.ticks,1,32,true),'invalid freeze duration.');
            else if(a.type==='teleblock')check(num(a.ticks,1,6000,true),'invalid teleblock duration.');
            else if(a.type==='venom'){}
            else if(a.type==='poison')check(num(a.damage,1,20,true),'invalid poison damage.');
            else if (a.type !== 'drain-stats'||a.percent!==undefined) check(num(a.percent,1,100),'invalid percentage.');
            if(a.type==='drain-levels')check(['defence','strength','prayer','attack','magic','ranged'].includes(a.skill)&&['dealt','current'].includes(a.basis),'invalid stat drain.');
            if(a.order!==undefined)check(a.type==='drain-stats'&&Array.isArray(a.order)&&num(a.order.length,1,6,true)&&new Set(a.order).size===a.order.length&&a.order.every(s=>['defence','strength','prayer','attack','magic','ranged'].includes(s)),'invalid drain order.');
            if (a.type === 'heal' || a.type === 'prayer') check(num(a.minimum,0,100,true) && ['dealt','rolled','max','missing','flat'].includes(a.basis),'invalid recovery.');
        }
    };
    if (c.special !== null) {
        const s=c.special;
        check(object(s,['name','activation','style','animation','graphic','energy','hitCount','hitDelayTicks','accuracyMultiplier','damageMultiplier','damageStages','defence','chance','actions','sharedAccuracy','minimumDamageMultiplier','maximumDamageMultiplier','defenceRollMultiplier','attackSpeedTicks','visuals','nativeFrom','nativeOverrides','nativeMechanics','nativeFeatures','explicitVisuals','disabledFeatureVisuals','modifiers','recipe','ruleFeatures','extraFeatures','replaceGraphics']) && name(s.name) && ['melee','ranged','magic'].includes(s.style),'invalid special attack.');
        check(s.activation===undefined||['melee','ranged','self'].includes(s.activation),'choose a special activation.');
        check(num(s.animation,s.nativeFrom===undefined&&!s.recipe?0:-1,65534,true) && num(s.graphic,-1,65534,true) && num(s.energy,s.nativeFrom===undefined&&!s.recipe?1:0,100,true),'invalid special appearance or energy.');
        check(num(s.hitCount,1,4,true) && Array.isArray(s.hitDelayTicks) && s.hitDelayTicks.length === s.hitCount && s.hitDelayTicks[0]===0 && s.hitDelayTicks.every((t,i)=>num(t,0,8,true) && (!i || t>=s.hitDelayTicks[i-1])),'invalid hit timing.');
        check(num(s.accuracyMultiplier,.1,5) && num(s.damageMultiplier,.1,5) && num(s.chance,0,100) && ['style','stab','slash','crush'].includes(s.defence),'invalid special rolls.');
        check(s.style!=='ranged'||s.recipe||s.defence==='style','ranged specials require ranged defence.');
        if(s.damageStages!==undefined)check(Array.isArray(s.damageStages)&&s.damageStages.length>=1&&s.damageStages.length<=(s.modifiers?16:3)&&s.damageStages.every(v=>num(v,.1,s.modifiers?5:3)),'invalid damage stages.');
        if(s.modifiers!==undefined){const seen=new Set();check(Array.isArray(s.modifiers)&&s.modifiers.length<=16,'invalid modifier list.');for(const row of s.modifiers){check(object(row,['id','type','multiplier'])&&typeof row.id==='string'&&/^[a-z][a-zA-Z0-9-]{0,47}$/.test(row.id)&&!['constructor','prototype'].includes(row.id)&&!seen.has(row.id)&&['damage','accuracy'].includes(row.type)&&num(row.multiplier,.1,5),'invalid attack modifier.');seen.add(row.id);}for(const type of ['damage','accuracy'])check(Math.abs(s[`${type}Multiplier`]-s.modifiers.filter(row=>row.type===type).reduce((value,row)=>value*row.multiplier,1))<1e-7,'modifier totals do not match combat values.');}
        if(s.sharedAccuracy!==undefined)check(typeof s.sharedAccuracy==='boolean','invalid shared accuracy.');
        for(const field of ['minimumDamageMultiplier','maximumDamageMultiplier'])if(s[field]!==undefined)check(num(s[field],0,3),'invalid damage bound.');
        check((s.minimumDamageMultiplier??0)<=(s.maximumDamageMultiplier??1),'minimum exceeds maximum damage.');
        if(s.defenceRollMultiplier!==undefined)check(num(s.defenceRollMultiplier,.1,2),'invalid defence roll multiplier.');
        if(s.attackSpeedTicks!==undefined)check(num(s.attackSpeedTicks,1,20,true),'invalid attack duration.');
        if(s.nativeFrom!==undefined)check(num(s.nativeFrom,1,65022,true)&&Array.isArray(s.nativeOverrides)&&new Set(s.nativeOverrides).size===s.nativeOverrides.length&&s.nativeOverrides.every(v=>['accuracy','damage','hits','defence','speed','animation'].includes(v))&&typeof s.replaceGraphics==='boolean','invalid native attack template.');
        else check(s.nativeOverrides===undefined&&s.nativeMechanics===undefined&&s.replaceGraphics===undefined&&(s.style!=='magic'||s.recipe),'native overrides need a template.');
        if(s.nativeMechanics!==undefined)validateMechanicOverrides(s.nativeMechanics);
        if(s.recipe!==undefined){check(s.recipe===true,'unsupported modular recipe.');attackRuntime.validateRuleFeatures(s.ruleFeatures);attackRuntime.validateExtraFeatures(s.extraFeatures);}else check(s.ruleFeatures===undefined&&s.extraFeatures===undefined,'rule effects require a modular recipe.');
        if(s.nativeFeatures!==undefined)validateNativeFeatures(s.nativeFeatures);
        if(s.explicitVisuals!==undefined)check(s.explicitVisuals===true&&s.recipe,'explicit visuals require a modular recipe.');
        validateVisuals(s.visuals);
        if(s.disabledFeatureVisuals!==undefined)check(Array.isArray(s.disabledFeatureVisuals)&&s.disabledFeatureVisuals.length<=16&&new Set(s.disabledFeatureVisuals).size===s.disabledFeatureVisuals.length&&s.disabledFeatureVisuals.every(id=>s.nativeFeatures?.some(row=>row.id===id)),'invalid feature VFX suppression.');
        check(!s.visuals?.some(clip=>clip.nativeFeature&&!s.nativeFeatures?.some(row=>row.id===clip.nativeFeature)&&!s.extraFeatures?.some(row=>row.id===clip.nativeFeature&&row.type==='next-flames')),'unknown visual feature.');
        check(!s.visuals?.some(c=>c.nativeGraphic!==undefined)||(s.nativeFrom!==undefined&&s.replaceGraphics||s.nativeFeatures?.length>0||s.extraFeatures?.some(row=>row.type==='next-flames')),'native graphic cues need an imported feature or a native template with custom VFX.');
        validateActions(s.actions);
    }
    const ids = new Set();
    for (const p of c.passives) {
        check(object(p,['id','name','style','chance','trigger','bonusDamage','actions','set','visuals','intervalTicks','thresholdPercent','cooldownTicks','conditions']) && typeof p.id==='string' && /^[a-z][a-z0-9-]{0,47}$/.test(p.id) && !ids.has(p.id) && name(p.name),'invalid or duplicate passive.');ids.add(p.id);
        check(['any','melee','ranged','magic'].includes(p.style) && ['damage','accurate','attack','taken','hit-received','kill','interval','hp-below','prayer-below','equip'].includes(p.trigger) && num(p.chance,0,100) && num(p.bonusDamage,0,100,true) && (!p.bonusDamage || p.trigger==='accurate'),'invalid passive trigger.');
        check(p.trigger==='interval'?num(p.intervalTicks,1,6000,true):p.intervalTicks===undefined,'invalid activation interval.');
        check(['hp-below','prayer-below'].includes(p.trigger)?num(p.thresholdPercent,1,100):p.thresholdPercent===undefined,'invalid activation threshold.');
        if(p.cooldownTicks!==undefined)check(num(p.cooldownTicks,0,6000,true),'invalid cooldown.');
        if(p.conditions!==undefined){check(object(p.conditions,['hpBelowPercent','prayerBelowPercent','targetHpBelowPercent','inCombat']),'invalid activation conditions.');for(const key of ['hpBelowPercent','prayerBelowPercent','targetHpBelowPercent'])if(p.conditions[key]!==undefined)check(num(p.conditions[key],0,100),'invalid condition percentage.');if(p.conditions.inCombat!==undefined)check(typeof p.conditions.inCombat==='boolean','invalid combat condition.');}
        validateVisuals(p.visuals);
        check(!p.visuals?.some(c=>c.phase!=='impact'||c.nativeGraphic!==undefined),'passive visual clips start at activation impact.');
        validateActions(p.actions);
        check(!['interval','hp-below','prayer-below','equip','attack'].includes(p.trigger)||!p.actions.some(a=>['heal','prayer'].includes(a.type)&&['dealt','rolled'].includes(a.basis)||a.type==='drain-stats'||a.type==='drain-levels'&&a.basis==='dealt'),'this trigger needs damage-independent actions.');
        check(!p.actions.some(a=>a.phase==='launch'),'passives happen at impact.');
        if (p.set !== null) {
            check(object(p.set,['required','pieces']) && Array.isArray(p.set.pieces) && num(p.set.pieces.length,1,12,true) && num(p.set.required,1,p.set.pieces.length,true),'invalid set.');
            const slots = new Set();
            for(const piece of p.set.pieces) {
                check(object(piece,['slot','itemIds']) && [0,1,2,3,4,5,7,9,10,12,13].includes(piece.slot) && !slots.has(piece.slot),'invalid set slot.');slots.add(piece.slot);
                check(Array.isArray(piece.itemIds) && num(piece.itemIds.length,1,16,true) && piece.itemIds.every(id=>num(id,1,65022,true)) && new Set(piece.itemIds).size===piece.itemIds.length,'invalid set IDs.');
            }
        }
    }
    const requires=['combat-hit-hooks/1'];
    if(c.special)requires.push('combat-special-removal/1');
    if(c.special?.style==='ranged'&&c.special.nativeFrom===undefined)requires.push('native-ranged-method/1');
    if(c.passives.some(p=>p.bonusDamage>0))requires.push('combat-hit-context/1');
    if([c.special,...c.passives].some(p=>p?.visuals?.length))requires.push('actor-visuals/1');
    if(c.special?.nativeFrom!==undefined&&!c.special.recipe)requires.push('native-special-template/1');
    if(c.special?.recipe)requires.push('modular-attack-recipes/1');
    if(c.special?.nativeMechanics)requires.push('native-special-mechanics/1');
    if(c.special?.nativeFeatures!==undefined)requires.push('native-special-features/1');
    if([c.special,...c.passives].some(p=>p?.disabledFeatureVisuals?.length||p?.visuals?.some(c=>c.nativeGraphic!==undefined)))requires.push('actor-native-cues/1');
    if(c.passives.some(p=>['interval','hp-below','prayer-below','equip'].includes(p.trigger)))requires.push('player-process-hooks/1');
    if(c.passives.some(p=>p.trigger==='kill'))requires.push('combat-death-hooks/1');
    if([c.special,...c.passives].some(p=>p?.visuals?.some(c=>c.hueShift)))requires.push('actor-visual-colour/1');
    if([c.special,...c.passives].some(p=>p?.visuals?.some(c=>c.speed<1||c.delayMs+c.durationMs>30000)))requires.push('actor-visual-timing/2');
    check(Array.isArray(manifest.requires)&&JSON.stringify(manifest.requires)===JSON.stringify(requires),'declared capabilities do not match the effect configuration.');
    return JSON.parse(JSON.stringify(manifest));
}

// Call this at the beginning of the outer package's startup, before publishing
// item/model definitions. It performs no mutations or hook registrations.
function checkEffectCapabilities(api,manifest) {
    if(!manifest)return null;
    const checked=validateManifest(manifest),{owner,itemId,config}=checked,core=api.core;
    const specialId=`${owner}:special`, s=config.special;
    if(s?.recipe)attackRuntime.checkRequirements(api,s);
    if (typeof api.onCombatHitDamage !== 'function' || typeof api.onCombatHitResolved !== 'function') throw new Error('Gear effects require native combat roll and impact hooks.');
    if(typeof core.HitDamage?.prototype?.onApplied!=='function')throw new Error('Gear effects require native HitDamage.onApplied health-loss callbacks.');
    if([...(s?.actions??[]),...config.passives.flatMap(p=>p.actions)].some(a=>['poison','venom'].includes(a.type))&&typeof core.CombatFactory?.poisonEntity!=='function')throw new Error('Poison effects require native immunity-aware poison support.');
    if([...(s?.actions??[]),...config.passives.flatMap(p=>p.actions)].some(a=>a.type==='teleblock')&&typeof core.TeleBlock?.apply!=='function')throw new Error('Teleblock effects require native TeleBlock support.');
    if (s && typeof api.unregisterCombatSpecial !== 'function') throw new Error('Original specials require the generic unregisterCombatSpecial(id) plugin capability.');
    if (s?.style==='ranged' && s.nativeFrom===undefined && (!core.RangedCombatMethod?.landingDelays || !core.WeaponProfiles?.ranged)) throw new Error('Ranged specials require native ranged projectile and ammunition capabilities.');
    if (config.passives.some(p=>p.bonusDamage>0) && core.PendingHit?.ROLL_CONTEXT_VERSION !== 1) throw new Error('Added damage requires PendingHit.ROLL_CONTEXT_VERSION 1: initialise handleAfterHitEffects before rolling damage.');
    if(checked.requires.includes('actor-visuals/1')&&core.ActorVisuals?.VERSION!==1)throw new Error('Visual queues require native ActorVisuals version 1.');
    if(checked.requires.includes('actor-visual-colour/1')&&core.ActorVisuals?.COLOUR_VERSION!==1)throw new Error('VFX hue shifting requires ActorVisuals.COLOUR_VERSION 1 and the matching web client.');
    if(checked.requires.includes('actor-visual-timing/2')&&core.ActorVisuals?.TIMING_VERSION!==2)throw new Error('Slower or extended VFX require ActorVisuals.TIMING_VERSION 2 and the matching web client.');
    if(s?.nativeFrom!==undefined&&!s.recipe&&(core.CombatSpecial.TEMPLATE_VERSION!==1||core.ActorVisuals?.PRESENTATION_VERSION!==1||core.ItemAliases?.SCOPED_VERSION!==1||!core.CombatSpecial.getForWeaponId(s.nativeFrom)))throw new Error('This attack needs a registered native template and scoped actor presentation support.');
    if(s?.nativeMechanics){const schema=core.CombatSpecial.getForWeaponId(s.nativeFrom).getMetadata()?.editorMechanics;if(schema?.version!==1)throw new Error('Custom native mechanics require an updated gameplay template with editorMechanics version 1.');resolveMechanics(schema.groups,s.nativeMechanics);}
    if(s?.nativeFeatures!==undefined){
        if(typeof core.ActorVisuals?.withPresentation!=='function')throw new Error('Attack features require scoped actor presentation support.');
        if(s.nativeFrom!==undefined&&!s.recipe&&core.CombatSpecial.getForWeaponId(s.nativeFrom).getMetadata()?.editorMechanics?.version!==1)throw new Error('Update the native base gameplay plugin to edit its feature list.');
        for(const feature of s.nativeFeatures){const source=core.CombatSpecial.getForWeaponId(feature.source),schema=source?.getMetadata()?.editorMechanics,group=schema?.groups?.find(row=>row.id===feature.mechanic);if(schema?.version!==1||!['handleAfterHitEffects','applySpecialFeature','getSpecialFeatureTraits'].includes(group?.hook)||typeof source.getCombatMethod()?.[group.hook]!=='function')throw new Error('This native feature needs its updated source gameplay plugin.');resolveMechanics(schema.groups,{[feature.mechanic]:feature.values});}
    }
    if(checked.requires.includes('actor-native-cues/1')&&core.ActorVisuals?.CUE_VERSION!==1)throw new Error('Native visual cues require ActorVisuals.CUE_VERSION 1.');
    if(checked.requires.includes('player-process-hooks/1')&&typeof api.onPlayerProcess!=='function')throw new Error('Timed and threshold effects require native player process hooks.');
    if(checked.requires.includes('combat-death-hooks/1')&&(typeof api.onNpcDeath!=='function'||typeof api.onPlayerDeath!=='function'))throw new Error('Kill effects require native NPC and player death hooks.');
    if (s && (core.CombatSpecial.getForWeaponId(itemId) || core.CombatSpecial.getById(specialId))) throw new Error('This item or special ID already belongs to another special attack.');
    return checked;
}
function registerEffects(api, manifest, options = {}) {
    if (!manifest) return { dispose() {}, setEnabled() {}, enabled: false };
    const {owner,itemId,config}=checkEffectCapabilities(api,manifest),core=api.core;
    const specialId=`${owner}:special`,s=config.special;
    let aliasHandle=null,enabled=true, disposed=false, epoch=0, records=new WeakMap(), seen=new WeakSet(), resolving=new WeakSet(), playerStates=new WeakMap(),killCandidates=new WeakMap();
    const visualHandles=new Set();
    const modular=s?.recipe?attackRuntime.createAttackRuntime(api,s,{itemId,isActive:()=>enabled&&!disposed,isSpecial:event=>stateFor(event).special===s,present:(row,attacker,target,fn)=>{const generation=epoch;return core.ActorVisuals.withPresentation([['player',attacker],['target',target]].filter(([,entity],i)=>entity&&(i===0||entity!==attacker)).map(([recipient,entity])=>({entity,onGraphic:graphic=>{if(row.type!=='next-flames')return false;const clips=(s.visuals??[]).filter(clip=>clip.nativeFeature===row.id&&clip.nativeRecipient===recipient);if(clips.length)playVisuals(clips,attacker,target);return clips.length>0||!!s.explicitVisuals;}})),()=>enabled&&!disposed&&generation===epoch,fn);}}):null;
    function recipeScope(attacker,target,fn){const generation=epoch;return core.ActorVisuals.withPresentation([attacker,target].filter((entity,index,rows)=>entity&&rows.indexOf(entity)===index).map(entity=>({entity})),()=>enabled&&!disposed&&generation===epoch,fn);}
    function applyFeatures(hit,record,event='impact'){
        for(const feature of s?.nativeFeatures??[]){
            const source=core.CombatSpecial.getForWeaponId(feature.source);if(!source)continue;const schema=source.getMetadata().editorMechanics,group=schema.groups.find(row=>row.id===feature.mechanic),method=source.getCombatMethod(),instance=Object.create(method),generation=epoch;
            if(group.hook==='getSpecialFeatureTraits')continue;
            if((group.event==='launch')!==(event==='launch'))continue;
            const values=resolveMechanics(schema.groups,{[feature.mechanic]:feature.values});for(const other of schema.groups)if(other.id!==group.id)values[other.id].enabled=false;
            instance.specialMechanics=values;instance.specialFeatureRolledDamage=record.rolled;instance.isSpecialFeatureActive=()=>enabled&&!disposed&&generation===epoch&&core.CombatSpecial.getForWeaponId(feature.source)===source;
            const actors=[['player',record.attacker],['target',record.target]].filter(([,entity],index)=>entity&&(index===0||entity!==record.attacker)).map(([recipient,entity])=>({entity,onGraphic:graphic=>{if(s.disabledFeatureVisuals?.includes(feature.id))return true;const cue=group.preview?.graphic??graphic.getId(),candidates=(s.visuals??[]).filter(c=>c.nativeGraphic===cue&&c.nativeRecipient===recipient),exact=candidates.filter(c=>c.nativeFeature===feature.id),rows=exact.length?exact:candidates.filter(c=>!c.nativeFeature);if(!rows.length)return !!s.explicitVisuals;playVisuals(rows.map(c=>({...c,delayMs:Math.min(119999,120000-c.durationMs,c.delayMs+Math.max(0,graphic.getDelay?.()??0)*20),height:c.kind==='animation'?0:c.heightMode==='custom'?c.height:graphic.getHeight?.()??c.height})),record.attacker,record.target);return true;}}));
            core.ActorVisuals.withPresentation(actors,instance.isSpecialFeatureActive,()=>method[group.hook].apply(instance,event==='launch'?[record.attacker,record.target]:[hit]));
        }
    }
    function traitFeatures(traits,player){
        const out={...traits};if(!player)return out;
        for(const feature of s?.nativeFeatures??[]){const source=core.CombatSpecial.getForWeaponId(feature.source),schema=source?.getMetadata()?.editorMechanics,group=schema?.groups.find(row=>row.id===feature.mechanic);if(group?.hook!=='getSpecialFeatureTraits')continue;
            const instance=Object.create(source.getCombatMethod()),values=resolveMechanics(schema.groups,{[feature.mechanic]:feature.values});for(const other of schema.groups)if(other.id!==group.id)values[other.id].enabled=false;instance.specialMechanics=values;
            const extra=instance.getSpecialFeatureTraits(player)??{};for(const [key,value] of Object.entries(extra))if(['damageMultiplier','accuracyMultiplier'].includes(key))attackRuntime.scaleTrait(out,key,value);else out[key]=value;
        }return out;
    }
    function clearVisuals(){for(const handle of visualHandles)handle.cancel();visualHandles.clear();}
    function playVisuals(clips,attacker,target){
        if(!clips.length)return;
        const generation=epoch;
        for(const [recipient,entity] of [['player',attacker],['target',target]]){
            const rows=clips.filter(c=>c.recipient===recipient||c.recipient==='both'||recipient==='player'&&target===attacker&&c.recipient==='target');
            if(!entity||recipient==='target'&&entity===attacker)continue;
            if(!rows.length)continue;
            if(visualHandles.size>=128){const oldest=visualHandles.values().next().value;oldest.cancel();visualHandles.delete(oldest);}
            const handle=core.ActorVisuals.play(entity,rows,()=>enabled&&!disposed&&generation===epoch);
            visualHandles.add(handle);handle.finished.then(()=>visualHandles.delete(handle));
        }
    }
    function visuals(rule,attacker,target,phase){playVisuals((rule?.visuals??[]).filter(c=>c.nativeGraphic===undefined&&c.phase===phase),attacker,target);}
    const random=options.random ?? Math.random;
    function proc(chance) {
        if (chance <= 0) return false;
        if (chance >= 100) return true;
        const value=random();
        if (!Number.isFinite(value) || value<0 || value>=1) throw new Error('Effect random source must return 0 to less than 1.');
        return value*100 < chance;
    }
    const worn = (player,slot) => player.getEquipment?.().get?.(slot)?.getId?.();
    const wearsItem = player => [0,1,2,3,4,5,7,9,10,12,13].some(slot=>worn(player,slot)===itemId);
    function matchesSet(player,set) { return !set || set.pieces.filter(piece=>piece.itemIds.includes(worn(player,piece.slot))).length>=set.required; }
    const tick=options.tick??(()=>core.World?.getProcessCycle?.()??Math.floor(Date.now()/600));
    function ruleState(player,rule){let rows=playerStates.get(player);if(!rows){rows=new Map();playerStates.set(player,rows);}if(!rows.has(rule.id))rows.set(rule.id,{next:-Infinity,equipped:false,below:false,due:null,lastTick:-1});return rows.get(rule.id);}
    function ratio(entity,skill){
        if(!entity)return Infinity;
        if(entity.isPlayer?.()){const manager=entity.getAsPlayer().getSkillManager(),maximum=manager.getMaxLevel(skill);return maximum>0?manager.getCurrentLevel(skill)/maximum*100:100;}
        const maximum=entity.getMaxHitpoints?.();return maximum>0?entity.getHitpoints()/maximum*100:Infinity;
    }
    function conditions(rule,player,target){
        if(player.getHitpoints?.()<=0)return false;
        const c=rule.conditions??{};
        if(c.hpBelowPercent!==undefined&&ratio(player,core.Skill.HITPOINTS)>c.hpBelowPercent)return false;
        if(c.prayerBelowPercent!==undefined&&ratio(player,core.Skill.PRAYER)>c.prayerBelowPercent)return false;
        if(c.targetHpBelowPercent!==undefined&&ratio(target,core.Skill.HITPOINTS)>c.targetHpBelowPercent)return false;
        if(c.inCombat!==undefined){const combat=player.getCombat?.(),engaged=!!combat?.getTarget?.()||(combat?.ticksSinceAttacked?.()??Infinity)<10;if(engaged!==c.inCombat)return false;}
        return true;
    }
    function activate(entry,player,target){
        if(entry.chosen!==undefined)return entry.chosen;
        const state=ruleState(player,entry.rule),now=tick();
        entry.chosen=now>=state.next&&conditions(entry.rule,player,target)&&proc(entry.rule.chance);
        if(entry.chosen)state.next=now+(entry.rule.cooldownTicks??0);
        return entry.chosen;
    }
    function eligible(player,type,triggers){
        if(!player||!wearsItem(player))return [];
        const styles={melee:core.CombatType.MELEE,ranged:core.CombatType.RANGED,magic:core.CombatType.MAGIC};
        return config.passives.filter(p=>triggers.includes(p.trigger)&&(p.style==='any'||styles[p.style]===type)&&matchesSet(player,p.set)).map(rule=>({rule,chosen:undefined,bonusUsed:false}));
    }
    function stateFor(event) {
        let record=records.get(event.hit);
        if(record) return record;
        const player=event.attacker?.isPlayer?.()?event.attacker.getAsPlayer():null, victim=event.target?.isPlayer?.()?event.target.getAsPlayer():null,type=event.combatType;
        const special=player&&s && worn(player,3)===itemId && player.isSpecialActivated?.() && (s.nativeFrom!==undefined?player.getCombatSpecial?.()?.getCombatMethod()===specialDefinition?.combatMethod:player.getCombatSpecial?.()?.getId()===specialId) ? s : null;
        record={attacker:event.attacker,target:event.target,rolled:0,special,passives:eligible(player,type,['damage','accurate','attack','kill']),incoming:eligible(victim,type,['taken','hit-received'])};
        records.set(event.hit,record);return record;
    }
    function onDamage(event) {
        if (!enabled || disposed || !(event.attacker?.isPlayer?.()||event.target?.isPlayer?.()) || !event.hit || resolving.has(event.attacker) || resolving.has(event.target) || seen.has(event.hit) || event.hit.getHandleAfterHitEffects?.()===false) return;
        modular?.onDamage(event);
        // Every HitDamage reports its actual health loss, including staggered splats.
        const record=stateFor(event);
        if (event.accurate) for(const entry of record.passives) {
            // One proc per PendingHit, never a second attack. Added damage belongs
            // to the first accurate existing hitsplat, before HP capping and XP.
            if(entry.rule.bonusDamage>0&&activate(entry,record.attacker,record.target) && !entry.bonusUsed) {
                event.damage.setDamage(Math.max(0,event.damage.getDamage())+entry.rule.bonusDamage);
                entry.bonusUsed=true;
            }
        }
        if(event.accurate)record.rolled+=Math.max(0,event.damage.getDamage());
    }
    function skills(entity) { return entity.isPlayer?.() ? entity.getAsPlayer().getSkillManager() : entity.getAsNpc(); }
    function restore(player,skill,amount) {
        if(player.getHitpoints?.()<=0) return;
        const manager=player.getSkillManager(), current=manager.getCurrentLevel(skill), maximum=manager.getMaxLevel(skill);
        if(current<maximum && amount>0) manager.setCurrentLevels(skill,Math.min(maximum,current+amount));
    }
    function recovery(action,player,record,dealt){
        const skill=action.type==='heal'?core.Skill.HITPOINTS:core.Skill.PRAYER,manager=player.getSkillManager(),maximum=manager.getMaxLevel(skill);
        const basis=action.basis==='flat'?0:action.basis==='max'?maximum:action.basis==='missing'?Math.max(0,maximum-manager.getCurrentLevel(skill)):action.basis==='rolled'?record.rolled:dealt;
        return Math.max(action.minimum,Math.floor(basis*action.percent/100));
    }
    function act(action,record,hit,damageTaken) {
        const attacker=record.attacker, target=record.target, accurate=hit?.isAccurate?.()??true, dealt=Math.max(0,Math.floor(damageTaken));
        if (action.type==='heal' || action.type==='prayer') {
            restore(attacker.getAsPlayer(),action.type==='heal'?core.Skill.HITPOINTS:core.Skill.PRAYER,recovery(action,attacker.getAsPlayer(),record,dealt));
        } else if(!target||target.getHitpoints?.()<=0||!accurate&&dealt<=0)return;
        else if(action.type==='freeze') {
            core.CombatFactory.freeze(target,action.ticks*.6,undefined,attacker);
        } else if(action.type==='teleblock'&&target.isPlayer?.()) {
            core.TeleBlock.apply(target.getAsPlayer(),attacker.getUsername?.()??'Custom special',action.ticks*.6);
        } else if(action.type==='venom'&&(dealt>0||record.activation)) {
            core.CombatFactory.poisonEntity(target,6,2);
        } else if(action.type==='poison'&&(dealt>0||record.activation)) {
            core.CombatFactory.poisonEntity(target,action.damage*5,1);
        } else if(action.type==='drain' && (dealt>0||action.trigger==='accurate'||record.activation)) {
            const manager=skills(target), old=Math.max(0,Math.floor(manager.getCurrentLevel(core.Skill.DEFENCE)));
            manager.setCurrentLevels(core.Skill.DEFENCE,Math.max(target.isPlayer()?1:0,old-Math.floor(old*action.percent/100)));
        } else if(action.type==='drain-levels'&&(dealt>0||record.activation&&action.basis==='current')) {
            if(action.skill==='prayer'&&!target.isPlayer())return;
            const manager=skills(target),skill=core.Skill[action.skill.toUpperCase()],old=Math.max(0,Math.floor(manager.getCurrentLevel(skill)));
            const amount=Math.floor((action.basis==='current'?old:dealt)*action.percent/100);
            manager.setCurrentLevels(skill,Math.max(target.isPlayer()&&action.skill!=='prayer'?1:0,old-amount));
        } else if(action.type==='drain-stats' && dealt>0) {
            const manager=skills(target);let remaining=Math.floor(dealt*(action.percent??100)/100);
            for(const name of action.order??['defence','strength','prayer','attack','magic','ranged']) {
                const skill=core.Skill[name.toUpperCase()];
                if(!remaining)break;
                if(!target.isPlayer() && skill===core.Skill.PRAYER)continue;
                const old=Math.max(0,Math.floor(manager.getCurrentLevel(skill))),floor=target.isPlayer()&&action.order?1:0, amount=Math.min(Math.max(0,old-floor),remaining);
                if(amount<=0)continue;
                manager.setCurrentLevels(skill,old-amount);remaining-=amount;
                // Encounter floors stop spillover, as the native Bandos method does.
                if(manager.getCurrentLevel(skill)>floor)break;
            }
        }
    }
    function standalone(entry,player,target,hit=null){
        if(!activate(entry,player,target))return;
        const record={attacker:player,target,rolled:0,activation:true};
        resolving.add(player);try{for(const action of entry.rule.actions)if(proc(action.chance??100))act(action,record,null,0);visuals(entry.rule,player,target,'impact');}finally{resolving.delete(player);}
    }
    function onDeath(event){
        const target=event.npc??event.player,candidate=target&&killCandidates.get(target);if(target)killCandidates.delete(target);
        if(!enabled||disposed||!candidate||candidate.attacker!==(event.lastDamager??event.killer))return;
        const player=candidate.attacker;
        resolving.add(player);try{for(const entry of candidate.passives)if(entry.rule.trigger==='kill'&&activate(entry,player,target)){for(const action of entry.rule.actions)if(proc(action.chance??100))act(action,candidate,candidate.hit,candidate.dealt);visuals(entry.rule,player,target,'impact');}}finally{resolving.delete(player);}
    }
    function onProcess({player}){
        if(!enabled||disposed)return;
        const now=tick(),alive=player.getHitpoints?.()>0,target=player.getCombat?.()?.getTarget?.()??null;
        for(const rule of config.passives){
            if(!['interval','hp-below','prayer-below','equip'].includes(rule.trigger))continue;
            const state=ruleState(player,rule),equipped=alive&&wearsItem(player)&&matchesSet(player,rule.set);
            if(!equipped){state.equipped=false;state.below=false;state.due=null;continue;}
            if(state.lastTick===now)continue;state.lastTick=now;
            const wasEquipped=state.equipped;state.equipped=true;let fire=false;
            if(rule.trigger==='equip')fire=!wasEquipped;
            else if(rule.trigger==='interval'){state.due??=now+rule.intervalTicks;if(now>=state.due){fire=true;state.due=now+rule.intervalTicks;}}
            else{const below=ratio(player,rule.trigger==='hp-below'?core.Skill.HITPOINTS:core.Skill.PRAYER)<=rule.thresholdPercent;fire=below&&!state.below;state.below=below;}
            if(fire)standalone({rule,chosen:undefined},player,target);
        }
    }
    function onResolved(event) {
        if (!event.hit) return;
        const record=records.get(event.hit);records.delete(event.hit);
        if(!enabled || disposed || !record || seen.has(event.hit) || event.hit.getHandleAfterHitEffects?.()!==true || record.attacker!==event.attacker || record.target!==event.target || resolving.has(event.attacker))return;
        seen.add(event.hit);
        // Resolved hits have entered the native queue. Health loss is known only
        // when that queue applies each HitDamage, after same-cycle damage caps.
        const hits=event.hit.getHits(),generation=epoch;
        if(record.special){applyFeatures(event.hit,record);if(modular)recipeScope(record.attacker,record.target,()=>modular.onResolved(event.hit,record));}
        for(const entry of record.passives)if(entry.rule.trigger==='attack')standalone(entry,record.attacker,record.target,event.hit);
        let dealt=0,impactPlayed=false,specialChosen;
        const progress=new Map(),chosenActions=new Map(),completed=new Set(),visualized=new Set();
        function apply(rule,context=record){
            if(!event.hit.isAccurate()&&dealt<=0)return;
            for(const action of rule.actions){
                const recover=action.type==='heal'||action.type==='prayer',scaledRecovery=recover&&['dealt','rolled'].includes(action.basis);
                const damageScaled=action.type==='drain-stats'||action.type==='drain-levels'&&action.basis==='dealt';
                if(action.phase==='launch'||completed.has(action))continue;
                const damage=recover&&action.basis==='rolled'?record.rolled:dealt;
                if((scaledRecovery||damageScaled||['poison','drain-levels'].includes(action.type)||action.type==='drain'&&action.trigger!=='accurate')&&damage<=0)continue;
                if(!chosenActions.has(action))chosenActions.set(action,proc(action.chance??100));
                if(!chosenActions.get(action))continue;
                if(scaledRecovery||damageScaled){
                    const earned=Math.max(recover?action.minimum:0,Math.floor(damage*(action.percent??100)/100)),previous=progress.get(action)??0;
                    progress.set(action,earned);const delta=earned-previous;if(delta<=0)continue;
                    if(recover)restore(context.attacker.getAsPlayer(),action.type==='heal'?core.Skill.HITPOINTS:core.Skill.PRAYER,delta);
                    else act({...action,percent:100},context,event.hit,delta);
                }else{act(action,context,event.hit,dealt);completed.add(action);}
            }
        }
        for(const damage of hits)damage.onApplied(taken=>{
            if(!enabled||disposed||generation!==epoch)return;
            if(record.special&&!impactPlayed){impactPlayed=true;visuals(record.special,record.attacker,record.target,'impact');}
            dealt+=Math.max(0,taken);if(taken>0){if(record.passives.some(entry=>entry.rule.trigger==='kill'))killCandidates.set(record.target,{...record,hit:event.hit,dealt});else killCandidates.delete(record.target);}resolving.add(event.attacker);
            try{
                if(record.special){specialChosen??=proc(record.special.chance);if(specialChosen)apply(record.special);}
                for(const entry of record.passives){
                    const p=entry.rule;if(p.trigger==='attack'||p.trigger==='kill'||p.trigger==='damage'&&dealt<=0||p.trigger==='accurate'&&!event.hit.isAccurate())continue;
                    if(!activate(entry,record.attacker,record.target))continue;
                    apply(p);
                    if(!visualized.has(p)){visualized.add(p);visuals(p,record.attacker,record.target,'impact');}
                }
                for(const entry of record.incoming){
                    const p=entry.rule;if(p.trigger==='taken'?dealt<=0:!event.hit.isAccurate())continue;
                    if(!activate(entry,record.target,record.attacker))continue;
                    apply(p,{attacker:record.target,target:record.attacker,rolled:record.rolled});
                    if(!visualized.has(p)){visualized.add(p);visuals(p,record.target,record.attacker,'impact');}
                }
            }finally{resolving.delete(event.attacker);}
        });
    }

    let specialDefinition;
    if(s && (s.nativeFrom===undefined||s.recipe)) {
        const activation=specialActivation(s),selfCast=activation==='self',ranged=activation==='ranged',ammo=modular?.has('ammunition'),nativeAmmo=ranged&&(ammo?.mode==='weapon'||!s.recipe&&s.style==='ranged'),Base=nativeAmmo?core.RangedCombatMethod:activation==='melee'?core.MeleeCombatMethod:core.CombatMethod;
        const oneProjectile=attacker=>!!s.recipe||!nativeAmmo||(core.WeaponProfiles.ranged(attacker.getAsPlayer())?.projectiles?.length??1)===1;
        class BuilderSpecial extends Base {
            canAttack(attacker,target) { return !selfCast&&enabled && !disposed && oneProjectile(attacker) && (!modular||modular.condition(attacker,target)) && (nativeAmmo?super.canAttack(attacker,target):core.CombatMethod.prototype.canAttack.call(this,attacker,target)) && (!nativeAmmo||!modular?.has('ammunition')||modular.has('ammunition').mode==='none'||core.CombatFactory.checkAmmo(attacker,Math.max(modular.has('ammunition').minimum,1+modular.has('ammunition').extra))); }
            shouldRenew(attacker) {return enabled&&!disposed&&oneProjectile(attacker)&&(nativeAmmo?super.shouldRenew(attacker):core.CombatMethod.prototype.shouldRenew.call(this,attacker));}
            type(){return core.CombatType[s.style.toUpperCase()];}
            attackSpeed(attacker){return s.recipe?(baseTraits.attackSpeedTicks??super.attackSpeed(attacker)):(s.attackSpeedTicks??super.attackSpeed(attacker));}
            attackDistance(attacker){if(selfCast)return 0;if(activation==='melee')return super.attackDistance(attacker);return modular?.has('human-magic')?.range??(nativeAmmo?super.attackDistance(attacker):modular?.has('ammunition')?.range??7);}
            projectedDefenceLevel(attacker,target,context){return modular?.projectedDefence(attacker,target,context);}
            start(attacker,target) {
                if(selfCast)target=attacker;if(!enabled || disposed||modular&&!modular.condition(attacker,target))return;
                // Native ranged start/finished retain ammo checks, projectile
                // flight, ammo spending and recovery. Never synthesize ammo.
                if(nativeAmmo&&!modular?.replacesProjectiles()&&modular?.has('ammunition')?.mode!=='none'&&!(s.recipe&&baseTraits.skipAttack)){if(s.recipe)core.ActorVisuals.withPresentation([{entity:attacker,suppressGraphics:true}],()=>enabled&&!disposed,()=>super.start(attacker,target));else super.start(attacker,target);}
                if(modular)recipeScope(attacker,target,()=>modular.launch(attacker,target));
                core.CombatSpecial.drain(attacker,s.energy);
                applyFeatures(null,{attacker,target,rolled:0},'launch');
                if(s.animation>=0)attacker.performAnimation(new core.Animation(s.animation));
                visuals(s,attacker,target,'launch');
                if(s.graphic>=0)attacker.performGraphic(new core.Graphic(s.graphic));
                if(selfCast){if(proc(s.chance))for(const action of s.actions)if(proc(action.chance??100))act(action,{attacker,target:attacker,rolled:0,activation:true},null,0);visuals(s,attacker,attacker,'impact');return;}
                if(target&&s.actions.some(a=>a.phase==='launch')&&proc(s.chance))for(const action of s.actions)if(action.phase==='launch'&&proc(action.chance??100)){
                    if(action.type==='freeze')core.CombatFactory.freeze(target,action.ticks*.6,undefined,attacker);
                    if(action.type==='poison')core.CombatFactory.poisonEntity(target,action.damage*5,1);
                    if(action.type==='venom')core.CombatFactory.poisonEntity(target,6,2);
                    if(action.type==='teleblock'&&target.isPlayer?.())core.TeleBlock.apply(target.getAsPlayer(),attacker.getUsername?.()??'Custom special',action.ticks*.6);
                }
            }
            finished(attacker,target){if(selfCast)return;super.finished(attacker,target);const ammo=modular?.has('ammunition');if(nativeAmmo&&ammo?.mode==='weapon'){const amount=modular.replacesProjectiles()?Math.max(ammo.minimum,1+ammo.extra):Math.max(ammo.extra,ammo.minimum-core.RangedCombatMethod.arrowsPerShot(attacker));if(amount>0)core.CombatFactory.decrementAmmo(attacker,target.getLocation(),amount);}}
            hits(attacker,target) {
                if(!enabled || disposed||!oneProjectile(attacker))return [];
                const traits=traitsFor(attacker);if(selfCast||(s.recipe?baseTraits.skipAttack:traits.skipAttack))return [];
                const delay=modular?.has('human-magic')?.delayTicks??(modular?.has('ammunition')?.mode==='none'?modular.has('ammunition').delayTicks:undefined)??(nativeAmmo?core.RangedCombatMethod.landingDelays(attacker,target)[0]:ranged?2:0);
                const cfg={delay,hitAmount:traits.hitCount??(s.recipe?1:s.hitCount),hitDelays:traits.hitDelayTicks??(s.recipe?Array.from({length:traits.hitCount??1},()=>0):s.hitDelayTicks),...Object.fromEntries(['hitMaximumSplitCount','requireFirstAccurate','bestOf'].filter(key=>traits[key]!==undefined).map(key=>[key,traits[key]]))};
                const hit=new core.PendingHit(attacker,target,this,modular?modular.hitConfig(attacker,target,cfg):cfg);modular?.afterHits(hit);return modular?modular.expandHits(attacker,target,this,[hit]):[hit];
            }
        }
        const traits={hitCount:s.hitCount,hitDelayTicks:s.hitDelayTicks,accuracyMultiplier:s.accuracyMultiplier,...(s.damageStages?{damageMultiplierStages:s.damageStages}:{damageMultiplier:s.damageMultiplier}),...(s.defence==='style'?{}:{meleeDefenceBonusIndex:{stab:0,slash:1,crush:2}[s.defence]})};
        if(s.sharedAccuracy!==undefined)traits.sharedAccuracyRollAcrossHits=s.sharedAccuracy;
        for(const field of ['minimumDamageMultiplier','maximumDamageMultiplier','defenceRollMultiplier','attackSpeedTicks'])if(s[field]!==undefined)traits[field]=s[field];
        const baseTraits=s.recipe?attackRuntime.attackTraits(s):traits;
        const traitsFor=player=>({...traitFeatures(modular?modular.traits(baseTraits,player):baseTraits,player),...(selfCast||baseTraits.skipAttack!==undefined?{skipAttack:selfCast}:{})});
        specialDefinition={id:specialId,itemIds:[itemId],drainAmount:s.energy,strengthMultiplier:s.damageMultiplier,accuracyMultiplier:s.accuracyMultiplier,metadata:{activationType:activation},traits:traitsFor(null),traitsFor,combatMethod:new BuilderSpecial()};
    }
    if(s?.nativeFrom!==undefined&&!s.recipe){
        const source=core.CombatSpecial.getForWeaponId(s.nativeFrom),overrides=new Set(s.nativeOverrides);
        const methods=new WeakMap();
        function wrap(method){if(methods.has(method))return methods.get(method);const wrapped=Object.create(method);methods.set(method,wrapped);
        const schema=source.getMetadata()?.editorMechanics;
        if(schema?.version===1){const values=resolveMechanics(schema.groups,s.nativeMechanics);if(s.nativeFeatures!==undefined)for(const value of Object.values(values))value.enabled=false;wrapped.specialMechanics=Object.freeze(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,Object.freeze(value)])));}
        const scoped=(name,args)=>{
            const generation=epoch,attacker=args[0]?.getAttacker?.()??args[0],target=args[0]?.getTarget?.()??args[1];
            const actors=[['player',attacker],['target',target]].filter(([,entity],i)=>entity&&(i===0||entity!==attacker)).map(([role,entity])=>({entity,...(role==='player'&&overrides.has('animation')?{animation:s.animation}:{}),suppressGraphics:s.replaceGraphics,
                ...(s.replaceGraphics?{onGraphic:graphic=>{
                    const rows=(s.visuals??[]).filter(c=>c.nativeGraphic===graphic.getId()&&c.nativeRecipient===role).map(c=>({...c,delayMs:Math.min(119999,120000-c.durationMs,c.delayMs+Math.max(0,graphic.getDelay?.()??0)*20),height:c.kind==='animation'?0:c.heightMode==='custom'?c.height:graphic.getHeight?.()??c.height}));
                    playVisuals(rows,attacker,target);return true;
                }}:{})
            }));
            return core.ActorVisuals.withPresentation(actors,()=>enabled&&!disposed&&generation===epoch,()=>method[name].apply(wrapped,args));
        };
        for(const name of ['start','hits','finished','handleAfterHitEffects','onCombatBegan','onCombatEnded'])if(typeof method[name]==='function')wrapped[name]=function(...args){if(!enabled||disposed)return name==='hits'?[]:undefined;const result=scoped(name,args);if(name==='start'){applyFeatures(null,{attacker:args[0],target:args[1],rolled:0},'launch');if(s.graphic>=0)args[0].performGraphic(new core.Graphic(s.graphic));visuals(s,args[0],args[1],'launch');if(args[1]&&args[1]!==args[0]&&proc(s.chance))for(const a of s.actions)if(a.phase==='launch'&&proc(a.chance??100)){if(a.type==='freeze')core.CombatFactory.freeze(args[1],a.ticks*.6,undefined,args[0]);if(a.type==='poison')core.CombatFactory.poisonEntity(args[1],a.damage*5,1);}}return result;};
        for(const name of ['canAttack','canPursue','shouldRenew'])if(typeof method[name]==='function')wrapped[name]=function(...args){return enabled&&!disposed&&method[name].apply(wrapped,args);};
        if(overrides.has('speed')&&s.attackSpeedTicks)wrapped.attackSpeed=()=>s.attackSpeedTicks;
        return wrapped;}
        const wrapped=wrap(source.getCombatMethod());
        const traitsFor=player=>{
            const modularTraits=s.nativeFeatures!==undefined&&source.getMetadata()?.editorMechanics?.groups.some(group=>group.hook==='getSpecialFeatureTraits');
            const out={...((player&&!modularTraits?source.getTraitsFor(player):source.getTraits())??{})};
            if(overrides.has('accuracy'))out.accuracyMultiplier=s.accuracyMultiplier;
            if(overrides.has('damage')){out.damageMultiplier=s.damageMultiplier;delete out.damageMultiplierStages;if(s.damageStages)out.damageMultiplierStages=s.damageStages;for(const k of ['minimumDamageMultiplier','maximumDamageMultiplier'])if(s[k]!==undefined)out[k]=s[k];}
            if(overrides.has('hits')){out.hitCount=s.hitCount;out.hitDelayTicks=s.hitDelayTicks;if(s.sharedAccuracy!==undefined)out.sharedAccuracyRollAcrossHits=s.sharedAccuracy;}
            if(overrides.has('defence')){if(s.defence!=='style')out.meleeDefenceBonusIndex={stab:0,slash:1,crush:2}[s.defence];if(s.defenceRollMultiplier!==undefined)out.defenceRollMultiplier=s.defenceRollMultiplier;}
            return traitFeatures(out,player);
        };
        specialDefinition={id:specialId,itemIds:[itemId],inheritFromItemId:s.nativeFrom,overrideDrainAmount:true,drainAmount:s.energy,strengthMultiplier:overrides.has('damage')?s.damageMultiplier:source.getStrengthMultiplier(),accuracyMultiplier:overrides.has('accuracy')?s.accuracyMultiplier:source.getAccuracyMultiplier(),weaponInterface:source.getWeaponType(),metadata:source.getMetadata(),traits:traitsFor(null),traitsFor,combatMethod:wrapped,decorateResolvedMethod:wrap};
    }
    // Register only after every capability and collision check. The outer plugin
    // calls this helper from its attach-only registration entry point.
    if(specialDefinition)api.registerCombatSpecial(specialDefinition);
    if(s?.nativeFrom!==undefined&&!s.recipe)aliasHandle=core.ItemAliases.registerScoped(itemId,s.nativeFrom);
    api.onCombatHitDamage(onDamage);
    api.onCombatHitResolved(onResolved);
    if(config.passives.some(p=>['interval','hp-below','prayer-below','equip'].includes(p.trigger)))api.onPlayerProcess(onProcess);
    if(config.passives.some(p=>p.trigger==='kill')){api.onNpcDeath(onDeath);api.onPlayerDeath(onDeath);}
    function dispose() {
        if(disposed)return;
        aliasHandle?.dispose();aliasHandle=null;modular?.dispose();clearVisuals();enabled=false;disposed=true;epoch++;records=new WeakMap();seen=new WeakSet();resolving=new WeakSet();playerStates=new WeakMap();killCandidates=new WeakMap();
        if(specialDefinition && core.CombatSpecial.getById(specialId)?.getCombatMethod()===specialDefinition.combatMethod)api.unregisterCombatSpecial(specialId);
    }
    function setEnabled(value) {
        if(disposed)throw new Error('This effect package has been disposed. Register it again to enable it.');
        if(typeof value!=='boolean')throw new Error('Enabled must be true or false.');
        if(enabled===value)return;
        if(specialDefinition) {
            if(value) {
                if(core.CombatSpecial.getForWeaponId(itemId)||core.CombatSpecial.getById(specialId))throw new Error('Another package owns this special attack.');
                api.registerCombatSpecial(specialDefinition);
            } else if(core.CombatSpecial.getById(specialId)?.getCombatMethod()===specialDefinition.combatMethod)api.unregisterCombatSpecial(specialId);
        }
        aliasHandle?.dispose();aliasHandle=value&&s?.nativeFrom!==undefined&&!s.recipe?core.ItemAliases.registerScoped(itemId,s.nativeFrom):null;
        modular?.dispose();clearVisuals();enabled=value;epoch++;records=new WeakMap();playerStates=new WeakMap();killCandidates=new WeakMap();
    }
    api.onServerShutdown?.(dispose);
    return {dispose,setEnabled,get enabled(){return enabled&&!disposed;}};
}
module.exports = {registerEffects,validateManifest,checkEffectCapabilities};
