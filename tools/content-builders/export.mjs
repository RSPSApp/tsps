import {materializeSpecial,validateEffects,newNativeSpecial} from './shared/effects.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { findRoot } from './root.mjs';
import { validateProject, SLOTS } from './shared/project.mjs';
import { assemble } from './shared/mesh.mjs';
import { encodeModel,modelVertexOrder } from './shared/model-codec.mjs';
import {compileMotion,hasOwnMotion} from './shared/motion.mjs';
import { compileEffects } from './shared/effects.mjs';
import {resolveMechanics} from './shared/native-mechanics.mjs';
import { attackRole } from './shared/creature-attacks.mjs';
import { isGearSet, validateGearSet } from './shared/gear-set.mjs';
import { compileGearVisualMesh } from './shared/gear-visual-compile.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(findRoot(), 'server/package.json'));
const AdmZip = require('adm-zip');
export function transportCheck(key, rows) {
    const size = deflateSync(Buffer.from(JSON.stringify({ gamemodeId: 'server', datasets: [{ key, rows }] }))).length;
    if (size + 5 > 65535) throw new Error(`${key} exceeds the game's packet budget. ${key==='customItems'?'Reduce imported image resolution or frame count, or split the gear into separate packages.':'Reduce model complexity or split the creation.'}`);
    return size + 8;
}
function retainedWornAnimations(project, cache) {
    const ids = new Set(Object.values(project.animations));
    const special = project.effects?.special;
    if (special) ids.add(special.animation);
    const donor = special?.nativeFrom ?? project.settings.specialFrom;
    if (donor >= 0 && !special?.recipe && !special?.nativeOverrides?.includes('animation')) {
        const reference = cache?.specialDonors?.(String(donor)).rows.find(row => row.id === donor);
        for (const id of reference?.animations ?? []) ids.add(id);
    }
    for (const rule of [special, ...project.effects.passives]) {
        for (const clip of rule?.visuals ?? []) if (clip.kind === 'animation' && clip.recipient !== 'target') ids.add(clip.id);
    }
    return [...ids].filter(id => Number.isInteger(id) && id >= 0).sort((a, b) => a - b);
}
export function compileProject(input, cache, effectContext) {
    if(isGearSet(input))return compileGearSet(input,cache);
    const p = validateProject(input), s = p.settings, models = [], views = {};
    for(const surface of p.visuals.textures)if(surface.enabled&&surface.source==='cache'&&cache?.hasTexture&&!cache.hasTexture(surface.sourceId))throw new Error(`${surface.name}: native texture ${surface.sourceId} is not available in this cache.`);
    if(p.kind==='gear'&&s.specialFrom>=0&&!p.effects.special&&cache.specialDonors){const reference=cache.specialDonors(String(s.specialFrom)).rows.find(row=>row.id===s.specialFrom);if(reference?.recipe){const special=newNativeSpecial(reference);if(s.specialEnergy)special.energy=s.specialEnergy;p.effects=validateEffects({...p.effects,special});s.specialFrom=-1;}}
    if(p.effects?.special?.nativeFrom!==undefined&&!p.effects.special.recipe){const reference=cache.specialDonors(String(p.effects.special.nativeFrom)).rows.find(row=>row.id===p.effects.special.nativeFrom);p.effects=validateEffects({...p.effects,special:materializeSpecial(p.effects.special,reference)});}
    if(p.effects?.special?.nativeMechanics){const special=p.effects.special,reference=cache.specialDonors(String(special.nativeFrom)).rows.find(row=>row.id===special.nativeFrom);resolveMechanics(reference?.mechanics,special.nativeMechanics);}
    for(const feature of p.effects?.special?.nativeFeatures??[]){const reference=cache.specialDonors(String(feature.source)).rows.find(row=>row.id===feature.source),group=reference?.mechanics?.find(group=>group.id===feature.mechanic);if(!group||!['handleAfterHitEffects','applySpecialFeature','getSpecialFeatureTraits'].includes(group.hook))throw new Error('This attack feature is unavailable in the native source.');feature.values=resolveMechanics(reference.mechanics,{[group.id]:feature.values})[group.id];}
    if(p.kind==='gear'&&cache?.movementChoices){
        const special=p.effects?.special,ids=new Set();
        if(special&&special.animation>=0&&(special.nativeFrom===undefined||special.recipe||special.nativeOverrides?.includes('animation')))ids.add(special.animation);
        for(const rule of [special,...p.effects.passives])for(const clip of rule?.visuals??[])if(clip.kind==='animation'&&clip.recipient!=='target')ids.add(clip.id);
        for(const id of ids)if(!cache.movementChoices(String(id),0,{actor:'player'}).rows.some(row=>row.id===id))throw new Error(`Movement ${id} is not a compatible player animation. Replace it with Browse player movements before exporting.`);
    }
    const source = `content-builder:${p.id}`, pluginName = `Builder${p.id.replace(/[^a-z0-9]/gi, '')}`;
    const variants = p.kind === 'npc' ? ['body'] : ['inventory', 'male', 'female', 'maleHead', 'femaleHead'];
    const visualModels=[];
    for (let i = 0; i < variants.length; i++) {
        const variant = variants[i], visual=p.kind==='gear'?compileGearVisualMesh(p,variant):null,mesh=visual?.mesh??assemble(p.parts, variant);
        if (!mesh.faces.length) continue;
        cache?.verify(mesh);
        const row = { id: p.ids.modelBase + i, data: Buffer.from(encodeModel(mesh)).toString('base64') };
        if(visual&&[...visual.compiled.models,...visual.compiled.particles,...visual.compiled.textures].length)visualModels.push({...visual.compiled,modelId:row.id,vertexCount:mesh.vertices.length,faceCount:mesh.faces.length});
        transportCheck('customModels', [row]); models.push(row); views[variant] = row.id;
    }
    const animations={...p.animations},animationRows=[];
    if(hasOwnMotion(p)){
        if(p.kind!=='npc')throw new Error('Independent movements currently apply to creatures. Gear uses the player’s rig and equipment animations.');
        if(!p.ids.sequenceBase)throw new Error('Save this project to reserve its custom animation IDs.');
        if(!cache)throw new Error('The active cache is needed to compile combined movements.');
        if(p.attacks.length&&!p.ids.attackSequenceBase)throw new Error('Save this project to reserve its extra attack movements.');
        const jobs=[...['idle','walk','run','attack','block','death'].map((role,index)=>({role,id:p.ids.sequenceBase+index})),...p.attacks.map((attack,index)=>({role:attackRole(attack.id),id:p.ids.attackSequenceBase+index}))];
        for(const {role,id} of jobs){
            const clip=compileMotion(p,cache,role);if(!clip){if(role.startsWith('attack:'))throw new Error('Choose a source movement or add poses for every extra attack before exporting.');animations[role]=-1;continue;}
            const order=modelVertexOrder(clip.mesh),bytes=Buffer.alloc(order.length*clip.frames.length*6);let cursor=0;
            for(const frame of clip.frames)for(const i of order)for(const coordinate of frame.vertices[i]){if(!Number.isInteger(coordinate)||coordinate < -32768||coordinate>32767)throw new Error('An animated vertex is outside signed 16-bit model space.');bytes.writeInt16LE(coordinate,cursor);cursor+=2;}
            const compressed=deflateSync(bytes,{level:9}),encoded=compressed.toString('base64');let hash=2166136261;for(const byte of compressed)hash=Math.imul(hash^byte,16777619);
            const total=Math.ceil(encoded.length/32000);if(total>48)throw new Error('Combined animation is too large for a plugin. Reduce its geometry or duration.');
            for(let part=0;part<total;part++)animationRows.push({id,modelId:views.body,vertexCount:order.length,frameLengths:clip.frames.map(frame=>frame.duration/20),loop:['idle','walk','run'].includes(role),part,total,hash:(hash>>>0).toString(16),data:encoded.slice(part*32000,(part+1)*32000)});
            animations[role]=id;
        }
        for(const row of animationRows)transportCheck('customSampledAnimations',[row]);
    }
    const common = { kind: p.kind, id: p.ids.definition, baseId: p.baseId, name: p.name, examine: p.examine, members: p.members, cache: p.cache, source, settings: s, animations, animationRows, drops: p.drops, models,attackMode:p.attackMode,attacks:p.attacks.map(a=>({...a,animation:animations[attackRole(a.id)]})) };
    if(p.attacks.length && animations.attack>=0)common.attacks.unshift({id:'primary',name:'Primary attack',style:s.attackType,weight:1,range:s.attackType==='MELEE'?1:10,speed:s.attackSpeed,delay:s.attackType==='MELEE'?0:2,maxHit:s.maxHit,projectileId:s.projectileId,launchGraphicId:s.launchGraphicId,animation:animations.attack,parts:{}});
    if (p.kind === 'npc') {
        common.definition = { kind: 'npc', id: p.ids.definition, baseId: p.baseId, fields: { name: p.name, desc: p.examine, modelIds: [views.body], chatheadModelIds: [], widthScale: 128, heightScale: 128, recolorFrom: [], recolorTo: [], retextureFrom: [], retextureTo: [], transforms: null, transformVarbit: -1, transformVarp: -1, size: s.size, combatLevel: s.combatLevel, hitpoints: s.hitpoints, attackLevel: s.stats[0], strengthLevel: s.stats[1], defenceLevel: s.stats[2], rangedLevel: s.stats[3], magicLevel: s.stats[4], idleSeqId: p.animations.idle, walkSeqId: p.animations.walk, walkBackSeqId: -1, walkLeftSeqId: -1, walkRightSeqId: -1, turnLeftSeqId: -1, turnRightSeqId: -1, runSeqId: p.animations.run, runBackSeqId: -1, runLeftSeqId: -1, runRightSeqId: -1, crawlSeqId: -1, crawlBackSeqId: -1, crawlLeftSeqId: -1, crawlRightSeqId: -1, actions: [null, s.attackable ? 'Attack' : null, null, null, null] } };
        transportCheck('customDefinitions', [common.definition]);
    } else {
        if (!['NONE', 'RING', 'ARROWS'].includes(s.equipmentType) && (!views.male || !views.female)) throw new Error('Wearable gear needs male and female views. Duplicate a suitable part into each view.');
        const objType = { name: p.name, examine: p.examine, isMembers: p.members, model: views.inventory, maleModel: views.male ?? -1, femaleModel: views.female ?? -1, maleHeadModel: views.maleHead ?? -1, femaleHeadModel: views.femaleHead ?? -1, maleModel1: -1, maleModel2: -1, femaleModel1: -1, femaleModel2: -1, maleHeadModel2: -1, femaleHeadModel2: -1, maleOffset: 0, femaleOffset: 0, manwearXOff: 0, manwearYOff: 0, manwearZOff: 0, womanwearXOff: 0, womanwearYOff: 0, womanwearZOff: 0, resizeX: 128, resizeY: 128, resizeZ: 128, recolorFrom: [], recolorTo: [], retextureFrom: [], retextureTo: [], countObj: null, countCo: null, note: -1, noteTemplate: -1, placeholder: -1, placeholderTemplate: -1, unnotedId: -1, notedId: -1, wearPos: SLOTS[s.equipmentType], stackability: s.stackable ? 1 : 0, price: s.value, isTradable: s.tradeable, inventoryActions: [null, s.equipmentType === 'NONE' ? null : s.equipmentType === 'WEAPON' || s.equipmentType === 'SHIELD' ? 'Wield' : 'Wear', null, null, 'Drop'], ...Object.fromEntries(['zoom2d', 'xan2d', 'yan2d', 'zan2d', 'offsetX2d', 'offsetY2d'].map(key => [key, s[key]])) };
        common.item = { id: p.ids.definition, baseItemId: p.baseId, objType, ...(s.specialFrom >= 0 && { specialAttack: { from: s.specialFrom, energy: s.specialEnergy } }) };
        common.item.retainWornModelForAnimations = retainedWornAnimations(p, cache);
        if(visualModels.length)common.item.visuals={version:1,models:visualModels};
        common.effects = compileEffects(p,effectContext);
        if (common.effects?.config.special) common.item.specialAttack = common.effects.config.special.energy===0 ? {from:common.effects.config.special.nativeFrom} : { energy: common.effects.config.special.energy };
        transportCheck('customItems', [common.item]);
    }
    const manifest = { category: '@ Ghost Plugins @', format: 1, id: `builder-${p.id}`, name: pluginName, version: '1.0.0', description: `${p.kind === 'npc' ? 'Creature' : 'Gear'}: ${p.name}. Generated by TSPS content builders.` };
    // Cache fields, combat and movement must all point at the compiled sequences.
    if(p.kind==='npc')for(const role of ['idle','walk','run'])common.definition.fields[`${role}SeqId`]=animations[role];
    const identity = { project: p.id, kind: p.kind, definition: p.ids.definition, modelBase: p.ids.modelBase,sequenceBase:p.ids.sequenceBase,attackSequenceBase:p.ids.attackSequenceBase };
    let code = fs.readFileSync(path.join(here, 'runtime.cjs'), 'utf8').replace('/* BUILDER_CONTENT */ null', JSON.stringify(common)).replace("'BUILDER_PLUGIN_NAME'", JSON.stringify(pluginName)).replace('members: false,', `members: ${p.members},`);
    if (common.effects) code = code.replace('/* BUILDER_EFFECT_RUNTIME */ null', `(()=>{const module={exports:{}};${effectRuntimeSource()}\nreturn module.exports;})()`);
    code = `// content-builders:identity ${JSON.stringify(identity)}\n${code}`;
    if (Buffer.byteLength(code) > 1024 * 1024) throw new Error('Plugin exceeds the TSPS 1 MB entry limit. Reduce geometry or split it into separate creations.');
    return { manifest, code, content: common, summary: { id: p.ids.definition, models: models.map(row => ({ id: row.id, bytes: Buffer.from(row.data, 'base64').length })),animations:[...new Set(animationRows.map(row=>row.id))], warnings: [...p.warnings] } };
}
export function compileGearSet(input,cache) {
    const set=validateGearSet(input),itemIds=new Map(set.items.map(item=>[item.id,item.ids.definition]));
    const compiled=set.items.map(item=>compileProject(item,cache,{itemIds,ownerId:`${set.id.slice(0,40)}-${item.ids.definition}`}));
    const materials=new Set(compiled.flatMap(result=>(result.content.item.visuals?.models??[]).flatMap(model=>model.textures.map(layer=>`${result.content.id}/${layer.id}`))));
    if(materials.size>32)throw new Error('This gear set exceeds the 32 custom texture atlas slots. Reduce surface layers or split the set.');
    const name=`BuilderSet${set.id.replace(/[^a-z0-9]/gi,'')}`,content={kind:'gear-set',name:set.name,items:compiled.map(item=>item.content)};
    const identity={project:set.id,kind:'gear-set',items:set.items.map(item=>({project:item.id,kind:'gear',...item.ids}))};
    let code=fs.readFileSync(path.join(here,'runtime.gear-set.cjs'),'utf8').replace('/* BUILDER_CONTENT */ null',JSON.stringify(content)).replace("'BUILDER_PLUGIN_NAME'",JSON.stringify(name)).replace('members: false,',`members: ${set.items.some(item=>item.members)},`);
    if(content.items.some(item=>item.effects))code=code.replace('/* BUILDER_EFFECT_RUNTIME */ null',`(()=>{const module={exports:{}};${effectRuntimeSource()}\nreturn module.exports;})()`);
    code=`// content-builders:identity ${JSON.stringify(identity)}\n${code}`;
    if(Buffer.byteLength(code)>1024*1024)throw new Error('This gear set exceeds the 1 MB plugin limit. Reduce model complexity or remove unused model views.');
    transportCheck('customItems',content.items.map(item=>item.item));
    return {manifest:{category:'@ Ghost Plugins @',format:1,id:`builder-${set.id}`,name,version:'1.0.0',description:`Gear set: ${set.name}. ${set.items.length} custom items.`},code,content,
        summary:{name:set.name,items:compiled.map((item,i)=>({name:set.items[i].name,...item.summary})),models:compiled.flatMap(item=>item.summary.models),warnings:[...new Set(set.items.flatMap(item=>item.warnings))]}};
}
export function pluginZip(compiled) {
    const zip = new AdmZip();
    zip.addFile('plugin.json', Buffer.from(JSON.stringify(compiled.manifest, null, 2)));
    zip.addFile(`${compiled.manifest.name}.plugin.js`, Buffer.from(compiled.code));
    return zip.toBuffer();
}

export function effectRuntimeSource(){return fs.readFileSync(path.join(here,'runtime.effects.cjs'),'utf8').replace("/* BUILDER_ATTACK_RUNTIME */ require('./runtime.attack.cjs')",`(()=>{const module={exports:{}};${fs.readFileSync(path.join(here,'runtime.attack.cjs'),'utf8')}\nreturn module.exports;})()`);}
