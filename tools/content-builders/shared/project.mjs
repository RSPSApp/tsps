import { validateEffects } from './effects.mjs';
import { validateMesh, assemble, bounds, transformVertex } from './mesh.mjs';
import { validateAttacks, attackRole } from './creature-attacks.mjs';
import { validateGearVisuals, visualLayers } from './gear-visuals.mjs';

export const FORMAT = 'tsps-content-builder/1';
export const MOTION_ROLES = ['idle','walk','run','attack','block','death'];
export function newMotion(){return {mode:'follow',sequences:Object.fromEntries(MOTION_ROLES.map(role=>[role,-1])),speed:1,phase:0,strength:1,keys:{}};}
export const VARIANTS = ['body', 'inventory', 'male', 'female', 'maleHead', 'femaleHead'];
export const SLOTS = { NONE: -1, HAT: 0, FULL_HELMET: 0, MED_HELMET: 0, MASK: 0, COIF: 0, CAPE: 1, HOODED_CAPE: 1, AMULET: 2, WEAPON: 3, BODY: 4, PLATEBODY: 4, SHIELD: 5, LEGS: 7, GLOVES: 9, BOOTS: 10, RING: 12, ARROWS: 13 };
export const SKILLS = ['Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer', 'Magic', 'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking', 'Crafting', 'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Slayer', 'Farming', 'Runecrafting', 'Construction', 'Hunter', 'Sailing'];
export const BONUSES = ['Stab attack', 'Slash attack', 'Crush attack', 'Magic attack', 'Ranged attack', 'Stab defence', 'Slash defence', 'Crush defence', 'Magic defence', 'Ranged defence', 'Melee strength', 'Ranged strength', 'Magic damage %', 'Prayer'];
export const NPC_STATS = ['Attack', 'Strength', 'Defence', 'Ranged', 'Magic', 'Melee accuracy', 'Unused', 'Magic accuracy', 'Unused', 'Ranged accuracy', 'Stab defence', 'Slash defence', 'Crush defence', 'Magic defence', 'Ranged defence', 'Unused', 'Unused', 'Unused'];
export const NPC_NUMBERS = { size: [1, 8], combatLevel: [0, 9999], hitpoints: [1, 1000000], maxHit: [0, 10000], attackSpeed: [1, 100], deathTicks: [1, 100], respawn: [0, 10000], walkRadius: [0, 50], huntRange: [0, 50], freezeResistance: [0, 100], projectileId: [-1, 65534], launchGraphicId: [-1, 65534], deathSound: [-1, 65534], elementalWeaknessType: [0, 4], elementalWeaknessPercent: [0, 1000] };
export const NPC_FLAGS = ['attackable', 'aggressive', 'poisonous', 'venomous', 'immunePoison', 'immuneVenom'];
export const GEAR_NUMBERS = { value: [0, 2147483647], highAlch: [0, 2147483647], lowAlch: [0, 2147483647], attackSpeed: [1, 20], zoom2d: [1, 20000], xan2d: [0, 2047], yan2d: [0, 2047], zan2d: [0, 2047], offsetX2d: [-2000, 2000], offsetY2d: [-2000, 2000] };
export const GEAR_FLAGS = ['doubleHanded', 'stackable', 'tradeable', 'dropable', 'sellable'];
const int = (n, min, max, field) => { if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${field} must be ${min} to ${max}.`); return n; };
const string = (v, max, field) => { if (typeof v !== 'string' || v.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)) throw new Error(`Invalid ${field}.`); return v; };
const vector = (v, min, max, field) => { if (!Array.isArray(v) || v.length !== 3 || v.some(n => !Number.isFinite(n) || n < min || n > max)) throw new Error(`Invalid ${field}.`); return [...v]; };
const numericArray = (v, count, min, max, field) => { if (!Array.isArray(v) || v.length !== count) throw new Error(`${field} needs ${count} values.`); return v.map(n => int(n, min, max, field)); };
const boolean = (v, field) => { if (typeof v !== 'boolean') throw new Error(`Invalid ${field}.`); return v; };
export function validId(id) { if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,55}$/.test(id)) throw new Error('Invalid project ID.'); return id; }
export function makePart(source, variant, region = 'whole') {
    return { id: crypto.randomUUID(), name: source.name, source: { kind: source.kind, id: source.id, variant: source.variant, region }, variant, visible: true, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], pivot: [0, 0, 0], mirror: false, bindLabel: -1, bindBone: -1, rigMode:'source', motion:newMotion(),donorPivot:[0,0,0], mesh: structuredClone(source.mesh) };
}
export function newProject(id, kind, source, ids, cache) {
    const g = source.gameplay ?? {}, c = source.combat ?? {}, f = source.fields;
    const project = { format: FORMAT, id, kind, name: `Custom ${source.name}`, baseId: source.id, cache, ids, parts: [makePart(source, kind === 'npc' ? 'body' : 'inventory')], warnings: source.warnings ?? [], members: !!g.members, examine: g.examine ?? '', animations: { idle: f.idleSeqId ?? g.standAnim ?? -1, walk: f.walkSeqId ?? g.walkAnim ?? -1, run: g.runAnim ?? -1, attack: c.anims?.attack ?? g.attackAnim ?? -1, block: c.anims?.block ?? g.blockAnim ?? -1, death: c.anims?.death ?? -1 }, drops: { mode: 'none', sourceId: source.id, emptyWeight: 0, rows: [] } };
    if (kind === 'npc') {
        project.settings = { size: f.size ?? 1, combatLevel: f.combatLevel < 0 ? 0 : f.combatLevel, hitpoints: g.hitpoints ?? Math.max(1, f.hitpoints ?? 10), maxHit: Number.isInteger(g.max_hit) ? g.max_hit : 1, attackSpeed: g.attack_speed ?? 4, attackType: g.attack_type?.some(t => t === 'magic') ? 'MAGIC' : g.attack_type?.some(t => t === 'ranged') ? 'RANGED' : 'MELEE', attackable: !!f.actions?.includes('Attack'), aggressive: g.aggressive ?? false, poisonous: g.poisonous ?? false, venomous: g.venomous ?? false, immunePoison: g.immune_poison ?? false, immuneVenom: g.immune_venom ?? false, freezeResistance: 0, deathTicks: c.deathTicks ?? 2, respawn: c.respawn ?? 25, walkRadius: 0, huntRange: c.huntRange ?? 3, projectileId: c.projectile ?? -1, launchGraphicId: c.launchGraphic ?? -1, deathSound: c.sounds?.death ?? -1, elementalWeaknessType: g.elemental_weakness_type ?? 0, elementalWeaknessPercent: g.elemental_weakness_percent ?? 0,
            stats: [g.attack_level ?? Math.max(1, f.attackLevel ?? 1), g.strength_level ?? Math.max(1, f.strengthLevel ?? 1), g.defence_level ?? Math.max(1, f.defenceLevel ?? 1), g.ranged_level ?? Math.max(1, f.rangedLevel ?? 1), g.magic_level ?? Math.max(1, f.magicLevel ?? 1), g.attack_bonus ?? 0, 0, g.attack_magic ?? 0, 0, g.attack_ranged ?? 0, g.defence_stab ?? 0, g.defence_slash ?? 0, g.defence_crush ?? 0, g.defence_magic ?? 0, g.defence_ranged_standard ?? 0, 0, 0, 0] };
    } else {
        project.members = !!f.isMembers;
        project.settings = { equipmentType: g.equipmentType ?? Object.keys(SLOTS).find(k => SLOTS[k] === f.wearPos) ?? 'NONE', weaponInterface: g.weaponInterface ?? '', value: g.value ?? 0, highAlch: g.highAlch ?? 0, lowAlch: g.lowAlch ?? 0, doubleHanded: g.doubleHanded ?? false, stackable: false, tradeable: false, dropable: true, sellable: false, attackSpeed: g.attackSpeed > 0 ? g.attackSpeed : 4, bonuses: g.bonuses ?? Array(14).fill(0), requirements: Array.from({ length: 24 }, (_, i) => g.requirements?.[i] ?? 0), specialFrom: -1, specialEnergy: 50,
            ...Object.fromEntries(['zoom2d', 'xan2d', 'yan2d', 'zan2d', 'offsetX2d', 'offsetY2d'].map(key => [key, f[key] ?? (key === 'zoom2d' ? 2000 : 0)])) };
    }
    return project;
}
export function validateProject(input) {
    if (!input || input.format !== FORMAT || !['npc', 'gear'].includes(input.kind)) throw new Error('Not a supported TSPS builder project.');
    if(input.attacks!==undefined&&(!Array.isArray(input.attacks)||input.attacks.length>8))throw new Error('Keep at most eight attacks.');
    const p = { format: FORMAT, id: validId(input.id), kind: input.kind, name: string(input.name, 80, 'name').trim(), examine: string(input.examine, 1000, 'examine text'), baseId: int(input.baseId, 0, 49999, 'template ID'), cache: string(input.cache, 100, 'cache name'), members: boolean(input.members, 'members'), ids: { definition: int(input.ids?.definition, 50000, 65022, 'custom definition ID'), modelBase: int(input.ids?.modelBase, 1000000, 2147483640, 'model ID') }, warnings: (input.warnings ?? []).slice(0, 30).map(v => string(v, 300, 'warning')), animations: {}, settings: {}, parts: [], drops: {} };
    p.effects = validateEffects(input.effects);
    p.visuals = validateGearVisuals(input.visuals);
    if(p.kind!=='gear'&&visualLayers(p.visuals).length)throw new Error('Item visuals belong to gear projects.');
    if (p.kind !== 'gear' && (p.effects.special || p.effects.passives.length)) throw new Error('Gear effects can only be used on gear.');
    if (!p.name) throw new Error('Give the creation a name.');
    if(input.ids.sequenceBase!==undefined)p.ids.sequenceBase=int(input.ids.sequenceBase,50000,65529,'sequence ID');
    if(input.ids.attackSequenceBase!==undefined)p.ids.attackSequenceBase=int(input.ids.attackSequenceBase,50000,65527,'attack sequence ID');
    if(p.ids.attackSequenceBase && p.ids.sequenceBase && p.ids.attackSequenceBase<=p.ids.sequenceBase+5 && p.ids.attackSequenceBase+7>=p.ids.sequenceBase)throw new Error('Attack movement IDs overlap the standard movements. Reassign IDs.');
    for (const key of ['idle', 'walk', 'run', 'attack', 'block', 'death']) p.animations[key] = int(input.animations?.[key] ?? -1, -1, 65534, `${key} animation`);
    const s = input.settings ?? {}, numbers = p.kind === 'npc' ? NPC_NUMBERS : GEAR_NUMBERS;
    for (const [key, [min, max]] of Object.entries(numbers)) p.settings[key] = int(s[key], min, max, key);
    for (const key of p.kind === 'npc' ? NPC_FLAGS : GEAR_FLAGS) p.settings[key] = boolean(s[key], key);
    if (p.kind === 'npc') {
        if (!['MELEE', 'MAGIC', 'RANGED'].includes(s.attackType)) throw new Error('Choose a combat style.');
        p.settings.attackType = s.attackType; p.settings.stats = numericArray(s.stats, 18, -10000, 10000, 'NPC stats');
    } else {
        if (!Object.hasOwn(SLOTS, s.equipmentType)) throw new Error('Choose an equipment slot.');
        p.settings.equipmentType = s.equipmentType; p.settings.weaponInterface = string(s.weaponInterface, 64, 'weapon style');
        if (!Array.isArray(s.bonuses) || s.bonuses.length !== 14 || s.bonuses.some((n, i) => !Number.isFinite(n) || Math.abs(n) > 10000 || i !== 12 && !Number.isInteger(n))) throw new Error('Bonuses need 14 valid values. Magic damage may include decimals.');
        p.settings.bonuses = [...s.bonuses];
        p.settings.requirements = numericArray(s.requirements, 24, 0, 126, 'requirements');
        p.settings.specialFrom = int(s.specialFrom, -1, 65022, 'special donor'); p.settings.specialEnergy = int(s.specialEnergy, 1, 100, 'special energy');
    }
    if (!Array.isArray(input.parts) || !input.parts.length || input.parts.length > 128) throw new Error('A project needs 1 to 128 parts.');
    const seen = new Set(); let vertexTotal = 0;
    for (const part of input.parts) {
        const id = string(part.id, 80, 'part ID'); if (seen.has(id)) throw new Error('Duplicate part ID.'); seen.add(id);
        if (!VARIANTS.includes(part.variant) && part.variant !== 'all') throw new Error('Invalid model view.');
        if (p.kind === 'npc' && !['body', 'all'].includes(part.variant)) throw new Error('Creatures use the body view.');
        validateMesh(part.mesh); vertexTotal += part.mesh.vertices.length;
        if (vertexTotal > 150000) throw new Error('Project exceeds 150,000 source vertices.');
        const source = part.source ?? {};
        p.parts.push({ id, name: string(part.name, 100, 'part name'), variant: part.variant, visible: boolean(part.visible, 'visibility'), mirror: boolean(part.mirror, 'mirror'), position: vector(part.position, -16000, 16000, 'position'), rotation: vector(part.rotation, -36000, 36000, 'rotation'), scale: vector(part.scale, .01, 100, 'scale'), pivot: vector(part.pivot, -16000, 16000, 'pivot'), bindLabel: int(part.bindLabel, -1, 255, 'vertex label'), bindBone: int(part.bindBone, -1, 255, 'bone'), parentId: part.parentId == null ? null : string(part.parentId, 80, 'parent part'), pair: part.pair === undefined ? false : boolean(part.pair, 'paired part'), twinBindLabel: int(part.twinBindLabel ?? -1, -1, 255, 'opposite label'), twinBindBone: int(part.twinBindBone ?? -1, -1, 255, 'opposite bone'), role: string(part.role ?? 'part', 30, 'part role'), mesh: structuredClone(part.mesh), source: { kind: string(source.kind ?? '', 20, 'source kind'), id: int(source.id ?? 0, 0, 65534, 'source ID'), variant: string(source.variant ?? '', 30, 'source view'), region: string(source.region ?? '', 40, 'source region') } });
        const out=p.parts.at(-1),m=part.motion??newMotion();
        if(!['source','parent'].includes(part.rigMode??'source'))throw new Error('Choose source joints or parent animation for this part.');
        // Older attached parts already promised to follow their parent, but
        // stored the joint picked before the user positioned the piece.
        out.rigMode=part.rigMode??(out.parentId&&m.mode==='follow'?'parent':'source');
        if(out.rigMode==='parent'&&!out.parentId)throw new Error('Choose a parent before following its animation.');
        if (part.mesh.vertexLinks) {
            if (out.parentId || out.pair || out.mirror || JSON.stringify([out.position,out.rotation,out.scale,out.pivot]) !== JSON.stringify([[0,0,0],[0,0,0],[1,1,1],[0,0,0]])) throw new Error('Connections follow their endpoints. Move the original parts instead.');
            if (!Array.isArray(part.connectionEdges) || !part.connectionEdges.length || part.connectionEdges.length>1024) throw new Error('Invalid connection boundaries.');
            out.connectionEdges=structuredClone(part.connectionEdges);
        }
        if(!['follow','own','still'].includes(m.mode))throw new Error('Choose how the part moves.');
        const scalar=(n,min,max,label)=>{if(!Number.isFinite(n)||n<min||n>max)throw new Error(`Invalid ${label}.`);return n;};
        out.motion={mode:m.mode,sequences:{},speed:scalar(m.speed??1,.1,4,'motion speed'),phase:scalar(m.phase??0,0,1,'motion phase'),strength:scalar(m.strength??1,0,2,'motion strength'),keys:{}};
        if(part.donorBasis){if(!Array.isArray(part.donorBasis)||part.donorBasis.length!==3)throw new Error('Invalid donor transform.');out.donorBasis=part.donorBasis.map(v=>vector(v,-1000000,1000000,'donor transform'));}
        out.donorPivot=vector(part.donorPivot??[0,0,0],-16000,16000,'source pivot');
        if(part.mesh.sourceVertices){if(!Array.isArray(part.mesh.sourceVertices)||part.mesh.sourceVertices.length!==part.mesh.vertices.length||part.mesh.sourceVertices.some(n=>!Number.isInteger(n)||n<0||n>24000))throw new Error('Invalid source vertex mapping.');}
        for(const role of [...MOTION_ROLES,...(input.attacks??[]).map(a=>attackRole(a.id))]){if(!MOTION_ROLES.includes(role)&&!m.keys?.[role]?.length&&m.sequences?.[role]===undefined)continue;out.motion.sequences[role]=int(m.sequences?.[role]??-1,-1,65534,'part sequence');const keys=m.keys?.[role]??[];if(!Array.isArray(keys)||keys.length>32)throw new Error('A part movement supports at most 32 poses.');let previous=-1;out.motion.keys[role]=keys.map(key=>{const time=int(key.time,0,8000,'pose time');if(time%20!==0)throw new Error('Pose times must use 20 ms steps.');if(time<=previous)throw new Error('Pose times must be in order.');previous=time;return {time,position:vector(key.position,-16000,16000,'pose position'),rotation:vector(key.rotation,-36000,36000,'pose rotation'),scale:vector(key.scale,.01,100,'pose scale')};});}
    }
    // Earlier view generation baked world-space vertices but left the edit pivot
    // at the floor. Repair that representation on load without moving any geometry.
    for (const part of p.parts) {
        if (part.source.region !== 'generated' || part.parentId || part.pair || part.mesh.vertexLinks || part.pivot.some(n => n !== 0)) continue;
        const descendants = new Set([part.id]);
        for (const id of descendants) for (const child of p.parts) if (child.parentId === id) descendants.add(child.id);
        if (p.parts.some(child => descendants.has(child.id) && (child.pair || Object.values(child.motion.keys).some(keys => keys.length)))) continue;
        const center = bounds(part.mesh).center, placedCenter = transformVertex(center, part);
        const position = placedCenter.map((n, i) => n - center[i]);
        if (position.some(n => Math.abs(n) > 16000)) continue;
        part.pivot = center; part.position = position;
    }
    for (const part of p.parts) { const chain = new Set([part.id]); let id = part.parentId; while (id) { if (chain.has(id)) throw new Error('Part attachments form a loop.'); chain.add(id); const parent = p.parts.find(p => p.id === id); if (!parent) throw new Error('Attached part is missing its parent.'); if (parent.variant !== part.variant && parent.variant !== 'all') throw new Error('Attached parts must share a model view.'); id = parent.parentId; } }
    p.attacks = p.kind==='npc' ? validateAttacks(input.attacks,p.parts,p.settings) : [];
    if(!['cycle','random'].includes(input.attackMode??'cycle'))throw new Error('Choose how attacks are picked.');p.attackMode=input.attackMode??'cycle';
    const connectedEdges=new Set();
    for(const part of p.parts.filter(p=>p.mesh.vertexLinks)) {
        for(const ref of part.mesh.vertexLinks){const target=p.parts.find(p=>p.id===ref.partId);if(!target || target.mesh.vertexLinks || !target.mesh.vertices[ref.vertex] || target.variant!==part.variant && target.variant!=='all')throw new Error('A connection endpoint is missing or in another view. Remove its connection first.');if(part.visible&&!target.visible)throw new Error('Show both connected parts, or hide their connection too.');if(ref.twin){let p=target,paired=false;while(p){paired ||=p.pair;p=input.parts.find(row=>row.id===p.parentId);}if(!paired)throw new Error('A connected mirrored copy is missing. Restore its pair or remove the connection.');}}
        const refKey=r=>`${r.partId}/${r.twin}/${r.vertex}`;
        const bridgeEdges=new Map();
        for(const f of part.mesh.faces)for(let i=0;i<3;i++){const refs=[part.mesh.vertexLinks[f[i]],part.mesh.vertexLinks[f[(i+1)%3]]],key=refs.map(refKey).sort().join('|');bridgeEdges.set(key,(bridgeEdges.get(key)??0)+1);}
        for(const edge of part.connectionEdges){
            if(!Array.isArray(edge)||edge.length!==2||edge.some(r=>!part.mesh.vertexLinks.some(v=>refKey(v)===refKey(r))))throw new Error('Invalid connected edge.');
            const key=edge.map(refKey).sort().join('|');if(connectedEdges.has(key))throw new Error('An edge has more than one connection.');connectedEdges.add(key);
            if(bridgeEdges.get(key)!==1)throw new Error('A connected edge must meet exactly one new face.');
            const [a,b]=edge;if(a.partId!==b.partId||a.twin!==b.twin)throw new Error('Invalid connected boundary.');
            const mesh=p.parts.find(p=>p.id===a.partId).mesh;
            if(mesh.faces.filter(f=>f.slice(0,3).includes(a.vertex)&&f.slice(0,3).includes(b.vertex)).length!==1)throw new Error('A connected edge is no longer open. Remove its connection before changing those faces.');
        }
    }
    const d = input.drops ?? {};
    if (!['none', 'borrow', 'custom'].includes(d.mode)) throw new Error('Invalid drop mode.');
    p.drops = { mode: d.mode, sourceId: int(d.sourceId, 0, 65022, 'drop source'), emptyWeight: int(d.emptyWeight, 0, 1000000, 'empty drop weight'), rows: [] };
    if (!Array.isArray(d.rows) || d.rows.length > 150) throw new Error('At most 150 drop entries are supported.');
    for (const r of d.rows) { const row = { itemId: int(r.itemId, 0, 65022, 'drop item'), min: int(r.min, 1, 2147483647, 'minimum amount'), max: int(r.max, 1, 2147483647, 'maximum amount'), weight: int(r.weight, 0, 1000000, 'drop weight') }; if (row.min > row.max) throw new Error('Minimum drop exceeds maximum.'); p.drops.rows.push(row); }
    if (p.kind === 'npc' && p.drops.mode === 'borrow' && p.drops.sourceId === p.ids.definition) throw new Error('A creature cannot borrow its own drop table.');
    if (p.kind === 'gear' && p.settings.specialFrom === p.ids.definition) throw new Error('Choose another item as the special attack donor.');
    const variants = p.kind === 'npc' ? ['body'] : ['inventory', 'male', 'female', 'maleHead', 'femaleHead'];
    for (const variant of variants) { const mesh = assemble(p.parts, variant); if (mesh.faces.length) validateMesh(mesh); else if (['body', 'inventory'].includes(variant)) throw new Error(`The ${variant} view needs visible geometry.`); }
    return p;
}
