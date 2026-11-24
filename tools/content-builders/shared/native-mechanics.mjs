import {ATTACK_FEATURES,validateExtraFeatures} from './attack-features.mjs';
// Native templates own their controls and defaults. The editor never infers gameplay from VFX.
import {newVisual} from './visuals.mjs';
const id=value=>typeof value==='string'&&/^[a-z][a-zA-Z0-9-]{0,47}$/.test(value)&&!['constructor','prototype'].includes(value);
export function validateMechanicOverrides(input){
    const scalar=value=>typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1000000||typeof value==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(value);
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
export function resolveMechanics(groups=[],input={}){
    const overrides=validateMechanicOverrides(input),out={};
    for(const group of groups){
        out[group.id]={};
        for(const parameter of group.parameters){
            const value=overrides[group.id]?.[parameter.key]??parameter.value;
            if(parameter.type==='boolean'?typeof value!=='boolean':parameter.type==='choice'?!parameter.choices.some(choice=>choice.value===value):parameter.type==='order'?!Array.isArray(value)||!value.length||new Set(value).size!==value.length||value.some(value=>!parameter.choices.some(choice=>choice.value===value)):!Number.isFinite(value)||value<parameter.min||value>parameter.max||parameter.step===1&&!Number.isInteger(value))throw new Error(`${group.name}: invalid ${parameter.label}.`);
            out[group.id][parameter.key]=value;
        }
    }
    for(const [key,values] of Object.entries(overrides)){
        const group=groups.find(row=>row.id===key);
        if(!group||Object.keys(values).some(key=>!group.parameters.some(row=>row.key===key)))throw new Error('This native template does not support the requested mechanic. Update its gameplay plugin.');
    }
    return out;
}
export function describeMechanic(group,values){
    return group.description.replace(/\{([a-zA-Z0-9-]+)(:seconds)?\}/g,(_,key,seconds)=>seconds?(Number(values[key])*.6).toFixed(1):String(values[key]));
}
export function mechanicPreview(groups,overrides){
    const values=resolveMechanics(groups,overrides);
    return groups.filter(group=>group.preview&&values[group.id].enabled!==false).map(group=>({
        id:group.id,name:group.name,delayMs:Number(values[group.id][group.preview.delayParameter]??0)*600,
        damage:group.preview.damageParameter?Number(values[group.id][group.preview.damageParameter]??0):undefined,graphic:group.preview.graphicParameter?values[group.id][group.preview.graphicParameter]:group.preview.graphic,recipient:group.preview.recipient??'target',description:describeMechanic(group,values[group.id])
    }));
}
export function validateNativeFeatures(input){
    if(!Array.isArray(input)||input.length>16)throw new Error('Use at most 16 native features.');
    const seen=new Set();return input.map(feature=>{
        if(!feature||Object.keys(feature).some(key=>!['id','source','mechanic','values'].includes(key))||!id(feature.id)||seen.has(feature.id)||!Number.isInteger(feature.source)||feature.source<1||feature.source>65022||!id(feature.mechanic))throw new Error('Invalid or duplicate attack feature.');
        seen.add(feature.id);return {...feature,values:validateMechanicOverrides({[feature.mechanic]:feature.values??{}})[feature.mechanic]};
    });
}
export function referenceFeatures(reference){return (reference.mechanics??[]).map((group,index)=>({id:`feature-${index+1}`,source:reference.id,mechanic:group.id,values:Object.fromEntries(group.parameters.map(parameter=>[parameter.key,structuredClone(parameter.value)]))}));}
export function validateAttackModifiers(input){
    if(!Array.isArray(input)||input.length>16)throw new Error('Use at most 16 attack modifiers.');
    const seen=new Set();return input.map(row=>{if(!row||Object.keys(row).some(key=>!['id','type','multiplier'].includes(key))||!id(row.id)||seen.has(row.id)||!['damage','accuracy'].includes(row.type)||!Number.isFinite(row.multiplier)||row.multiplier<.1||row.multiplier>5)throw new Error('Invalid damage or accuracy modifier.');seen.add(row.id);return {...row};});
}
export function attackModifiers(rule){return rule.modifiers??[...(rule.damageStages??(rule.damageMultiplier!==1?[rule.damageMultiplier]:[])).map((multiplier,index)=>({id:`damage-${index+1}`,type:'damage',multiplier})),...(rule.accuracyMultiplier!==1?[{id:'accuracy-1',type:'accuracy',multiplier:rule.accuracyMultiplier}]:[])];}
/** Resolve presentation without mutating either the recipe or its native references. */
export function attackFeaturePreview(rule,references){
    const recipeEvents=(rule.extraFeatures?validateExtraFeatures(rule.extraFeatures):[]).filter(row=>!['sound','projectile','condition','ammunition'].includes(row.type)).map(row=>{const v=row.values;return {id:row.id,name:ATTACK_FEATURES[row.type].name,delayMs:Number(v.delayTicks??0)*600,...(row.type==='follow-up'?{damage:v.minimum===v.maximum?Math.floor(v.minimum*v.percent/100):`${Math.floor(v.minimum*v.percent/100)}–${Math.floor(v.maximum*v.percent/100)}`}:{})};});
    const base=references.find(row=>row.id===rule.nativeFrom),clips=(rule.visuals??[]).map((clip,previewIndex)=>({...structuredClone(clip),previewIndex})),events=[];
    if(base&&!rule.replaceGraphics)clips.unshift(...(base.visualClips??[]).map(clip=>newVisual(clip.id,clip)));
    if(rule.nativeFeatures===undefined){
        events.push(...mechanicPreview(base?.mechanics??[],rule.nativeMechanics));
        for(const event of events){const group=base.mechanics.find(group=>group.id===event.id),cue=group.preview.graphic,matches=clips.filter(clip=>(clip.nativeGraphic??clip.id)===cue&&clip.recipient===event.recipient);for(const clip of matches){clip.phase='impact';clip.delayMs=Math.min(119999,120000-clip.durationMs,clip.delayMs+event.delayMs);}if(!matches.length&&!rule.replaceGraphics&&event.graphic>=0)clips.push(newVisual(event.graphic,{recipient:event.recipient,phase:'impact',delayMs:event.delayMs}));}
        return {clips,events:[...events,...recipeEvents]};
    }
    for(const row of rule.extraFeatures??[])if(row.type==='projectile'){const v=row.values,flight=Math.max(1,v.baseCycles+v.cyclesPerTile*3-v.delayCycles)*20;clips.push({...newVisual(v.id,{recipient:'player',phase:v.event==='launch'?'launch':'impact',delayMs:v.delayCycles*20,durationMs:Math.min(120000-v.delayCycles*20,flight)}),previewTravel:{startHeight:v.startHeight,endHeight:v.endHeight,angle:v.angle}});}

    const groups=references.flatMap(reference=>reference.mechanics??[]);
    for(let index=clips.length-1;index>=0;index--)if(clips[index].nativeFeature||clips[index].nativeGraphic!==undefined&&!clips[index].nativeFeature&&groups.some(group=>group.preview?.graphic===clips[index].nativeGraphic&&(group.preview.recipient??'target')===clips[index].nativeRecipient))clips.splice(index,1);
    for(const feature of rule.nativeFeatures){
        const source=references.find(reference=>reference.id===feature.source),group=source?.mechanics?.find(group=>group.id===feature.mechanic);if(!group)throw new Error('An attack feature source is unavailable.');
        for(const event of mechanicPreview([group],{[group.id]:feature.values})){
            events.push({...event,id:feature.id});if(!(event.graphic>=0)||rule.disabledFeatureVisuals?.includes(feature.id))continue;
            const candidates=(rule.visuals??[]).map((clip,previewIndex)=>({...clip,previewIndex})).filter(clip=>clip.nativeGraphic===group.preview.graphic&&clip.nativeRecipient===event.recipient),exact=candidates.filter(clip=>clip.nativeFeature===feature.id),custom=exact.length?exact:candidates.filter(clip=>!clip.nativeFeature);
            if(custom.length)for(const clip of custom)clips.push({...clip,phase:'impact',delayMs:Math.min(119999,120000-clip.durationMs,clip.delayMs+event.delayMs)});
            else if(!rule.explicitVisuals)clips.push(newVisual(event.graphic,{recipient:event.recipient,phase:'impact',delayMs:event.delayMs}));
        }
    }
    for(const row of rule.extraFeatures??[])if(row.type==='next-flames'&&row.values.graphic>=0){const mapped=(rule.visuals??[]).flatMap((clip,previewIndex)=>clip.nativeFeature===row.id?[{...clip,previewIndex,phase:row.values.event==='launch'?'launch':'impact'}]:[]);if(mapped.length)clips.push(...mapped);else if(!rule.explicitVisuals)clips.push(newVisual(row.values.graphic,{recipient:'target',phase:'impact'}));}
    return {clips,events:[...events,...recipeEvents]};
}

/** Turn implicit source graphics into ordinary editable queue entries. Never write a saved document. */
export function materializeFeatureVisuals(input,references){
 const rule=structuredClone(input);if(rule.explicitVisuals)return rule;
 const original=rule.visuals??[],clips=original.filter(clip=>!clip.nativeFeature&&!rule.nativeFeatures?.some(feature=>{const group=references.find(r=>r.id===feature.source)?.mechanics?.find(g=>g.id===feature.mechanic);return clip.nativeGraphic===group?.preview?.graphic&&clip.nativeRecipient===(group?.preview?.recipient??'target');}));
 for(const feature of rule.nativeFeatures??[]){
  const reference=references.find(r=>r.id===feature.source),group=reference?.mechanics?.find(g=>g.id===feature.mechanic);if(!group?.preview)continue;
  const event=mechanicPreview([group],{[group.id]:feature.values})[0];if(!event||event.graphic<0||rule.disabledFeatureVisuals?.includes(feature.id))continue;
  const mapped=original.filter(c=>c.nativeFeature===feature.id||!c.nativeFeature&&c.nativeGraphic===group.preview.graphic&&c.nativeRecipient===event.recipient);
  for(const clip of mapped.length?mapped:[newVisual(event.graphic,{recipient:event.recipient,phase:'impact'})])clips.push({...clip,nativeFeature:feature.id,nativeGraphic:group.preview.graphic,nativeRecipient:event.recipient});
 }
 if(clips.length>24)throw new Error('This attack needs more than 24 visual clips. Remove unused clips before converting its source visuals.');
 for(const row of rule.extraFeatures??[])if(row.type==='next-flames'&&row.values.graphic>=0){const mapped=original.filter(clip=>clip.nativeFeature===row.id);for(const clip of mapped.length?mapped:[newVisual(row.values.graphic,{recipient:'target',phase:row.values.event==='launch'?'launch':'impact'})])clips.push({...clip,nativeFeature:row.id,nativeGraphic:row.values.graphic,nativeRecipient:'target'});}
 rule.visuals=clips;rule.explicitVisuals=true;return rule;
}
